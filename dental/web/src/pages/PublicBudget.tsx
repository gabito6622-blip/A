// Página pública del presupuesto para el paciente (sin sesión del personal).
// Nada del presupuesto se muestra hasta que la persona verifica un dato.
import { useState, type FormEvent } from "react";
import { CheckCircle2, Lock, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { bs, fmtDateTime } from "../lib/format";
import { SignaturePad } from "../components/SignaturePad";
import "./public-budget.css";

/** AAAA-MM-DD → dd/mm/aaaa sin cambiar de zona horaria. */
const ymd = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

type View = any;

export function PublicBudgetPage() {
  const token = window.location.pathname.split("/p/presupuesto/")[1]?.split(/[/?#]/)[0] ?? "";
  const [access, setAccess] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  return (
    <main className="pb" lang="es">
      <div className="pb-wrap">
        {!access || !view
          ? <Verify token={token} onOk={(a, v) => { setAccess(a); setView(v); window.scrollTo(0, 0); }} />
          : <Budget token={token} access={access} view={view} onView={setView} onExpired={() => { setAccess(null); setView(null); }} />}
      </div>
    </main>
  );
}

function Verify({ token, onOk }: { token: string; onOk: (access: string, view: View) => void }) {
  const [method, setMethod] = useState<"phone" | "birthDate">("phone");
  const [last4, setLast4] = useState("");
  const [birth, setBirth] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (method === "phone" && !/^\d{4}$/.test(last4)) return setErr("Escribe los 4 últimos dígitos de tu celular.");
    if (method === "birthDate" && !birth) return setErr("Elige tu fecha de nacimiento.");
    setBusy(true);
    try {
      const r = await api.post(`/api/public/budget-links/${token}/verify`, method === "phone" ? { method, phoneLast4: last4 } : { method, birthDate: birth });
      onOk(r.access, r.budget);
    } catch (e) {
      const x = e as ApiError;
      if (x.status === 404 || x.status === 423) setBlocked(x.message);
      else if (x.code === "validation" && /^token/.test(x.message)) setBlocked("Este enlace no es válido. Revisa que lo copiaste completo o pide uno nuevo a tu clínica.");
      else setErr(x.message);
    } finally { setBusy(false); }
  };
  if (blocked) return (
    <section className="card card-pad stack" style={{ marginTop: 24 }}>
      <div className="pb-lock" aria-hidden><Lock size={26} /></div>
      <h1>No podemos mostrar este presupuesto</h1>
      <p role="alert">{blocked}</p>
    </section>
  );
  return (
    <form className="stack" onSubmit={submit} noValidate style={{ marginTop: 16 }}>
      <div className="pb-top"><ShieldCheck size={18} aria-hidden />Página segura de tu presupuesto dental</div>
      <section className="card card-pad stack">
        <div className="pb-lock" aria-hidden><Lock size={26} /></div>
        <h1>Verifica tu identidad</h1>
        <p className="muted">Para proteger tu información, confirma uno de estos datos del paciente. Si eres madre, padre o tutor, puedes usar tu celular registrado en la clínica.</p>
        <div className="pb-choice" role="group" aria-label="Dato para verificar">
          <button type="button" aria-pressed={method === "phone"} onClick={() => { setMethod("phone"); setErr(null); }}>Celular</button>
          <button type="button" aria-pressed={method === "birthDate"} onClick={() => { setMethod("birthDate"); setErr(null); }}>Fecha de nacimiento</button>
        </div>
        {method === "phone" ? (
          <div className="field">
            <label htmlFor="pb-last4">Últimos 4 dígitos del celular</label>
            <input id="pb-last4" className="input" inputMode="numeric" autoComplete="off" maxLength={4} placeholder="• • • •"
              value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              aria-invalid={!!err} aria-describedby={err ? "pb-verify-err" : undefined} style={{ letterSpacing: "0.3em", fontSize: 22 }} />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="pb-birth">Fecha de nacimiento del paciente</label>
            <input id="pb-birth" className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)}
              aria-invalid={!!err} aria-describedby={err ? "pb-verify-err" : undefined} />
          </div>
        )}
        {err && <p id="pb-verify-err" className="pb-err" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Verificando…" : "Continuar"}</button>
      </section>
      <p className="muted small" style={{ textAlign: "center" }}>Tras 5 intentos fallidos el enlace se bloquea por seguridad.</p>
    </form>
  );
}

function Contact({ c }: { c: any }) {
  return (
    <section className="card card-pad stack" aria-label="Contacto de la clínica">
      <h2>¿Tienes dudas?</h2>
      <p className="muted">{c.clinicName} · {c.branchName}{c.address ? ` · ${c.address}` : ""}{c.city ? `, ${c.city}` : ""}</p>
      <div className="stack-sm">
        {c.whatsappUrl && <a className="btn btn-block" href={c.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden />Escribir por WhatsApp</a>}
        {c.phone && <a className="btn btn-block" href={`tel:${String(c.phone).replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />Llamar al {c.phone}</a>}
      </div>
    </section>
  );
}

function Budget({ token, access, view, onView, onExpired }: { token: string; access: string; view: View; onView: (v: View) => void; onExpired: () => void }) {
  const [mode, setMode] = useState<"view" | "accept" | "reject">("view");
  const v = view;
  const header = (
    <header className="stack-sm">
      <div className="pb-top"><ShieldCheck size={18} aria-hidden />{v.contact.clinicName}</div>
      <h1>{v.state === "superseded" || v.state === "updating" || v.state === "cancelled" ? "Tu presupuesto" : `Hola ${v.patientFirstName}, este es tu presupuesto`}</h1>
      <p className="muted">N° {v.number}{v.version > 1 ? ` (versión ${v.version})` : ""} · {v.contact.branchName}</p>
    </header>
  );
  const notice: Record<string, string> = {
    superseded: "Hay una versión más reciente de este presupuesto. Pide a la clínica el enlace nuevo para revisarlo.",
    updating: "La clínica está actualizando este presupuesto. Te enviará el enlace cuando esté listo.",
    cancelled: "La clínica anuló este presupuesto. Si tienes dudas, comunícate con ella.",
  };
  if (notice[v.state]) return (<>{header}<div className="alert info" role="status">{notice[v.state]}</div><Contact c={v.contact} /></>);

  if (mode === "accept") return <AcceptForm token={token} access={access} view={v} onDone={(nv) => { onView(nv); setMode("view"); window.scrollTo(0, 0); }} onCancel={() => setMode("view")} onExpired={onExpired} />;
  if (mode === "reject") return <RejectForm token={token} access={access} view={v} onDone={(nv) => { onView(nv); setMode("view"); window.scrollTo(0, 0); }} onCancel={() => setMode("view")} onExpired={onExpired} />;

  return (
    <>
      {header}
      {v.state === "accepted" && (
        <div className="alert ok stack-sm" role="status">
          <b><CheckCircle2 size={18} aria-hidden style={{ verticalAlign: "-3px" }} /> Presupuesto aceptado</b>
          <span>{v.decision?.signerName ? `Aceptado por ${v.decision.signerName} el ${fmtDateTime(v.decision.at)}. ` : ""}La clínica te contactará para agendar tu próxima cita.</span>
        </div>
      )}
      {v.state === "rejected" && <div className="alert info" role="status">Indicaste que por ahora no te interesa. Gracias por avisarnos; si cambias de opinión, escribe a la clínica.</div>}
      {v.state === "expired" && <div className="alert warn" role="status">Este presupuesto venció el {ymd(v.validUntil)}. Pide a la clínica uno actualizado.</div>}
      {v.state === "open" && v.validUntil && <p className="muted">Válido hasta el <b style={{ color: "var(--ink)" }}>{ymd(v.validUntil)}</b></p>}
      {v.notes && (
        <section className="card card-pad stack-sm">
          <h2>Mensaje de la clínica</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{v.notes}</p>
        </section>
      )}
      <section className="card card-pad" aria-label="Tratamientos">
        <h2>Tratamientos</h2>
        <div>
          {v.items.map((i: any, k: number) => (
            <div key={k} className="pb-item">
              <div className="what">
                <div style={{ fontWeight: 600 }}>{k + 1}. {i.description}</div>
                <div className="muted">{i.tooth ? `Pieza ${i.tooth}${i.surfaces?.length ? ` (${i.surfaces.join("")})` : ""} · ` : ""}{i.quantity} {i.quantity === 1 ? "unidad" : "unidades"}</div>
              </div>
              <div className="amt">
                {i.netCents !== i.grossCents && <div className="pb-strike" aria-label={`Precio sin descuento ${bs(i.grossCents)}`}>{bs(i.grossCents)}</div>}
                <div style={{ fontWeight: 650 }}>{bs(i.netCents)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
          {v.discountCents > 0 && <>
            <div className="pb-total"><span className="muted">Subtotal</span><span>{bs(v.subtotalCents)}</span></div>
            <div className="pb-total"><span className="muted">Descuentos</span><span>− {bs(v.discountCents)}</span></div>
          </>}
          <div className="pb-total big"><span>Total</span><span>{bs(v.totalCents)}</span></div>
        </div>
      </section>
      {v.installments > 1 && (
        <section className="card card-pad stack-sm" aria-label="Plan de pagos">
          <h2>Plan de pagos</h2>
          <p className="muted">{v.installments} cuotas</p>
          {v.installmentPlan.map((c: number, k: number) => <div key={k} className="pb-total"><span>Cuota {k + 1}</span><span>{bs(c)}</span></div>)}
        </section>
      )}
      <Contact c={v.contact} />
      {v.state === "open" && (
        <div className="pb-bar">
          <div className="pb-bar-in">
            <button className="btn btn-primary" onClick={() => setMode("accept")}>Acepto el presupuesto</button>
            <button className="btn" onClick={() => setMode("reject")}>No me interesa</button>
          </div>
        </div>
      )}
    </>
  );
}

function AcceptForm({ token, access, view, onDone, onCancel, onExpired }: { token: string; access: string; view: View; onDone: (v: View) => void; onCancel: () => void; onExpired: () => void }) {
  const [name, setName] = useState("");
  const [rel, setRel] = useState<"" | "patient" | "guardian">("");
  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (name.trim().length < 3) x.name = "Escribe tu nombre completo.";
    if (!rel) x.rel = "Indica quién acepta.";
    if (!agree) x.agree = "Marca la casilla para confirmar.";
    setErrs(x);
    if (Object.keys(x).length) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/public/budget-links/${token}/accept`, { access, signerName: name.trim(), relationship: rel, agree: true, signaturePng: sig });
      onDone(r.budget);
    } catch (e) {
      const er = e as ApiError;
      if (er.status === 401) return onExpired();
      setErrs({ form: er.message });
    } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1>Aceptar presupuesto</h1>
      <p className="muted">N° {view.number} · Total <b style={{ color: "var(--ink)" }}>{bs(view.totalCents)}</b></p>
      {errs.form && <div className="alert danger" role="alert">{errs.form}</div>}
      <section className="card card-pad stack">
        <div className="field">
          <label htmlFor="pb-name">Tu nombre completo</label>
          <input id="pb-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errs.name} aria-describedby={errs.name ? "pb-name-err" : undefined} />
          {errs.name && <span id="pb-name-err" className="pb-err">{errs.name}</span>}
        </div>
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={errs.rel ? "pb-rel-err" : undefined}>
          <legend className="label" style={{ marginBottom: 6 }}>¿Quién acepta?</legend>
          <label className="pb-radio"><input type="radio" name="rel" checked={rel === "patient"} onChange={() => setRel("patient")} />Soy el paciente</label>
          <label className="pb-radio"><input type="radio" name="rel" checked={rel === "guardian"} onChange={() => setRel("guardian")} />Soy su madre, padre o tutor</label>
          {errs.rel && <span id="pb-rel-err" className="pb-err">{errs.rel}</span>}
        </fieldset>
        <div className="stack-sm">
          <span className="label">Firma (opcional)</span>
          <SignaturePad onChange={setSig} height={170} />
        </div>
        <div className="stack-sm">
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={!!errs.agree} />
            <span>Leí el presupuesto y acepto los tratamientos y montos indicados.</span></label>
          {errs.agree && <span className="pb-err">{errs.agree}</span>}
        </div>
      </section>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Enviando…" : "Confirmar aceptación"}</button>
      <button type="button" className="btn btn-block" onClick={onCancel}>Volver al presupuesto</button>
    </form>
  );
}

function RejectForm({ token, access, view, onDone, onCancel, onExpired }: { token: string; access: string; view: View; onDone: (v: View) => void; onCancel: () => void; onExpired: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/api/public/budget-links/${token}/reject`, { access, reason: reason.trim() || null });
      onDone(r.budget);
    } catch (e) {
      const er = e as ApiError;
      if (er.status === 401) return onExpired();
      setErr(er.message);
    } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1>No me interesa</h1>
      <p className="muted">Presupuesto N° {view.number}. Puedes contarnos el motivo si quieres (no es obligatorio).</p>
      {err && <div className="alert danger" role="alert">{err}</div>}
      <section className="card card-pad">
        <div className="field">
          <label htmlFor="pb-reason">Motivo (opcional)</label>
          <textarea id="pb-reason" className="input" rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </section>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Enviando…" : "Enviar respuesta"}</button>
      <button type="button" className="btn btn-block" onClick={onCancel}>Volver al presupuesto</button>
    </form>
  );
}
