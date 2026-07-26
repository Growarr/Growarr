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
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PANEL_HTML = join(dirname(fileURLToPath(import.meta.url)), "index.html");

function stockholmManad(d = new Date()) {
  const delar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit" }).formatToParts(d);
  const f = Object.fromEntries(delar.map((p) => [p.type, p.value]));
  return `${f.year}-${f.month}`;
}
function lokalTimme(iso) {
  return Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(new Date(iso)));
}

// ---- Lagring: zoner, odlingsjournal + bevakade HA-enheter ----
async function lasData() {
  try {
    const d = JSON.parse(await readFile(DATA_PATH, "utf8"));
    return { zoner: d.zoner ?? [], odlingar: d.odlingar ?? [], enheter: d.enheter ?? [] };
  } catch {
    return { zoner: [], odlingar: [], enheter: [] };
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

  // SMHI stängde av gamla pmp3g-API:t 31 mars 2026 – snow1g ersatte det, med
  // ett annat svarsformat ("time" istället för "validTime", platt "data"-
  // objekt istället för en parameters-array).
  const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${GEO_LON}/lat/${GEO_LAT}/data.json`;
  const res = await fetch(url, { headers: { "User-Agent": "tradgardsbevakning (github.com/mathiasmholm/tradgardsbevakning)" } });
  if (!res.ok) return { fel: `SMHI svarade ${res.status}` };
  const data = await res.json();

  // Grupperar timprognosen till en per-dag-sammanfattning (min/max temp,
  // mest sannolika nederbörd) för de kommande fem dagarna. Väderikonen för
  // dagen tas från den timme som ligger närmast kl 12 lokal tid – bättre
  // representativ bild av dagen än t.ex. en tidig morgontimme.
  const perDag = new Map();
  for (const t of data.timeSeries) {
    const dag = t.time.slice(0, 10);
    const temp = t.data?.air_temperature;
    const nederbord = t.data?.precipitation_amount_mean;
    const symbol = t.data?.symbol_code;
    if (temp == null) continue;
    const diffFran12 = Math.abs(lokalTimme(t.time) - 12);
    const post = perDag.get(dag) ?? { dag, min: temp, max: temp, nederbord: 0, symbol, symbolDiff: Infinity };
    post.min = Math.min(post.min, temp);
    post.max = Math.max(post.max, temp);
    post.nederbord += nederbord ?? 0;
    if (symbol != null && diffFran12 < post.symbolDiff) { post.symbol = symbol; post.symbolDiff = diffFran12; }
    perDag.set(dag, post);
  }
  const dagar = [...perDag.values()].slice(0, 5).map((d) => ({
    dag: d.dag, min: Math.round(d.min), max: Math.round(d.max), nederbord: Math.round(d.nederbord * 10) / 10, symbol: d.symbol ?? null,
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

// ---- Skördepåminnelser ----
// Körs internt i containern (inte via GitHub Actions) eftersom journalen
// bara finns lokalt i den här datafilen – ingen anledning att exponera den
// mot internet bara för att en cron-tjänst ska kunna läsa den.
// Skickar till ntfy (push till mobilen) och, om WEBHOOK_URL är satt, även
// till en Home Assistant-webhook – samma dubbla mönster som Bostadsvakts
// notify.js. En automation i HA kan då göra vad ni vill med notisen
// (visa på en skärm, säga den högt, blinka en lampa) utöver ntfy-pushen.
async function skickaNotis(titel, meddelande) {
  if (!NTFY_TOPIC) console.log(`[ingen NTFY_TOPIC satt] ${titel}: ${meddelande}`);
  else {
    try {
      const res = await fetch("https://ntfy.sh", {
        method: "POST",
        body: JSON.stringify({ topic: NTFY_TOPIC, title: titel, message: meddelande, priority: 3 }),
      });
      if (!res.ok) console.warn(`ntfy svarade ${res.status}`);
    } catch (err) {
      console.warn(`ntfy misslyckades: ${err.message}`);
    }
  }
  if (WEBHOOK_URL) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "tradgardsbevakning-bot/1.0 (+github.com/mathiasmholm/tradgardsbevakning)" },
        body: JSON.stringify({ title: titel, message: meddelande }),
      });
      if (!res.ok) console.warn(`HA-webhook svarade ${res.status}`);
    } catch (err) {
      console.warn(`HA-webhook nåddes inte: ${err.message}`);
    }
  }
}
async function kollaSkordepaminnelser() {
  const nuManad = stockholmManad();
  const { odlingar } = await lasData();
  for (const o of odlingar) {
    if (o.skordManad === nuManad && !(o.paminntManader ?? []).includes(nuManad)) {
      await skickaNotis("🌾 Dags att skörda", `${o.namn} har skördemånad nu.`);
      await muteraData((d) => {
        const post = d.odlingar.find((x) => x.id === o.id);
        if (post) post.paminntManader = [...(post.paminntManader ?? []), nuManad];
      });
    }
  }
}
const EN_DAG_MS = 24 * 3600 * 1000;
setInterval(() => kollaSkordepaminnelser().catch((err) => console.warn("Skördepåminnelse-koll misslyckades:", err.message)), EN_DAG_MS);

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
      const { namn, planterad, skordFonster, skordManad, anteckning, zonId } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => {
        d.odlingar.push({
          id: randomUUID(), namn, planterad: planterad || "",
          skordFonster: skordFonster || "", skordManad: skordManad || "", anteckning: anteckning || "",
          zonId: zonId || "",
        });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/odlingar/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.odlingar = d.odlingar.filter((o) => o.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/zoner")) {
      const { namn, typ } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => {
        d.zoner.push({ id: randomUUID(), namn, typ: typ || "annat" });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/zoner/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => {
        d.zoner = d.zoner.filter((z) => z.id !== id);
        // Odlingar i borttagen zon blir "okategoriserade" istället för att pekas ut i tomma intet.
        for (const o of d.odlingar) if (o.zonId === id) o.zonId = "";
      });
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
kollaSkordepaminnelser().catch((err) => console.warn("Skördepåminnelse-koll misslyckades:", err.message));
