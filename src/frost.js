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
const TIMMAR_FRAMAT = 36;

if (!LAT || !LON) {
  console.error("GEO_LAT och GEO_LON måste vara satta (koordinater för trädgården, t.ex. 59.85 och 17.63).");
  process.exit(1);
}

// SMHI stängde av gamla pmp3g-API:t 31 mars 2026 – snow1g ersatte det, med
// ett annat svarsformat ("time" istället för "validTime", platt "data"-
// objekt istället för en parameters-array).
const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${LON}/lat/${LAT}/data.json`;
const res = await fetch(url, { headers: { "User-Agent": "tradgardsbevakning (github.com/mathiasmholm/tradgardsbevakning)" } });
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
if (!NTFY_TOPIC) {
  console.log(`[TORRKÖRNING – ingen NTFY_TOPIC satt] Frostrisk! Ner mot ${lagst.temp}°C ${tidText}.`);
  process.exit(0);
}

const res2 = await fetch("https://ntfy.sh", {
  method: "POST",
  body: JSON.stringify({
    topic: NTFY_TOPIC,
    title: "❄️ Frostrisk i trädgården",
    message: `Ner mot ${lagst.temp}°C ${tidText}. Täck ömtåliga plantor i tid.`,
    priority: 4,
  }),
});
if (!res2.ok) {
  console.warn(`ntfy svarade ${res2.status}: ${(await res2.text()).slice(0, 200)}`);
} else {
  console.log("Frostvarning skickad.");
}
