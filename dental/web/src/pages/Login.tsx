import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Layout";

export function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      <section className="login-form">
        <form className="login-card stack" onSubmit={submit} method="post" action="#">
          <div><h1>Ingresar</h1><p className="muted" style={{ marginTop: 4 }}>Usa el correo y la contraseña que te dio tu clínica.</p></div>
          {error && <div className="alert danger" role="alert">{error}</div>}
          <div className="field"><label htmlFor="email">Correo</label><input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw">Contraseña</label><input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Ingresando…" : "Ingresar"}</button>
        </form>
      </section>
    </div>
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
