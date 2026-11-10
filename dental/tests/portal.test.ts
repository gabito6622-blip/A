import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { createMessenger } from "../server/src/lib/messaging.js";
import { addUser, createClinic, createPatient, fullSchedule, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, recep0: Agent;
let d1: { id: string }, d2: { id: string }, d3: { id: string };
let slug: string, slug2: string;
let CON: string, PRE: string;
const ZONE = "America/La_Paz";
let ipSeq = 1;
const nextIp = () => `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

interface PClient { call(method: "GET" | "POST", url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any; headers: Record<string, unknown> }>; cookie: string }

function client(s: string, ip = nextIp()): PClient {
  const pc: PClient = {
    cookie: "",
    async call(method, url, body, headers = {}) {
      const r = await env.app.inject({
        method, url: `/api/public/c/${s}${url}`, remoteAddress: ip,
        headers: { "x-portal": "1", ...(pc.cookie ? { cookie: pc.cookie } : {}), ...headers },
        ...(method === "POST" ? { payload: (body ?? {}) as object } : {}),
      });
      const sc = r.headers["set-cookie"];
      const line = (Array.isArray(sc) ? sc : sc ? [String(sc)] : []).find((x) => x.startsWith("psid="));
      if (line) pc.cookie = line.split(";")[0]!;
      let parsed: unknown = r.body;
      try { parsed = r.json(); } catch { /* texto */ }
      return { status: r.statusCode, body: parsed as any, headers: r.headers as Record<string, unknown> };
    },
  };
  return pc;
}

async function otpFor(challengeId: string): Promise<string | null> {
  const r = await env.db.adminPool.query<{ body: string }>("SELECT body FROM outbound_messages WHERE related_id = $1", [challengeId]);
  return r.rows[0]?.body.match(/\b\d{6}\b/)?.[0] ?? null;
}

async function loginExisting(pc: PClient, documentNumber: string, birthDate: string) {
  const r = await pc.call("POST", "/auth/existing", { documentNumber, birthDate });
  expect(r.status).toBe(200);
  const code = await otpFor(r.body.challengeId);
  expect(code).toBeTruthy();
  const v = await pc.call("POST", "/auth/verify", { challengeId: r.body.challengeId, code });
  expect(v.status).toBe(200);
  return v.body;
}

async function signup(pc: PClient, data: Record<string, unknown>) {
  const r = await pc.call("POST", "/auth/signup", data);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const code = await otpFor(r.body.challengeId);
  const v = await pc.call("POST", "/auth/verify", { challengeId: r.body.challengeId, code });
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  return v.body;
}

const phone = () => `7${Math.floor(1000000 + Math.random() * 8999999)}`;
const doc = () => String(Math.floor(1e6 + Math.random() * 8e6));
const tomorrow = () => DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate()!;
const dayPlus = (n: number) => DateTime.now().setZone(ZONE).plus({ days: n }).toISODate()!;

async function enable(agent: Agent, k: TestClinic, over: Record<string, unknown> = {}) {
  const s = await agent.get("/api/portal/settings");
  expect(s.status).toBe(200);
  const svc = s.body.services.filter((x: any) => ["CON-01", "PRE-01"].includes(x.code));
  const r = await agent.put("/api/portal/settings", {
    enabled: true, slug: s.body.slug, leadTimeHours: 2, maxDaysAhead: 30, changeWindowHours: 24, showPrices: true, instructions: "Llega 10 minutos antes.",
    branches: [
      { branchId: k.branches[0], enabled: true, mode: "instant", whatsapp: "71234567", mapUrl: null },
      { branchId: k.branches[1], enabled: true, mode: "request", whatsapp: "+59172222222", mapUrl: "https://maps.example.org/s2" },
    ],
    services: svc.map((x: any) => ({ procedureId: x.procedureId, priceFromCents: 10000 })),
    ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return s.body.slug as string;
}

async function firstSlot(pc: PClient, q: { branchId: string; procedureId: string; dentistId?: string; date?: string; skip?: number }) {
  const r = await pc.call("GET", `/slots?branchId=${q.branchId}&procedureId=${q.procedureId}${q.dentistId ? `&dentistId=${q.dentistId}` : ""}&date=${q.date ?? tomorrow()}`);
  expect(r.status).toBe(200);
  expect(r.body.length).toBeGreaterThan(q.skip ?? 0);
  return r.body[q.skip ?? 0] as { startsAt: string; dentistId: string };
}

const bookBody = (slot: { startsAt: string; dentistId: string }, patientId: string, over: Record<string, unknown> = {}) => ({
  branchId: K.branches[0], procedureId: CON, dentistId: slot.dentistId, startsAt: slot.startsAt, patientId, idempotencyKey: `k-${randomUUID()}`,
  consents: { dataProcessing: true, reminders: true, marketing: false }, ...over,
});

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2, name: "Clínica Portal" });
  K2 = await createClinic(env.db, { branches: 2, name: "Otra Clínica" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  d1 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  d2 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!, K.branches[1]!] });
  d3 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  await fullSchedule(env.db, K.clinicId, d1.id, K.branches[0]!);
  await fullSchedule(env.db, K.clinicId, d2.id, K.branches[1]!);
  recep0 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  CON = await procedureId(env.db, K.clinicId, "CON-01");
  PRE = await procedureId(env.db, K.clinicId, "PRE-01");
  slug = (await env.db.adminPool.query("SELECT slug FROM clinics WHERE id = $1", [K.clinicId])).rows[0].slug;
  slug2 = (await env.db.adminPool.query("SELECT slug FROM clinics WHERE id = $1", [K2.clinicId])).rows[0].slug;
});
afterAll(async () => teardown(env));

describe("configuración y página pública", () => {
  it("con la reserva desactivada la página pública responde 404 (y un slug inexistente también)", async () => {
    expect((await client(slug).call("GET", "/info")).status).toBe(404);
    expect((await client("no-existe-xyz").call("GET", "/info")).status).toBe(404);
  });

  it("solo administración configura; activar sin prestaciones devuelve el error junto al campo", async () => {
    expect((await recep0.get("/api/portal/settings")).status).toBe(403);
    const s = await owner.get("/api/portal/settings");
    const r = await owner.put("/api/portal/settings", {
      enabled: true, slug: s.body.slug, leadTimeHours: 2, maxDaysAhead: 30, changeWindowHours: 24, showPrices: false, instructions: null,
      branches: [{ branchId: K.branches[0], enabled: true, mode: "instant", whatsapp: "123", mapUrl: "http://inseguro" }], services: [],
    });
    expect(r.status).toBe(400);
    const paths = r.body.error.details.map((d: any) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["branches.0.whatsapp", "branches.0.mapUrl", "services"]));
  });

  it("activada: muestra sucursales con mapa y WhatsApp, prestaciones con duración y precio desde", async () => {
    await enable(owner, K);
    const r = await client(slug).call("GET", "/info");
    expect(r.status).toBe(200);
    expect(r.body.clinic.name).toBe("Clínica Portal");
    expect(r.body.branches).toHaveLength(2);
    expect(r.body.branches[0].whatsappUrl).toMatch(/^https:\/\/wa\.me\/59171234567/);
    expect(r.body.branches[1].mapUrl).toBe("https://maps.example.org/s2");
    expect(r.body.branches[0].mapUrl).toMatch(/^https:\/\/www\.google\.com\/maps/);
    const con = r.body.services.find((x: any) => x.id === CON);
    expect(con).toMatchObject({ durationMin: 30, priceFromCents: 10000 });
    expect(r.body.services.map((x: any) => x.id)).not.toContain(await procedureId(env.db, K.clinicId, "END-01"));
    expect(r.body.paymentNote).toMatch(/la clínica confirma el pago/);
  });

  it("las escrituras públicas exigen la cabecera X-Portal (protección contra envíos de otros sitios)", async () => {
    const r = await client(slug).call("POST", "/auth/existing", { documentNumber: "1234567", birthDate: "1990-01-01" }, { "x-portal": "0" });
    expect(r.status).toBe(403);
  });
});

describe("identificación con código de un solo uso", () => {
  let ci: string, ph: string;
  beforeAll(async () => {
    ci = doc(); ph = phone();
    await createPatient(owner, { firstName: "Rosa", lastName: "Quispe", documentNumber: ci, birthDate: "1950-03-04", phone: ph });
  });

  it("misma respuesta exista o no el paciente; solo se envía mensaje si existe", async () => {
    const a = await client(slug).call("POST", "/auth/existing", { documentNumber: ci, birthDate: "1950-03-04" });
    const b = await client(slug).call("POST", "/auth/existing", { documentNumber: doc(), birthDate: "1950-03-04" });
    const c = await client(slug).call("POST", "/auth/existing", { documentNumber: ci, birthDate: "1951-03-04" });
    for (const r of [a, b, c]) expect(r.status).toBe(200);
    const strip = (x: any) => ({ ...x, challengeId: undefined });
    expect(strip(b.body)).toEqual(strip(a.body));
    expect(strip(c.body)).toEqual(strip(a.body));
    expect(await otpFor(a.body.challengeId)).toMatch(/^\d{6}$/);
    expect(await otpFor(b.body.challengeId)).toBeNull();
    expect(await otpFor(c.body.challengeId)).toBeNull();
    // Un código equivocado se comporta igual con y sin paciente
    const wa = await client(slug).call("POST", "/auth/verify", { challengeId: a.body.challengeId, code: "000000" === (await otpFor(a.body.challengeId)) ? "111111" : "000000" });
    const wb = await client(slug).call("POST", "/auth/verify", { challengeId: b.body.challengeId, code: "000000" });
    expect(wa.status).toBe(400); expect(wb.status).toBe(400);
    expect(wb.body).toEqual(wa.body);
    expect(wa.body.error.message).toBe("Código incorrecto. Te quedan 4 intentos.");
  });

  it("el mensaje queda en la bandeja como simulado (nunca se envía fuera de producción) y lo ve administración", async () => {
    const m = await owner.get("/api/messages");
    expect(m.status).toBe(200);
    expect(m.body.mode).toBe("simulate");
    const otp = m.body.items.find((x: any) => x.template === "portal.otp");
    expect(otp.status).toBe("simulated");
    expect(otp.body).toMatch(/\d{6} es tu código/);
    expect((await recep0.get("/api/messages")).status).toBe(403);
  });

  it("5 intentos como máximo; luego ni el código correcto sirve", async () => {
    const pc = client(slug);
    const r = await pc.call("POST", "/auth/existing", { documentNumber: ci, birthDate: "1950-03-04" });
    const code = (await otpFor(r.body.challengeId))!;
    const wrong = code === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i++) expect((await pc.call("POST", "/auth/verify", { challengeId: r.body.challengeId, code: wrong })).status).toBe(400);
    const v = await pc.call("POST", "/auth/verify", { challengeId: r.body.challengeId, code });
    expect(v.status).toBe(400);
    expect(v.body.error.code).toBe("otp_locked");
    expect(pc.cookie).toBe("");
  });

  it("el código vence a los 10 minutos y es de un solo uso", async () => {
    const pc = client(slug);
    const r = await pc.call("POST", "/auth/existing", { documentNumber: ci, birthDate: "1950-03-04" });
    const exp = (await env.db.adminPool.query("SELECT expires_at - created_at AS d FROM portal_otps WHERE id = $1", [r.body.challengeId])).rows[0].d;
    expect(exp.minutes).toBe(10);
    await env.db.adminPool.query("UPDATE portal_otps SET expires_at = now() - interval '1 second' WHERE id = $1", [r.body.challengeId]);
    const v = await pc.call("POST", "/auth/verify", { challengeId: r.body.challengeId, code: (await otpFor(r.body.challengeId))! });
    expect(v.body.error.code).toBe("otp_invalid");
    const r2 = await pc.call("POST", "/auth/existing", { documentNumber: ci, birthDate: "1950-03-04" });
    const code = (await otpFor(r2.body.challengeId))!;
    expect((await pc.call("POST", "/auth/verify", { challengeId: r2.body.challengeId, code })).status).toBe(200);
    expect((await client(slug).call("POST", "/auth/verify", { challengeId: r2.body.challengeId, code })).body.error.code).toBe("otp_invalid");
  });

  it("la sesión del paciente es una cookie HttpOnly limitada a /api/public y no abre la API del personal", async () => {
    const ci3 = doc();
    const pid3 = await createPatient(owner, { firstName: "Óscar", lastName: "Huanca", documentNumber: ci3, birthDate: "1948-07-08", phone: phone() });
    const pc = client(slug);
    const me = await loginExisting(pc, ci3, "1948-07-08");
    expect(me.patient.id).toBe(pid3);
    expect(me.phoneMasked).toMatch(/^•••• \d{3}$/);
    const set = await (async () => {
      const r = await pc.call("POST", "/auth/existing", { documentNumber: ci3, birthDate: "1948-07-08" });
      const raw = await env.app.inject({ method: "POST", url: `/api/public/c/${slug}/auth/verify`, remoteAddress: "10.9.9.9", headers: { "x-portal": "1" }, payload: { challengeId: r.body.challengeId, code: (await otpFor(r.body.challengeId))! } });
      return String(raw.headers["set-cookie"]);
    })();
    expect(set).toMatch(/psid=/); expect(set).toMatch(/HttpOnly/i); expect(set).toMatch(/Path=\/api\/public/); expect(set).toMatch(/SameSite=Strict/i);
    const staff = await env.app.inject({ method: "GET", url: "/api/patients", headers: { cookie: pc.cookie } });
    expect(staff.statusCode).toBe(401);
    expect((await pc.call("POST", "/auth/logout")).status).toBe(200);
    expect((await pc.call("GET", "/me")).status).toBe(401);
  });

  it("límites: por documento (5/h) y por IP (10/h) con mensaje claro", async () => {
    const d = doc();
    for (let i = 0; i < 5; i++) expect((await client(slug).call("POST", "/auth/existing", { documentNumber: d, birthDate: "1980-01-01" })).status).toBe(200);
    const r = await client(slug).call("POST", "/auth/existing", { documentNumber: d, birthDate: "1980-01-01" });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/Espera unos minutos/);
    const ip = nextIp();
    for (let i = 0; i < 10; i++) expect((await client(slug, ip).call("POST", "/auth/existing", { documentNumber: doc(), birthDate: "1980-01-01" })).status).toBe(200);
    expect((await client(slug, ip).call("POST", "/auth/existing", { documentNumber: doc(), birthDate: "1980-01-01" })).status).toBe(429);
  });

  it("paciente nuevo: valida todo junto (menor sin responsable, celular inválido) y crea la ficha al verificar", async () => {
    const bad = await client(slug).call("POST", "/auth/signup", { firstName: "", lastName: "Mamani", documentNumber: null, birthDate: dayPlus(-365 * 5), phone: "123" });
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.map((d: any) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["firstName", "phone", "guardianName"]));
    const ph2 = phone();
    const me = await signup(client(slug), { firstName: "Lucía", lastName: "Mamani Copa", documentNumber: null, birthDate: dayPlus(-365 * 6), phone: ph2, guardianName: "Carmen Copa", guardianRelationship: "Madre", branchId: K.branches[0] });
    const p = (await env.db.adminPool.query("SELECT document_type, phone, guardian_phone, guardian_name, referral_source, created_by FROM patients WHERE id = $1", [me.patient.id])).rows[0];
    expect(p).toMatchObject({ document_type: "SIN", phone: null, guardian_phone: `+591${ph2}`, guardian_name: "Carmen Copa", referral_source: "Reserva web", created_by: null });
  });

  it("duplicados: mismo CI y mismo celular → se reconoce la ficha; mismo CI y otro celular → ficha aparte para revisar, sin revelar nada", async () => {
    const ci2 = doc(), ph2 = phone();
    const existing = await createPatient(owner, { firstName: "Hugo", lastName: "Limachi", documentNumber: ci2, birthDate: "1985-02-02", phone: ph2 });
    const a = await signup(client(slug), { firstName: "Hugo", lastName: "Limachi", documentNumber: ci2, birthDate: "1985-02-02", phone: ph2 });
    expect(a.patient.id).toBe(existing);
    const pc = client(slug);
    const r = await pc.call("POST", "/auth/signup", { firstName: "Hugo", lastName: "Limachi", documentNumber: ci2, birthDate: "1985-02-02", phone: phone() });
    expect(r.body.message).toMatch(/Enviamos un código/);
    const v = await pc.call("POST", "/auth/verify", { challengeId: r.body.challengeId, code: await otpFor(r.body.challengeId) });
    expect(v.status).toBe(200);
    expect(v.body.patient.id).not.toBe(existing);
    const p = (await env.db.adminPool.query("SELECT document_type, document_number, notes FROM patients WHERE id = $1", [v.body.patient.id])).rows[0];
    expect(p.document_type).toBe("SIN");
    expect(p.document_number).toBeNull();
    expect(p.notes).toMatch(/coincide con otra ficha/);
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'portal.possible_duplicate' AND entity_id = $1", [v.body.patient.id])).rows[0].n).toBe(1);
  });
});

describe("disponibilidad, retención y reserva", () => {
  let pa: PClient, pb: PClient, idA: string, idB: string;
  beforeAll(async () => {
    pa = client(slug); pb = client(slug);
    idA = (await signup(pa, { firstName: "Ana", lastName: "Flores", documentNumber: doc(), birthDate: "1992-01-01", phone: phone() })).patient.id;
    idB = (await signup(pb, { firstName: "Bruno", lastName: "Rocha", documentNumber: doc(), birthDate: "1991-01-01", phone: phone() })).patient.id;
  });

  it("nunca ofrece horas pasadas ni dentro de la anticipación mínima; respeta los días máximos", async () => {
    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const r = await pa.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&date=${today}`);
    for (const s of r.body) expect(Date.parse(s.startsAt)).toBeGreaterThanOrEqual(Date.now() + 2 * 3_600_000 - 1000);
    expect((await pa.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&date=${dayPlus(-1)}`)).body).toEqual([]);
    expect((await pa.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&date=${dayPlus(31)}`)).body).toEqual([]);
    const days = await pa.call("GET", `/days?branchId=${K.branches[0]}&procedureId=${CON}`);
    expect(days.body.days[0].date).toBe(today);
    expect(days.body.days.length).toBe(14);
    const tooSoon = DateTime.now().plus({ hours: 1 }).toUTC().toISO();
    const past = DateTime.now().minus({ hours: 3 }).toUTC().toISO();
    const far = DateTime.now().setZone(ZONE).plus({ days: 40 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toISO();
    const slot = await firstSlot(pa, { branchId: K.branches[0]!, procedureId: CON });
    expect((await pa.call("POST", "/bookings", bookBody({ ...slot, startsAt: past! }, idA))).body.error.code).toBe("slot_past");
    expect((await pa.call("POST", "/bookings", bookBody({ ...slot, startsAt: tooSoon! }, idA))).body.error.code).toBe("slot_too_soon");
    expect((await pa.call("POST", "/bookings", bookBody({ ...slot, startsAt: far! }, idA))).body.error.code).toBe("slot_too_far");
  });

  it("la disponibilidad usa el mismo motor de la agenda: una cita de recepción y un bloqueo quitan horarios", async () => {
    const date = dayPlus(2);
    const before = (await pa.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&dentistId=${d1.id}&date=${date}`)).body.map((s: any) => s.startsAt);
    const nine = DateTime.fromISO(`${date}T09:00`, { zone: ZONE }).toUTC().toISO()!.replace(".000", "");
    const at = (iso: string) => new Date(iso).toISOString();
    expect(before).toContain(at(nine));
    const p = await createPatient(owner);
    expect((await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: d1.id, patientId: p, startsAt: nine, durationMin: 30 })).status).toBe(200);
    const after = (await pa.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&dentistId=${d1.id}&date=${date}`)).body.map((s: any) => s.startsAt);
    expect(after).not.toContain(at(nine));
  });

  it("retención: el horario apartado desaparece para otros y no lo pueden reservar; quien lo apartó sí", async () => {
    const slot = await firstSlot(pa, { branchId: K.branches[0]!, procedureId: CON, dentistId: d1.id, date: dayPlus(3) });
    const h = await pa.call("POST", "/holds", { branchId: K.branches[0], procedureId: CON, dentistId: slot.dentistId, startsAt: slot.startsAt });
    expect(h.status).toBe(200);
    expect(Date.parse(h.body.expiresAt) - Date.now()).toBeGreaterThan(6 * 60_000);
    const others = (await pb.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&dentistId=${d1.id}&date=${dayPlus(3)}`)).body.map((s: any) => s.startsAt);
    expect(others).not.toContain(slot.startsAt);
    const mine = (await pa.call("GET", `/slots?branchId=${K.branches[0]}&procedureId=${CON}&dentistId=${d1.id}&date=${dayPlus(3)}&holdToken=${h.body.holdToken}`)).body.map((s: any) => s.startsAt);
    expect(mine).toContain(slot.startsAt);
    expect((await pb.call("POST", "/holds", { branchId: K.branches[0], procedureId: CON, dentistId: slot.dentistId, startsAt: slot.startsAt })).status).toBe(409);
    expect((await pb.call("POST", "/bookings", bookBody(slot, idB))).body.error.code).toBe("slot_taken");
    const rev = await pa.call("GET", `/review?branchId=${K.branches[0]}&procedureId=${CON}&dentistId=${slot.dentistId}&startsAt=${encodeURIComponent(slot.startsAt)}&holdToken=${h.body.holdToken}`);
    expect(rev.body).toMatchObject({ available: true, mode: "instant", durationMin: 30, priceFromCents: 10000, instructions: "Llega 10 minutos antes." });
    expect(rev.body.cancellationPolicy).toMatch(/24 h/);
    const key = `k-${randomUUID()}`;
    const b = await pa.call("POST", "/bookings", bookBody(slot, idA, { holdToken: h.body.holdToken, idempotencyKey: key }));
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body).toMatchObject({ mode: "instant", status: "confirmed", time: expect.stringMatching(/^\d{2}:\d{2}$/) });
    expect(b.body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(b.body.icsUrl).toMatch(/\/ics$/);
    expect(b.body.branch.whatsappUrl).toMatch(/wa\.me\/59171234567/);
    const appt = (await env.db.adminPool.query("SELECT source, status, created_by, patient_id FROM appointments WHERE id = $1", [b.body.appointmentId])).rows[0];
    expect(appt).toMatchObject({ source: "portal", status: "scheduled", created_by: null, patient_id: idA });
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM portal_slot_holds WHERE token_hash = sha256($1::bytea)", [Buffer.from(h.body.holdToken)])).rows[0].n).toBe(0);
    // Reintento (doble toque o mala señal): misma reserva, sin duplicar
    const again = await pa.call("POST", "/bookings", bookBody(slot, idA, { idempotencyKey: key }));
    expect(again.body.id).toBe(b.body.id);
    expect(again.body.duplicate).toBe(true);
    // .ics descargable sin datos clínicos
    const ics = await pa.call("GET", `/me/appointments/${b.body.appointmentId}/ics`);
    expect(ics.status).toBe(200);
    expect(String(ics.headers["content-type"])).toMatch(/text\/calendar/);
    expect(ics.body).toMatch(/BEGIN:VEVENT/);
    expect(ics.body).toMatch(new RegExp(b.body.code));
    // Mensaje de confirmación en la bandeja y auditoría
    expect((await env.db.adminPool.query("SELECT status FROM outbound_messages WHERE related_id = $1 AND template = 'portal.booking_confirmed'", [b.body.id])).rows[0].status).toBe("simulated");
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'portal.booking_created' AND entity_id = $1", [b.body.id])).rows[0].n).toBe(1);
  });

  it("consentimientos separados: datos obligatorio; recordatorios y marketing quedan como documentos 'online_checkbox'", async () => {
    const slot = await firstSlot(pb, { branchId: K.branches[0]!, procedureId: CON, date: dayPlus(4) });
    const no = await pb.call("POST", "/bookings", bookBody(slot, idB, { consents: { dataProcessing: false, reminders: false, marketing: false } }));
    expect(no.status).toBe(400);
    const ok = await pb.call("POST", "/bookings", bookBody(slot, idB, { consents: { dataProcessing: true, reminders: true, marketing: false } }));
    expect(ok.status).toBe(200);
    const docs = (await env.db.adminPool.query("SELECT kind, decision, method, recorded_by FROM signed_documents WHERE patient_id = $1 ORDER BY kind", [idB])).rows;
    expect(docs).toEqual([
      { kind: "data_processing", decision: "granted", method: "online_checkbox", recorded_by: null },
      { kind: "marketing", decision: "refused", method: "online_checkbox", recorded_by: null },
      { kind: "reminders", decision: "granted", method: "online_checkbox", recorded_by: null },
    ]);
    expect((await env.db.adminPool.query("SELECT consent_reminders, consent_marketing FROM patients WHERE id = $1", [idB])).rows[0]).toEqual({ consent_reminders: true, consent_marketing: false });
    // El personal los ve en la ficha
    const list = await owner.get(`/api/patients/${idB}/documents`);
    expect(list.body.documents.map((d: any) => d.recordedBy)).toContain("El paciente (reserva web)");
    // Máximo 2 reservas web por venir por paciente
    const s2 = await firstSlot(pb, { branchId: K.branches[0]!, procedureId: CON, date: dayPlus(5) });
    expect((await pb.call("POST", "/bookings", bookBody(s2, idB))).status).toBe(200);
    const s3 = await firstSlot(pb, { branchId: K.branches[0]!, procedureId: CON, date: dayPlus(6) });
    expect((await pb.call("POST", "/bookings", bookBody(s3, idB))).body.error.code).toBe("too_many_bookings");
  });

  it("concurrencia: dos pacientes confirman el mismo horario a la vez → solo uno gana", async () => {
    const pc = client(slug), pd = client(slug);
    const idC = (await signup(pc, { firstName: "Carla", lastName: "Peña", documentNumber: doc(), birthDate: "1990-01-01", phone: phone() })).patient.id;
    const idD = (await signup(pd, { firstName: "Diego", lastName: "Ortiz", documentNumber: doc(), birthDate: "1990-01-01", phone: phone() })).patient.id;
    const slot = await firstSlot(pc, { branchId: K.branches[0]!, procedureId: CON, dentistId: d1.id, date: dayPlus(7), skip: 3 });
    const [r1, r2] = await Promise.all([pc.call("POST", "/bookings", bookBody(slot, idC)), pd.call("POST", "/bookings", bookBody(slot, idD))]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const n = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointments WHERE dentist_id = $1 AND starts_at = $2 AND status <> 'cancelled'", [d1.id, slot.startsAt])).rows[0].n;
    expect(n).toBe(1);
  });

  it("modo solicitud: queda pendiente, recepción la aprueba (crea la cita) o la rechaza con motivo; respeta sucursales", async () => {
    const pc = client(slug);
    const id = (await signup(pc, { firstName: "Elena", lastName: "Choque", documentNumber: doc(), birthDate: "1988-01-01", phone: phone() })).patient.id;
    const s1 = await firstSlot(pc, { branchId: K.branches[1]!, procedureId: PRE, date: dayPlus(3) });
    const r1 = await pc.call("POST", "/bookings", bookBody(s1, id, { branchId: K.branches[1], procedureId: PRE }));
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ mode: "request", status: "pending", appointmentId: null, durationMin: 45 });
    const s2 = await firstSlot(pc, { branchId: K.branches[1]!, procedureId: CON, date: dayPlus(4) });
    const r2 = await pc.call("POST", "/bookings", bookBody(s2, id, { branchId: K.branches[1], procedureId: CON }));
    const inbox = await owner.get("/api/portal/requests");
    expect(inbox.body.map((x: any) => x.code)).toEqual(expect.arrayContaining([r1.body.code, r2.body.code]));
    // Recepción de otra sucursal no ve ni aprueba
    expect((await recep0.get("/api/portal/requests")).body.map((x: any) => x.id)).not.toContain(r1.body.id);
    expect((await recep0.post(`/api/portal/requests/${r1.body.id}/approve`, {})).status).toBe(403);
    const ap = await owner.post(`/api/portal/requests/${r1.body.id}/approve`, {});
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const appt = (await env.db.adminPool.query("SELECT source, patient_id, procedure_id FROM appointments WHERE id = $1", [ap.body.appointmentId])).rows[0];
    expect(appt).toEqual({ source: "portal", patient_id: id, procedure_id: PRE });
    expect((await owner.post(`/api/portal/requests/${r1.body.id}/approve`, {})).status).toBe(409);
    expect((await owner.post(`/api/portal/requests/${r2.body.id}/reject`, { reason: "" })).status).toBe(400);
    expect((await owner.post(`/api/portal/requests/${r2.body.id}/reject`, { reason: "La profesional no atiende ese día" })).status).toBe(200);
    const mine = await pc.call("GET", "/me/appointments");
    expect(mine.body.upcoming.map((a: any) => a.id)).toContain(ap.body.appointmentId);
    expect(mine.body.requests.find((x: any) => x.id === r2.body.id)).toMatchObject({ status: "rejected", decisionReason: "La profesional no atiende ese día" });
    const msgs = (await env.db.adminPool.query("SELECT template FROM outbound_messages WHERE related_id = ANY($1) ORDER BY created_at", [[r1.body.id, r2.body.id]])).rows.map((x) => x.template);
    expect(msgs).toEqual(expect.arrayContaining(["portal.booking_requested", "portal.request_approved", "portal.request_rejected"]));
  });

  it("aprobar valida como la agenda: si el horario se ocupó mientras tanto, responde 409", async () => {
    const pc = client(slug);
    const id = (await signup(pc, { firstName: "Félix", lastName: "Torrez", documentNumber: doc(), birthDate: "1987-01-01", phone: phone() })).patient.id;
    const s = await firstSlot(pc, { branchId: K.branches[1]!, procedureId: CON, date: dayPlus(9) });
    const r = await pc.call("POST", "/bookings", bookBody(s, id, { branchId: K.branches[1], procedureId: CON }));
    const other = await createPatient(owner);
    expect((await owner.post("/api/appointments", { branchId: K.branches[1], dentistId: s.dentistId, patientId: other, startsAt: s.startsAt, durationMin: 30 })).status).toBe(200);
    const ap = await owner.post(`/api/portal/requests/${r.body.id}/approve`, {});
    expect(ap.status).toBe(409);
    expect(ap.body.error.code).toBe("appointment_overlap_dentist");
  });
});

describe("portal: reprogramar, cancelar y datos solo de la familia", () => {
  let mother: { ci: string; phone: string; id: string }, child: string, adultSon: string, stranger: string;
  let pm: PClient;
  beforeAll(async () => {
    const ph = phone();
    const ci = doc();
    mother = { ci, phone: ph, id: await createPatient(owner, { firstName: "Carmen", lastName: "Alanoca", documentNumber: ci, birthDate: "1990-06-01", phone: ph }) };
    child = await createPatient(owner, { firstName: "Mateo", lastName: "Alanoca", documentType: "SIN", documentNumber: null, birthDate: dayPlus(-365 * 7), phone: null, guardianName: "Carmen Alanoca", guardianPhone: ph });
    adultSon = await createPatient(owner, { firstName: "Iván", lastName: "Alanoca", documentNumber: doc(), birthDate: "2000-01-01", phone: phone(), guardianName: "Carmen Alanoca", guardianPhone: ph });
    stranger = await createPatient(owner);
    pm = client(slug);
    await loginExisting(pm, mother.ci, "1990-06-01");
  });

  it("la madre ve a su hijo menor (mismo celular de responsable), pero no a un adulto ni a otros pacientes", async () => {
    const me = await pm.call("GET", "/me");
    const ids = me.body.family.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining([mother.id, child]));
    expect(ids).not.toContain(adultSon);
    expect(ids).not.toContain(stranger);
    expect((await pm.call("GET", `/me/account?patientId=${child}`)).status).toBe(200);
    expect((await pm.call("GET", `/me/account?patientId=${adultSon}`)).status).toBe(404);
    expect((await pm.call("GET", `/me/budgets?patientId=${stranger}`)).status).toBe(404);
  });

  it("saldo con una sola función, pagos con comprobante y presupuestos presentados en solo lectura", async () => {
    const pay = await owner.post("/api/payments", { branchId: K.branches[0], patientId: child, amountCents: 5000, method: "cash", idempotencyKey: `p-${randomUUID()}` });
    expect(pay.status).toBe(200);
    const pend = await owner.post("/api/payments", { branchId: K.branches[0], patientId: child, amountCents: 3000, method: "transfer", bankReference: `OP-${randomUUID().slice(0, 6)}`, idempotencyKey: `p-${randomUUID()}` });
    const strangerPay = await owner.post("/api/payments", { branchId: K.branches[0], patientId: stranger, amountCents: 1000, method: "cash", idempotencyKey: `p-${randomUUID()}` });
    const acc = await pm.call("GET", `/me/account?patientId=${child}`);
    expect(acc.body).toMatchObject({ paidCents: 5000, pendingVerificationCents: 3000, balanceCents: -5000 });
    const sql = (await env.db.adminPool.query("SELECT * FROM patient_balance($1)", [child])).rows[0];
    expect(Number(sql.balance_cents)).toBe(acc.body.balanceCents);
    const rc = await pm.call("GET", `/me/payments/${pay.body.id}`);
    expect(rc.status).toBe(200);
    expect(rc.body).toMatchObject({ amountCents: 5000, patientName: "Mateo Alanoca", method: "Efectivo" });
    expect((await pm.call("GET", `/me/payments/${pend.body.id}`)).body.error.code).toBe("not_confirmed");
    expect((await pm.call("GET", `/me/payments/${strangerPay.body.id}`)).status).toBe(404);
    const c = await env.db.adminPool.connect();
    try {
      const b = (await c.query("INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status, presented_at) VALUES ($1, 900, $2, $3, $4, 'presented', now()) RETURNING id", [K.clinicId, K.branches[0], child, d1.id])).rows[0].id;
      await c.query("INSERT INTO budget_items (clinic_id, budget_id, procedure_id, description, unit_price_cents) VALUES ($1,$2,$3,'Sellante',9000)", [K.clinicId, b, PRE]);
      await c.query("INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status) VALUES ($1, 901, $2, $3, $4, 'draft')", [K.clinicId, K.branches[0], child, d1.id]);
    } finally { c.release(); }
    const bud = await pm.call("GET", `/me/budgets?patientId=${child}`);
    expect(bud.body).toHaveLength(1);
    expect(bud.body[0]).toMatchObject({ number: 900, totalCents: 9000, status: "presented" });
  });

  it("cancelar dentro del plazo funciona; a menos de 24 h se rechaza con indicación de escribir a la sucursal", async () => {
    const soon = (await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4, date_trunc('minute', now()) + interval '5 hours', date_trunc('minute', now()) + interval '5 hours 30 minutes') RETURNING id",
      [K.clinicId, K.branches[0], d3.id, child])).rows[0].id;
    const r = await pm.call("POST", `/me/appointments/${soon}/cancel`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/WhatsApp/);
    expect((await pm.call("POST", `/me/appointments/${soon}/reschedule`, { startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), dentistId: d1.id })).body.error.code).toBe("outside_window");
    const list = await pm.call("GET", "/me/appointments");
    expect(list.body.upcoming.find((a: any) => a.id === soon)).toMatchObject({ canChange: false, patientName: "Mateo Alanoca" });
  });

  it("reprogramar con el mismo motor y luego cancelar; no se puede tocar la cita de otro paciente", async () => {
    const later = (await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, procedure_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5, date_trunc('hour', now()) + interval '10 days 3 hours', date_trunc('hour', now()) + interval '10 days 3 hours 30 minutes') RETURNING id",
      [K.clinicId, K.branches[0], d3.id, child, CON])).rows[0].id;
    const slots = await pm.call("GET", `/slots?branchId=${K.branches[0]}&rescheduleId=${later}&date=${dayPlus(12)}`);
    expect(slots.status).toBe(200);
    const s = slots.body[2];
    const rs = await pm.call("POST", `/me/appointments/${later}/reschedule`, { startsAt: s.startsAt, dentistId: s.dentistId });
    expect(rs.status, JSON.stringify(rs.body)).toBe(200);
    const a = (await env.db.adminPool.query("SELECT starts_at, dentist_id, reschedule_count FROM appointments WHERE id = $1", [later])).rows[0];
    expect(a.starts_at.toISOString()).toBe(new Date(s.startsAt).toISOString());
    expect(a.reschedule_count).toBe(1);
    expect((await pm.call("POST", `/me/appointments/${later}/cancel`, { reason: "Viaje" })).status).toBe(200);
    expect((await env.db.adminPool.query("SELECT status, cancel_reason FROM appointments WHERE id = $1", [later])).rows[0]).toMatchObject({ status: "cancelled", cancel_reason: "Cancelada por el paciente en la web: Viaje" });
    const strangerAppt = (await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4, now() + interval '20 days', now() + interval '20 days 30 minutes') RETURNING id",
      [K.clinicId, K.branches[0], d3.id, stranger])).rows[0].id;
    expect((await pm.call("POST", `/me/appointments/${strangerAppt}/cancel`, {})).status).toBe(404);
    expect((await pm.call("GET", `/me/appointments/${strangerAppt}/ics`)).status).toBe(404);
    expect((await pm.call("GET", "/me/appointments")).body.upcoming.map((x: any) => x.id)).not.toContain(strangerAppt);
  });
});

describe("aislamiento entre clínicas", () => {
  it("la sesión de una clínica no sirve en otra y RLS oculta las tablas nuevas", async () => {
    expect((await client(slug2).call("GET", "/info")).status).toBe(404);
    await enable(owner2, K2);
    const pc = client(slug);
    await signup(pc, { firstName: "Gina", lastName: "Suárez", documentNumber: doc(), birthDate: "1993-01-01", phone: phone() });
    expect((await pc.call("GET", "/me")).status).toBe(200);
    const other = await env.app.inject({ method: "GET", url: `/api/public/c/${slug2}/me`, headers: { cookie: pc.cookie } });
    expect(other.statusCode).toBe(401);
    // El personal de K2 no ve los mensajes ni solicitudes de K
    const m2 = await owner2.get("/api/messages");
    expect(m2.body.items).toEqual([]);
    expect((await owner2.get("/api/portal/requests")).body).toEqual([]);
    const tables = ["outbound_messages", "portal_settings", "portal_branch_settings", "portal_services", "portal_slot_holds", "portal_otps", "portal_sessions", "portal_bookings", "portal_rate_events"];
    await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) => {
      for (const t of tables) {
        const n = (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE clinic_id = $1`, [K.clinicId])).rows[0].n;
        expect(n, t).toBe(0);
      }
    });
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO outbound_messages (clinic_id, channel, recipient, template, body, status) VALUES ($1,'whatsapp','+59170000000','x.y','hola','simulated')", [K.clinicId]),
    )).rejects.toThrow();
    // La bandeja es de solo lectura en su contenido
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("UPDATE outbound_messages SET body = 'x'"))).rejects.toThrow();
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("DELETE FROM outbound_messages"))).rejects.toThrow();
  });

  it("desactivar la reserva vuelve a responder 404", async () => {
    const s = await owner2.get("/api/portal/settings");
    expect((await owner2.put("/api/portal/settings", { ...s.body.settings, enabled: false, slug: s.body.slug, branches: [], services: [] })).status).toBe(200);
    expect((await client(slug2).call("GET", "/info")).status).toBe(404);
  });
});

describe("servicio de mensajes", () => {
  it("en producción sin proveedor: queda en cola, el registro no incluye contenido y los códigos se guardan enmascarados", async () => {
    const logs: string[] = [];
    const captured: unknown[][] = [];
    const fake = { query: async (_sql: string, params: unknown[]) => { captured.push(params); return { rows: [{ id: "m1" }] }; } } as any;
    const m = createMessenger({ isProduction: true }, { log: (x) => logs.push(x) });
    expect(m.mode).toBe("queue");
    const r = await m.enqueue(fake, { clinicId: "c", channel: "whatsapp", recipient: "+59171234567", template: "portal.otp", purpose: "otp", body: "123456 es tu código", sensitive: true });
    expect(r.status).toBe("queued");
    expect(captured[0]).toContain("****** es tu código");
    expect(logs.join(" ")).not.toMatch(/123456|71234567/);
  });

  it("fuera de producción nunca usa un proveedor aunque exista; en producción con proveedor marca enviado", async () => {
    const sent: string[] = [];
    const provider = { name: "prueba", send: async (x: { body: string }) => { sent.push(x.body); return { providerMessageId: "p1" }; } };
    const fake = { query: async () => ({ rows: [{ id: "m1" }] }) } as any;
    const dev = createMessenger({ isProduction: false }, { provider });
    expect((await dev.enqueue(fake, { clinicId: "c", channel: "sms", recipient: "+591", template: "a.b", purpose: "transactional", body: "hola" })).status).toBe("simulated");
    expect(sent).toEqual([]);
    const prod = createMessenger({ isProduction: true }, { provider });
    expect((await prod.enqueue(fake, { clinicId: "c", channel: "sms", recipient: "+591", template: "a.b", purpose: "transactional", body: "hola" })).status).toBe("sent");
    expect(sent).toEqual(["hola"]);
  });
});
