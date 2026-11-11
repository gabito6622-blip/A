// Mensajes automáticos (B-048 / B-060): plantillas, reglas, programador, consentimiento, baja,
// enlace de confirmación, webhook firmado, adaptador de WhatsApp con fetch simulado y aislamiento.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { createMessenger, type MessageProvider } from "../server/src/lib/messaging.js";
import { dispatchOnce } from "../server/src/lib/messageDispatch.js";
import { runSchedulerOnce } from "../server/src/modules/messaging/index.js";
import { metaVersion, renderTemplate, validateTemplate } from "../server/src/modules/messaging/templates.js";
import { isQuiet, nextAllowed, planSendAt } from "../server/src/modules/messaging/timing.js";
import { signConfirmToken, verifyConfirmToken } from "../server/src/modules/messaging/tokens.js";
import { WhatsAppCloudProvider, isOptOut, parseWebhook, signWebhookBody, verifyWebhookSignature, whatsappProviderFromEnv } from "../server/src/modules/messaging/whatsapp.js";
import { addUser, createClinic, createPatient, fullSchedule, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

const ZONE = "America/La_Paz";
let env: Env;

/** Instante en La Paz: dentro de `days` días a la hora indicada. */
const lp = (days: number, hour: number, minute = 0) => DateTime.now().setZone(ZONE).plus({ days }).set({ hour, minute, second: 0, millisecond: 0 });
const minus = (d: DateTime, o: { hours?: number; minutes?: number }) => d.minus(o).toJSDate();

interface Scenario { k: TestClinic; owner: Agent; dentistId: string; templates: Record<string, string> }

async function scenario(): Promise<Scenario> {
  const k = await createClinic(env.db);
  const owner = await login(env.app, k.ownerEmail);
  const d = await addUser(env.db, k.clinicId, "dentist", { allBranches: true });
  await fullSchedule(env.db, k.clinicId, d.id, k.branches[0]!);
  const templates: Record<string, string> = {};
  const defs: [string, "reminders" | "marketing", string][] = [
    ["Recordatorio", "reminders", "Hola {nombre}, tu cita en {clinica} ({sucursal}) es el {fecha} a las {hora}. Confirma: {enlace_confirmar}"],
    ["Control", "reminders", "Hola {nombre}, tu control en {clinica} vence el {fecha}. Reserva: {enlace_portal}"],
    ["Promo", "marketing", "Hola {nombre}, revisión preventiva en {clinica}: {enlace_portal}"],
  ];
  for (const [name, purpose, body] of defs) {
    const r = await owner.post("/api/messaging/templates", { name, purpose, body });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    templates[name] = r.body.id;
  }
  return { k, owner, dentistId: d.id, templates };
}

async function rule(s: Scenario, over: Record<string, unknown>) {
  const r = await s.owner.post("/api/messaging/rules", { name: "Regla de prueba", trigger: "appointment_reminder", offsetMinutes: 1440, branchId: null, templateId: s.templates.Recordatorio, active: true, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}

async function appointment(s: Scenario, patientId: string, at: DateTime) {
  const r = await s.owner.post("/api/appointments", { branchId: s.k.branches[0], dentistId: s.dentistId, patientId, startsAt: at.toISO(), durationMin: 30 });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}

const run = (s: Scenario, now: Date, extra: Parameters<typeof runSchedulerOnce>[2] = {}) => runSchedulerOnce(env.db, now, { clinicIds: [s.k.clinicId], ...extra });
const jobs = async (clinicId: string) => (await env.db.adminPool.query(
  "SELECT j.*, r.trigger FROM message_jobs j JOIN message_rules r ON r.id = j.rule_id WHERE j.clinic_id = $1 ORDER BY j.created_at", [clinicId])).rows;
const outbox = async (clinicId: string) => (await env.db.adminPool.query("SELECT * FROM outbound_messages WHERE clinic_id = $1 ORDER BY created_at", [clinicId])).rows;

beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await teardown(env); });

// ---------------------------------------------------------------- unidades puras
describe("plantillas y horarios (unidad)", () => {
  it("valida variables: desconocidas, clínicas y llaves mal cerradas", () => {
    expect(validateTemplate("Hola {nombre}, tu cita es el {fecha} a las {hora}").errors).toEqual([]);
    expect(validateTemplate("Hola {nombre} {apodo}").errors[0]!.message).toMatch(/\{apodo\} no existe/);
    expect(validateTemplate("Tu {tratamiento} es mañana").errors[0]!.message).toMatch(/datos clínicos/);
    expect(validateTemplate("Resultado: {Diagnóstico}").errors[0]!.message).toMatch(/datos clínicos/);
    expect(validateTemplate("Hola {nombre, ven").errors.some((e) => /sin cerrar/.test(e.message))).toBe(true);
    expect(validateTemplate("Hola {nombre}: {enlace_confirmar}", { trigger: "recall_due" }).errors[0]!.message).toMatch(/no está disponible/);
  });

  it("marketing siempre lleva la baja; Meta recibe {{n}} y los parámetros en orden", () => {
    const out = renderTemplate("Hola {nombre}, promo en {clinica}", { nombre: "Ana", clinica: "Demo" }, "marketing");
    expect(out).toBe("Hola Ana, promo en Demo\n\nResponde BAJA para no recibir más.");
    expect(renderTemplate("Hola {nombre}", { nombre: "Ana" }, "reminders")).toBe("Hola Ana");
    const m = metaVersion("Hola {nombre}, el {fecha} a las {hora}", "reminders");
    expect(m).toEqual({ text: "Hola {{1}}, el {{2}} a las {{3}}", params: ["nombre", "fecha", "hora"] });
  });

  it("horario de silencio 20:00–08:00: posterga a las 08:00 o adelanta si no queda margen antes de la cita", () => {
    const q = { start: "20:00", end: "08:00" };
    const at = (s: string) => DateTime.fromISO(s, { zone: ZONE }).toMillis();
    expect(isQuiet(at("2026-11-20T21:00"), ZONE, q)).toBe(true);
    expect(isQuiet(at("2026-11-20T07:59"), ZONE, q)).toBe(true);
    expect(isQuiet(at("2026-11-20T08:00"), ZONE, q)).toBe(false);
    expect(nextAllowed(at("2026-11-20T21:00"), ZONE, q)).toBe(at("2026-11-21T08:00"));
    expect(nextAllowed(at("2026-11-21T03:00"), ZONE, q)).toBe(at("2026-11-21T08:00"));
    expect(planSendAt(at("2026-11-20T21:00"), ZONE, q, at("2026-11-21T15:00"))).toEqual({ sendAt: at("2026-11-21T08:00"), deferred: true, pulledBack: false });
    // Cita a las 08:15: a las 08:00 no queda margen → se adelanta a las 19:45 del día anterior.
    expect(planSendAt(at("2026-11-20T22:15"), ZONE, q, at("2026-11-21T08:15"))).toEqual({ sendAt: at("2026-11-20T19:45"), deferred: false, pulledBack: true });
    expect(planSendAt(at("2026-11-20T10:00"), ZONE, q).sendAt).toBe(at("2026-11-20T10:00"));
  });

  it("el token de confirmación está firmado: alterado = inválido", () => {
    const key = Buffer.alloc(32, 9);
    const t = signConfirmToken(key, "11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(verifyConfirmToken(key, t)).toEqual({ clinicId: "11111111-2222-4333-8444-555555555555", tokenId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    expect(verifyConfirmToken(Buffer.alloc(32, 8), t)).toBeNull();
    expect(verifyConfirmToken(key, t.slice(0, -2) + (t.endsWith("AA") ? "AB" : "AA"))).toBeNull();
    expect(verifyConfirmToken(key, "basura")).toBeNull();
  });
});

describe("adaptador de WhatsApp Cloud API (fetch simulado, sin red)", () => {
  it("envía una plantilla aprobada a graph.facebook.com con el token y los parámetros", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetch = async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.ABC" }] }) }; };
    const p = new WhatsAppCloudProvider({ token: "tok-123", phoneId: "1098765", fetch });
    const r = await p.send({ channel: "whatsapp", recipient: "+59171234567", template: "auto.appointment_reminder", body: "Hola Ana",
      providerTemplate: { name: "recordatorio_cita", language: "es", params: ["Ana", "jueves 12", "10:30"] } });
    expect(r).toEqual({ providerMessageId: "wamid.ABC" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/1098765/messages");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers.authorization).toBe("Bearer tok-123");
    const body = JSON.parse(calls[0]!.init.body);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "59171234567", type: "template", template: { name: "recordatorio_cita", language: { code: "es" } } });
    expect(body.template.components[0].parameters.map((x: any) => x.text)).toEqual(["Ana", "jueves 12", "10:30"]);
  });

  it("texto libre sin plantilla; un rechazo de Meta lanza error con el motivo", async () => {
    let sent: any = null;
    const ok = new WhatsAppCloudProvider({ token: "t", phoneId: "1", fetch: async (_u, i) => { sent = JSON.parse(i.body); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "w1" }] }) }; } });
    await ok.send({ channel: "whatsapp", recipient: "71234567", template: "x", body: "Listo" });
    expect(sent).toMatchObject({ type: "text", to: "59171234567", text: { body: "Listo" } });
    const bad = new WhatsAppCloudProvider({ token: "t", phoneId: "1", fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 132001, message: "Template name does not exist" } }) }) });
    await expect(bad.send({ channel: "whatsapp", recipient: "71234567", template: "x", body: "y" })).rejects.toThrow(/132001.*Template name/);
    await expect(ok.send({ channel: "sms", recipient: "71234567", template: "x", body: "y" })).rejects.toThrow(/no disponible/);
  });

  it("solo existe con NODE_ENV=production y las dos variables", () => {
    expect(whatsappProviderFromEnv({ NODE_ENV: "development", WHATSAPP_TOKEN: "a", WHATSAPP_PHONE_ID: "b" })).toBeNull();
    expect(whatsappProviderFromEnv({ NODE_ENV: "production", WHATSAPP_TOKEN: "a" })).toBeNull();
    expect(whatsappProviderFromEnv({ NODE_ENV: "production", WHATSAPP_TOKEN: "a", WHATSAPP_PHONE_ID: "b" })).toBeInstanceOf(WhatsAppCloudProvider);
    expect(whatsappProviderFromEnv({})).toBeNull();
  });

  it("firma del webhook, lectura de estados y palabra BAJA", () => {
    const raw = Buffer.from('{"a":1}');
    const sig = signWebhookBody(raw, "s3cr3t");
    expect(verifyWebhookSignature(raw, sig, "s3cr3t")).toBe(true);
    expect(verifyWebhookSignature(Buffer.from('{"a":2}'), sig, "s3cr3t")).toBe(false);
    expect(verifyWebhookSignature(raw, sig, "otro")).toBe(false);
    expect(verifyWebhookSignature(raw, undefined, "s3cr3t")).toBe(false);
    const p = parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "w1", status: "failed", errors: [{ title: "Número inválido" }] }], messages: [{ from: "59170000000", id: "in1", type: "text", text: { body: "Baja" } }] } }] }] });
    expect(p.statuses[0]).toMatchObject({ providerMessageId: "w1", status: "failed", error: "Número inválido" });
    expect(p.inbound[0]).toMatchObject({ from: "59170000000", text: "Baja" });
    expect(isOptOut("baja")).toBe(true);
    expect(isOptOut("  STOP ")).toBe(true);
    expect(isOptOut("Bajaré a las 10")).toBe(false);
    expect(isOptOut("Sí, confirmo")).toBe(false);
  });
});

// ---------------------------------------------------------------- API de plantillas y reglas
describe("plantillas y reglas por API", () => {
  let s: Scenario;
  beforeAll(async () => { s = await scenario(); });

  it("rechaza antes de guardar variables desconocidas o clínicas (error junto al campo)", async () => {
    const bad = await s.owner.post("/api/messaging/templates", { name: "Mala", purpose: "reminders", body: "Hola {nombre}, tu {tratamiento} es el {fecha}" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0]).toMatchObject({ path: "body" });
    expect(bad.body.error.message).toMatch(/datos clínicos/);
    const unk = await s.owner.post("/api/messaging/templates", { name: "Mala 2", purpose: "reminders", body: "Hola {paciente}" });
    expect(unk.status).toBe(400);
    expect(unk.body.error.message).toMatch(/\{paciente\} no existe/);
    const dup = await s.owner.post("/api/messaging/templates", { name: "recordatorio", purpose: "reminders", body: "Hola {nombre}" });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details[0]).toMatchObject({ path: "name" });
    // La base también lo impide (defensa en profundidad).
    const t = s.templates.Recordatorio;
    await expect(env.db.adminPool.query("INSERT INTO message_template_versions (clinic_id, template_id, version, body) VALUES ($1,$2,99,'Tu {diagnostico}')", [s.k.clinicId, t]))
      .rejects.toThrow(/message_template_no_clinical/);
  });

  it("vista previa con datos ficticios y versiones: editar el texto crea la versión 2", async () => {
    const pv = await s.owner.post("/api/messaging/templates/preview", { body: "Hola {nombre}, te esperamos el {fecha}", purpose: "marketing" });
    expect(pv.status).toBe(200);
    expect(pv.body.preview).toMatch(/^Hola Lucía, te esperamos el jueves 12 de noviembre\n\nResponde BAJA/);
    expect(pv.body.warnings[0]).toMatch(/BAJA/);
    const pvBad = await s.owner.post("/api/messaging/templates/preview", { body: "Hola {nombr}", purpose: "reminders" });
    expect(pvBad.body).toMatchObject({ ok: false, preview: null });
    const id = s.templates.Control;
    const up = await s.owner.put(`/api/messaging/templates/${id}`, { name: "Control", body: "Hola {nombre}, ya toca tu control ({fecha}): {enlace_portal}", active: true });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.version).toBe(2);
    const same = await s.owner.put(`/api/messaging/templates/${id}`, { name: "Control", body: "Hola {nombre}, ya toca tu control ({fecha}): {enlace_portal}", active: true });
    expect(same.body.version).toBe(2);
    const v = await s.owner.get(`/api/messaging/templates/${id}/versions`);
    expect(v.body.map((x: any) => x.version)).toEqual([2, 1]);
    // Las versiones son inmutables.
    await expect(env.db.adminPool.query("UPDATE message_template_versions SET body = 'x x x x x' WHERE template_id = $1", [id])).rejects.toThrow(/solo inserción/);
  });

  it("las reglas validan finalidad, variables del disparador y rangos", async () => {
    const mk = await s.owner.post("/api/messaging/rules", { name: "Mal", trigger: "appointment_reminder", offsetMinutes: 1440, templateId: s.templates.Promo, active: true });
    expect(mk.status).toBe(400);
    expect(mk.body.error.message).toMatch(/Recordatorios/);
    const vars = await s.owner.post("/api/messaging/rules", { name: "Mal", trigger: "recall_due", offsetMinutes: 1440, templateId: s.templates.Recordatorio, active: true });
    expect(vars.status).toBe(400);
    expect(vars.body.error.message).toMatch(/\{hora\} no está disponible para «Control pendiente/);
    const off = await s.owner.post("/api/messaging/rules", { name: "Mal", trigger: "appointment_reminder", offsetMinutes: 5, templateId: s.templates.Recordatorio, active: true });
    expect(off.status).toBe(400);
    expect(off.body.error.details[0].path).toBe("offsetMinutes");
    // Una plantilla usada por una regla no admite una variable que ese disparador no tiene.
    const ruleId = await rule(s, { name: "Control 7 días", trigger: "recall_due", offsetMinutes: 7 * 1440, templateId: s.templates.Control, active: false });
    const up = await s.owner.put(`/api/messaging/templates/${s.templates.Control}`, { name: "Control", body: "Hola {nombre}: {enlace_confirmar}", active: true });
    expect(up.status).toBe(400);
    expect(up.body.error.message).toMatch(/la usa una regla/);
    const ch = await s.owner.put(`/api/messaging/rules/${ruleId}`, { name: "Control", trigger: "after_visit", offsetMinutes: 0, templateId: s.templates.Control, active: false });
    expect(ch.status).toBe(400);
  });

  it("permisos: recepción y odontólogo no configuran ni ejecutan; el propietario sí", async () => {
    const r = await addUser(env.db, s.k.clinicId, "receptionist", { allBranches: true });
    const recep = await login(env.app, r.email);
    for (const [m, u] of [["get", "/api/messaging/rules"], ["get", "/api/messaging/deliveries"], ["post", "/api/messaging/run"], ["get", "/api/messaging/settings"]] as const) {
      expect((await (recep as any)[m](u)).status, u).toBe(403);
    }
    const run = await s.owner.post("/api/messaging/run");
    expect(run.status).toBe(200);
    expect(run.body.mode).toBe("simulate");
    const set = await s.owner.put("/api/messaging/settings", { quietStart: "21:00", quietEnd: "07:30", maxPerDay: 3 });
    expect(set.status).toBe(200);
    expect((await s.owner.get("/api/messaging/settings")).body).toMatchObject({ quietStart: "21:00", quietEnd: "07:30", maxPerDay: 3, mode: "simulate" });
    expect((await s.owner.put("/api/messaging/settings", { quietStart: "25:00", quietEnd: "07:30", maxPerDay: 3 })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- programador
describe("programador", () => {
  it("recordatorio 24 h: se programa, se envía a su hora y una segunda ejecución no duplica", async () => {
    const s = await scenario();
    const pid = await createPatient(s.owner, { consentReminders: true });
    const T = lp(3, 15);
    const apptId = await appointment(s, pid, T);
    await rule(s, {});
    const a = await run(s, minus(T, { hours: 30 }));
    expect(a.planned).toBe(1);
    expect(a.sent).toBe(0);
    let js = await jobs(s.k.clinicId);
    expect(js).toHaveLength(1);
    expect(js[0]).toMatchObject({ status: "pending", appointment_id: apptId });
    expect(+js[0].send_at).toBe(+minus(T, { hours: 24 }));
    const now = minus(T, { hours: 23 });
    const b = await run(s, now);
    expect(b.sent).toBe(1);
    const c2 = await run(s, now);
    const [x, y] = await Promise.all([run(s, now), run(s, now)]); // concurrentes: el bloqueo por clínica los ordena
    expect(c2.sent + c2.planned + x.sent + y.sent + x.planned + y.planned).toBe(0);
    js = await jobs(s.k.clinicId);
    expect(js).toHaveLength(1);
    expect(js[0].status).toBe("done");
    const out = await outbox(s.k.clinicId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "simulated", purpose: "reminders", template: "auto.appointment_reminder", patient_id: pid, dedupe_key: js[0].dedupe_key });
    expect(out[0].body).toMatch(/^Hola Ana, tu cita en .+ \(Sucursal 1\) es el .+ a las 15:00\. Confirma: http.+\/c\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // La bandeja rechaza un segundo mensaje con la misma clave (respaldo de la deduplicación).
    await expect(withTenant(env.db.appPool, { clinicId: s.k.clinicId, userId: null }, (c) =>
      createMessenger({ isProduction: false }).enqueue(c, { clinicId: s.k.clinicId, channel: "whatsapp", recipient: "+59170000000", template: "auto.x", purpose: "reminders", body: "dup", dedupeKey: js[0].dedupe_key }),
    )).rejects.toThrow(/duplicate key/);
  });

  it("horario de silencio: lo que cae a las 21:00 sale a las 08:00; sin margen, se adelanta a las 19:45", async () => {
    const s = await scenario();
    const p1 = await createPatient(s.owner, { consentReminders: true });
    const p2 = await createPatient(s.owner, { consentReminders: true });
    const T1 = lp(3, 15), T2 = lp(4, 8, 15);
    await appointment(s, p1, T1);
    await appointment(s, p2, T2);
    await rule(s, { offsetMinutes: 18 * 60 }); // T1 → 21:00 del día anterior; T2 → 14:15 (fuera del silencio)
    await rule(s, { name: "Aviso 10 h", offsetMinutes: 10 * 60 }); // T1 → 05:00; T2 → 22:15
    await run(s, lp(2, 12).toJSDate());
    const js = await jobs(s.k.clinicId);
    const find = (pid: string, off: number) => js.find((j) => j.patient_id === pid && +j.due_at === +j.anchor_at - off * 60_000)!;
    expect(+find(p1, 18 * 60).send_at).toBe(+lp(3, 8).toJSDate());
    expect(find(p1, 18 * 60).status_reason).toMatch(/silencio.*08:00/);
    expect(+find(p1, 10 * 60).send_at).toBe(+lp(3, 8).toJSDate());
    expect(+find(p2, 10 * 60).send_at).toBe(+lp(3, 19, 45).toJSDate());
    expect(find(p2, 10 * 60).status_reason).toMatch(/Adelantado a las 19:45/);
    // A las 21:30 no sale nada aunque algo esté vencido.
    const quiet = await run(s, lp(3, 21, 30).toJSDate());
    expect(quiet.sent).toBe(0);
  });

  it("dentro del silencio no sale nada: lo vencido se mueve a las 08:00", async () => {
    const s = await scenario();
    const pid = await createPatient(s.owner, { consentReminders: true });
    await appointment(s, pid, lp(3, 8, 15));
    await rule(s, { offsetMinutes: 2 * 60 }); // vence 06:15 (silencio) → sin margen → 19:45 del día anterior
    await run(s, lp(2, 12).toJSDate());
    expect(+(await jobs(s.k.clinicId))[0].send_at).toBe(+lp(2, 19, 45).toJSDate());
    const r = await run(s, lp(3, 7, 50).toJSDate()); // estaba vencido, pero ahora es silencio
    expect(r.sent).toBe(0);
    expect(r.deferred).toBe(1);
    const [j] = await jobs(s.k.clinicId);
    expect(j.status).toBe("pending");
    expect(+j.send_at).toBe(+lp(3, 8).toJSDate());
    expect(j.status_reason).toMatch(/silencio.*08:00/);
    expect((await run(s, lp(3, 8, 1).toJSDate())).sent).toBe(1);
  });

  it("reprogramar anula el aviso de la hora anterior y crea uno nuevo; volver a la hora original lo reactiva", async () => {
    const s = await scenario();
    const pid = await createPatient(s.owner, { consentReminders: true });
    const T = lp(3, 15);
    const id = await appointment(s, pid, T);
    await rule(s, {});
    await run(s, minus(T, { hours: 30 }));
    const T2 = lp(3, 17);
    expect((await s.owner.patch(`/api/appointments/${id}`, { startsAt: T2.toISO() })).status).toBe(200);
    const r = await run(s, minus(T, { hours: 30 }));
    expect(r.cancelled).toBe(1);
    expect(r.planned).toBe(1);
    let js = await jobs(s.k.clinicId);
    expect(js).toHaveLength(2);
    expect(js.find((j) => +j.anchor_at === +T.toJSDate())).toMatchObject({ status: "cancelled", status_reason: expect.stringMatching(/reprogramada/) });
    expect(js.find((j) => +j.anchor_at === +T2.toJSDate())).toMatchObject({ status: "pending" });
    // Vuelve a la hora original: no se duplica, se reactiva el aviso anterior.
    expect((await s.owner.patch(`/api/appointments/${id}`, { startsAt: T.toISO() })).status).toBe(200);
    await run(s, minus(T, { hours: 30 }));
    js = await jobs(s.k.clinicId);
    expect(js).toHaveLength(2);
    expect(js.find((j) => +j.anchor_at === +T.toJSDate()).status).toBe("pending");
    expect(js.find((j) => +j.anchor_at === +T2.toJSDate()).status).toBe("cancelled");
    const sent = await run(s, minus(T, { hours: 23 }));
    expect(sent.sent).toBe(1);
    expect((await outbox(s.k.clinicId))[0].body).toMatch(/15:00/);
  });

  it("cancelar la cita anula todos sus avisos pendientes", async () => {
    const s = await scenario();
    const pid = await createPatient(s.owner, { consentReminders: true });
    const T = lp(3, 15);
    const id = await appointment(s, pid, T);
    await rule(s, {});
    await rule(s, { name: "2 h", offsetMinutes: 120 });
    await run(s, minus(T, { hours: 30 }));
    expect((await s.owner.post(`/api/appointments/${id}/status`, { status: "cancelled", reason: "El paciente avisó" })).status).toBe(200);
    const r = await run(s, minus(T, { hours: 1 }));
    expect(r.sent).toBe(0);
    const js = await jobs(s.k.clinicId);
    expect(js.length).toBeGreaterThanOrEqual(1);
    expect(js.every((j) => j.status === "cancelled" && j.status_reason === "Cita cancelada")).toBe(true);
    expect(await outbox(s.k.clinicId)).toHaveLength(0);
    // Lo anulado o enviado no se borra.
    await expect(env.db.adminPool.query("DELETE FROM message_jobs WHERE clinic_id = $1", [s.k.clinicId])).rejects.toThrow(/no se eliminan/);
  });

  it("consentimiento por finalidad: sin consentimiento se omite y queda registrado; marketing lleva BAJA", async () => {
    const s = await scenario();
    const none = await createPatient(s.owner, { consentReminders: false });
    const onlyRem = await createPatient(s.owner, { consentReminders: true });
    const mkt = await createPatient(s.owner, { consentReminders: true, consentMarketing: true });
    const T = lp(3, 15);
    await appointment(s, none, T);
    await rule(s, {});
    const due = DateTime.now().setZone(ZONE).plus({ days: 5 }).toISODate();
    for (const pid of [onlyRem, mkt]) {
      await env.db.adminPool.query("INSERT INTO recalls (clinic_id, patient_id, branch_id, reason, due_date) VALUES ($1,$2,$3,'Control de prueba',$4)", [s.k.clinicId, pid, s.k.branches[0], due]);
    }
    await rule(s, { name: "Campaña de control", trigger: "recall_due", offsetMinutes: 7 * 1440, templateId: s.templates.Promo });
    await run(s, lp(1, 12).toJSDate());
    await run(s, minus(T, { hours: 23 }));
    const js = await jobs(s.k.clinicId);
    const by = (pid: string) => js.find((j) => j.patient_id === pid)!;
    expect(by(none)).toMatchObject({ status: "skipped", status_reason: "Sin consentimiento para los recordatorios" });
    expect(by(onlyRem)).toMatchObject({ status: "skipped", status_reason: "Sin consentimiento para las promociones (marketing)" });
    expect(by(mkt).status).toBe("done");
    const msg = (await outbox(s.k.clinicId)).find((m) => m.patient_id === mkt)!;
    expect(msg.purpose).toBe("marketing");
    expect(msg.body).toMatch(/Responde BAJA para no recibir más\.$/);
    const aud = (await env.db.adminPool.query("SELECT data FROM audit_log WHERE clinic_id = $1 AND action = 'messaging.skipped'", [s.k.clinicId])).rows;
    expect(aud).toHaveLength(2);
    // Con el portal desactivado el enlace se reemplaza por el contacto de la sucursal (sin enlaces rotos).
    expect(msg.body).not.toMatch(/\/reservar\//);
  });

  it("tope diario: el segundo mensaje del día se posterga a mañana y sale entonces", async () => {
    const s = await scenario();
    expect((await s.owner.put("/api/messaging/settings", { quietStart: "20:00", quietEnd: "08:00", maxPerDay: 1 })).status).toBe(200);
    const pid = await createPatient(s.owner, { consentReminders: true });
    await appointment(s, pid, lp(3, 10));
    await appointment(s, pid, lp(3, 16));
    await rule(s, { offsetMinutes: 48 * 60 });
    const r = await run(s, lp(1, 17).toJSDate());
    expect(r.sent).toBe(1);
    expect(r.deferred).toBe(1);
    const pend = (await jobs(s.k.clinicId)).find((j) => j.status === "pending")!;
    expect(pend.status_reason).toMatch(/Tope diario/);
    expect(+pend.send_at).toBe(+lp(2, 8).toJSDate());
    expect((await run(s, lp(1, 18).toJSDate())).sent).toBe(0);
    expect((await run(s, lp(2, 8, 5).toJSDate())).sent).toBe(1);
    expect(await outbox(s.k.clinicId)).toHaveLength(2);
  });

  it("un mensaje que falla se puede reintentar una vez (el original no cambia)", async () => {
    const s = await scenario();
    const pid = await createPatient(s.owner, { consentReminders: true });
    const T = lp(3, 15);
    await appointment(s, pid, T);
    await rule(s, {});
    const failing: MessageProvider = { name: "falla", send: async () => { throw new Error("Número no tiene WhatsApp"); } };
    await run(s, minus(T, { hours: 23 }), { messenger: createMessenger({ isProduction: true }, { provider: failing, log: () => {} }) });
    expect((await outbox(s.k.clinicId))[0].status).toBe("queued"); // B-070: se envía fuera de la transacción
    await dispatchOnce(env.db, failing);
    const [m] = await outbox(s.k.clinicId);
    expect(m).toMatchObject({ status: "failed", error: "Número no tiene WhatsApp" });
    const d = await s.owner.get("/api/messaging/deliveries?status=failed");
    expect(d.body.items.map((x: any) => x.id)).toEqual([m.id]);
    expect(d.body.items[0].ruleName).toBe("Regla de prueba");
    const r = await s.owner.post(`/api/messaging/messages/${m.id}/retry`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe("simulated");
    expect((await s.owner.post(`/api/messaging/messages/${m.id}/retry`)).status).toBe(409);
    expect((await s.owner.post(`/api/messaging/messages/${r.body.id}/retry`)).status).toBe(409); // no falló
    const all = await outbox(s.k.clinicId);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ retry_of: m.id, body: m.body });
    const stats = await s.owner.get("/api/messaging/stats");
    expect(stats.status).toBe(200);
    const today = stats.body[0];
    expect(today).toMatchObject({ failed: 1, simulated: 1, total: 2 });
  });
});

// ---------------------------------------------------------------- enlace de confirmación
describe("enlace de confirmación /c/:token", () => {
  let s: Scenario;
  let pid: string;
  beforeAll(async () => {
    s = await scenario();
    pid = await createPatient(s.owner, { consentReminders: true });
    // Sin horario de silencio: la prueba no depende de la hora real a la que corre.
    expect((await s.owner.put("/api/messaging/settings", { quietStart: "00:00", quietEnd: "00:00", maxPerDay: 10 })).status).toBe(200);
    await rule(s, { name: "Confirmación", trigger: "appointment_created", offsetMinutes: 0 });
  });
  const pub = (method: "GET" | "POST", token: string, body?: unknown, headers: Record<string, string> = { "x-portal": "1" }) =>
    env.app.inject({ method, url: `/api/public/confirmar/${token}`, headers, ...(body ? { payload: body as object } : {}) }).then((r) => ({ status: r.statusCode, body: r.json() }));
  async function tokenFor(at: DateTime) {
    const id = await appointment(s, pid, at);
    await run(s, new Date(Date.now() + 60_000));
    const m = (await outbox(s.k.clinicId)).find((x) => x.related_id === id)!;
    expect(m.template).toBe("auto.appointment_created");
    return { id, token: /\/c\/([^\s]+)/.exec(m.body)![1]! };
  }

  it("válido → confirma con la transición normal; reutilizado → rechazado", async () => {
    const { id, token } = await tokenFor(lp(2, 11));
    const v = await pub("GET", token);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ state: "valid", time: "11:00", patientFirstName: "Ana", branch: { name: "Sucursal 1" } });
    expect(JSON.stringify(v.body)).not.toMatch(/document|phone":"\+591|procedure/i);
    expect((await pub("POST", token, { action: "confirm" }, {})).status).toBe(403); // sin cabecera X-Portal
    const c = await pub("POST", token, { action: "confirm" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const a = await s.owner.get(`/api/appointments/${id}`);
    expect(a.body.status).toBe("confirmed");
    expect(a.body.statusLabel).toBe("Confirmada");
    const ev = (await env.db.adminPool.query("SELECT from_status, to_status, user_id, reason FROM appointment_events WHERE appointment_id = $1 ORDER BY occurred_at", [id])).rows;
    expect(ev.at(-1)).toMatchObject({ from_status: "scheduled", to_status: "confirmed", user_id: null });
    const again = await pub("POST", token, { action: "confirm" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("link_used");
    expect((await pub("GET", token)).body.state).toBe("used");
  });

  it("vencido, alterado, cita reprogramada y «Necesito reprogramar»", async () => {
    const { id, token } = await tokenFor(lp(2, 12));
    const re = await pub("POST", token, { action: "reschedule" });
    expect(re.status).toBe(200);
    expect(re.body.redirect).toBeNull(); // portal desactivado: se ofrece el contacto de la sucursal
    expect((await pub("GET", token)).body.state).toBe("valid"); // pedir reprogramar no consume el enlace
    const bad = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
    expect((await pub("GET", bad)).status).toBe(404);
    await env.db.adminPool.query("UPDATE message_confirm_tokens SET expires_at = now() - interval '1 minute' WHERE appointment_id = $1", [id]);
    const exp = await pub("POST", token, { action: "confirm" });
    expect(exp.status).toBe(410);
    expect(exp.body.error.code).toBe("link_expired");
    expect((await s.owner.get(`/api/appointments/${id}`)).body.status).toBe("scheduled");
    const t2 = await tokenFor(lp(2, 13));
    expect((await s.owner.patch(`/api/appointments/${t2.id}`, { startsAt: lp(2, 14).toISO() })).status).toBe(200);
    const ch = await pub("POST", t2.token, { action: "confirm" });
    expect(ch.status).toBe(409);
    expect(ch.body.error.code).toBe("appointment_changed");
  });
});

// ---------------------------------------------------------------- baja: portal y webhook
describe("baja del paciente", () => {
  it("portal: «Dejar de recibir mensajes» revoca por el módulo de consentimientos y el programador lo omite", async () => {
    const s = await scenario();
    const settings = (await s.owner.get("/api/portal/settings")).body;
    const svc = settings.services.filter((x: any) => x.code === "CON-01");
    expect((await s.owner.put("/api/portal/settings", {
      enabled: true, slug: settings.slug, leadTimeHours: 2, maxDaysAhead: 30, changeWindowHours: 24, showPrices: false, instructions: null,
      branches: [{ branchId: s.k.branches[0], enabled: true, mode: "instant", whatsapp: "71234567", mapUrl: null }],
      services: svc.map((x: any) => ({ procedureId: x.procedureId, priceFromCents: null })),
    })).status).toBe(200);
    const doc = String(Math.floor(1e6 + Math.random() * 8e6));
    const pid = await createPatient(s.owner, { consentReminders: true, consentMarketing: true, documentNumber: doc, birthDate: "1985-03-04" });
    await appointment(s, pid, lp(3, 15));
    await rule(s, {});
    let cookie = "";
    const call = async (method: "GET" | "POST", url: string, body?: unknown) => {
      const r = await env.app.inject({ method, url: `/api/public/c/${settings.slug}${url}`, remoteAddress: "10.9.9.9", headers: { "x-portal": "1", ...(cookie ? { cookie } : {}) }, ...(method === "POST" ? { payload: (body ?? {}) as object } : {}) });
      const sc = r.headers["set-cookie"];
      const line = (Array.isArray(sc) ? sc : sc ? [String(sc)] : []).find((x) => x.startsWith("psid="));
      if (line) cookie = line.split(";")[0]!;
      return { status: r.statusCode, body: r.json() };
    };
    const ch = await call("POST", "/auth/existing", { documentNumber: doc, birthDate: "1985-03-04" });
    const code = (await env.db.adminPool.query<{ body: string }>("SELECT body FROM outbound_messages WHERE related_id = $1", [ch.body.challengeId])).rows[0]!.body.match(/\b\d{6}\b/)![0];
    expect((await call("POST", "/auth/verify", { challengeId: ch.body.challengeId, code })).status).toBe(200);
    const out = await call("POST", "/me/messages/opt-out");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.revoked).toBe(2);
    expect(out.body.family[0]).toMatchObject({ consentReminders: false, consentMarketing: false });
    const docs = (await env.db.adminPool.query("SELECT kind, decision, method, recorded_by FROM signed_documents WHERE patient_id = $1 AND decision = 'revoked' ORDER BY kind", [pid])).rows;
    expect(docs).toEqual([
      { kind: "marketing", decision: "revoked", method: "online_checkbox", recorded_by: null },
      { kind: "reminders", decision: "revoked", method: "online_checkbox", recorded_by: null },
    ]);
    expect((await call("POST", "/me/messages/opt-out")).body.revoked).toBe(0); // idempotente
    await run(s, lp(2, 16).toJSDate());
    const [j] = await jobs(s.k.clinicId);
    expect(j).toMatchObject({ status: "skipped", status_reason: "El paciente se dio de baja de los recordatorios" });
    expect((await env.db.adminPool.query("SELECT 1 FROM outbound_messages WHERE patient_id = $1 AND template LIKE 'auto.%'", [pid])).rowCount).toBe(0);
  });

  it("webhook: firma obligatoria, estados de entrega y respuesta «BAJA»", async () => {
    const s = await scenario();
    const phone = `7${Math.floor(1000000 + Math.random() * 8999999)}`;
    const pid = await createPatient(s.owner, { consentReminders: true, phone });
    const T = lp(3, 15);
    await appointment(s, pid, T);
    await rule(s, {});
    let n = 0;
    const provider: MessageProvider = { name: "falso", send: async () => ({ providerMessageId: `wamid.T${++n}.${s.k.clinicId}` }) };
    await run(s, minus(T, { hours: 23 }), { messenger: createMessenger({ isProduction: true }, { provider, log: () => {} }) });
    await dispatchOnce(env.db, provider);
    const [m] = await outbox(s.k.clinicId);
    expect(m.status).toBe("sent");
    const hook = (payload: unknown, sig?: string | null) => {
      const raw = JSON.stringify(payload);
      return env.app.inject({ method: "POST", url: "/api/webhooks/whatsapp", headers: { "content-type": "application/json", ...(sig !== null ? { "x-hub-signature-256": sig ?? signWebhookBody(raw, "secreto-de-prueba") } : {}) }, payload: raw })
        .then((r) => ({ status: r.statusCode, body: r.json() }));
    };
    const status = (st: string) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: m.provider_message_id, status: st, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    delete process.env.WHATSAPP_APP_SECRET;
    expect((await hook(status("delivered"))).status).toBe(503);
    process.env.WHATSAPP_APP_SECRET = "secreto-de-prueba";
    try {
      expect((await hook(status("delivered"), null)).status).toBe(401);
      expect((await hook(status("delivered"), signWebhookBody("otro cuerpo", "secreto-de-prueba"))).status).toBe(401);
      expect((await hook(status("delivered"), signWebhookBody(JSON.stringify(status("delivered")), "otro-secreto"))).status).toBe(401);
      expect((await env.db.adminPool.query("SELECT status FROM outbound_messages WHERE id = $1", [m.id])).rows[0].status).toBe("sent");
      expect((await hook(status("delivered"))).body).toMatchObject({ ok: true, updated: 1 });
      expect((await hook(status("read"))).body.updated).toBe(1);
      expect((await hook(status("delivered"))).body.updated).toBe(0); // fuera de orden: no retrocede
      const row = (await env.db.adminPool.query("SELECT status, delivered_at, read_at FROM outbound_messages WHERE id = $1", [m.id])).rows[0];
      expect(row.status).toBe("read");
      expect(row.delivered_at).toBeTruthy();
      expect(row.read_at).toBeTruthy();
      // Respuesta «BAJA» desde el celular del paciente.
      const baja = { entry: [{ changes: [{ value: { messages: [{ from: `591${phone}`, id: `in.${s.k.clinicId}`, type: "text", text: { body: "BAJA" } }] } }] }] };
      const r = await hook(baja);
      expect(r.body).toMatchObject({ received: 1, optOuts: 1 });
      expect((await hook(baja)).body).toMatchObject({ received: 0, optOuts: 0 }); // reintento de Meta: sin duplicar
      const p = (await env.db.adminPool.query("SELECT consent_reminders, consent_marketing FROM patients WHERE id = $1", [pid])).rows[0];
      expect(p).toEqual({ consent_reminders: false, consent_marketing: false });
      const d = (await env.db.adminPool.query("SELECT method, notes FROM signed_documents WHERE patient_id = $1 AND decision = 'revoked'", [pid])).rows;
      expect(d).toEqual([{ method: "online_checkbox", notes: "El paciente respondió «BAJA» a un mensaje de WhatsApp" }]);
      const inbound = await s.owner.get("/api/messaging/inbound");
      expect(inbound.body[0]).toMatchObject({ kind: "opt_out", body: "BAJA" });
      const ack = (await outbox(s.k.clinicId)).find((x) => x.template === "auto.opt_out_ack");
      expect(ack?.body).toMatch(/ya no te enviaremos recordatorios/);
      // Verificación del webhook por Meta.
      process.env.WHATSAPP_VERIFY_TOKEN = "verifica";
      const ok = await env.app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=12345" });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe("12345");
      expect((await env.app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1" })).statusCode).toBe(403);
    } finally {
      delete process.env.WHATSAPP_APP_SECRET;
      delete process.env.WHATSAPP_VERIFY_TOKEN;
    }
  });
});

// ---------------------------------------------------------------- aislamiento
describe("aislamiento entre clínicas", () => {
  it("otra clínica no ve ni modifica plantillas, reglas, programación, entregas ni enlaces", async () => {
    const a = await scenario();
    const pid = await createPatient(a.owner, { consentReminders: true });
    const T = lp(3, 15);
    await appointment(a, pid, T);
    const ruleA = await rule(a, {});
    await run(a, minus(T, { hours: 23 }));
    expect(await outbox(a.k.clinicId)).toHaveLength(1);
    const b = await scenario();
    const tb = (await b.owner.get("/api/messaging/templates")).body.map((t: any) => t.id);
    expect(tb).not.toContain(a.templates.Recordatorio);
    expect((await b.owner.get("/api/messaging/rules")).body).toEqual([]);
    expect((await b.owner.get("/api/messaging/deliveries")).body.items).toEqual([]);
    expect((await b.owner.get("/api/messaging/jobs?status=done")).body).toEqual([]);
    expect((await b.owner.put(`/api/messaging/rules/${ruleA}`, { name: "Robo", trigger: "appointment_reminder", offsetMinutes: 1440, templateId: b.templates.Recordatorio, active: false })).status).toBe(404);
    expect((await b.owner.put(`/api/messaging/templates/${a.templates.Recordatorio}`, { name: "Robo", body: "Hola {nombre}", active: true })).status).toBe(404);
    expect((await b.owner.get(`/api/messaging/templates/${a.templates.Recordatorio}/versions`)).status).toBe(404);
    const msgA = (await outbox(a.k.clinicId))[0];
    expect((await b.owner.post(`/api/messaging/messages/${msgA.id}/retry`)).status).toBe(404);
    // Una regla de B no puede apuntar a una plantilla de A.
    expect((await b.owner.post("/api/messaging/rules", { name: "Cruzada", trigger: "appointment_reminder", offsetMinutes: 1440, templateId: a.templates.Recordatorio, active: true })).status).toBe(400);
    // SQL directo con el contexto de B: 0 filas de A en las tablas nuevas; insertar con el id de A es rechazado.
    await withTenant(env.db.appPool, { clinicId: b.k.clinicId, userId: null }, async (c) => {
      for (const t of ["messaging_settings", "message_templates", "message_template_versions", "message_rules", "message_jobs", "message_confirm_tokens", "inbound_messages"]) {
        expect((await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE clinic_id = $1`, [a.k.clinicId])).rows[0].n, t).toBe(0);
      }
    });
    await expect(withTenant(env.db.appPool, { clinicId: b.k.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO message_templates (clinic_id, name, purpose) VALUES ($1, 'Intrusa', 'reminders')", [a.k.clinicId]))).rejects.toThrow(/row-level security/);
    // El programador de B no procesa nada de A.
    const sb = await runSchedulerOnce(env.db, minus(T, { hours: 22 }), { clinicIds: [b.k.clinicId] });
    expect(sb.sent).toBe(0);
    expect(await outbox(a.k.clinicId)).toHaveLength(1);
    // Ejecución global (como el intervalo de main.ts): recorre las clínicas con reglas activas y no duplica.
    const all = await runSchedulerOnce(env.db, minus(T, { hours: 22 }));
    expect(all.clinics).toBeGreaterThanOrEqual(1);
    expect(await outbox(a.k.clinicId)).toHaveLength(1);
  });
});
