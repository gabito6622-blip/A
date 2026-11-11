// Envío manual de la encuesta desde la cita atendida (B-084): arma el mensaje y el enlace wa.me que
// abre WhatsApp en el equipo de recepción. No envía nada desde el servidor.
//  * Solo con consentimiento vigente para «recordatorios» (la misma finalidad que exige la regla
//    automática de la encuesta) y con teléfono; si no, explica por qué.
//  * El mensaje no lleva datos clínicos: nombre de pila, clínica, sucursal y el enlace.
import type { Client } from "../../lib/db.js";
import { messagingConsent } from "../consents.js";
/** Número para wa.me: solo dígitos; los celulares bolivianos de 8 dígitos llevan el 591 (como en presupuestos). */
const waPhone = (p: string | null) => { const d = String(p ?? "").replace(/\D/g, ""); return !d ? null : d.length === 8 ? `591${d}` : d; };

export interface SurveyShare { message: string; whatsappUrl: string | null; blockedReason: string | null }

export async function surveyShare(c: Client, appointmentId: string, url: string): Promise<SurveyShare> {
  const a = (await c.query<{ patient_id: string; first_name: string; phone: string | null; branch: string; clinic: string }>(
    `SELECT a.patient_id, p.first_name, p.phone, b.name AS branch, cl.name AS clinic
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN branches b ON b.id = a.branch_id JOIN clinics cl ON cl.id = a.clinic_id
      WHERE a.id = $1`, [appointmentId])).rows[0];
  if (!a) return { message: "", whatsappUrl: null, blockedReason: "Cita no encontrada" };
  const message = `Hola ${a.first_name}, gracias por tu visita a ${a.clinic} (${a.branch}). ¿Nos cuentas cómo te atendimos? Es un minuto: ${url}`;
  const consent = await messagingConsent(c, a.patient_id);
  const phone = waPhone(a.phone);
  const blockedReason = !consent.reminders ? "El paciente no aceptó recibir mensajes (recordatorios). Copia el enlace y muéstraselo en una tableta." : !phone ? "El paciente no tiene teléfono registrado." : null;
  return { message, whatsappUrl: blockedReason ? null : `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, blockedReason };
}
