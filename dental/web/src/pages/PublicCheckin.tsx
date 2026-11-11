// /llegada/:token (QR de la recepción) y /llegada/r/:token (desde el enlace del recordatorio).
// Página pública mínima: sin nombres ni datos personales. Abrir el enlace no registra nada:
// siempre hace falta pulsar el botón.
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, DoorOpen, MapPin } from "lucide-react";
import "./public-budget.css";
import "../components/family/experience.css";

async function call(method: "GET" | "POST", url: string, body?: unknown) {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json", "x-portal": "1" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  }).catch(() => null);
  if (!res) throw Object.assign(new Error("No hay conexión. Revisa tu señal e intenta de nuevo."), { status: 0 });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? data?.message ?? "No se pudo completar. Intenta de nuevo."), { status: res.status, code: data?.error?.code, data });
  return data;
}

type Result = { state: "arrived" | "already" | "early" | "late" | "not_found" | "blocked"; message: string; time?: string };

export function PublicCheckinPage() {
  const path = window.location.pathname;
  const reminder = path.startsWith("/llegada/r/");
  const token = (reminder ? path.split("/llegada/r/")[1] : path.split("/llegada/")[1])?.split(/[/?#]/)[0] ?? "";
  const base = reminder ? `/api/public/llegada-recordatorio/${encodeURIComponent(token)}` : `/api/public/llegada/${encodeURIComponent(token)}`;
  const [view, setView] = useState<any | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [f, setF] = useState({ phoneLast4: "", day: "", month: "", year: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "Registrar mi llegada";
    call("GET", base).then(setView).catch((e) => setFatal(e.status === 404 ? (e.message.includes("QR") ? e.message : "Este código no es válido. Pide ayuda en recepción.") : e.message));
  }, [base]);
  const submit = async () => {
    setErr(null);
    let body: unknown = {};
    if (!reminder) {
      const v: Record<string, string> = {};
      if (!/^\d{4}$/.test(f.phoneLast4)) v.phoneLast4 = "Escribe los 4 últimos dígitos de tu celular";
      const d = Number(f.day), m = Number(f.month), y = Number(f.year);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (!d || !m || !y || f.year.length !== 4 || date.getUTCDate() !== d || date.getUTCMonth() !== m - 1 || y < 1900) v.birth = "Revisa tu fecha de nacimiento (día, mes y año)";
      setErrs(v);
      if (Object.keys(v).length) return;
      body = { phoneLast4: f.phoneLast4, birthDate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
    }
    setBusy(true);
    try { setRes(await call("POST", base, body)); }
    catch (e: any) {
      if (e.data?.state) setRes(e.data as Result);
      else setErr(e.message);
    } finally { setBusy(false); }
  };
  const ok = res && (res.state === "arrived" || res.state === "already");
  return (
    <main className="pb" lang="es">
      <div className="pb-wrap">
        <div className="pb-top"><DoorOpen size={18} aria-hidden="true" /><span>{view?.clinicName ?? "Registro de llegada"}</span></div>
        {fatal && <div className="card"><div className="card-pad stack"><h1>No disponible</h1><p>{fatal}</p></div></div>}
        {!fatal && !view && <div className="skeleton" style={{ height: 200 }} />}
        {view && (
          <div className="card"><div className="card-pad stack">
            {ok ? (
              <div className="stack xp-center" role="status">
                <div className="xp-big-icon ok"><CheckCircle2 size={34} aria-hidden="true" /></div>
                <h1>{res!.state === "arrived" ? "¡Llegada registrada!" : "Ya registramos tu llegada"}</h1>
                <p>{res!.message}</p>
              </div>
            ) : res && (res.state === "early" || res.state === "late") ? (
              <div className="stack xp-center" role="status">
                <div className="xp-big-icon warn"><Clock size={32} aria-hidden="true" /></div>
                <h1>{res.state === "early" ? "Todavía es temprano" : "Tu hora ya pasó"}</h1>
                <p>{res.message}</p>
                <button type="button" className="btn btn-block" onClick={() => setRes(null)}>Volver</button>
              </div>
            ) : (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <h1>¿Ya estás en la sucursal?</h1>
                <p className="row" style={{ gap: 6, margin: 0 }}><MapPin size={16} aria-hidden="true" />{view.branchName}</p>
                {reminder ? (
                  view.state === "already" ? <p className="alert ok">Ya registramos tu llegada. Toma asiento: te llamaremos.</p>
                    : view.state === "cancelled" ? <p className="alert warn">Esta cita fue cancelada. Acércate a recepción.</p>
                    : <p>Tu cita es {view.today ? "hoy" : "otro día"} a las <b>{view.time}</b>. Pulsa el botón cuando estés en la recepción{view.state === "early" ? ` (desde ${view.windowBefore} minutos antes)` : ""}.</p>
                ) : (
                  <>
                    <p className="muted" style={{ margin: 0 }}>Avísanos que llegaste. Solo funciona si tu cita es dentro de la próxima hora.</p>
                    <div className="field">
                      <label htmlFor="ck-last4" className="label">4 últimos dígitos de tu celular</label>
                      <input id="ck-last4" className="input xp-pin" inputMode="numeric" autoComplete="off" maxLength={4} value={f.phoneLast4} aria-invalid={!!errs.phoneLast4}
                        onChange={(e) => setF({ ...f, phoneLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                      {errs.phoneLast4 && <span className="pb-err" role="alert">{errs.phoneLast4}</span>}
                      <span className="hint">Si eres menor, usa el celular de tu madre, padre o tutor.</span>
                    </div>
                    <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
                      <legend className="label">Tu fecha de nacimiento</legend>
                      <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
                        <input className="input" inputMode="numeric" placeholder="Día" aria-label="Día" maxLength={2} value={f.day} aria-invalid={!!errs.birth} onChange={(e) => setF({ ...f, day: e.target.value.replace(/\D/g, "") })} />
                        <input className="input" inputMode="numeric" placeholder="Mes" aria-label="Mes" maxLength={2} value={f.month} aria-invalid={!!errs.birth} onChange={(e) => setF({ ...f, month: e.target.value.replace(/\D/g, "") })} />
                        <input className="input" inputMode="numeric" placeholder="Año" aria-label="Año" maxLength={4} value={f.year} aria-invalid={!!errs.birth} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, "") })} />
                      </div>
                      {errs.birth && <span className="pb-err" role="alert">{errs.birth}</span>}
                    </fieldset>
                  </>
                )}
                {res && res.state === "not_found" && <p className="pb-err" role="alert">{res.message}</p>}
                {err && <p className="pb-err" role="alert">{err}</p>}
                {!(reminder && (view.state === "already" || view.state === "cancelled")) && (
                  <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Registrando…" : "Ya llegué"}</button>
                )}
              </form>
            )}
          </div></div>
        )}
        <p className="muted small" style={{ textAlign: "center" }}>No guardamos tus datos en este celular. Si tienes dudas, acércate a recepción.</p>
      </div>
    </main>
  );
}
