import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent, dent: Agent, rec: Agent, asst: Agent;
let patient: string;
beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  dent = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  asst = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
  patient = await createPatient(owner);
});
afterAll(async () => teardown(env));

describe("odontograma (FDI)", () => {
  it("registra hallazgos por superficie en dientes permanentes y temporales", async () => {
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 36, surfaces: ["O", "M"], condition: "caries", state: "existing" })).status).toBe(200);
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 75, surfaces: ["O"], condition: "restoration", state: "planned" })).status).toBe(200);
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 18, condition: "missing", state: "existing" })).status).toBe(200);
    const o = (await dent.get(`/api/patients/${patient}/odontogram`)).body;
    expect(o.active.map((e: any) => e.tooth).sort()).toEqual([18, 36, 75]);
  });

  it("rechaza piezas inexistentes y condiciones de superficie sin superficie", async () => {
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 19, condition: "missing", state: "existing" })).status).toBe(400);
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 56, condition: "missing", state: "existing" })).status).toBe(400);
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 11, condition: "caries", state: "existing" })).status).toBe(400);
    expect((await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 11, condition: "inventada", state: "existing" })).status).toBe(400);
  });

  it("anular deja historial; no se anula dos veces", async () => {
    const r = await dent.post(`/api/patients/${patient}/odontogram`, { tooth: 46, surfaces: ["V"], condition: "fracture", state: "existing" });
    expect((await dent.post(`/api/odontogram/${r.body.id}/void`, { reason: "Pieza equivocada" })).status).toBe(200);
    expect((await dent.post(`/api/odontogram/${r.body.id}/void`, { reason: "otra" })).status).toBe(409);
    const o = (await dent.get(`/api/patients/${patient}/odontogram`)).body;
    expect(o.active.find((e: any) => e.id === r.body.id)).toBeUndefined();
    expect(o.history.find((e: any) => e.id === r.body.id).voided).toBe(true);
  });

  it("asistente puede ver pero no modificar; recepción no ve el registro clínico", async () => {
    expect((await asst.get(`/api/patients/${patient}/odontogram`)).status).toBe(200);
    expect((await asst.post(`/api/patients/${patient}/odontogram`, { tooth: 11, condition: "crown", state: "planned" })).status).toBe(403);
    expect((await rec.get(`/api/patients/${patient}/odontogram`)).status).toBe(403);
    expect((await rec.get(`/api/patients/${patient}/notes`)).status).toBe(403);
    expect((await rec.get(`/api/patients/${patient}/medical-history`)).status).toBe(403);
  });

  it("un propietario no profesional no accede a datos clínicos (minimización)", async () => {
    expect((await owner.get(`/api/patients/${patient}/notes`)).status).toBe(403);
  });
});

describe("historia clínica", () => {
  it("las evoluciones son inmutables y se corrigen con enmiendas", async () => {
    const n = await dent.post(`/api/patients/${patient}/notes`, { branchId: K.branches[0], body: "Dolor en 36. Caries profunda.", diagnosis: "K02.1" });
    expect(n.status).toBe(200);
    const a = await dent.post(`/api/patients/${patient}/notes`, { branchId: K.branches[0], body: "Corrección: dolor en 46.", amendsNoteId: n.body.id });
    expect(a.status).toBe(200);
    const notes = (await dent.get(`/api/patients/${patient}/notes`)).body;
    expect(notes.find((x: any) => x.id === n.body.id).amended).toBe(true);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("UPDATE clinical_notes SET body = 'x' WHERE id = $1", [n.body.id]))).rejects.toThrow(/permission denied/);
    await expect(env.db.adminPool.query("UPDATE clinical_notes SET body = 'x' WHERE id = $1", [n.body.id])).rejects.toThrow(/solo inserción/);
  });

  it("antecedentes médicos versionados generan alertas visibles en la ficha", async () => {
    expect((await dent.post(`/api/patients/${patient}/medical-history`, { allergies: "Penicilina", anticoagulants: true, conditions: ["Hipertensión"] })).status).toBe(200);
    const p = (await dent.get(`/api/patients/${patient}`)).body;
    expect(p.alerts).toEqual(expect.arrayContaining(["Alergias: Penicilina", "Toma anticoagulantes", "Hipertensión"]));
    // recepción ve la ficha administrativa pero sin alertas clínicas
    expect((await rec.get(`/api/patients/${patient}`)).body.alerts).toEqual([]);
  });

  it("ver el odontograma queda auditado (trazabilidad de accesos)", async () => {
    const r = await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1 AND action = 'odontogram.viewed'", [K.clinicId]);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});
