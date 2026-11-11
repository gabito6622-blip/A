// Relaciones familiares (R2-39), etiquetas, segmentos y campañas manuales (R2-38).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { family } from "../server/src/modules/portal/core.js";
import { MAX_CAMPAIGN_RECIPIENTS } from "../server/src/modules/experience/segments.js";
import { addUser, createClinic, createPatient, fullSchedule, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, rec: Agent, assistant: Agent, dent: { id: string; email: string };
const B = () => K.branches[0]!;
const ZONE = "America/La_Paz";
const minorBirth = DateTime.now().minus({ years: 9 }).toISODate()!;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { name: "Clínica Familias" });
  K2 = await createClinic(env.db, { name: "Clínica Ajena" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
  assistant = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [B()] })).email);
  dent = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
  await fullSchedule(env.db, K.clinicId, dent.id, B());
});
afterAll(async () => teardown(env));

const phone = () => `7${Math.floor(1000000 + Math.random() * 8999999)}`;

describe("relaciones familiares", () => {
  let mom: string, kid: string, kid2: string, dad: string;
  const momPhone = phone();
  beforeAll(async () => {
    mom = await createPatient(owner, { firstName: "Carla", lastName: "Flores Fam", sex: "F", phone: momPhone, birthDate: "1988-04-02" });
    dad = await createPatient(owner, { firstName: "Pablo", lastName: "Rojas Fam", sex: "M", birthDate: "1985-01-20" });
  });

  it("mismo celular: sin familiar declarado es posible duplicado; declarando a la madre se registra y la relación queda", async () => {
    const body = { firstName: "Leo", lastName: "Rojas Flores", documentType: "SIN", birthDate: minorBirth, phone: momPhone, guardianName: "Carla Flores Fam" };
    const dup = await owner.post("/api/patients", { ...body });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.duplicates.map((d: any) => d.reason)).toContain("teléfono");
    // Al declarar a la madre (tutora legal) el celular compartido ya no bloquea; el responsable se completa solo.
    const ok = await owner.post("/api/patients", { ...body, guardianName: null, family: { relatedPatientId: mom, relation: "mother", legalGuardian: true } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    kid = ok.body.id;
    const p = (await owner.get(`/api/patients/${kid}`)).body.patient;
    expect(p.guardianName).toBe("Carla Flores Fam");
    expect(p.guardianRelationship).toBe("Madre");
    // El aviso de duplicados distingue «mismo celular, familiar declarado»
    const chk = await owner.post("/api/patients/check-duplicates", { phone: momPhone, excludeId: kid });
    expect(chk.body.duplicates.find((d: any) => d.id === mom).reason).toBe("mismo celular, familiar declarado");
  });

  it("es bidireccional: la madre ve a su hijo y el hijo a su madre; declararla al revés no duplica", async () => {
    const fk = (await owner.get(`/api/patients/${kid}/family`)).body;
    expect(fk.members).toHaveLength(1);
    expect(fk.members[0]).toMatchObject({ patientId: mom, relation: "Madre", isLegalGuardian: true, samePhone: true });
    const fm = (await owner.get(`/api/patients/${mom}/family`)).body;
    expect(fm.members[0]).toMatchObject({ patientId: kid, relation: "Hijo/a", isWard: true, isMinor: true });
    const again = await owner.post(`/api/patients/${mom}/relationships`, { relatedPatientId: kid, relation: "child" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("duplicate_relationship");
    // La base también lo impide (aunque se inserte al revés)
    await expect(env.db.adminPool.query(
      "INSERT INTO patient_relationships (clinic_id, person_a, person_b, kind) VALUES ($1,$2,$3,'sibling')", [K.clinicId, kid, mom])).rejects.toThrow(/patient_relationships_pair_uq/);
    const n = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM patient_relationships WHERE ended_at IS NULL AND $1 IN (person_a, person_b) AND $2 IN (person_a, person_b)", [mom, kid])).rows[0].n;
    expect(n).toBe(1);
  });

  it("un solo tutor legal; las fechas deben cuadrar; cerrar no borra", async () => {
    kid2 = await createPatient(owner, { firstName: "Ema", lastName: "Rojas Flores", documentType: "SIN", documentNumber: null, birthDate: DateTime.now().minus({ years: 6 }).toISODate(), guardianName: "Carla" });
    expect((await owner.post(`/api/patients/${kid2}/relationships`, { relatedPatientId: mom, relation: "mother", legalGuardian: true })).status).toBe(200);
    const second = await owner.post(`/api/patients/${kid2}/relationships`, { relatedPatientId: dad, relation: "father", legalGuardian: true });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("guardian_exists");
    expect((await owner.post(`/api/patients/${kid2}/relationships`, { relatedPatientId: dad, relation: "father" })).status).toBe(200);
    const older = await owner.post(`/api/patients/${dad}/relationships`, { relatedPatientId: kid, relation: "father" });
    expect(older.status).toBe(400);
    expect(older.body.error.message).toMatch(/no cuadran/);
    expect((await owner.post(`/api/patients/${kid}/relationships`, { relatedPatientId: kid, relation: "sibling" })).status).toBe(400);
    expect((await owner.post(`/api/patients/${kid}/relationships`, { relatedPatientId: dad, relation: "other" })).status).toBe(400);
    // Hermanos por la madre en común (sin declararlo entre ellos)
    const fk2 = (await owner.get(`/api/patients/${kid2}/family`)).body.members;
    expect(fk2.find((m: any) => m.patientId === kid)).toMatchObject({ relation: "Hermano/a", derived: true });
    // Cerrar la relación: queda en la base y la base impide borrarla
    const relId = fk2.find((m: any) => m.patientId === dad).relationshipId;
    expect((await owner.post(`/api/relationships/${relId}/end`, { reason: "Error de registro" })).status).toBe(200);
    expect((await owner.get(`/api/patients/${kid2}/family`)).body.members.some((m: any) => m.patientId === dad)).toBe(false);
    await expect(env.db.adminPool.query("DELETE FROM patient_relationships WHERE id = $1", [relId])).rejects.toThrow(/no se eliminan/);
    await expect(env.db.adminPool.query("UPDATE patient_relationships SET legal_guardian = true WHERE id = $1", [relId])).rejects.toThrow(/cerrada/);
  });

  it("saldos y próximas citas según permisos (patient_money)", async () => {
    // Saldo del hijo: un cargo de 150 Bs
    await env.db.adminPool.query(
      "INSERT INTO charges (clinic_id, branch_id, patient_id, dentist_id, description, amount_cents, created_by) VALUES ($1,$2,$3,$4,'Consulta',15000,$4)",
      [K.clinicId, B(), kid, dent.id]);
    const r = (await rec.get(`/api/patients/${mom}/family`)).body;
    expect(r.canSeeMoney).toBe(true);
    expect(r.members.find((m: any) => m.patientId === kid).balanceCents).toBe(15000);
    expect(r.familyBalanceCents).toBe(15000);
    const a = (await assistant.get(`/api/patients/${mom}/family`)).body;
    expect(a.canSeeMoney).toBe(false);
    expect(a.members[0].balanceCents).toBeUndefined();
    expect(a.familyBalanceCents).toBeNull();
  });

  it("agenda a los hermanos seguidos (todo o nada) e idempotente", async () => {
    const start = DateTime.now().setZone(ZONE).plus({ days: 2 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    const slots = (await rec.get(`/api/family/slots?branchId=${B()}&date=${start.toISODate()}&dentistId=${dent.id}&totalMin=60`)).body;
    expect(slots[0].slots.length).toBeGreaterThan(0);
    const body = { branchId: B(), dentistId: dent.id, startsAt: start.toISO(), members: [{ patientId: kid, durationMin: 30 }, { patientId: kid2, durationMin: 30 }], idempotencyKey: "familia-12345678" };
    const r = await rec.post("/api/family/appointments", body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ids).toHaveLength(2);
    const rows = (await env.db.adminPool.query("SELECT patient_id, starts_at, ends_at FROM appointments WHERE id = ANY($1) ORDER BY starts_at", [r.body.ids])).rows;
    expect(+rows[1].starts_at).toBe(+rows[0].ends_at);
    const dup = await rec.post("/api/family/appointments", body);
    expect(dup.body).toMatchObject({ duplicate: true });
    expect(dup.body.ids).toEqual(r.body.ids);
    // Choca el segundo: no queda ninguna
    const clash = await rec.post("/api/family/appointments", { ...body, startsAt: start.minus({ minutes: 30 }).toISO(), members: [{ patientId: mom, durationMin: 30 }, { patientId: dad, durationMin: 30 }], idempotencyKey: "familia-87654321" });
    expect(clash.status).toBe(409);
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointments WHERE patient_id = ANY($1)", [[mom, dad]])).rows[0].n).toBe(0);
    // La tarjeta muestra la próxima cita de cada uno
    const fam = (await rec.get(`/api/patients/${mom}/family`)).body.members;
    expect(fam.find((m: any) => m.patientId === kid).nextAppointment.startsAt).toBeTruthy();
    // Permisos: el asistente lee la agenda pero no puede agendar sin agenda.write? (sí puede): contabilidad no
    const acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
    expect((await acct.post("/api/family/appointments", { ...body, idempotencyKey: "familia-xxxxxxxx" })).status).toBe(403);
  });

  it("el portal del tutor legal ve a sus menores aunque el celular del responsable sea otro", async () => {
    // El hijo 2 tiene otro celular de responsable; la madre lo ve por la relación de tutora legal.
    await env.db.adminPool.query("UPDATE patients SET guardian_phone = '+59179999999' WHERE id = $1", [kid2]);
    const fam = await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => family(c, { id: "x", patientId: mom, phone: `+591${momPhone}`, expiresAt: new Date() } as any));
    expect(fam.map((p) => p.id).sort()).toEqual([mom, kid, kid2].sort());
    // El padre (sin tutoría legal ni celular de responsable) no ve a nadie más
    const famDad = await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => family(c, { id: "y", patientId: dad, phone: "+59170000000", expiresAt: new Date() } as any));
    expect(famDad.map((p) => p.id)).toEqual([dad]);
  });

  it("el tutor legal verifica el enlace del presupuesto del menor con su celular", async () => {
    const tutorPhone = phone();
    const tutor = await createPatient(owner, { firstName: "Raúl", lastName: "Tutor Fam", phone: tutorPhone, birthDate: "1980-01-01" });
    const minor = await createPatient(owner, { firstName: "Nico", lastName: "Menor Fam", documentType: "SIN", documentNumber: null, phone: null, birthDate: minorBirth, guardianName: "Abuela", guardianPhone: "70000001", consentReminders: true });
    expect((await owner.post(`/api/patients/${minor}/relationships`, { relatedPatientId: tutor, relation: "guardian", legalGuardian: true })).status).toBe(200);
    // El tutor legal reemplaza al responsable anterior en la ficha
    expect((await owner.get(`/api/patients/${minor}`)).body.patient.guardianName).toBe("Raúl Tutor Fam");
    const d = await login(env.app, dent.email);
    const b = await d.post("/api/budgets", { branchId: B(), patientId: minor, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "PRE-01") }] });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const link = await rec.post(`/api/budgets/${b.body.id}/share-links`, {});
    const token = link.body.url.split("/p/presupuesto/")[1];
    const v = await env.app.inject({ method: "POST", url: `/api/public/budget-links/${token}/verify`, payload: { method: "phone", phoneLast4: tutorPhone.slice(-4) } });
    expect(v.statusCode, v.body).toBe(200);
    const acc = await env.app.inject({ method: "POST", url: `/api/public/budget-links/${token}/accept`, payload: { access: v.json().access, signerName: "Raúl Tutor Fam", relationship: "guardian", agree: true } });
    expect(acc.statusCode, acc.body).toBe(200);
  });

  it("aislamiento: otra clínica no ve ni crea relaciones con estos pacientes", async () => {
    expect((await owner2.get(`/api/patients/${mom}/family`)).status).toBe(404);
    const other = await createPatient(owner2, {});
    const x = await owner2.post(`/api/patients/${other}/relationships`, { relatedPatientId: mom, relation: "mother" });
    expect(x.status).toBe(404);
    await expect(env.db.adminPool.query(
      "INSERT INTO patient_relationships (clinic_id, person_a, person_b, kind) VALUES ($1,$2,$3,'other')", [K2.clinicId, other, mom])).rejects.toThrow(/foreign key/);
    const rows = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query("SELECT * FROM patient_relationships"));
    expect(rows.rowCount).toBe(0);
    expect((await assistant.post(`/api/patients/${mom}/relationships`, { relatedPatientId: dad, relation: "spouse" })).status).toBe(200); // asistente tiene patients.write
    const acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
    expect((await acct.post(`/api/patients/${dad}/relationships`, { relatedPatientId: kid, relation: "child" })).status).toBe(403);
  });
});

describe("etiquetas y segmentos", () => {
  let tagOrto: string, tagVip: string, a: string, b: string, c: string;
  beforeAll(async () => {
    a = await createPatient(owner, { firstName: "Segmento", lastName: "Uno", birthDate: "1990-01-01" });
    b = await createPatient(owner, { firstName: "Segmento", lastName: "Dos", birthDate: "1960-01-01" });
    c = await createPatient(owner, { firstName: "Segmento", lastName: "Tres", birthDate: DateTime.now().minus({ years: 12 }).toISODate(), guardianName: "Mamá" });
  });

  it("etiquetas con color: nombre único sin importar mayúsculas, validación y asignación", async () => {
    const t = await rec.post("/api/patient-tags", { name: "Ortodoncia activa", color: "#7C3AED" });
    expect(t.status).toBe(200);
    tagOrto = t.body.id;
    const dup = await owner.post("/api/patient-tags", { name: "ORTODONCIA ACTIVA" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details[0].path).toBe("name");
    expect((await owner.post("/api/patient-tags", { name: "X", color: "#000" })).status).toBe(400);
    tagVip = (await owner.post("/api/patient-tags", { name: "VIP", color: "#d97706" })).body.id;
    expect((await rec.put(`/api/patients/${a}/tags`, { tagIds: [tagOrto, tagVip] })).status).toBe(200);
    expect((await rec.put(`/api/patients/${b}/tags`, { tagIds: [tagOrto] })).status).toBe(200);
    expect((await rec.get(`/api/patients/${a}/tags`)).body.map((x: any) => x.name)).toEqual(["Ortodoncia activa", "VIP"]);
    const acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
    expect((await acct.put(`/api/patients/${c}/tags`, { tagIds: [tagVip] })).status).toBe(403);
    // Otra clínica no puede usar estas etiquetas
    const other = await createPatient(owner2, {});
    expect((await owner2.put(`/api/patients/${other}/tags`, { tagIds: [tagVip] })).status).toBe(400);
  });

  it("segmentos por etiqueta (cualquiera/todas) y edad; guardar, listar y exportar con patients.export", async () => {
    const any = (await rec.post("/api/segments/preview", { filters: { tagIds: [tagOrto, tagVip] } })).body;
    expect(any.items.map((x: any) => x.id).sort()).toEqual([a, b].sort());
    const all = (await rec.post("/api/segments/preview", { filters: { tagIds: [tagOrto, tagVip], tagMode: "all" } })).body;
    expect(all.items.map((x: any) => x.id)).toEqual([a]);
    const old = (await rec.post("/api/segments/preview", { filters: { tagIds: [tagOrto], ageMin: 50 } })).body;
    expect(old.items.map((x: any) => x.id)).toEqual([b]);
    const bad = await rec.post("/api/segments/preview", { filters: { ageMin: 50, ageMax: 20 } });
    expect(bad.status).toBe(400);
    const s = await rec.post("/api/segments", { name: "Ortodoncia", filters: { tagIds: [tagOrto] } });
    expect(s.status).toBe(200);
    expect((await rec.post("/api/segments", { name: "ortodoncia", filters: {} })).status).toBe(409);
    expect((await rec.get(`/api/segments/${s.body.id}/patients`)).body.total).toBe(2);
    expect((await rec.get(`/api/segments/${s.body.id}/export.xlsx`)).status).toBe(403);
    const x = await env.app.inject({ method: "GET", url: `/api/segments/${s.body.id}/export.xlsx`, headers: { cookie: owner.cookie } });
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.rowCount).toBe(3);
    expect(String(wb.worksheets[0]!.getRow(1).values)).toContain("Etiquetas");
    // Aislamiento
    expect((await owner2.get(`/api/segments/${s.body.id}/patients`)).status).toBe(404);
    expect((await owner2.get("/api/segments")).body).toEqual([]);
    expect((await owner2.get("/api/patient-tags")).body).toEqual([]);
  });

  it("los filtros respetan los permisos: saldo, tratamiento pendiente y controles", async () => {
    await env.db.adminPool.query(
      "INSERT INTO charges (clinic_id, branch_id, patient_id, dentist_id, description, amount_cents, created_by) VALUES ($1,$2,$3,$4,'Consulta',5000,$4)", [K.clinicId, B(), b, dent.id]);
    const debt = (await rec.post("/api/segments/preview", { filters: { tagIds: [tagOrto], balance: "debt" } })).body;
    expect(debt.items.map((x: any) => x.id)).toEqual([b]);
    expect(debt.items[0].balanceCents).toBe(5000);
    expect((await rec.post("/api/segments/preview", { filters: { balance: "debt", minDebtCents: 6000, tagIds: [tagOrto] } })).body.total).toBe(0);
    expect((await assistant.post("/api/segments/preview", { filters: { balance: "debt" } })).status).toBe(403);
    expect((await assistant.post("/api/segments/preview", { filters: { pendingTreatment: true } })).status).toBe(403);
    const asst = (await assistant.post("/api/segments/preview", { filters: { tagIds: [tagOrto] } })).body;
    expect(asst.items[0].balanceCents).toBeUndefined();
    // Sucursal sin acceso
    expect((await rec.post("/api/segments/preview", { filters: { branchId: K.branches[1] } })).status).toBe(403);
    // Control vencido
    await env.db.adminPool.query("INSERT INTO recalls (clinic_id, branch_id, patient_id, reason, due_date) VALUES ($1,$2,$3,'Profilaxis', now()::date - 10)", [K.clinicId, B(), a]);
    expect((await rec.post("/api/segments/preview", { filters: { tagIds: [tagOrto], overdueRecall: true } })).body.items.map((x: any) => x.id)).toEqual([a]);
  });
});

describe("campañas manuales", () => {
  let tag: string;
  const ids: Record<string, string> = {};
  const sharedPhone = phone();
  beforeAll(async () => {
    tag = (await owner.post("/api/patient-tags", { name: "Campaña prueba" })).body.id;
    const mk = async (k: string, over: Record<string, unknown>) => {
      ids[k] = await createPatient(owner, { firstName: k, lastName: "Campaña", ...over });
      await owner.put(`/api/patients/${ids[k]}/tags`, { tagIds: [tag] });
    };
    await mk("Acepta", { consentMarketing: true, phone: sharedPhone, lastName: "A Campaña" });
    await mk("Hermana", { consentMarketing: true, phone: sharedPhone, lastName: "B Campaña" });
    await mk("Otro", { consentMarketing: true, lastName: "C Campaña" });
    await mk("Nunca", { consentMarketing: false, lastName: "D Campaña" });
    await mk("Baja", { consentMarketing: true, lastName: "E Campaña" });
    await mk("Menor", { consentMarketing: true, lastName: "F Campaña", birthDate: minorBirth, guardianName: "Mamá" });
    await mk("Sincel", { consentMarketing: true, lastName: "G Campaña", phone: null });
    // «Baja» se da de baja (la ficha registra la revocación)
    const p = (await owner.get(`/api/patients/${ids.Baja}`)).body.patient;
    const { id: _i, recordNumber: _r, createdAt: _c, archivedAt: _a, consentUpdatedAt: _u, ...rest } = p;
    expect((await owner.put(`/api/patients/${ids.Baja}`, { ...rest, consentMarketing: false })).status).toBe(200);
    // Horario de silencio lejos de la hora actual para que la prueba no dependa del reloj
    const now = DateTime.now().setZone(ZONE);
    const qs = now.plus({ hours: 6 }).toFormat("HH:00"), qe = now.plus({ hours: 7 }).toFormat("HH:00");
    await env.db.adminPool.query("INSERT INTO messaging_settings (clinic_id, quiet_start, quiet_end) VALUES ($1,$2,$3) ON CONFLICT (clinic_id) DO UPDATE SET quiet_start = $2, quiet_end = $3", [K.clinicId, qs, qe]);
  });
  const base = () => ({ name: "Revisión preventiva", filters: { tagIds: [tag] }, body: "Hola {nombre}, en {clinica} te invitamos a tu revisión preventiva." });

  it("vista previa: cuántos llegan y por qué se excluye a cada uno; sin datos clínicos", async () => {
    const r = await owner.post("/api/campaigns/preview", base());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.segmentTotal).toBe(7);
    expect(r.body.eligible).toBe(2);
    const reasons = Object.fromEntries(r.body.reasons.map((x: any) => [x.reason, x.count]));
    expect(reasons).toEqual({ minor: 1, opted_out: 1, no_consent: 1, no_phone: 1, shared_phone: 1 });
    expect(r.body.example).toMatch(/Responde BAJA/);
    expect(r.body.mode).toBe("simulate");
    const clin = await owner.post("/api/campaigns/preview", { ...base(), body: "Hola {nombre}, tu {tratamiento} sigue pendiente" });
    expect(clin.body.errors[0]).toMatch(/datos clínicos/);
    const hora = await owner.post("/api/campaigns/preview", { ...base(), body: "Hola {nombre}, tu cita es a las {hora}" });
    expect(hora.body.errors[0]).toMatch(/solo se puede usar/);
    expect((await rec.post("/api/campaigns/preview", base())).status).toBe(403);
  });

  it("envía solo con el número exacto confirmado, a quien aceptó y no se dio de baja; simulado y sin repetir en 7 días", async () => {
    const wrong = await owner.post("/api/campaigns", { ...base(), confirmCount: 3 });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe("count_changed");
    const bad = await owner.post("/api/campaigns", { ...base(), body: "Tu {diagnostico}", confirmCount: 2 });
    expect(bad.status).toBe(400);
    const ok = await owner.post("/api/campaigns", { ...base(), confirmCount: 2 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ recipients: 2, excluded: 5, mode: "simulate" });
    const msgs = (await env.db.adminPool.query("SELECT patient_id, status, purpose, body FROM outbound_messages WHERE related_id = $1", [ok.body.id])).rows;
    expect(msgs.map((m) => m.patient_id).sort()).toEqual([ids.Acepta, ids.Otro].sort());
    for (const m of msgs) { expect(m.status).toBe("simulated"); expect(m.purpose).toBe("marketing"); expect(m.body).toMatch(/BAJA/); }
    for (const k of ["Nunca", "Baja", "Menor", "Sincel", "Hermana"]) expect(msgs.some((m) => m.patient_id === ids[k])).toBe(false);
    const det = (await owner.get(`/api/campaigns/${ok.body.id}`)).body;
    expect(det.rows.find((r: any) => r.patientId === ids.Baja).reason).toMatch(/baja/);
    // Inmutable
    await expect(env.db.adminPool.query("DELETE FROM marketing_campaign_recipients WHERE campaign_id = $1", [ok.body.id])).rejects.toThrow(/solo inserción/);
    // Segunda campaña: los que ya recibieron quedan fuera por 7 días
    const again = (await owner.post("/api/campaigns/preview", base())).body;
    expect(again.eligible).toBe(0);
    expect(again.reasons.find((r: any) => r.reason === "cooldown").count).toBe(3); // incluye a la hermana (mismo celular)
    expect((await owner.post("/api/campaigns", { ...base(), confirmCount: 1 })).body.error.code).toBe("no_recipients");
    expect((await owner2.get(`/api/campaigns/${ok.body.id}`)).status).toBe(404);
    expect((await owner2.get("/api/campaigns")).body).toEqual([]);
  });

  it("respeta el horario de silencio y el tope por campaña", async () => {
    const t2 = (await owner.post("/api/patient-tags", { name: "Campaña tope" })).body.id;
    const n = MAX_CAMPAIGN_RECIPIENTS + 1;
    await env.db.adminPool.query(
      `WITH ins AS (
         INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, birth_date, phone, consent_marketing, search_text)
         SELECT $1, 100000 + g, 'Masivo', 'P' || g, 'SIN', '1990-01-01', '+5916' || lpad(g::text, 7, '0'), true, 'masivo'
           FROM generate_series(1, $2) g RETURNING id)
       INSERT INTO patient_tag_links (clinic_id, patient_id, tag_id) SELECT $1, id, $3 FROM ins`, [K.clinicId, n, t2]);
    const body = { name: "Masiva", filters: { tagIds: [t2] }, body: "Hola {nombre}, novedades de {clinica}." };
    const pv = (await owner.post("/api/campaigns/preview", body)).body;
    expect(pv).toMatchObject({ eligible: n, overCap: true });
    const over = await owner.post("/api/campaigns", { ...body, confirmCount: n });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("over_cap");
    // Horario de silencio que incluye ahora
    const now = DateTime.now().setZone(ZONE);
    await env.db.adminPool.query("UPDATE messaging_settings SET quiet_start = $2, quiet_end = $3 WHERE clinic_id = $1",
      [K.clinicId, now.minus({ hours: 1 }).toFormat("HH:00"), now.plus({ hours: 2 }).toFormat("HH:00")]);
    const p = await createPatient(owner, { consentMarketing: true, lastName: "Silencio" });
    const t3 = (await owner.post("/api/patient-tags", { name: "Campaña silencio" })).body.id;
    await owner.put(`/api/patients/${p}/tags`, { tagIds: [t3] });
    const q = await owner.post("/api/campaigns", { name: "Nocturna", filters: { tagIds: [t3] }, body: "Hola {nombre}", confirmCount: 1 });
    expect(q.status).toBe(409);
    expect(q.body.error.code).toBe("quiet_hours");
  });
});
