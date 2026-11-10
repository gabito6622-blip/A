import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, fullSchedule, future, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent, support: Agent, rec: Agent;
let sterilizerId: string;
beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  support = await login(env.app, (await addUser(env.db, K.clinicId, "support", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  sterilizerId = (await owner.post("/api/biosafety/sterilizers", { branchId: K.branches[0], name: "Autoclave 1" })).body.id;
});
afterAll(async () => teardown(env));

describe("bioseguridad", () => {
  it("el rol de limpieza solo accede a bioseguridad (sin datos de pacientes)", async () => {
    expect((await support.get(`/api/biosafety/today?branchId=${K.branches[0]}`)).status).toBe(200);
    expect((await support.get("/api/patients")).status).toBe(403);
    expect((await support.get(`/api/appointments?from=${future(0, 0)}&to=${future(1, 0)}`)).status).toBe(403);
    expect((await support.get("/api/reports/dashboard")).status).toBe(403);
    // y no ve otras sucursales
    expect((await support.get(`/api/biosafety/today?branchId=${K.branches[1]}`)).status).toBe(403);
  });

  it("cuenta limpiezas pendientes por pacientes atendidos en cada consultorio", async () => {
    const dent = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
    await fullSchedule(env.db, K.clinicId, dent.id, K.branches[0]!);
    const chair = K.chairs[0]![0]!;
    // dos pacientes atendidos hoy en el consultorio 1 (insertados directo con hora de hoy)
    for (let i = 0; i < 2; i++) {
      const p = await createPatient(owner);
      await env.db.adminPool.query(
        `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, starts_at, ends_at, status)
         VALUES ($1,$2,$3,$4,$5, date_trunc('day', now() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz' + make_interval(hours => 8 + $6), date_trunc('day', now() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz' + make_interval(hours => 8 + $6, mins => 30), 'completed')`,
        [K.clinicId, K.branches[0], chair, dent.id, p, i]);
    }
    let t = (await support.get(`/api/biosafety/today?branchId=${K.branches[0]}`)).body;
    let c1 = t.chairs.find((c: any) => c.chairId === chair);
    expect(c1).toMatchObject({ patientsSeen: 2, betweenDone: 0, betweenPending: 2, startDone: false });
    await support.post("/api/biosafety/cleanings", { branchId: K.branches[0], chairId: chair, task: "start_of_day" });
    await support.post("/api/biosafety/cleanings", { branchId: K.branches[0], chairId: chair, task: "between_patients" });
    t = (await support.get(`/api/biosafety/today?branchId=${K.branches[0]}`)).body;
    c1 = t.chairs.find((c: any) => c.chairId === chair);
    expect(c1).toMatchObject({ startDone: true, betweenDone: 1, betweenPending: 1 });
  });

  it("valida consultorio de la sucursal y área", async () => {
    expect((await support.post("/api/biosafety/cleanings", { branchId: K.branches[0], task: "end_of_day" })).status).toBe(400);
    expect((await support.post("/api/biosafety/cleanings", { branchId: K.branches[0], chairId: K.chairs[1]![0], task: "end_of_day" })).status).toBe(400);
    expect((await support.post("/api/biosafety/cleanings", { branchId: K.branches[0], area: "Baños", task: "waste_disposal" })).status).toBe(200);
  });

  it("los ciclos llevan número correlativo por equipo y alertan si el indicador falla", async () => {
    const a = await support.post("/api/biosafety/cycles", { sterilizerId, program: "134C", temperatureC: 134, durationMin: 18, loadDescription: "Kits", packages: 4, chemicalIndicator: "pass" });
    const b = await support.post("/api/biosafety/cycles", { sterilizerId, program: "121C", loadDescription: "Turbinas", chemicalIndicator: "fail" });
    expect(a.body.cycleNumber).toBe(1);
    expect(b.body.cycleNumber).toBe(2);
    expect(b.body.alert).toMatch(/No uses ese material/);
    expect((await support.post("/api/biosafety/cycles", { sterilizerId, program: "134C", temperatureC: 400, loadDescription: "X", chemicalIndicator: "pass" })).status).toBe(400);
    const t = (await support.get(`/api/biosafety/today?branchId=${K.branches[0]}`)).body;
    expect(t.sterilization.failed.map((f: any) => f.cycleNumber)).toContain(2);
    expect(t.sterilization.pendingBio).toBe(2);
  });

  it("el indicador biológico se registra una sola vez y un positivo genera alerta", async () => {
    const cy = await support.post("/api/biosafety/cycles", { sterilizerId, program: "134C", loadDescription: "Fórceps", chemicalIndicator: "pass" });
    const r = await support.post(`/api/biosafety/cycles/${cy.body.id}/bio`, { result: "fail" });
    expect(r.body.alert).toMatch(/Suspende su uso/);
    expect((await support.post(`/api/biosafety/cycles/${cy.body.id}/bio`, { result: "pass" })).status).toBe(409);
    const audit = await env.db.adminPool.query("SELECT 1 FROM audit_log WHERE clinic_id = $1 AND action = 'biosafety.bio_failed'", [K.clinicId]);
    expect(audit.rowCount).toBe(1);
  });

  it("los registros son inmutables y el libro se exporta a Excel", async () => {
    await expect(env.db.adminPool.query("UPDATE sterilization_cycles SET chemical_indicator = 'pass' WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM cleaning_logs WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
    const x = await env.app.inject({ method: "GET", url: `/api/biosafety/cycles.xlsx?branchId=${K.branches[0]}`, headers: { cookie: owner.cookie } });
    expect(x.statusCode).toBe(200);
    expect(String(x.headers["content-type"])).toMatch(/spreadsheetml/);
  });

  it("recepción no tiene acceso; solo administración registra equipos", async () => {
    expect((await rec.get(`/api/biosafety/today?branchId=${K.branches[0]}`)).status).toBe(403);
    expect((await support.post("/api/biosafety/sterilizers", { branchId: K.branches[0], name: "Otro" })).status).toBe(403);
  });

  it("aislamiento: otra clínica no ve los ciclos", async () => {
    const other = await createClinic(env.db);
    const n = await withTenant(env.db.appPool, { clinicId: other.clinicId, userId: null }, async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM sterilization_cycles")).rows[0].n);
    expect(n).toBe(0);
    const o = await login(env.app, (await addUser(env.db, other.clinicId, "admin", { allBranches: true })).email);
    const r = await o.post("/api/biosafety/cycles", { sterilizerId, program: "134C", loadDescription: "Kit X", chemicalIndicator: "pass" });
    expect(r.status).toBe(404);
  });
});
