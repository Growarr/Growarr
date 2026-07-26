// Trädgårdsbevakning – panel för odlingsjournal, väderprognos (SMHI) och en
// utbyggbar lista med HA-enheter. Tänkt att växa: lägg till jordfuktighets-
// sensorer, ventiler m.m. som HA-entiteter här den dagen ni har dem
// installerade – ingen kodändring behövs, bara ange entity_id i panelen.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 8097;
const DATA_PATH = process.env.DATA_PATH || "/data/tradgard.json";
const HA_URL = process.env.HA_URL || "http://localhost:8123";
const HA_TOKEN = process.env.HA_TOKEN || "";
const GEO_LAT = process.env.GEO_LAT || "";
const GEO_LON = process.env.GEO_LON || "";
const PANEL_HTML = join(dirname(fileURLToPath(import.meta.url)), "index.html");

// ---- Lagring: odlingsjournal + bevakade HA-enheter ----
async function lasData() {
  try {
    const d = JSON.parse(await readFile(DATA_PATH, "utf8"));
    return { odlingar: d.odlingar ?? [], enheter: d.enheter ?? [] };
  } catch {
    return { odlingar: [], enheter: [] };
  }
}
async function skrivData(data) {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
}
let ko = Promise.resolve();
function muteraData(fn) {
  const resultat = ko.then(async () => {
    const data = await lasData();
    fn(data);
    await skrivData(data);
    return data;
  });
  ko = resultat.catch(() => {});
  return resultat;
}

// ---- Väder (SMHI, gratis, ingen nyckel) ----
let vaderCache = null; // { tid, resultat }
const VADER_CACHE_MS = 30 * 60 * 1000;

async function hamtaVader() {
  if (!GEO_LAT || !GEO_LON) return { fel: "GEO_LAT och/eller GEO_LON är inte konfigurerat." };
  if (vaderCache && Date.now() - vaderCache.tid < VADER_CACHE_MS) return vaderCache.resultat;

  const url = `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/${GEO_LON}/lat/${GEO_LAT}/data.json`;
  const res = await fetch(url, { headers: { "User-Agent": "tradgardsbevakning (github.com/mathiasmholm/tradgardsbevakning)" } });
  if (!res.ok) return { fel: `SMHI svarade ${res.status}` };
  const data = await res.json();

  // Grupperar timprognosen till en per-dag-sammanfattning (min/max temp,
  // mest sannolika nederbörd) för de kommande fem dagarna.
  const perDag = new Map();
  for (const t of data.timeSeries) {
    const dag = t.validTime.slice(0, 10);
    const temp = t.parameters.find((p) => p.name === "t")?.values?.[0];
    const nederbord = t.parameters.find((p) => p.name === "pmean")?.values?.[0];
    if (temp == null) continue;
    const post = perDag.get(dag) ?? { dag, min: temp, max: temp, nederbord: 0 };
    post.min = Math.min(post.min, temp);
    post.max = Math.max(post.max, temp);
    post.nederbord += nederbord ?? 0;
    perDag.set(dag, post);
  }
  const dagar = [...perDag.values()].slice(0, 5).map((d) => ({
    dag: d.dag, min: Math.round(d.min), max: Math.round(d.max), nederbord: Math.round(d.nederbord * 10) / 10,
  }));
  const resultat = { dagar };
  vaderCache = { tid: Date.now(), resultat };
  return resultat;
}

// ---- HA-entiteter (bara nuvarande tillstånd – enkel REST-koll) ----
async function hamtaEntitetStatus(entityId) {
  if (!HA_TOKEN) return { entityId, fel: "HA_TOKEN är inte konfigurerat" };
  try {
    const res = await fetch(`${HA_URL}/api/states/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    if (res.status === 404) return { entityId, fel: "entiteten hittades inte i Home Assistant" };
    if (!res.ok) return { entityId, fel: `HA svarade ${res.status}` };
    const s = await res.json();
    return {
      entityId, state: s.state, enhet: s.attributes?.unit_of_measurement ?? "",
      senastAndrad: s.last_changed,
    };
  } catch (err) {
    return { entityId, fel: err.message };
  }
}

// ---- HTTP ----
function skickaJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function lasBody(req) {
  const delar = [];
  for await (const del of req) delar.push(del);
  return delar.length ? JSON.parse(Buffer.concat(delar).toString("utf8")) : {};
}

// Matchar på slutet av sökvägen – robust oavsett om reverse-proxyn framför
// strippar sitt prefix eller inte, samma mönster som i bostadsvakt-api och
// hushallsekonomi.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://intern");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && p.endsWith("/api/odlingar")) {
      return skickaJson(res, 200, await lasData());
    }
    if (req.method === "POST" && p.endsWith("/api/odlingar")) {
      const { namn, plats, planterad, skordFonster, anteckning } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => {
        d.odlingar.push({ id: randomUUID(), namn, plats: plats || "", planterad: planterad || "", skordFonster: skordFonster || "", anteckning: anteckning || "" });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/odlingar/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.odlingar = d.odlingar.filter((o) => o.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/enheter")) {
      const { entityId, namn } = await lasBody(req);
      if (!entityId) return skickaJson(res, 400, { fel: "entityId saknas" });
      const data = await muteraData((d) => {
        d.enheter.push({ id: randomUUID(), entityId, namn: namn || entityId });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/enheter/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.enheter = d.enheter.filter((e) => e.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "GET" && p.endsWith("/api/enheter/status")) {
      const { enheter } = await lasData();
      const status = await Promise.all(enheter.map(async (e) => ({ ...e, ...(await hamtaEntitetStatus(e.entityId)) })));
      return skickaJson(res, 200, status);
    }
    if (req.method === "GET" && p.endsWith("/api/vader")) {
      return skickaJson(res, 200, await hamtaVader());
    }
    if (req.method === "GET" && !p.includes("/api/")) {
      const html = await readFile(PANEL_HTML, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }
    skickaJson(res, 404, { fel: "okänd endpoint" });
  } catch (err) {
    skickaJson(res, 500, { fel: err.message });
  }
});

server.listen(PORT, () => console.log(`tradgardsbevakning lyssnar på :${PORT}, data i ${DATA_PATH}`));
