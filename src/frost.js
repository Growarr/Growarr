// Checks the forecast (SMHI where it has coverage, Open-Meteo elsewhere -
// see src/vader.js) for frost risk over the next day, and sends a push via
// ntfy if the lowest expected temperature falls below the threshold. Runs
// for free on GitHub Actions. Note: forecast temperature is air
// temperature 2m up, not ground temperature - ground frost can occur a
// couple of degrees above 0°C on clear, still nights, hence the default
// 3°C threshold instead of 0°C.
import { hamtaTimvader } from "./vader.js";

const LAT = process.env.GEO_LAT;
const LON = process.env.GEO_LON;
const THRESHOLD = Number(process.env.FROST_THRESHOLD ?? 3);
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const HOURS_AHEAD = 36;

// Missing coordinates are not an error, just an unconfigured watch. A
// nightly scheduled job that fails every day is just noise in the Actions
// log (and emails about failed runs), so skip quietly instead. Note this
// stays repo-secret-driven even though the live app's location can now be
// changed in Settings - bridging this GitHub Actions job to a self-hosted
// container's Settings would mean the container being reachable from the
// internet, which most installs (behind a home router/reverse proxy)
// aren't. Update the repo secrets by hand if the garden's location changes.
if (!LAT || !LON) {
  console.log("Skipping: GEO_LAT and GEO_LON are not set as repo secrets.");
  console.log("Set them under Settings -> Secrets and variables -> Actions to enable the frost watch,");
  console.log("e.g. GEO_LAT=59.85 and GEO_LON=17.63.");
  process.exit(0);
}

const upcoming = await hamtaTimvader(LAT, LON, HOURS_AHEAD);

if (!upcoming.length) {
  console.log("No forecast data for the coming day, skipping.");
  process.exit(0);
}

const lowest = upcoming.reduce((a, b) => (b.temp < a.temp ? b : a));
console.log(`Lowest expected temperature over the next ${HOURS_AHEAD}h: ${lowest.temp}°C (${lowest.tid.toISOString()})`);

if (lowest.temp > THRESHOLD) {
  console.log(`No frost risk (threshold ${THRESHOLD}°C), sending no notification.`);
  process.exit(0);
}

// Notification content stays in Swedish, same as the rest of the app's
// user-facing text: this is a push notification read by the household, not
// something a repo visitor sees.
const timeText = lowest.tid.toLocaleString("sv-SE", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
const title = "❄️ Frostrisk i trädgården";
const message = `Ner mot ${lowest.temp}°C ${timeText}. Täck ömtåliga plantor i tid.`;

if (!NTFY_TOPIC && !WEBHOOK_URL) {
  console.log(`[DRY RUN - no NTFY_TOPIC/WEBHOOK_URL set] ${title}: ${message}`);
  process.exit(0);
}

if (NTFY_TOPIC) {
  const res2 = await fetch("https://ntfy.sh", {
    method: "POST",
    body: JSON.stringify({ topic: NTFY_TOPIC, title, message, priority: 4 }),
  });
  if (!res2.ok) console.warn(`ntfy responded ${res2.status}: ${(await res2.text()).slice(0, 200)}`);
  else console.log("Frost warning sent via ntfy.");
}

// Also sent to a Home Assistant webhook if set, so an HA automation can do
// whatever it likes with it (show it on a screen, read it aloud, etc.) on
// top of the ntfy push.
if (WEBHOOK_URL) {
  try {
    const res3 = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "growarr-bot/1.0 (+github.com/Growarr/growarr)" },
      body: JSON.stringify({ title, message }),
    });
    if (!res3.ok) console.warn(`HA webhook responded ${res3.status}`);
    else console.log("Frost warning sent via HA webhook.");
  } catch (err) {
    console.warn(`HA webhook was unreachable: ${err.message}`);
  }
}
