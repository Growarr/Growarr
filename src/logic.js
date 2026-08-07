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

// Node reports an IPv4 connection's remote address as an IPv4-mapped IPv6
// address (e.g. "::ffff:192.168.1.5") whenever the socket is dual-stack,
// which is the common case in Docker. Strip that prefix so CIDR matching
// only ever has to deal with plain IPv4.
export function normaliseraIp(ip) {
  return ip?.startsWith("::ffff:") ? ip.slice(7) : (ip ?? "");
}

// A dotted-quad IPv4 address as a single 32-bit unsigned integer, or null if
// it isn't one (IPv6, garbage, etc.) - null rather than throwing, since a
// network address that doesn't parse should just never match anything.
function ipv4Till32Bit(ip) {
  const delar = String(ip).split(".");
  if (delar.length !== 4) return null;
  const tal = delar.map(Number);
  if (tal.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((tal[0] << 24) | (tal[1] << 16) | (tal[2] << 8) | tal[3]) >>> 0;
}

// IPv4-only CIDR containment (e.g. is "192.168.1.5" inside "192.168.0.0/16"?).
// A bare IP with no "/bits" is treated as a /32 (an exact match). Anything
// that isn't plain IPv4 - either side - never matches; there's no IPv6 CIDR
// support here, only the always-trusted "::1" loopback case in
// arBetroddAdress below.
export function ipINat(ip, cidr) {
  const [natIp, bitStr] = String(cidr).split("/");
  const bits = bitStr === undefined ? 32 : Number(bitStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const adress = ipv4Till32Bit(ip);
  const nat = ipv4Till32Bit(natIp);
  if (adress === null || nat === null) return false;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (adress & mask) === (nat & mask);
}

// No default trust at all, not even loopback - an operator-configured CIDR
// is the only way in. Loopback feels safe ("nothing outside the host can
// connect via 127.0.0.1") but isn't: a reverse proxy running on the same
// host - the normal setup here, with network_mode: host - forwards real,
// outside traffic to Growarr over 127.0.0.1, which would make every request
// look local and silently bypass the login for everyone. Same reasoning as
// not guessing a default LAN range: a plausible-looking default that's
// wrong is worse than no default.
export function arBetroddAdress(ip, natverksLista) {
  const adress = normaliseraIp(ip);
  return (natverksLista ?? []).some((cidr) => ipINat(adress, cidr));
}
