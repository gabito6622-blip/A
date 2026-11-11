// Semilla demo (datos FICTICIOS) de la experiencia del paciente: familias con tutor legal,
// etiquetas, segmentos, consentimientos de promociones (y una baja), encuestas respondidas,
// la regla automática de la encuesta (desactivada) y el QR de llegada de cada sucursal.
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type pg from "pg";
import { normalize } from "../../lib/text.js";
import { signToken, tokenHash, sha256hex } from "./tokens.js";
import type { Keys } from "../../lib/keys.js";

export async function seedExperienceDemo(pool: pg.Pool, clinicId: string, secretKey: Keys) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const branches = (await q("SELECT id, code FROM branches WHERE clinic_id = $1 ORDER BY code", [clinicId])).rows as { id: string; code: string }[];
  const B = Object.fromEntries(branches.map((b) => [b.code, b.id]));
  const owner = (await q("SELECT user_id FROM memberships WHERE clinic_id = $1 AND role = 'owner' LIMIT 1", [clinicId])).rows[0].user_id as string;

  // ---------- Familias ----------
  async function patient(fn: string, ln: string, birth: string, sex: string, phone: string | null, guardian: { name: string; phone: string; rel: string } | null, doc: string | null) {
    const n = (await q("UPDATE counters SET value = value + 1 WHERE clinic_id = $1 AND name = 'patient' RETURNING value", [clinicId])).rows[0].value;
    return (await q(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, birth_date, sex, phone, guardian_name, guardian_phone,
          guardian_relationship, consent_reminders, consent_marketing, consent_updated_at, search_text, preferred_branch_id, referral_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13, now(), $14, $15, 'Demo familias') RETURNING id`,
      [clinicId, n, fn, ln, doc ? "CI" : "SIN", doc, birth, sex, phone, guardian?.name ?? null, guardian?.phone ?? null, guardian?.rel ?? null, !guardian,
        normalize(`${fn} ${ln} ${doc ?? ""} ${phone ?? ""} ${n}`), B.LPZ])).rows[0].id as string;
  }
  async function rel(a: string, b: string, kind: string, label: string | null, legal: boolean) {
    await q(`INSERT INTO patient_relationships (clinic_id, person_a, person_b, kind, parent_label, legal_guardian, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clinicId, a, b, kind, label, legal, owner]);
  }
  // Familia Pérez Demo: padre, madre y dos hijos que comparten el celular del padre.
  const dadPhone = "+59170000201";
  const dad = await patient("Rodrigo", "Pérez Demo", "1984-02-14", "M", dadPhone, null, "9000201");
  const mom = await patient("Lucía", "Arce Demo", "1987-09-03", "F", "+59170000202", null, "9000202");
  const sofia = await patient("Sofía", "Pérez Arce Demo", "2014-06-21", "F", dadPhone, { name: "Rodrigo Pérez Demo", phone: dadPhone, rel: "Padre" }, null);
  const tomas = await patient("Tomás", "Pérez Arce Demo", "2017-11-30", "M", null, { name: "Rodrigo Pérez Demo", phone: dadPhone, rel: "Padre" }, null);
  await rel(dad, sofia, "parent", "padre", true);
  await rel(dad, tomas, "parent", "padre", true);
  await rel(mom, sofia, "parent", "madre", false);
  await rel(mom, tomas, "parent", "madre", false);
  await rel(dad, mom, "spouse", null, false);
  // Familia del portal (Carmen Mamani Demo y su hijo Mateo): se declara la relación con tutora legal.
  const portal = (await q("SELECT id, first_name FROM patients WHERE clinic_id = $1 AND last_name = 'Mamani Demo'", [clinicId])).rows as { id: string; first_name: string }[];
  const carmen = portal.find((p) => p.first_name === "Carmen"), mateo = portal.find((p) => p.first_name === "Mateo");
  if (carmen && mateo) await rel(carmen.id, mateo.id, "parent", "madre", true);

  // Próximas citas de los hermanos (seguidas) con la Dra. Vargas en La Paz Centro, si hay hueco.
  const vargas = (await q("SELECT id FROM users WHERE email = 'dra.vargas@demo.local'")).rows[0]?.id as string | undefined;
  if (vargas) {
    let day = DateTime.now().setZone("America/La_Paz").plus({ days: 3 }).startOf("day");
    while (day.weekday > 5) day = day.plus({ days: 1 });
    const cx = await pool.connect();
    try {
      // Al final de la mañana (las citas demo al azar terminan antes) y, si no, al cierre de la tarde.
      for (const [hour, minute] of [[12, 0], [11, 30], [18, 0], [15, 0]] as const) {
        const s1 = day.set({ hour, minute });
        try {
          await cx.query("BEGIN");
          for (const [i, pid] of [sofia, tomas].entries()) {
            const st = s1.plus({ minutes: 30 * i });
            await cx.query(`INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, reason) VALUES ($1,$2,$3,$4,$5,$6,'scheduled','Control (hermanos)')`,
              [clinicId, B.LPZ, vargas, pid, st.toJSDate(), st.plus({ minutes: 30 }).toJSDate()]);
          }
          await cx.query("COMMIT");
          break;
        } catch { await cx.query("ROLLBACK"); }
      }
    } finally { cx.release(); }
  }

  // ---------- Etiquetas ----------
  const tagDefs: [string, string][] = [["Ortodoncia activa", "#7c3aed"], ["Empresa Andina S.A. (ficticia)", "#2563eb"], ["VIP", "#d97706"], ["Prefiere sábados", "#0f766e"]];
  const tags: Record<string, string> = {};
  for (const [name, color] of tagDefs) {
    tags[name] = (await q("INSERT INTO patient_tags (clinic_id, name, color, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [clinicId, name, color, owner])).rows[0].id;
  }
  const pts = (await q("SELECT id FROM patients WHERE clinic_id = $1 AND referral_source IS NULL ORDER BY record_number", [clinicId])).rows.map((r) => r.id as string);
  const link = (pid: string, tag: string) => q("INSERT INTO patient_tag_links (clinic_id, patient_id, tag_id, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [clinicId, pid, tags[tag], owner]);
  for (const [i, pid] of pts.entries()) {
    if (i % 6 === 0) await link(pid, "Ortodoncia activa");
    if (i % 9 === 1) await link(pid, "Empresa Andina S.A. (ficticia)");
    if (i % 15 === 2) await link(pid, "VIP");
    if (i % 11 === 3) await link(pid, "Prefiere sábados");
  }
  await link(sofia, "Ortodoncia activa");

  // ---------- Consentimiento de promociones (1 de cada 3) y una baja ----------
  for (const [i, pid] of pts.entries()) if (i % 3 === 0) await q("UPDATE patients SET consent_marketing = true WHERE id = $1", [pid]);
  const optOut = pts[3];
  if (optOut) {
    await q("UPDATE patients SET consent_marketing = false WHERE id = $1", [optOut]);
    await q(
      `INSERT INTO signed_documents (clinic_id, patient_id, branch_id, kind, title, body, decision, method, signer_name, content_hash, notes)
       SELECT $1, p.id, $2, 'marketing', 'Promociones y novedades', 'El paciente respondió «BAJA» (demo ficticia).', 'revoked', 'online_checkbox',
              p.first_name || ' ' || p.last_name, $3, 'Baja por respuesta «BAJA» (demo)' FROM patients p WHERE p.id = $4`,
      [clinicId, B.LPZ, sha256hex(`demo-baja-${optOut}`), optOut]);
  }

  // ---------- Segmentos ----------
  const segs: [string, Record<string, unknown>][] = [
    ["Ortodoncia activa", { tagIds: [tags["Ortodoncia activa"]], tagMode: "any", balance: "any", pendingTreatment: false, overdueRecall: false }],
    ["Empresa Andina con deuda", { tagIds: [tags["Empresa Andina S.A. (ficticia)"]], tagMode: "any", balance: "debt", pendingTreatment: false, overdueRecall: false }],
    ["Sin visita hace 6 meses", { tagIds: [], tagMode: "any", noVisitDays: 180, ageMin: 18, balance: "any", pendingTreatment: false, overdueRecall: false }],
  ];
  for (const [name, filters] of segs) await q("INSERT INTO patient_segments (clinic_id, name, filters, created_by) VALUES ($1,$2,$3,$4)", [clinicId, name, JSON.stringify(filters), owner]);

  // ---------- Encuestas respondidas (últimos 30 días) ----------
  const appts = (await q(
    `SELECT a.id, a.patient_id, a.branch_id, a.dentist_id, a.starts_at, a.ends_at FROM appointments a
      WHERE a.clinic_id = $1 AND a.status = 'completed' AND a.starts_at > now() - interval '30 days' ORDER BY a.starts_at LIMIT 40`, [clinicId])).rows;
  const scores = [10, 9, 10, 8, 9, 10, 7, 9, 10, 4, 9, 10, 8, 10, 6, 9, 10, 10, 9, 8, 3, 10, 9, 7, 10, 9, 10, 8, 9, 10];
  const comments: Record<number, string> = {
    0: "Muy buena atención, puntuales y amables.", 3: "Bien, pero esperé un poco en recepción.", 9: "Me hicieron esperar 40 minutos y nadie me avisó.",
    14: "El cobro no coincidía con lo que me dijeron.", 20: "No me devolvieron la llamada para reprogramar.", 5: "Excelente, el consultorio muy limpio.",
  };
  for (const [i, a] of appts.entries()) {
    const id = randomUUID();
    const token = signToken(secretKey, "encuesta", clinicId, id);
    const answered = i < scores.length;
    const at = new Date(new Date(a.ends_at).getTime() + 3 * 3_600_000);
    await q(
      `INSERT INTO satisfaction_surveys (id, clinic_id, appointment_id, patient_id, branch_id, dentist_id, token_hash, source, created_at, expires_at, answered_at, score, comment,
          followup_done_at, followup_by, followup_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'auto',$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, clinicId, a.id, a.patient_id, a.branch_id, a.dentist_id, tokenHash(token), a.ends_at, new Date(new Date(a.ends_at).getTime() + 14 * 86_400_000),
        answered ? at : null, answered ? scores[i] : null, answered ? comments[i] ?? null : null,
        i === 14 ? at : null, i === 14 ? owner : null, i === 14 ? "Llamamos a la paciente y revisamos el cobro con caja. Quedó conforme." : null]);
  }

  // ---------- Regla automática de la encuesta (desactivada por defecto) ----------
  const tpl = (await q(
    `INSERT INTO message_templates (clinic_id, name, purpose) VALUES ($1,'Encuesta de satisfacción','reminders')
     ON CONFLICT (clinic_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [clinicId])).rows[0].id;
  await q("INSERT INTO message_template_versions (clinic_id, template_id, version, body) VALUES ($1,$2,1,$3) ON CONFLICT DO NOTHING",
    [clinicId, tpl, "Hola {nombre}, gracias por visitarnos en {clinica} ({sucursal}). ¿Nos ayudas con una pregunta? Toma 30 segundos: {enlace_encuesta}"]);
  await q("INSERT INTO message_rules (clinic_id, name, trigger, offset_minutes, template_id, active) VALUES ($1,'Encuesta 2 h después de la cita','satisfaction_survey',120,$2,false)",
    [clinicId, tpl]);

  // ---------- QR de llegada por sucursal ----------
  for (const b of branches) await q("INSERT INTO checkin_points (id, clinic_id, branch_id, created_by) VALUES ($1,$2,$3,$4)", [randomUUID(), clinicId, b.id, owner]);

  return { families: 2, tags: tagDefs.length, surveys: Math.min(appts.length, scores.length) };
}
