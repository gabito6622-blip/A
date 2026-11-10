// /reservar/:slug — embudo de reserva: sucursal → servicio → profesional → día y hora →
// tus datos (código por WhatsApp) → revisión → confirmación.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarPlus, MapPin, MessageCircle } from "lucide-react";
import { newKey, papi, qs, PortalError, type Info, type Session } from "./api";
import { ErrorBox, ExistingForm, OtpForm, Progress, Shell, SignupForm, SlotPicker, Sticky, bs, fmtTime, type Slot } from "./shared";

const LABELS = ["Sucursal", "Servicio", "Profesional", "Día y hora", "Tus datos", "Revisión", "Listo"];

export function NotAvailable({ text }: { text?: string }) {
  return (
    <Shell clinic="Reserva en línea">
      <h1>Página no disponible</h1>
      <p>{text ?? "Esta clínica no tiene activa la reserva en línea o la dirección no es correcta. Comunícate con la clínica por teléfono o WhatsApp."}</p>
    </Shell>
  );
}

export function useInfo(slug: string) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<PortalError | null>(null);
  const load = () => papi(slug).get<Info>("/info").then((i) => { setInfo(i); setError(null); }).catch((e) => setError(e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [slug]);
  return { info, error, reload: load, setInfo };
}

export function BookingPage() {
  const { slug = "" } = useParams();
  const { info, error, setInfo } = useInfo(slug);
  if (error) return error.status === 404 ? <NotAvailable /> : <NotAvailable text={error.message} />;
  if (!info) return <Shell clinic="Cargando…"><div className="skeleton" style={{ height: 60 }} /><div className="skeleton" style={{ height: 60 }} /></Shell>;
  return <Funnel slug={slug} info={info} onSession={(s) => setInfo({ ...info, session: s })} />;
}

function Funnel({ slug, info, onSession }: { slug: string; info: Info; onSession: (s: Session | null) => void }) {
  const api = papi(slug);
  const preBranch = new URLSearchParams(window.location.search).get("sucursal");
  const initialBranch = info.branches.find((b) => b.id === preBranch)?.id ?? (info.branches.length === 1 ? info.branches[0]!.id : null);
  const [step, setStepRaw] = useState(initialBranch ? 1 : 0);
  const [furthest, setFurthest] = useState(step);
  const [branchId, setBranchId] = useState<string | null>(initialBranch);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [dentist, setDentist] = useState<string>("any");
  const [dentists, setDentists] = useState<{ id: string; name: string }[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [hold, setHold] = useState<{ holdToken: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<any | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const setStep = (n: number) => { setStepRaw(n); setFurthest((f) => Math.max(f, n)); setErr(null); top.current?.scrollIntoView({ block: "start" }); };
  const branch = info.branches.find((b) => b.id === branchId) ?? null;
  const service = info.services.find((s) => s.id === serviceId) ?? null;

  useEffect(() => {
    if (!branchId) return;
    setDentists(null);
    api.get(`/dentists${qs({ branchId })}`).then(setDentists).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const summary = [branch?.name, service ? `${service.name} · ${service.durationMin} min` : null, slot ? `${fmtTime(slot.startsAt)}` : null].filter(Boolean).join(" · ");

  const holdSlot = async () => {
    if (!slot || !branchId || !serviceId) return;
    setBusy(true); setErr(null);
    try {
      const h = await api.post("/holds", { branchId, procedureId: serviceId, dentistId: slot.dentistId, startsAt: slot.startsAt, releaseToken: hold?.holdToken });
      setHold(h);
      setStep(info.session ? 5 : 4);
    } catch (e) {
      setErr((e as Error).message);
      setSlot(null);
    } finally { setBusy(false); }
  };

  return (
    <Shell clinic={info.clinic.name} sub="Reserva tu cita en línea"
      right={<a href={`/mi-cuenta/${slug}`} className="small">Mis citas</a>}>
      <div ref={top} />
      {step < 6 && <Progress step={step} furthest={furthest} labels={LABELS} />}
      {step > 0 && step < 6 && !(step === 1 && preBranch && initialBranch) && (
        <button type="button" className="pt-link" style={{ alignSelf: "flex-start" }} onClick={() => setStep(step === 5 && info.session ? 3 : step - 1)}>← Volver</button>
      )}
      <ErrorBox text={err} />

      {step === 0 && (
        <>
          <h1>¿En qué sucursal te quieres atender?</h1>
          <div className="pt-list" role="group" aria-label="Sucursales">
            {info.branches.map((b) => (
              <button key={b.id} type="button" className="pt-option" aria-pressed={branchId === b.id} onClick={() => { setBranchId(b.id); setSlot(null); setDentist("any"); }}>
                <MapPin size={22} aria-hidden="true" />
                <span className="grow"><b>{b.name}</b><small>{[b.address, b.city].filter(Boolean).join(", ") || "Dirección no registrada"}</small></span>
              </button>
            ))}
          </div>
          {branch && <a className="small" href={branch.mapUrl} target="_blank" rel="noopener noreferrer">Ver {branch.name} en el mapa</a>}
          <Sticky summary={summary} label="Continuar" disabled={!branchId} onClick={() => setStep(1)} />
        </>
      )}

      {step === 1 && (
        <>
          <h1>¿Qué necesitas?</h1>
          <div className="pt-list" role="group" aria-label="Servicios">
            {info.services.map((s) => (
              <button key={s.id} type="button" className="pt-option" aria-pressed={serviceId === s.id} onClick={() => { setServiceId(s.id); setSlot(null); }}>
                <span className="grow"><b>{s.name}</b><small>{s.durationMin} minutos{s.priceFromCents != null ? ` · desde ${bs(s.priceFromCents)}` : ""}</small></span>
              </button>
            ))}
          </div>
          {info.services.some((s) => s.priceFromCents != null) && <p className="muted small">El precio final lo confirma el profesional después de revisarte.</p>}
          <Sticky summary={summary} label="Continuar" disabled={!serviceId} onClick={() => setStep(2)} />
        </>
      )}

      {step === 2 && (
        <>
          <h1>¿Con quién?</h1>
          {!dentists ? <div className="skeleton" style={{ height: 60 }} /> : (
            <div className="pt-list" role="group" aria-label="Profesionales">
              <button type="button" className="pt-option" aria-pressed={dentist === "any"} onClick={() => { setDentist("any"); setSlot(null); }}>
                <span className="grow"><b>Cualquier profesional</b><small>Te mostramos más horarios</small></span>
              </button>
              {dentists.map((d) => (
                <button key={d.id} type="button" className="pt-option" aria-pressed={dentist === d.id} onClick={() => { setDentist(d.id); setSlot(null); }}>
                  <span className="grow"><b>{d.name}</b></span>
                </button>
              ))}
              {!dentists.length && <div className="alert warn">Por ahora ningún profesional tiene horario en línea en esta sucursal. Escríbenos por WhatsApp.</div>}
            </div>
          )}
          <Sticky summary={summary} label="Ver horarios" disabled={!dentists?.length} onClick={() => setStep(3)} />
        </>
      )}

      {step === 3 && branchId && serviceId && (
        <>
          <h1>Elige día y hora</h1>
          <p className="muted small">Horarios de Bolivia (La Paz). Se reserva con al menos {info.rules.leadTimeHours} h de anticipación y hasta {info.rules.maxDaysAhead} días adelante.</p>
          <SlotPicker slug={slug} branchId={branchId} procedureId={serviceId} dentistId={dentist === "any" ? null : dentist} holdToken={hold?.holdToken} value={slot} onChange={setSlot} />
          {slot && dentist === "any" && <p className="small">Te atenderá: <b>{slot.dentistName}</b></p>}
          <Sticky summary={summary} label="Continuar" disabled={!slot} busy={busy} onClick={holdSlot} />
        </>
      )}

      {step === 4 && (
        <Identify slug={slug} branchId={branchId} helpUrl={branch?.whatsappUrl ?? null} onDone={(s) => { onSession(s); setStep(5); }} />
      )}

      {step === 5 && branchId && serviceId && slot && info.session && (
        <Review slug={slug} info={info} branchId={branchId} serviceId={serviceId} slot={slot} hold={hold} session={info.session}
          onLogout={async () => { await api.post("/auth/logout").catch(() => {}); onSession(null); setStep(4); }}
          onUnavailable={() => { setSlot(null); setStep(3); }}
          onBooked={(b) => { setBooking(b); setStep(6); }} />
      )}

      {step === 6 && booking && <Confirmation booking={booking} />}
    </Shell>
  );
}

function Identify({ slug, branchId, helpUrl, onDone }: { slug: string; branchId: string | null; helpUrl: string | null; onDone: (s: Session) => void }) {
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [ch, setCh] = useState<{ c: { challengeId: string; message: string }; resend: () => Promise<{ challengeId: string; message: string }> } | null>(null);
  if (ch) return (
    <>
      <h1>Escribe el código</h1>
      <OtpForm slug={slug} challenge={ch.c} resend={ch.resend} onVerified={onDone} onBack={() => setCh(null)} helpUrl={helpUrl} />
    </>
  );
  return (
    <>
      <h1>¿Quién se va a atender?</h1>
      <div className="pt-seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "existing"} onClick={() => setTab("existing")}>Ya me atendí aquí</button>
        <button type="button" role="tab" aria-selected={tab === "new"} onClick={() => setTab("new")}>Es mi primera vez</button>
      </div>
      {tab === "existing"
        ? <ExistingForm slug={slug} onChallenge={(c, resend) => setCh({ c, resend })} />
        : <SignupForm slug={slug} branchId={branchId} onChallenge={(c, resend) => setCh({ c, resend })} />}
      <p className="muted small">¿Reservas para tu hijo o hija? Usa sus datos; el código llegará a tu celular de responsable.</p>
    </>
  );
}

function Review({ slug, info, branchId, serviceId, slot, hold, session, onLogout, onUnavailable, onBooked }: {
  slug: string; info: Info; branchId: string; serviceId: string; slot: Slot; hold: { holdToken: string; expiresAt: string } | null; session: Session;
  onLogout: () => void; onUnavailable: () => void; onBooked: (b: any) => void;
}) {
  const api = papi(slug);
  const [rv, setRv] = useState<any | null>(null);
  const [patientId, setPatientId] = useState(session.patient?.id ?? session.family[0]?.id ?? "");
  const member = session.family.find((p) => p.id === patientId);
  const [consents, setConsents] = useState({ dataProcessing: false, reminders: !!member?.consentReminders, marketing: false });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  useEffect(() => {
    api.get(`/review${qs({ branchId, procedureId: serviceId, dentistId: slot.dentistId, startsAt: slot.startsAt, holdToken: hold?.holdToken })}`).then(setRv).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const holdUntil = useMemo(() => (hold ? fmtTime(hold.expiresAt) : null), [hold]);
  const submit = async () => {
    const v: Record<string, string> = {};
    if (!consents.dataProcessing) v.dataProcessing = "Para reservar necesitamos tu autorización para usar tus datos";
    if (!patientId) v.patientId = "Elige para quién es la cita";
    setErrs(v); setErr(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      onBooked(await api.post("/bookings", { branchId, procedureId: serviceId, dentistId: slot.dentistId, startsAt: slot.startsAt, patientId, holdToken: hold?.holdToken, idempotencyKey: key.current, consents }));
    } catch (e) {
      const pe = e as PortalError;
      if (["slot_taken", "slot_past", "slot_too_soon"].includes(pe.code)) { setErr(`${pe.message}`); key.current = newKey(); }
      else setErr(pe.message);
    } finally { setBusy(false); }
  };
  if (!rv) return <><ErrorBox text={err} /><div className="skeleton" style={{ height: 200 }} /></>;
  const request = rv.mode === "request";
  return (
    <>
      <h1>Revisa tu {request ? "solicitud" : "reserva"}</h1>
      {!rv.available && (
        <div className="alert warn" role="alert">
          {rv.unavailableReason} <button type="button" className="pt-link" onClick={onUnavailable}>Elegir otro horario</button>
        </div>
      )}
      <div className="pt-card">
        <dl className="pt-dl">
          <dt>Servicio</dt><dd>{rv.service.name}</dd>
          <dt>Profesional</dt><dd>{rv.dentist.name}</dd>
          <dt>Sucursal</dt><dd>{rv.branch.name}{rv.branch.address ? <><br /><span className="muted">{rv.branch.address}</span></> : null}</dd>
          <dt>Fecha</dt><dd>{rv.date}</dd>
          <dt>Hora</dt><dd>{rv.time} (dura {rv.durationMin} min)</dd>
          {rv.priceFromCents != null && <><dt>Precio</dt><dd>Desde {bs(rv.priceFromCents)}</dd></>}
        </dl>
        {rv.instructions && <p><b>Indicaciones:</b> {rv.instructions}</p>}
        <p className="small muted">{rv.cancellationPolicy}</p>
        <p className="small muted">{rv.paymentNote}</p>
        {request && <div className="alert info">En esta sucursal la cita queda confirmada cuando recepción revisa tu solicitud. Te avisaremos por WhatsApp.</div>}
        {holdUntil && rv.available && <p className="small muted">Apartamos este horario para ti hasta las {holdUntil}.</p>}
      </div>

      <div className="pt-card">
        {session.family.length > 1 ? (
          <div className="field" role="radiogroup" aria-label="¿Para quién es la cita?">
            <span className="label">¿Para quién es la cita?</span>
            {session.family.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={patientId === p.id} className="pt-option" onClick={() => setPatientId(p.id)}>
                <span className="grow"><b>{p.firstName} {p.lastName}</b>{p.isMinor && <small>Menor de edad a tu cargo</small>}</span>
              </button>
            ))}
            {errs.patientId && <span className="field-error">{errs.patientId}</span>}
          </div>
        ) : <p>Paciente: <b>{member?.firstName} {member?.lastName}</b></p>}
        <p className="small muted">Ingresaste con el celular {session.phoneMasked}. <button type="button" className="pt-link" onClick={onLogout}>No soy yo</button></p>
      </div>

      <div className="pt-card" role="group" aria-label="Autorizaciones">
        <b>Autorizaciones</b>
        <label className="check"><input type="checkbox" checked={consents.dataProcessing} onChange={(e) => setConsents({ ...consents, dataProcessing: e.target.checked })} />
          <span>Autorizo a {info.clinic.name} a usar mis datos personales y de salud para atenderme y gestionar esta cita. <b>(obligatorio)</b></span></label>
        {errs.dataProcessing && <span className="field-error" role="alert">{errs.dataProcessing}</span>}
        <label className="check"><input type="checkbox" checked={consents.reminders} onChange={(e) => setConsents({ ...consents, reminders: e.target.checked })} />
          <span>Quiero recibir recordatorios de mis citas por WhatsApp (opcional).</span></label>
        <label className="check"><input type="checkbox" checked={consents.marketing} onChange={(e) => setConsents({ ...consents, marketing: e.target.checked })} />
          <span>Quiero recibir promociones y novedades (opcional).</span></label>
        <p className="small muted">Puedes cambiar estas autorizaciones cuando quieras en la clínica.</p>
      </div>
      <ErrorBox text={err} />
      <Sticky summary={`${rv.date} · ${rv.time} · ${rv.branch.name}`} label={request ? "Enviar solicitud" : "Confirmar reserva"} busy={busy} disabled={!rv.available} onClick={submit} />
    </>
  );
}

export function Confirmation({ booking: b }: { booking: any }) {
  const ok = b.status === "confirmed" || b.status === "approved";
  return (
    <>
      <div className={`alert ${ok ? "ok" : "info"}`} role="status">
        <b>{ok ? "¡Listo! Tu cita quedó reservada." : "Solicitud enviada."}</b>{" "}
        {ok ? "Te enviamos la confirmación por WhatsApp." : "La sucursal la revisará y te confirmará por WhatsApp. Aún no es una cita confirmada."}
      </div>
      <div className="pt-card">
        <span className="muted small">Código de reserva</span>
        <span className="pt-code">{b.code}</span>
        <dl className="pt-dl">
          <dt>Paciente</dt><dd>{b.patientName}</dd>
          <dt>Servicio</dt><dd>{b.service}</dd>
          <dt>Profesional</dt><dd>{b.dentistName ?? "Por asignar"}</dd>
          <dt>Fecha</dt><dd>{b.date}</dd>
          <dt>Hora</dt><dd>{b.time} ({b.durationMin} min)</dd>
          <dt>Sucursal</dt><dd>{b.branch.name}{b.branch.address ? <><br /><span className="muted">{b.branch.address}</span></> : null}</dd>
          <dt>Estado</dt><dd>{b.statusLabel}</dd>
          {b.priceFromCents != null && <><dt>Precio</dt><dd>Desde {bs(b.priceFromCents)}</dd></>}
        </dl>
        {b.instructions && <p><b>Indicaciones:</b> {b.instructions}</p>}
        <p className="small muted">{b.cancellationPolicy}</p>
      </div>
      <div className="pt-actions">
        {b.icsUrl && <a className="btn" href={b.icsUrl} download><CalendarPlus size={18} />Agregar al calendario</a>}
        <a className="btn" href={b.branch.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={18} />Cómo llegar</a>
        {b.branch.whatsappUrl && <a className="btn" href={b.branch.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} />WhatsApp de {b.branch.name}</a>}
        <a className="btn btn-primary" href={b.portalUrl}>Ver, reprogramar o cancelar</a>
      </div>
    </>
  );
}
