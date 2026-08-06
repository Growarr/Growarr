import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rensaAntal, rensaLayout, rensaHojdM, STANDARD_HOJD_M,
  torkTakt, veckodagarForIntervall, enhetArFuktsensor,
  samlaEntitetIdI, tillYaml, haAutomationObjektId, haMetrikEntitetId,
  stockholmManad, stockholmDatum, lokalTimme,
} from "../src/logic.js";

describe("rensaAntal", () => {
  test("rundar och accepterar giltiga tal", () => {
    assert.equal(rensaAntal(6), 6);
    assert.equal(rensaAntal("6"), 6);
    assert.equal(rensaAntal(6.4), 6);
    assert.equal(rensaAntal(6.6), 7);
  });
  test("faller tillbaka på 1 för ogiltig indata", () => {
    assert.equal(rensaAntal(0), 1);
    assert.equal(rensaAntal(-5), 1);
    assert.equal(rensaAntal(NaN), 1);
    assert.equal(rensaAntal("blomma"), 1);
    assert.equal(rensaAntal(undefined), 1);
  });
  test("taket ligger på 200, en felskrivning ritar inte ut tiotusen ikoner", () => {
    assert.equal(rensaAntal(10000), 200);
    assert.equal(rensaAntal(200), 200);
    assert.equal(rensaAntal(201), 200);
  });
});

describe("rensaLayout", () => {
  test("bara \"fyll\" accepteras som fyll, allt annat blir klunga", () => {
    assert.equal(rensaLayout("fyll"), "fyll");
    assert.equal(rensaLayout("klunga"), "klunga");
    assert.equal(rensaLayout("nagot-pahittat"), "klunga");
    assert.equal(rensaLayout(undefined), "klunga");
  });
});

describe("rensaHojdM", () => {
  test("faller tillbaka på typens standardhöjd för ogiltig indata", () => {
    assert.equal(rensaHojdM(undefined, "vaxthus"), STANDARD_HOJD_M.vaxthus);
    assert.equal(rensaHojdM(-1, "odlingslada"), STANDARD_HOJD_M.odlingslada);
    assert.equal(rensaHojdM(NaN, "annat"), STANDARD_HOJD_M.annat);
  });
  test("okänd typ faller tillbaka på 0", () => {
    assert.equal(rensaHojdM(undefined, "pahittad-typ"), 0);
  });
  test("rundar till två decimaler och tar taket på 20 m", () => {
    assert.equal(rensaHojdM(1.2345, "annat"), 1.23);
    assert.equal(rensaHojdM(50, "vaxthus"), 20);
  });
});

describe("torkTakt", () => {
  test("null med för få mätpunkter (< 6)", () => {
    const punkter = [
      { tid: "2026-08-01T00:00:00Z", varde: 40 },
      { tid: "2026-08-02T00:00:00Z", varde: 38 },
    ];
    assert.equal(torkTakt(punkter), null);
  });
  test("negativ lutning för jord som torkar ut, i %/dygn", () => {
    // Exakt 2 %/dygn nedgång under 6 dygn.
    const punkter = Array.from({ length: 6 }, (_, i) => ({
      tid: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      varde: 50 - i * 2,
    }));
    const lutning = torkTakt(punkter);
    assert.ok(lutning < 0, "lutningen ska vara negativ när jorden torkar");
    assert.ok(Math.abs(lutning - -2) < 0.01, `förväntade ~-2, fick ${lutning}`);
  });
  test("positiv lutning när jorden blir fuktigare", () => {
    const punkter = Array.from({ length: 6 }, (_, i) => ({
      tid: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      varde: 20 + i * 3,
    }));
    assert.ok(torkTakt(punkter) > 0);
  });
  test("null när mätvärdena inte är numeriska", () => {
    const punkter = Array.from({ length: 6 }, (_, i) => ({
      tid: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      varde: "trasig-sensor",
    }));
    assert.equal(torkTakt(punkter), null);
  });
});

describe("veckodagarForIntervall", () => {
  test("varje dag när intervallet är 1 eller mindre", () => {
    assert.deepEqual(veckodagarForIntervall(1), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(veckodagarForIntervall(0), [0, 1, 2, 3, 4, 5, 6]);
  });
  test("glesare mönster för längre intervall", () => {
    assert.deepEqual(veckodagarForIntervall(2), [1, 3, 5]);
    assert.deepEqual(veckodagarForIntervall(3), [1, 4]);
    assert.deepEqual(veckodagarForIntervall(5), [1, 5]);
    assert.deepEqual(veckodagarForIntervall(7), [3]);
  });
});

describe("enhetArFuktsensor", () => {
  test("känner igen fukt/moist/humid i namnet, oavsett skiftläge", () => {
    assert.equal(enhetArFuktsensor({ namn: "Jordfuktighet växthus" }), true);
    assert.equal(enhetArFuktsensor({ namn: "Soil Moisture Sensor" }), true);
    assert.equal(enhetArFuktsensor({ namn: "Humidity outdoor" }), true);
    assert.equal(enhetArFuktsensor({ namn: "Temperatur ute" }), false);
    assert.equal(enhetArFuktsensor({ namn: "" }), false);
    assert.equal(enhetArFuktsensor({}), false);
  });
});

describe("samlaEntitetIdI - kärnan i valideringen mot påhittade entiteter", () => {
  test("hittar entity_id som sträng, i lista, och godtyckligt djupt nästlat", () => {
    const trad = {
      trigger: [{ entity_id: "sensor.jord_1" }],
      condition: [{ entity_id: ["sensor.jord_2", "sensor.jord_3"] }],
      action: [{ nested: { deeper: { entity_id: "switch.pump" } } }],
    };
    const ids = samlaEntitetIdI(trad);
    assert.deepEqual([...ids].sort(), ["sensor.jord_1", "sensor.jord_2", "sensor.jord_3", "switch.pump"]);
  });
  test("tom struktur ger tom mängd", () => {
    assert.equal(samlaEntitetIdI({}).size, 0);
    assert.equal(samlaEntitetIdI([]).size, 0);
  });
  test("ignorerar icke-sträng-värden i en entity_id-lista", () => {
    const ids = samlaEntitetIdI({ entity_id: ["sensor.ok", 123, null] });
    assert.deepEqual([...ids], ["sensor.ok"]);
  });
});

describe("tillYaml", () => {
  test("enkla nyckel/värde-par", () => {
    assert.equal(tillYaml({ alias: "Vattna", mode: "single" }), "alias: Vattna\nmode: single");
  });
  test("strängar som skulle misstolkas som YAML-syntax citeras", () => {
    assert.equal(tillYaml({ text: "Ja: verkligen" }), 'text: "Ja: verkligen"');
    assert.equal(tillYaml({ text: "" }), 'text: ""');
  });
  test("listor av objekt indenteras som HA:s egen YAML", () => {
    const yaml = tillYaml({ trigger: [{ platform: "state", entity_id: "sensor.a" }] });
    assert.equal(yaml, "trigger:\n  - platform: state\n    entity_id: sensor.a");
  });
  test("tom lista under en nyckel radbryts, sen []", () => {
    assert.equal(tillYaml({ condition: [] }), "condition:\n  []");
  });
});

describe("haAutomationObjektId", () => {
  test("plockar ut object_id-delen av entity_id", () => {
    assert.equal(haAutomationObjektId("automation.vattna_vaxthus"), "vattna_vaxthus");
  });
  test("null för allt som inte är en automation-entitet", () => {
    assert.equal(haAutomationObjektId("sensor.jord_1"), null);
    assert.equal(haAutomationObjektId(undefined), null);
  });
});

describe("haMetrikEntitetId", () => {
  test("bygger ett giltigt sensor-entity_id från ett godtyckligt zonId", () => {
    assert.equal(haMetrikEntitetId("zon-1"), "sensor.growarr_zon_1_dagar_till_torrt");
  });
  test("städar bort tecken som inte är giltiga i ett HA-entity_id", () => {
    assert.equal(haMetrikEntitetId("Växthus Ö!"), "sensor.growarr_v_xthus_dagar_till_torrt");
  });
});

describe("datum/tid-hjälpare (Europe/Stockholm, sommartid UTC+2 i augusti)", () => {
  test("stockholmManad ger ÅÅÅÅ-MM i lokal tid", () => {
    assert.equal(stockholmManad(new Date("2026-08-06T10:00:00Z")), "2026-08");
  });
  test("stockholmDatum lägger till dagen, och kan hoppa till nästa dag jämfört med UTC", () => {
    assert.equal(stockholmDatum(new Date("2026-08-06T10:00:00Z")), "2026-08-06");
    // 23:00 UTC en augustikväll är redan 01:00 nästa dag i Stockholm (UTC+2).
    assert.equal(stockholmDatum(new Date("2026-08-06T23:00:00Z")), "2026-08-07");
  });
  test("lokalTimme räknar om till lokal timme", () => {
    assert.equal(lokalTimme("2026-08-06T10:00:00Z"), 12);
  });
});
