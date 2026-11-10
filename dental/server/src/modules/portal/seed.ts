// Semilla demo (datos ficticios) de la reserva online: configuración y una familia de ejemplo
// (madre + hijo menor con el mismo celular de responsable) para probar /mi-cuenta.
import { normalize } from "../../lib/text.js";

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export async function seedPortalDemo(q: Q, clinicId: string) {
  await q(
    `INSERT INTO portal_settings (clinic_id, enabled, lead_time_hours, max_days_ahead, change_window_hours, show_prices, instructions)
     VALUES ($1, true, 2, 30, 24, true, 'Llega 10 minutos antes con tu carnet. Si tomas anticoagulantes, avísanos al llegar.')
     ON CONFLICT (clinic_id) DO NOTHING`, [clinicId]);
  const branches = (await q("SELECT id, code FROM branches WHERE clinic_id = $1", [clinicId])).rows;
  const conf: Record<string, [string, string]> = {
    LPZ: ["instant", "+59170000101"], SUR: ["request", "+59170000102"], EAL: ["instant", "+59170000103"],
    CBB: ["request", "+59170000104"], SCZ: ["instant", "+59170000105"],
  };
  for (const b of branches) {
    const [mode, wa] = conf[b.code] ?? ["request", null];
    await q("INSERT INTO portal_branch_settings (branch_id, clinic_id, enabled, mode, whatsapp) VALUES ($1,$2,true,$3,$4) ON CONFLICT DO NOTHING", [b.id, clinicId, mode, wa]);
  }
  const services: [string, number][] = [["CON-01", 10000], ["PRE-01", 20000], ["PRE-02", 8000], ["OPE-01", 25000]];
  for (const [i, [code, from]] of services.entries()) {
    await q(
      `INSERT INTO portal_services (procedure_id, clinic_id, price_from_cents, position)
       SELECT id, clinic_id, $3, $4 FROM procedures WHERE clinic_id = $1 AND code = $2 ON CONFLICT DO NOTHING`, [clinicId, code, from, i]);
  }
  // Familia demo (ficticia): la madre ingresa con CI 9000001 y fecha 12/05/1990; ve también a su hijo.
  const phone = "+59170000123";
  const fam: [string, string, string | null, string, string | null, string | null][] = [
    ["Carmen", "Mamani Demo", "9000001", "1990-05-12", phone, null],
    ["Mateo", "Mamani Demo", null, "2018-03-20", null, phone],
  ];
  for (const [fn, ln, doc, birth, ph, gph] of fam) {
    const n = (await q("UPDATE counters SET value = value + 1 WHERE clinic_id = $1 AND name = 'patient' RETURNING value", [clinicId])).rows[0].value;
    await q(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, birth_date, phone, guardian_name, guardian_phone,
          guardian_relationship, consent_reminders, consent_updated_at, search_text, referral_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true, now(), $12, 'Demo portal')`,
      [clinicId, n, fn, ln, doc ? "CI" : "SIN", doc, birth, ph, gph ? "Carmen Mamani Demo" : null, gph, gph ? "Madre" : null,
        normalize(`${fn} ${ln} ${doc ?? ""} ${ph ?? ""} ${n}`)]);
  }
}
