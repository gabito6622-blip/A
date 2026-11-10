// Datos demo (100 % ficticios) de inventario y compras: proveedores, catálogo, lotes por sucursal,
// historial de consumo de 60 días, alertas, consumo estándar, una orden enviada y una transferencia en tránsito.
// Todos los saldos se crean con movimientos (el trigger aplica la invariante también aquí).
import type pg from "pg";
import { DateTime } from "luxon";

export async function seedInventoryDemo(pool: pg.Pool, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const zone = "America/La_Paz";
  const today = DateTime.now().setZone(zone).startOf("day");
  const d = (n: number) => today.plus({ days: n }).toISODate()!;
  const branches: Record<string, string> = Object.fromEntries((await q("SELECT code, id FROM branches WHERE clinic_id = $1", [clinicId])).rows.map((r) => [r.code as string, r.id as string]));
  const user = async (email: string) => (await q("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const manager = await user("gerente@demo.local");
  const assistant = await user("asistente@demo.local");
  const next = async (name: string) => Number((await q(
    `INSERT INTO counters (clinic_id, name, value) VALUES ($1,$2,1) ON CONFLICT (clinic_id, name) DO UPDATE SET value = counters.value + 1 RETURNING value`, [clinicId, name])).rows[0].value);

  const sup = async (name: string, contact: string, phone: string, email: string, terms: string) => (await q(
    `INSERT INTO inv_suppliers (clinic_id, name, tax_id, contact_name, phone, email, address, payment_terms)
     VALUES ($1,$2,'0000000000',$3,$4,$5,'Dirección ficticia',$6) RETURNING id`, [clinicId, name, contact, phone, email, terms])).rows[0].id as string;
  const illimani = await sup("Distribuidora Dental Illimani (ficticia)", "Rocío Condori", "+59170000001", "ventas@illimani.example", "Crédito 30 días");
  const oriente = await sup("Insumos Médicos del Oriente (ficticia)", "Carlos Añez", "+59170000002", "pedidos@oriente.example", "Contado contra entrega");

  // sku, nombre, categoría, unidad de uso, unidad de compra, factor, lotes, mínimo por sucursal, precio por unidad de compra (centavos), proveedor
  const defs: [string, string, string, string, string, number, boolean, number, number, string][] = [
    ["GUA-NIT-M", "Guantes de nitrilo talla M", "Protección", "par", "caja de 50 pares", 50, false, 40, 9000, illimani],
    ["BAB-DES", "Baberos descartables", "Protección", "unidad", "paquete de 125", 125, false, 60, 7500, oriente],
    ["EYE-SAL", "Eyectores de saliva", "Descartables", "unidad", "bolsa de 100", 100, false, 50, 4500, oriente],
    ["GAS-EST", "Gasas estériles 5×5", "Descartables", "unidad", "paquete de 100", 100, false, 100, 3800, oriente],
    ["ANE-LID", "Lidocaína 2 % con epinefrina", "Anestesia", "cartucho", "caja de 50 cartuchos", 50, true, 30, 32000, illimani],
    ["RES-A2", "Resina compuesta A2", "Operatoria", "jeringa", "jeringa de 4 g", 1, true, 3, 18000, illimani],
    ["ADH-UNI", "Adhesivo universal", "Operatoria", "ml", "frasco de 5 ml", 5, true, 5, 42000, illimani],
    ["PAS-PRO", "Pasta profiláctica", "Prevención", "dosis", "pote de 50 dosis", 50, true, 50, 6500, oriente],
    ["FLU-BAR", "Barniz de flúor", "Prevención", "dosis", "caja de 35 dosis", 35, true, 10, 38000, illimani],
    ["SUT-30", "Sutura de seda 3-0", "Cirugía", "sobre", "caja de 12 sobres", 12, true, 6, 21000, illimani],
  ];
  const items: Record<string, { id: string; factor: number; lots: boolean; min: number; price: number }> = {};
  for (const [sku, name, cat, uu, pu, f, lots, min, price, sp] of defs) {
    const id = (await q(
      `INSERT INTO inv_items (clinic_id, sku, name, category, use_unit, purchase_unit, purchase_factor, tracks_lots, preferred_supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [clinicId, sku, name, cat, uu, pu, f, lots, sp])).rows[0].id as string;
    items[sku] = { id, factor: f, lots, min, price };
    for (const b of Object.values(branches)) {
      await q("INSERT INTO inv_stock (clinic_id, item_id, branch_id, min_qty) VALUES ($1,$2,$3,$4)", [clinicId, id, b, min]);
    }
  }

  async function lot(sku: string, branch: string, code: string | null, expires: string | null, supplier: string | null) {
    return (await q(
      `INSERT INTO inv_lots (clinic_id, item_id, branch_id, lot_code, expires_on, supplier_id) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (item_id, branch_id, coalesce(lower(lot_code), '')) DO UPDATE SET lot_code = EXCLUDED.lot_code RETURNING id`,
      [clinicId, items[sku]!.id, branch, code, expires, supplier])).rows[0].id as string;
  }
  async function move(sku: string, branch: string, lotId: string, kind: string, qty: number, daysAgo: number, extra: { cost?: number; reason?: string; note?: string; by?: string } = {}) {
    const at = today.minus({ days: daysAgo }).plus({ hours: 9 + (Math.abs(qty * 7) % 9) }).toJSDate();
    await q(
      `INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost, reason, note, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [clinicId, items[sku]!.id, branch, lotId, kind, qty, extra.cost ?? (kind === "purchase" ? items[sku]!.price / items[sku]!.factor : null),
        extra.reason ?? null, extra.note ?? null, extra.by ?? manager, at]);
  }

  // Compras iniciales hace 70 días y consumo diario de los últimos 60 (determinista)
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const plan: Record<string, number> = { "GUA-NIT-M": 3, "BAB-DES": 1.5, "EYE-SAL": 1.5, "GAS-EST": 2, "ANE-LID": 1, "RES-A2": 0.08, "ADH-UNI": 0.12, "PAS-PRO": 0.8, "FLU-BAR": 0.3, "SUT-30": 0.15 };
  for (const [bcode, b] of Object.entries(branches)) {
    for (const [sku, it] of Object.entries(items)) {
      if (bcode === "LPZ" && sku === "PAS-PRO") continue; // sin stock: llega con la orden de compra demo
      const code = it.lots ? `${sku.slice(0, 3)}-${bcode}-01` : null;
      const exp = it.lots ? d(sku === "ANE-LID" && bcode === "LPZ" ? 25 : sku === "FLU-BAR" ? 55 : 240) : null;
      const l = await lot(sku, b, code, exp, null);
      const daily = plan[sku]!;
      const used = Math.round(daily * 60 * 1000) / 1000;
      const bought = Math.ceil((used + it.min * (0.6 + rnd() * 1.6)) / it.factor) * it.factor;
      await move(sku, b, l, "purchase", bought, 70);
      let total = 0;
      for (let k = 60; k >= 1 && total < used; k -= 3) {
        const qty = Math.min(used - total, Math.max(1, Math.round(daily * 3 * (0.6 + rnd() * 0.8))));
        if (qty <= 0) break;
        await move(sku, b, l, "consumption", -qty, k, { by: assistant });
        total += qty;
      }
    }
  }
  // Un lote vencido en Sur (para la alerta) y una rotura registrada
  const old = await lot("ADH-UNI", branches.SUR!, "ADH-SUR-00", d(-5), illimani);
  await move("ADH-UNI", branches.SUR!, old, "purchase", 5, 200, { cost: 8400 });
  const gloveLpz = await lot("GUA-NIT-M", branches.LPZ!, null, null, null);
  await move("GUA-NIT-M", branches.LPZ!, gloveLpz, "adjustment", -2, 4, { reason: "breakage", note: "Caja dañada por humedad" });

  // Consumo estándar por prestación (pensado para que lo revise la clínica)
  const proc = async (code: string) => (await q("SELECT id FROM procedures WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0]?.id as string | undefined;
  const mats: [string, [string, number, string][]][] = [
    ["PRE-01", [["GUA-NIT-M", 1, "treatment"], ["BAB-DES", 1, "treatment"], ["EYE-SAL", 1, "treatment"], ["PAS-PRO", 1, "treatment"]]],
    ["PRE-02", [["GUA-NIT-M", 1, "treatment"], ["FLU-BAR", 1, "treatment"]]],
    ["OPE-01", [["GUA-NIT-M", 1, "treatment"], ["ANE-LID", 1, "treatment"], ["RES-A2", 0.1, "surface"], ["ADH-UNI", 0.05, "tooth"]]],
    ["OPE-02", [["GUA-NIT-M", 1, "treatment"], ["ANE-LID", 1, "treatment"], ["RES-A2", 0.1, "surface"], ["ADH-UNI", 0.05, "tooth"]]],
    ["CIR-01", [["GUA-NIT-M", 2, "treatment"], ["ANE-LID", 2, "tooth"], ["GAS-EST", 4, "tooth"], ["SUT-30", 1, "tooth"]]],
    ["END-01", [["GUA-NIT-M", 2, "treatment"], ["ANE-LID", 2, "treatment"]]],
  ];
  for (const [code, list] of mats) {
    const pid = await proc(code);
    if (!pid) continue;
    for (const [sku, qty, per] of list) {
      await q("INSERT INTO inv_procedure_materials (clinic_id, procedure_id, item_id, qty, per) VALUES ($1,$2,$3,$4,$5)", [clinicId, pid, items[sku]!.id, qty, per]);
    }
  }

  // Orden de compra enviada (La Paz Centro), pendiente de recibir: pasta profiláctica y lidocaína
  const po = (await q(
    `INSERT INTO inv_purchase_orders (clinic_id, number, supplier_id, branch_id, status, expected_on, notes, created_by, sent_by, sent_at)
     VALUES ($1,$2,$3,$4,'sent',$5,'Entregar en recepción, de 9 a 12',$6,$6, now() - interval '2 days') RETURNING id`,
    [clinicId, await next("purchase_order"), oriente, branches.LPZ, d(1), manager])).rows[0].id;
  await q("INSERT INTO inv_po_lines (clinic_id, po_id, item_id, qty_ordered, unit_price_cents, position) VALUES ($1,$2,$3,1,6500,0)", [clinicId, po, items["PAS-PRO"]!.id]);
  // Borrador para Santa Cruz
  const draft = (await q(
    `INSERT INTO inv_purchase_orders (clinic_id, number, supplier_id, branch_id, status, expected_on, created_by) VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING id`,
    [clinicId, await next("purchase_order"), illimani, branches.SCZ, d(7), manager])).rows[0].id;
  await q("INSERT INTO inv_po_lines (clinic_id, po_id, item_id, qty_ordered, unit_price_cents, position) VALUES ($1,$2,$3,2,32000,0), ($1,$2,$4,3,18000,1)",
    [clinicId, draft, items["ANE-LID"]!.id, items["RES-A2"]!.id]);

  // Transferencia en tránsito: Sur → La Paz Centro (20 pares de guantes)
  const tr = (await q(
    "INSERT INTO inv_transfers (clinic_id, number, from_branch_id, to_branch_id, note, sent_by, sent_at) VALUES ($1,$2,$3,$4,'Préstamo hasta que llegue el pedido',$5, now() - interval '3 hours') RETURNING id",
    [clinicId, await next("inv_transfer"), branches.SUR, branches.LPZ, manager])).rows[0].id;
  const surGloves = await lot("GUA-NIT-M", branches.SUR!, null, null, null);
  await q(
    `INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost, transfer_id, created_by, created_at)
     VALUES ($1,$2,$3,$4,'transfer_out',-20,180,$5,$6, now() - interval '3 hours')`, [clinicId, items["GUA-NIT-M"]!.id, branches.SUR, surGloves, tr, manager]);
  await q("INSERT INTO inv_transfer_lines (clinic_id, transfer_id, item_id, from_lot_id, qty_sent) VALUES ($1,$2,$3,$4,20)", [clinicId, tr, items["GUA-NIT-M"]!.id, surGloves]);

  // Paciente ficticio con una profilaxis aceptada y pendiente en La Paz Centro (consume pasta profiláctica)
  const vargas = await user("dra.vargas@demo.local");
  const rec = await next("patient");
  const patient = (await q(
    `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, birth_date, sex, phone, city, search_text, preferred_branch_id)
     VALUES ($1,$2,'Inés','Demo Inventario','SIN','1988-03-12','F','+59170009876','La Paz','ines demo inventario 59170009876', $3) RETURNING id`,
    [clinicId, rec, branches.LPZ])).rows[0].id;
  const prophy = (await q("SELECT id, name, price_cents FROM procedures WHERE clinic_id = $1 AND code = 'PRE-01'", [clinicId])).rows[0];
  const bud = (await q(
    `INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status, created_by, presented_at, decided_at)
     VALUES ($1,$2,$3,$4,$5,'accepted',$5, now() - interval '1 day', now() - interval '1 day') RETURNING id`,
    [clinicId, await next("budget"), branches.LPZ, patient, vargas])).rows[0].id;
  await q("INSERT INTO budget_items (clinic_id, budget_id, procedure_id, description, unit_price_cents) VALUES ($1,$2,$3,$4,$5)",
    [clinicId, bud, prophy.id, prophy.name, prophy.price_cents]);

  return { items: defs.length, suppliers: 2 };
}
