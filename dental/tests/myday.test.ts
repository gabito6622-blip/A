import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, createClinic, createPatient, fullSchedule, login, setupEnv, teardown, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
beforeAll(async () => { env = await setupEnv(); K = await createClinic(env.db); });
afterAll(async () => teardown(env));

describe("mi día del profesional", () => {
  it("muestra solo sus pacientes de hoy, con alertas médicas, primera visita y pendientes", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const d1 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
    const d2 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
    for (const d of [d1, d2]) await fullSchedule(env.db, K.clinicId, d.id, K.branches[0]!);
    const dent = await login(env.app, d1.email);
    const p = await createPatient(owner, { firstName: "Alerta" });
    await dent.post(`/api/patients/${p}/medical-history`, { allergies: "Látex", anticoagulants: true });
    const other = await createPatient(owner, { firstName: "Ajeno" });
    const today = (h: number) => `SELECT (date_trunc('day', now() AT TIME ZONE 'America/La_Paz') + make_interval(hours => ${h})) AT TIME ZONE 'America/La_Paz' AS t`;
    const t1 = (await env.db.adminPool.query(today(23))).rows[0].t;
    for (const [dentist, pat] of [[d1.id, p], [d2.id, other]] as const) {
      await env.db.adminPool.query(
        "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5::timestamptz - interval '30 minutes', $5)",
        [K.clinicId, K.branches[0], dentist, pat, t1]);
    }
    const r = (await dent.get("/api/my-day")).body;
    expect(r.professional).toBe(true);
    expect(r.appointments).toHaveLength(1);
    expect(r.appointments[0]).toMatchObject({ patientName: expect.stringContaining("Alerta"), firstVisit: true });
    expect(r.appointments[0].alerts).toEqual(expect.arrayContaining(["Alergias: Látex", "Anticoagulantes"]));
  });

  it("para quien no atiende pacientes no devuelve agenda", async () => {
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
    expect((await rec.get("/api/my-day")).body).toEqual({ professional: false, appointments: [] });
  });
});
