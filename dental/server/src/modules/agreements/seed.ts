// Datos demo (100 % ficticios) de convenios y conciliación: 3 convenios con empresas inventadas,
// pacientes afiliados, un presupuesto con precios de convenio y cargos con la parte de la empresa
// (la calcula el trigger de la base), un pago de la empresa por verificar, pagos QR por verificar
// que coinciden con el extracto de ejemplo (docs/extracto-ejemplo.csv) y una solicitud
// «pendiente de facturar».
import type pg from "pg";
import { DateTime } from "luxon";

export async function seedAgreementsDemo(pool: pg.Pool, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const zone = "America/La_Paz";
  const today = DateTime.now().setZone(zone).startOf("day");
  const d = (n: number) => today.plus({ days: n }).toISODate()!;
  const user = async (email: string) => (await q("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const next = async (name: string) => Number((await q(
    `INSERT INTO counters (clinic_id, name, value) VALUES ($1,$2,1) ON CONFLICT (clinic_id, name) DO UPDATE SET value = counters.value + 1 RETURNING value`, [clinicId, name])).rows[0].value);
  const proc = async (code: string) => (await q("SELECT id, name, price_cents, category FROM procedures WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0];
  const owner = await user("propietaria@demo.local");
  const manager = await user("gerente@demo.local");
  const recep = await user("recepcion.lpz@demo.local");
  const mendoza = await user("dr.mendoza@demo.local");
  const LPZ = (await q("SELECT id FROM branches WHERE clinic_id = $1 AND code = 'LPZ'", [clinicId])).rows[0].id as string;

  async function agreement(o: { name: string; kind: string; taxId: string | null; billing: string | null; contact: string; share: number; cap: number | null; disc: number; notes: string;
    rules: { code?: string; category?: string; price?: number; pct?: number }[] }) {
    const id = (await q(
      `INSERT INTO agreements (clinic_id, name, kind, tax_id, billing_name, contact_name, contact_phone, contact_email, valid_from, valid_to,
          default_discount_percent, company_share_percent, company_cap_cents, payment_terms_days, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'+59170009999',$7,$8,$9,$10,$11,$12,30,$13,$14) RETURNING id`,
      [clinicId, o.name, o.kind, o.taxId, o.billing, o.contact, `rrhh@${o.kind}.example`, d(-200), d(300), o.disc, o.share, o.cap, o.notes, owner])).rows[0].id as string;
    for (const r of o.rules) {
      const pid = r.code ? (await proc(r.code)).id : null;
      await q("INSERT INTO agreement_rules (clinic_id, agreement_id, procedure_id, category, price_cents, discount_percent) VALUES ($1,$2,$3,$4,$5,$6)",
        [clinicId, id, pid, r.category ?? null, r.price ?? null, r.pct ?? null]);
    }
    return id;
  }
  const mina = await agreement({
    name: "Cooperativa Minera Illimani (ficticia)", kind: "company", taxId: "1029384756", billing: "Cooperativa Minera Illimani Ltda. (ficticia)", contact: "Lic. Teresa Choque (RR. HH.)",
    share: 60, cap: 150000, disc: 0, notes: "La empresa paga el 60 % hasta Bs 1.500 por afiliado al año. Datos inventados para la demostración.",
    rules: [{ code: "OPE-01", price: 20000 }, { category: "Prevención", pct: 20 }, { category: "Endodoncia", pct: 10 }],
  });
  const colegio = await agreement({
    name: "Colegio San Andrés Demo (ficticio)", kind: "school", taxId: null, billing: null, contact: "Dirección del colegio",
    share: 0, cap: null, disc: 15, notes: "Solo descuento del 15 % para alumnos y familias; paga el paciente.", rules: [{ category: "Prevención", pct: 25 }],
  });
  const choferes = await agreement({
    name: "Asociación de Choferes 16 de Julio (ficticia)", kind: "association", taxId: "3344556677", billing: "Asociación de Choferes 16 de Julio (ficticia)", contact: "Sr. Mario Apaza",
    share: 50, cap: null, disc: 5, notes: "La asociación paga la mitad de cada atención.", rules: [{ code: "CIR-01", price: 18000 }],
  });

  // Afiliados: pacientes ficticios ya creados por la semilla principal.
  const pts = (await q("SELECT id, first_name, last_name, record_number FROM patients WHERE clinic_id = $1 ORDER BY record_number LIMIT 7", [clinicId])).rows;
  const enroll = async (p: { id: string }, ag: string, member: string, holder: string | null = null) => (await q(
    `INSERT INTO patient_agreements (clinic_id, patient_id, agreement_id, member_number, holder_name, valid_from, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [clinicId, p.id, ag, member, holder, d(-120), recep])).rows[0].id as string;
  const paMina = await enroll(pts[0], mina, "CMI-0001");
  await enroll(pts[1], mina, "CMI-0002");
  await enroll(pts[2], mina, "CMI-0017", `${pts[1].first_name} ${pts[1].last_name} (titular)`);
  await enroll(pts[3], colegio, "CSA-2026-031");
  await enroll(pts[4], choferes, "ACH-118");
  await enroll(pts[5], choferes, "ACH-204");

  // Presupuesto aceptado con precios del convenio minero (copiados en las líneas) y dos tratamientos realizados.
  const number = await next("budget");
  const budget = (await q(
    `INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status, installments, notes, created_by, created_at, presented_at, decided_at)
     VALUES ($1,$2,$3,$4,$5,'accepted',1,'Precios del convenio Cooperativa Minera Illimani (ficticia).',$5, now() - interval '12 days', now() - interval '12 days', now() - interval '11 days') RETURNING id`,
    [clinicId, number, LPZ, pts[0].id, mendoza])).rows[0].id as string;
  const lines = [
    { code: "OPE-01", tooth: 36, surfaces: ["O"], unit: 20000, note: "Convenio Cooperativa Minera Illimani (ficticia): precio especial" },
    { code: "PRE-01", tooth: null, surfaces: [], unit: 16000, note: "Convenio Cooperativa Minera Illimani (ficticia): −20 % en Prevención" },
    { code: "END-01", tooth: 21, surfaces: [], unit: 81000, note: "Convenio Cooperativa Minera Illimani (ficticia): −10 % en Endodoncia" },
  ];
  const itemIds: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]!;
    const p = await proc(l.code);
    itemIds.push((await q(
      `INSERT INTO budget_items (clinic_id, budget_id, procedure_id, tooth, surfaces, description, unit_price_cents, position,
          agreement_id, patient_agreement_id, list_unit_price_cents, agreement_note, company_share_percent, company_cap_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,60,150000) RETURNING id`,
      [clinicId, budget, p.id, l.tooth, l.surfaces, p.name, l.unit, k, mina, paMina, p.price_cents, l.note])).rows[0].id as string);
  }
  const chargeIds: string[] = [];
  for (const k of [0, 1]) {
    await q("UPDATE budget_items SET status = 'done', performed_by = $2, performed_at = now() - interval '8 days' WHERE id = $1", [itemIds[k], mendoza]);
    chargeIds.push((await q(
      `INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
       SELECT $1,$2,$3,i.id,$4, i.description || COALESCE(' (pieza ' || i.tooth || ')', ''), i.unit_price_cents, $4, now() - interval '8 days' FROM budget_items i WHERE i.id = $5 RETURNING id`,
      [clinicId, LPZ, pts[0].id, mendoza, itemIds[k]])).rows[0].id as string);
  }
  // El paciente pagó su parte en efectivo (40 % de 200 + 160 = 144 Bs).
  const receipt = await next("receipt");
  await q(`INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, budget_id, amount_cents, method, status, idempotency_key, received_by, received_at, verified_by, verified_at)
           VALUES ($1,$2,$3,$4,$5,14400,'cash','confirmed',$6,$7, now() - interval '8 days', $7, now() - interval '8 days')`,
    [clinicId, receipt, LPZ, pts[0].id, budget, `seed-agreement-${receipt}`, recep]);

  // Pago de la empresa por verificar (lo registró gerencia; lo debe confirmar otra persona).
  const parts = (await q("SELECT id, third_party_cents FROM charges WHERE id = ANY($1) ORDER BY created_at", [chargeIds])).rows;
  const total = parts.reduce((s, r) => s + Number(r.third_party_cents), 0);
  const pp = (await q(
    `INSERT INTO payer_payments (clinic_id, number, agreement_id, branch_id, amount_cents, method, status, bank_reference, notes, idempotency_key, received_by, received_at)
     VALUES ($1,$2,$3,$4,$5,'transfer','pending_verification','EMP-DEMO-0001','Pago mensual de la cooperativa (ficticio)','seed-payer-1',$6, now() - interval '2 days') RETURNING id`,
    [clinicId, await next("payer_payment"), mina, LPZ, total, manager])).rows[0].id as string;
  for (const r of parts) await q("INSERT INTO payer_payment_allocations (clinic_id, payment_id, charge_id, amount_cents) VALUES ($1,$2,$3,$4)", [clinicId, pp, r.id, r.third_party_cents]);

  // Pagos QR por verificar que aparecen en el extracto de ejemplo (docs/extracto-ejemplo.csv).
  const qr = async (patient: string, cents: number, ref: string, daysAgo: number) => {
    const n = await next("receipt");
    await q(`INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, amount_cents, method, status, bank_reference, notes, idempotency_key, received_by, received_at)
             VALUES ($1,$2,$3,$4,$5,'qr','pending_verification',$6,'Captura de QR enviada por WhatsApp (ficticio)',$7,$8, now() - make_interval(days => $9))`,
      [clinicId, n, LPZ, patient, cents, ref, `seed-qr-${ref}`, recep, daysAgo]);
  };
  await qr(pts[4].id, 18050, "QR-DEMO-0001", 1);
  await qr(pts[5].id, 9000, "QR-DEMO-0002", 1);

  // Solicitud «pendiente de facturar» a nombre de la empresa (no es una factura fiscal).
  const inv = (await q(
    `INSERT INTO invoice_requests (clinic_id, number, branch_id, patient_id, budget_id, bill_to, agreement_id, buyer_doc_type, buyer_tax_id, buyer_name, total_cents, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,'agreement',$6,'NIT','1029384756','Cooperativa Minera Illimani Ltda. (ficticia)',$7,'Facturar a fin de mes (demo)',$8) RETURNING id`,
    [clinicId, await next("invoice_request"), LPZ, pts[0].id, budget, mina, Number(parts[0].third_party_cents), recep])).rows[0].id as string;
  await q("INSERT INTO invoice_request_lines (clinic_id, request_id, budget_item_id, description, amount_cents) VALUES ($1,$2,$3,$4,$5)",
    [clinicId, inv, itemIds[0], "Restauración con resina (1 superficie) (pieza 36)", Number(parts[0].third_party_cents)]);
  return { agreements: 3, affiliates: 6 };
}
