// Datos demo (100 % ficticios) de presupuestos v2: sesiones, descuentos, versiones y seguimiento.
import type pg from "pg";
import { normalize } from "../lib/text.js";
import { percentOf, prorate } from "./budgets-v2-core.js";

export async function seedBudgetsV2(pool: pg.Pool, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const proc = async (code: string) => (await q("SELECT id, name, price_cents FROM procedures WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0];
  const user = async (email: string) => (await q("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const branch = async (code: string) => (await q("SELECT id FROM branches WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0].id as string;
  const next = async (name: string) => Number((await q(
    `INSERT INTO counters (clinic_id, name, value) VALUES ($1,$2,1) ON CONFLICT (clinic_id, name) DO UPDATE SET value = counters.value + 1 RETURNING value`, [clinicId, name])).rows[0].value);

  // Plantillas de sesiones
  await q("UPDATE procedures SET session_template = $2 WHERE clinic_id = $1 AND code = 'PRO-01'",
    [clinicId, JSON.stringify([{ name: "Toma de medidas y prueba", amountCents: 100000 }, { name: "Colocación de la corona", amountCents: 150000 }])]);
  await q("UPDATE procedures SET session_template = $2 WHERE clinic_id = $1 AND code = 'END-02'",
    [clinicId, JSON.stringify([{ name: "Apertura y conductometría", amountCents: 70000 }, { name: "Obturación de conductos", amountCents: 70000 }])]);

  const LPZ = await branch("LPZ");
  const mendoza = await user("dr.mendoza@demo.local");
  const vargas = await user("dra.vargas@demo.local");
  const recep = await user("recepcion.lpz@demo.local");

  async function patient(first: string, last: string, phone: string, birth: string, guardian: { name: string; phone: string } | null) {
    const n = await next("patient");
    return (await q(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, birth_date, sex, phone, city, guardian_name, guardian_phone, guardian_relationship,
         consent_reminders, consent_updated_at, search_text, preferred_branch_id)
       VALUES ($1,$2,$3,$4,'SIN',$5,'F',$6,'La Paz',$7,$8,$9,true, now(), $10, $11) RETURNING id`,
      [clinicId, n, first, last, birth, phone, guardian?.name ?? null, guardian?.phone ?? null, guardian ? "Madre" : null, normalize(`${first} ${last} ${phone} ${n}`), LPZ])).rows[0].id as string;
  }

  /** Inserta un presupuesto con descuentos por línea y global ya repartidos (como lo hace la app). */
  async function budget(o: { patient: string; dentist: string; status: string; number?: number; version?: number; supersedes?: string; daysAgo: number;
    lines: { code: string; tooth?: number; price?: number; pct?: number }[]; global?: { pct?: number; cents?: number }; notes?: string; installments?: number }) {
    const number = o.number ?? await next("budget");
    const lines = await Promise.all(o.lines.map(async (l) => {
      const p = await proc(l.code);
      const gross = l.price ?? Number(p.price_cents);
      const disc = l.pct ? percentOf(gross, l.pct) : 0;
      return { ...l, p, gross, disc, pre: gross - disc };
    }));
    const sumNet = lines.reduce((s, l) => s + l.pre, 0);
    const G = o.global?.pct != null ? percentOf(sumNet, o.global.pct) : o.global?.cents ?? 0;
    const shares = prorate(G, lines.map((l) => l.pre), true);
    const decided = ["accepted", "rejected", "completed"].includes(o.status);
    const id = (await q(
      `INSERT INTO budgets (clinic_id, number, version, supersedes_id, branch_id, patient_id, dentist_id, status, installments, notes, discount_cents, global_discount_percent,
         created_by, created_at, presented_at, decided_at, superseded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() - make_interval(days => $14), CASE WHEN $8 = 'draft' THEN NULL ELSE now() - make_interval(days => $14) END,
               CASE WHEN $15 THEN now() - make_interval(days => greatest($14 - 2, 0)) END, CASE WHEN $8 = 'superseded' THEN now() - make_interval(days => greatest($14 - 1, 0)) END) RETURNING id`,
      [clinicId, number, o.version ?? 1, o.supersedes ?? null, LPZ, o.patient, o.dentist, o.status, o.installments ?? 1, o.notes ?? null, G, o.global?.pct ?? null,
        o.dentist, o.daysAgo, decided])).rows[0].id as string;
    const items: string[] = [];
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k]!;
      const itemId = (await q(
        `INSERT INTO budget_items (clinic_id, budget_id, procedure_id, tooth, description, unit_price_cents, discount_cents, discount_percent, global_discount_cents, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [clinicId, id, l.p.id, l.tooth ?? null, l.p.name, l.gross, l.disc, l.pct ?? null, shares[k], k])).rows[0].id as string;
      items.push(itemId);
      const tpl = (await q("SELECT session_template FROM procedures WHERE id = $1", [l.p.id])).rows[0].session_template as { name: string; amountCents: number }[] | null;
      if (tpl?.length) {
        const amounts = prorate(l.pre - shares[k]!, tpl.map((s) => s.amountCents));
        for (let s = 0; s < tpl.length; s++) {
          await q("INSERT INTO budget_item_sessions (clinic_id, budget_item_id, position, name, weight_cents, amount_cents) VALUES ($1,$2,$3,$4,$5,$6)",
            [clinicId, itemId, s + 1, tpl[s]!.name, tpl[s]!.amountCents, amounts[s]]);
        }
      }
    }
    return { id, number, items };
  }

  // 1) Paciente para probar el enlace público (menor con su madre como responsable).
  //    Verificación: últimos 4 dígitos 1234 (paciente) o 5678 (madre), o fecha 15/06/2014.
  const camila = await patient("Camila", "Demo Enlace", "+59170001234", "2014-06-15", { name: "Rosa Demo Enlace", phone: "+59170005678" });
  await budget({
    patient: camila, dentist: mendoza, status: "draft", daysAgo: 0, installments: 3,
    notes: "Plan de prevención y una restauración. Las cuotas son mensuales.",
    lines: [{ code: "PRE-01", price: 6000 }, { code: "PRE-02", price: 6000, pct: 10 }, { code: "OPE-01", tooth: 36 }], global: { cents: 1000 },
  });

  // 2) Versiones: la v1 se presentó, el paciente pidió quitar el blanqueamiento → v2 presentada hace 9 días (toca seguimiento).
  const pedro = await patient("Pedro", "Demo Versiones", "+59170002222", "1985-02-03", null);
  const v1 = await budget({ patient: pedro, dentist: vargas, status: "superseded", daysAgo: 12, lines: [{ code: "PRE-01" }, { code: "EST-01" }, { code: "OPE-02", tooth: 14 }], global: { pct: 5 } });
  await budget({ patient: pedro, dentist: vargas, status: "presented", number: v1.number, version: 2, supersedes: v1.id, daysAgo: 9, lines: [{ code: "PRE-01" }, { code: "OPE-02", tooth: 14, pct: 10 }], global: { pct: 5 } });

  // 3) Corona en dos sesiones: aceptada, primera sesión hecha y sin próxima cita (bandeja "en curso sin próxima cita").
  const rosa = await patient("Rosario", "Demo Sesiones", "+59170003333", "1970-11-20", null);
  const crown = await budget({ patient: rosa, dentist: mendoza, status: "accepted", daysAgo: 20, lines: [{ code: "PRO-01", tooth: 16, pct: 10 }] });
  const s1 = (await q("SELECT id, name, amount_cents FROM budget_item_sessions WHERE budget_item_id = $1 AND position = 1", [crown.items[0]])).rows[0];
  await q("UPDATE budget_item_sessions SET status = 'done', performed_by = $2, performed_at = now() - interval '15 days' WHERE id = $1", [s1.id, mendoza]);
  await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, session_id, dentist_id, description, amount_cents, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6, now() - interval '15 days')`,
    [clinicId, LPZ, rosa, crown.items[0], s1.id, mendoza, `Corona de porcelana (pieza 16) · sesión: ${s1.name}`, s1.amount_cents]);
  // Seguimiento registrado por recepción en un presupuesto de la demo
  const presented = (await q("SELECT id FROM budgets WHERE clinic_id = $1 AND status = 'presented' AND presented_at < now() - interval '8 days' ORDER BY presented_at LIMIT 1", [clinicId])).rows[0];
  if (presented) {
    await q(`INSERT INTO budget_events (clinic_id, budget_id, kind, channel, actor_user_id, reason, created_at) VALUES ($1,$2,'follow_up','phone',$3,'Lo consulta con su familia; volver a llamar la próxima semana', now() - interval '1 day')`,
      [clinicId, presented.id, recep]);
  }
}
