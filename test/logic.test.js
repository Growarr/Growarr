import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rensaAntal, rensaLayout, rensaHojdM, STANDARD_HOJD_M,
  torkTakt, veckodagarForIntervall, enhetArFuktsensor,
  stockholmManad, stockholmDatum, lokalTimme,
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
