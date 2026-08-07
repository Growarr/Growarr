// Pure, dependency-free helpers extracted from server.js so they can be unit
// tested without spinning up the HTTP server or touching the filesystem,
// network, Home Assistant, or Claude. Anything that reads env vars, the data
// file, or makes a network call stays in server.js - this module is only the
// math and validation a subtle bug could otherwise break silently (the
// drying-trend slope, quantity/height clamping).

export function stockholmManad(d = new Date()) {
  const delar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit" }).formatToParts(d);
  const f = Object.fromEntries(delar.map((p) => [p.type, p.value]));
  return `${f.year}-${f.month}`;
}

// Used for backup filenames - day granularity, in Europe/Stockholm so a
// backup taken shortly after Swedish midnight lands under the right date
// even though the container clock runs UTC.
export function stockholmDatum(d = new Date()) {
  const delar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const f = Object.fromEntries(delar.map((p) => [p.type, p.value]));
  return `${f.year}-${f.month}-${f.day}`;
}

export function lokalTimme(iso) {
  return Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(new Date(iso)));
}

// En odlingspost är "en sort på en plats" och bär ett antal – t.ex. 6 gurkor
// i en låda är én post med antal 6, inte sex poster. Taket på 200 finns bara
// för att en felskrivning inte ska rita ut tiotusen ikoner på kartan.
export const MAX_ANTAL = 200;
export function rensaAntal(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_ANTAL, n);
}

// "klunga" = plantorna står samlade på sin punkt i zonen, "fyll" = de sprids
// jämnt över hela ytan (en låda helt full med samma sort).
export function rensaLayout(v) {
  return v === "fyll" ? "fyll" : "klunga";
}

// Zonens höjd över marken i meter – styr hur lång skugga den kastar i
// solkartan. Ett växthus skuggar, en utplanterad bädd i praktiken inte.
export const STANDARD_HOJD_M = { vaxthus: 2.2, odlingslada: 0.4, utomhus: 0.15, inomhus: 0, annat: 0 };
export function rensaHojdM(v, typ) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return STANDARD_HOJD_M[typ] ?? 0;
  return Math.min(20, Math.round(n * 100) / 100);
}

export const TORR_GRANS = 25;        // % moisture we want to water before reaching
export const MIN_MATPUNKTER = 6;     // fewer points than this and a trend line is noise
export const MIN_LUTNING = 0.7;      // %/day; anything flatter is not really drying out

// Least-squares slope of value against time, in units per day. Returns null
// when there is too little data for the answer to mean anything.
export function torkTakt(punkter) {
  if (punkter.length < MIN_MATPUNKTER) return null;
  const t0 = new Date(punkter[0].tid).getTime();
  const xs = punkter.map((p) => (new Date(p.tid).getTime() - t0) / 86400000);
  const ys = punkter.map((p) => Number(p.varde));
  if (ys.some((y) => !Number.isFinite(y))) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let tal = 0, namn = 0;
  for (let i = 0; i < n; i++) { tal += (xs[i] - mx) * (ys[i] - my); namn += (xs[i] - mx) ** 2; }
  if (namn === 0) return null;
  return tal / namn; // negative means drying out
}

// Turn "water every N days" into concrete weekdays, spread across the week
// rather than bunched together. 0 = Sunday, matching Date.getDay().
export function veckodagarForIntervall(intervall) {
  if (intervall <= 1) return [0, 1, 2, 3, 4, 5, 6];
  if (intervall === 2) return [1, 3, 5];
  if (intervall === 3) return [1, 4];
  if (intervall <= 5) return [1, 5];
  return [3];
}

// The unit of measurement lives on the live Home Assistant state rather than
// in our own data file, so this is a name-based guess. Kept small and
// separate so the intent stays obvious.
export function enhetArFuktsensor(enhet) {
  const namn = (enhet.namn ?? "").toLowerCase();
  return namn.includes("fukt") || namn.includes("moist") || namn.includes("humid");
}
