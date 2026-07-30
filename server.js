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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = "claude-sonnet-5";
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
    return {
      kartor: d.kartor ?? [], zoner: d.zoner ?? [], odlingar: d.odlingar ?? [], enheter: d.enheter ?? [],
      widgets: d.widgets ?? [], installningar: d.installningar ?? {}, historik: d.historik ?? [],
      notiser: d.notiser ?? [],
    };
  } catch {
    return { kartor: [], zoner: [], odlingar: [], enheter: [], widgets: [], installningar: {}, historik: [], notiser: [] };
  }
}
async function skrivData(data) {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
}
// En odlingspost är "en sort på en plats" och bär ett antal – t.ex. 6 gurkor
// i en låda är én post med antal 6, inte sex poster. Taket på 200 finns bara
// för att en felskrivning inte ska rita ut tiotusen ikoner på kartan.
const MAX_ANTAL = 200;
function rensaAntal(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_ANTAL, n);
}
// "klunga" = plantorna står samlade på sin punkt i zonen, "fyll" = de sprids
// jämnt över hela ytan (en låda helt full med samma sort).
function rensaLayout(v) {
  return v === "fyll" ? "fyll" : "klunga";
}
// Utetemperaturen (SMHI) sparas i historiken under ett reserverat id, så den
// ligger sida vid sida med sensorserierna utan att vara en "enhet".
const UTE_SERIE = "__ute";
// Zonens höjd över marken i meter – styr hur lång skugga den kastar i
// solkartan. Ett växthus skuggar, en utplanterad bädd i praktiken inte.
const STANDARD_HOJD_M = { vaxthus: 2.2, odlingslada: 0.4, utomhus: 0.15, inomhus: 0, annat: 0 };
function rensaHojdM(v, typ) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return STANDARD_HOJD_M[typ] ?? 0;
  return Math.min(20, Math.round(n * 100) / 100);
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
  // Temperaturen närmast nu behövs som utereferens när panelen räknar ut hur
  // mycket varmare eller kallare varje zon ligger än prognosen (se
  // frostkalibreringen i index.html).
  const nu = Date.now();
  let narmast = null, narmastDiff = Infinity;
  for (const t of data.timeSeries) {
    if (t.data?.air_temperature == null) continue;
    const diff = Math.abs(new Date(t.time).getTime() - nu);
    if (diff < narmastDiff) { narmastDiff = diff; narmast = t.data.air_temperature; }
  }
  // Koordinaterna följer med så panelen kan räkna ut solens bana lokalt
  const resultat = { dagar, nu: narmast, lat: Number(GEO_LAT), lon: Number(GEO_LON) };
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

// Hämtar en ögonblicksbild från en HA-kameraentitet. Går via servern
// eftersom HA:s camera_proxy kräver en Authorization-header, som en vanlig
// <img src> inte kan skicka – panelen pekar alltså på den här endpointen
// istället och slipper någonsin se HA-token.
async function hamtaKamerabild(entityId) {
  if (!HA_TOKEN) return null;
  try {
    const res = await fetch(`${HA_URL}/api/camera_proxy/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    if (!res.ok) return null;
    return { typ: res.headers.get("content-type") || "image/jpeg", data: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

// Hela HA:s entitetslista (för sökbar autocomplete i "Lägg till HA-enhet"),
// cachad en kort stund så inte varje besök på Inställningar hamrar HA.
let allaEntiteterCache = null; // { tid, lista }
const ALLA_ENTITETER_CACHE_MS = 60 * 1000;
async function hamtaAllaEntiteter() {
  if (!HA_TOKEN) return [];
  if (allaEntiteterCache && Date.now() - allaEntiteterCache.tid < ALLA_ENTITETER_CACHE_MS) return allaEntiteterCache.lista;
  try {
    const res = await fetch(`${HA_URL}/api/states`, { headers: { Authorization: `Bearer ${HA_TOKEN}` } });
    if (!res.ok) return [];
    const data = await res.json();
    const lista = data
      .map((s) => ({ entityId: s.entity_id, namn: s.attributes?.friendly_name || s.entity_id }))
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
    allaEntiteterCache = { tid: Date.now(), lista };
    return lista;
  } catch {
    return [];
  }
}

// ---- Smart bevattningsinsikt (Claude) ----
// Ger Claude en sammanfattning av trädgården (zoner, odlingar, kopplade
// sensorers senaste värden, väderprognos) och ber om en kort, konkret
// bevattningsrekommendation. Cachas i timmar för att hålla kostnaden
// försumbar – väder och jordfuktighet ändras inte minut för minut.
let bevattningCache = null; // { tid, resultat }
const BEVATTNING_CACHE_MS = 4 * 3600 * 1000;
const ZON_TYPER_NAMN = { vaxthus: "växthus", utomhus: "utomhusbädd", inomhus: "inomhus", odlingslada: "odlingslåda", annat: "annat" };

async function byggTradgardsSammanfattning(d, vader) {
  const zonRader = d.zoner.map((z) => {
    const info = ZON_TYPER_NAMN[z.typ] ?? z.typ;
    return `- ${z.namn} (${info})${z.jord ? `, jord: ${z.jord}` : ""}`;
  });
  const odlingRader = await Promise.all(d.odlingar.map(async (o) => {
    const zon = d.zoner.find((z) => z.id === o.zonId);
    const antal = rensaAntal(o.antal);
    const delar = [`- ${antal > 1 ? `${antal} st ` : ""}${o.namn}${zon ? ` i zonen "${zon.namn}"` : " (okategoriserad)"}`];
    if (o.jord) delar.push(`jord: ${o.jord}`);
    if (o.skordManad) delar.push(`skörd: ${o.skordManad}`);
    return delar.join(", ");
  }));
  const enhetIder = new Set([...d.zoner.flatMap((z) => z.enhetIds ?? []), ...d.odlingar.flatMap((o) => o.enhetIds ?? [])]);
  const sensorRader = [];
  for (const enhetId of enhetIder) {
    const enhet = d.enheter.find((e) => e.id === enhetId);
    if (!enhet) continue;
    const status = await hamtaEntitetStatus(enhet.entityId);
    const agare = [...d.zoner, ...d.odlingar].find((x) => (x.enhetIds ?? []).includes(enhetId));
    sensorRader.push(status.fel
      ? `- ${enhet.namn} (${agare?.namn ?? "okänd"}): ej tillgänglig`
      : `- ${enhet.namn} (${agare?.namn ?? "okänd"}): ${status.state}${status.enhet ? " " + status.enhet : ""}`);
  }
  const vaderRader = vader.fel ? ["Väderdata ej tillgänglig."] : vader.dagar.map((dag) =>
    `- ${dag.dag}: ${dag.min}–${dag.max}°C, ${dag.nederbord} mm nederbörd`);
  return [
    "Zoner:", zonRader.length ? zonRader.join("\n") : "(inga zoner ännu)",
    "\nOdlingar:", odlingRader.length ? odlingRader.join("\n") : "(inga odlingar ännu)",
    "\nSensorer just nu:", sensorRader.length ? sensorRader.join("\n") : "(inga sensorer kopplade ännu)",
    "\nVäderprognos:", vaderRader.join("\n"),
  ].join("\n");
}

async function hamtaSmartBevattning() {
  if (!ANTHROPIC_API_KEY) return { text: null, fel: "ANTHROPIC_API_KEY är inte konfigurerad" };
  if (bevattningCache && Date.now() - bevattningCache.tid < BEVATTNING_CACHE_MS) return bevattningCache.resultat;
  try {
    const [d, vader] = await Promise.all([lasData(), hamtaVader()]);
    const sammanfattning = await byggTradgardsSammanfattning(d, vader);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `Du är en erfaren trädgårdsrådgivare. Ge en kort (max 3 meningar), konkret bevattningsrekommendation på svenska utifrån datan nedan. Nämn specifika zoner eller odlingar vid namn om något sticker ut (torr jord, ingen nederbörd väntad, en sensor som visar lågt värde). Ingen inledande hälsningsfras, gå rakt på sak.\n\n${sammanfattning}`,
        }],
      }),
    });
    if (!res.ok) return { text: null, fel: `Claude svarade ${res.status}` };
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) return { text: null, fel: "Tomt svar från Claude" };
    const resultat = { text, tid: new Date().toISOString() };
    bevattningCache = { tid: Date.now(), resultat };
    return resultat;
  } catch (err) {
    return { text: null, fel: err.message };
  }
}

// ---- AI-chatt (Claude, med bildstöd) ----
// Användaren kan fråga t.ex. "varför ser den här plantan ut så här?" och
// bifoga ett foto. Vi skickar med hela trädgårdssammanfattningen (zoner,
// odlingar, sensorvärden, väder) plus en kort historiktrend per kopplad
// sensor, så svaret kan väga in både bilden och den faktiska mätdatan.
const CHATT_MODELL = "claude-opus-5";

function historikSammanfattning(d) {
  const rader = [];
  const enhetIder = new Set([...d.zoner.flatMap((z) => z.enhetIds ?? []), ...d.odlingar.flatMap((o) => o.enhetIds ?? [])]);
  for (const enhetId of enhetIder) {
    const enhet = d.enheter.find((e) => e.id === enhetId);
    if (!enhet) continue;
    const punkter = (d.historik ?? []).filter((p) => p.enhetId === enhetId).sort((a, b) => new Date(a.tid) - new Date(b.tid));
    if (punkter.length < 2) continue;
    const varden = punkter.map((p) => p.varde);
    const forsta = punkter[0], sista = punkter[punkter.length - 1];
    rader.push(`- ${enhet.namn}: nu ${sista.varde}, min ${Math.min(...varden)}, max ${Math.max(...varden)} (${punkter.length} mätningar sedan ${forsta.tid.slice(0, 10)})`);
  }
  return rader.length ? rader.join("\n") : "(ingen loggad historik ännu)";
}

async function svaraChatt(meddelanden) {
  if (!ANTHROPIC_API_KEY) return { fel: "ANTHROPIC_API_KEY är inte konfigurerad – lägg till den i docker-compose.yml." };
  const [d, vader] = await Promise.all([lasData(), hamtaVader()]);
  const sammanfattning = await byggTradgardsSammanfattning(d, vader);
  const apiMeddelanden = (meddelanden ?? []).slice(-20).map((m) => {
    const innehall = [];
    if (m.bild?.data) innehall.push({ type: "image", source: { type: "base64", media_type: m.bild.typ || "image/jpeg", data: m.bild.data } });
    if (m.text) innehall.push({ type: "text", text: m.text });
    return { role: m.roll === "ai" ? "assistant" : "user", content: innehall.length ? innehall : [{ type: "text", text: "(tomt)" }] };
  });
  if (!apiMeddelanden.length) return { fel: "inget meddelande" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHATT_MODELL,
        max_tokens: 2000,
        system: `Du är en kunnig och konkret trädgårdsrådgivare som hjälper ett par med sin odling. Svara på svenska, kort och praktiskt – hellre två träffsäkra stycken än en lång uppsats.

Om användaren bifogar ett foto: beskriv först kort vad du faktiskt ser på plantan (färg, fläckar, form, jord), och koppla sedan ihop det med mätdatan nedan om den är relevant. Var tydlig med vad som är säkert och vad som är en gissning – hitta aldrig på mätvärden som inte står här.

Aktuell trädgård:
${sammanfattning}

Sensorhistorik:
${historikSammanfattning(d)}`,
        messages: apiMeddelanden,
      }),
    });
    if (!res.ok) return { fel: `Claude svarade ${res.status}: ${(await res.text()).slice(0, 300)}` };
    const data = await res.json();
    if (data.stop_reason === "refusal") return { fel: "Claude avböjde att svara på den frågan." };
    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return text ? { text } : { fel: "Tomt svar från Claude" };
  } catch (err) {
    return { fel: err.message };
  }
}

// ---- Skördepåminnelser ----
// Körs internt i containern (inte via GitHub Actions) eftersom journalen
// bara finns lokalt i den här datafilen – ingen anledning att exponera den
// mot internet bara för att en cron-tjänst ska kunna läsa den.
// Skickar till ntfy (push till mobilen) och, om en webhook är satt, även
// till en Home Assistant-webhook – samma dubbla mönster som Bostadsvakts
// notify.js. En automation i HA kan då göra vad ni vill med notisen
// (visa på en skärm, säga den högt, blinka en lampa) utöver ntfy-pushen.
// Ämne/webhook kan sättas via panelens Inställningar (sparas i datafilen)
// eller via env-variablerna NTFY_TOPIC/WEBHOOK_URL – panelens värde vinner
// om båda är satta.
async function skickaNotis(titel, meddelande) {
  const { installningar } = await lasData();
  const ntfyTopic = installningar.ntfyTopic || NTFY_TOPIC;
  const webhookUrl = installningar.webhookUrl || WEBHOOK_URL;
  if (!ntfyTopic) console.log(`[inget ntfy-ämne satt] ${titel}: ${meddelande}`);
  else {
    try {
      const res = await fetch("https://ntfy.sh", {
        method: "POST",
        body: JSON.stringify({ topic: ntfyTopic, title: titel, message: meddelande, priority: 3 }),
      });
      if (!res.ok) console.warn(`ntfy svarade ${res.status}`);
    } catch (err) {
      console.warn(`ntfy misslyckades: ${err.message}`);
    }
  }
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
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

// ---- Historik för entiteter kopplade till zoner/odlingar ----
// Pollar HA en gång i timmen för varje entitet som är kopplad till en zon
// eller odling i panelen, och sparar mätvärdet så Historik-vyn kan rita en
// trend. Bara numeriska tillstånd loggas (t.ex. jordfuktighet i %, inte en
// switch-entitets on/off). 90 dagars historik sparas, äldre städas bort.
const HISTORIK_DAGAR = 90;
function kopladeEnhetIder(d) {
  return new Set([...d.zoner.flatMap((z) => z.enhetIds ?? []), ...d.odlingar.flatMap((o) => o.enhetIds ?? [])]);
}
async function loggaHistorik() {
  const d = await lasData();
  const ider = kopladeEnhetIder(d);
  if (!ider.size) return;
  const nu = new Date().toISOString();
  const punkter = [];
  for (const enhetId of ider) {
    const enhet = d.enheter.find((e) => e.id === enhetId);
    if (!enhet) continue;
    const status = await hamtaEntitetStatus(enhet.entityId);
    const varde = Number(status.state);
    if (Number.isFinite(varde)) punkter.push({ tid: nu, enhetId, varde });
  }
  // Utetemperaturen från SMHI loggas som en egen serie. Den är referensen som
  // gör det möjligt att räkna ut hur mycket varmare eller kallare varje zon
  // faktiskt ligger än den regionala prognosen – en zonvis frostvarning går
  // inte att bygga utan att ha sparat vad prognosen sa när mätningen gjordes.
  const vader = await hamtaVader();
  if (Number.isFinite(vader?.nu)) punkter.push({ tid: nu, enhetId: UTE_SERIE, varde: vader.nu });
  if (!punkter.length) return;
  const gransTid = Date.now() - HISTORIK_DAGAR * 24 * 3600 * 1000;
  await muteraData((data) => {
    data.historik = [...(data.historik ?? []), ...punkter].filter((p) => new Date(p.tid).getTime() >= gransTid);
  });
}
const EN_TIMME_MS = 3600 * 1000;
setInterval(() => loggaHistorik().catch((err) => console.warn("Historik-loggning misslyckades:", err.message)), EN_TIMME_MS);

// ---- Migrering ----
// Kartor tillkom efter att zoner redan fanns: se till att det alltid finns
// minst en karta och att varje zon hör till en. Idempotent, körs vid start.
async function migreraData() {
  await muteraData((d) => {
    if (!d.kartor.length) d.kartor.push({ id: randomUUID(), namn: "Min trädgård" });
    const forsta = d.kartor[0].id;
    for (const z of d.zoner) if (!z.kartaId) z.kartaId = forsta;
  });
}

// ---- HTTP ----
function skickaJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
// Bilder i chatten skickas som base64 i JSON-kroppen, så taket är tilltaget –
// men inte obegränsat, så en trasig klient inte kan äta upp minnet.
const MAX_BODY_BYTES = 12 * 1024 * 1024;
async function lasBody(req) {
  const delar = [];
  let storlek = 0;
  for await (const del of req) {
    storlek += del.length;
    if (storlek > MAX_BODY_BYTES) throw new Error("förfrågan är för stor");
    delar.push(del);
  }
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
      const { namn, planterad, skordFonster, skordManad, anteckning, zonId, antal, layout } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => {
        d.odlingar.push({
          id: randomUUID(), namn, planterad: planterad || "",
          skordFonster: skordFonster || "", skordManad: skordManad || "", anteckning: anteckning || "",
          zonId: zonId || "", jord: "", enhetIds: [],
          antal: rensaAntal(antal), layout: rensaLayout(layout),
        });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/odlingar/uppdatera")) {
      const { id, planterad, skordFonster, skordManad, anteckning, jord, enhetIds, zonId, x, y, antal, layout } = await lasBody(req);
      const data = await muteraData((d) => {
        const o = d.odlingar.find((o2) => o2.id === id);
        if (!o) return;
        Object.assign(o, {
          planterad: planterad || "", skordFonster: skordFonster || "", skordManad: skordManad || "",
          anteckning: anteckning || "", jord: jord || "", enhetIds: enhetIds ?? [],
        });
        // Plantans plats i sin zon/sektion (0–1), satt genom att dra på kartan.
        if (zonId !== undefined) o.zonId = zonId || "";
        if (x !== undefined) o.x = x;
        if (y !== undefined) o.y = y;
        if (antal !== undefined) o.antal = rensaAntal(antal);
        if (layout !== undefined) o.layout = rensaLayout(layout);
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/odlingar/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.odlingar = d.odlingar.filter((o) => o.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/zoner/uppdatera")) {
      const { id, jord, anteckning, enhetIds, x, y, foralderId, bredd, hojd, hojdM } = await lasBody(req);
      const data = await muteraData((d) => {
        const zon = d.zoner.find((z) => z.id === id);
        if (!zon) return;
        Object.assign(zon, {
          jord: jord || "", anteckning: anteckning || "", enhetIds: enhetIds ?? [],
          x: x ?? zon.x ?? 0.5, y: y ?? zon.y ?? 0.5,
        });
        if (bredd !== undefined) zon.bredd = bredd;
        if (hojd !== undefined) zon.hojd = hojd;
        if (hojdM !== undefined) zon.hojdM = rensaHojdM(hojdM, zon.typ);
        if (foralderId !== undefined) {
          // Skydda mot att en zon blir sin egen förälder eller att två zoner
          // pekar på varandra – då skulle utritningen loopa i all oändlighet.
          let giltig = Boolean(foralderId);
          if (foralderId === zon.id) giltig = false;
          if (giltig) {
            let f = d.zoner.find((z) => z.id === foralderId);
            if (!f) giltig = false;
            for (let steg = 0; f && steg < 20; steg++) {
              if (f.id === zon.id) { giltig = false; break; }
              f = f.foralderId ? d.zoner.find((z) => z.id === f.foralderId) : null;
            }
          }
          zon.foralderId = giltig ? foralderId : "";
          if (giltig) zon.kartaId = d.zoner.find((z) => z.id === foralderId).kartaId;
        }
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/zoner")) {
      const { namn, typ, x, y, kartaId, foralderId } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => {
        // En sektion (t.ex. en odlingslåda inne i ett växthus) ärver kartan
        // från sin förälder och behöver ingen egen x/y – den ritas inuti
        // föräldern istället för fritt på kartan.
        const foralder = foralderId ? d.zoner.find((z) => z.id === foralderId) : null;
        const karta = foralder ? foralder.kartaId : (kartaId || d.kartor[0]?.id || "");
        // Staggrar nya toppnivå-zoner i ett löst rutmönster så de inte hamnar
        // rakt ovanpå varandra innan man dragit dem på plats – per karta.
        const n = d.zoner.filter((z) => z.kartaId === karta && !z.foralderId).length;
        const standardX = 0.2 + (n % 3) * 0.3;
        const standardY = 0.25 + Math.floor(n / 3) * 0.32;
        d.zoner.push({
          id: randomUUID(), namn, typ: typ || "annat", jord: "", anteckning: "", enhetIds: [],
          kartaId: karta, foralderId: foralder ? foralder.id : "",
          // Sektioner placeras i förälderns yta (0–1), toppzoner på kartan.
          x: x ?? (foralder ? 0.5 : standardX), y: y ?? (foralder ? 0.5 : standardY),
          // Storleken styr även orienteringen – en bred låda ligger längs med,
          // en hög står på tvären. Null = använd standardstorlek i panelen.
          bredd: null, hojd: null,
          hojdM: rensaHojdM(undefined, typ || "annat"),
        });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/kartor")) {
      const { namn } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => { d.kartor.push({ id: randomUUID(), namn }); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/kartor/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => {
        d.kartor = d.kartor.filter((k) => k.id !== id);
        if (!d.kartor.length) d.kartor.push({ id: randomUUID(), namn: "Min trädgård" });
        // Zoner på den borttagna kartan flyttas till den första kvarvarande
        // istället för att bli osynliga.
        for (const z of d.zoner) if (z.kartaId === id) z.kartaId = d.kartor[0].id;
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/widgets")) {
      const { titel, typ, enhetIds, entityId, kolumn } = await lasBody(req);
      if (!titel) return skickaJson(res, 400, { fel: "titel saknas" });
      const data = await muteraData((d) => {
        d.widgets.push({
          id: randomUUID(), titel, typ: typ === "kamera" ? "kamera" : "entiteter",
          enhetIds: enhetIds ?? [], entityId: entityId || "", kolumn: kolumn === "huvud" ? "huvud" : "sido",
        });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/widgets/uppdatera")) {
      const { id, titel, enhetIds, entityId, kolumn } = await lasBody(req);
      const data = await muteraData((d) => {
        const w = d.widgets.find((x) => x.id === id);
        if (w) Object.assign(w, {
          titel: titel ?? w.titel, enhetIds: enhetIds ?? w.enhetIds ?? [], entityId: entityId ?? w.entityId ?? "",
          kolumn: kolumn ?? w.kolumn ?? "sido",
        });
      });
      return skickaJson(res, 200, data);
    }
    // Sparar ny ordning på blocken (upp/ner-pilarna i panelen)
    if (req.method === "POST" && p.endsWith("/api/widgets/ordna")) {
      const { ids } = await lasBody(req);
      const data = await muteraData((d) => {
        const perId = new Map(d.widgets.map((w) => [w.id, w]));
        const ordnade = (ids ?? []).map((id) => perId.get(id)).filter(Boolean);
        const kvar = d.widgets.filter((w) => !(ids ?? []).includes(w.id));
        d.widgets = [...ordnade, ...kvar];
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/widgets/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.widgets = d.widgets.filter((w) => w.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "GET" && p.endsWith("/api/kamera")) {
      const bild = await hamtaKamerabild(url.searchParams.get("entityId") || "");
      if (!bild) return skickaJson(res, 404, { fel: "kunde inte hämta kamerabild" });
      res.writeHead(200, { "Content-Type": bild.typ, "Cache-Control": "no-store" });
      return res.end(bild.data);
    }
    if (req.method === "POST" && p.endsWith("/api/zoner/ta-bort")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => {
        const borttagen = d.zoner.find((z) => z.id === id);
        d.zoner = d.zoner.filter((z) => z.id !== id);
        // Sektioner inuti den borttagna zonen raderas inte – de flyttas upp
        // en nivå (oftast till fristående på kartan) istället.
        for (const z of d.zoner) {
          if (z.foralderId === id) {
            z.foralderId = borttagen?.foralderId || "";
            if (z.x == null) z.x = 0.5;
            if (z.y == null) z.y = 0.5;
          }
        }
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
    if (req.method === "GET" && p.endsWith("/api/ha-entiteter")) {
      return skickaJson(res, 200, await hamtaAllaEntiteter());
    }
    if (req.method === "GET" && p.endsWith("/api/enheter/status")) {
      const { enheter } = await lasData();
      const status = await Promise.all(enheter.map(async (e) => ({ ...e, ...(await hamtaEntitetStatus(e.entityId)) })));
      return skickaJson(res, 200, status);
    }
    if (req.method === "GET" && p.endsWith("/api/installningar")) {
      const { installningar } = await lasData();
      return skickaJson(res, 200, installningar);
    }
    if (req.method === "POST" && p.endsWith("/api/installningar")) {
      const { ntfyTopic, webhookUrl, norrGrader, kartaBreddM } = await lasBody(req);
      const data = await muteraData((d) => {
        const grader = Number(norrGrader);
        const bredd = Number(kartaBreddM);
        d.installningar = {
          ntfyTopic: ntfyTopic || "", webhookUrl: webhookUrl || "",
          // Kompassriktningen som pekar uppåt på kartan, och hur många meter
          // kartan är bred – tillsammans ger de skuggorna rätt håll och längd.
          norrGrader: Number.isFinite(grader) ? ((grader % 360) + 360) % 360 : (d.installningar?.norrGrader ?? 0),
          kartaBreddM: Number.isFinite(bredd) && bredd > 0 ? Math.min(500, bredd) : (d.installningar?.kartaBreddM ?? 20),
        };
      });
      return skickaJson(res, 200, data.installningar);
    }
    if (req.method === "GET" && p.endsWith("/api/historik")) {
      const { historik } = await lasData();
      return skickaJson(res, 200, historik);
    }
    // Notiscentret räknar fram själva listan i panelen (frostrisk, torr jord,
    // skördepåminnelser …) från data som redan finns – servern lagrar bara
    // VILKA notiser man redan hanterat, så de inte dyker upp igen. Id:t byggs
    // av panelen och innehåller redan datum för dagsaktuella notiser, så en
    // "avvisad idag"-notis kommer tillbaka av sig själv nästa dag om läget
    // fortfarande gäller då.
    if (req.method === "POST" && p.endsWith("/api/notiser")) {
      const { id, atgard } = await lasBody(req);
      if (!id) return skickaJson(res, 400, { fel: "id saknas" });
      const data = await muteraData((d) => {
        const gransTid = Date.now() - 45 * 24 * 3600 * 1000; // städa bort gamla poster
        d.notiser = (d.notiser ?? []).filter((n) => new Date(n.tid).getTime() >= gransTid && n.id !== id);
        d.notiser.push({ id, atgard: atgard === "klar" ? "klar" : "avvisad", tid: new Date().toISOString() });
      });
      return skickaJson(res, 200, data.notiser);
    }
    if (req.method === "POST" && p.endsWith("/api/chatt")) {
      const { meddelanden } = await lasBody(req);
      return skickaJson(res, 200, await svaraChatt(meddelanden));
    }
    if (req.method === "GET" && p.endsWith("/api/bevattning")) {
      return skickaJson(res, 200, await hamtaSmartBevattning());
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
migreraData().catch((err) => console.warn("Migrering misslyckades:", err.message));
kollaSkordepaminnelser().catch((err) => console.warn("Skördepåminnelse-koll misslyckades:", err.message));
loggaHistorik().catch((err) => console.warn("Historik-loggning misslyckades:", err.message));
