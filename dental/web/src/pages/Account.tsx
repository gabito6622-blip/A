import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Field, useToast } from "../components/ui";

export function ChangePasswordCard({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    if (f.newPassword !== f.repeat) return setErr("Las contraseñas nuevas no coinciden");
    try {
      await api.post("/api/auth/change-password", { currentPassword: f.currentPassword, newPassword: f.newPassword });
      toast("Contraseña actualizada. Se cerraron tus otras sesiones.");
      setF({ currentPassword: "", newPassword: "", repeat: "" });
      onDone?.();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="card card-pad stack">
      <h2 className="row"><KeyRound size={18} />{forced ? "Cambia tu contraseña temporal" : "Cambiar contraseña"}</h2>
      {forced && <p className="muted">Por seguridad, la contraseña que te entregaron sirve solo para el primer ingreso.</p>}
      {err && <div className="alert danger" role="alert">{err}</div>}
      <Field label={forced ? "Contraseña temporal" : "Contraseña actual"}><input className="input" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números."><input className="input" type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
      <Field label="Repetir nueva contraseña"><input className="input" type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} /></Field>
      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!f.currentPassword || f.newPassword.length < 10} onClick={save}>Guardar</button>
    </div>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="alert warn stack-sm">
      <b>Guarda estos códigos de recuperación en un lugar seguro.</b>
      <span className="small">Cada uno sirve una sola vez si pierdes el celular. No se volverán a mostrar.</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: "4px 24px", fontFamily: "ui-monospace, monospace", fontSize: 15 }} data-testid="recovery-codes">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copiar</button>
    </div>
  );
}

export function MfaCard({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const enabled = !!me?.user.mfaEnabled;
  const [step, setStep] = useState<"idle" | "password" | "scan" | "done" | "disable">("idle");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setErr(null);
    try { setSetup(await api.post("/api/auth/mfa/setup", { password })); setStep("scan"); setPassword(""); } catch (e) { setErr((e as Error).message); }
  };
  const confirm = async () => {
    setErr(null);
    try { const r = await api.post("/api/auth/mfa/enable", { code }); setCodes(r.recoveryCodes); setStep("done"); setCode(""); toast("Verificación en dos pasos activada"); } catch (e) { setErr((e as Error).message); }
  };
  const disable = async () => {
    setErr(null);
    try { await api.post("/api/auth/mfa/disable", { password, code }); toast("Verificación en dos pasos desactivada"); setStep("idle"); setPassword(""); setCode(""); await refresh(); } catch (e) { setErr((e as Error).message); }
  };
  const regen = async () => {
    const c = window.prompt("Ingresa un código actual de tu app para generar nuevos códigos de recuperación:");
    if (!c) return;
    try { setCodes((await api.post("/api/auth/mfa/recovery-codes", { code: c })).recoveryCodes); setStep("done"); } catch (e) { toast((e as Error).message, true); }
  };
  return (
    <div className="card card-pad stack">
      <div className="row-between">
        <h2 className="row"><ShieldCheck size={18} />Verificación en dos pasos</h2>
        {enabled || step === "done" ? <span className="badge ok">Activa</span> : <span className="badge warn">Inactiva</span>}
      </div>
      {forced && <div className="alert info">Tu clínica exige verificación en dos pasos para tu rol. Actívala para continuar.</div>}
      <p className="muted">Además de la contraseña, al ingresar te pediremos un código de 6 dígitos de una app autenticadora (Google Authenticator, Microsoft Authenticator u otra) instalada en tu celular.</p>
      {err && <div className="alert danger" role="alert">{err}</div>}
      {!enabled && step === "idle" && <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => setStep("password")}>Activar</button>}
      {step === "password" && (
        <div className="stack">
          <Field label="Confirma tu contraseña"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={start} disabled={!password}>Continuar</button>
        </div>
      )}
      {step === "scan" && setup && (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <div className="stack-sm">
            <b>1. Escanea este código con la app</b>
            <img alt="Código QR para la app autenticadora" width={200} height={200} src={`data:image/svg+xml;base64,${btoa(setup.qrSvg)}`} style={{ background: "#fff", borderRadius: 8 }} />
            <span className="small muted">¿No puedes escanear? Ingresa esta clave: <code data-testid="mfa-secret">{setup.secret}</code></span>
          </div>
          <div className="stack">
            <b>2. Escribe el código que muestra la app</b>
            <input className="input" aria-label="Código de 6 dígitos" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ fontSize: 22, letterSpacing: 6, textAlign: "center", maxWidth: 200 }} />
            <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={confirm} disabled={code.length !== 6}>Confirmar y activar</button>
          </div>
        </div>
      )}
      {step === "done" && codes && (
        <>
          <RecoveryCodes codes={codes} />
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={async () => { setCodes(null); setStep("idle"); await refresh(); onDone?.(); }}>Ya los guardé</button>
        </>
      )}
      {enabled && step === "idle" && (
        <div className="row">
          <button className="btn" onClick={regen}>Nuevos códigos de recuperación</button>
          {!forced && <button className="btn btn-danger" onClick={() => setStep("disable")}>Desactivar</button>}
        </div>
      )}
      {step === "disable" && (
        <div className="stack">
          <div className="form-grid">
            <Field label="Contraseña"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Código actual de la app"><input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
          </div>
          <div className="row"><button className="btn btn-danger" onClick={disable}>Desactivar</button><button className="btn" onClick={() => setStep("idle")}>Cancelar</button></div>
        </div>
      )}
    </div>
  );
}

export function AccountPage() {
  const { me } = useAuth();
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Mi cuenta</h1><p className="sub">{me?.user.fullName} · {me?.user.email}</p></div></div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <MfaCard />
        <ChangePasswordCard />
      </div>
    </div>
  );
}

/** Pantalla obligatoria antes de usar el sistema (contraseña temporal o política de 2 pasos). */
export function SecurityGatePage() {
  const { me, refresh, logout } = useAuth();
  return (
    <div className="login-form" style={{ minHeight: "100%", alignItems: "start", paddingTop: "6vh" }}>
      <div className="stack" style={{ width: "100%", maxWidth: 720 }}>
        {me?.mustChangePassword ? <ChangePasswordCard forced onDone={refresh} /> : <MfaCard forced onDone={refresh} />}
        <button className="btn btn-ghost" onClick={logout}>Salir</button>
      </div>
    </div>
  );
}
