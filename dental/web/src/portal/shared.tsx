// Componentes del lado del paciente: marco con la marca de la clínica, barra de acción fija,
// progreso, fecha de nacimiento en 3 campos, identificación por código y selector de horario.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { papi, qs, PortalError, type Session } from "./api";
import "./portal.css";

export const TZ = "America/La_Paz";
export const bs = (cents: number | null | undefined) =>
  cents == null ? "—" : new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(cents / 100).replace("BOB", "Bs");
export const fmtTime = (iso: string) => new Intl.DateTimeFormat("es-BO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const fmtDateShort = (iso: string) => new Intl.DateTimeFormat("es-BO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtDayLong = (date: string) => cap(new Intl.DateTimeFormat("es-BO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z")));

/** URL del logo de la clínica en el portal (B-096), o null si no tiene. */
export const portalLogoUrl = (info: { clinic: { slug: string; logoVersion?: string | null } }) =>
  info.clinic.logoVersion ? `/api/public/c/${encodeURIComponent(info.clinic.slug)}/logo?v=${info.clinic.logoVersion}` : null;

export function Shell({ clinic, sub, children, right, logo }: { clinic: string; sub?: string; children: ReactNode; right?: ReactNode; logo?: string | null }) {
  useEffect(() => { document.title = `${clinic} · ${sub ?? "Reserva"}`; }, [clinic, sub]);
  return (
    <div className="pt">
      <header className="pt-head">
        <div className="pt-head-in">
          {logo && <img className="pt-logo" src={logo} alt="" />}
          <div className="grow"><b>{clinic}</b>{sub && <small>{sub}</small>}</div>
          {right}
        </div>
      </header>
      <main className="pt-main">{children}</main>
    </div>
  );
}

export function Sticky({ summary, label, onClick, disabled, busy, secondary }: { summary?: ReactNode; label: string; onClick?: () => void; disabled?: boolean; busy?: boolean; secondary?: ReactNode }) {
  return (
    <div className="pt-sticky">
      <div className="pt-sticky-in">
        {summary && <div className="pt-sticky-summary">{summary}</div>}
        <button type={onClick ? "button" : "submit"} className="btn btn-primary" disabled={disabled || busy} onClick={onClick} aria-busy={busy || undefined}>
          {busy ? "Un momento…" : label}
        </button>
        {secondary}
      </div>
    </div>
  );
}

export function Progress({ step, furthest, labels }: { step: number; furthest: number; labels: string[] }) {
  const pct = Math.round(((Math.max(step, furthest) + 1) / labels.length) * 100);
  return (
    <div className="pt-progress" aria-label="Progreso de la reserva">
      <div className="pt-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
      <div className="pt-progress-label">Paso {step + 1} de {labels.length}: {labels[step]}</div>
    </div>
  );
}

export function FieldBox({ label, error, hint, children, id }: { label: string; error?: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <div className="field" id={id}>
      <label style={{ display: "contents" }}>
        <span className="label">{label}</span>
        {children}
      </label>
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

export function ErrorBox({ text }: { text: string | null }) {
  return text ? <div className="alert danger" role="alert">{text}</div> : null;
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Fecha de nacimiento en tres campos (más fácil que un calendario para personas mayores). Devuelve AAAA-MM-DD o "". */
export function BirthDate({ value, onChange, error, label = "Fecha de nacimiento" }: { value: string; onChange: (v: string) => void; error?: string; label?: string }) {
  const [d, setD] = useState(value ? String(Number(value.slice(8, 10))) : "");
  const [m, setM] = useState(value ? String(Number(value.slice(5, 7))) : "");
  const [y, setY] = useState(value ? value.slice(0, 4) : "");
  useEffect(() => {
    const dd = Number(d), mm = Number(m), yy = Number(y);
    if (!dd || !mm || y.length !== 4) return onChange("");
    const iso = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const dt = new Date(iso + "T00:00:00Z");
    onChange(dt.getUTCDate() === dd && dt.getUTCMonth() + 1 === mm ? iso : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, m, y]);
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="label">{label}</span>
      <div className="pt-birth">
        <input className="input" aria-label="Día" inputMode="numeric" autoComplete="bday-day" placeholder="Día" maxLength={2} value={d} aria-invalid={!!error} onChange={(e) => setD(e.target.value.replace(/\D/g, ""))} />
        <select className="input" aria-label="Mes" autoComplete="bday-month" value={m} aria-invalid={!!error} onChange={(e) => setM(e.target.value)}>
          <option value="">Mes</option>
          {MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}
        </select>
        <input className="input" aria-label="Año" inputMode="numeric" autoComplete="bday-year" placeholder="Año" maxLength={4} value={y} aria-invalid={!!error} onChange={(e) => setY(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

export const isMinor = (birth: string) => {
  if (!birth) return false;
  const b = new Date(birth + "T00:00:00Z"), n = new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a < 18;
};

interface Challenge { challengeId: string; message: string }

/** Ingreso de paciente existente: CI + fecha de nacimiento → código por WhatsApp. */
export function ExistingForm({ slug, onChallenge, submitLabel = "Enviarme el código" }: { slug: string; onChallenge: (c: Challenge, resend: () => Promise<Challenge>) => void; submitLabel?: string }) {
  const [ci, setCi] = useState("");
  const [birth, setBirth] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = () => papi(slug).post<Challenge>("/auth/existing", { documentNumber: ci, birthDate: birth });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (ci.replace(/\W/g, "").length < 4) v.documentNumber = "Escribe tu número de carnet (CI)";
    if (!birth) v.birthDate = "Completa día, mes y año de nacimiento";
    setErrs(v); setErr(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try { onChallenge(await send(), send); }
    catch (x) { const pe = x as PortalError; setErrs(pe.fields?.() ?? {}); setErr(pe.message); }
    finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <FieldBox label="Número de carnet (CI)" error={errs.documentNumber} hint="Sin extensión del departamento. Ej.: 4876512">
        <input className="input" inputMode="text" autoComplete="off" value={ci} aria-invalid={!!errs.documentNumber} onChange={(e) => setCi(e.target.value)} />
      </FieldBox>
      <BirthDate value={birth} onChange={setBirth} error={errs.birthDate} />
      <p className="muted small">Te enviaremos un código de 6 dígitos por WhatsApp al celular que la clínica tiene registrado. No necesitas contraseña.</p>
      <ErrorBox text={err} />
      <Sticky label={submitLabel} busy={busy} />
    </form>
  );
}

/** Paciente nuevo: datos mínimos (y responsable si es menor) → código al celular indicado. */
export function SignupForm({ slug, branchId, onChallenge }: { slug: string; branchId?: string | null; onChallenge: (c: Challenge, resend: () => Promise<Challenge>) => void }) {
  const [f, setF] = useState({ firstName: "", lastName: "", documentNumber: "", noDocument: false, birthDate: "", phone: "", guardianName: "", guardianRelationship: "Madre" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minor = isMinor(f.birthDate);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const payload = () => ({
    firstName: f.firstName, lastName: f.lastName, birthDate: f.birthDate, phone: f.phone, branchId: branchId ?? null,
    documentNumber: minor && f.noDocument ? null : f.documentNumber || null,
    guardianName: minor ? f.guardianName : null, guardianRelationship: minor ? f.guardianRelationship : null,
  });
  const send = () => papi(slug).post<Challenge>("/auth/signup", payload());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!f.firstName.trim()) v.firstName = "Escribe el nombre";
    if (!f.lastName.trim()) v.lastName = "Escribe el apellido";
    if (!f.birthDate) v.birthDate = "Completa día, mes y año de nacimiento";
    else if (f.birthDate > new Date().toISOString().slice(0, 10)) v.birthDate = "La fecha de nacimiento no puede ser futura";
    if (!(minor && f.noDocument) && f.documentNumber.replace(/\W/g, "").length < 4) v.documentNumber = minor ? "Escribe el CI del niño o marca que no tiene" : "Escribe tu número de carnet (CI)";
    if (minor && !f.guardianName.trim()) v.guardianName = "Escribe el nombre de la madre, padre o responsable";
    if (!/^(\+?591)?[67]\d{7}$/.test(f.phone.replace(/[\s-]/g, "")) && !/^\+\d{8,15}$/.test(f.phone.replace(/[\s-]/g, ""))) v.phone = "Escribe un celular válido (8 dígitos, por ejemplo 71234567)";
    setErrs(v); setErr(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try { onChallenge(await send(), send); }
    catch (x) { const pe = x as PortalError; setErrs(pe.fields?.() ?? {}); setErr(pe.message); }
    finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <p className="muted">Escribe los datos de la persona que se va a atender.</p>
      <FieldBox label="Nombres" error={errs.firstName}><input className="input" autoComplete="given-name" value={f.firstName} aria-invalid={!!errs.firstName} onChange={set("firstName")} /></FieldBox>
      <FieldBox label="Apellidos" error={errs.lastName}><input className="input" autoComplete="family-name" value={f.lastName} aria-invalid={!!errs.lastName} onChange={set("lastName")} /></FieldBox>
      <BirthDate value={f.birthDate} onChange={(v) => setF((x) => ({ ...x, birthDate: v }))} error={errs.birthDate} />
      {!(minor && f.noDocument) && (
        <FieldBox label={minor ? "Carnet (CI) del niño o niña" : "Número de carnet (CI)"} error={errs.documentNumber}>
          <input className="input" autoComplete="off" value={f.documentNumber} aria-invalid={!!errs.documentNumber} onChange={set("documentNumber")} />
        </FieldBox>
      )}
      {minor && <label className="check"><input type="checkbox" checked={f.noDocument} onChange={(e) => setF({ ...f, noDocument: e.target.checked })} />Todavía no tiene carnet</label>}
      {minor && (
        <div className="pt-card">
          <b>Datos del responsable</b>
          <FieldBox label="Nombre de la madre, padre o responsable" error={errs.guardianName}><input className="input" autoComplete="name" value={f.guardianName} aria-invalid={!!errs.guardianName} onChange={set("guardianName")} /></FieldBox>
          <FieldBox label="Parentesco">
            <select className="input" value={f.guardianRelationship} onChange={set("guardianRelationship")}>
              {["Madre", "Padre", "Tutor o tutora", "Abuela o abuelo", "Otro"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </FieldBox>
        </div>
      )}
      <FieldBox label={minor ? "Celular (WhatsApp) del responsable" : "Celular (WhatsApp)"} error={errs.phone} hint="Ahí llegará el código y la confirmación.">
        <input className="input" type="tel" inputMode="tel" autoComplete="tel-national" value={f.phone} aria-invalid={!!errs.phone} onChange={set("phone")} />
      </FieldBox>
      <ErrorBox text={err} />
      <Sticky label="Enviarme el código" busy={busy} />
    </form>
  );
}

/** Ingreso del código de 6 dígitos. */
export function OtpForm({ slug, challenge, resend, onVerified, onBack, helpUrl }: {
  slug: string; challenge: Challenge; resend: () => Promise<Challenge>; onVerified: (s: Session) => void; onBack: () => void; helpUrl?: string | null;
}) {
  const [ch, setCh] = useState(challenge);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(45);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setErr("El código tiene 6 dígitos");
    setBusy(true); setErr(null);
    try { onVerified(await papi(slug).post<Session>("/auth/verify", { challengeId: ch.challengeId, code })); }
    catch (x) { setErr((x as Error).message); setCode(""); }
    finally { setBusy(false); }
  };
  const again = async () => {
    setErr(null);
    try { setCh(await resend()); setWait(45); setCode(""); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="alert info">{ch.message}</div>
      <FieldBox label="Código de 6 dígitos" error={err ?? undefined}>
        <input ref={ref} className="input pt-otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
          aria-invalid={!!err} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      </FieldBox>
      <div className="pt-between">
        <button type="button" className="pt-link" onClick={onBack}>Corregir mis datos</button>
        <button type="button" className="pt-link" disabled={wait > 0} onClick={again}>{wait > 0 ? `Pedir otro código (${wait} s)` : "Pedir otro código"}</button>
      </div>
      {helpUrl && <p className="muted small">¿No te llega? <a href={helpUrl} target="_blank" rel="noopener noreferrer">Escribe a la sucursal por WhatsApp</a>.</p>}
      <Sticky label="Verificar código" busy={busy} disabled={code.length !== 6} />
    </form>
  );
}

export interface Slot { startsAt: string; endsAt: string; dentistId: string; dentistName: string }

/** Tira de días + horarios del día elegido (mismo motor que la agenda interna). */
export function SlotPicker({ slug, branchId, procedureId, dentistId, rescheduleId, holdToken, value, onChange }: {
  slug: string; branchId: string; procedureId?: string | null; dentistId?: string | null; rescheduleId?: string; holdToken?: string | null;
  value: Slot | null; onChange: (s: Slot | null) => void;
}) {
  const [days, setDays] = useState<{ date: string; count: number }[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [day, setDay] = useState<string | null>(value ? new Date(value.startsAt).toLocaleDateString("en-CA", { timeZone: TZ }) : null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const base = { branchId, procedureId: procedureId ?? undefined, dentistId: dentistId ?? undefined, rescheduleId };
  const loadDays = async (from?: string) => {
    try {
      const r = await papi(slug).get<{ days: { date: string; count: number }[]; hasMore: boolean }>(`/days${qs({ ...base, from })}`);
      setDays((d) => (from && d ? [...d, ...r.days] : r.days));
      setHasMore(r.hasMore);
      if (!from && !day) setDay(r.days.find((x) => x.count > 0)?.date ?? null);
    } catch (x) { setErr((x as Error).message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDays(null); loadDays(); }, [branchId, procedureId, dentistId, rescheduleId]);
  useEffect(() => {
    if (!day) { setSlots(null); return; }
    let live = true;
    setSlots(null);
    papi(slug).get<Slot[]>(`/slots${qs({ ...base, date: day, holdToken: holdToken ?? undefined })}`)
      .then((s) => live && setSlots(s)).catch((x) => live && setErr((x as Error).message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, branchId, procedureId, dentistId, rescheduleId]);
  const nextFrom = () => {
    const last = days?.[days.length - 1]?.date;
    if (!last) return undefined;
    const d = new Date(last + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const groups = [
    { label: "Mañana", f: (h: number) => h < 12 },
    { label: "Tarde", f: (h: number) => h >= 12 && h < 18 },
    { label: "Noche", f: (h: number) => h >= 18 },
  ];
  const none = days && !days.some((d) => d.count > 0);
  return (
    <div className="stack">
      <ErrorBox text={err} />
      {!days ? <div className="skeleton" style={{ height: 76 }} /> : (
        <div className="pt-days" role="group" aria-label="Días disponibles">
          {days.map((d) => {
            const dt = new Date(d.date + "T12:00:00Z");
            const wd = new Intl.DateTimeFormat("es-BO", { timeZone: "UTC", weekday: "short" }).format(dt).replace(".", "");
            const mo = new Intl.DateTimeFormat("es-BO", { timeZone: "UTC", month: "short" }).format(dt).replace(".", "");
            return (
              <button type="button" key={d.date} className="pt-day" aria-pressed={day === d.date} disabled={d.count === 0}
                aria-label={`${fmtDayLong(d.date)}: ${d.count ? `${d.count} horarios` : "sin horarios"}`} onClick={() => { setDay(d.date); onChange(null); }}>
                <small>{cap(wd)}</small><b>{dt.getUTCDate()}</b><small>{d.count ? mo : "—"}</small>
              </button>
            );
          })}
          {hasMore && <button type="button" className="pt-day" onClick={() => loadDays(nextFrom())}><small>Ver</small><b>+</b><small>días</small></button>}
        </div>
      )}
      {none && <div className="alert warn">No hay horarios libres en estas fechas. Prueba con otro profesional o escribe a la sucursal por WhatsApp.</div>}
      {day && (
        <div className="stack">
          <h2>{fmtDayLong(day)}</h2>
          {!slots ? <div className="skeleton" style={{ height: 46 }} /> : !slots.length ? <p className="muted">No quedan horarios este día. Elige otro día.</p> : groups.map((g) => {
            const list = slots.filter((s) => g.f(Number(fmtTime(s.startsAt).slice(0, 2))));
            if (!list.length) return null;
            return (
              <div key={g.label} className="stack-sm">
                <span className="label">{g.label}</span>
                <div className="pt-times" role="group" aria-label={`Horarios de la ${g.label.toLowerCase()}`}>
                  {list.map((s) => (
                    <button type="button" key={s.startsAt + s.dentistId} className="pt-time" aria-pressed={value?.startsAt === s.startsAt} onClick={() => onChange(s)}>{fmtTime(s.startsAt)}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
