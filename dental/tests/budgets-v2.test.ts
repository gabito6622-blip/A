// Presupuestos v2 (B-045): descuentos, sesiones, versiones, enlace público, embudo y saldo único.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { percentOf, prorate } from "../server/src/modules/budgets-v2-core.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, rec: Agent, acct: Agent, dentA: Agent, dentB: Agent, assistant: Agent, owner2: Agent, dentOther: Agent;
let dent: { id: string; email: string }, dent2: { id: string; email: string };
const B = () => K.branches[0]!;
let n = 0;
const key = () => `v2-${Date.now()}-${n++}`;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { name: "Clínica Presupuestos" });
  K2 = await createClinic(env.db, { name: "Clínica Ajena" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  dent = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B()] });
  dent2 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B()] });
  dentA = await login(env.app, dent.email);
  dentB = await login(env.app, dent2.email);
  dentOther = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[1]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  assistant = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [B()] })).email);
});
afterAll(async () => teardown(env));

const pid = (code: string) => procedureId(env.db, K.clinicId, code);

async function draft(patient: string, items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const r = await dentA.post("/api/budgets", { branchId: B(), patientId: patient, dentistId: dent.id, items, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}
async function accept(id: string) {
  expect((await rec.post(`/api/budgets/${id}/status`, { status: "presented" })).status).toBe(200);
  expect((await rec.post(`/api/budgets/${id}/status`, { status: "accepted" })).status).toBe(200);
}
const get = async (id: string) => (await owner.get(`/api/budgets/${id}`)).body;

// Cliente sin sesión (como el celular del paciente)
async function pub(url: string, body: unknown, ua = "Mozilla/5.0 (Linux; Android 14) Prueba") {
  const r = await env.app.inject({ method: "POST", url, payload: body as object, headers: { "user-agent": ua } });
  return { status: r.statusCode, body: r.json(), raw: r.body };
}
const tokenOf = (url: string) => url.split("/p/presupuesto/")[1]!;

describe("aritmética de descuentos (centavos exactos)", () => {
  it("reparte el global según el neto, con el residuo en la última línea", () => {
    expect(prorate(1000, [6000, 5400], true)).toEqual([526, 474]);
    expect(percentOf(6000, 10)).toBe(600);
    expect(percentOf(333, 12.5)).toBe(42); // 41,625 → 42 (mitad hacia arriba)
  });

  it("propiedad: la suma siempre es exacta y ninguna parte supera su línea ni es negativa", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 2000; k++) {
      const w = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => (rnd() < 0.2 ? 0 : Math.floor(rnd() * 50000)));
      const W = w.reduce((s, x) => s + x, 0);
      const total = Math.floor(rnd() * (W + 1));
      const s = prorate(total, w, true);
      expect(s.reduce((a, b) => a + b, 0)).toBe(total);
      s.forEach((x, i) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(w[i]!); });
    }
    // Casos de redondeo extremos
    expect(prorate(1, [1, 1, 0], true).reduce((a, b) => a + b, 0)).toBe(1);
    expect(prorate(2, [1, 1, 1], true)).toEqual([1, 1, 0]);
  });
});

describe("descuentos por línea y global (R2-12)", () => {
  let patient: string;
  beforeAll(async () => { patient = await createPatient(owner); });

  it("caso 60 + (60 − 10 %) con −10 Bs global: partes 5,26 / 4,74 y total 104,00; el cargo al realizar usa el neto", async () => {
    const pre = await pid("PRE-01");
    const id = await draft(patient, [
      { procedureId: pre, unitPriceCents: 6000 },
      { procedureId: pre, unitPriceCents: 6000, discountPercent: 10 },
    ], { globalDiscount: { kind: "amount", value: 1000 } });
    let b = await get(id);
    expect(b.items.map((i: any) => [i.grossCents, i.discountCents, i.globalDiscountCents, i.totalCents])).toEqual([[6000, 0, 526, 5474], [6000, 600, 474, 4926]]);
    expect(b).toMatchObject({ subtotalCents: 12000, lineDiscountCents: 600, globalDiscountCents: 1000, totalCents: 10400 });
    expect(b.items[1].discountPercent).toBe(10);
    await accept(id);
    b = await get(id);
    for (const it of b.items) expect((await dentA.post(`/api/budget-items/${it.id}/perform`, {})).status).toBe(200);
    const ch = await env.db.adminPool.query("SELECT amount_cents FROM charges WHERE budget_item_id = ANY($1) ORDER BY amount_cents DESC", [b.items.map((i: any) => i.id)]);
    expect(ch.rows.map((r) => Number(r.amount_cents))).toEqual([5474, 4926]);
    expect((await get(id)).doneCents).toBe(10400);
  });

  it("descuento global en % y cambio desde las condiciones del borrador (auditado)", async () => {
    const pre = await pid("PRE-01");
    const id = await draft(patient, [{ procedureId: pre, unitPriceCents: 6000 }, { procedureId: pre, unitPriceCents: 6000, discountPercent: 10 }]);
    const r = await rec.put(`/api/budgets/${id}/terms`, { globalDiscount: { kind: "percent", value: 10 } });
    expect(r.status).toBe(200);
    const b = await get(id);
    expect(b.globalDiscountCents).toBe(1140);
    expect(b.totalCents).toBe(11400 - 1140);
    expect(b.items.reduce((s: number, i: any) => s + i.globalDiscountCents, 0)).toBe(1140);
    const a = await env.db.adminPool.query("SELECT data FROM audit_log WHERE entity_id = $1 AND action = 'budget.terms_changed'", [id]);
    expect(a.rows[0].data.after.discount_cents).toBe(1140);
  });

  it("rechaza en el servidor descuentos > 100 % o mayores que el importe (nunca total negativo)", async () => {
    const pre = await pid("PRE-01");
    const bad = async (items: any[], extra: any = {}) => dentA.post("/api/budgets", { branchId: B(), patientId: patient, dentistId: dent.id, items, ...extra });
    let r = await bad([{ procedureId: pre, unitPriceCents: 6000, discountPercent: 150 }]);
    expect(r.status).toBe(400); expect(r.body.error.message).toMatch(/100 %/);
    r = await bad([{ procedureId: pre, unitPriceCents: 6000, discountCents: 6001 }]);
    expect(r.status).toBe(400);
    r = await bad([{ procedureId: pre, unitPriceCents: 6000, discountCents: 100, discountPercent: 5 }]);
    expect(r.status).toBe(400);
    r = await bad([{ procedureId: pre, unitPriceCents: 6000 }], { globalDiscount: { kind: "amount", value: 6001 } });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe("discount_exceeds_total");
    r = await bad([{ procedureId: pre, unitPriceCents: 6000 }], { globalDiscount: { kind: "percent", value: 100.5 } });
    expect(r.status).toBe(400);
    // 100 % exacto es válido y deja el total en 0
    r = await bad([{ procedureId: pre, unitPriceCents: 6000 }], { globalDiscount: { kind: "percent", value: 100 } });
    expect(r.status).toBe(200);
    expect((await get(r.body.id)).totalCents).toBe(0);
    // Defensa en la base: neto negativo imposible aunque se salte la app
    const it = (await get(r.body.id)).items[0];
    await expect(env.db.adminPool.query("UPDATE budget_items SET discount_cents = 1 WHERE id = $1", [it.id])).rejects.toThrow();
  });

  it("los importes de un presupuesto presentado quedan congelados (trigger en la base)", async () => {
    const id = await draft(patient, [{ procedureId: await pid("PRE-01"), unitPriceCents: 6000 }]);
    await rec.post(`/api/budgets/${id}/status`, { status: "presented" });
    const it = (await get(id)).items[0];
    await expect(env.db.adminPool.query("UPDATE budget_items SET unit_price_cents = 1 WHERE id = $1", [it.id])).rejects.toThrow(/nueva versión/);
    expect((await rec.put(`/api/budgets/${id}/terms`, { globalDiscount: { kind: "amount", value: 100 } })).status).toBe(409);
  });
});

describe("prestaciones de varias sesiones (R2-09, R2-10)", () => {
  let patient: string, crown: string;
  beforeAll(async () => {
    patient = await createPatient(owner);
    crown = await pid("PRO-01"); // 2500 Bs
  });

  it("la plantilla debe sumar el precio; solo administración la define", async () => {
    let r = await owner.put(`/api/procedures/${crown}/sessions`, { sessions: [{ name: "Toma de medidas", amountCents: 100000 }, { name: "Colocación", amountCents: 100000 }] });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe("sessions_sum_mismatch");
    expect((await rec.put(`/api/procedures/${crown}/sessions`, { sessions: [] })).status).toBe(403);
    r = await owner.put(`/api/procedures/${crown}/sessions`, { sessions: [{ name: "Toma de medidas", amountCents: 100000 }, { name: "Colocación", amountCents: 150000 }] });
    expect(r.status).toBe(200);
    const list = (await rec.get("/api/procedure-sessions")).body;
    expect(list.find((x: any) => x.procedureId === crown).sessions).toHaveLength(2);
  });

  it("un cargo por sesión con su profesional; la línea se cierra con la última y no cobra dos veces", async () => {
    const id = await draft(patient, [{ procedureId: crown, tooth: 16, discountPercent: 10 }]);
    let b = await get(id);
    const item = b.items[0];
    expect(item.totalCents).toBe(225000);
    expect(item.sessions.map((s: any) => s.amountCents)).toEqual([90000, 135000]); // reescaladas al neto
    // No se realiza sin aceptar
    expect((await dentA.post(`/api/budget-item-sessions/${item.sessions[0].id}/perform`, {})).status).toBe(409);
    await accept(id);
    // Recepción no realiza tratamientos
    expect((await rec.post(`/api/budget-item-sessions/${item.sessions[0].id}/perform`, {})).status).toBe(403);
    const both = await Promise.all([
      dentA.post(`/api/budget-item-sessions/${item.sessions[0].id}/perform`, {}),
      dentA.post(`/api/budget-item-sessions/${item.sessions[0].id}/perform`, {}),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    b = await get(id);
    expect(b.items[0].status).toBe("pending");
    expect(b.status).toBe("accepted");
    // La segunda la hace otra odontóloga
    const r2 = await dentB.post(`/api/budget-item-sessions/${item.sessions[1].id}/perform`, {});
    expect(r2.status).toBe(200); expect(r2.body.itemDone).toBe(true);
    b = await get(id);
    expect(b.items[0].status).toBe("done");
    expect(b.status).toBe("completed");
    const ch = await env.db.adminPool.query("SELECT amount_cents, dentist_id FROM charges WHERE budget_item_id = $1 ORDER BY created_at", [item.id]);
    expect(ch.rows.map((r) => [Number(r.amount_cents), r.dentist_id])).toEqual([[90000, dent.id], [135000, dent2.id]]);
    // Producción por profesional: cada sesión a quien la hizo, ninguna "sin profesional"
    const prod = (await owner.get("/api/reports/production-by-dentist")).body;
    const rows = prod.rows ?? prod;
    const of = (uid: string) => rows.find((x: any) => (x.dentistId ?? x.userId) === uid);
    expect(Number(of(dent.id)?.productionCents ?? 0)).toBeGreaterThanOrEqual(90000);
    expect(Number(of(dent2.id)?.productionCents ?? 0)).toBeGreaterThanOrEqual(135000);
    // Anular el cargo de una sesión la deja pendiente otra vez
    const sid = (await env.db.adminPool.query("SELECT id FROM charges WHERE session_id = $1", [item.sessions[1].id])).rows[0].id;
    expect((await owner.post(`/api/charges/${sid}/void`, { reason: "Error de registro" })).status).toBe(200);
    b = await get(id);
    expect(b.items[0].sessions.map((s: any) => s.status)).toEqual(["done", "pending"]);
    expect(b.status).toBe("accepted");
  });

  it("marcar la línea entera como realizada cobra solo las sesiones pendientes", async () => {
    const id = await draft(patient, [{ procedureId: crown, tooth: 26 }]);
    await accept(id);
    const item = (await get(id)).items[0];
    await dentA.post(`/api/budget-item-sessions/${item.sessions[0].id}/perform`, {});
    expect((await dentA.post(`/api/budget-items/${item.id}/perform`, {})).status).toBe(200);
    const ch = await env.db.adminPool.query("SELECT amount_cents FROM charges WHERE budget_item_id = $1 ORDER BY created_at", [item.id]);
    expect(ch.rows.map((r) => Number(r.amount_cents))).toEqual([100000, 150000]);
    expect(ch.rows.reduce((s, r) => s + Number(r.amount_cents), 0)).toBe(250000);
  });
});

describe("versiones (R2-13)", () => {
  let patient: string;
  beforeAll(async () => { patient = await createPatient(owner); });

  it("la nueva versión copia líneas, reemplaza a la anterior y la v1 ya no se acepta ni se cobra", async () => {
    const pre = await pid("PRE-01");
    const v1 = await draft(patient, [{ procedureId: pre, unitPriceCents: 6000 }, { procedureId: pre, unitPriceCents: 6000, discountPercent: 10 }], { globalDiscount: { kind: "amount", value: 1000 } });
    await rec.post(`/api/budgets/${v1}/status`, { status: "presented" });
    expect((await rec.post(`/api/budgets/${v1}/versions`, {})).status).toBe(400); // pide confirmación
    const r = await rec.post(`/api/budgets/${v1}/versions`, { confirm: true });
    expect(r.status).toBe(200);
    const v2 = r.body.id;
    const [b1, b2] = [await get(v1), await get(v2)];
    expect(b1.status).toBe("superseded");
    expect(b1.isLatest).toBe(false); expect(b1.latestVersionId).toBe(v2);
    expect(b2).toMatchObject({ status: "draft", number: b1.number, version: 2, totalCents: 10400, isLatest: true });
    const acc = await rec.post(`/api/budgets/${v1}/status`, { status: "accepted" });
    expect(acc.status).toBe(409); expect(acc.body.error.code).toBe("budget_superseded"); expect(acc.body.error.message).toMatch(/v2/);
    const pay = await rec.post("/api/payments", { branchId: B(), patientId: patient, budgetId: v1, amountCents: 100, method: "cash", idempotencyKey: key() });
    expect(pay.status).toBe(409); expect(pay.body.error.code).toBe("budget_superseded");
    expect((await rec.post(`/api/budgets/${v1}/versions`, { confirm: true })).status).toBe(409);
    // Cambiar la v2 y ver el historial con diferencias
    expect((await dentA.put(`/api/budgets/${v2}/items`, { items: [{ procedureId: pre, unitPriceCents: 6000 }, { procedureId: await pid("PRE-02"), unitPriceCents: 8000 }] })).status).toBe(200);
    const h = (await acct.get(`/api/budgets/${v2}/versions`)).body;
    expect(h.map((v: any) => [v.version, v.status])).toEqual([[1, "superseded"], [2, "draft"]]);
    expect(h[1].changes.map((c: any) => c.kind).sort()).toEqual(["added", "changed"]);
    expect(h[1].previousTotalCents).toBe(10400);
    // Solo una versión viva por número (índice único en la base)
    await expect(env.db.adminPool.query("UPDATE budgets SET status = 'draft' WHERE id = $1", [v1])).rejects.toThrow();
  });

  it("no se versiona un presupuesto con tratamientos realizados ni con pagos", async () => {
    const pre = await pid("PRE-01");
    const a = await draft(patient, [{ procedureId: pre, unitPriceCents: 6000 }, { procedureId: pre, unitPriceCents: 3000 }]);
    await accept(a);
    await dentA.post(`/api/budget-items/${(await get(a)).items[0].id}/perform`, {});
    const r = await rec.post(`/api/budgets/${a}/versions`, { confirm: true });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe("has_performed"); expect(r.body.error.message).toMatch(/presupuesto nuevo/);
    const b = await draft(patient, [{ procedureId: pre, unitPriceCents: 6000 }]);
    await accept(b);
    await rec.post("/api/payments", { branchId: B(), patientId: patient, budgetId: b, amountCents: 1000, method: "cash", idempotencyKey: key() });
    expect((await rec.post(`/api/budgets/${b}/versions`, { confirm: true })).body.error.code).toBe("has_payments");
    expect((await acct.post(`/api/budgets/${b}/versions`, { confirm: true })).status).toBe(403);
  });
});

describe("enlace público del paciente (R2-15)", () => {
  let patient: string;
  const phone = "71234567";
  beforeAll(async () => { patient = await createPatient(owner, { firstName: "Lucía", phone, birthDate: "2015-03-09", consentReminders: true, guardianName: "María Quispe", guardianPhone: "76543210" }); });

  async function shared(items?: any[]) {
    const id = await draft(patient, items ?? [{ procedureId: await pid("PRE-01"), unitPriceCents: 6000 }, { procedureId: await pid("PRE-01"), unitPriceCents: 6000, discountPercent: 10 }], { globalDiscount: { kind: "amount", value: 1000 }, installments: 3 });
    const r = await rec.post(`/api/budgets/${id}/share-links`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { id, ...r.body, token: tokenOf(r.body.url) };
  }

  it("compartir presenta el borrador, guarda solo el hash y arma un WhatsApp sin datos clínicos", async () => {
    const s = await shared();
    expect((await get(s.id)).status).toBe("presented");
    expect(s.whatsappUrl).toMatch(/^https:\/\/wa\.me\/59171234567\?text=/);
    const text = decodeURIComponent(s.whatsappUrl.split("text=")[1]);
    expect(text).not.toMatch(/Profilaxis|Bs|104/);
    const row = (await env.db.adminPool.query("SELECT token_hash, expires_at - created_at AS d FROM budget_share_links WHERE id = $1", [s.linkId])).rows[0];
    expect(Buffer.from(row.token_hash).toString("hex")).not.toContain(Buffer.from(s.token).toString("hex"));
    expect(row.d.days).toBe(30);
    // Sin consentimiento: solo copiar
    const p2 = await createPatient(owner, { consentReminders: false });
    const id2 = await draft(p2, [{ procedureId: await pid("PRE-01") }]);
    const r2 = await rec.post(`/api/budgets/${id2}/share-links`, {});
    expect(r2.body.whatsappUrl).toBeNull(); expect(r2.body.whatsappBlockedReason).toMatch(/no autorizó/);
  });

  it("antes de verificar no se ve nada: ni clínica, ni importes, ni estado", async () => {
    const s = await shared();
    const bad = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "0000" });
    expect(bad.status, bad.raw).toBe(401);
    expect(bad.body.error.details.attemptsLeft).toBe(4);
    for (const leak of ["Clínica Presupuestos", "Sucursal", "Lucía", "10400", "104", "presented", "Presentado", "Profilaxis"]) expect(bad.raw).not.toContain(leak);
    const none = await pub(`/api/public/budget-links/${"x".repeat(43)}/verify`, { method: "phone", phoneLast4: "4567" });
    expect(none.status).toBe(404);
    const view = await pub(`/api/public/budget-links/${s.token}/view`, { access: "123.abcdefghijk" });
    expect(view.status).toBe(401);
    expect(view.raw).not.toContain("Clínica Presupuestos");
  });

  it("verifica con el celular o la fecha de nacimiento y muestra el presupuesto; registra «visto» sin IP", async () => {
    const s = await shared();
    const v = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" });
    expect(v.status).toBe(200);
    expect(v.body.budget).toMatchObject({ state: "open", totalCents: 10400, subtotalCents: 12000, discountCents: 1600, installments: 3, patientFirstName: "Lucía" });
    expect(v.body.budget.installmentPlan.reduce((a: number, b: number) => a + b, 0)).toBe(10400);
    expect(v.body.budget.items.map((i: any) => i.netCents)).toEqual([5474, 4926]);
    expect(v.body.budget.contact.clinicName).toBe("Clínica Presupuestos");
    expect(v.body.budget.validUntil).toBeTruthy();
    const v2 = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "birthDate", birthDate: "2015-03-09" });
    expect(v2.status).toBe(200);
    const ev = (await env.db.adminPool.query("SELECT ua_hash, data FROM budget_events WHERE budget_id = $1 AND kind = 'viewed'", [s.id])).rows;
    expect(ev).toHaveLength(2);
    expect(ev[0].ua_hash).toMatch(/^[0-9a-f]{64}$/);
    const act = (await rec.get(`/api/budgets/${s.id}/activity`)).body;
    expect(act.links[0]).toMatchObject({ views: 2, state: "active" });
    expect((await get(s.id)).firstViewedAt).toBeTruthy();
  });

  it("5 intentos fallidos bloquean el enlace, incluso con el dato correcto después", async () => {
    const s = await shared();
    for (let i = 1; i <= 4; i++) expect((await pub(`/api/public/budget-links/${s.token}/verify`, { method: "birthDate", birthDate: "2000-01-01" })).status).toBe(401);
    const fifth = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "1111" });
    expect(fifth.status).toBe(423);
    expect((await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" })).status).toBe(423);
    const act = (await rec.get(`/api/budgets/${s.id}/activity`)).body;
    expect(act.links[0].state).toBe("locked");
    expect(act.events.filter((e: any) => e.kind === "verify_failed")).toHaveLength(5);
    // Un enlace nuevo sí funciona
    const again = await rec.post(`/api/budgets/${s.id}/share-links`, {});
    expect((await pub(`/api/public/budget-links/${tokenOf(again.body.url)}/verify`, { method: "phone", phoneLast4: "4567" })).status).toBe(200);
  });

  it("acepta con nombre, relación, casilla y firma: pasa a aceptado con nota y auditoría; no se acepta dos veces", async () => {
    const s = await shared();
    const { body } = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" });
    const url = `/api/public/budget-links/${s.token}/accept`;
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    expect((await pub(url, { access: body.access, signerName: "María Quispe", relationship: "guardian" })).status).toBe(400); // falta la casilla
    expect((await pub(url, { access: body.access, signerName: "Ma", relationship: "guardian", agree: true })).status).toBe(400);
    const ok = await pub(url, { access: body.access, signerName: "María Quispe", relationship: "guardian", agree: true, signaturePng: png });
    expect(ok.status).toBe(200);
    expect(ok.body.budget.state).toBe("accepted");
    const b = await get(s.id);
    expect(b).toMatchObject({ status: "accepted", decidedNote: "Aceptado por el paciente en línea" });
    expect(b.onlineAcceptance).toMatchObject({ signerName: "María Quispe", signerRelationship: "guardian", hasSignature: true });
    expect(b.onlineAcceptance.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const au = (await env.db.adminPool.query("SELECT user_id, ip, data FROM audit_log WHERE entity_id = $1 AND action = 'budget.accepted_online'", [s.id])).rows[0];
    expect(au).toMatchObject({ user_id: null, ip: null });
    expect(au.data.totalCents).toBe(10400);
    const twice = await pub(url, { access: body.access, signerName: "María Quispe", relationship: "guardian", agree: true });
    expect(twice.status).toBe(409); expect(twice.body.error.code).toBe("already_decided");
    // Los eventos son de solo inserción
    await expect(env.db.adminPool.query("UPDATE budget_events SET signer_name = 'X' WHERE budget_id = $1", [s.id])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM budget_events WHERE budget_id = $1", [s.id])).rejects.toThrow(/solo inserción/);
  });

  it("«No me interesa» con motivo opcional deja el presupuesto rechazado", async () => {
    const s = await shared();
    const { body } = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" });
    const r = await pub(`/api/public/budget-links/${s.token}/reject`, { access: body.access, reason: "Lo haré más adelante" });
    expect(r.status).toBe(200);
    const b = await get(s.id);
    expect(b.status).toBe("rejected");
    expect(b.decidedNote).toMatch(/Lo haré más adelante/);
  });

  it("solo la versión vigente se acepta: el enlace de la v1 avisa que hay una más reciente", async () => {
    const s = await shared();
    const { body } = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" });
    expect((await rec.post(`/api/budgets/${s.id}/versions`, { confirm: true })).status).toBe(200);
    const view = await pub(`/api/public/budget-links/${s.token}/view`, { access: body.access });
    expect(view.body.budget.state).toBe("superseded");
    expect(view.body.budget.items).toBeUndefined();
    const acc = await pub(`/api/public/budget-links/${s.token}/accept`, { access: body.access, signerName: "Lucía Paz", relationship: "patient", agree: true });
    expect(acc.status).toBe(409); expect(acc.body.error.code).toBe("budget_superseded");
    expect((await get(s.id)).status).toBe("superseded");
  });

  it("un enlace revocado o vencido deja de funcionar; el acceso de otro enlace no sirve", async () => {
    const s = await shared();
    const s2 = await rec.post(`/api/budgets/${s.id}/share-links`, {});
    const { body } = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" });
    expect((await pub(`/api/public/budget-links/${tokenOf(s2.body.url)}/view`, { access: body.access })).status).toBe(401);
    expect((await rec.post(`/api/budget-share-links/${s.linkId}/revoke`, {})).status).toBe(200);
    expect((await pub(`/api/public/budget-links/${s.token}/view`, { access: body.access })).status).toBe(404);
    await env.db.adminPool.query("UPDATE budget_share_links SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1", [s2.body.linkId]);
    expect((await pub(`/api/public/budget-links/${tokenOf(s2.body.url)}/verify`, { method: "phone", phoneLast4: "4567" })).status).toBe(404);
  });

  it("un presupuesto vencido no se puede aceptar por el enlace", async () => {
    const s = await shared();
    await env.db.adminPool.query("UPDATE budgets SET valid_until = current_date - 2 WHERE id = $1", [s.id]);
    const { body } = await pub(`/api/public/budget-links/${s.token}/verify`, { method: "phone", phoneLast4: "4567" });
    expect(body.budget.state).toBe("expired");
    const r = await pub(`/api/public/budget-links/${s.token}/accept`, { access: body.access, signerName: "Lucía Paz", relationship: "patient", agree: true });
    expect(r.body.error.code).toBe("budget_expired");
  });

  it("entregado en mano: presenta el borrador y deja registro de canal, fecha y usuario", async () => {
    const id = await draft(patient, [{ procedureId: await pid("PRE-01") }]);
    expect((await rec.post(`/api/budgets/${id}/delivered`, {})).status).toBe(200);
    expect((await get(id)).status).toBe("presented");
    const ev = (await rec.get(`/api/budgets/${id}/activity`)).body.events.find((e: any) => e.kind === "delivered");
    expect(ev).toMatchObject({ channel: "in_hand" });
    expect(ev.actorName).toBeTruthy();
  });

  it("permisos: contabilidad y asistente no comparten; un profesional de otra sucursal tampoco", async () => {
    const id = await draft(patient, [{ procedureId: await pid("PRE-01") }]);
    expect((await acct.post(`/api/budgets/${id}/share-links`, {})).status).toBe(403);
    expect((await assistant.post(`/api/budgets/${id}/share-links`, {})).status).toBe(403);
    expect((await assistant.get("/api/budget-funnel")).status).toBe(403);
    expect((await dentOther.post(`/api/budgets/${id}/share-links`, {})).status).toBe(403);
    expect((await dentOther.post(`/api/budgets/${id}/delivered`, {})).status).toBe(403);
    expect((await rec.put("/api/budget-settings", { validityDays: 15 })).status).toBe(403);
    expect((await acct.get(`/api/budgets/${id}/activity`)).status).toBe(200);
  });
});

describe("aislamiento entre clínicas en las tablas nuevas", () => {
  it("otra clínica no ve ni opera enlaces, eventos ni sesiones", async () => {
    const patient = await createPatient(owner, { phone: "70001234" });
    const crown = await pid("PRO-01");
    const id = await draft(patient, [{ procedureId: crown, tooth: 36 }]);
    const link = (await rec.post(`/api/budgets/${id}/share-links`, {})).body;
    const sess = (await get(id)).items[0].sessions[0].id;
    expect((await owner2.get(`/api/budgets/${id}/activity`)).status).toBe(404);
    expect((await owner2.post(`/api/budgets/${id}/share-links`, {})).status).toBe(404);
    expect((await owner2.post(`/api/budget-share-links/${link.linkId}/revoke`, {})).status).toBe(404);
    expect((await owner2.post(`/api/budgets/${id}/versions`, { confirm: true })).status).toBe(404);
    expect((await owner2.get(`/api/budgets/${id}/versions`)).status).toBe(404);
    const dentK2 = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
    expect((await dentK2.post(`/api/budget-item-sessions/${sess}/perform`, {})).status).toBe(404);
    const funnel2 = (await owner2.get("/api/budget-funnel")).body;
    expect(Object.values(funnel2.buckets).flat()).toHaveLength(0);
    const counts = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) => ({
      links: (await c.query("SELECT count(*)::int AS n FROM budget_share_links WHERE budget_id = $1", [id])).rows[0].n,
      events: (await c.query("SELECT count(*)::int AS n FROM budget_events WHERE budget_id = $1", [id])).rows[0].n,
      sessions: (await c.query("SELECT count(*)::int AS n FROM budget_item_sessions WHERE id = $1", [sess])).rows[0].n,
    }));
    expect(counts).toEqual({ links: 0, events: 0, sessions: 0 });
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO budget_events (clinic_id, budget_id, kind) VALUES ($1,$2,'viewed')", [K.clinicId, id]))).rejects.toThrow();
    // El token resuelve solo su propia clínica: la vista pública no mezcla datos
    const v = await pub(`/api/public/budget-links/${tokenOf(link.url)}/verify`, { method: "phone", phoneLast4: "1234" });
    expect(v.body.budget.contact.clinicName).toBe("Clínica Presupuestos");
  });
});

describe("embudo (R2-16)", () => {
  let F: TestClinic, fo: Agent, fdent: { id: string; email: string }, fd: Agent;
  beforeAll(async () => {
    F = await createClinic(env.db, { name: "Clínica Embudo" });
    fo = await login(env.app, F.ownerEmail);
    fdent = await addUser(env.db, F.clinicId, "dentist", { allBranches: true });
    fd = await login(env.app, fdent.email);
  });
  const mk = async (status: "presented" | "accepted" | "rejected", daysAgo: number, extra: { validUntil?: string } = {}) => {
    const p = await createPatient(fo);
    const r = await fd.post("/api/budgets", { branchId: F.branches[0], patientId: p, dentistId: fdent.id, items: [{ procedureId: await procedureId(env.db, F.clinicId, "PRE-01"), unitPriceCents: 10000 }, { procedureId: await procedureId(env.db, F.clinicId, "PRE-02"), unitPriceCents: 5000 }] });
    await fo.post(`/api/budgets/${r.body.id}/status`, { status: "presented" });
    if (status !== "presented") await fo.post(`/api/budgets/${r.body.id}/status`, { status });
    await env.db.adminPool.query("UPDATE budgets SET presented_at = now() - make_interval(days => $2), decided_at = CASE WHEN decided_at IS NULL THEN NULL ELSE now() - make_interval(days => $2 - 1) END, valid_until = $3 WHERE id = $1",
      [r.body.id, daysAgo, extra.validUntil ?? null]);
    return { id: r.body.id as string, patient: p };
  };

  it("bandejas con días en el estado, seguimiento a 7 y 14 días y conversión", async () => {
    const fresh = await mk("presented", 2);
    const d8 = await mk("presented", 8);
    const d15 = await mk("presented", 15);
    const exp = await mk("presented", 40); // vence a los 30 días por defecto
    const accNoAppt = await mk("accepted", 5);
    const accAppt = await mk("accepted", 5);
    const inProg = await mk("accepted", 10);
    await mk("rejected", 3);
    // Cita futura para accAppt
    await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4, now() + interval '3 days', now() + interval '3 days 30 minutes')",
      [F.clinicId, F.branches[0], fdent.id, accAppt.patient]);
    // Un tratamiento realizado en inProg
    const item = (await fo.get(`/api/budgets/${inProg.id}`)).body.items[0];
    expect((await fd.post(`/api/budget-items/${item.id}/perform`, {})).status).toBe(200);
    // Seguimiento registrado en d8 → ya no pide el de 7 días
    expect((await fo.post(`/api/budgets/${d8.id}/events`, { kind: "follow_up" })).status).toBe(400);
    expect((await fo.post(`/api/budgets/${d8.id}/events`, { kind: "follow_up", channel: "phone", note: "Lo piensa con su familia" })).status).toBe(200);

    const f = (await fo.get("/api/budget-funnel")).body;
    const ids = (k: string) => f.buckets[k].map((x: any) => x.id).sort();
    expect(ids("presentedNoResponse")).toEqual([fresh.id, d8.id, d15.id].sort());
    expect(ids("expired")).toEqual([exp.id]);
    expect(ids("acceptedNoAppointment")).toEqual([accNoAppt.id]);
    expect(ids("inProgressNoNext")).toEqual([inProg.id]);
    const row = (id: string) => f.buckets.presentedNoResponse.find((x: any) => x.id === id);
    expect(row(fresh.id)).toMatchObject({ daysInState: 2, followUpDue: null });
    expect(row(d8.id)).toMatchObject({ daysInState: 8, followUpDue: null, followUps: 1 });
    expect(row(d15.id)).toMatchObject({ daysInState: 15, followUpDue: 14 });
    expect(f.buckets.expired[0].daysInState).toBe(10);
    expect(f.buckets.acceptedNoAppointment[0].daysInState).toBe(4);
    expect(f.buckets.inProgressNoNext[0].daysInState).toBe(0);
    // 8 presentados en el período: 3 aceptados, 1 rechazado
    expect(f.conversion).toMatchObject({ presented: 8, accepted: 3, rejected: 1, conversionPct: 37.5 });

    // La validez es configurable por clínica: con 60 días, el de 40 días ya no está vencido
    expect((await fo.put("/api/budget-settings", { validityDays: 60 })).status).toBe(200);
    expect((await fo.put("/api/budget-settings", { validityDays: 3 })).status).toBe(400);
    const f2 = (await fo.get("/api/budget-funnel")).body;
    expect(f2.buckets.expired).toHaveLength(0);
    expect(f2.buckets.presentedNoResponse.map((x: any) => x.id)).toContain(exp.id);
    // A los 7 días sin seguimiento
    const d7 = await mk("presented", 7);
    const f3 = (await fo.get("/api/budget-funnel")).body;
    expect(f3.buckets.presentedNoResponse.find((x: any) => x.id === d7.id).followUpDue).toBe(7);
  });
});

describe("un solo saldo del paciente (R2-11)", () => {
  it("la ficha, la cuenta, el presupuesto y las cuentas por cobrar muestran los mismos importes", async () => {
    const patient = await createPatient(owner);
    const pre = await pid("PRE-01");
    const id = await draft(patient, [{ procedureId: pre, unitPriceCents: 6000 }, { procedureId: pre, unitPriceCents: 6000, discountPercent: 10 }], { globalDiscount: { kind: "amount", value: 1000 } });
    await accept(id);
    const b0 = await get(id);
    await dentA.post(`/api/budget-items/${b0.items[0].id}/perform`, {}); // 54,74
    await rec.post("/api/payments", { branchId: B(), patientId: patient, budgetId: id, amountCents: 3000, method: "cash", idempotencyKey: key() });
    await rec.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 500, method: "cash", idempotencyKey: key() }); // a cuenta
    await rec.post("/api/payments", { branchId: B(), patientId: patient, budgetId: id, amountCents: 1000, method: "transfer", bankReference: `R11-${Date.now()}`, idempotencyKey: key() });

    const summary = (await owner.get(`/api/patients/${patient}`)).body.account;
    const account = (await owner.get(`/api/patients/${patient}/account`)).body;
    const budget = await get(id);
    const receivable = (await owner.get("/api/reports/receivables")).body.find((r: any) => r.patientId === patient);

    expect(account).toMatchObject({ budgetedCents: 10400, chargedCents: 5474, paidCents: 3500, onAccountCents: 500, pendingVerificationCents: 1000, balanceCents: 1974 });
    for (const k of ["budgetedCents", "chargedCents", "paidCents", "onAccountCents", "pendingVerificationCents", "balanceCents"]) expect(summary[k], k).toBe(account[k]);
    expect(summary.balance).toBe(account.balanceCents);
    expect(summary.pending).toBe(account.pendingVerificationCents);
    expect(Number(receivable.balanceCents)).toBe(account.balanceCents);
    // El presupuesto cuadra con la cuenta: total = presupuestado, realizado = cargos, pagado + a cuenta = cobrado
    expect(budget.totalCents).toBe(account.budgetedCents);
    expect(budget.doneCents).toBe(account.chargedCents);
    expect(budget.paidCents + account.onAccountCents).toBe(account.paidCents);
    expect(budget.pendingVerificationCents).toBe(account.pendingVerificationCents);
    // El listado de presupuestos usa el mismo neto
    const list = (await owner.get(`/api/budgets?patientId=${patient}`)).body;
    expect(Number(list.find((x: any) => x.id === id).totalCents)).toBe(budget.totalCents);
  });
});
