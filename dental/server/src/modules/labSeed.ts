// Datos demo FICTICIOS de laboratorio (los llama la semilla general al final).
import { DateTime } from "luxon";
import type pg from "pg";

const ZONE = "America/La_Paz";

export async function seedLabDemo(pool: pg.Pool, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const one = async (sql: string, p: unknown[]) => (await q(sql, p)).rows[0];
  const day = (n: number) => DateTime.now().setZone(ZONE).plus({ days: n }).toISODate()!;
  const owner = (await one("SELECT id FROM users WHERE email = 'propietaria@demo.local'", [])).id as string;
  const mendoza = (await one("SELECT id FROM users WHERE email = 'dr.mendoza@demo.local'", [])).id as string;
  const lpz = (await one("SELECT id FROM branches WHERE clinic_id = $1 AND code = 'LPZ'", [clinicId])).id as string;
  const andes = (await one(
    `INSERT INTO labs (clinic_id, name, contact_name, phone, whatsapp, address, notes, price_list) VALUES ($1,'Laboratorio Dental Andes (ficticio)','Téc. Ramiro Paz',
      '+59122000001','+59170000001','Calle Ficticia 123, La Paz','Recoge los martes y viernes por la mañana.',$2) RETURNING id`,
    [clinicId, JSON.stringify({ crown: 45000, bridge: 40000, veneer: 38000, inlay: 30000, splint: 25000, removable: 90000, model: 5000 })])).id as string;
  const illimani = (await one(
    "INSERT INTO labs (clinic_id, name, contact_name, phone) VALUES ($1,'Illimani Prótesis (ficticio)','Lic. Ana Soria','+59122000002') RETURNING id", [clinicId])).id as string;
  // Pacientes ficticios de ejemplo (los de N° de ficha más alto, para no interferir con las pruebas)
  const pts = (await q("SELECT id FROM patients WHERE clinic_id = $1 ORDER BY record_number DESC LIMIT 5", [clinicId])).rows.map((r) => r.id as string);
  let n = 0;
  async function order(o: { lab: string; patient: string; work: string; teeth: number[]; shade?: string; material?: string; status: string; sent?: number; promised?: number;
    received?: number; delivered?: number; cost?: number; history: [string, number, string?][] }) {
    const id = (await one(
      `INSERT INTO lab_orders (clinic_id, number, lab_id, patient_id, dentist_id, branch_id, work_type, teeth, material, shade, impression, instructions, status,
         sent_on, promised_on, received_on, delivered_on, cost_cents, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'digital','Datos de demostración.',$11,$12,$13,$14,$15,$16,$5,$17) RETURNING id`,
      [clinicId, ++n, o.lab, o.patient, mendoza, lpz, o.work, o.teeth, o.material ?? null, o.shade ?? null, o.status,
        o.sent != null ? day(o.sent) : null, o.promised != null ? day(o.promised) : null, o.received != null ? day(o.received) : null,
        o.delivered != null ? day(o.delivered) : null, o.cost ?? null, DateTime.fromISO(day(o.history[0]![1]), { zone: ZONE }).set({ hour: 9 }).toJSDate()])).id;
    let prev: string | null = null;
    for (const [to, d, reason] of o.history) {
      await q("INSERT INTO lab_order_events (clinic_id, order_id, from_status, to_status, reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [clinicId, id, prev, to, reason ?? null, mendoza, DateTime.fromISO(day(d), { zone: ZONE }).set({ hour: 10 }).toJSDate()]);
      prev = to;
    }
    return id as string;
  }
  await order({ lab: andes, patient: pts[0]!, work: "crown", teeth: [26], shade: "A3", material: "Zirconio", status: "sent", sent: -2, promised: 5, history: [["draft", -2], ["sent", -2]] });
  await order({ lab: andes, patient: pts[1]!, work: "bridge", teeth: [14, 15, 16], shade: "A2", material: "Metal-porcelana", status: "in_process", sent: -12, promised: -2,
    history: [["draft", -12], ["sent", -12], ["in_process", -8]] });
  await order({ lab: illimani, patient: pts[2]!, work: "veneer", teeth: [11, 21], shade: "B1", material: "Disilicato de litio", status: "received", sent: -10, promised: -1, received: -1,
    cost: 76000, history: [["draft", -10], ["sent", -10], ["received", -1]] });
  const paid = await order({ lab: andes, patient: pts[3]!, work: "crown", teeth: [36], shade: "A3.5", material: "Zirconio", status: "delivered", sent: -25, promised: -15, received: -16,
    delivered: -12, cost: 45000, history: [["draft", -25], ["sent", -25], ["received", -16], ["adjustment", -15, "Contacto oclusal alto"], ["received", -14], ["delivered", -12]] });
  await order({ lab: andes, patient: pts[4]!, work: "splint", teeth: [], material: "Acrílico termocurado", status: "draft", history: [["draft", 0]] });
  await q("INSERT INTO counters (clinic_id, name, value) VALUES ($1,'lab_order',$2) ON CONFLICT (clinic_id, name) DO UPDATE SET value = EXCLUDED.value", [clinicId, n]);
  const pay = (await one(
    "INSERT INTO lab_payments (clinic_id, lab_id, amount_cents, paid_on, method, reference, note, created_by) VALUES ($1,$2,45000,$3,'transfer','DEMO-0001','Pago de ejemplo',$4) RETURNING id",
    [clinicId, andes, day(-10), owner])).id;
  await q("INSERT INTO lab_payment_allocations (clinic_id, payment_id, order_id, amount_cents) VALUES ($1,$2,$3,45000)", [clinicId, pay, paid]);
}
