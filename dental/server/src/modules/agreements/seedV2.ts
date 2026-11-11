// Datos demo (100 % ficticios) de B-082 y B-083:
//  * Cooperativa Minera Illimani (ficticia): una porción de hace 75 días que la cooperativa no pagó y que
//    gerencia ya trasladó al paciente, y otra de hace 70 días todavía impaga (se puede trasladar).
//  * Asociación de Choferes (ficticia): un tratamiento con la mitad pagada por la asociación EN EFECTIVO.
//  * Un gasto compartido entre tres sucursales (40/35/25 %) con su comprobante adjunto (imagen sintética).
import { createHash } from "node:crypto";
import type pg from "pg";
import { DateTime } from "luxon";
import { newStorageKey } from "../../lib/filestore.js";
import { syntheticScan } from "../../lib/png.js";
import { createReceiptStore } from "../management/attachments.js";
import { splitByPercent } from "../management/shares.js";

const ZONE = "America/La_Paz";

export async function seedAgreementsV2Demo(pool: pg.Pool, clinicId: string, cfg: { filesDir: string }) {
  const c = await pool.connect();
  const store = createReceiptStore(cfg);
  const written: string[] = [];
  try {
    await c.query("BEGIN");
    const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
    const today = DateTime.now().setZone(ZONE).startOf("day");
    const at = (daysAgo: number, hour = 11) => today.minus({ days: daysAgo }).set({ hour }).toJSDate();
    const user = async (email: string) => (await q("SELECT id FROM users WHERE email = $1", [email])).rows[0]?.id as string | undefined;
    const owner = (await user("propietaria@demo.local"))!;
    const manager = (await user("gerente@demo.local")) ?? owner;
    const mendoza = (await user("dr.mendoza@demo.local")) ?? owner;
    const branch = async (code: string) => (await q("SELECT id FROM branches WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0]?.id as string;
    const LPZ = await branch("LPZ");
    const next = async (name: string) => Number((await q(
      `INSERT INTO counters (clinic_id, name, value) VALUES ($1,$2,1) ON CONFLICT (clinic_id, name) DO UPDATE SET value = counters.value + 1 RETURNING value`, [clinicId, name])).rows[0].value);
    const agreement = async (prefix: string) => (await q("SELECT id FROM agreements WHERE clinic_id = $1 AND name LIKE $2", [clinicId, `${prefix}%`])).rows[0]?.id as string | undefined;

    /** Tratamiento realizado con la copia del convenio y su cargo (la porción de la empresa la calcula la base). */
    const treatment = async (patientAgreementId: string, code: string, unit: number, daysAgo: number) => {
      const pa = (await q("SELECT patient_id, agreement_id FROM patient_agreements WHERE id = $1", [patientAgreementId])).rows[0];
      const ag = (await q("SELECT name, company_share_percent, company_cap_cents FROM agreements WHERE id = $1", [pa.agreement_id])).rows[0];
      const proc = (await q("SELECT id, name, price_cents FROM procedures WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0];
      const budget = (await q(
        `INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status, installments, created_by, created_at, presented_at, decided_at)
         VALUES ($1,$2,$3,$4,$5,'completed',1,$5,$6,$6,$6) RETURNING id`, [clinicId, await next("budget"), LPZ, pa.patient_id, mendoza, at(daysAgo + 2)])).rows[0].id;
      const item = (await q(
        `INSERT INTO budget_items (clinic_id, budget_id, procedure_id, description, unit_price_cents, status, performed_by, performed_at,
            agreement_id, patient_agreement_id, list_unit_price_cents, agreement_note, company_share_percent, company_cap_cents)
         VALUES ($1,$2,$3,$4,$5,'done',$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [clinicId, budget, proc.id, proc.name, unit, mendoza, at(daysAgo), pa.agreement_id, patientAgreementId, proc.price_cents, `Convenio ${ag.name}: precio de lista`.slice(0, 160),
          ag.company_share_percent, ag.company_cap_cents])).rows[0].id;
      return (await q(
        `INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8) RETURNING id, patient_id, third_party_cents`,
        [clinicId, LPZ, pa.patient_id, item, mendoza, proc.name, unit, at(daysAgo)])).rows[0] as { id: string; patient_id: string; third_party_cents: string };
    };

    let transfers = 0, cashPayments = 0;
    const mina = await agreement("Cooperativa Minera Illimani");
    if (mina) {
      const pas = (await q("SELECT id FROM patient_agreements WHERE agreement_id = $1 ORDER BY member_number", [mina])).rows.map((r) => r.id as string);
      if (pas[1]) {
        // Porción impaga de hace 75 días: gerencia la trasladó al paciente (plazo del convenio: 60 días).
        const ch = await treatment(pas[1], "PRE-01", 16000, 75);
        await q(`INSERT INTO payer_transfers (clinic_id, charge_id, agreement_id, patient_id, branch_id, amount_cents, cause, reason, created_by, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,'overdue',$7,$8,$9)`,
          [clinicId, ch.id, mina, ch.patient_id, LPZ, Number(ch.third_party_cents), "La cooperativa no la pagó en 60 días y no respondió a los avisos (demo)", manager, at(5, 16)]);
        transfers++;
      }
      if (pas[2]) await treatment(pas[2], "PRE-01", 16000, 70); // vencida e impaga: se puede trasladar desde Convenios
    }
    const choferes = await agreement("Asociación de Choferes 16 de Julio");
    if (choferes) {
      const pa = (await q("SELECT id FROM patient_agreements WHERE agreement_id = $1 ORDER BY member_number LIMIT 1", [choferes])).rows[0]?.id as string | undefined;
      if (pa) {
        const ch = await treatment(pa, "OPE-01", 25000, 20);
        const part = Number(ch.third_party_cents);
        // La asociación pagó su parte en efectivo en la sucursal (D-07: confirmado al recibirlo).
        const pp = (await q(
          `INSERT INTO payer_payments (clinic_id, number, agreement_id, branch_id, amount_cents, method, status, notes, idempotency_key, received_by, received_at, verified_by, verified_at)
           VALUES ($1,$2,$3,$4,$5,'cash','confirmed','Pago en efectivo del tesorero de la asociación (ficticio)','seed-payer-cash-1',$6,$7,$6,$7) RETURNING id`,
          [clinicId, await next("payer_payment"), choferes, LPZ, part, manager, at(3, 10)])).rows[0].id;
        await q("INSERT INTO payer_payment_allocations (clinic_id, payment_id, charge_id, amount_cents) VALUES ($1,$2,$3,$4)", [clinicId, pp, ch.id, part]);
        cashPayments++;
      }
    }

    // Gasto compartido entre tres sucursales, con comprobante (imagen sintética).
    const codes = ["LPZ", "SUR", "EAL"];
    const ids: string[] = [];
    for (const code of codes) ids.push(await branch(code));
    let shared = 0;
    if (ids.every(Boolean)) {
      const amount = 450075; // Bs 4.500,75
      const bps = [4000, 3500, 2500];
      const date = today.toISODate()!;
      const exp = (await q(
        `INSERT INTO expenses (clinic_id, branch_id, category, description, amount_cents, expense_date, supplier, receipt_ref, status, created_by, created_at)
         VALUES ($1,$2,'marketing','Campaña de radio para La Paz y El Alto (compartida, ficticia)',$3,$4,'Radio Illimani Demo (ficticia)','Factura 000123',
                 'draft',$5,$6) RETURNING id`, [clinicId, ids[0], amount, date, manager, at(0, 9)])).rows[0].id;
      const parts = splitByPercent(amount, bps);
      for (let i = 0; i < codes.length; i++) {
        await q("INSERT INTO expense_shares (clinic_id, expense_id, branch_id, percent_bp, amount_cents) VALUES ($1,$2,$3,$4,$5)", [clinicId, exp, ids[i], bps[i], parts[i]]);
      }
      await q("UPDATE expenses SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3 WHERE id = $1", [exp, manager, at(0, 9)]);
      const img = syntheticScan();
      const key = newStorageKey(clinicId);
      await store.put(key, img);
      written.push(key);
      await q(`INSERT INTO expense_attachments (clinic_id, expense_id, original_name, mime_type, size_bytes, sha256, storage_driver, storage_key, uploaded_by, created_at)
               VALUES ($1,$2,'factura-radio.png','image/png',$3,$4,$5,$6,$7,$8)`,
        [clinicId, exp, img.length, createHash("sha256").update(img).digest("hex"), store.driver, key, manager, at(0, 9)]);
      shared++;
    }
    await q("COMMIT");
    return { transfers, cashPayments, sharedExpenses: shared };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    for (const k of written) await store.remove(k).catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
