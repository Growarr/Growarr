// Growarr – panel för odlingsjournal, väderprognos (SMHI) och en
// utbyggbar lista med HA-enheter. Tänkt att växa: lägg till jordfuktighets-
// sensorer, ventiler m.m. som HA-entiteter här den dagen ni har dem
// installerade – ingen kodändring behövs, bara ange entity_id i panelen.
import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, unlink, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  stockholmManad, stockholmDatum, lokalTimme,
  rensaAntal, rensaLayout, rensaHojdM,
  torkTakt, TORR_GRANS, MIN_LUTNING, veckodagarForIntervall, enhetArFuktsensor,
  normaliseraIp, arBetroddAdress,
} from "./src/logic.js";

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
// Unset (the default) means no login is required at all - existing installs
// keep working exactly as before. Set it to require a single shared
// household password. TRUSTED_NETWORKS (comma-separated CIDRs, e.g.
// "192.168.1.0/24") skips the login for requests from those addresses -
// nothing is trusted by default, not even loopback: a reverse proxy on the
// same host (the normal setup here, with network_mode: host) forwards real,
// outside traffic to Growarr over 127.0.0.1 too, which would make every
// request look local and silently let everyone straight in. Behind a
// reverse proxy in general, the address Growarr sees is the proxy's, not
// the real client's - this only helps when reaching the container directly.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const TRUSTED_NETWORKS = (process.env.TRUSTED_NETWORKS || "").split(",").map((s) => s.trim()).filter(Boolean);
// Background images live as files next to the data file, never inside it.
// tradgard.json is re-read on every API request, so a megabyte of base64 in
// there would slow the whole app down; a separate file costs nothing.
const KARTBILD_DIR = join(dirname(DATA_PATH), "maps");
const PANEL_HTML = join(dirname(fileURLToPath(import.meta.url)), "index.html");
const LOGO_PNG = join(dirname(fileURLToPath(import.meta.url)), "logo.png");
// Read once at startup rather than per-request - the version only changes
// when the container image itself is rebuilt.
const APP_VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8"),
).version;
// Whether a newer build has already landed on main - every push bumps the
// version and rebuilds :latest (see docker-publish.yml), so this is really
// "has your Watchtower/redeploy caught up yet" rather than anything you'd
// act on by hand. Cached for an hour: nobody needs this to the minute, and
// it's one unauthenticated GitHub request per check otherwise.
let senasteVersionCache = null; // { tid, version }
const SENASTE_VERSION_CACHE_MS = 3600 * 1000;
async function hamtaSenasteVersion() {
  if (senasteVersionCache && Date.now() - senasteVersionCache.tid < SENASTE_VERSION_CACHE_MS) return senasteVersionCache.version;
  try {
    const res = await fetch("https://raw.githubusercontent.com/Growarr/growarr/main/package.json", {
      headers: { "User-Agent": "growarr (github.com/Growarr/growarr)" },
    });
    if (!res.ok) return null;
    const { version } = await res.json();
    senasteVersionCache = { tid: Date.now(), version };
    return version;
  } catch {
    return null;
  }
}
// Rolling daily backups of tradgard.json, in their own folder next to the
// data file (same volume, no extra configuration needed). Protects against
// a bad edit or a broken migration - not against the disk itself dying, that
// needs a copy outside the box (e.g. the volume synced to other storage).
const BACKUP_DIR = join(dirname(DATA_PATH), "backups");
const BACKUP_RETENTION_DAYS = 30;

// stockholmManad, stockholmDatum, lokalTimme, rensaAntal, rensaLayout,
// rensaHojdM, torkTakt, veckodagarForIntervall, enhetArFuktsensor: see
// src/logic.js - pure logic, extracted so it can be unit tested.

// ---- Lagring: zoner, odlingsjournal + bevakade HA-enheter ----
async function lasData() {
  try {
    const d = JSON.parse(await readFile(DATA_PATH, "utf8"));
    return {
      kartor: d.kartor ?? [], zoner: d.zoner ?? [], odlingar: d.odlingar ?? [], enheter: d.enheter ?? [],
      widgets: d.widgets ?? [], installningar: d.installningar ?? {}, historik: d.historik ?? [],
      notiser: d.notiser ?? [], scheman: d.scheman ?? [],
      tradgardsAutomationer: d.tradgardsAutomationer ?? [],
    };
  } catch {
    return { kartor: [], zoner: [], odlingar: [], enheter: [], widgets: [], installningar: {}, historik: [], notiser: [], scheman: [], tradgardsAutomationer: [] };
  }
}
async function skrivData(data) {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  // Write to a temp file and rename it in, rather than writing the data file
  // in place - a killed/restarted process mid-writeFile() could otherwise
  // leave a half-written, corrupt tradgard.json behind. rename() on the same
  // filesystem is atomic.
  const tmp = `${DATA_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, DATA_PATH);
}
// Once a day: copy today's data file to backups/tradgard-YYYY-MM-DD.json and
// clean up copies older than BACKUP_RETENTION_DAYS. Overwrites the same
// day's backup on repeated restarts - that's intentional, it's today's
// latest state that's worth being able to roll back to, not every single run.
async function backupData() {
  let innehall;
  try {
    innehall = await readFile(DATA_PATH);
  } catch {
    return; // nothing to back up yet
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(join(BACKUP_DIR, `tradgard-${stockholmDatum()}.json`), innehall);
  const gransTid = Date.now() - BACKUP_RETENTION_DAYS * 24 * 3600 * 1000;
  for (const namn of await readdir(BACKUP_DIR).catch(() => [])) {
    const match = namn.match(/^tradgard-(\d{4}-\d{2}-\d{2})\.json$/);
    if (match && new Date(`${match[1]}T00:00:00Z`).getTime() < gransTid) {
      await unlink(join(BACKUP_DIR, namn)).catch(() => {});
    }
  }
}
// Utetemperaturen (SMHI) sparas i historiken under ett reserverat id, så den
// ligger sida vid sida med sensorserierna utan att vara en "enhet".
const UTE_SERIE = "__ute";

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
  const res = await fetch(url, { headers: { "User-Agent": "growarr (github.com/Growarr/growarr)" } });
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

// ---- Home Assistant automations ----
// Real automation logic (trigger, condition, action) already lives in Home
// Assistant - duplicating that here would just be a weaker copy of
// something that already works. Growarr's job is narrower: show which of
// your existing HA automations matter to the garden, let you flip them on
// or off without switching apps, and have Claude point out gaps in the
// data rather than pretend to author a new automation itself.
async function hamtaHaAutomationer() {
  if (!HA_TOKEN) return [];
  try {
    const res = await fetch(`${HA_URL}/api/states`, { headers: { Authorization: `Bearer ${HA_TOKEN}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return data
      .filter((s) => s.entity_id.startsWith("automation."))
      .map((s) => ({ entityId: s.entity_id, namn: s.attributes?.friendly_name || s.entity_id, pa: s.state === "on" }))
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
  } catch {
    return [];
  }
}
// The app's first WRITE to Home Assistant - everything else here only ever
// reads state. Deliberately narrow: one service call, the automation
// domain only, and only ever reachable for entity ids the caller already
// asked to toggle - never a generic "call any HA service" endpoint.
async function vaxlaHaAutomation(entityId, pa) {
  if (!HA_TOKEN) return { fel: "HA_TOKEN är inte konfigurerat" };
  if (!entityId?.startsWith("automation.")) return { fel: "ogiltig automation" };
  try {
    const res = await fetch(`${HA_URL}/api/services/automation/${pa ? "turn_on" : "turn_off"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId }),
    });
    if (!res.ok) return { fel: `HA svarade ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { fel: err.message };
  }
}

// Every entity_id anywhere inside a trigger/condition/action tree, however
// deeply nested (HA's schema allows entity_id as a string or a list, at any
// level). The single point every automation-writing path checks against
// the real entity list - nothing gets close to HA's config API otherwise.
function samlaEntitetIdI(varde, ut = new Set()) {
  if (Array.isArray(varde)) { for (const v of varde) samlaEntitetIdI(v, ut); }
  else if (varde && typeof varde === "object") {
    for (const [k, v] of Object.entries(varde)) {
      if (k === "entity_id") {
        if (typeof v === "string") ut.add(v);
        else if (Array.isArray(v)) for (const id of v) if (typeof id === "string") ut.add(id);
      }
      samlaEntitetIdI(v, ut);
    }
  }
  return ut;
}
// A minimal JSON-to-YAML renderer, display only - HA's config API takes
// JSON, so this never needs to parse YAML back, only show it. Good enough
// for the plain nested dicts/lists/strings an automation config actually is.
function yamlVarde(v) {
  if (typeof v !== "string") return String(v);
  return v === "" || /^[\s#>|@`"'%*&!?:,\[\]{}-]|[:#]\s|\s$/.test(v) ? JSON.stringify(v) : v;
}
function tillYaml(varde, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(varde)) {
    if (!varde.length) return `${pad}[]`;
    return varde.map((v) => {
      if (v && typeof v === "object") {
        const rader = tillYaml(v, indent + 1).split("\n");
        // A single-key object (e.g. { delay: "..." }) leaves nothing to
        // join in the "rest" - joining an empty array still produces "",
        // which would otherwise add a stray blank line after every item
        // that happens to be that short.
        const rest = rader.length > 1 ? `\n${rader.slice(1).join("\n")}` : "";
        return `${pad}- ${rader[0].trimStart()}${rest}`;
      }
      return `${pad}- ${yamlVarde(v)}`;
    }).join("\n");
  }
  if (varde && typeof varde === "object") {
    const nycklar = Object.entries(varde);
    if (!nycklar.length) return `${pad}{}`;
    return nycklar.map(([k, v]) => (v && typeof v === "object")
      ? `${pad}${k}:\n${tillYaml(v, indent + 1)}`
      : `${pad}${k}: ${yamlVarde(v)}`).join("\n");
  }
  return `${pad}${yamlVarde(varde)}`;
}

// ---- Claude drafts a Home Assistant automation from a plain description ----
// HA's own automation editor (visual and YAML) is already good - Growarr has
// no business rebuilding it. What Growarr actually knows that HA's editor
// doesn't is the garden itself, so this is scoped to drafting, not editing:
// Claude proposes trigger/condition/action from real, already-linked
// entities and Growarr's own exported metrics, the user reviews the plain-
// language explanation and the YAML, and only an explicit "create" writes
// anything to Home Assistant.
async function utkastAutomation(beskrivning) {
  if (!ANTHROPIC_API_KEY) return { fel: "ANTHROPIC_API_KEY är inte konfigurerad" };
  const [d, vader, allaEntiteter] = await Promise.all([lasData(), hamtaVader(), hamtaAllaEntiteter()]);
  const sprak = sprakNamn(d.installningar);
  // Scoped to entities that actually mean something to this garden, plus
  // Growarr's own exported sensors - never the household's whole HA
  // install, most of which has nothing to do with the garden.
  const kopplade = new Set(
    [...kopladeEnhetIder(d)].map((id) => d.enheter.find((e) => e.id === id)?.entityId).filter(Boolean),
  );
  for (const zon of d.zoner.filter((z) => !z.foralderId)) kopplade.add(haMetrikEntitetId(zon.id));
  const relevanta = allaEntiteter.filter((e) => kopplade.has(e.entityId));
  const entitetText = relevanta.map((e) => `- entity_id: ${e.entityId} | namn: ${e.namn}`).join("\n");
  try {
    const sammanfattning = await byggTradgardsSammanfattning(d, vader);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Du hjälper till att skriva ett utkast till en Home Assistant-automation utifrån en beskrivning på ${sprak}.

Beskrivning: "${beskrivning}"

Regler, viktigast:
- Använd ENDAST entity_id från listan nedan. Hitta ALDRIG på en entitet.
- Om beskrivningen kräver något (t.ex. en ventil) som inte finns i listan: svara med exakt {"fel":"kort förklaring på ${sprak} av vad som saknas"} och inget annat.
- Bygg "trigger", "condition" och "action" enligt Home Assistants eget automationsschema (samma struktur som i HA:s YAML, fast som JSON-objekt/listor).
- "alias" är en kort titel på ${sprak}. "forklaring" är 1-2 meningar på ${sprak} som beskriver vad automationen gör, för någon som inte läser JSON.
- "mode" är "single" om du inte har skäl att välja annat.

Tillgängliga entiteter:
${entitetText || "(inga kopplade entiteter eller exporterade mätvärden ännu)"}

Trädgården:
${sammanfattning}

Svara ENDAST med kompakt JSON: {"alias":"...","forklaring":"...","trigger":[...],"condition":[...],"action":[...],"mode":"single"}`,
        }],
      }),
    });
    if (!res.ok) return { fel: `Claude svarade ${res.status}` };
    const data = await res.json();
    if (data.stop_reason === "refusal") return { fel: "Claude avböjde" };
    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const parsed = JSON.parse((text ?? "").replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, ""));
    if (parsed.fel) return { fel: String(parsed.fel).slice(0, 300) };
    if (!parsed.alias || !Array.isArray(parsed.trigger) || !Array.isArray(parsed.action)) {
      return { fel: "Claude svarade ofullständigt" };
    }
    // Hard validation: an invented entity_id would otherwise silently fail,
    // or worse, resolve against the wrong real device, once created in HA.
    const giltiga = new Set(relevanta.map((e) => e.entityId));
    const anvanda = samlaEntitetIdI({ trigger: parsed.trigger, condition: parsed.condition ?? [], action: parsed.action });
    const pahittade = [...anvanda].filter((id) => !giltiga.has(id));
    if (pahittade.length) return { fel: `Använde okända entiteter: ${pahittade.join(", ")}` };
    const konfig = {
      alias: String(parsed.alias).slice(0, 100),
      trigger: parsed.trigger, condition: Array.isArray(parsed.condition) ? parsed.condition : [], action: parsed.action,
      mode: ["single", "restart", "queued", "parallel"].includes(parsed.mode) ? parsed.mode : "single",
    };
    return { ...konfig, forklaring: typeof parsed.forklaring === "string" ? parsed.forklaring.slice(0, 400) : "", yaml: tillYaml(konfig) };
  } catch (err) {
    return { fel: err.message };
  }
}
// The object_id half of an automation's entity_id is the same string HA's
// config API stores it under - see the note on skapaHaAutomation.
function haAutomationObjektId(entityId) {
  return entityId?.startsWith("automation.") ? entityId.slice("automation.".length) : null;
}
async function hamtaHaAutomationKonfig(entityId) {
  if (!HA_TOKEN) return { fel: "HA_TOKEN är inte konfigurerat" };
  const objektId = haAutomationObjektId(entityId);
  if (!objektId) return { fel: "ogiltig automation" };
  try {
    const res = await fetch(`${HA_URL}/api/config/automation/config/${objektId}`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    if (res.status === 404) return { fel: "hittade ingen redigerbar konfiguration för den automationen i Home Assistant" };
    if (!res.ok) return { fel: `HA svarade ${res.status}` };
    return await res.json();
  } catch (err) {
    return { fel: err.message };
  }
}
// Same shape and validation as utkastAutomation(), but starting from an
// existing automation's real config instead of a blank page - Claude edits
// only what the description asks for, rather than redrafting the whole
// thing from scratch and risking silently dropping something the user
// never asked to change.
async function revideraAutomation(entityId, beskrivning) {
  if (!ANTHROPIC_API_KEY) return { fel: "ANTHROPIC_API_KEY är inte konfigurerad" };
  const befintlig = await hamtaHaAutomationKonfig(entityId);
  if (befintlig.fel) return befintlig;
  const [d, vader, allaEntiteter] = await Promise.all([lasData(), hamtaVader(), hamtaAllaEntiteter()]);
  const sprak = sprakNamn(d.installningar);
  const kopplade = new Set(
    [...kopladeEnhetIder(d)].map((id) => d.enheter.find((e) => e.id === id)?.entityId).filter(Boolean),
  );
  for (const zon of d.zoner.filter((z) => !z.foralderId)) kopplade.add(haMetrikEntitetId(zon.id));
  // The automation's own current entities must stay selectable even if they
  // fall outside "garden-linked" (e.g. it already used a switch nobody has
  // told Growarr about) - otherwise editing it would flag its own existing
  // config as using "unknown" entities.
  for (const id of samlaEntitetIdI(befintlig)) kopplade.add(id);
  const relevanta = allaEntiteter.filter((e) => kopplade.has(e.entityId));
  const entitetText = relevanta.map((e) => `- entity_id: ${e.entityId} | namn: ${e.namn}`).join("\n");
  try {
    const sammanfattning = await byggTradgardsSammanfattning(d, vader);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Du hjälper till att ändra en befintlig Home Assistant-automation utifrån en beskrivning på ${sprak}.

Befintlig automation:
${JSON.stringify({ alias: befintlig.alias, trigger: befintlig.trigger, condition: befintlig.condition ?? [], action: befintlig.action, mode: befintlig.mode })}

Önskad ändring: "${beskrivning}"

Regler, viktigast:
- Ändra ENDAST det beskrivningen faktiskt kräver. Behåll allt annat i den befintliga automationen oförändrat.
- Använd ENDAST entity_id från listan nedan. Hitta ALDRIG på en entitet.
- Om ändringen kräver något som inte finns i listan: svara med exakt {"fel":"kort förklaring på ${sprak} av vad som saknas"} och inget annat.
- "forklaring" är 1-2 meningar på ${sprak} som beskriver vad automationen gör EFTER ändringen.

Tillgängliga entiteter:
${entitetText}

Trädgården:
${sammanfattning}

Svara ENDAST med kompakt JSON: {"alias":"...","forklaring":"...","trigger":[...],"condition":[...],"action":[...],"mode":"single"}`,
        }],
      }),
    });
    if (!res.ok) return { fel: `Claude svarade ${res.status}` };
    const data = await res.json();
    if (data.stop_reason === "refusal") return { fel: "Claude avböjde" };
    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const parsed = JSON.parse((text ?? "").replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, ""));
    if (parsed.fel) return { fel: String(parsed.fel).slice(0, 300) };
    if (!parsed.alias || !Array.isArray(parsed.trigger) || !Array.isArray(parsed.action)) {
      return { fel: "Claude svarade ofullständigt" };
    }
    const giltiga = new Set(relevanta.map((e) => e.entityId));
    const anvanda = samlaEntitetIdI({ trigger: parsed.trigger, condition: parsed.condition ?? [], action: parsed.action });
    const pahittade = [...anvanda].filter((id) => !giltiga.has(id));
    if (pahittade.length) return { fel: `Använde okända entiteter: ${pahittade.join(", ")}` };
    const konfig = {
      alias: String(parsed.alias).slice(0, 100),
      trigger: parsed.trigger, condition: Array.isArray(parsed.condition) ? parsed.condition : [], action: parsed.action,
      mode: ["single", "restart", "queued", "parallel"].includes(parsed.mode) ? parsed.mode : "single",
    };
    return {
      ...konfig, entityId,
      forklaring: typeof parsed.forklaring === "string" ? parsed.forklaring.slice(0, 400) : "",
      yaml: tillYaml(konfig),
    };
  } catch (err) {
    return { fel: err.message };
  }
}
// The only path that actually writes to Home Assistant's automation config.
// Re-validates independently of utkastAutomation()/revideraAutomation():
// never trust a client-echoed config, since this is the step with a real,
// permanent side effect.
// entityId (optional) means "overwrite this existing automation in place"
// rather than create a new one - the object_id half of an automation's
// entity_id is the same string the config API stores it under, in every
// normal Home Assistant install (this app never renames one, so the two
// never drift apart for anything Growarr itself created or has touched).
async function skapaHaAutomation({ alias, trigger, condition, action, mode, entityId }) {
  if (!HA_TOKEN) return { fel: "HA_TOKEN är inte konfigurerat" };
  const giltiga = new Set((await hamtaAllaEntiteter()).map((e) => e.entityId));
  const anvanda = samlaEntitetIdI({ trigger, condition, action });
  const pahittade = [...anvanda].filter((id) => !giltiga.has(id));
  if (pahittade.length) return { fel: `Okända entiteter: ${pahittade.join(", ")}` };
  const arNy = !entityId;
  const id = entityId?.startsWith("automation.") ? entityId.slice("automation.".length) : `growarr_${Date.now()}`;
  try {
    const konfig = { alias, trigger, condition: condition ?? [], action, mode: mode || "single" };
    // Entity-id validation catches Claude inventing a device, but not
    // Claude getting the logic subtly wrong on a real one (the wrong
    // comparison, a threshold the user didn't mean). A brand new automation
    // therefore lands OFF: nothing can fire until the user makes a second,
    // separate decision to flip it on with the toggle that already exists
    // for exactly this. Revising an automation that was already running
    // does not touch its current on/off state.
    if (arNy) konfig.initial_state = false;
    const res = await fetch(`${HA_URL}/api/config/automation/config/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(konfig),
    });
    if (!res.ok) return { fel: `HA svarade ${res.status}` };
    // Config API writes the file but doesn't apply it - without this the
    // automation exists on disk but HA keeps running the old set until its
    // own next restart.
    await fetch(`${HA_URL}/api/services/automation/reload`, {
      method: "POST", headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" }, body: "{}",
    }).catch(() => {});
    return { ok: true, entityId: `automation.${id}`, avstangdTillsVidare: arNy };
  } catch (err) {
    return { fel: err.message };
  }
}

// ---- Smart bevattningsinsikt (Claude) ----
// Ger Claude en sammanfattning av trädgården (zoner, odlingar, kopplade
// sensorers senaste värden, väderprognos) och ber om en kort, konkret
// bevattningsrekommendation. Cachas i timmar för att hålla kostnaden
// försumbar – väder och jordfuktighet ändras inte minut för minut.
let bevattningCache = null; // { tid, sprak, resultat }
const BEVATTNING_CACHE_MS = 4 * 3600 * 1000;
const ZON_TYPER_NAMN = { vaxthus: "växthus", utomhus: "utomhusbädd", inomhus: "inomhus", odlingslada: "odlingslåda", annat: "annat" };

// The language toggle in the panel is per-device (localStorage), but Claude's
// generated text (watering insight, notification wording, schedule reasons,
// chat replies) is written once and shared by whoever reads it - there is no
// per-viewer version of a cached recommendation. So it follows whichever
// language was last explicitly chosen via the Settings toggle, stored here
// rather than per-browser. Defaults to Swedish, not the UI's own English
// default: this app has been running in Swedish daily for its actual users,
// and upgrading should not silently switch their AI text to English under
// them just because nobody has touched the toggle since this shipped.
function sprakNamn(installningar) {
  return installningar?.sprak === "en" ? "English" : "Svenska";
}

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
  try {
    const [d, vader] = await Promise.all([lasData(), hamtaVader()]);
    const sprak = sprakNamn(d.installningar);
    if (bevattningCache && bevattningCache.sprak === sprak && Date.now() - bevattningCache.tid < BEVATTNING_CACHE_MS) {
      return bevattningCache.resultat;
    }
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
          content: `Du är en erfaren trädgårdsrådgivare. Ge en kort (max 3 meningar), konkret bevattningsrekommendation på ${sprak} utifrån datan nedan. Nämn specifika zoner eller odlingar vid namn om något sticker ut (torr jord, ingen nederbörd väntad, en sensor som visar lågt värde). Ingen inledande hälsningsfras, gå rakt på sak.\n\n${sammanfattning}`,
        }],
      }),
    });
    if (!res.ok) return { text: null, fel: `Claude svarade ${res.status}` };
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) return { text: null, fel: "Tomt svar från Claude" };
    const resultat = { text, tid: new Date().toISOString() };
    bevattningCache = { tid: Date.now(), sprak, resultat };
    return resultat;
  } catch (err) {
    return { text: null, fel: err.message };
  }
}

// ---- AI-optimerade notiser (Claude) ----
// Panelen räknar fram regelbaserade kandidatnotiser (frostrisk, torr jord,
// skördepåminnelser, sensorfel) och skickar dem hit. Claude får samma
// trädgårdssammanfattning som bevattningsinsikten och ombeds bara PRIORITERA,
// SLÅ IHOP närbesläktade och SKRIVA OM texten mer konkret – aldrig hitta på
// nya notiser. Id:t på varje kandidat är facit: allt Claude svarar med som
// inte matchar ett redan skickat id kasseras, så ett påhitt aldrig kan bli en
// falsk varning i panelen. Cachas per uppsättning kandidat-id:n så en
// oförändrad lista inte kostar ett nytt anrop vid varje sidladdning.
let notiserAiCache = null; // { nyckel, tid, resultat }
const NOTISER_AI_CACHE_MS = 3 * 3600 * 1000;

async function hamtaAiNotiser(kandidater) {
  if (!ANTHROPIC_API_KEY) return { fel: "ANTHROPIC_API_KEY är inte konfigurerad", notiser: kandidater };
  if (!Array.isArray(kandidater) || !kandidater.length) return { notiser: [] };
  try {
    const [d, vader] = await Promise.all([lasData(), hamtaVader()]);
    const sprak = sprakNamn(d.installningar);
    const nyckel = `${sprak}|${kandidater.map((k) => k.id).sort().join(",")}`;
    if (notiserAiCache && notiserAiCache.nyckel === nyckel && Date.now() - notiserAiCache.tid < NOTISER_AI_CACHE_MS) {
      return notiserAiCache.resultat;
    }
    const sammanfattning = await byggTradgardsSammanfattning(d, vader);
    const kandidatText = kandidater.map((k) => `- id: ${k.id} | titel: ${k.titel} | text: ${k.text} | nivå: ${k.niva}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Du hjälper till att förbättra notiser i en trädgårdsapp. Nedan är dagens regelbaserade kandidatnotiser och en sammanfattning av trädgården.

Uppgift:
1. Sortera dem efter faktisk angelägenhet för DEN HÄR trädgården (t.ex. väger frostrisk för känsliga plantor tyngre än lätt torr jord i en tålig sort).
2. Om två eller fler kandidater egentligen beskriver samma underliggande problem (t.ex. flera "kallt"-varningar samma natt), slå ihop dem till en – behåll första kandidatens id, nämn alla berörda platser i texten.
3. Skriv om "text" till en kort, konkret, specifik mening (max ~20 ord, på ${sprak}) som väger in sammanfattningen nedan.

Regler, viktigast: Hitta ALDRIG på mätvärden, platser eller fakta som inte står i kandidaterna eller sammanfattningen. Lägg ALDRIG till en notis utöver kandidaterna – bara sortera, slå ihop och skriv om. Varje id i ditt svar måste vara ett id som redan finns bland kandidaterna.

Svara ENDAST med kompakt JSON, inget annat: {"notiser":[{"id":"...","titel":"...","text":"..."}]}

Kandidater:
${kandidatText}

Trädgården:
${sammanfattning}`,
        }],
      }),
    });
    if (!res.ok) return { fel: `Claude svarade ${res.status}`, notiser: kandidater };
    const data = await res.json();
    if (data.stop_reason === "refusal") return { fel: "Claude avböjde", notiser: kandidater };
    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const utanKodblock = text?.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(utanKodblock ?? "");
    const giltiga = new Map(kandidater.map((k) => [k.id, k]));
    const sedda = new Set();
    const rensat = [];
    for (const n of parsed.notiser ?? []) {
      const orig = giltiga.get(n?.id);
      if (!orig || sedda.has(orig.id)) continue; // påhittat eller redan använt id – kasseras
      sedda.add(orig.id);
      rensat.push({ ...orig, titel: typeof n.titel === "string" && n.titel ? n.titel : orig.titel,
        text: typeof n.text === "string" && n.text ? n.text : orig.text });
    }
    // Missade Claude en kandidat i sitt svar tas den med sist i original-
    // form, hellre än att en riktig notis tyst försvinner ur listan.
    for (const k of kandidater) if (!sedda.has(k.id)) rensat.push(k);
    const resultat = { notiser: rensat, viaAi: true };
    notiserAiCache = { nyckel, tid: Date.now(), resultat };
    return resultat;
  } catch (err) {
    return { fel: err.message, notiser: kandidater };
  }
}

// ---- Watering schedule suggestions ----
// Deliberately split in two halves:
//
//   1. Plain arithmetic finds the candidates. For every zone with a moisture
//      sensor we fit a trend line through the logged history, work out how
//      fast it is drying, and from that how many days are left before it
//      crosses the "too dry" mark. That is a slope calculation, not
//      something that needs a language model, and doing it locally means
//      suggestions still work with no API key at all.
//
//   2. Claude only rewrites the wording. It gets the numbers we already
//      computed and turns them into one readable sentence, and may adjust
//      the interval if the forecast or the plants motivate it. It can never
//      introduce a zone or an interval we did not derive from the data.
//
// Suggestions are never saved; they show up in the Schedule view until you
// add or dismiss them.
//
// The cache is keyed on actual garden state (zones, existing schedules,
// volume of history) rather than just elapsed time, so fresh measurements
// produce fresh suggestions instead of one stale answer.
let schemaAiCache = null; // { nyckel, tid, resultat }
const SCHEMA_AI_CACHE_MS = 6 * 3600 * 1000;
const VECKODAG_NAMN = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
// TORR_GRANS, MIN_LUTNING, torkTakt, veckodagarForIntervall, enhetArFuktsensor: see src/logic.js

// The arithmetic core: is this one zone drying out, and how fast? Shared by
// the schedule suggestions (which skip zones already scheduled) and the HA
// sensor export (which does not - the real-world number is worth exposing
// either way, a schedule existing in Growarr doesn't make it stale).
function raknaFuktMetrikForZon(zon, d) {
  for (const enhetId of zon.enhetIds ?? []) {
    const enhet = d.enheter.find((e) => e.id === enhetId);
    if (!enhet || !enhetArFuktsensor(enhet)) continue;
    const punkter = (d.historik ?? [])
      .filter((p) => p.enhetId === enhetId)
      .sort((a, b) => new Date(a.tid) - new Date(b.tid));
    const lutning = torkTakt(punkter);
    if (lutning == null || lutning > -MIN_LUTNING) continue; // flat, or getting wetter
    const nu = Number(punkter[punkter.length - 1].varde);
    // Already below the dry mark is no reason to skip: that is exactly when
    // a schedule is wanted. dagarTillTorrt clamps to 1 in that case.
    if (!Number.isFinite(nu)) continue;
    const takt = Math.abs(lutning);
    const dagarTillTorrt = Math.max(1, Math.round((nu - TORR_GRANS) / takt));
    const intervall = Math.min(7, Math.max(1, dagarTillTorrt));
    return {
      zonId: zon.id, zonNamn: zon.namn, veckodagar: veckodagarForIntervall(intervall),
      // Everything Claude is allowed to mention is measured, never guessed.
      // Math.max(0): a glitching sensor should never print a negative %.
      matt: { nu: Math.max(0, Math.round(nu)), taktPerDygn: Math.round(takt * 10) / 10, dagarTillTorrt, intervall, sensor: enhet.namn },
    };
  }
  return null; // one metric per zone is enough; no qualifying sensor found
}
function raknaSchemaKandidater(d) {
  const harSchema = new Set((d.scheman ?? []).map((s) => s.zonId));
  const kandidater = [];
  for (const zon of d.zoner.filter((z) => !z.foralderId)) {
    if (harSchema.has(zon.id)) continue; // already scheduled, leave it alone
    const m = raknaFuktMetrikForZon(zon, d);
    if (m) kandidater.push(m);
  }
  return kandidater;
}
// Every zone with a valid trend, schedule or not - used to keep the HA
// sensor export current regardless of Growarr's own reminder state.
function raknaAllaFuktMetriker(d) {
  return d.zoner.filter((z) => !z.foralderId).map((zon) => raknaFuktMetrikForZon(zon, d)).filter(Boolean);
}

// ---- Push Growarr's own computed numbers back into Home Assistant ----
// HA's own automation editor is already good - the missing piece is that it
// has nothing garden-aware to trigger on. Each zone with a valid drying
// trend gets a real sensor entity in HA (same trend line the schedule
// suggestions already use), so any automation built in HA's own UI, visual
// or YAML, can react to it exactly like a real sensor.
function haMetrikEntitetId(zonId) {
  const rensat = String(zonId).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `sensor.growarr_${rensat}_dagar_till_torrt`;
}
async function synkaMetrikerTillHa() {
  if (!HA_TOKEN) return { synkade: 0, fel: "HA_TOKEN är inte konfigurerat" };
  const d = await lasData();
  const metriker = raknaAllaFuktMetriker(d);
  let synkade = 0;
  for (const m of metriker) {
    try {
      const res = await fetch(`${HA_URL}/api/states/${encodeURIComponent(haMetrikEntitetId(m.zonId))}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          state: m.matt.dagarTillTorrt,
          attributes: {
            friendly_name: `${m.zonNamn} – dagar till torrt`,
            unit_of_measurement: "d", icon: "mdi:water-alert-outline",
            jordfuktighet_procent: m.matt.nu, torkar_procent_per_dygn: m.matt.taktPerDygn,
          },
        }),
      });
      if (res.ok) synkade++;
    } catch { /* best effort - try again next cycle rather than fail the whole sync */ }
  }
  return { synkade, totalt: metriker.length };
}

// Plain-language fallback used when there is no API key, or the call fails.
// Same numbers, just phrased by us instead of by Claude.
function enkelMotivering(k, sprak = "Svenska") {
  const { nu, taktPerDygn, dagarTillTorrt } = k.matt;
  if (sprak === "English") return `Soil moisture is at ${nu}% and dropping about ${taktPerDygn}%/day, so dry in roughly ${dagarTillTorrt} days.`;
  return `Jordfuktigheten ligger på ${nu} % och sjunker ca ${taktPerDygn} %/dygn, alltså torr om ungefär ${dagarTillTorrt} dygn.`;
}

async function hamtaAiSchemaforslag() {
  const [d, vader] = await Promise.all([lasData(), hamtaVader()]);
  const fristaende = d.zoner.filter((z) => !z.foralderId);
  if (!fristaende.length) return { forslag: [] };

  const sprak = sprakNamn(d.installningar);
  const nyckel = [
    sprak,
    fristaende.map((z) => z.id).sort().join(","),
    (d.scheman ?? []).map((s) => `${s.zonId}:${s.veckodagar.join("")}`).sort().join(","),
    // Coarse history size: recompute once meaningfully more data has arrived,
    // not on every single logged measurement.
    Math.floor((d.historik ?? []).length / 24),
  ].join("|");
  if (schemaAiCache && schemaAiCache.nyckel === nyckel && Date.now() - schemaAiCache.tid < SCHEMA_AI_CACHE_MS) {
    return schemaAiCache.resultat;
  }

  const kandidater = raknaSchemaKandidater(d);
  if (!kandidater.length) {
    const tomt = { forslag: [] };
    schemaAiCache = { nyckel, tid: Date.now(), resultat: tomt };
    return tomt;
  }
  // Works with no API key at all: the measured candidates stand on their own.
  const utanAi = {
    forslag: kandidater.map((k) => ({ zonId: k.zonId, zonNamn: k.zonNamn, veckodagar: k.veckodagar, motivering: enkelMotivering(k, sprak) })),
  };
  if (!ANTHROPIC_API_KEY) {
    schemaAiCache = { nyckel, tid: Date.now(), resultat: utanAi };
    return utanAi;
  }

  try {
    const sammanfattning = await byggTradgardsSammanfattning(d, vader);
    const kandidatText = kandidater.map((k) =>
      `- zonId: ${k.zonId} | zon: ${k.zonNamn} | sensor: ${k.matt.sensor} | nu: ${k.matt.nu} % | torkar: ${k.matt.taktPerDygn} %/dygn | torr om: ${k.matt.dagarTillTorrt} dygn | intervall: var ${k.matt.intervall}:e dygn | veckodagar: [${k.veckodagar.join(",")}]`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        messages: [{
          role: "user",
          content: `Du hjälper till att formulera bevattningsförslag i en trädgårdsapp. Uträkningarna är redan gjorda – din uppgift är att skriva om dem till begriplig text, och bara justera intervallet om väder eller växtval tydligt motiverar det.

Uppgift per kandidat:
1. Skriv en "motivering": EN kort mening på ${sprak} (max ~20 ord) som förklarar varför, byggd på siffrorna nedan. Nämn gärna den faktiska mätningen.
2. Behåll "veckodagar" som de är om du inte har ett tydligt skäl att ändra, t.ex. mycket regn i prognosen (glesare) eller värmebölja i ett växthus (tätare).

Regler, viktigast: Hitta ALDRIG på mätvärden – använd bara siffrorna nedan. Lägg ALDRIG till en kandidat; svaret ska innehålla exakt de zonId som listas. veckodagar är siffror, 0 = söndag ... 6 = lördag.

Svara ENDAST med kompakt JSON: {"forslag":[{"zonId":"...","veckodagar":[1,4],"motivering":"..."}]}

Kandidater (uträknade ur mätdatan):
${kandidatText}

Trädgården:
${sammanfattning}`,
        }],
      }),
    });
    if (!res.ok) return utanAi;
    const data = await res.json();
    if (data.stop_reason === "refusal") return utanAi;
    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const parsed = JSON.parse((text ?? "").replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, ""));
    // Hard validation, same principle as the AI notifications: our computed
    // candidate list is the source of truth. A zone we did not derive cannot
    // appear, and anything Claude omits falls back to our own wording rather
    // than silently vanishing.
    const giltiga = new Map(kandidater.map((k) => [k.zonId, k]));
    const sedda = new Set();
    const forslag = [];
    for (const f of parsed.forslag ?? []) {
      const k = giltiga.get(f?.zonId);
      if (!k || sedda.has(k.zonId)) continue;
      sedda.add(k.zonId);
      const dagar = [...new Set((Array.isArray(f.veckodagar) ? f.veckodagar : []).map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
      forslag.push({
        zonId: k.zonId, zonNamn: k.zonNamn,
        veckodagar: dagar.length ? dagar : k.veckodagar,
        motivering: typeof f.motivering === "string" && f.motivering ? f.motivering.slice(0, 200) : enkelMotivering(k, sprak),
      });
    }
    for (const k of kandidater) {
      if (!sedda.has(k.zonId)) forslag.push({ zonId: k.zonId, zonNamn: k.zonNamn, veckodagar: k.veckodagar, motivering: enkelMotivering(k, sprak) });
    }
    const resultat = { forslag, viaAi: true };
    schemaAiCache = { nyckel, tid: Date.now(), resultat };
    return resultat;
  } catch {
    return utanAi;
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
        system: `Du är en kunnig och konkret trädgårdsrådgivare som hjälper ett par med sin odling. Svara på ${sprakNamn(d.installningar)}, kort och praktiskt – hellre två träffsäkra stycken än en lång uppsats.

Om användaren bifogar ett foto: beskriv först kort vad du faktiskt ser på plantan (färg, fläckar, form, jord), och koppla sedan ihop det med mätdatan nedan om den är relevant. Var tydlig med vad som är säkert och vad som är en gissning – hitta aldrig på mätvärden som inte står här.

Om frågan handlar om sensorer, enheter eller automationer i Home Assistant: utgå bara från det som faktiskt är kopplat och listat nedan – hitta aldrig på en entitet, ett device eller en automation som inte står här. Vill användaren sätta upp eller ändra en riktig automation, beskriv den inte själv i löptext – hänvisa till "Bygg en ny automation" under Schema, som skriver ett utkast från de faktiska kopplade enheterna och aldrig skapar något i Home Assistant förrän det bekräftats.

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
        headers: { "Content-Type": "application/json", "User-Agent": "growarr-bot/1.0 (+github.com/Growarr/growarr)" },
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
setInterval(() => backupData().catch((err) => console.warn("Säkerhetskopiering misslyckades:", err.message)), EN_DAG_MS);

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
// Same cadence as the history log: the trend line these depend on doesn't
// meaningfully change faster than the underlying sensor readings arrive.
synkaMetrikerTillHa().catch(() => {}); // once at startup, so a fresh restart doesn't wait an hour
setInterval(() => synkaMetrikerTillHa().catch((err) => console.warn("HA-metriksynk misslyckades:", err.message)), EN_TIMME_MS);

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

// ---- Login (optional - see APP_PASSWORD above) ----
// Comparing fixed-length SHA-256 digests of both sides with a timing-safe
// function, rather than the raw strings - a plain === leaks how many
// leading characters matched through response timing.
function losenordStammer(inskickat) {
  if (!APP_PASSWORD) return false;
  const a = createHash("sha256").update(String(inskickat ?? "")).digest();
  const b = createHash("sha256").update(APP_PASSWORD).digest();
  return timingSafeEqual(a, b);
}
const SESSION_COOKIE = "growarr_session";
const SESSION_GILTIG_MS = 90 * 24 * 3600 * 1000; // 90 dagar
// Signed with a secret derived from the password itself, so there's nothing
// extra to configure - and rotating the shared password automatically
// invalidates every existing session, which is exactly the behavior you
// want. No server-side session storage either: the cookie carries its own
// expiry and signature, so a login survives the container restarting (this
// app rebuilds and redeploys on every push to main - a session that didn't
// survive that would be useless).
function sessionHemlighet() {
  return createHash("sha256").update(`growarr-session:${APP_PASSWORD}`).digest();
}
function skapaSessionCookie() {
  const utgang = String(Date.now() + SESSION_GILTIG_MS);
  const sig = createHmac("sha256", sessionHemlighet()).update(utgang).digest("hex");
  return `${utgang}.${sig}`;
}
function giltigSessionCookie(varde) {
  if (!varde) return false;
  const [utgang, sig] = varde.split(".");
  if (!utgang || !sig || Number(utgang) < Date.now()) return false;
  const forvantad = createHmac("sha256", sessionHemlighet()).update(utgang).digest("hex");
  const a = Buffer.from(sig, "hex"), b = Buffer.from(forvantad, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function lasCookie(req, namn) {
  const rad = req.headers.cookie ?? "";
  const del = rad.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${namn}=`));
  return del ? decodeURIComponent(del.slice(namn.length + 1)) : null;
}

// A simple, process-global rate limit on the endpoints that call Claude.
// There's no login separating clients, so this caps the whole installation
// rather than any one person - the point is that an exposed port or a
// broken client can't run up the Anthropic bill, not to throttle a single
// household's normal use.
const requestWindows = new Map(); // name -> timestamps within the window
function withinRateLimit(name, max, windowMs) {
  const nu = Date.now();
  const tider = (requestWindows.get(name) ?? []).filter((t) => nu - t < windowMs);
  if (tider.length >= max) { requestWindows.set(name, tider); return false; }
  tider.push(nu);
  requestWindows.set(name, tider);
  return true;
}
const TOO_MANY_REQUESTS = { fel: "för många AI-förfrågningar just nu, försök igen om en stund" };

// Matchar på slutet av sökvägen – robust oavsett om reverse-proxyn framför
// strippar sitt prefix eller inte, samma mönster som i bostadsvakt-api och
// hushallsekonomi.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://intern");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  try {
    // The page itself (index.html, logo.png) is always reachable - it's
    // static markup with no secrets in it, and it has to load unauthenticated
    // for the login screen inside it to have something to render into. Only
    // the API is gated, and /api/login is its own necessary exception.
    if (APP_PASSWORD && p.includes("/api/") && !p.endsWith("/api/login")) {
      const betrodd = arBetroddAdress(normaliseraIp(req.socket.remoteAddress ?? ""), TRUSTED_NETWORKS);
      const inloggad = betrodd || giltigSessionCookie(lasCookie(req, SESSION_COOKIE));
      if (!inloggad) return skickaJson(res, 401, { fel: "inloggning krävs" });
    }
    if (req.method === "POST" && p.endsWith("/api/login")) {
      if (!withinRateLimit("login", 10, EN_TIMME_MS)) return skickaJson(res, 429, { fel: "för många inloggningsförsök, försök igen om en stund" });
      const { losenord } = await lasBody(req);
      if (!losenordStammer(losenord)) return skickaJson(res, 401, { fel: "fel lösenord" });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "Set-Cookie": `${SESSION_COOKIE}=${skapaSessionCookie()}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_GILTIG_MS / 1000)}; Path=/`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && p.endsWith("/api/logout")) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === "GET" && p.endsWith("/api/plantings")) {
      return skickaJson(res, 200, await lasData());
    }
    if (req.method === "POST" && p.endsWith("/api/plantings")) {
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
    if (req.method === "POST" && p.endsWith("/api/plantings/update")) {
      const { id, namn, planterad, skordFonster, skordManad, anteckning, jord, enhetIds, zonId, x, y, antal, layout } = await lasBody(req);
      const data = await muteraData((d) => {
        const o = d.odlingar.find((o2) => o2.id === id);
        if (!o) return;
        Object.assign(o, {
          planterad: planterad || "", skordFonster: skordFonster || "", skordManad: skordManad || "",
          anteckning: anteckning || "", jord: jord || "", enhetIds: enhetIds ?? [],
        });
        // Only touched when actually sent, and never blanked: several code
        // paths (dragging on the map, linking an entity) call this without a
        // name and must not wipe it.
        if (typeof namn === "string" && namn.trim()) o.namn = namn.trim().slice(0, 80);
        // Plantans plats i sin zon/sektion (0–1), satt genom att dra på kartan.
        if (zonId !== undefined) o.zonId = zonId || "";
        if (x !== undefined) o.x = x;
        if (y !== undefined) o.y = y;
        if (antal !== undefined) o.antal = rensaAntal(antal);
        if (layout !== undefined) o.layout = rensaLayout(layout);
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/plantings/delete")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.odlingar = d.odlingar.filter((o) => o.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/zones/update")) {
      const { id, namn, typ, jord, anteckning, enhetIds, x, y, foralderId, bredd, hojd, hojdM } = await lasBody(req);
      const data = await muteraData((d) => {
        const zon = d.zoner.find((z) => z.id === id);
        if (!zon) return;
        Object.assign(zon, {
          jord: jord || "", anteckning: anteckning || "", enhetIds: enhetIds ?? [],
          x: x ?? zon.x ?? 0.5, y: y ?? zon.y ?? 0.5,
        });
        // Only touched when actually sent, and never blanked: dragging a zone
        // on the map also calls this, without a name, and must not wipe it.
        if (typeof namn === "string" && namn.trim()) zon.namn = namn.trim().slice(0, 80);
        if (typ !== undefined && ZON_TYPER_NAMN[typ]) zon.typ = typ;
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
    if (req.method === "POST" && p.endsWith("/api/zones")) {
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
    if (req.method === "POST" && p.endsWith("/api/maps")) {
      const { namn } = await lasBody(req);
      if (!namn) return skickaJson(res, 400, { fel: "namn saknas" });
      const data = await muteraData((d) => { d.kartor.push({ id: randomUUID(), namn }); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/maps/delete")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => {
        d.kartor = d.kartor.filter((k) => k.id !== id);
        if (!d.kartor.length) d.kartor.push({ id: randomUUID(), namn: "Min trädgård" });
        // Zoner på den borttagna kartan flyttas till den första kvarvarande
        // istället för att bli osynliga.
        for (const z of d.zoner) if (z.kartaId === id) z.kartaId = d.kartor[0].id;
      });
      // Best effort: an orphaned background image is harmless, a failed
      // delete of the map itself would not be.
      unlink(join(KARTBILD_DIR, `${id}.jpg`)).catch(() => {});
      return skickaJson(res, 200, data);
    }
    // How a map draws its backdrop: "rutnat" (the default grid), "ren"
    // (flat, no grid) or "foto" (an uploaded aerial image).
    if (req.method === "POST" && p.endsWith("/api/maps/update")) {
      const { id, bakgrund, bildOpacitet, bildRotation, bildSkala, bildX, bildY } = await lasBody(req);
      // Clamped to the same ranges the sliders offer, so a hand-written API
      // call cannot push the photo somewhere it can never be dragged back from.
      const tal = (v, min, max, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
      };
      const data = await muteraData((d) => {
        const k = d.kartor.find((x) => x.id === id);
        if (!k) return;
        if (bakgrund !== undefined) k.bakgrund = ["ren", "foto"].includes(bakgrund) ? bakgrund : "rutnat";
        if (bildOpacitet !== undefined) k.bildOpacitet = tal(bildOpacitet, 10, 100, 60);
        if (bildRotation !== undefined) k.bildRotation = tal(bildRotation, -180, 180, 0);
        if (bildSkala !== undefined) k.bildSkala = tal(bildSkala, 20, 400, 100);
        if (bildX !== undefined) k.bildX = tal(bildX, -800, 800, 0);
        if (bildY !== undefined) k.bildY = tal(bildY, -800, 800, 0);
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/maps/image")) {
      const { id, data: bildData } = await lasBody(req);
      if (!id || typeof bildData !== "string") return skickaJson(res, 400, { fel: "id och data krävs" });
      const buffert = Buffer.from(bildData, "base64");
      // The panel already downscales before upload; this is just a backstop
      // against something else posting a huge file straight at the API.
      if (buffert.length > 8 * 1024 * 1024) return skickaJson(res, 413, { fel: "bilden är för stor" });
      await mkdir(KARTBILD_DIR, { recursive: true });
      await writeFile(join(KARTBILD_DIR, `${id}.jpg`), buffert);
      const uppdaterad = await muteraData((d) => {
        const k = d.kartor.find((x) => x.id === id);
        if (!k) return;
        k.harBild = true;
        k.bakgrund = "foto"; // uploading one obviously means you want to see it
        k.bildOpacitet = k.bildOpacitet ?? 60;
        k.bildVersion = Date.now(); // cache-buster for the <img> src
      });
      return skickaJson(res, 200, uppdaterad);
    }
    if (req.method === "POST" && p.endsWith("/api/maps/image/delete")) {
      const { id } = await lasBody(req);
      await unlink(join(KARTBILD_DIR, `${id}.jpg`)).catch(() => {});
      const data = await muteraData((d) => {
        const k = d.kartor.find((x) => x.id === id);
        if (!k) return;
        k.harBild = false;
        if (k.bakgrund === "foto") k.bakgrund = "rutnat";
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "GET" && p.endsWith("/api/map-image")) {
      const id = url.searchParams.get("kartaId") ?? "";
      // The id comes from the query string, so refuse anything that could
      // walk out of the images directory.
      if (!/^[A-Za-z0-9-]+$/.test(id)) return skickaJson(res, 400, { fel: "ogiltigt kartaId" });
      try {
        const bild = await readFile(join(KARTBILD_DIR, `${id}.jpg`));
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000" });
        return res.end(bild);
      } catch {
        return skickaJson(res, 404, { fel: "ingen bild för den kartan" });
      }
    }
    // Vattningsscheman: bara en lista veckodagar per zon - ingen faktisk
    // ventil/pump finns att styra än (se README:s Roadmap), så ett schema
    // ger en påminnelse i notiscentret på schemalagda dagar i stället för
    // att låtsas kunna vattna på riktigt.
    if (req.method === "POST" && p.endsWith("/api/schedules")) {
      const { zonId, veckodagar } = await lasBody(req);
      if (!zonId) return skickaJson(res, 400, { fel: "zonId saknas" });
      const dagar = Array.isArray(veckodagar) ? veckodagar.map(Number).filter((n) => n >= 0 && n <= 6) : [];
      if (!dagar.length) return skickaJson(res, 400, { fel: "minst en veckodag krävs" });
      const data = await muteraData((d) => {
        d.scheman.push({ id: randomUUID(), zonId, veckodagar: [...new Set(dagar)].sort() });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/schedules/delete")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.scheman = d.scheman.filter((s) => s.id !== id); });
      return skickaJson(res, 200, data);
    }
    // Full HA automation list plus which of them are already linked to the
    // garden, in one call - the picker in the panel needs both to render.
    if (req.method === "GET" && p.endsWith("/api/automations")) {
      const [d, alla] = await Promise.all([lasData(), hamtaHaAutomationer()]);
      const lankade = new Set(d.tradgardsAutomationer);
      return skickaJson(res, 200, alla.map((a) => ({ ...a, lankad: lankade.has(a.entityId) })));
    }
    if (req.method === "POST" && p.endsWith("/api/automations/link")) {
      const { entityId } = await lasBody(req);
      if (!entityId) return skickaJson(res, 400, { fel: "entityId saknas" });
      const data = await muteraData((d) => {
        if (!d.tradgardsAutomationer.includes(entityId)) d.tradgardsAutomationer.push(entityId);
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/automations/unlink")) {
      const { entityId } = await lasBody(req);
      const data = await muteraData((d) => {
        d.tradgardsAutomationer = d.tradgardsAutomationer.filter((id) => id !== entityId);
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/automations/toggle")) {
      const { entityId, pa } = await lasBody(req);
      const d = await lasData();
      if (!d.tradgardsAutomationer.includes(entityId)) return skickaJson(res, 400, { fel: "automationen är inte kopplad till trädgården" });
      const resultat = await vaxlaHaAutomation(entityId, !!pa);
      if (resultat.fel) return skickaJson(res, 502, resultat);
      return skickaJson(res, 200, resultat);
    }
    // Force the HA sensor export to run now, instead of waiting for the
    // hourly timer - used after linking a new sensor so it shows up in HA
    // without a wait.
    if (req.method === "POST" && p.endsWith("/api/metrics/sync")) {
      return skickaJson(res, 200, await synkaMetrikerTillHa());
    }
    // Draft only - nothing is written to Home Assistant until /create.
    if (req.method === "POST" && p.endsWith("/api/automations/draft")) {
      if (!withinRateLimit("automationer", 15, EN_TIMME_MS)) return skickaJson(res, 429, TOO_MANY_REQUESTS);
      const { beskrivning } = await lasBody(req);
      if (!beskrivning?.trim()) return skickaJson(res, 400, { fel: "beskrivning saknas" });
      const resultat = await utkastAutomation(beskrivning.trim());
      return skickaJson(res, resultat.fel ? 502 : 200, resultat);
    }
    // Same idea, but starting from an automation that already exists -
    // "make it wait 10 minutes instead of 5" edits the real config rather
    // than drafting a brand new automation from nothing.
    if (req.method === "POST" && p.endsWith("/api/automations/revise")) {
      if (!withinRateLimit("automationer", 15, EN_TIMME_MS)) return skickaJson(res, 429, TOO_MANY_REQUESTS);
      const { entityId, beskrivning } = await lasBody(req);
      if (!entityId || !beskrivning?.trim()) return skickaJson(res, 400, { fel: "entityId och beskrivning krävs" });
      const resultat = await revideraAutomation(entityId, beskrivning.trim());
      return skickaJson(res, resultat.fel ? 502 : 200, resultat);
    }
    if (req.method === "POST" && p.endsWith("/api/automations/create")) {
      const { alias, trigger, condition, action, mode, entityId } = await lasBody(req);
      if (!alias || !Array.isArray(trigger) || !Array.isArray(action)) return skickaJson(res, 400, { fel: "ofullständig automation" });
      const resultat = await skapaHaAutomation({ alias, trigger, condition, action, mode, entityId });
      if (resultat.fel) return skickaJson(res, 502, resultat);
      return skickaJson(res, 200, resultat);
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
    if (req.method === "POST" && p.endsWith("/api/widgets/update")) {
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
    if (req.method === "POST" && p.endsWith("/api/widgets/reorder")) {
      const { ids } = await lasBody(req);
      const data = await muteraData((d) => {
        const perId = new Map(d.widgets.map((w) => [w.id, w]));
        const ordnade = (ids ?? []).map((id) => perId.get(id)).filter(Boolean);
        const kvar = d.widgets.filter((w) => !(ids ?? []).includes(w.id));
        d.widgets = [...ordnade, ...kvar];
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/widgets/delete")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.widgets = d.widgets.filter((w) => w.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "GET" && p.endsWith("/api/camera")) {
      const entityId = url.searchParams.get("entityId") || "";
      // Without this check, any camera. entity_id in the whole HA install
      // could be requested here, not just ones actually shown in the panel
      // (as a linked device or a camera widget) - same principle as the
      // automation endpoints never trusting an unchecked entity_id.
      const { enheter, widgets } = await lasData();
      const kopplad = enheter.some((e) => e.entityId === entityId) || widgets.some((w) => w.typ === "kamera" && w.entityId === entityId);
      if (!kopplad) return skickaJson(res, 403, { fel: "den kameran är inte kopplad i panelen" });
      const bild = await hamtaKamerabild(entityId);
      if (!bild) return skickaJson(res, 404, { fel: "kunde inte hämta kamerabild" });
      res.writeHead(200, { "Content-Type": bild.typ, "Cache-Control": "no-store" });
      return res.end(bild.data);
    }
    if (req.method === "POST" && p.endsWith("/api/zones/delete")) {
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
    if (req.method === "POST" && p.endsWith("/api/devices")) {
      const { entityId, namn } = await lasBody(req);
      if (!entityId) return skickaJson(res, 400, { fel: "entityId saknas" });
      const data = await muteraData((d) => {
        d.enheter.push({ id: randomUUID(), entityId, namn: namn || entityId });
      });
      return skickaJson(res, 200, data);
    }
    if (req.method === "POST" && p.endsWith("/api/devices/delete")) {
      const { id } = await lasBody(req);
      const data = await muteraData((d) => { d.enheter = d.enheter.filter((e) => e.id !== id); });
      return skickaJson(res, 200, data);
    }
    if (req.method === "GET" && p.endsWith("/api/ha-entities")) {
      return skickaJson(res, 200, await hamtaAllaEntiteter());
    }
    if (req.method === "GET" && p.endsWith("/api/devices/status")) {
      const { enheter } = await lasData();
      const status = await Promise.all(enheter.map(async (e) => ({ ...e, ...(await hamtaEntitetStatus(e.entityId)) })));
      return skickaJson(res, 200, status);
    }
    if (req.method === "GET" && p.endsWith("/api/version")) {
      return skickaJson(res, 200, { version: APP_VERSION, senasteVersion: await hamtaSenasteVersion() });
    }
    if (req.method === "GET" && p.endsWith("/api/settings")) {
      const { installningar } = await lasData();
      return skickaJson(res, 200, installningar);
    }
    if (req.method === "POST" && p.endsWith("/api/settings")) {
      // Only touches fields actually sent, rather than rebuilding the whole
      // object each time - the language toggle posts just { sprak }, and
      // must not blank ntfyTopic/webhookUrl in the process (or vice versa).
      const { ntfyTopic, webhookUrl, norrGrader, kartaBreddM, sprak } = await lasBody(req);
      const data = await muteraData((d) => {
        const install = d.installningar ?? {};
        if (ntfyTopic !== undefined) install.ntfyTopic = ntfyTopic || "";
        if (webhookUrl !== undefined) install.webhookUrl = webhookUrl || "";
        // Kompassriktningen som pekar uppåt på kartan, och hur många meter
        // kartan är bred – tillsammans ger de skuggorna rätt håll och längd.
        if (norrGrader !== undefined) {
          const grader = Number(norrGrader);
          install.norrGrader = Number.isFinite(grader) ? ((grader % 360) + 360) % 360 : (install.norrGrader ?? 0);
        }
        if (kartaBreddM !== undefined) {
          const bredd = Number(kartaBreddM);
          install.kartaBreddM = Number.isFinite(bredd) && bredd > 0 ? Math.min(500, bredd) : (install.kartaBreddM ?? 20);
        }
        // Which language Claude writes generated text in - see sprakNamn().
        // Not the UI's own language, which is per-device via localStorage.
        if (sprak !== undefined) install.sprak = sprak === "en" ? "en" : "sv";
        d.installningar = install;
      });
      return skickaJson(res, 200, data.installningar);
    }
    if (req.method === "GET" && p.endsWith("/api/history")) {
      const { historik } = await lasData();
      return skickaJson(res, 200, historik);
    }
    // Notiscentret räknar fram själva listan i panelen (frostrisk, torr jord,
    // skördepåminnelser …) från data som redan finns – servern lagrar bara
    // VILKA notiser man redan hanterat, så de inte dyker upp igen. Id:t byggs
    // av panelen och innehåller redan datum för dagsaktuella notiser, så en
    // "avvisad idag"-notis kommer tillbaka av sig själv nästa dag om läget
    // fortfarande gäller då.
    if (req.method === "POST" && p.endsWith("/api/notifications")) {
      const { id, atgard } = await lasBody(req);
      if (!id) return skickaJson(res, 400, { fel: "id saknas" });
      const data = await muteraData((d) => {
        const gransTid = Date.now() - 45 * 24 * 3600 * 1000; // städa bort gamla poster
        d.notiser = (d.notiser ?? []).filter((n) => new Date(n.tid).getTime() >= gransTid && n.id !== id);
        d.notiser.push({ id, atgard: atgard === "klar" ? "klar" : "avvisad", tid: new Date().toISOString() });
      });
      return skickaJson(res, 200, data.notiser);
    }
    // AI-optimering av notiserna: panelen skickar sina regelbaserade
    // kandidater, Claude prioriterar/slår ihop/skriver om dem (se
    // hamtaAiNotiser). Faller tillbaka på kandidaterna oförändrade om
    // ANTHROPIC_API_KEY saknas eller anropet misslyckas.
    if (req.method === "POST" && p.endsWith("/api/notifications/ai")) {
      const { kandidater } = await lasBody(req);
      if (!withinRateLimit("notifikationer", 20, EN_TIMME_MS)) return skickaJson(res, 429, { ...TOO_MANY_REQUESTS, notiser: kandidater });
      return skickaJson(res, 200, await hamtaAiNotiser(kandidater));
    }
    if (req.method === "GET" && p.endsWith("/api/schedules/suggestions")) {
      return skickaJson(res, 200, await hamtaAiSchemaforslag());
    }
    if (req.method === "POST" && p.endsWith("/api/chat")) {
      if (!withinRateLimit("chat", 30, EN_TIMME_MS)) return skickaJson(res, 429, TOO_MANY_REQUESTS);
      const { meddelanden } = await lasBody(req);
      return skickaJson(res, 200, await svaraChatt(meddelanden));
    }
    if (req.method === "GET" && p.endsWith("/api/watering")) {
      return skickaJson(res, 200, await hamtaSmartBevattning());
    }
    if (req.method === "GET" && p.endsWith("/api/weather")) {
      return skickaJson(res, 200, await hamtaVader());
    }
    if (req.method === "GET" && p.endsWith("/logo.png")) {
      const png = await readFile(LOGO_PNG);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      return res.end(png);
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

server.listen(PORT, () => console.log(`growarr lyssnar på :${PORT}, data i ${DATA_PATH}`));
migreraData().catch((err) => console.warn("Migrering misslyckades:", err.message));
kollaSkordepaminnelser().catch((err) => console.warn("Skördepåminnelse-koll misslyckades:", err.message));
loggaHistorik().catch((err) => console.warn("Historik-loggning misslyckades:", err.message));
backupData().catch((err) => console.warn("Säkerhetskopiering misslyckades:", err.message)); // once at startup, so a mid-day restart doesn't wait a full day
