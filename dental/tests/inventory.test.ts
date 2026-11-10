// Inventario por sucursal y compras (B-062 / B-047 / B-024; IN-01 a IN-09).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { requiredMilli } from "../server/src/modules/inventory/core.js";
import { materialCostForTreatment } from "../server/src/modules/inventory/index.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, admin: Agent, asstA: Agent, asstB: Agent, dentA: Agent, rec: Agent, acct: Agent, support: Agent, owner2: Agent;
let dent: { id: string; email: string };
const B0 = () => K.branches[0]!;
const B1 = () => K.branches[1]!;
const day = (n: number) => DateTime.now().setZone("America/La_Paz").plus({ days: n }).toISODate()!;
let skuN = 0;
const sku = (p = "T") => `${p}-${Date.now().toString(36).toUpperCase()}-${skuN++}`;

async function item(over: Record<string, unknown> = {}) {
  const r = await owner.post("/api/inventory/items", {
    sku: sku(), name: `Insumo ${skuN}`, category: "Pruebas", useUnit: "unidad", purchaseUnit: "caja de 100", purchaseFactor: 100, tracksLots: false, ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}
async function receive(agent: Agent, branchId: string, itemId: string, qty: number, extra: Record<string, unknown> = {}) {
  const r = await agent.post("/api/inventory/receipts", { branchId, itemId, qty, unit: "use", unitPriceCents: 50, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
const stockOf = async (itemId: string, branchId: string) =>
  Number((await env.db.adminPool.query("SELECT coalesce((SELECT qty_on_hand FROM inv_stock WHERE item_id = $1 AND branch_id = $2), 0) AS q", [itemId, branchId])).rows[0].q);

/** Comprueba la invariante IN-01 directamente en SQL. Devuelve las filas que la violan. */
async function invariantViolations(clinicId: string) {
  const r = await env.db.adminPool.query(
    `SELECT 'stock<>lotes' AS kind, s.item_id, s.branch_id, s.qty_on_hand AS a,
            (SELECT coalesce(sum(l.qty_on_hand), 0) FROM inv_lots l WHERE l.item_id = s.item_id AND l.branch_id = s.branch_id) AS b
       FROM inv_stock s WHERE s.clinic_id = $1
        AND s.qty_on_hand <> (SELECT coalesce(sum(l.qty_on_hand), 0) FROM inv_lots l WHERE l.item_id = s.item_id AND l.branch_id = s.branch_id)
     UNION ALL
     SELECT 'lote<>movimientos', l.item_id, l.branch_id, l.qty_on_hand, (SELECT coalesce(sum(m.qty), 0) FROM inv_movements m WHERE m.lot_id = l.id)
       FROM inv_lots l WHERE l.clinic_id = $1 AND l.qty_on_hand <> (SELECT coalesce(sum(m.qty), 0) FROM inv_movements m WHERE m.lot_id = l.id)
     UNION ALL
     SELECT 'negativo', l.item_id, l.branch_id, l.qty_on_hand, 0 FROM inv_lots l WHERE l.clinic_id = $1 AND l.qty_on_hand < 0`, [clinicId]);
  return r.rows;
}

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { name: "Clínica Inventario" });
  K2 = await createClinic(env.db, { name: "Clínica Ajena" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  admin = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { allBranches: true })).email);
  asstA = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [B0()] })).email);
  asstB = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [B1()] })).email);
  dent = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B0()] });
  dentA = await login(env.app, dent.email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B0()] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  support = await login(env.app, (await addUser(env.db, K.clinicId, "support", { branchIds: [B0()] })).email);
});
afterAll(async () => teardown(env));

describe("catálogo: SKU único, conversión de unidades y sin ítems ocultos", () => {
  it("el SKU se normaliza a mayúsculas y no se puede duplicar (mensaje junto al campo y garantía en la base)", async () => {
    const code = sku("guante").toLowerCase();
    const r1 = await owner.post("/api/inventory/items", { sku: code, name: "Guantes de nitrilo M", useUnit: "par", purchaseUnit: "caja de 50 pares", purchaseFactor: 50 });
    expect(r1.status).toBe(200);
    const r2 = await admin.post("/api/inventory/items", { sku: code.toUpperCase(), name: "Otro", useUnit: "par", purchaseUnit: "caja", purchaseFactor: 1 });
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe("duplicate_sku");
    expect(r2.body.error.details[0].path).toBe("sku");
    expect(r2.body.error.message).toContain("Guantes de nitrilo M");
    await expect(env.db.adminPool.query(
      "INSERT INTO inv_items (clinic_id, sku, name, use_unit, purchase_unit) VALUES ($1,$2,'Duplicado','u','u')", [K.clinicId, code.toUpperCase()])).rejects.toThrow(/inv_items_sku_uq/);
    // Otra clínica puede usar el mismo SKU
    expect((await owner2.post("/api/inventory/items", { sku: code, name: "Guantes", useUnit: "par", purchaseUnit: "caja", purchaseFactor: 1 })).status).toBe(200);
  });

  it("valida con mensajes claros, sin truncar en silencio", async () => {
    const r = await owner.post("/api/inventory/items", { sku: "CON ESPACIO", name: "x", useUnit: "", purchaseUnit: "caja", purchaseFactor: 0 });
    expect(r.status).toBe(400);
    expect(r.body.error.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(["sku", "name", "useUnit", "purchaseFactor"]));
    const r2 = await owner.post("/api/inventory/items", { sku: sku(), name: "Decimales", useUnit: "ml", purchaseUnit: "frasco", purchaseFactor: 1.0001 });
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toMatch(/3 decimales/);
  });

  it("un insumo nuevo sin lotes aparece en la vista de la sucursal (en cero) y la compra convierte cajas a unidades", async () => {
    const id = await item({ name: "Eyectores de saliva", purchaseFactor: 100, mins: [{ branchId: B0(), minQty: 50 }] });
    let st = (await asstA.get(`/api/inventory/stock?branchId=${B0()}`)).body;
    let row = st.items.find((x: any) => x.id === id);
    expect(row).toBeTruthy();
    expect(row.qty).toBe(0);
    expect(row.alerts.map((a: any) => a.type)).toContain("below_min"); // 0 frente a mínimo 50 sí alerta
    const r = await asstA.post("/api/inventory/receipts", { branchId: B0(), itemId: id, qty: 2, unit: "purchase", unitPriceCents: 3500 });
    expect(r.status).toBe(200);
    expect(r.body.qty).toBe(200);
    st = (await asstA.get(`/api/inventory/stock?branchId=${B0()}`)).body;
    row = st.items.find((x: any) => x.id === id);
    expect(row.qty).toBe(200);
    expect(row.valueCents).toBe(7000); // 2 cajas × 35 Bs
    expect(row.alerts).toEqual([]);
    const lot = (await env.db.adminPool.query("SELECT unit_cost FROM inv_lots WHERE item_id = $1", [id])).rows[0];
    expect(Number(lot.unit_cost)).toBe(35); // 35 centavos por unidad
  });
});

describe("FEFO, lote elegido y nunca negativo", () => {
  let id: string;
  beforeAll(async () => {
    id = await item({ name: "Anestesia lidocaína 2 %", useUnit: "cartucho", purchaseUnit: "caja de 50", purchaseFactor: 50, tracksLots: true });
    await receive(asstA, B0(), id, 10, { lotCode: "LARGO", expiresOn: day(200) });
    await receive(asstA, B0(), id, 10, { lotCode: "CORTO", expiresOn: day(40) });
    // Lote vencido creado directamente (con el pool dueño; el trigger igual aplica el saldo)
    const a = env.db.adminPool;
    const lot = (await a.query("INSERT INTO inv_lots (clinic_id, item_id, branch_id, lot_code, expires_on) VALUES ($1,$2,$3,'VIEJO',$4) RETURNING id", [K.clinicId, id, B0(), day(-3)])).rows[0].id;
    await a.query("INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost) VALUES ($1,$2,$3,$4,'purchase',5,10)", [K.clinicId, id, B0(), lot]);
  });
  const lotQty = async (code: string) => Number((await env.db.adminPool.query("SELECT qty_on_hand FROM inv_lots WHERE item_id = $1 AND lot_code = $2", [id, code])).rows[0].qty_on_hand);

  it("sin lote elegido descuenta primero el que vence antes y saltea el vencido", async () => {
    const r = await asstA.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 12 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.parts.map((p: any) => p.qty)).toEqual([10, 2]);
    expect(await lotQty("CORTO")).toBe(0);
    expect(await lotQty("LARGO")).toBe(8);
    expect(await lotQty("VIEJO")).toBe(5);
    expect(await stockOf(id, B0())).toBe(13);
  });

  it("no se ingresa a stock un lote que ya llegó vencido", async () => {
    const r = await asstA.post("/api/inventory/receipts", { branchId: B0(), itemId: id, qty: 1, unit: "use", unitPriceCents: 10, lotCode: "TARDE", expiresOn: day(-1) });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("expiresOn");
  });

  it("con lote elegido descuenta de ese lote; un lote vencido no se consume", async () => {
    const largo = (await env.db.adminPool.query("SELECT id FROM inv_lots WHERE item_id = $1 AND lot_code = 'LARGO'", [id])).rows[0].id;
    const viejo = (await env.db.adminPool.query("SELECT id FROM inv_lots WHERE item_id = $1 AND lot_code = 'VIEJO'", [id])).rows[0].id;
    expect((await dentA.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 1, lotId: largo })).status).toBe(200);
    expect(await lotQty("LARGO")).toBe(7);
    const r = await asstA.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 1, lotId: viejo });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("lot_expired");
    // El vencido se da de baja con un ajuste por vencimiento
    expect((await asstA.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "out", qty: 5, reason: "expiry", lotId: viejo })).status).toBe(200);
    expect(await lotQty("VIEJO")).toBe(0);
  });

  it("rechaza con mensaje claro un consumo mayor al stock y no cambia nada", async () => {
    const before = await stockOf(id, B0());
    const r = await asstA.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 500 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("insufficient_stock");
    expect(r.body.error.message).toMatch(/Stock insuficiente de «Anestesia lidocaína 2 %»: hay 7 cartucho disponibles/);
    expect(r.body.error.details[0].path).toBe("qty");
    expect(await stockOf(id, B0())).toBe(before);
    // La base también lo impide aunque el código fallara
    const lot = (await env.db.adminPool.query("SELECT id FROM inv_lots WHERE item_id = $1 AND lot_code = 'LARGO'", [id])).rows[0].id;
    await expect(env.db.adminPool.query("INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty) VALUES ($1,$2,$3,$4,'consumption',-100)", [K.clinicId, id, B0(), lot]))
      .rejects.toThrow(/Stock insuficiente/);
  });

  it("ajustes: motivo obligatorio, «Otro» exige explicación y los lotes se eligen", async () => {
    let r = await asstA.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "in", qty: 1 });
    expect(r.status).toBe(400);
    r = await asstA.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "in", qty: 1, reason: "other", lotCode: "LARGO", expiresOn: day(200) });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("note");
    r = await asstA.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "out", qty: 1, reason: "breakage" });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("lotId");
    r = await asstA.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "in", qty: 1, reason: "count", lotCode: "LARGO", expiresOn: day(201) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("lot_expiry_mismatch");
    r = await asstA.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "in", qty: 1, reason: "other", note: "Se encontró en el cajón", lotCode: "LARGO", expiresOn: day(200) });
    expect(r.status).toBe(200);
    expect(await lotQty("LARGO")).toBe(8);
  });

  it("los movimientos son de solo inserción y la app no puede escribir saldos", async () => {
    await expect(env.db.adminPool.query("UPDATE inv_movements SET qty = 1 WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM inv_movements WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, (c) => c.query("UPDATE inv_lots SET qty_on_hand = 999 WHERE item_id = $1", [id])))
      .rejects.toThrow(/permission denied/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, (c) => c.query("UPDATE inv_stock SET qty_on_hand = 999 WHERE item_id = $1", [id])))
      .rejects.toThrow(/permission denied/);
    // Un lote nuevo nace en cero aunque se intente otra cosa
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, (c) =>
      c.query("INSERT INTO inv_lots (clinic_id, item_id, branch_id, lot_code, expires_on, qty_on_hand) VALUES ($1,$2,$3,'X',$4,50)", [K.clinicId, id, B0(), day(10)])))
      .rejects.toThrow(/permission denied/);
  });
});

describe("transferencia en dos pasos (en tránsito → recibida)", () => {
  let id: string, tid: string;
  it("al enviar sale del origen y queda en tránsito; el destino aún no la tiene", async () => {
    id = await item({ name: "Resina A2", useUnit: "jeringa", purchaseUnit: "jeringa", purchaseFactor: 1, tracksLots: true });
    await receive(asstA, B0(), id, 6, { lotCode: "R-1", expiresOn: day(300), unitPriceCents: 12000 });
    expect((await asstA.post("/api/inventory/transfers", { fromBranchId: B0(), toBranchId: B0(), lines: [{ itemId: id, qty: 1 }] })).status).toBe(400);
    const big = await asstA.post("/api/inventory/transfers", { fromBranchId: B0(), toBranchId: B1(), lines: [{ itemId: id, qty: 60 }] });
    expect(big.status).toBe(409);
    expect(big.body.error.details[0].path).toBe("lines.0.qty");
    const r = await asstA.post("/api/inventory/transfers", { fromBranchId: B0(), toBranchId: B1(), lines: [{ itemId: id, qty: 5 }], note: "Para la semana" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    tid = r.body.id;
    expect(await stockOf(id, B0())).toBe(1);
    expect(await stockOf(id, B1())).toBe(0);
    const inbox = (await asstB.get(`/api/inventory/transfers?branchId=${B1()}&status=in_transit`)).body;
    expect(inbox.find((t: any) => t.id === tid).lines[0].qtySent).toBe(5);
    const st = (await asstB.get(`/api/inventory/stock?branchId=${B1()}`)).body.items.find((x: any) => x.id === id);
    expect(st.inTransit).toBe(5);
  });

  it("solo la sucursal destino la recibe; una diferencia exige explicación y queda registrada", async () => {
    const t = (await asstB.get(`/api/inventory/transfers?branchId=${B1()}`)).body.find((x: any) => x.id === tid);
    const lineId = t.lines[0].id;
    expect((await asstA.post(`/api/inventory/transfers/${tid}/receive`, { lines: [{ lineId, qtyReceived: 5 }] })).status).toBe(403);
    let r = await asstB.post(`/api/inventory/transfers/${tid}/receive`, { lines: [{ lineId, qtyReceived: 6 }] });
    expect(r.status).toBe(400);
    r = await asstB.post(`/api/inventory/transfers/${tid}/receive`, { lines: [{ lineId, qtyReceived: 4 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("lines.0.reason");
    r = await asstB.post(`/api/inventory/transfers/${tid}/receive`, { lines: [{ lineId, qtyReceived: 4, reason: "Una jeringa llegó rota" }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.differences).toBe(1);
    expect(await stockOf(id, B1())).toBe(4);
    const lot = (await env.db.adminPool.query("SELECT lot_code, expires_on, unit_cost FROM inv_lots WHERE item_id = $1 AND branch_id = $2", [id, B1()])).rows[0];
    expect(lot.lot_code).toBe("R-1");
    expect(lot.expires_on).toBe(day(300));
    expect(Number(lot.unit_cost)).toBe(12000); // el costo viaja con el lote
    expect((await asstB.post(`/api/inventory/transfers/${tid}/receive`, { lines: [{ lineId, qtyReceived: 4, reason: "otra vez" }] })).status).toBe(409);
    const tl = (await env.db.adminPool.query("SELECT qty_sent, qty_received, difference_reason FROM inv_transfer_lines WHERE transfer_id = $1", [tid])).rows[0];
    expect(tl).toEqual({ qty_sent: 5, qty_received: 4, difference_reason: "Una jeringa llegó rota" });
  });
});

describe("conteo físico con aprobación", () => {
  it("genera la hoja, propone ajustes por diferencia y solo la administración los aprueba", async () => {
    const a = await item({ name: "Gasas", purchaseFactor: 100 });
    const b = await item({ name: "Algodón", purchaseFactor: 100 });
    await receive(asstB, B1(), a, 30);
    await receive(asstB, B1(), b, 20);
    const r = await asstB.post("/api/inventory/counts", { branchId: B1() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await asstB.post("/api/inventory/counts", { branchId: B1() })).status).toBe(409); // una abierta por sucursal
    const sheet = (await asstB.get(`/api/inventory/counts/${r.body.id}`)).body;
    const la = sheet.lines.find((l: any) => l.itemId === a), lb = sheet.lines.find((l: any) => l.itemId === b);
    expect(la.expectedQty).toBe(30);
    // Un insumo sin lotes ni stock también aparece en la hoja (no queda oculto)
    expect(sheet.lines.some((l: any) => l.expectedQty === 0 && l.lotCode === null)).toBe(true);
    const up = await asstB.put(`/api/inventory/counts/${r.body.id}/lines`, { lines: [{ lineId: la.id, countedQty: 28 }, { lineId: lb.id, countedQty: 21 }] });
    expect(up.status).toBe(200);
    expect(up.body.summary.adjustments).toBe(2);
    expect(up.body.lines.find((l: any) => l.id === la.id).difference).toBe(-2);
    expect((await asstB.post(`/api/inventory/counts/${r.body.id}/approve`, {})).status).toBe(403);
    const ok = await admin.post(`/api/inventory/counts/${r.body.id}/approve`, { note: "Conteo mensual" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.adjustments).toBe(2);
    expect(await stockOf(a, B1())).toBe(28);
    expect(await stockOf(b, B1())).toBe(21);
    const mv = (await env.db.adminPool.query("SELECT kind, reason, qty FROM inv_movements WHERE count_id = $1 ORDER BY qty", [r.body.id])).rows;
    expect(mv).toEqual([{ kind: "adjustment", reason: "count", qty: -2 }, { kind: "adjustment", reason: "count", qty: 1 }]);
    // La hoja aprobada queda congelada
    expect((await asstB.put(`/api/inventory/counts/${r.body.id}/lines`, { lines: [{ lineId: la.id, countedQty: 1 }] })).status).toBe(409);
    await expect(env.db.adminPool.query("UPDATE inv_count_lines SET counted_qty = 1 WHERE id = $1", [la.id])).rejects.toThrow(/cerrada/);
  });
});

describe("orden de compra con recepción parcial y rechazo", () => {
  let supplier: string, gloves: string, po: string;
  it("borrador → enviada (requiere inventory.manage) → recibida en parte → recibida → cerrada", async () => {
    const s = await owner.post("/api/inventory/suppliers", { name: `Dental Andes ${sku()}`, contactName: "Juan Pérez", phone: "+59170000000", email: "ventas@ejemplo.test" });
    expect(s.status).toBe(200);
    supplier = s.body.id;
    expect((await asstA.post("/api/inventory/suppliers", { name: "No autorizado" })).status).toBe(403);
    gloves = await item({ name: "Guantes de látex S", useUnit: "par", purchaseUnit: "caja de 50 pares", purchaseFactor: 50, tracksLots: true, preferredSupplierId: supplier });
    const d = await asstA.post("/api/inventory/purchase-orders", { supplierId: supplier, branchId: B0(), expectedOn: day(5), lines: [{ itemId: gloves, qty: 4, unitPriceCents: 6000 }] });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    po = d.body.id;
    expect((await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, { lines: [] })).status).toBe(400);
    expect((await asstA.post(`/api/inventory/purchase-orders/${po}/send`, {})).status).toBe(403);
    const sent = await admin.post(`/api/inventory/purchase-orders/${po}/send`, {});
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("sent");
    expect(sent.body.totalCents).toBe(24000);
    const lineId = sent.body.lines[0].id;

    let r = await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, { lines: [{ lineId, qtyAccepted: 2, qtyRejected: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("lines.0.rejectReason");
    r = await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, { lines: [{ lineId, qtyAccepted: 2, qtyRejected: 1, rejectReason: "Caja abierta" }] });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("lines.0.lotCode");
    r = await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, { lines: [{ lineId, qtyAccepted: 5, lotCode: "G-77", expiresOn: day(500) }] });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("lines.0.qtyAccepted");
    r = await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, {
      documentRef: "F-1234", lines: [{ lineId, qtyAccepted: 2, qtyRejected: 1, rejectReason: "Caja abierta", lotCode: "G-77", expiresOn: day(500) }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe("partial");
    expect(r.body.lines[0]).toMatchObject({ qtyOrdered: 4, qtyAccepted: 2, qtyRejected: 1, qtyPending: 2 });
    expect(r.body.receipts).toHaveLength(1);
    expect(await stockOf(gloves, B0())).toBe(100); // 2 cajas × 50 pares
    const lot = (await env.db.adminPool.query("SELECT lot_code, unit_cost, supplier_id FROM inv_lots WHERE item_id = $1", [gloves])).rows[0];
    expect(lot).toMatchObject({ lot_code: "G-77", supplier_id: supplier });
    expect(Number(lot.unit_cost)).toBe(120); // 60 Bs / 50 pares = 1,20 Bs por par

    // Lo ya pedido se descuenta de la sugerencia de reposición
    await owner.put(`/api/inventory/items/${gloves}`, { name: "Guantes de látex S", useUnit: "par", purchaseUnit: "caja de 50 pares", purchaseFactor: 50, tracksLots: true, preferredSupplierId: supplier, mins: [{ branchId: B0(), minQty: 300 }] });
    const sug = (await asstA.get(`/api/inventory/reorder?branchId=${B0()}`)).body.find((x: any) => x.itemId === gloves);
    expect(sug.onOrder).toBe(100);
    expect(sug.suggestedPurchase).toBe(2); // 300 − 100 en stock − 100 pedidos = 100 pares → 2 cajas

    r = await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, { lines: [{ lineId, qtyAccepted: 2, lotCode: "G-78", expiresOn: day(520) }] });
    expect(r.body.status).toBe("received");
    expect(await stockOf(gloves, B0())).toBe(200);
    expect((await asstA.post(`/api/inventory/purchase-orders/${po}/close`, {})).status).toBe(403);
    const closed = await admin.post(`/api/inventory/purchase-orders/${po}/close`, {});
    expect(closed.body.status).toBe("closed");
    expect((await asstA.post(`/api/inventory/purchase-orders/${po}/receive`, { lines: [{ lineId, qtyAccepted: 1, lotCode: "G-79", expiresOn: day(520) }] })).status).toBe(409);
    const sup = (await asstA.get("/api/inventory/suppliers")).body.find((x: any) => x.id === supplier);
    expect(Number(sup.rejectedPct)).toBe(20); // 1 rechazada de 5 entregadas
    expect(Number(sup.onTimePct)).toBe(100);
  });

  it("la sugerencia usa el consumo promedio de los últimos 60 días", async () => {
    const id = await item({ name: "Baberos", useUnit: "unidad", purchaseUnit: "paquete de 10", purchaseFactor: 10, mins: [{ branchId: B0(), minQty: 20 }] });
    await receive(asstA, B0(), id, 70);
    expect((await asstA.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 60 })).status).toBe(200); // 60 en 60 días → 30 al mes
    const sug = (await asstA.get(`/api/inventory/reorder?branchId=${B0()}`)).body.find((x: any) => x.itemId === id);
    expect(sug.avgMonthly).toBe(30);
    expect(sug.suggestedPurchase).toBe(4); // 20 + 30 − 10 = 40 unidades → 4 paquetes
  });
});

describe("consumo estándar al realizar un tratamiento", () => {
  let patient: string, gloves: string, resin: string, prophy: string, ope: string;
  async function acceptedBudget(items: Record<string, unknown>[], branchId = B0()) {
    const r = await dentA.post("/api/budgets", { branchId, patientId: patient, dentistId: dent.id, items });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await owner.post(`/api/budgets/${r.body.id}/status`, { status: "presented" })).status).toBe(200);
    expect((await owner.post(`/api/budgets/${r.body.id}/status`, { status: "accepted" })).status).toBe(200);
    return (await owner.get(`/api/budgets/${r.body.id}`)).body;
  }
  beforeAll(async () => {
    patient = await createPatient(owner);
    gloves = await item({ name: "Guantes de examen", useUnit: "par", purchaseUnit: "caja de 50", purchaseFactor: 50, mins: [{ branchId: B0(), minQty: 10 }] });
    resin = await item({ name: "Resina compuesta", useUnit: "dosis", purchaseUnit: "caja de 20", purchaseFactor: 20 });
    prophy = await procedureId(env.db, K.clinicId, "PRE-01");
    ope = await procedureId(env.db, K.clinicId, "OPE-02");
    await receive(asstA, B0(), gloves, 12, { unitPriceCents: 100 });
  });

  it("solo inventory.manage define el consumo estándar; se valida y queda en la auditoría", async () => {
    expect((await asstA.put(`/api/procedures/${prophy}/materials`, { items: [] })).status).toBe(403);
    const dup = await owner.put(`/api/procedures/${prophy}/materials`, { items: [{ itemId: gloves, qty: 1, per: "treatment" }, { itemId: gloves, qty: 2, per: "treatment" }] });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details[0].path).toBe("items.1.itemId");
    expect((await owner.put(`/api/procedures/${prophy}/materials`, { items: [{ itemId: gloves, qty: 2, per: "treatment" }] })).status).toBe(200);
    expect((await owner.put(`/api/procedures/${ope}/materials`, { items: [{ itemId: gloves, qty: 1, per: "treatment" }, { itemId: resin, qty: 0.5, per: "surface" }] })).status).toBe(200);
    const list = (await dentA.get(`/api/procedures/${ope}/materials`)).body;
    expect(list.map((m: any) => m.perLabel).sort()).toEqual(["por superficie", "por tratamiento"]);
  });

  it("al marcar realizado descuenta en la sucursal y calcula el costo de materiales", async () => {
    const b = await acceptedBudget([{ procedureId: prophy }]);
    const r = await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {});
    expect(r.status).toBe(200);
    expect(await stockOf(gloves, B0())).toBe(10);
    const cost = await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, (c) => materialCostForTreatment(c, b.items[0].id));
    expect(cost.costCents).toBe(200); // 2 pares × 1 Bs el par
    const api = await owner.get(`/api/inventory/treatments/${b.items[0].id}/material-cost`);
    expect(api.body.costCents).toBe(200);
    expect((await asstA.get(`/api/inventory/treatments/${b.items[0].id}/material-cost`)).status).toBe(403);
  });

  it("si falta stock el tratamiento se realiza igual y queda un consumo pendiente (alerta)", async () => {
    const b = await acceptedBudget([{ procedureId: ope, tooth: 16, surfaces: ["O", "M", "D"] }]);
    const r = await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.chargeId).toBeTruthy();
    const it0 = (await env.db.adminPool.query("SELECT status FROM budget_items WHERE id = $1", [b.items[0].id])).rows[0];
    expect(it0.status).toBe("done");
    expect(await stockOf(gloves, B0())).toBe(9);
    const pend = (await env.db.adminPool.query("SELECT item_id, qty_missing FROM inv_pending_consumptions WHERE budget_item_id = $1", [b.items[0].id])).rows;
    expect(pend).toEqual([{ item_id: resin, qty_missing: 1.5 }]); // 0,5 × 3 superficies
    const al = (await asstA.get(`/api/inventory/alerts?branchId=${B0()}`)).body;
    expect(al.alerts.some((a: any) => a.type === "pending_consumption" && a.itemId === resin)).toBe(true);
    expect(al.alerts.some((a: any) => a.type === "below_min" && a.itemId === gloves)).toBe(true); // 9 < 10

    // Llega resina: se regulariza el pendiente
    await receive(asstA, B0(), resin, 5);
    const pid = al.alerts.find((a: any) => a.type === "pending_consumption" && a.itemId === resin).pendingId;
    expect((await asstA.post(`/api/inventory/pending/${pid}/resolve`, { action: "dismiss", note: "no" })).status).toBe(403);
    expect((await asstA.post(`/api/inventory/pending/${pid}/resolve`, { action: "consume" })).status).toBe(200);
    expect(await stockOf(resin, B0())).toBe(3.5);
    expect((await asstA.post(`/api/inventory/pending/${pid}/resolve`, { action: "consume" })).status).toBe(409);
  });

  it("anular el cargo y volver a realizar no descuenta dos veces", async () => {
    const b = await acceptedBudget([{ procedureId: prophy }]);
    await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {});
    const after1 = await stockOf(gloves, B0());
    const ch = (await env.db.adminPool.query("SELECT id FROM charges WHERE budget_item_id = $1", [b.items[0].id])).rows[0].id;
    expect((await owner.post(`/api/charges/${ch}/void`, { reason: "Error de carga" })).status).toBe(200);
    expect((await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {})).status).toBe(200);
    expect(await stockOf(gloves, B0())).toBe(after1);
  });

  it("con sesiones (presupuesto v2) descuenta al completar la última sesión, en la sucursal de la cita", async () => {
    const crown = await procedureId(env.db, K.clinicId, "PRO-01");
    expect((await owner.put(`/api/procedures/${crown}/sessions`, { sessions: [{ name: "Medidas", amountCents: 100000 }, { name: "Colocación", amountCents: 150000 }] })).status).toBe(200);
    expect((await owner.put(`/api/procedures/${crown}/materials`, { items: [{ itemId: gloves, qty: 1, per: "tooth" }] })).status).toBe(200);
    await receive(asstB, B1(), gloves, 5);
    const b = await acceptedBudget([{ procedureId: crown, tooth: 26 }]);
    const ses = b.items[0].sessions;
    const g0 = await stockOf(gloves, B0()), g1 = await stockOf(gloves, B1());
    expect((await dentA.post(`/api/budget-item-sessions/${ses[0].id}/perform`, {})).status).toBe(200);
    expect(await stockOf(gloves, B0())).toBe(g0);
    // Cita de la última sesión en la sucursal 2
    const appt = (await env.db.adminPool.query(
      `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status) VALUES ($1,$2,$3,$4, now() - interval '3 hours', now() - interval '2 hours', 'completed') RETURNING id`,
      [K.clinicId, B1(), dent.id, patient])).rows[0].id;
    expect((await dentA.post(`/api/budget-item-sessions/${ses[1].id}/perform`, { appointmentId: appt })).status).toBe(200);
    expect(await stockOf(gloves, B0())).toBe(g0);
    expect(await stockOf(gloves, B1())).toBe(g1 - 1);
  });
});

describe("alertas por sucursal (solo su personal; consolidadas para el dueño)", () => {
  it("bajo mínimo, por vencer 30/60/90 y vencido", async () => {
    const id = await item({ name: "Hilo retractor", tracksLots: true, purchaseFactor: 1, purchaseUnit: "frasco", useUnit: "frasco", mins: [{ branchId: B1(), minQty: 10 }] });
    await receive(asstB, B1(), id, 1, { lotCode: "A", expiresOn: day(20) });
    await receive(asstB, B1(), id, 1, { lotCode: "B", expiresOn: day(50) });
    await receive(asstB, B1(), id, 1, { lotCode: "C", expiresOn: day(80) });
    await receive(asstB, B1(), id, 1, { lotCode: "D", expiresOn: day(0) });
    const mine = (await asstB.get("/api/inventory/alerts")).body.alerts.filter((a: any) => a.itemId === id);
    expect(mine.filter((a: any) => a.type === "expiring").map((a: any) => a.bucket).sort()).toEqual([30, 30, 60, 90]);
    expect(mine.some((a: any) => a.type === "below_min" && a.qty === 4 && a.minQty === 10)).toBe(true);
    await env.db.adminPool.query("INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost) SELECT clinic_id, item_id, branch_id, id, 'purchase', 1, 0 FROM inv_lots WHERE item_id = $1 AND lot_code = 'A'", [id]);
    await env.db.adminPool.query(
      "INSERT INTO inv_stock (clinic_id, item_id, branch_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [K.clinicId, id, B1()]);
    const ex = (await env.db.adminPool.query("INSERT INTO inv_lots (clinic_id, item_id, branch_id, lot_code, expires_on) VALUES ($1,$2,$3,'Z',$4) RETURNING id", [K.clinicId, id, B1(), day(-1)])).rows[0].id;
    await env.db.adminPool.query("INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost) VALUES ($1,$2,$3,$4,'purchase',2,0)", [K.clinicId, id, B1(), ex]);
    const all = (await owner.get("/api/inventory/alerts")).body;
    expect(all.alerts.some((a: any) => a.type === "expired" && a.lotCode === "Z")).toBe(true);
    expect(all.summary.expired).toBeGreaterThanOrEqual(1);
    // La asistente de la sucursal 1 no ve las alertas de la sucursal 2 ni puede pedirlas
    const other = (await asstA.get("/api/inventory/alerts")).body.alerts;
    expect(other.some((a: any) => a.branchId === B1())).toBe(false);
    expect((await asstA.get(`/api/inventory/alerts?branchId=${B1()}`)).status).toBe(403);
    // El dueño las ve consolidadas, de ambas sucursales
    const branchesSeen = new Set(all.alerts.map((a: any) => a.branchId));
    expect(branchesSeen.has(B0()) && branchesSeen.has(B1())).toBe(true);
  });
});

describe("permisos por rol", () => {
  it("lectura, escritura y administración según el rol; limpieza no entra", async () => {
    const id = await item({ name: "Vasos descartables", purchaseFactor: 50 });
    await receive(owner, B0(), id, 10);
    expect((await support.get(`/api/inventory/stock?branchId=${B0()}`)).status).toBe(403);
    expect((await support.get("/api/inventory/alerts")).status).toBe(403);
    expect((await rec.get(`/api/inventory/stock?branchId=${B0()}`)).status).toBe(200);
    expect((await rec.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 1 })).status).toBe(403);
    expect((await acct.get("/api/inventory/valuation")).status).toBe(200);
    expect((await acct.post("/api/inventory/adjust", { branchId: B0(), itemId: id, direction: "out", qty: 1, reason: "breakage" })).status).toBe(403);
    expect((await dentA.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 1 })).status).toBe(200);
    expect((await asstA.post("/api/inventory/items", { sku: sku(), name: "No", useUnit: "u", purchaseUnit: "u", purchaseFactor: 1 })).status).toBe(403);
    expect((await asstA.post("/api/inventory/consume", { branchId: B1(), itemId: id, qty: 1 })).status).toBe(403); // otra sucursal
    expect((await admin.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 1 })).status).toBe(200);
  });
});

describe("aislamiento entre clínicas", () => {
  it("ni por API ni por SQL se ven o tocan datos de otra clínica", async () => {
    const id = await item({ name: "Secreto clínica 1", purchaseFactor: 1 });
    await receive(owner, B0(), id, 3);
    expect((await owner2.get("/api/inventory/items")).body.some((x: any) => x.id === id)).toBe(false);
    expect((await owner2.get("/api/inventory/stock")).body.items.some((x: any) => x.id === id)).toBe(false);
    expect((await owner2.get("/api/inventory/lots")).body.some((x: any) => x.itemId === id)).toBe(false);
    expect((await owner2.get("/api/inventory/movements")).body.some((x: any) => x.itemId === id)).toBe(false);
    expect((await owner2.post("/api/inventory/consume", { branchId: K2.branches[0], itemId: id, qty: 1 })).status).toBe(404);
    expect((await owner2.post("/api/inventory/consume", { branchId: B0(), itemId: id, qty: 1 })).status).toBe(404);
    const po = (await env.db.adminPool.query("SELECT id FROM inv_purchase_orders WHERE clinic_id = $1 LIMIT 1", [K.clinicId])).rows[0].id;
    expect((await owner2.get(`/api/inventory/purchase-orders/${po}`)).status).toBe(404);
    const tables = ["inv_suppliers", "inv_items", "inv_stock", "inv_lots", "inv_movements", "inv_transfers", "inv_transfer_lines", "inv_counts", "inv_count_lines",
      "inv_purchase_orders", "inv_po_lines", "inv_po_receipts", "inv_po_receipt_lines", "inv_procedure_materials", "inv_treatment_consumptions", "inv_pending_consumptions"];
    await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: K2.ownerId }, async (c) => {
      for (const t of tables) {
        const n = (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE clinic_id = $1`, [K.clinicId])).rows[0].n;
        expect(n, t).toBe(0);
      }
    });
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: K2.ownerId }, (c) =>
      c.query("INSERT INTO inv_suppliers (clinic_id, name) VALUES ($1, 'Intruso')", [K.clinicId]))).rejects.toThrow(/row-level security/);
    // Una fila de la clínica 2 no puede apuntar a un insumo de la clínica 1 (FK compuesta)
    await expect(env.db.adminPool.query("INSERT INTO inv_stock (clinic_id, item_id, branch_id) VALUES ($1,$2,$3)", [K2.clinicId, id, K2.branches[0]])).rejects.toThrow(/foreign key/);
  });
});

describe("invariante IN-01: stock = suma de lotes = suma de movimientos (propiedad)", () => {
  it("se mantiene tras cientos de movimientos aleatorios (compras, consumos, ajustes, transferencias y conteos)", async () => {
    let seed = 424242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
    const qty = () => Math.round((0.5 + rnd() * 8) * 1000) / 1000;
    const items = [
      await item({ name: "Prop lotes 1", tracksLots: true, purchaseFactor: 10 }),
      await item({ name: "Prop lotes 2", tracksLots: true, purchaseFactor: 1 }),
      await item({ name: "Prop sin lotes", purchaseFactor: 100 }),
    ];
    const tracked = new Set(items.slice(0, 2));
    const branches = [B0(), B1()];
    const lotsCodes = ["L1", "L2", "L3"];
    const expiry: Record<string, string> = { L1: day(30), L2: day(90), L3: day(400) };
    const ops: Record<string, number> = {};
    let rejected = 0;
    for (let k = 0; k < 220; k++) {
      const it = pick(items), br = pick(branches);
      const op = pick(["receipt", "receipt", "consume", "consume", "consumeLot", "adjIn", "adjOut", "transfer", "receiveTransfer"]);
      let r: { status: number; body: any } | null = null;
      if (op === "receipt") {
        const code = pick(lotsCodes);
        r = await owner.post("/api/inventory/receipts", { branchId: br, itemId: it, qty: qty(), unit: rnd() < 0.5 ? "use" : "purchase", unitPriceCents: Math.floor(rnd() * 5000),
          ...(tracked.has(it) ? { lotCode: code, expiresOn: expiry[code] } : {}) });
      } else if (op === "consume") {
        r = await owner.post("/api/inventory/consume", { branchId: br, itemId: it, qty: qty() });
      } else if (op === "consumeLot" || op === "adjOut") {
        const lots = (await owner.get(`/api/inventory/lots?branchId=${br}&itemId=${it}`)).body;
        if (!lots.length) continue;
        const l = pick(lots);
        r = op === "consumeLot"
          ? await owner.post("/api/inventory/consume", { branchId: br, itemId: it, qty: qty(), lotId: l.id })
          : await owner.post("/api/inventory/adjust", { branchId: br, itemId: it, direction: "out", qty: qty(), reason: pick(["count", "breakage", "expiry"]), lotId: l.id });
      } else if (op === "adjIn") {
        const code = pick(lotsCodes);
        r = await owner.post("/api/inventory/adjust", { branchId: br, itemId: it, direction: "in", qty: qty(), reason: "count", ...(tracked.has(it) ? { lotCode: code, expiresOn: expiry[code] } : {}) });
      } else if (op === "transfer") {
        r = await owner.post("/api/inventory/transfers", { fromBranchId: br, toBranchId: branches.find((b) => b !== br), lines: [{ itemId: it, qty: qty() }] });
      } else {
        const pending = (await owner.get("/api/inventory/transfers?status=in_transit")).body;
        if (!pending.length) continue;
        const t = pick(pending);
        r = await owner.post(`/api/inventory/transfers/${t.id}/receive`, {
          lines: t.lines.map((l: any) => { const short = rnd() < 0.3; return { lineId: l.id, qtyReceived: short ? Math.floor(l.qtySent * 500) / 1000 : l.qtySent, reason: short ? "Diferencia de prueba" : null }; }),
        });
      }
      if (!r) continue;
      expect([200, 409], `${op}: ${JSON.stringify(r.body)}`).toContain(r.status);
      if (r.status === 409) { rejected++; expect(r.body.error.code).toBe("insufficient_stock"); }
      ops[op] = (ops[op] ?? 0) + (r.status === 200 ? 1 : 0);
      if (k % 20 === 0) expect(await invariantViolations(K.clinicId)).toEqual([]);
    }
    // Un conteo con diferencias aprobado en cada sucursal
    for (const br of branches) {
      const open = (await owner.get(`/api/inventory/counts?branchId=${br}`)).body.find((x: any) => x.status === "open");
      if (open) await owner.post(`/api/inventory/counts/${open.id}/cancel`, { reason: "Limpieza de prueba" });
      const cnt = await owner.post("/api/inventory/counts", { branchId: br });
      const sheet = (await owner.get(`/api/inventory/counts/${cnt.body.id}`)).body;
      await owner.put(`/api/inventory/counts/${cnt.body.id}/lines`, { lines: sheet.lines.map((l: any) => ({ lineId: l.id, countedQty: Math.max(0, Math.round((l.expectedQty + (rnd() - 0.5) * 4) * 1000) / 1000) })) });
      expect((await owner.post(`/api/inventory/counts/${cnt.body.id}/approve`, {})).status).toBe(200);
    }
    expect(await invariantViolations(K.clinicId)).toEqual([]);
    // Hubo de todo, incluidos rechazos por falta de stock (que no dejaron rastro)
    for (const op of ["receipt", "consume", "consumeLot", "adjIn", "adjOut", "transfer", "receiveTransfer"]) expect(ops[op] ?? 0, op).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    const neg = await env.db.adminPool.query("SELECT count(*)::int AS n FROM inv_stock WHERE clinic_id = $1 AND qty_on_hand < 0", [K.clinicId]);
    expect(neg.rows[0].n).toBe(0);
  });
});

describe("auditoría (IN-09) y utilidades", () => {
  it("todo movimiento de inventario y compras queda en la auditoría", async () => {
    const actions = (await env.db.adminPool.query("SELECT DISTINCT action FROM audit_log WHERE clinic_id = $1 AND action LIKE 'inventory.%'", [K.clinicId])).rows.map((r) => r.action);
    for (const a of ["inventory.item_created", "inventory.receipt", "inventory.consumed", "inventory.adjusted", "inventory.transfer_sent", "inventory.transfer_received",
      "inventory.count_created", "inventory.count_approved", "inventory.po_created", "inventory.po_sent", "inventory.po_received", "inventory.po_closed",
      "inventory.materials_updated", "inventory.treatment_consumed", "inventory.pending_consumption", "inventory.pending_resolved", "inventory.supplier_created"]) {
      expect(actions, a).toContain(a);
    }
  });

  it("cantidad requerida por tratamiento, pieza o superficie", () => {
    expect(requiredMilli(2, "treatment", { quantity: 4, surfaces: [] })).toBe(2000);
    expect(requiredMilli(1, "tooth", { quantity: 4, surfaces: [] })).toBe(4000);
    expect(requiredMilli(0.5, "surface", { quantity: 1, surfaces: ["O", "M", "D"] })).toBe(1500);
    expect(requiredMilli(0.5, "surface", { quantity: 1, surfaces: [] })).toBe(500);
  });
});
