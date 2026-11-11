// Semilla demo (ficticia) de los mensajes automáticos: horario de silencio, plantillas y reglas.
// Solo la confirmación al agendar queda activa; el resto se activa desde Configuración.
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export const DEMO_TEMPLATES: { name: string; purpose: "reminders" | "marketing"; body: string }[] = [
  { name: "Confirmación de cita", purpose: "reminders",
    body: "Hola {nombre}, tu cita en {clinica} ({sucursal}) quedó agendada para el {fecha} a las {hora} con {profesional}. Confirma o pide reprogramar aquí: {enlace_confirmar}" },
  { name: "Recordatorio de cita", purpose: "reminders",
    body: "Hola {nombre}, te recordamos tu cita en {clinica} ({sucursal}, {direccion}) el {fecha} a las {hora}. Confirma o pide reprogramar: {enlace_confirmar}" },
  { name: "Después de la visita", purpose: "reminders",
    body: "Hola {nombre}, gracias por tu visita a {clinica} ({sucursal}). Si tienes alguna molestia o consulta, escríbenos al {telefono_sucursal}." },
  { name: "Control pendiente", purpose: "reminders",
    body: "Hola {nombre}, se acerca la fecha de tu control en {clinica} ({fecha}). Reserva tu hora aquí: {enlace_portal}" },
  { name: "Presupuesto sin respuesta", purpose: "reminders",
    body: "Hola {nombre}, ¿pudiste revisar el presupuesto que te entregamos en {clinica} ({sucursal})? Si tienes dudas, escríbenos al {telefono_sucursal}." },
  { name: "Campaña preventiva", purpose: "marketing",
    body: "Hola {nombre}, en {clinica} te invitamos a tu revisión preventiva. Reserva en {enlace_portal}" },
];

export async function seedMessagingDemo(q: Q, clinicId: string) {
  await q("INSERT INTO messaging_settings (clinic_id) VALUES ($1) ON CONFLICT DO NOTHING", [clinicId]);
  const ids: Record<string, string> = {};
  for (const t of DEMO_TEMPLATES) {
    const r = (await q(
      `INSERT INTO message_templates (clinic_id, name, purpose) VALUES ($1,$2,$3)
       ON CONFLICT (clinic_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [clinicId, t.name, t.purpose])).rows[0];
    ids[t.name] = r.id;
    await q("INSERT INTO message_template_versions (clinic_id, template_id, version, body) VALUES ($1,$2,1,$3) ON CONFLICT DO NOTHING", [clinicId, r.id, t.body]);
  }
  const rules: [string, string, number, string, boolean][] = [
    ["Confirmación al agendar", "appointment_created", 0, "Confirmación de cita", true],
    ["Recordatorio 2 h antes", "appointment_reminder", 120, "Recordatorio de cita", false],
    ["Cuidados después de la visita", "after_visit", 1440, "Después de la visita", false],
    ["Control pendiente (7 días antes)", "recall_due", 7 * 1440, "Control pendiente", false],
    ["Presupuesto sin respuesta (7 días)", "budget_unanswered", 7 * 1440, "Presupuesto sin respuesta", false],
  ];
  const existing = (await q("SELECT count(*)::int AS n FROM message_rules WHERE clinic_id = $1", [clinicId])).rows[0].n;
  if (existing) return;
  for (const [name, trigger, off, tpl, active] of rules) {
    await q(
      `INSERT INTO message_rules (clinic_id, name, trigger, offset_minutes, template_id, active, active_since) VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6 THEN now() END)`,
      [clinicId, name, trigger, off, ids[tpl], active]);
  }
}

/**
 * Respuestas de ejemplo de pacientes por WhatsApp (B-070), ficticias, para la bandeja de recepción.
 * Una por sucursal de la lista, con un paciente de esa sucursal; idempotente por provider_message_id.
 */
export async function seedRepliesDemo(q: Q, clinicId: string) {
  const texts = [
    "Hola, ¿puedo pasar mi cita del jueves a la tarde?",
    "Gracias, ahí estaré puntual.",
    "¿Cuánto cuesta la limpieza? Mi hijo también necesita.",
  ];
  const branches = (await q("SELECT id, code FROM branches WHERE clinic_id = $1 AND active ORDER BY code", [clinicId])).rows as { id: string; code: string }[];
  let i = 0;
  for (const b of branches) {
    const p = (await q("SELECT id, phone FROM patients WHERE clinic_id = $1 AND preferred_branch_id = $2 AND phone IS NOT NULL ORDER BY record_number LIMIT 1", [clinicId, b.id])).rows[0];
    if (!p) continue;
    await q(
      `INSERT INTO inbound_messages (clinic_id, patient_id, sender, body, kind, provider_message_id, branch_id, created_at)
       VALUES ($1,$2,$3,$4,'other',$5,$6, now() - make_interval(mins => $7)) ON CONFLICT (clinic_id, provider_message_id) DO NOTHING`,
      [clinicId, p.id, String(p.phone).replace(/\D/g, "").slice(-12), texts[i % texts.length], `demo.respuesta.${b.code}`, b.id, 30 + i * 47]);
    i++;
  }
}
