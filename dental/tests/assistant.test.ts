import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, createClinic, createPatient, fullSchedule, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent, rec: Agent;
beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  env = await setupEnv();
  K = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  const d = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  await fullSchedule(env.db, K.clinicId, d.id, K.branches[0]!);
  await createPatient(owner);
});
afterAll(async () => teardown(env));

describe("asistente administrativo", () => {
  it("solo ofrece herramientas permitidas al rol", async () => {
    const o = (await owner.get("/api/assistant/tools")).body.tools.map((t: any) => t.name);
    const r = (await rec.get("/api/assistant/tools")).body.tools.map((t: any) => t.name);
    expect(o).toContain("ventas_por_sucursal");
    expect(r).not.toContain("ventas_por_sucursal");
    expect((await rec.post("/api/assistant/tools/ventas_por_sucursal", {})).status).toBe(403);
  });

  it("busca horarios libres reales para una limpieza mañana", async () => {
    const r = await rec.post("/api/assistant/tools/buscar_horarios_libres", { prestacion: "limpieza" });
    expect(r.status).toBe(200);
    expect(r.body.ui.title).toMatch(/Profilaxis/);
    expect(r.body.ui.durationMin).toBe(45);
    expect(r.body.ui.slots.length).toBeGreaterThan(0);
  });

  it("proponer una cita no la crea: devuelve una propuesta para confirmar", async () => {
    const slots = (await rec.post("/api/assistant/tools/buscar_horarios_libres", { prestacion: "limpieza" })).body.ui.slots;
    const before = await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointments WHERE clinic_id = $1", [K.clinicId]);
    const r = await rec.post("/api/assistant/tools/proponer_cita", { fichaPaciente: 1, inicio: slots[0].inicio, profesional: slots[0].profesional, sucursal: slots[0].sucursal, prestacion: "limpieza" });
    expect(r.body.proposal.action).toBe("create_appointment");
    const after = await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointments WHERE clinic_id = $1", [K.clinicId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    // confirmar = llamar al endpoint normal
    expect((await rec.post("/api/appointments", r.body.proposal.payload)).status).toBe(200);
  });

  it("sin clave de IA configurada, el chat responde 503 en vez de inventar", async () => {
    const r = await owner.post("/api/assistant/chat", { messages: [{ role: "user", content: "¿Cuánto vendió cada sucursal?" }] });
    expect(r.status).toBe(503);
  });

  it("las consultas del asistente quedan auditadas", async () => {
    const r = await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1 AND action = 'assistant.tool'", [K.clinicId]);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});

describe("asistente: herramientas de v0.3 y guardas", () => {
  it("proponer_cita rechaza horarios pasados o no libres (nunca propone algo imposible)", async () => {
    const slots = (await rec.post("/api/assistant/tools/buscar_horarios_libres", { prestacion: "limpieza" })).body.ui.slots;
    const s0 = slots[0];
    const past = await rec.post("/api/assistant/tools/proponer_cita", { fichaPaciente: 1, inicio: "2020-01-01T10:00:00-04:00", profesional: s0.profesional, sucursal: s0.sucursal });
    expect(past.body.proposal).toBeNull();
    // ocupar el horario y volver a proponerlo
    const prop = await rec.post("/api/assistant/tools/proponer_cita", { fichaPaciente: 1, inicio: s0.inicio, profesional: s0.profesional, sucursal: s0.sucursal, prestacion: "limpieza" });
    expect(prop.body.proposal).not.toBeNull();
    await rec.post("/api/appointments", prop.body.proposal.payload);
    const again = await rec.post("/api/assistant/tools/proponer_cita", { fichaPaciente: 1, inicio: s0.inicio, profesional: s0.profesional, sucursal: s0.sucursal, prestacion: "limpieza" });
    expect(again.body.proposal).toBeNull();
  });

  it("controles, sala de espera, cajas y bioseguridad responden según el rol", async () => {
    expect((await rec.post("/api/assistant/tools/controles_pendientes", {})).status).toBe(200);
    expect((await rec.post("/api/assistant/tools/sala_de_espera", {})).status).toBe(200);
    expect((await rec.post("/api/assistant/tools/estado_cajas", {})).status).toBe(403);
    expect((await owner.post("/api/assistant/tools/estado_cajas", {})).status).toBe(200);
    expect((await owner.post("/api/assistant/tools/alertas_bioseguridad", {})).status).toBe(200);
    expect((await rec.post("/api/assistant/tools/alertas_bioseguridad", {})).status).toBe(403);
  });
});
