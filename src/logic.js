// Pure, dependency-free helpers extracted from server.js so they can be unit
// tested without spinning up the HTTP server or touching the filesystem,
// network, Home Assistant, or Claude. Anything that reads env vars, the data
// file, or makes a network call stays in server.js - this module is only the
// math and validation a subtle bug could otherwise break silently (the
// drying-trend slope, quantity/height clamping).

// Numeric version comparison ("0.1.10" > "0.1.9"), not a naive string
// compare - "0.1.9" > "0.1.10" alphabetically otherwise (the '9' outranks
// the '1'), which is backwards. Missing/non-numeric segments count as 0, and
// two equal versions are not "newer".
export function versionArNyare(kandidat, jamfortMed) {
  const a = String(kandidat ?? "").split(".").map(Number);
  const b = String(jamfortMed ?? "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
    if (av !== bv) return av > bv;
  }
  return false;
}

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

// Map-dressing objects (trees, houses, paths...) placed on the garden map,
// distinct from zones. This vocabulary starts in English - unlike zones'
// legacy Swedish typ values (vaxthus, odlingslada, ...), which stay as
// they are; existing Swedish internals migrate gradually, this is new.
// bredd/hojd are starting sizes in the map's own scene units, not
// real-world metres - a real-world height (for casting shade) is a later,
// separate step, not built yet.
export const OBJEKT_TYPER = {
  tree: { bredd: 50, hojd: 50 },
  house: { bredd: 120, hojd: 90 },
  path: { bredd: 200, hojd: 30 },
  fence: { bredd: 150, hojd: 8 },
  shed: { bredd: 70, hojd: 60 },
  pond: { bredd: 80, hojd: 60 },
};
export function rensaObjektTyp(v) {
  return OBJEKT_TYPER[v] ? v : "tree";
}

// Snaps a rotation angle to the nearest multiple of steg degrees, wrapping
// correctly at the 0/360 boundary - e.g. 358° with a 15° step lands on 0°,
// not -8° or 345°, which a naive Math.round(v/steg)*steg without first
// normalizing into [0, 360) would get wrong.
export function snappaRotation(grader, steg = 15) {
  const n = Number(grader);
  if (!Number.isFinite(n)) return 0;
  const normaliserad = ((n % 360) + 360) % 360;
  return (Math.round(normaliserad / steg) * steg) % 360;
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

// Plant-family lookup for a crop-rotation heads-up: growing the same
// family in the same bed too soon lets family-specific pests/disease
// build up in the soil. Regex-matched against the free-text planting name
// (there's no structured species field) - same technique as the client's
// icon lookup (VAXT_IKONER in index.html), first match wins. A name that
// matches nothing returns null rather than a guessed family: a wrong
// guess is worse than no warning.
export const VAXT_FAMILJER = {
  nattskott:  { namn: "Nattskatteväxter", vilaAr: 3 },  // tomat, potatis, paprika, chili, aubergine
  kal:        { namn: "Kål",              vilaAr: 3 },  // kål, broccoli, blomkål, rädisa, rova, rucola
  gurkvaxter: { namn: "Gurkväxter",       vilaAr: 2 },  // gurka, pumpa, squash, zucchini, melon
  baljvaxter: { namn: "Baljväxter",       vilaAr: 2 },  // ärt, böna
  rotfrukter: { namn: "Rotfrukter",       vilaAr: 3 },  // morot, palsternacka, persilja, dill, selleri
  lokvaxter:  { namn: "Lökväxter",        vilaAr: 2 },  // lök, purjolök, vitlök
  amarant:    { namn: "Mangold/rödbeta/spenat", vilaAr: 2 },
  korgblommiga: { namn: "Sallad m.fl. korgblommiga", vilaAr: 2 },
  rosvaxter:  { namn: "Jordgubbar",       vilaAr: 2 },
  kryddvaxter: { namn: "Kryddväxter (mynta-familjen)", vilaAr: 1 },  // basilika, mynta, timjan, rosmarin
};

// Checked before the generic patterns below: a few real Swedish crop names
// are compounds that contain another family's keyword as a plain
// substring, but aren't that family at all - jordärtskocka/kronärtskocka
// (Jerusalem/globe artichoke, both thistles) contain "ärt" and would
// otherwise match legumes, and potatislök (a shallot) contains "potatis"
// and would otherwise match nightshades. A general word-boundary regex
// would "fix" this but break more than it solves: Swedish relies on the
// same unbounded compounding for legitimate matches (sockerärt, purjolök,
// vaxböna all need the substring to match without a boundary), so known
// exceptions are listed explicitly instead.
const VAXT_FAMILJ_UNDANTAG = [
  [/jordärtskocka|kronärtskocka/i, "korgblommiga"],
  [/potatislök/i, "lokvaxter"],
];

// Swedish plurals often swap the trailing vowel rather than just append
// (pumpa -> pumpor, rädisa -> rädisor, böna -> bönor, paprika -> paprikor,
// rödbeta -> rödbetor) - a naive singular-only stem misses the plural form,
// which matters here since the app's own suggested names (VANLIGA_SORTER
// in index.html) already use several of those plurals. Both forms are
// spelled out explicitly instead of a shorter, riskier stem.
const VAXT_FAMILJ_MONSTER = [
  [/tomat|potatis|paprika|paprikor|chili|aubergine/i, "nattskott"],
  [/kål|broccoli|rädisa|rädisor|rova|rovor|rucola|ruccola/i, "kal"],
  [/gurk|pumpa|pumpor|squash|zucchini|melon/i, "gurkvaxter"],
  [/ärt|böna|bönor/i, "baljvaxter"],
  [/morot|morötter|palsternacka|palsternackor|persilja|dill|selleri/i, "rotfrukter"],
  [/lök/i, "lokvaxter"],
  [/rödbeta|rödbetor|mangold|spenat/i, "amarant"],
  [/sallad|sallat|solros/i, "korgblommiga"],
  [/jordgubb/i, "rosvaxter"],
  [/basilika|mynta|timjan|rosmarin/i, "kryddvaxter"],
];

export function vaxtfamiljFor(namn) {
  if (!namn) return null;
  for (const [monster, familj] of VAXT_FAMILJ_UNDANTAG) if (monster.test(namn)) return familj;
  for (const [monster, familj] of VAXT_FAMILJ_MONSTER) if (monster.test(namn)) return familj;
  return null;
}

// Looks at a zone's own harvest history for the most recent entry in the
// same family as `namn`, and says whether it's still inside that family's
// recommended rest period. Returns null when there's nothing to warn
// about - unknown family, or the rest period has already passed.
export function skordFamiljVarning(zonHistorik, namn, nu = new Date()) {
  const familj = vaxtfamiljFor(namn);
  if (!familj) return null;
  const info = VAXT_FAMILJER[familj];
  let senast = null;
  for (const post of zonHistorik ?? []) {
    if (vaxtfamiljFor(post.namn) !== familj) continue;
    const datum = new Date(post.arkiveradDatum);
    if (Number.isNaN(datum.getTime())) continue;
    if (!senast || datum > senast.datum) senast = { datum, namn: post.namn };
  }
  if (!senast) return null;
  const arSedan = (nu - senast.datum) / (365.25 * 24 * 60 * 60 * 1000);
  if (arSedan >= info.vilaAr) return null;
  return { familj, familjNamn: info.namn, vilaAr: info.vilaAr, senastNamn: senast.namn, arSedan };
}

// A small, curated care-info lookup - not an external plant database (this
// app has zero npm dependencies and stays fully self-hosted/offline), just
// enough per species for a beginner to not have to guess. Covers every name
// in VANLIGA_SORTER (index.html) plus a handful of other common crops.
// vatten/sol/svarighet are coarse three-level scales on purpose - a real
// soil-moisture number belongs to a sensor reading, not a static fact.
export const VAXT_DATABAS = {
  tomat: { visningsnamn: "Tomat", vatten: "hog", sol: "sol", avstand_cm: 50,
    sasong: "Så inomhus mars–april, plantera ut efter frostrisk (juni), skörda aug–sep", svarighet: "medel" },
  potatis: { visningsnamn: "Potatis", vatten: "medel", sol: "sol", avstand_cm: 30,
    sasong: "Sätt april–maj, skörda jul–sep", svarighet: "latt" },
  paprika: { visningsnamn: "Paprika/chili", vatten: "hog", sol: "sol", avstand_cm: 40,
    sasong: "Så inomhus feb–mars, plantera ut i juni, skörda aug–okt", svarighet: "svar" },
  aubergine: { visningsnamn: "Aubergine", vatten: "hog", sol: "sol", avstand_cm: 45,
    sasong: "Så inomhus feb–mars, plantera ut i juni (helst växthus), skörda aug–sep", svarighet: "svar" },
  gurka: { visningsnamn: "Gurka", vatten: "hog", sol: "sol", avstand_cm: 40,
    sasong: "Så inomhus april, plantera ut eller så direkt i juni, skörda jul–sep", svarighet: "medel" },
  zucchini: { visningsnamn: "Zucchini/squash", vatten: "hog", sol: "sol", avstand_cm: 80,
    sasong: "Så inomhus april–maj eller direkt i juni, skörda jul–sep", svarighet: "latt" },
  pumpa: { visningsnamn: "Pumpa", vatten: "hog", sol: "sol", avstand_cm: 100,
    sasong: "Så inomhus april–maj, plantera ut i juni, skörda sep–okt", svarighet: "medel" },
  art: { visningsnamn: "Ärt", vatten: "medel", sol: "sol", avstand_cm: 10,
    sasong: "Så direkt april–maj, skörda jun–aug", svarighet: "latt" },
  bona: { visningsnamn: "Böna", vatten: "medel", sol: "sol", avstand_cm: 15,
    sasong: "Så direkt efter frostrisk (juni), skörda jul–sep", svarighet: "latt" },
  morot: { visningsnamn: "Morot", vatten: "medel", sol: "sol", avstand_cm: 5,
    sasong: "Så direkt april–juni, skörda jul–okt", svarighet: "latt" },
  radisa: { visningsnamn: "Rädisa", vatten: "medel", sol: "sol", avstand_cm: 4,
    sasong: "Så direkt från april, klar på 3–4 veckor - så om flera gånger", svarighet: "latt" },
  rodbeta: { visningsnamn: "Rödbeta", vatten: "medel", sol: "sol", avstand_cm: 10,
    sasong: "Så direkt april–juni, skörda jul–okt", svarighet: "latt" },
  purjolok: { visningsnamn: "Purjolök", vatten: "medel", sol: "sol", avstand_cm: 15,
    sasong: "Så inomhus mars, plantera ut i juni, skörda sep–nov", svarighet: "medel" },
  vitlok: { visningsnamn: "Vitlök", vatten: "lag", sol: "sol", avstand_cm: 10,
    sasong: "Sätt i oktober för övervintring, eller tidigt på våren, skörda jul–aug", svarighet: "latt" },
  lok: { visningsnamn: "Lök", vatten: "lag", sol: "sol", avstand_cm: 10,
    sasong: "Sätt sättlök april–maj, skörda aug–sep", svarighet: "latt" },
  kal: { visningsnamn: "Kål", vatten: "hog", sol: "sol", avstand_cm: 50,
    sasong: "Så inomhus mars–april, plantera ut i maj–juni, skörda aug–okt", svarighet: "medel" },
  sallad: { visningsnamn: "Sallad", vatten: "hog", sol: "halvskugga", avstand_cm: 25,
    sasong: "Så direkt eller inomhus från april, klar 6–8 veckor senare - så om flera gånger", svarighet: "latt" },
  spenat: { visningsnamn: "Spenat", vatten: "medel", sol: "halvskugga", avstand_cm: 10,
    sasong: "Så direkt mars–april och igen aug–sep, klar 4–6 veckor senare", svarighet: "latt" },
  dill: { visningsnamn: "Dill", vatten: "medel", sol: "sol", avstand_cm: 15,
    sasong: "Så direkt från april, så om varannan vecka för jämn skörd", svarighet: "latt" },
  basilika: { visningsnamn: "Basilika", vatten: "medel", sol: "sol", avstand_cm: 20,
    sasong: "Så inomhus april, ställ ut efter frostrisk i juni - känslig för kyla", svarighet: "medel" },
  jordgubbe: { visningsnamn: "Jordgubbe", vatten: "medel", sol: "sol", avstand_cm: 30,
    sasong: "Plantera vår eller höst, full skörd andra året, skörda jun–jul", svarighet: "latt" },
};

// A couple of real Swedish crop names are compounds that would otherwise
// misfire against the patterns below (same class of bug already found and
// fixed in VAXT_FAMILJ_MONSTER - see that comment for why a word-boundary
// regex would make things worse, not better). Jordärtskocka/Kronärtskocka
// contain "ärt" but aren't peas; Potatislök contains "potatis" but is an
// onion. None of the three are in this curated list, so the correct result
// is simply "no card" - checked first, before the generic patterns.
const VAXT_DATABAS_UNDANTAG = [/jordärtskocka|kronärtskocka|potatislök/i];

const VAXT_DATABAS_MONSTER = [
  [/tomat/i, "tomat"],
  [/potatis/i, "potatis"],
  [/paprika|paprikor|chili/i, "paprika"],
  [/aubergine/i, "aubergine"],
  [/gurk/i, "gurka"],
  [/zucchini|squash/i, "zucchini"],
  [/pumpa|pumpor/i, "pumpa"],
  [/böna|bönor/i, "bona"],
  [/morot|morötter/i, "morot"],
  [/rädisa|rädisor/i, "radisa"],
  [/rödbeta|rödbetor/i, "rodbeta"],
  [/purjolök/i, "purjolok"],
  [/vitlök/i, "vitlok"],
  [/lök/i, "lok"],
  [/kål/i, "kal"],
  [/sallad|sallat/i, "sallad"],
  [/spenat/i, "spenat"],
  [/dill/i, "dill"],
  [/basilika/i, "basilika"],
  [/jordgubb/i, "jordgubbe"],
  [/ärt/i, "art"],
];

export function vaxtinfoFor(namn) {
  if (!namn) return null;
  if (VAXT_DATABAS_UNDANTAG.some((monster) => monster.test(namn))) return null;
  for (const [monster, nyckel] of VAXT_DATABAS_MONSTER) if (monster.test(namn)) return { nyckel, ...VAXT_DATABAS[nyckel] };
  return null;
}
