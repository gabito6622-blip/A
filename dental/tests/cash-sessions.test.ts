import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { countTotal } from "../server/src/modules/cashSessions.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, O: TestClinic;
let owner: Agent, rec: Agent, rec2: Agent, acct: Agent, dent: Agent, otherOwner: Agent;
let recId: string;
let patient: string;
const B = () => K.branches[0]!;
let n = 0;
const key = () => `cash-${Date.now()}-${n++}`;
const pay = (a: Agent, amountCents: number, method = "cash", branchId = B()) =>
  a.post("/api/payments", { branchId, patientId: patient, amountCents, method, bankReference: method === "cash" ? null : `REF-${key()}`, idempotencyKey: key() });

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  O = await createClinic(env.db, { name: "Otra clínica" });
  owner = await login(env.app, K.ownerEmail);
  otherOwner = await login(env.app, O.ownerEmail);
  const r = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] });
  recId = r.id;
  rec = await login(env.app, r.email);
  rec2 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  dent = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [B()] })).email);
  patient = await createPatient(owner);
});
afterAll(async () => teardown(env));

let sessionId: string;

describe("caja: apertura, cobros, movimientos y cierre al centavo", () => {
  it("el arqueo suma billetes y monedas bolivianas y rechaza denominaciones inexistentes", () => {
    expect(countTotal({ "20000": 1, "2000": 1, "500": 1, "200": 1, "100": 1, "50": 1, "20": 2, "10": 1 })).toBe(22900);
    expect(() => countTotal({ "300": 1 })).toThrow(/Denominación inválida/);
  });

  it("abre con fondo, vincula solo el efectivo de su cajero y calcula el esperado exacto", async () => {
    const o = await rec.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 10050, note: "Cambio del día" });
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ status: "open", openingFloatCents: 10050 });
    sessionId = o.body.id;

    const c1 = await pay(rec, 12345);
    const c2 = await pay(rec, 777);
    const qr = await pay(rec, 5000, "qr");
    const other = await pay(rec2, 999); // otro cajero sin caja: no entra en la mía
    expect([c1.status, c2.status, qr.status, other.status]).toEqual([200, 200, 200, 200]);
    const links = await env.db.adminPool.query("SELECT id, cash_session_id FROM payments WHERE id = ANY($1)", [[c1.body.id, c2.body.id, qr.body.id, other.body.id]]);
    const link = Object.fromEntries(links.rows.map((r) => [r.id, r.cash_session_id]));
    expect(link[c1.body.id]).toBe(sessionId);
    expect(link[c2.body.id]).toBe(sessionId);
    expect(link[qr.body.id]).toBeNull();
    expect(link[other.body.id]).toBeNull();

    expect((await rec.post(`/api/cash-sessions/${sessionId}/movements`, { kind: "in", category: "change", amountCents: 2000, reason: "Cambio traído de gerencia" })).status).toBe(200);
    expect((await rec.post(`/api/cash-sessions/${sessionId}/movements`, { kind: "out", category: "petty_expense", amountCents: 1530, reason: "Agua y vasos" })).status).toBe(200);
    // Motivo obligatorio
    expect((await rec.post(`/api/cash-sessions/${sessionId}/movements`, { kind: "out", category: "other", amountCents: 100, reason: " " })).status).toBe(400);
    // No se puede sacar más efectivo del que hay
    const big = await rec.post(`/api/cash-sessions/${sessionId}/movements`, { kind: "out", category: "deposit", amountCents: 9_999_999, reason: "Depósito" });
    expect(big.status).toBe(409);
    expect(big.body.error.code).toBe("insufficient_cash");
    // Un cobro anulado deja de contar
    expect((await owner.post(`/api/payments/${c2.body.id}/void`, { reason: "Error de registro" })).status).toBe(200);

    const cur = (await rec.get(`/api/cash-sessions/current?branchId=${B()}`)).body;
    expect(cur.session.totals).toEqual({ floatCents: 10050, cashInCents: 13122, voidedCents: 777, movementsInCents: 2000, movementsOutCents: 1530, expectedCents: 22865 });
    expect(cur.session.payments).toHaveLength(2);
    expect(cur.session.others.map((p: any) => p.methodLabel)).toEqual(["QR"]); // referencia, fuera del arqueo
    expect(cur.session.movements).toHaveLength(2);
  });

  it("con diferencia exige motivo; cierra con esperado, contado y diferencia exactos", async () => {
    const counts = { "20000": 1, "2000": 1, "500": 1, "200": 1, "100": 1, "50": 1 }; // 228,50 Bs
    const noNote = await rec.post(`/api/cash-sessions/${sessionId}/close`, { counts });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.code).toBe("note_required");
    expect(noNote.body.error.details).toEqual({ expectedCents: 22865, countedCents: 22850, differenceCents: -15 });
    const ok = await rec.post(`/api/cash-sessions/${sessionId}/close`, { counts, note: "Faltan 15 centavos: se dio cambio de más" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "closed", expectedCents: 22865, countedCents: 22850, differenceCents: -15 });
    expect(ok.body.count.find((d: any) => d.cents === 20000)).toMatchObject({ quantity: 1, subtotalCents: 20000 });
  });

  it("sin diferencia cierra sin motivo", async () => {
    const o = await rec2.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 5000 });
    await pay(rec2, 1230);
    const r = await rec2.post(`/api/cash-sessions/${o.body.id}/close`, { counts: { "5000": 1, "1000": 1, "200": 1, "20": 1, "10": 1 } });
    expect(r.status).toBe(200);
    expect(r.body.differenceCents).toBe(0);
  });
});

describe("caja cerrada inmutable", () => {
  it("no admite otro cierre, movimientos ni cambios por SQL (ni siquiera del dueño de la base)", async () => {
    expect((await rec.post(`/api/cash-sessions/${sessionId}/close`, { counts: {}, note: "otra vez" })).status).toBe(409);
    expect((await rec.post(`/api/cash-sessions/${sessionId}/movements`, { kind: "in", category: "other", amountCents: 100, reason: "Tarde" })).status).toBe(409);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: recId }, (c) =>
      c.query("UPDATE cash_sessions SET close_note = 'cambiado' WHERE id = $1", [sessionId]))).rejects.toThrow(/cerrada no se modifica/);
    await expect(env.db.adminPool.query("UPDATE cash_sessions SET counted_cents = 22865, difference_cents = 0 WHERE id = $1", [sessionId])).rejects.toThrow(/cerrada no se modifica/);
    await expect(env.db.adminPool.query("DELETE FROM cash_sessions WHERE id = $1", [sessionId])).rejects.toThrow(/no se eliminan/);
    await expect(env.db.adminPool.query("UPDATE cash_movements SET amount_cents = 1 WHERE session_id = $1", [sessionId])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query(
      "INSERT INTO cash_movements (clinic_id, session_id, kind, category, amount_cents, reason, created_by) VALUES ($1,$2,'in','other',100,'Directo',$3)",
      [K.clinicId, sessionId, recId])).rejects.toThrow(/cerrada/);
    await expect(env.db.adminPool.query("UPDATE payments SET cash_session_id = NULL WHERE cash_session_id = $1", [sessionId])).rejects.toThrow(/no se modifica/);
    const s = (await env.db.adminPool.query("SELECT counted_cents, difference_cents FROM cash_sessions WHERE id = $1", [sessionId])).rows[0];
    expect(s).toEqual({ counted_cents: 22850, difference_cents: -15 });
    // Un cobro posterior al cierre ya no entra en esa caja
    const p = await pay(rec, 100);
    expect((await env.db.adminPool.query("SELECT cash_session_id FROM payments WHERE id = $1", [p.body.id])).rows[0].cash_session_id).toBeNull();
  });
});

describe("una caja abierta por cajero y sucursal", () => {
  it("no abre otra mientras haya una pendiente, ni con dos clics simultáneos", async () => {
    const both = await Promise.all([
      rec.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 }),
      rec.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const again = await rec.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("cash_session_open");
    // Otro cajero sí puede abrir la suya en la misma sucursal
    const r2 = await rec2.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 });
    expect(r2.status).toBe(200);
    // Ni en una sucursal sin acceso
    expect((await rec.post("/api/cash-sessions", { branchId: K.branches[1], openingFloatCents: 0 })).status).toBe(403);
    // Limpieza: cerrar ambas sin diferencia
    const open = (await rec.get(`/api/cash-sessions/current?branchId=${B()}`)).body.session;
    expect((await rec.post(`/api/cash-sessions/${open.id}/close`, { counts: {} })).status).toBe(200);
    expect((await rec2.post(`/api/cash-sessions/${r2.body.id}/close`, { counts: {} })).status).toBe(200);
  });
});

describe("exigir caja abierta (configuración de la clínica)", () => {
  it("apagado por defecto; encendido, el efectivo sin caja da 409 y los otros medios siguen", async () => {
    expect((await rec.get("/api/cash-sessions/settings")).body).toEqual({ requireCashSession: false });
    expect((await pay(rec, 500)).status).toBe(200); // sin caja y sin exigencia: funciona como antes
    expect((await rec.put("/api/cash-sessions/settings", { requireCashSession: true })).status).toBe(403);
    expect((await owner.put("/api/cash-sessions/settings", { requireCashSession: true })).status).toBe(200);
    const r = await pay(rec, 500);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("cash_session_required");
    expect(r.body.error.message).toMatch(/^Abre tu caja/);
    expect((await pay(rec, 500, "transfer")).status).toBe(200);
    const o = await rec.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 1000 });
    const ok = await pay(rec, 500);
    expect(ok.status).toBe(200);
    expect((await env.db.adminPool.query("SELECT cash_session_id FROM payments WHERE id = $1", [ok.body.id])).rows[0].cash_session_id).toBe(o.body.id);
    expect((await rec.post(`/api/cash-sessions/${o.body.id}/close`, { counts: { "1000": 1, "500": 1 } })).status).toBe(200);
    expect((await owner.put("/api/cash-sessions/settings", { requireCashSession: false })).status).toBe(200);
  });
});

describe("permisos y revisión", () => {
  it("cada cajero ve solo sus cajas; contabilidad ve todas; el odontólogo no ve caja", async () => {
    expect((await dent.get("/api/cash-sessions")).status).toBe(403);
    expect((await dent.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 })).status).toBe(403);
    const mine = (await rec.get("/api/cash-sessions")).body as any[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((s) => s.cashierId === recId)).toBe(true);
    const all = (await acct.get("/api/cash-sessions")).body as any[];
    expect(all.some((s) => s.cashierId !== recId)).toBe(true);
    const other = all.find((s) => s.cashierId !== recId)!;
    expect((await rec.get(`/api/cash-sessions/${other.id}`)).status).toBe(404);
    expect((await acct.get(`/api/cash-sessions/${sessionId}`)).status).toBe(200);
    // Contabilidad no cobra: no abre caja
    expect((await acct.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 })).status).toBe(403);
  });

  it("solo quien abrió registra movimientos; gerencia puede cerrar una caja olvidada", async () => {
    const o = await rec2.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 2000 });
    expect((await rec.post(`/api/cash-sessions/${o.body.id}/movements`, { kind: "in", category: "other", amountCents: 100, reason: "Ajeno" })).status).toBe(403);
    expect((await rec.post(`/api/cash-sessions/${o.body.id}/close`, { counts: { "2000": 1 } })).status).toBe(403);
    const closed = await owner.post(`/api/cash-sessions/${o.body.id}/close`, { counts: { "2000": 1 } });
    expect(closed.status).toBe(200);
    expect(closed.body.closedByName).toBe("Dueña Prueba");
  });

  it("la revisión la hace otra persona, exige nota si hubo diferencia y es única", async () => {
    expect((await rec.post(`/api/cash-sessions/${sessionId}/review`, { note: "ok" })).status).toBe(403);
    expect((await acct.post(`/api/cash-sessions/${sessionId}/review`, {})).status).toBe(400);
    const r = await acct.post(`/api/cash-sessions/${sessionId}/review`, { note: "Verificado con la cajera: cambio mal dado" });
    expect(r.status).toBe(200);
    expect(r.body.reviewNote).toMatch(/Verificado/);
    expect((await owner.post(`/api/cash-sessions/${sessionId}/review`, { note: "otra" })).status).toBe(409);
    const open = await rec.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 });
    expect((await acct.post(`/api/cash-sessions/${open.body.id}/review`, { note: "x" })).status).toBe(409);
    await rec.post(`/api/cash-sessions/${open.body.id}/close`, { counts: {} });
  });
});

describe("aislamiento entre clínicas (cajas)", () => {
  it("otra clínica no ve ni toca las cajas, movimientos ni revisiones de K", async () => {
    expect((await otherOwner.get(`/api/cash-sessions/${sessionId}`)).status).toBe(404);
    expect((await otherOwner.get("/api/cash-sessions")).body).toEqual([]);
    expect((await otherOwner.post(`/api/cash-sessions/${sessionId}/review`, { note: "x" })).status).toBe(404);
    expect((await otherOwner.post("/api/cash-sessions", { branchId: B(), openingFloatCents: 0 })).status).toBe(400); // sucursal ajena
    const counts = await withTenant(env.db.appPool, { clinicId: O.clinicId, userId: null }, async (c) => ({
      s: (await c.query("SELECT count(*)::int AS n FROM cash_sessions WHERE clinic_id = $1", [K.clinicId])).rows[0].n,
      m: (await c.query("SELECT count(*)::int AS n FROM cash_movements")).rows[0].n,
      r: (await c.query("SELECT count(*)::int AS n FROM cash_session_reviews")).rows[0].n,
    }));
    expect(counts).toEqual({ s: 0, m: 0, r: 0 });
    await expect(withTenant(env.db.appPool, { clinicId: O.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO cash_movements (clinic_id, session_id, kind, category, amount_cents, reason, created_by) VALUES ($1,$2,'in','other',1,'xxx',$3)",
        [K.clinicId, sessionId, recId]))).rejects.toThrow();
  });
});
