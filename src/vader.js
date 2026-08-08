// Shared by server.js (the live weather card) and src/frost.js (the
// nightly frost check) - a network-calling module, so it does NOT belong
// in src/logic.js (that file is pure/network-free, see its own header
// comment). SMHI is tried first - it's the better, hyper-local Nordic
// forecast, and is what this app has always used - Open-Meteo is the
// global fallback for a coordinate outside SMHI's coverage. Confirmed
// live that SMHI returns a clean HTTP 404 there (not garbage data), so
// that's the fallback trigger, not a hand-maintained bounding box.
import { lokalTimme } from "./logic.js";

// Open-Meteo's daily.weathercode values are WMO codes, a different scale
// than SMHI's symbol_code (1-27, the scheme VADER_IKON in index.html is
// keyed on). Mapped to the closest SMHI-equivalent icon rather than
// passed through unmapped, so a global user sees a real condition icon
// instead of the generic thermometer fallback for every single day.
const WMO_TILL_SMHI_SYMBOL = {
  0: 1, 1: 2, 2: 3, 3: 6,        // clear -> overcast
  45: 7, 48: 7,                   // fog
  51: 8, 53: 8, 55: 9,            // drizzle -> light/moderate rain showers
  56: 12, 57: 13,                 // freezing drizzle -> sleet showers
  61: 18, 63: 19, 65: 20,         // rain
  66: 22, 67: 23,                 // freezing rain -> sleet
  71: 25, 73: 26, 75: 27, 77: 25, // snow
  80: 8, 81: 9, 82: 10,           // rain showers
  85: 15, 86: 17,                 // snow showers
  95: 11, 96: 11, 99: 11,         // thunderstorm
};

async function hamtaSmhi(lat, lon) {
  // SMHI stängde av gamla pmp3g-API:t 31 mars 2026 – snow1g ersatte det, med
  // ett annat svarsformat ("time" istället för "validTime", platt "data"-
  // objekt istället för en parameters-array).
  const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json`;
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
  return { dagar, nu: narmast, lat: Number(lat), lon: Number(lon) };
}

async function hamtaOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&current=temperature_2m&timezone=auto&forecast_days=5`;
  const res = await fetch(url, { headers: { "User-Agent": "growarr (github.com/Growarr/growarr)" } });
  if (!res.ok) return { fel: `Open-Meteo svarade ${res.status}` };
  const data = await res.json();
  const d = data.daily ?? {};
  const dagar = (d.time ?? []).map((dag, i) => ({
    dag,
    min: Math.round(d.temperature_2m_min?.[i]),
    max: Math.round(d.temperature_2m_max?.[i]),
    nederbord: Math.round((d.precipitation_sum?.[i] ?? 0) * 10) / 10,
    symbol: WMO_TILL_SMHI_SYMBOL[d.weathercode?.[i]] ?? null,
  }));
  return { dagar, nu: data.current?.temperature_2m ?? null, lat: Number(lat), lon: Number(lon) };
}

export async function hamtaVader(lat, lon) {
  if (!lat || !lon) return { fel: "Plats är inte konfigurerad." };
  const smhi = await hamtaSmhi(lat, lon);
  if (!smhi.fel) return smhi;
  return hamtaOpenMeteo(lat, lon);
}

// Raw hourly temperature points for the next `timmarFramat` hours, used by
// src/frost.js's "lowest point in the next 36h" check. Deliberately
// separate from hamtaVader() above: that one collapses everything into a
// per-day min/max, which would blur together tonight's and tomorrow
// night's lows - fine for a display card, wrong for a frost warning meant
// to protect plants on a specific night. Same SMHI-first,
// Open-Meteo-fallback shape.
async function hamtaSmhiTimvader(lat, lon, timmarFramat) {
  const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json`;
  const res = await fetch(url, { headers: { "User-Agent": "growarr (github.com/Growarr/growarr)" } });
  if (!res.ok) return null;
  const data = await res.json();
  const nu = Date.now();
  return data.timeSeries
    .map((t) => ({ tid: new Date(t.time), temp: t.data?.air_temperature }))
    .filter((p) => p.temp != null && p.tid.getTime() >= nu && p.tid.getTime() <= nu + timmarFramat * 3600 * 1000);
}
async function hamtaOpenMeteoTimvader(lat, lon, timmarFramat) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&timezone=auto`;
  const res = await fetch(url, { headers: { "User-Agent": "growarr (github.com/Growarr/growarr)" } });
  if (!res.ok) return null;
  const data = await res.json();
  const nu = Date.now();
  const tider = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  return tider
    .map((tid, i) => ({ tid: new Date(tid), temp: temps[i] }))
    .filter((p) => p.temp != null && p.tid.getTime() >= nu && p.tid.getTime() <= nu + timmarFramat * 3600 * 1000);
}
export async function hamtaTimvader(lat, lon, timmarFramat) {
  const smhi = await hamtaSmhiTimvader(lat, lon, timmarFramat);
  if (smhi && smhi.length) return smhi;
  return (await hamtaOpenMeteoTimvader(lat, lon, timmarFramat)) ?? [];
}
