import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { computeIndices, type PerioData } from "../server/src/lib/perio.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, dent: Agent, dent2: Agent, rec: Agent, asst: Agent, otherDent: Agent;
let patient: string;

const sites6 = (pd: number[], extra: Record<string, unknown> = {}) =>
  Object.fromEntries((["MB", "B", "DB", "ML", "L", "DL"] as const).map((s, i) => [s, { pd: pd[i] ?? null, rec: 0, ...extra }]));
const withTooth = (d: PerioData, tooth: number, t: object): PerioData => ({ ...d, teeth: { ...d.teeth, [tooth]: { ...(d.teeth[tooth] ?? {}), ...t } } });

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db, { name: "Otra clínica" });
  owner = await login(env.app, K.ownerEmail);
  dent = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] })).email);
  dent2 = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { allBranches: true })).email);
  asst = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
  otherDent = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
  patient = await createPatient(owner);
  // Odontograma: 18 extraído y 46 implante → se precargan en el periodontograma
  expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 18, condition: "missing", state: "existing" })).status).toBe(200);
  expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 46, condition: "implant", state: "completed" })).status).toBe(200);
});
afterAll(async () => teardown(env));

let first: { id: string; revision: number; data: PerioData };

describe("periodontograma: borrador, guardado automático y cierre", () => {
  it("inicia en blanco con ausentes e implantes tomados del odontograma", async () => {
    const r = await dent.post(`/api/patients/${patient}/perio-exams`, { branchId: K.branches[0], mode: "blank" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
    expect(r.body.prefilledFromOdontogram.sort()).toEqual([18, 46]);
    expect(r.body.data.teeth).toEqual({ "18": { missing: true }, "46": { implant: true } });
    expect(r.body.indices.teethPresent).toBe(31);
    expect(r.body.indices.sitesMeasured).toBe(0);
    first = r.body;
  });

  it("un solo borrador por paciente", async () => {
    const r = await dent2.post(`/api/patients/${patient}/perio-exams`, { branchId: K.branches[0], mode: "blank" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("perio_draft_exists");
  });

  it("guarda el borrador y devuelve los índices sobre los sitios medidos", async () => {
    let d = withTooth(first.data, 16, { mobility: 1, furcation: { B: 2 }, sites: sites6([5, 3, 6, 3, 2, 3]) });
    d = withTooth(d, 16, { sites: { ...d.teeth["16"]!.sites, MB: { pd: 5, rec: 1, bop: true, pl: true }, DB: { pd: 6, rec: 1, bop: true } } });
    d = withTooth(d, 11, { sites: sites6([2, 2, 2, 2, 2, 2]) });
    d = withTooth(d, 36, { sites: { ...sites6([7, 5, 3, 3, 3, 3]), MB: { pd: 7, rec: 2, bop: true } } });
    const r = await dent.put(`/api/perio-exams/${first.id}`, { revision: first.revision, data: d });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(first.revision + 1);
    expect(r.body.indices.sitesMeasured).toBe(18);
    expect(r.body.indices.bleeding).toEqual({ count: 3, denom: 18, pct: 16.7 });
    first = { ...first, revision: r.body.revision, data: d };
  });

  it("rechaza valores fuera de rango con mensaje claro y no guarda nada (no trunca)", async () => {
    const bad = withTooth(first.data, 17, { sites: { MB: { pd: 564 } } });
    const r = await dent.put(`/api/perio-exams/${first.id}`, { revision: first.revision, data: bad });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("perio_invalid");
    expect(r.body.error.message).toContain("Diente 17 MV: el sondaje va de 0 a 15 mm (recibido 564)");
    for (const [patch, rx] of [
      [{ sites: { MB: { pd: 16 } } }, /recibido 16/],
      [{ sites: { MB: { pd: 3.5 } } }, /entero/],
      [{ sites: { MB: { pd: 3, rec: -6 } } }, /recesión va de -5 a \+15 mm \(recibido -6\)/],
      [{ mobility: 4 }, /movilidad va de 0 a 3/],
      [{ furcation: { B: 4 } }, /furca V: el grado va de 0 a III/],
      [{ furcation: { L: 1 } }, /no tiene entrada de furca «L»/],
      [{ sites: { XX: { pd: 1 } } }, /sitio desconocido/],
    ] as const) {
      const x = await dent.put(`/api/perio-exams/${first.id}`, { revision: first.revision, data: withTooth(first.data, 17, patch) });
      expect(x.status, JSON.stringify(patch)).toBe(400);
      expect(x.body.error.message).toMatch(rx);
    }
    const x = await dent.put(`/api/perio-exams/${first.id}`, { revision: first.revision, data: { ...first.data, teeth: { ...first.data.teeth, "19": {} } } });
    expect(x.body.error.message).toMatch(/Pieza inválida/);
    const g = await dent.get(`/api/perio-exams/${first.id}`);
    expect(g.body.revision).toBe(first.revision);
    expect(g.body.data.teeth["17"]).toBeUndefined();
  });

  it("la base también rechaza rangos inválidos aunque se salte la API", async () => {
    await expect(env.db.adminPool.query(`UPDATE perio_exams SET data = jsonb_set(data, '{teeth,11,sites,MB,pd}', '20') WHERE id = $1`, [first.id]))
      .rejects.toThrow(/perio_data_check/);
  });

  it("guardado concurrente: una revisión vieja se rechaza (no pisa cambios en silencio)", async () => {
    const r = await dent2.put(`/api/perio-exams/${first.id}`, { revision: first.revision - 1, data: first.data });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("perio_revision_conflict");
  });

  it("asistente puede ver pero no escribir; recepción no puede leer; propietario no profesional tampoco", async () => {
    expect((await asst.get(`/api/perio-exams/${first.id}`)).status).toBe(200);
    expect((await asst.put(`/api/perio-exams/${first.id}`, { revision: first.revision, data: first.data })).status).toBe(403);
    expect((await rec.get(`/api/patients/${patient}/perio-exams`)).status).toBe(403);
    expect((await rec.get(`/api/perio-exams/${first.id}`)).status).toBe(403);
    expect((await rec.post(`/api/patients/${patient}/perio-exams`, { branchId: K.branches[0], mode: "blank" })).status).toBe(403);
    expect((await owner.get(`/api/perio-exams/${first.id}`)).status).toBe(403);
  });

  it("no se puede iniciar en una sucursal sin acceso", async () => {
    const p2 = await createPatient(owner);
    const r = await dent.post(`/api/patients/${p2}/perio-exams`, { branchId: K.branches[1], mode: "blank" });
    expect(r.status).toBe(403);
  });

  it("no cierra si hay marcas sin sondaje; el cierre guarda los últimos cambios en la misma transacción", async () => {
    const flagged = withTooth(first.data, 21, { sites: { B: { bop: true } } });
    const r = await dent.post(`/api/perio-exams/${first.id}/close`, { revision: first.revision, data: flagged });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/No se puede cerrar: Diente 21 V: tiene sangrado/);
    expect((await dent.get(`/api/perio-exams/${first.id}`)).body.status).toBe("draft");
    // último cambio pendiente (furca del 26) enviado junto con el cierre → no se pierde
    const final = withTooth(first.data, 26, { furcation: { DP: 1 } });
    const c = await dent.post(`/api/perio-exams/${first.id}/close`, { revision: first.revision, data: final, note: "Control en 3 meses" });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe("closed");
    expect(c.body.data.teeth["26"].furcation).toEqual({ DP: 1 });
    // mismo cálculo en el borrador y al cerrar
    expect(c.body.indices).toEqual(computeIndices(final));
    expect(c.body.indices.bleeding.pct).toBe(16.7);
    first = { ...first, revision: c.body.revision, data: final };
  });

  it("una exploración cerrada es inmutable (API, rol de la app y dueño de la base)", async () => {
    const r = await dent.put(`/api/perio-exams/${first.id}`, { revision: first.revision, data: first.data });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("perio_not_draft");
    expect((await dent.post(`/api/perio-exams/${first.id}/close`, { revision: first.revision })).status).toBe(409);
    expect((await dent.post(`/api/perio-exams/${first.id}/discard`, { reason: "probar" })).status).toBe(409);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) =>
      c.query("UPDATE perio_exams SET notes = 'x' WHERE id = $1", [first.id]))).rejects.toThrow(/inmutable/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) =>
      c.query("UPDATE perio_exams SET patient_id = patient_id WHERE id = $1", [first.id]))).rejects.toThrow(/permission denied/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) =>
      c.query("DELETE FROM perio_exams WHERE id = $1", [first.id]))).rejects.toThrow(/permission denied/);
    await expect(env.db.adminPool.query("UPDATE perio_exams SET data = '{\"v\":1,\"primary\":[],\"teeth\":{}}' WHERE id = $1", [first.id])).rejects.toThrow(/inmutable/);
    await expect(env.db.adminPool.query("DELETE FROM perio_exams WHERE id = $1", [first.id])).rejects.toThrow(/no se borran/);
  });

  it("no se cierra una exploración vacía", async () => {
    const p2 = await createPatient(owner);
    const r = await dent.post(`/api/patients/${p2}/perio-exams`, { branchId: K.branches[0], mode: "blank" });
    const c = await dent.post(`/api/perio-exams/${r.body.id}/close`, { revision: r.body.revision });
    expect(c.status).toBe(400);
    expect(c.body.error.message).toMatch(/exploración vacía/);
    // descartar: queda en el historial, no se borra
    expect((await dent.post(`/api/perio-exams/${r.body.id}/discard`, { reason: "" })).status).toBe(400);
    const d = await dent.post(`/api/perio-exams/${r.body.id}/discard`, { reason: "Paciente se retiró" });
    expect(d.status).toBe(200);
    expect(d.body.status).toBe("discarded");
    const list = await dent.get(`/api/patients/${p2}/perio-exams`);
    expect(list.body.map((x: any) => x.status)).toEqual(["discarded"]);
  });
});

let second: any;
describe("desde la anterior, enmiendas y comparación", () => {
  it("desde la anterior copia ausentes, implantes y movilidad, nunca sondajes", async () => {
    const r = await dent2.post(`/api/patients/${patient}/perio-exams`, { branchId: K.branches[0], mode: "previous" });
    expect(r.status).toBe(200);
    expect(r.body.origin).toBe("previous");
    expect(r.body.sourceExamId).toBe(first.id);
    expect(r.body.data.teeth).toEqual({ "18": { missing: true }, "46": { implant: true }, "16": { mobility: 1 } });
    expect(r.body.indices.sitesMeasured).toBe(0);
    second = r.body;
  });

  it("sin exploración cerrada anterior, «desde la anterior» se rechaza con explicación", async () => {
    const p2 = await createPatient(owner);
    const r = await dent.post(`/api/patients/${p2}/perio-exams`, { branchId: K.branches[0], mode: "previous" });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/no tiene una exploración cerrada anterior/);
  });

  it("compara por sitio (mejoró / empeoró / sin cambio) con diferencias de índices", async () => {
    let d: PerioData = second.data;
    d = withTooth(d, 16, { sites: { ...sites6([2, 3, 8, 3, 2, 3]), MB: { pd: 2, rec: 1 } } });  // MB 5→2 mejoró, DB 6→8 empeoró
    d = withTooth(d, 11, { sites: sites6([2, 2, 2, 2, 2, 3]) });                               // DL 2→3 sin cambio (1 mm)
    const s = await dent2.put(`/api/perio-exams/${second.id}`, { revision: second.revision, data: d });
    expect(s.status).toBe(200);
    const c = await dent.get(`/api/perio-exams/compare?a=${second.id}&b=${first.id}`);
    expect(c.status).toBe(200);
    expect(c.body.a.id).toBe(first.id);   // siempre a = la más antigua
    const at = (tooth: number, site: string) => c.body.comparison.sites.find((x: any) => x.tooth === tooth && x.site === site);
    expect(at(16, "MB")).toMatchObject({ pdA: 5, pdB: 2, delta: -3, status: "improved" });
    expect(at(16, "DB")).toMatchObject({ pdA: 6, pdB: 8, delta: 2, status: "worse" });
    expect(at(11, "DL")).toMatchObject({ delta: 1, status: "unchanged" });
    expect(at(36, "MB").status).toBe("not_comparable");
    expect(c.body.comparison.deltas.bleedingPct).toBe(-16.7);
    expect(c.body.comparison.indicesB.sitesMeasured).toBe(12);
    const c1 = await dent.get(`/api/perio-exams/compare?a=${first.id}&b=${second.id}&threshold=1`);
    expect(c1.body.comparison.threshold).toBe(1);
    expect(at(11, "DL").status).toBe("unchanged");
    expect(c1.body.comparison.sites.find((x: any) => x.tooth === 11 && x.site === "DL").status).toBe("worse");
    expect((await dent.get(`/api/perio-exams/compare?a=${first.id}&b=${second.id}&threshold=9`)).status).toBe(400);
    expect((await rec.get(`/api/perio-exams/compare?a=${first.id}&b=${second.id}`)).status).toBe(403);
  });

  it("no compara exploraciones de pacientes distintos", async () => {
    const p2 = await createPatient(owner);
    const r = await dent.post(`/api/patients/${p2}/perio-exams`, { branchId: K.branches[0], mode: "blank" });
    const c = await dent.get(`/api/perio-exams/compare?a=${first.id}&b=${r.body.id}`);
    expect(c.status).toBe(400);
  });

  it("corregir una cerrada = enmienda nueva con copia completa; una sola enmienda por exploración", async () => {
    // el paciente tiene un borrador abierto (la segunda exploración) → primero se cierra
    const cl = await dent2.post(`/api/perio-exams/${second.id}/close`, { revision: second.revision + 1 });
    expect(cl.status).toBe(200);
    expect((await dent.post(`/api/patients/${patient}/perio-exams`, { branchId: K.branches[0], mode: "amendment", sourceExamId: second.id }))
      .status).toBe(200);
    const list = (await dent.get(`/api/patients/${patient}/perio-exams`)).body;
    const amendment = list.find((x: any) => x.status === "draft");
    expect(amendment.origin).toBe("amendment");
    expect(amendment.amendsExamId).toBe(second.id);
    const full = (await dent.get(`/api/perio-exams/${amendment.id}`)).body;
    expect(full.data).toEqual((await dent.get(`/api/perio-exams/${second.id}`)).body.data);
    // corregir el 11 DL y cerrar la enmienda
    const fixed = withTooth(full.data, 11, { sites: { ...full.data.teeth["11"].sites, DL: { pd: 2, rec: 0 } } });
    const c = await dent.post(`/api/perio-exams/${amendment.id}/close`, { revision: full.revision, data: fixed, note: "Corrige 11 DL" });
    expect(c.status).toBe(200);
    const orig = (await dent.get(`/api/perio-exams/${second.id}`)).body;
    expect(orig.amendedBy).toEqual({ id: amendment.id, status: "closed" });
    expect(orig.data.teeth["11"].sites.DL.pd).toBe(3); // el original no cambia
    const again = await dent.post(`/api/patients/${patient}/perio-exams`, { branchId: K.branches[0], mode: "amendment", sourceExamId: second.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("perio_already_amended");
  });

  it("no se enmienda un borrador; la base exige que la enmendada esté cerrada", async () => {
    const p2 = await createPatient(owner);
    const d = await dent.post(`/api/patients/${p2}/perio-exams`, { branchId: K.branches[0], mode: "blank" });
    const r = await dent.post(`/api/patients/${p2}/perio-exams`, { branchId: K.branches[0], mode: "amendment", sourceExamId: d.body.id });
    expect([400, 409]).toContain(r.status);
    await expect(env.db.adminPool.query(
      `INSERT INTO perio_exams (clinic_id, patient_id, branch_id, examiner_id, origin, source_exam_id, amends_exam_id)
       SELECT clinic_id, patient_id, branch_id, examiner_id, 'amendment', id, id FROM perio_exams WHERE id = $1`, [d.body.id])).rejects.toThrow(/Solo se enmienda una exploración cerrada/);
  });

  it("todo queda en la auditoría, incluidas las consultas", async () => {
    const r = await env.db.adminPool.query<{ action: string }>("SELECT DISTINCT action FROM audit_log WHERE clinic_id = $1 AND action LIKE 'perio.%'", [K.clinicId]);
    expect(r.rows.map((x) => x.action).sort()).toEqual([
      "perio.amendment_started", "perio.closed", "perio.compared", "perio.discarded", "perio.list_viewed", "perio.saved", "perio.started", "perio.viewed",
    ]);
  });
});

describe("aislamiento entre clínicas (perio_exams)", () => {
  it("otra clínica no ve, no edita, no compara ni enmienda (404 sin revelar existencia)", async () => {
    expect((await otherDent.get(`/api/perio-exams/${first.id}`)).status).toBe(404);
    expect((await otherDent.get(`/api/patients/${patient}/perio-exams`)).status).toBe(404);
    expect((await otherDent.put(`/api/perio-exams/${second.id}`, { revision: 0, data: { v: 1, primary: [], teeth: {} } })).status).toBe(404);
    expect((await otherDent.post(`/api/perio-exams/${second.id}/close`, { revision: 0 })).status).toBe(404);
    expect((await otherDent.get(`/api/perio-exams/compare?a=${first.id}&b=${second.id}`)).status).toBe(404);
    expect((await otherDent.post(`/api/patients/${patient}/perio-exams`, { branchId: K2.branches[0], mode: "blank" })).status).toBe(404);
  });

  it("RLS: con el contexto de otra clínica las filas son invisibles y no se pueden insertar con clinic_id ajeno", async () => {
    const n = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM perio_exams")).rows[0].n);
    expect(n).toBe(0);
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) =>
      c.query(`INSERT INTO perio_exams (clinic_id, patient_id, branch_id, examiner_id, origin) VALUES ($1,$2,$3,$4,'blank')`,
        [K.clinicId, patient, K.branches[0], K.ownerId]))).rejects.toThrow(/row-level security/);
    // FK compuesta: un paciente de otra clínica no puede usarse aunque el clinic_id sea el propio
    await expect(env.db.adminPool.query(`INSERT INTO perio_exams (clinic_id, patient_id, branch_id, examiner_id, origin) VALUES ($1,$2,$3,$4,'blank')`,
      [K2.clinicId, patient, K2.branches[0], K2.ownerId])).rejects.toThrow(/foreign key/);
  });
});
