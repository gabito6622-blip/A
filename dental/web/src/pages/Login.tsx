import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Layout";
import { Dialog, Field } from "../components/ui";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-wrap">
      <section className="login-art">
        <div className="row" style={{ color: "#fff" }}><Logo /><b style={{ fontSize: 18 }}>Dentalia</b></div>
        <div className="stack">
          <h1>Toda la operación de tus sucursales, en un solo lugar.</h1>
          <ul>
            <li>Agenda centralizada sin turnos superpuestos</li>
            <li>Odontograma y expediente clínico con trazabilidad</li>
            <li>Presupuestos, cobros en Bs y verificación de QR</li>
            <li>Panel comparativo por sucursal</li>
          </ul>
        </div>
        <small style={{ color: "#8fb3c6" }}>Datos clínicos protegidos · Acceso por rol y sucursal</small>
      </section>
      <section className="login-form">{children}</section>
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Shell>
      <form className="login-card stack" onSubmit={submit} method="post" action="#">
        <div><h1>Ingresar</h1><p className="muted" style={{ marginTop: 4 }}>Usa el correo y la contraseña que te dio tu clínica.</p></div>
        {error && <div className="alert danger" role="alert">{error}</div>}
        <div className="field"><label htmlFor="email">Correo</label><input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Contraseña</label><input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn btn-primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Ingresando…" : "Ingresar"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForgot(true)}>Olvidé mi contraseña</button>
      </form>
      {forgot && <ForgotDialog initialEmail={email} onClose={() => setForgot(false)} />}
    </Shell>
  );
}

function ForgotDialog({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setErr(null);
    try { setDone((await api.post("/api/auth/forgot", { email })).message); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title="Recuperar contraseña" onClose={onClose} footer={done ? <button className="btn btn-primary" onClick={onClose}>Entendido</button> : <><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={send} disabled={!email}>Enviar enlace</button></>}>
      {done ? <div className="alert ok">{done}</div> : (
        <div className="stack">
          {err && <div className="alert danger">{err}</div>}
          <p className="muted">Te enviaremos un enlace de un solo uso, válido por 30 minutos.</p>
          <Field label="Correo"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        </div>
      )}
    </Dialog>
  );
}

/** Segundo paso del ingreso. */
export function MfaVerifyPage() {
  const { refresh, logout, me } = useAuth();
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post("/api/auth/mfa/verify", useRecovery ? { recoveryCode: code } : { code });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      if ((err as { code?: string }).code === "mfa_locked") setTimeout(refresh, 1500);
    } finally { setBusy(false); }
  };
  return (
    <Shell>
      <form className="login-card stack" onSubmit={submit}>
        <div><h1>Verificación en dos pasos</h1><p className="muted" style={{ marginTop: 4 }}>{me?.user.email}: ingresa el código de 6 dígitos de tu app autenticadora.</p></div>
        {error && <div className="alert danger" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="code">{useRecovery ? "Código de recuperación" : "Código"}</label>
          <input id="code" className="input" autoComplete="one-time-code" inputMode={useRecovery ? "text" : "numeric"} maxLength={useRecovery ? 12 : 6} value={code}
            onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ""))} autoFocus style={{ fontSize: 22, letterSpacing: 6, textAlign: "center" }} />
        </div>
        <button className="btn btn-primary" disabled={busy || code.length < 6} style={{ minHeight: 44 }}>Verificar</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>{useRecovery ? "Usar el código de la app" : "Perdí mi celular: usar un código de recuperación"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Salir</button>
      </form>
    </Shell>
  );
}

/** Restablecer contraseña con el enlace recibido por correo (/restablecer?token=...). */
export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setMsg({ ok: false, text: "Las contraseñas no coinciden" });
    try {
      await api.post("/api/auth/reset", { token, newPassword: pw });
      setMsg({ ok: true, text: "Listo. Ya puedes ingresar con tu nueva contraseña." });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  return (
    <Shell>
      <form className="login-card stack" onSubmit={submit}>
        <h1>Nueva contraseña</h1>
        {msg && <div className={`alert ${msg.ok ? "ok" : "danger"}`} role="alert">{msg.text}</div>}
        {msg?.ok ? <a className="btn btn-primary" href="/">Ir al ingreso</a> : (
          <>
            <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números."><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Repetir contraseña"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            <button className="btn btn-primary" disabled={!token || pw.length < 10}>Guardar</button>
            {!token && <p className="muted small">El enlace no es válido. Solicita uno nuevo desde "Olvidé mi contraseña".</p>}
          </>
        )}
      </form>
    </Shell>
  );
}

export function ClinicSelectPage() {
  const { me, refresh, logout } = useAuth();
  const choose = async (id: string) => { await api.post("/api/auth/switch-clinic", { clinicId: id }); await refresh(); };
  return (
    <div className="login-form" style={{ minHeight: "100%" }}>
      <div className="login-card card card-pad stack">
        <h1>Elige una clínica</h1>
        {me?.clinics.length ? me.clinics.map((c) => (
          <button key={c.id} className="btn" style={{ justifyContent: "space-between" }} onClick={() => choose(c.id)}>{c.name}<span className="muted small">{c.roleLabel}</span></button>
        )) : <p className="muted">Tu usuario no tiene clínicas activas.</p>}
        <button className="btn btn-ghost" onClick={logout}>Salir</button>
      </div>
    </div>
  );
}

/** /desbloquear?token=… — enlace que llega por correo tras muchos intentos fallidos desde distintas redes (B-090). */
export function UnlockAccountPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>("/api/auth/unlock", { token });
      setMsg({ ok: true, text: r.message });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    setBusy(false);
  };
  return (
    <Shell>
      <form className="login-card stack" onSubmit={submit}>
        <h1>Desbloquear mi cuenta</h1>
        <p className="muted">Bloqueamos el ingreso a tu cuenta porque hubo muchos intentos fallidos. Si fuiste tú, desbloquéala aquí. Si no fuiste tú, después cambia tu contraseña y avisa al administrador de tu clínica.</p>
        {msg && <div className={`alert ${msg.ok ? "ok" : "danger"}`} role="alert">{msg.text}</div>}
        {msg?.ok ? <a className="btn btn-primary" href="/">Ir al ingreso</a> : (
          <>
            <button className="btn btn-primary" disabled={!token || busy}>Desbloquear</button>
            {!token && <p className="muted small">El enlace no es válido. Revisa que lo hayas copiado completo.</p>}
          </>
        )}
      </form>
    </Shell>
  );
}
