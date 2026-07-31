// Kollar SMHI:s väderprognos (gratis, ingen nyckel behövs) för frostrisk
// kommande dygn, och skickar push via ntfy om lägsta väntade temperatur
// ligger under tröskeln. Körs gratis på GitHub Actions, samma mönster som
// Bostadsvakt. OBS: SMHI:s "t" är lufttemperatur 2 m upp, inte marktemperatur
// – markfrost kan förekomma en bit över 0°C på klara, vindstilla nätter,
// därav standardtröskeln på 3°C istället för 0°C.
const LAT = process.env.GEO_LAT;
const LON = process.env.GEO_LON;
const TROSKEL = Number(process.env.FROST_TROSKEL ?? 3);
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TIMMAR_FRAMAT = 36;

// Saknade koordinater är inte ett fel utan en okonfigurerad bevakning. Ett
// nattligt schemalagt jobb som kraschar varje dygn blir bara brus i Actions-
// loggen (och mejl om misslyckade körningar), så vi hoppar över tyst istället.
if (!LAT || !LON) {
  console.log("Hoppar över: GEO_LAT och GEO_LON är inte satta som repo-secrets.");
  console.log("Sätt dem under Settings → Secrets and variables → Actions för att slå på frostvarningen,");
  console.log("t.ex. GEO_LAT=59.85 och GEO_LON=17.63.");
  process.exit(0);
}

// SMHI stängde av gamla pmp3g-API:t 31 mars 2026 – snow1g ersatte det, med
// ett annat svarsformat ("time" istället för "validTime", platt "data"-
// objekt istället för en parameters-array).
const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${LON}/lat/${LAT}/data.json`;
const res = await fetch(url, { headers: { "User-Agent": "growarr (github.com/mathiasmholm/growarr)" } });
if (!res.ok) {
  console.error(`SMHI svarade ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const nu = Date.now();
const kommande = data.timeSeries
  .map((t) => ({
    tid: new Date(t.time),
    temp: t.data?.air_temperature,
  }))
  .filter((p) => p.temp != null && p.tid.getTime() >= nu && p.tid.getTime() <= nu + TIMMAR_FRAMAT * 3600 * 1000);

if (!kommande.length) {
  console.log("Ingen prognosdata för det kommande dygnet – hoppar över.");
  process.exit(0);
}

const lagst = kommande.reduce((a, b) => (b.temp < a.temp ? b : a));
console.log(`Lägsta förväntade temperatur kommande ${TIMMAR_FRAMAT}h: ${lagst.temp}°C (${lagst.tid.toISOString()})`);

if (lagst.temp > TROSKEL) {
  console.log(`Ingen frostrisk (tröskel ${TROSKEL}°C) – skickar ingen notis.`);
  process.exit(0);
}

const tidText = lagst.tid.toLocaleString("sv-SE", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
const titel = "❄️ Frostrisk i trädgården";
const meddelande = `Ner mot ${lagst.temp}°C ${tidText}. Täck ömtåliga plantor i tid.`;

if (!NTFY_TOPIC && !WEBHOOK_URL) {
  console.log(`[TORRKÖRNING – ingen NTFY_TOPIC/WEBHOOK_URL satt] ${titel}: ${meddelande}`);
  process.exit(0);
}

if (NTFY_TOPIC) {
  const res2 = await fetch("https://ntfy.sh", {
    method: "POST",
    body: JSON.stringify({ topic: NTFY_TOPIC, title: titel, message: meddelande, priority: 4 }),
  });
  if (!res2.ok) console.warn(`ntfy svarade ${res2.status}: ${(await res2.text()).slice(0, 200)}`);
  else console.log("Frostvarning skickad via ntfy.");
}

// Skickas även till en Home Assistant-webhook om satt, samma dubbla mönster
// som Bostadsvakts notify.js – en HA-automation kan göra vad ni vill med den
// (visa på en skärm, säga den högt osv) utöver ntfy-pushen.
if (WEBHOOK_URL) {
  try {
    const res3 = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "growarr-bot/1.0 (+github.com/mathiasmholm/growarr)" },
      body: JSON.stringify({ title: titel, message: meddelande }),
    });
    if (!res3.ok) console.warn(`HA-webhook svarade ${res3.status}`);
    else console.log("Frostvarning skickad via HA-webhook.");
  } catch (err) {
    console.warn(`HA-webhook nåddes inte: ${err.message}`);
  }
}
