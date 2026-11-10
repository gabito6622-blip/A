// /mi-cuenta/:slug — portal del paciente: citas (reprogramar, cancelar, calendario), pagos con
// comprobante, presupuestos en solo lectura y grupo familiar (menores a cargo del mismo celular).
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarPlus, MapPin, MessageCircle } from "lucide-react";
import { papi, qs, type Session } from "./api";
import { ErrorBox, ExistingForm, OtpForm, Shell, SlotPicker, Sticky, bs, fmtDateShort, type Slot } from "./shared";
import { NotAvailable, useInfo } from "./Booking";

type Tab = "citas" | "pagos" | "presupuestos";

export function MyAccountPage() {
  const { slug = "" } = useParams();
  const { info, error, setInfo } = useInfo(slug);
  const [ch, setCh] = useState<{ c: { challengeId: string; message: string }; resend: () => Promise<{ challengeId: string; message: string }> } | null>(null);
  if (error) return error.status === 404 ? <NotAvailable /> : <NotAvailable text={error.message} />;
  if (!info) return <Shell clinic="Cargando…"><div className="skeleton" style={{ height: 60 }} /></Shell>;
  const setSession = (s: Session | null) => { setInfo({ ...info, session: s }); setCh(null); };
  if (!info.session) {
    const help = info.branches.find((b) => b.whatsappUrl)?.whatsappUrl ?? null;
    return (
      <Shell clinic={info.clinic.name} sub="Mis citas y pagos">
        <h1>Ingresa a tu cuenta</h1>
        <p className="muted">Sin contraseña: te enviamos un código de un solo uso por WhatsApp.</p>
        {ch ? <OtpForm slug={slug} challenge={ch.c} resend={ch.resend} onVerified={setSession} onBack={() => setCh(null)} helpUrl={help} />
          : <ExistingForm slug={slug} onChallenge={(c, resend) => setCh({ c, resend })} />}
        {!ch && <p className="small">¿Es tu primera vez? <a href={`/reservar/${slug}`}>Reserva tu primera cita</a>.</p>}
      </Shell>
    );
  }
  return <Portal slug={slug} clinic={info.clinic.name} session={info.session} paymentNote={info.paymentNote} onLogout={() => setSession(null)} />;
}

function Portal({ slug, clinic, session, paymentNote, onLogout }: { slug: string; clinic: string; session: Session; paymentNote: string; onLogout: () => void }) {
  const api = papi(slug);
  const [tab, setTab] = useState<Tab>("citas");
  const [who, setWho] = useState(session.patient?.id ?? session.family[0]!.id);
  const logout = async () => { await api.post("/auth/logout").catch(() => {}); onLogout(); };
  return (
    <Shell clinic={clinic} sub="Mis citas y pagos" right={<button type="button" className="pt-link" onClick={logout}>Salir</button>}>
      <h1>Hola, {session.patient?.firstName ?? session.family[0]?.firstName}</h1>
      <div className="pt-seg" role="tablist" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <button type="button" role="tab" aria-selected={tab === "citas"} onClick={() => setTab("citas")}>Citas</button>
        <button type="button" role="tab" aria-selected={tab === "pagos"} onClick={() => setTab("pagos")}>Pagos</button>
        <button type="button" role="tab" aria-selected={tab === "presupuestos"} onClick={() => setTab("presupuestos")}>Presupuestos</button>
      </div>
      {session.family.length > 1 && tab !== "citas" && (
        <div className="pt-chips" role="group" aria-label="Paciente">
          {session.family.map((p) => <button key={p.id} type="button" aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.firstName}{p.isMinor ? " (a tu cargo)" : ""}</button>)}
        </div>
      )}
      {tab === "citas" && session.family.length > 1 && <p className="small muted">Incluye las citas de los menores a tu cargo.</p>}
      {tab === "citas" && <Appointments slug={slug} who={null} onExpired={onLogout} />}
      {tab === "pagos" && <Payments slug={slug} patientId={who} note={paymentNote} />}
      {tab === "presupuestos" && <Budgets slug={slug} patientId={who} />}
      {tab === "citas" && <MessagesOptOut slug={slug} session={session} />}
      <Sticky label="Reservar otra cita" onClick={() => { window.location.href = `/reservar/${slug}`; }} />
    </Shell>
  );
}

function useLoad<T>(slug: string, path: string | null, onExpired?: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    if (!path) return;
    papi(slug).get<T>(path).then((d) => { setData(d); setErr(null); }).catch((e) => { if (e.status === 401 && onExpired) onExpired(); else setErr(e.message); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [path]);
  return { data, err, reload: load };
}

function Appointments({ slug, who, onExpired }: { slug: string; who: string | null; onExpired: () => void }) {
  const { data, err, reload } = useLoad<any>(slug, "/me/appointments", onExpired);
  // ?reprogramar=<cita> (botón «Necesito reprogramar» del enlace de confirmación): abre el cambio de horario.
  const [acting, setActing] = useState<{ id: string; kind: "cancel" | "move" } | null>(() => {
    const id = new URLSearchParams(window.location.search).get("reprogramar");
    return id ? { id, kind: "move" } : null;
  });
  const [msg, setMsg] = useState<string | null>(null);
  if (err) return <ErrorBox text={err} />;
  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  const mine = (a: any) => !who || a.patientId === who;
  const up = data.upcoming.filter(mine), past = data.past.filter(mine), req = data.requests.filter(mine);
  const done = (text: string) => { setActing(null); setMsg(text); reload(); };
  return (
    <div className="stack">
      {msg && <div className="alert ok" role="status">{msg}</div>}
      <h2>Próximas citas</h2>
      {!up.length && <p className="muted">No tienes citas por venir.</p>}
      {up.map((a: any) => (
        <div key={a.id} className="pt-card">
          <div className="pt-between"><b>{a.date}</b><span className="badge info">{a.statusLabel}</span></div>
          <dl className="pt-dl">
            <dt>Hora</dt><dd>{a.time}</dd>
            <dt>Paciente</dt><dd>{a.patientName}</dd>
            <dt>Servicio</dt><dd>{a.service}</dd>
            <dt>Profesional</dt><dd>{a.dentistName}</dd>
            <dt>Sucursal</dt><dd>{a.branch.name}{a.branch.address ? <><br /><span className="muted">{a.branch.address}</span></> : null}</dd>
            {a.code && <><dt>Código</dt><dd>{a.code}</dd></>}
          </dl>
          <div className="pt-actions">
            <a className="btn" href={a.icsUrl} download><CalendarPlus size={18} />Agregar al calendario</a>
            <a className="btn" href={a.branch.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={18} />Cómo llegar</a>
            {a.branch.whatsappUrl && <a className="btn" href={a.branch.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} />WhatsApp de la sucursal</a>}
            {a.canChange && <button type="button" className="btn" onClick={() => setActing({ id: a.id, kind: "move" })}>Reprogramar</button>}
            {a.canChange && <button type="button" className="btn btn-danger" onClick={() => setActing({ id: a.id, kind: "cancel" })}>Cancelar cita</button>}
          </div>
          {!a.canChange && ["scheduled", "confirmed"].includes(a.status) && <p className="small muted">Para cambiar esta cita escribe a la sucursal por WhatsApp (ya pasó el plazo para hacerlo en línea).</p>}
          {acting?.id === a.id && acting?.kind === "cancel" && <CancelBox slug={slug} id={a.id} onCancel={() => setActing(null)} onDone={() => done("Cancelamos tu cita. Si quieres, reserva otra cuando te convenga.")} />}
          {a.canChange && acting?.id === a.id && acting?.kind === "move" && <MoveBox slug={slug} appt={a} onCancel={() => setActing(null)} onDone={(t) => done(`Listo, tu cita quedó para el ${t}.`)} />}
        </div>
      ))}
      {!!req.length && <h2>Solicitudes web</h2>}
      {req.map((b: any) => (
        <div key={b.id} className="pt-card">
          <div className="pt-between"><b>{b.date} · {b.time}</b><span className={`badge ${b.status === "rejected" ? "danger" : "warn"}`}>{b.status === "rejected" ? "No confirmada" : "Pendiente"}</span></div>
          <p>{b.service} · {b.branch.name} · código {b.code}</p>
          <p className="small muted">{b.statusLabel}{b.decisionReason ? `. Motivo: ${b.decisionReason}` : ""}</p>
          {b.status === "pending" && <button type="button" className="btn btn-sm" onClick={async () => { await papi(slug).post(`/me/bookings/${b.id}/cancel`).catch(() => {}); done("Retiramos tu solicitud."); }}>Retirar solicitud</button>}
        </div>
      ))}
      <h2>Historial</h2>
      {!past.length && <p className="muted">Sin citas anteriores.</p>}
      {!!past.length && (
        <div className="pt-card" style={{ gap: 0 }}>
          {past.map((a: any) => (
            <div key={a.id} className="pt-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <span><b>{fmtDateShort(a.startsAt)}</b> {a.time}<br /><span className="small muted">{a.service} · {a.patientName}</span></span>
              <span className={`badge ${a.status === "completed" ? "ok" : a.status === "cancelled" || a.status === "no_show" ? "danger" : ""}`}>{a.statusLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** «Dejar de recibir mensajes»: un clic revoca recordatorios y promociones (queda registrado como revocación). */
function MessagesOptOut({ slug, session }: { slug: string; session: Session }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const receiving = session.family.some((p) => p.consentReminders || p.consentMarketing);
  const go = async () => {
    setState("busy"); setErr(null);
    try { await papi(slug).post("/me/messages/opt-out"); setState("done"); }
    catch (e) { setErr((e as Error).message); setState("idle"); }
  };
  return (
    <div className="pt-card" role="region" aria-label="Mensajes de la clínica">
      <h2>Mensajes de la clínica</h2>
      {state === "done" ? <p className="alert ok" role="status">Listo: ya no te enviaremos recordatorios ni promociones. Si cambias de opinión, avísanos en la clínica.</p>
        : !receiving ? <p className="muted">No recibes recordatorios ni promociones automáticas.</p>
        : <>
          <p className="small muted">Recibes recordatorios de tus citas{session.family.some((p) => p.consentMarketing) ? " y promociones" : ""} por WhatsApp. Puedes dejar de recibirlos cuando quieras.</p>
          <ErrorBox text={err} />
          <button type="button" className="btn" disabled={state === "busy"} onClick={go}>{state === "busy" ? "Un momento…" : "Dejar de recibir mensajes"}</button>
        </>}
    </div>
  );
}

function CancelBox({ slug, id, onCancel, onDone }: { slug: string; id: string; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await papi(slug).post(`/me/appointments/${id}/cancel`, { reason: reason || undefined }); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" role="group" aria-label="Cancelar cita">
      <label className="field"><span className="label">Motivo (opcional)</span><input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
      <ErrorBox text={err} />
      <div className="pt-actions">
        <button type="button" className="btn" onClick={onCancel}>No, mantener la cita</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={go}>{busy ? "Un momento…" : "Sí, cancelar la cita"}</button>
      </div>
    </div>
  );
}

function MoveBox({ slug, appt, onCancel, onDone }: { slug: string; appt: any; onCancel: () => void; onDone: (when: string) => void }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!slot) return;
    setBusy(true); setErr(null);
    try { const r = await papi(slug).post(`/me/appointments/${appt.id}/reschedule`, { startsAt: slot.startsAt, dentistId: slot.dentistId }); onDone(`${r.date} a las ${r.time}`); }
    catch (e) { setErr((e as Error).message); setSlot(null); } finally { setBusy(false); }
  };
  return (
    <div className="stack" role="group" aria-label="Reprogramar cita">
      <b>Elige el nuevo horario</b>
      <SlotPicker slug={slug} branchId={appt.branch.id} procedureId={appt.procedureId} rescheduleId={appt.id} value={slot} onChange={setSlot} />
      {slot && <p className="small">Te atenderá: <b>{slot.dentistName}</b></p>}
      <ErrorBox text={err} />
      <div className="pt-actions">
        <button type="button" className="btn" onClick={onCancel}>Volver</button>
        <button type="button" className="btn btn-primary" disabled={!slot || busy} onClick={go}>{busy ? "Un momento…" : "Confirmar el cambio"}</button>
      </div>
    </div>
  );
}

function Payments({ slug, patientId, note }: { slug: string; patientId: string; note: string }) {
  const { data, err } = useLoad<any>(slug, `/me/account${qs({ patientId })}`);
  if (err) return <ErrorBox text={err} />;
  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  const bal = data.balanceCents;
  return (
    <div className="stack">
      <div className="pt-card">
        <span className="muted">Saldo</span>
        <span className="pt-balance">{bal > 0 ? `Debes ${bs(bal)}` : bal < 0 ? `Tienes a favor ${bs(-bal)}` : "Estás al día"}</span>
        <dl className="pt-dl">
          <dt>Tratamientos realizados</dt><dd>{bs(data.chargedCents)}</dd>
          <dt>Pagado y confirmado</dt><dd>{bs(data.paidCents)}</dd>
          {data.pendingVerificationCents > 0 && <><dt>En verificación</dt><dd>{bs(data.pendingVerificationCents)} <span className="small muted">(no se descuenta hasta que la clínica lo confirme)</span></dd></>}
        </dl>
      </div>
      <div className="alert info">{note}</div>
      <h2>Pagos</h2>
      {!data.payments.length && <p className="muted">Todavía no hay pagos registrados.</p>}
      {data.payments.map((p: any) => (
        <div key={p.id} className="pt-card">
          <div className="pt-between"><b>{bs(p.amountCents)}</b><span className={`badge ${p.status === "confirmed" ? "ok" : p.status === "pending_verification" ? "warn" : "danger"}`}>{p.statusLabel}</span></div>
          <p className="small muted">{fmtDateShort(p.receivedAt)} · {p.methodLabel} · {p.branchName} · recibo N° {p.receiptNumber}</p>
          {p.status === "confirmed" && <Link className="btn btn-sm" to={`/mi-cuenta/${slug}/recibo/${p.id}`}>Ver comprobante</Link>}
        </div>
      ))}
    </div>
  );
}

function Budgets({ slug, patientId }: { slug: string; patientId: string }) {
  const { data, err } = useLoad<any[]>(slug, `/me/budgets${qs({ patientId })}`);
  if (err) return <ErrorBox text={err} />;
  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  if (!data.length) return <p className="muted">No hay presupuestos presentados o aceptados.</p>;
  return (
    <div className="stack">
      {data.map((b) => (
        <div key={b.id} className="pt-card">
          <div className="pt-between"><b>Presupuesto N° {b.number}</b><span className={`badge ${b.status === "accepted" ? "ok" : "info"}`}>{b.status === "accepted" ? "Aceptado" : "Presentado"}</span></div>
          <p className="small muted">{fmtDateShort(b.date)} · {b.dentistName} · {b.branchName}{b.installments > 1 ? ` · ${b.installments} cuotas` : ""}</p>
          {b.items.map((i: any, k: number) => (
            <div key={k} className="pt-between small"><span>{i.description}{i.tooth ? ` (pieza ${i.tooth})` : ""}{i.quantity > 1 ? ` × ${i.quantity}` : ""}{i.done ? " · realizado" : ""}</span><b>{bs(i.totalCents)}</b></div>
          ))}
          {b.discountCents > 0 && <div className="pt-between small"><span>Descuento</span><b>−{bs(b.discountCents)}</b></div>}
          <div className="pt-between"><span>Total</span><b>{bs(b.totalCents)}</b></div>
          <div className="pt-between small"><span>Pagado</span><span>{bs(b.paidCents)}</span></div>
          <div className="pt-between small"><span>Pendiente</span><span>{bs(b.pendingCents)}</span></div>
          {b.status === "presented" && <p className="small muted">Para aceptarlo o hacer preguntas, habla con tu profesional en la clínica.</p>}
        </div>
      ))}
    </div>
  );
}

export function ReceiptPage() {
  const { slug = "", id = "" } = useParams();
  const { data, err } = useLoad<any>(slug, `/me/payments/${id}`);
  return (
    <Shell clinic={data?.clinicName ?? "Comprobante"} sub="Comprobante de pago">
      <div className="no-print pt-row">
        <Link className="btn btn-sm" to={`/mi-cuenta/${slug}`}>← Volver</Link>
        {data && <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>Imprimir o guardar PDF</button>}
      </div>
      <ErrorBox text={err} />
      {data && (
        <div className="pt-receipt stack">
          <div><b>{data.legalName ?? data.clinicName}</b>{data.taxId && <div className="small muted">NIT {data.taxId}</div>}<div className="small muted">{data.branchName}{data.branchAddress ? ` · ${data.branchAddress}` : ""}</div></div>
          <h1>Comprobante de pago N° {data.receiptNumber}</h1>
          <dl className="pt-dl">
            <dt>Fecha</dt><dd>{fmtDateShort(data.receivedAt)}</dd>
            <dt>Paciente</dt><dd>{data.patientName} (ficha {data.recordNumber})</dd>
            <dt>Monto</dt><dd>{bs(data.amountCents)}</dd>
            <dt>Medio</dt><dd>{data.method}</dd>
            {data.budgetNumber && <><dt>Presupuesto</dt><dd>N° {data.budgetNumber}</dd></>}
            <dt>Saldo actual</dt><dd>{data.balanceCents > 0 ? `Debe ${bs(data.balanceCents)}` : data.balanceCents < 0 ? `A favor ${bs(-data.balanceCents)}` : "Al día"}</dd>
          </dl>
          <p className="small muted">{data.note}</p>
        </div>
      )}
    </Shell>
  );
}
