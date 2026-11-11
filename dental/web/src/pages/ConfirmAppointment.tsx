// /c/:token — página pública del enlace de confirmación (funciona con cualquier canal, sin botones
// de WhatsApp). Muestra fecha, hora y sucursal; «Confirmo» confirma la cita una sola vez y
// «Necesito reprogramar» lleva al portal del paciente o al WhatsApp de la sucursal.
import { useEffect, useState } from "react";
import { CalendarCheck, CalendarClock, DoorOpen, MapPin, MessageCircle, Phone } from "lucide-react";
import "./public-budget.css";

async function call(method: "GET" | "POST", token: string, body?: unknown) {
  const res = await fetch(`/api/public/confirmar/${encodeURIComponent(token)}`, {
    method, credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json", "x-portal": "1" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  }).catch(() => null);
  if (!res) throw Object.assign(new Error("No hay conexión. Revisa tu señal e intenta de nuevo."), { status: 0 });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? "No se pudo completar. Intenta de nuevo."), { status: res.status, code: data?.error?.code });
  return data;
}

export function ConfirmAppointmentPage() {
  const token = window.location.pathname.split("/c/")[1]?.split(/[/?#]/)[0] ?? "";
  const [view, setView] = useState<any | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | "confirmed" | "reschedule">(null);
  const [contact, setContact] = useState<{ whatsappUrl: string | null; phone: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "Confirmar cita";
    call("GET", token).then(setView).catch((e) => setFatal(e.status === 404 ? "Este enlace no es válido. Revisa que lo abriste completo desde el mensaje." : e.message));
  }, [token]);

  const act = async (action: "confirm" | "reschedule") => {
    setBusy(true); setErr(null);
    try {
      const r = await call("POST", token, { action });
      if (action === "confirm") setDone("confirmed");
      else if (r.redirect) window.location.assign(r.redirect);
      else { setContact({ whatsappUrl: r.whatsappUrl, phone: r.phone }); setDone("reschedule"); }
    } catch (e: any) {
      setErr(e.message);
      call("GET", token).then(setView).catch(() => {});
    } finally { setBusy(false); }
  };

  return (
    <main className="pb" lang="es">
      <div className="pb-wrap">
        <div className="pb-top"><CalendarCheck size={18} aria-hidden="true" /><span>{view?.clinicName ?? "Confirmación de cita"}</span></div>
        {fatal && <div className="card"><div className="card-pad stack"><h1>Enlace no disponible</h1><p>{fatal}</p></div></div>}
        {!fatal && !view && <div className="skeleton" style={{ height: 160 }} />}
        {view && (
          <div className="card">
            <div className="card-pad stack">
              {done === "confirmed" ? (
                <>
                  <h1>¡Gracias, {view.patientFirstName}! Tu cita quedó confirmada</h1>
                  <p role="status" className="alert ok">Te esperamos el {view.date.toLowerCase()} a las {view.time}.</p>
                </>
              ) : done === "reschedule" ? (
                <>
                  <h1>Escríbenos para elegir otro horario</h1>
                  <p>Tu cita sigue agendada hasta que la sucursal la cambie.</p>
                </>
              ) : view.state === "valid" ? (
                <>
                  <h1>Hola {view.patientFirstName}, ¿confirmas tu cita?</h1>
                  {view.alreadyConfirmed && <p className="alert info">Esta cita ya figura como confirmada. Puedes volver a confirmarla o pedir otro horario.</p>}
                </>
              ) : (
                <>
                  <h1>{view.state === "used" ? "Este enlace ya se usó" : view.state === "expired" ? "Este enlace venció" : view.state === "cancelled" ? "Cita cancelada" : "Tu cita cambió"}</h1>
                  <p className="alert warn" role="status">{view.message}</p>
                </>
              )}
              <dl className="pb-dl" style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}>
                <dt className="muted">Fecha</dt><dd style={{ margin: 0 }}><b>{view.date}</b></dd>
                <dt className="muted">Hora</dt><dd style={{ margin: 0 }}><b>{view.time}</b></dd>
                <dt className="muted">Sucursal</dt><dd style={{ margin: 0 }}>{view.branch.name}{view.branch.address ? <><br /><span className="muted">{view.branch.address}</span></> : null}</dd>
              </dl>
              {err && <p className="pb-err" role="alert">{err}</p>}
              {view.state === "valid" && !done && (
                <div className="stack">
                  <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => act("confirm")}><CalendarCheck size={20} />Confirmo</button>
                  <button type="button" className="btn btn-block" disabled={busy} onClick={() => act("reschedule")}><CalendarClock size={20} />Necesito reprogramar</button>
                </div>
              )}
              {(done === "reschedule" || (view.state !== "valid" && !done)) && (contact?.whatsappUrl ?? view.branch.whatsappUrl) && (
                <a className="btn btn-block" href={contact?.whatsappUrl ?? view.branch.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={20} />WhatsApp de la sucursal</a>
              )}
              {(done === "reschedule" || (view.state !== "valid" && !done)) && (contact?.phone ?? view.branch.phone) && (
                <a className="btn btn-block" href={`tel:${String(contact?.phone ?? view.branch.phone).replace(/[^\d+]/g, "")}`}><Phone size={20} />Llamar a la sucursal</a>
              )}
              <a className="btn btn-block" href={view.branch.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={20} />Cómo llegar</a>
              {["valid", "used", "expired"].includes(view.state) && (
                <a className="btn btn-block" href={`/llegada/r/${token}`}><DoorOpen size={20} />Ya estoy en la sucursal: avisar mi llegada</a>
              )}
            </div>
          </div>
        )}
        <p className="muted small" style={{ textAlign: "center" }}>Este enlace es personal y sirve una sola vez. No compartas el mensaje.</p>
      </div>
    </main>
  );
}
