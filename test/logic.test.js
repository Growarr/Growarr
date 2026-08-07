import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rensaAntal, rensaLayout, rensaHojdM, STANDARD_HOJD_M,
  torkTakt, veckodagarForIntervall, enhetArFuktsensor,
  stockholmManad, stockholmDatum, lokalTimme,
  normaliseraIp, ipINat, arBetroddAdress, versionArNyare,
  OBJEKT_TYPER, rensaObjektTyp, snappaRotation,
  VAXT_FAMILJER, vaxtfamiljFor, skordFamiljVarning,
} from "../src/logic.js";

describe("rensaAntal", () => {
  test("rounds and accepts valid numbers", () => {
    assert.equal(rensaAntal(6), 6);
    assert.equal(rensaAntal("6"), 6);
    assert.equal(rensaAntal(6.4), 6);
    assert.equal(rensaAntal(6.6), 7);
  });
  test("falls back to 1 for invalid input", () => {
    assert.equal(rensaAntal(0), 1);
    assert.equal(rensaAntal(-5), 1);
    assert.equal(rensaAntal(NaN), 1);
    assert.equal(rensaAntal("not a number"), 1);
    assert.equal(rensaAntal(undefined), 1);
  });
  test("caps at 200, so a typo doesn't draw ten thousand icons", () => {
    assert.equal(rensaAntal(10000), 200);
    assert.equal(rensaAntal(200), 200);
    assert.equal(rensaAntal(201), 200);
  });
});

describe("rensaLayout", () => {
  test("only \"fyll\" is accepted as fyll, everything else becomes klunga", () => {
    assert.equal(rensaLayout("fyll"), "fyll");
    assert.equal(rensaLayout("klunga"), "klunga");
    assert.equal(rensaLayout("something-made-up"), "klunga");
    assert.equal(rensaLayout(undefined), "klunga");
  });
});

describe("rensaHojdM", () => {
  test("falls back to the type's default height for invalid input", () => {
    assert.equal(rensaHojdM(undefined, "vaxthus"), STANDARD_HOJD_M.vaxthus);
    assert.equal(rensaHojdM(-1, "odlingslada"), STANDARD_HOJD_M.odlingslada);
    assert.equal(rensaHojdM(NaN, "annat"), STANDARD_HOJD_M.annat);
  });
  test("an unknown type falls back to 0", () => {
    assert.equal(rensaHojdM(undefined, "made-up-type"), 0);
  });
  test("rounds to two decimals and caps at 20 m", () => {
    assert.equal(rensaHojdM(1.2345, "annat"), 1.23);
    assert.equal(rensaHojdM(50, "vaxthus"), 20);
  });
});

describe("torkTakt", () => {
  test("null with too few data points (< 6)", () => {
    const punkter = [
      { tid: "2026-08-01T00:00:00Z", varde: 40 },
      { tid: "2026-08-02T00:00:00Z", varde: 38 },
    ];
    assert.equal(torkTakt(punkter), null);
  });
  test("negative slope for soil that's drying out, in %/day", () => {
    // Exactly a 2%/day drop over 6 days.
    const punkter = Array.from({ length: 6 }, (_, i) => ({
      tid: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      varde: 50 - i * 2,
    }));
    const lutning = torkTakt(punkter);
    assert.ok(lutning < 0, "slope should be negative when the soil is drying out");
    assert.ok(Math.abs(lutning - -2) < 0.01, `expected ~-2, got ${lutning}`);
  });
  test("positive slope when the soil is getting wetter", () => {
    const punkter = Array.from({ length: 6 }, (_, i) => ({
      tid: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      varde: 20 + i * 3,
    }));
    assert.ok(torkTakt(punkter) > 0);
  });
  test("null when the readings aren't numeric", () => {
    const punkter = Array.from({ length: 6 }, (_, i) => ({
      tid: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      varde: "broken-sensor",
    }));
    assert.equal(torkTakt(punkter), null);
  });
});

describe("veckodagarForIntervall", () => {
  test("every day when the interval is 1 or less", () => {
    assert.deepEqual(veckodagarForIntervall(1), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(veckodagarForIntervall(0), [0, 1, 2, 3, 4, 5, 6]);
  });
  test("sparser patterns for longer intervals", () => {
    assert.deepEqual(veckodagarForIntervall(2), [1, 3, 5]);
    assert.deepEqual(veckodagarForIntervall(3), [1, 4]);
    assert.deepEqual(veckodagarForIntervall(5), [1, 5]);
    assert.deepEqual(veckodagarForIntervall(7), [3]);
  });
});

describe("enhetArFuktsensor", () => {
  test("recognizes fukt/moist/humid in the name, case-insensitively", () => {
    assert.equal(enhetArFuktsensor({ namn: "Jordfuktighet växthus" }), true);
    assert.equal(enhetArFuktsensor({ namn: "Soil Moisture Sensor" }), true);
    assert.equal(enhetArFuktsensor({ namn: "Humidity outdoor" }), true);
    assert.equal(enhetArFuktsensor({ namn: "Temperatur ute" }), false);
    assert.equal(enhetArFuktsensor({ namn: "" }), false);
    assert.equal(enhetArFuktsensor({}), false);
  });
});

describe("date/time helpers (Europe/Stockholm, DST is UTC+2 in August)", () => {
  test("stockholmManad gives YYYY-MM in local time", () => {
    assert.equal(stockholmManad(new Date("2026-08-06T10:00:00Z")), "2026-08");
  });
  test("stockholmDatum adds the day, and can roll to the next day vs. UTC", () => {
    assert.equal(stockholmDatum(new Date("2026-08-06T10:00:00Z")), "2026-08-06");
    // 23:00 UTC on an August evening is already 01:00 the next day in Stockholm (UTC+2).
    assert.equal(stockholmDatum(new Date("2026-08-06T23:00:00Z")), "2026-08-07");
  });
  test("lokalTimme converts to the local hour", () => {
    assert.equal(lokalTimme("2026-08-06T10:00:00Z"), 12);
  });
});

describe("normaliseraIp", () => {
  test("strips the IPv4-mapped IPv6 prefix Node reports on dual-stack sockets", () => {
    assert.equal(normaliseraIp("::ffff:192.168.1.5"), "192.168.1.5");
  });
  test("leaves plain IPv4 and other addresses alone", () => {
    assert.equal(normaliseraIp("192.168.1.5"), "192.168.1.5");
    assert.equal(normaliseraIp("::1"), "::1");
  });
  test("empty/missing input becomes an empty string", () => {
    assert.equal(normaliseraIp(""), "");
    assert.equal(normaliseraIp(undefined), "");
  });
});

describe("ipINat", () => {
  test("matches an address inside the network's range", () => {
    assert.equal(ipINat("192.168.1.5", "192.168.0.0/16"), true);
    assert.equal(ipINat("10.0.5.9", "10.0.0.0/8"), true);
  });
  test("rejects an address outside the range", () => {
    assert.equal(ipINat("192.168.1.5", "10.0.0.0/8"), false);
    assert.equal(ipINat("192.169.1.5", "192.168.0.0/16"), false);
  });
  test("a bare IP with no /bits is an exact (/32) match", () => {
    assert.equal(ipINat("192.168.1.5", "192.168.1.5"), true);
    assert.equal(ipINat("192.168.1.6", "192.168.1.5"), false);
  });
  test("never matches anything that isn't plain IPv4, on either side", () => {
    assert.equal(ipINat("::1", "0.0.0.0/0"), false);
    assert.equal(ipINat("192.168.1.5", "::1/128"), false);
    assert.equal(ipINat("not-an-ip", "10.0.0.0/8"), false);
  });
});

describe("arBetroddAdress", () => {
  test("no default trust at all with an empty trusted-networks list - not even loopback", () => {
    // A reverse proxy on the same host forwards real, outside traffic to
    // Growarr over 127.0.0.1 too, so loopback can't be assumed safe.
    assert.equal(arBetroddAdress("127.0.0.1", []), false);
    assert.equal(arBetroddAdress("::1", []), false);
    assert.equal(arBetroddAdress("192.168.1.50", []), false);
  });
  test("no default LAN range - an ordinary private address is untrusted unless listed", () => {
    assert.equal(arBetroddAdress("192.168.1.50", ["10.0.0.0/8"]), false);
  });
  test("matches once the operator explicitly lists the network", () => {
    assert.equal(arBetroddAdress("192.168.1.50", ["192.168.1.0/24"]), true);
    assert.equal(arBetroddAdress("::ffff:192.168.1.50", ["192.168.1.0/24"]), true);
  });
  test("loopback works too, if explicitly listed", () => {
    assert.equal(arBetroddAdress("127.0.0.1", ["127.0.0.1/32"]), true);
    assert.equal(arBetroddAdress("::ffff:127.0.0.1", ["127.0.0.1/32"]), true);
  });
});

describe("versionArNyare", () => {
  test("a genuinely higher version is newer", () => {
    assert.equal(versionArNyare("0.1.10", "0.1.9"), true);
    assert.equal(versionArNyare("0.2.0", "0.1.9"), true);
    assert.equal(versionArNyare("1.0.0", "0.9.9"), true);
  });
  test("not a naive string compare - 0.1.9 is not newer than 0.1.10", () => {
    assert.equal(versionArNyare("0.1.9", "0.1.10"), false);
  });
  test("an equal or lower version is not newer", () => {
    assert.equal(versionArNyare("0.1.9", "0.1.9"), false);
    assert.equal(versionArNyare("0.1.8", "0.1.9"), false);
  });
  test("missing/non-numeric input is never newer", () => {
    assert.equal(versionArNyare(null, "0.1.9"), false);
    assert.equal(versionArNyare("not-a-version", "0.1.9"), false);
  });
});

describe("rensaObjektTyp", () => {
  test("accepts every known object type", () => {
    for (const typ of Object.keys(OBJEKT_TYPER)) assert.equal(rensaObjektTyp(typ), typ);
  });
  test("falls back to tree for anything unrecognized", () => {
    assert.equal(rensaObjektTyp("spaceship"), "tree");
    assert.equal(rensaObjektTyp(undefined), "tree");
    assert.equal(rensaObjektTyp(""), "tree");
  });
});

describe("snappaRotation", () => {
  test("snaps to the nearest 15° step by default", () => {
    assert.equal(snappaRotation(7), 0);
    assert.equal(snappaRotation(8), 15);
    assert.equal(snappaRotation(44), 45);
  });
  test("wraps to 0 rather than 360 when rounding up past the top", () => {
    assert.equal(snappaRotation(358), 0);
  });
  test("negative input normalizes into 0-359 first", () => {
    assert.equal(snappaRotation(-8), 345); // -8 == 352 mod 360, nearest step is 345
    assert.equal(snappaRotation(-22), 345); // -22 == 338 mod 360, nearest step is 345
  });
  test("respects a custom step", () => {
    assert.equal(snappaRotation(40, 90), 0);
    assert.equal(snappaRotation(50, 90), 90);
  });
  test("non-numeric input is treated as 0", () => {
    assert.equal(snappaRotation(NaN), 0);
    assert.equal(snappaRotation(undefined), 0);
  });
});

describe("vaxtfamiljFor", () => {
  test("matches known crops to their family, case-insensitively", () => {
    assert.equal(vaxtfamiljFor("Tomat"), "nattskott");
    assert.equal(vaxtfamiljFor("potatis"), "nattskott");
    assert.equal(vaxtfamiljFor("Grönkål"), "kal");
    assert.equal(vaxtfamiljFor("Gurkor"), "gurkvaxter");
    assert.equal(vaxtfamiljFor("Morötter"), "rotfrukter");
  });
  test("an unrecognized or empty name has no family - never a guess", () => {
    assert.equal(vaxtfamiljFor("Marsianska bönplantor från Xylo"), null);
    assert.equal(vaxtfamiljFor(""), null);
    assert.equal(vaxtfamiljFor(undefined), null);
  });
  test("compound names aren't misclassified by a false substring match", () => {
    // Jordärtskocka/Kronärtskocka (Jerusalem/globe artichoke, both
    // thistles) contain "ärt" but are not legumes; Potatislök (a shallot)
    // contains "potatis" but is not a nightshade.
    assert.equal(vaxtfamiljFor("Jordärtskocka"), "korgblommiga");
    assert.equal(vaxtfamiljFor("Kronärtskocka"), "korgblommiga");
    assert.equal(vaxtfamiljFor("Potatislök"), "lokvaxter");
    // Legitimate compounds still work: these really are what they contain.
    assert.equal(vaxtfamiljFor("Sockerärt"), "baljvaxter");
    assert.equal(vaxtfamiljFor("Purjolök"), "lokvaxter");
  });
});

describe("skordFamiljVarning", () => {
  const nu = new Date(Date.UTC(2026, 7, 7)); // 2026-08-07

  test("warns when the same family was harvested here inside its rest period", () => {
    const historik = [{ namn: "Tomat", arkiveradDatum: new Date(Date.UTC(2026, 1, 7)).toISOString() }]; // 6 months ago
    const v = skordFamiljVarning(historik, "Potatis", nu);
    assert.ok(v, "expected a warning - potatoes after tomatoes, both nightshades");
    assert.equal(v.familj, "nattskott");
    assert.equal(v.senastNamn, "Tomat");
    assert.equal(v.vilaAr, 3);
    assert.ok(Math.abs(v.arSedan - 0.5) < 0.05, `expected ~0.5 years, got ${v.arSedan}`);
  });

  test("no warning once the family's rest period has passed", () => {
    const historik = [{ namn: "Tomat", arkiveradDatum: new Date(Date.UTC(2022, 7, 1)).toISOString() }]; // 4 years ago
    assert.equal(skordFamiljVarning(historik, "Potatis", nu), null);
  });

  test("no warning for a different family in the history", () => {
    const historik = [{ namn: "Morötter", arkiveradDatum: new Date(Date.UTC(2026, 5, 1)).toISOString() }];
    assert.equal(skordFamiljVarning(historik, "Tomat", nu), null);
  });

  test("no warning for an unclassifiable name, regardless of history", () => {
    const historik = [{ namn: "Tomat", arkiveradDatum: new Date(Date.UTC(2026, 5, 1)).toISOString() }];
    assert.equal(skordFamiljVarning(historik, "Något okänt", nu), null);
  });

  test("no warning for an empty or unrelated zone history", () => {
    assert.equal(skordFamiljVarning([], "Tomat", nu), null);
    assert.equal(skordFamiljVarning(undefined, "Tomat", nu), null);
  });

  test("uses the most recent same-family entry when there are several", () => {
    const historik = [
      { namn: "Potatis", arkiveradDatum: new Date(Date.UTC(2021, 0, 1)).toISOString() }, // long ago
      { namn: "Paprika", arkiveradDatum: new Date(Date.UTC(2026, 6, 1)).toISOString() }, // 1 month ago
    ];
    const v = skordFamiljVarning(historik, "Tomat", nu);
    assert.equal(v.senastNamn, "Paprika");
  });

  test("every family in VAXT_FAMILJER has a positive integer vilaAr", () => {
    for (const info of Object.values(VAXT_FAMILJER)) {
      assert.ok(Number.isInteger(info.vilaAr) && info.vilaAr > 0, `bad vilaAr for ${info.namn}`);
    }
  });
});
