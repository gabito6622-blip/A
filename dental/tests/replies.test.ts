// B-070: bandeja de respuestas de los pacientes para recepción (por sucursal, atender y reabrir).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, rec0: Agent, rec1: Agent, owner2: Agent;
let ids: Record<string, string> = {};

const inbound = async (clinicId: string, branchId: string | null, patientId: string | null, body: string, kind = "other") =>
  (await env.db.adminPool.query<{ id: string }>(
    "INSERT INTO inbound_messages (clinic_id, patient_id, sender, body, kind, provider_message_id, branch_id) VALUES ($1,$2,'59170000000',$3,$4,$5,$6) RETURNING id",
    [clinicId, patientId, body, kind, `wamid.in.${randomUUID()}`, branchId])).rows[0]!.id;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  K2 = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  rec0 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  rec1 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] })).email);
  const p = await createPatient(owner, { firstName: "Responde" });
  ids = {
    b0: await inbound(K.clinicId, K.branches[0]!, p, "¿Puedo pasar mi cita a la tarde?"),
    b1: await inbound(K.clinicId, K.branches[1]!, p, "Gracias, ahí estaré"),
    none: await inbound(K.clinicId, null, null, "Hola, ¿quién es?"),
    baja: await inbound(K.clinicId, K.branches[0]!, p, "BAJA", "opt_out"),
    other: await inbound(K2.clinicId, K2.branches[0]!, null, "De otra clínica"),
  };
}, 60_000);
afterAll(async () => teardown(env));

const list = async (a: Agent, status = "pending") => ((await a.get(`/api/messaging/replies?status=${status}`)).body as any[]).map((x) => x.id);

describe("bandeja de respuestas (B-070)", () => {
  it("cada persona ve solo sus sucursales; las «BAJA» y otras clínicas no aparecen", async () => {
    expect((await list(rec0)).sort()).toEqual([ids.b0]);
    expect((await list(rec1)).sort()).toEqual([ids.b1]);
    expect((await list(owner)).sort()).toEqual([ids.b0, ids.b1, ids.none].sort());
    expect(await list(owner2)).toEqual([ids.other]);
    expect((await rec0.get("/api/messaging/replies/count")).body).toEqual({ pending: 1 });
    expect((await owner.get("/api/messaging/replies/count")).body).toEqual({ pending: 3 });
    const row = ((await rec0.get("/api/messaging/replies")).body as any[])[0];
    expect(row).toMatchObject({ patientName: expect.stringContaining("Responde"), handled: false, body: "¿Puedo pasar mi cita a la tarde?" });
  });

  it("marcar atendida con nota, no dos veces, reabrir; fuera de su sucursal u otra clínica: no existe", async () => {
    expect((await rec0.post(`/api/messaging/replies/${ids.b1}/handled`, {})).status).toBe(404);
    expect((await owner2.post(`/api/messaging/replies/${ids.b0}/handled`, {})).status).toBe(404);
    expect((await rec0.post(`/api/messaging/replies/${ids.baja}/handled`, {})).status).toBe(404);
    const r = await rec0.post(`/api/messaging/replies/${ids.b0}/handled`, { note: "La llamé y la pasamos a las 16:00" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await rec0.post(`/api/messaging/replies/${ids.b0}/handled`, {})).status).toBe(409);
    expect(await list(rec0)).toEqual([]);
    const done = ((await rec0.get("/api/messaging/replies?status=handled")).body as any[])[0];
    expect(done).toMatchObject({ id: ids.b0, handled: true, handledNote: "La llamé y la pasamos a las 16:00" });
    expect(done.handledBy).toBeTruthy();
    expect((await rec0.get("/api/messaging/replies/count")).body).toEqual({ pending: 0 });
    expect((await rec0.post(`/api/messaging/replies/${ids.b0}/reopen`, {})).status).toBe(200);
    expect((await rec0.post(`/api/messaging/replies/${ids.b0}/reopen`, {})).status).toBe(409);
    expect(await list(rec0)).toEqual([ids.b0]);
    const acts = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id", [ids.b0])).rows.map((x) => x.action);
    expect(acts).toEqual(["inbound_message.handled", "inbound_message.reopened"]);
    await expect(env.db.adminPool.query("DELETE FROM inbound_message_events WHERE message_id = $1", [ids.b0])).rejects.toThrow(/solo inserción/);
  });

  it("limpieza no ve la bandeja (sin acceso a pacientes)", async () => {
    const sup = await login(env.app, (await addUser(env.db, K.clinicId, "support", { branchIds: [K.branches[0]!] })).email);
    expect((await sup.get("/api/messaging/replies")).status).toBe(403);
    expect((await sup.get("/api/messaging/replies/count")).status).toBe(403);
  });
});
