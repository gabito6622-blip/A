import { describe, expect, it } from "vitest";
import {
  PERMANENT_TEETH, compareExams, computeIndices, emptyPerio, orderDescription, probingSequence, siteLabel, validatePerio,
  type PerioData, type Site,
} from "../server/src/lib/perio.js";
import { copyFromPrevious } from "../server/src/modules/perio.js";

const S: Site[] = ["MB", "B", "DB", "ML", "L", "DL"];
/** Arma un periodontograma con sondajes por pieza (6 valores) y marcas opcionales. */
function mk(teeth: Record<number, { pd?: (number | null)[]; rec?: (number | null)[]; bop?: number[]; pl?: number[]; sup?: number[]; missing?: boolean; implant?: boolean; mobility?: number }>): PerioData {
  const d = emptyPerio();
  for (const [k, t] of Object.entries(teeth)) {
    const x: any = (d.teeth[k] = {});
    if (t.missing) x.missing = true;
    if (t.implant) x.implant = true;
    if (t.mobility != null) x.mobility = t.mobility;
    if (t.pd || t.rec) {
      x.sites = {};
      S.forEach((s, i) => {
        const pd = t.pd?.[i] ?? null, rec = t.rec?.[i] ?? null;
        if (pd == null && rec == null && !t.bop?.includes(i) && !t.pl?.includes(i)) return;
        x.sites[s] = { pd, rec, bop: !!t.bop?.includes(i), pl: !!t.pl?.includes(i), sup: !!t.sup?.includes(i) };
      });
    }
  }
  return d;
}

describe("índices periodontales (sobre sitios medidos de dientes presentes)", () => {
  it("trampa de Panel Dental: 18 sitios medidos no se dividen entre 192", () => {
    // 3 dientes con 6 sitios = 18 sitios medidos; 3 con sangrado y 1 con placa
    const d = mk({
      16: { pd: [5, 3, 6, 3, 2, 3], rec: [1, 0, 1, 0, 0, 0], bop: [0, 2] , pl: [0] },
      11: { pd: [2, 2, 2, 2, 2, 2], rec: [0, 0, 0, 0, 0, 0] },
      36: { pd: [7, 5, 3, 3, 3, 3], rec: [2, 1, 0, 0, 0, 0], bop: [0] },
    });
    const ix = computeIndices(d);
    expect(ix.sitesMeasured).toBe(18);
    expect(ix.bleeding).toEqual({ count: 3, denom: 18, pct: 16.7 });   // no 1,6 % (3/192)
    expect(ix.plaque).toEqual({ count: 1, denom: 18, pct: 5.6 });      // no 0,5 % (1/192)
    expect(ix.bleeding.pct).not.toBe(Math.round((3 / 192) * 1000) / 10);
    // sondaje medio: (22 + 12 + 24) / 18
    expect(ix.meanPd).toEqual({ value: 3.22, denom: 18 });
    // NIC = sondaje + recesión: (22+2)+(12+0)+(24+3) = 63 / 18
    expect(ix.meanCal).toEqual({ value: 3.5, denom: 18 });
    // sitios y dientes con bolsa: ≥4 → 16-MV 5, 16-DV 6, 36-MV 7, 36-V 5 = 4 sitios en 2 dientes
    expect(ix.pd4).toEqual({ sites: 4, teeth: 2 });
    expect(ix.pd6).toEqual({ sites: 2, teeth: 2 });
    expect(ix.teethPresent).toBe(32);
    expect(ix.teethMeasured).toBe(3);
  });

  it("excluye ausentes del denominador de dientes presentes y sin datos devuelve null (no 0 %)", () => {
    const ix = computeIndices(mk({ 18: { missing: true }, 28: { missing: true } }));
    expect(ix.teethPresent).toBe(30);
    expect(ix.sitesPossible).toBe(180);
    expect(ix.sitesMeasured).toBe(0);
    expect(ix.bleeding.pct).toBeNull();
    expect(ix.meanPd.value).toBeNull();
  });

  it("NIC solo con sondaje y recesión, nunca en implantes; recesión negativa resta", () => {
    const d = mk({
      21: { pd: [4, 3], rec: [-2, null] },     // NIC 2 en MV; V sin recesión no cuenta para NIC
      46: { implant: true, pd: [6], rec: [1] }, // implante: cuenta el sondaje, no el NIC
    });
    const ix = computeIndices(d);
    expect(ix.sitesMeasured).toBe(3);
    expect(ix.meanCal).toEqual({ value: 2, denom: 1 });
    expect(ix.meanPd.value).toBeCloseTo(13 / 3, 2);
    expect(ix.pd6).toEqual({ sites: 1, teeth: 1 });
  });

  it("las marcas en sitios sin sondaje no cuentan y se informan", () => {
    const d = mk({ 11: { pd: [3], bop: [0] } });
    d.teeth["11"]!.sites!.B = { pd: null, bop: true };
    const ix = computeIndices(d);
    expect(ix.bleeding).toEqual({ count: 1, denom: 1, pct: 100 });
    expect(ix.ignoredMarks).toBe(1);
  });

  it("la dentición temporal ocupa la posición de la permanente", () => {
    const d = mk({ 55: { pd: [2, 2, 2, 2, 2, 2] } });
    d.primary = [55];
    expect(validatePerio(d)).toEqual([]);
    const ix = computeIndices(d);
    expect(ix.teethPresent).toBe(32);
    expect(ix.sitesMeasured).toBe(6);
  });
});

describe("validación (rechaza, nunca recorta)", () => {
  it("acepta un periodontograma vacío y uno completo", () => {
    expect(validatePerio(emptyPerio())).toEqual([]);
    const full = mk(Object.fromEntries(PERMANENT_TEETH.map((t) => [t, { pd: [3, 2, 3, 3, 2, 3], rec: [0, 0, 0, 0, 0, 0] }])));
    expect(validatePerio(full, { forClose: true })).toEqual([]);
    expect(computeIndices(full).sitesMeasured).toBe(192);
  });

  it("el «564» de Panel Dental y otros fuera de rango se rechazan con pieza, sitio, rango y valor", () => {
    const d = mk({ 16: { pd: [564] } });
    expect(validatePerio(d)).toEqual([{ path: "teeth.16.sites.MB.pd", message: "Diente 16 MV: el sondaje va de 0 a 15 mm (recibido 564)" }]);
    expect(validatePerio(mk({ 16: { pd: [16] } }))[0]!.message).toMatch(/0 a 15 mm \(recibido 16\)/);
    expect(validatePerio(mk({ 16: { pd: [-1] } }))[0]!.message).toMatch(/recibido -1/);
    expect(validatePerio(mk({ 16: { pd: [2.5] } }))[0]!.message).toMatch(/entero/);
    expect(validatePerio(mk({ 26: { rec: [null, null, null, -6] } }))[0]!.message).toBe("Diente 26 MP: la recesión va de -5 a +15 mm (recibido -6)");
    expect(validatePerio(mk({ 11: { mobility: 4 } }))[0]!.message).toMatch(/movilidad va de 0 a 3/);
  });

  it("furca solo en las entradas que existen y de 0 a III", () => {
    const d = emptyPerio();
    d.teeth["16"] = { furcation: { B: 2, MP: 1, DP: 3 } };
    d.teeth["46"] = { furcation: { B: 1, L: 0 } };
    d.teeth["14"] = { furcation: { M: 1, D: 1 } };
    expect(validatePerio(d)).toEqual([]);
    d.teeth["11"] = { furcation: { B: 1 } };
    d.teeth["36"] = { furcation: { B: 4 } };
    const msgs = validatePerio(d).map((i) => i.message);
    expect(msgs).toContain("Diente 11: no tiene entrada de furca «B»");
    expect(msgs).toContain("Diente 36, furca V: el grado va de 0 a III (recibido 4)");
  });

  it("piezas, sitios y campos desconocidos; ausente con mediciones; ausente e implante a la vez", () => {
    const d: any = emptyPerio();
    d.teeth["19"] = {};
    d.teeth["11"] = { sites: { X: { pd: 2 } } };
    d.teeth["12"] = { missing: true, sites: { MB: { pd: 3 } } };
    d.teeth["13"] = { missing: true, implant: true };
    d.teeth["14"] = { color: "rojo" };
    const msgs = validatePerio(d).map((i: any) => i.message);
    expect(msgs).toEqual(expect.arrayContaining([
      "Pieza inválida (notación FDI): 19",
      expect.stringMatching(/sitio desconocido «X»/),
      "Diente 12: está marcado como ausente y tiene mediciones. Bórralas o quita «ausente».",
      "Diente 13: no puede estar ausente y ser implante a la vez",
      "Diente 14: campo desconocido «color»",
    ]));
  });

  it("para cerrar: al menos un sitio medido y sin marcas en sitios sin sondaje", () => {
    expect(validatePerio(emptyPerio(), { forClose: true })[0]!.message).toMatch(/exploración vacía/);
    const d = mk({ 11: { pd: [3] } });
    d.teeth["11"]!.sites!.B = { bop: true };
    expect(validatePerio(d)).toEqual([]);
    expect(validatePerio(d, { forClose: true })[0]!.message).toMatch(/Diente 11 V: tiene sangrado.*sin sondaje|no tiene sondaje/);
  });
});

describe("comparación entre exploraciones", () => {
  it("clasifica por sitio con umbral y calcula diferencias de índices", () => {
    const a = mk({ 16: { pd: [6, 4, 5, 3, 3, 3], bop: [0, 1, 2] }, 11: { pd: [2, 2, 2, 2, 2, 2] }, 21: { pd: [3] } });
    const b = mk({ 16: { pd: [3, 4, 7, 2, 3, 3], bop: [2] }, 11: { missing: true }, 22: { pd: [3] } });
    const c = compareExams(a, b, 2);
    const at = (tooth: number, site: Site) => c.sites.find((x) => x.tooth === tooth && x.site === site)!;
    expect(at(16, "MB")).toMatchObject({ pdA: 6, pdB: 3, delta: -3, status: "improved" });
    expect(at(16, "DB")).toMatchObject({ delta: 2, status: "worse" });
    expect(at(16, "ML")).toMatchObject({ delta: -1, status: "unchanged" });   // 1 mm: dentro del error de medición
    expect(at(11, "MB").status).toBe("not_comparable");                    // ausente después
    expect(at(21, "MB").status).toBe("not_comparable");                    // no medido después
    expect(c.counts).toEqual({ improved: 1, worse: 1, unchanged: 4, not_comparable: 186 });
    expect(compareExams(a, b, 1).counts.improved).toBe(2);
    expect(c.deltas.bleedingPct).toBe(-8.8); // 14,3 % (1/7) − 23,1 % (3/13)
    expect(c.deltas.pd6Sites).toBe(1 - 1);
  });
});

describe("orden de sondaje y copia desde la anterior", () => {
  it("orden estándar: 18→28 vestibular, 28→18 palatino, 48→38 lingual, 38→48 vestibular", () => {
    const seq = probingSequence("standard");
    expect(seq).toHaveLength(192);
    expect(seq.slice(0, 4)).toEqual([{ tooth: 18, site: "DB" }, { tooth: 18, site: "B" }, { tooth: 18, site: "MB" }, { tooth: 17, site: "DB" }]);
    expect(seq.slice(23, 27)).toEqual([{ tooth: 11, site: "MB" }, { tooth: 21, site: "MB" }, { tooth: 21, site: "B" }, { tooth: 21, site: "DB" }]);
    expect(seq[48]).toEqual({ tooth: 28, site: "DL" });
    expect(seq[96]).toEqual({ tooth: 48, site: "DL" });
    expect(seq[144]).toEqual({ tooth: 38, site: "DB" });
    expect(seq[191]).toEqual({ tooth: 48, site: "DB" });
    expect(new Set(seq.map((x) => `${x.tooth}${x.site}`)).size).toBe(192);
    expect(orderDescription("standard")).toEqual(["18→28 vestibular", "28→18 palatino", "48→38 lingual", "38→48 vestibular"]);
  });
  it("los otros órdenes también cubren los 192 sitios sin repetir; los temporales reemplazan su posición", () => {
    for (const p of ["quadrant", "buccal_first"] as const) expect(new Set(probingSequence(p).map((x) => `${x.tooth}${x.site}`)).size).toBe(192);
    expect(probingSequence("standard", [55]).filter((x) => x.tooth === 55)).toHaveLength(6);
    expect(siteLabel(16, "ML")).toBe("MP");
    expect(siteLabel(36, "ML")).toBe("ML");
  });
  it("desde la anterior copia ausentes, implantes y movilidad; nunca sondajes, recesión, marcas, furca ni pronóstico", () => {
    const prev = mk({ 18: { missing: true }, 46: { implant: true, pd: [5] }, 16: { mobility: 2, pd: [6, 6, 6], rec: [1, 1, 1], bop: [0] } });
    prev.teeth["16"]!.furcation = { B: 2 };
    prev.teeth["16"]!.prognosis = "fair";
    const n = copyFromPrevious(prev);
    expect(n.teeth).toEqual({ "18": { missing: true }, "46": { implant: true }, "16": { mobility: 2 } });
    expect(computeIndices(n).sitesMeasured).toBe(0);
  });
});
