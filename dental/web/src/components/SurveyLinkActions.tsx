// Encuesta de satisfacción a mano desde una cita atendida (B-084), en la agenda y en la sala de espera.
// «Enviar encuesta» prepara el mensaje y abre WhatsApp en este equipo (wa.me) solo si el paciente
// aceptó recibir mensajes; «Copiar enlace» lo deja listo para mostrarlo en una tableta. El servidor
// emite el enlace (un solo uso, 14 días), valida el permiso y la sucursal y lo registra en el diario.
import { useState } from "react";
import { Link2, MessageCircle } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate, fmtDateTime } from "../lib/format";
import { Dialog, Field, useToast } from "./ui";

interface SurveyLink { url: string; expiresAt: string; message: string; whatsappUrl: string | null; blockedReason: string | null }

export function SurveyLinkActions({ appointmentId, patientName, compact }: { appointmentId: string; patientName: string; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<SurveyLink | null>(null);

  const issue = async (): Promise<SurveyLink | null> => {
    setBusy(true);
    try { return await api.post<SurveyLink>(`/api/appointments/${appointmentId}/survey-link`); }
    catch (e: any) { toast(e.message ?? "No se pudo preparar la encuesta", true); return null; }
    finally { setBusy(false); }
  };
  const copy = async () => {
    const l = await issue();
    if (!l) return;
    try {
      await navigator.clipboard.writeText(l.url);
      toast(`Enlace de encuesta copiado (vence el ${fmtDate(l.expiresAt)})`);
    } catch {
      setShown(l); // sin permiso para el portapapeles: se muestra para copiarlo a mano
    }
  };
  const send = async () => { const l = await issue(); if (l) setShown(l); };

  return (
    <>
      <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={send}><MessageCircle size={16} />Enviar encuesta</button>
      <button type="button" className="btn btn-ghost" style={{ minHeight: 40 }} disabled={busy} onClick={copy}><Link2 size={16} />{compact ? "Copiar enlace" : "Copiar enlace de encuesta"}</button>
      {shown && (
        <Dialog title="Encuesta de satisfacción" onClose={() => setShown(null)} footer={<>
          <button type="button" className="btn" onClick={() => setShown(null)}>Cerrar</button>
          {shown.whatsappUrl && <a className="btn btn-primary" href={shown.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setShown(null)}><MessageCircle size={16} />Abrir WhatsApp</a>}
        </>}>
          <div className="stack">
            <p className="muted small">Para {patientName}. El enlace sirve una sola vez y vence el {fmtDateTime(shown.expiresAt)}. No incluye datos clínicos.</p>
            {shown.blockedReason ? <div className="alert warn" role="status">{shown.blockedReason}</div> : (
              <Field label="Mensaje que se enviará">
                <textarea className="input" readOnly value={shown.message} style={{ minHeight: 84 }} />
              </Field>
            )}
            <Field label="Enlace de la encuesta">
              <input className="input" readOnly value={shown.url} onFocus={(e) => e.currentTarget.select()} />
            </Field>
          </div>
        </Dialog>
      )}
    </>
  );
}
