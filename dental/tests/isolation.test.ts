import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, fullSchedule, future, login, setupEnv, teardown, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let A: TestClinic, B: TestClinic;
let patientB: string;
beforeAll(async () => {
  env = await setupEnv();
  A = await createClinic(env.db, { name: "Clínica A" });
  B = await createClinic(env.db, { name: "Clínica B" });
  patientB = await createPatient(await login(env.app, B.ownerEmail), { firstName: "Secreto", lastName: "DeB" });
});
afterAll(async () => teardown(env));

describe("aislamiento estricto entre clínicas", () => {
  it("la API de A no ve ni puede abrir pacientes de B (404, sin revelar existencia)", async () => {
    const a = await login(env.app, A.ownerEmail);
    const list = await a.get("/api/patients?q=secreto");
    expect(list.body.items).toHaveLength(0);
    expect((await a.get(`/api/patients/${patientB}`)).status).toBe(404);
    expect((await a.put(`/api/patients/${patientB}`, { firstName: "Hack", lastName: "Eado", documentType: "SIN" })).status).toBe(404);
  });

  it("A no puede usar sucursales, pacientes ni profesionales de B en una cita", async () => {
    const a = await login(env.app, A.ownerEmail);
    const dentA = await addUser(env.db, A.clinicId, "dentist", { allBranches: true });
    await fullSchedule(env.db, A.clinicId, dentA.id, A.branches[0]!);
    const r = await a.post("/api/appointments", { branchId: A.branches[0], dentistId: dentA.id, patientId: patientB, startsAt: future(3, 9), durationMin: 30 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_reference");
    const r2 = await a.post("/api/appointments", { branchId: B.branches[0], dentistId: dentA.id, patientId: patientB, startsAt: future(3, 9), durationMin: 30 });
    expect(r2.status).toBe(400);
  });

  it("RLS en la base: con el contexto de A, las filas de B son invisibles", async () => {
    const n = await withTenant(env.db.appPool, { clinicId: A.clinicId, userId: null }, async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM patients WHERE id = $1", [patientB])).rows[0].n);
    expect(n).toBe(0);
  });

  it("RLS en la base: sin contexto de clínica no se ve ningún paciente", async () => {
    const n = await withTenant(env.db.appPool, { clinicId: null, userId: null }, async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM patients")).rows[0].n);
    expect(n).toBe(0);
  });

  it("RLS en la base: no se puede insertar una fila con el clinic_id de otra clínica", async () => {
    await expect(withTenant(env.db.appPool, { clinicId: A.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type) VALUES ($1, 999, 'X', 'Y', 'SIN')", [B.clinicId]),
    )).rejects.toThrow(/row-level security/);
  });

  it("RLS en la base: UPDATE sobre filas de otra clínica no afecta nada", async () => {
    const affected = await withTenant(env.db.appPool, { clinicId: A.clinicId, userId: null }, async (c) =>
      (await c.query("UPDATE patients SET first_name = 'Hack' WHERE id = $1", [patientB])).rowCount);
    expect(affected).toBe(0);
  });

  it("la app nunca opera como dueño de las tablas (rol dental_app sin BYPASSRLS)", async () => {
    const role = await withTenant(env.db.appPool, { clinicId: null, userId: null }, async (c) =>
      (await c.query("SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS b")).rows[0]);
    expect(role).toEqual({ u: "dental_app", b: false });
  });

  it("el superadmin ve métricas agregadas pero no expone datos de pacientes", async () => {
    const { hashPassword } = await import("../server/src/lib/password.js");
    const email = `super-${Date.now()}@test.local`;
    await env.db.adminPool.query("INSERT INTO users (email, full_name, password_hash, is_platform_admin) VALUES ($1,'Super',$2,true)", [email, await hashPassword("Prueba12345")]);
    const s = await login(env.app, email);
    const r = await s.get("/api/platform/clinics");
    expect(r.status).toBe(200);
    const rowB = r.body.find((x: any) => x.id === B.clinicId);
    expect(rowB.patients).toBe(1);
    expect(JSON.stringify(r.body)).not.toContain("Secreto");
    // y no tiene clínica activa: la API clínica le responde "selecciona clínica"
    expect((await s.get("/api/patients")).status).toBe(409);
  });

  it("un propietario normal no accede a la API de plataforma", async () => {
    const a = await login(env.app, A.ownerEmail);
    expect((await a.get("/api/platform/clinics")).status).toBe(403);
  });
});
