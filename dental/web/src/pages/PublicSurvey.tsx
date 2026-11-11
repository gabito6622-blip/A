// /e/:token — encuesta de satisfacción pública: mínima y amable en el celular, sin datos clínicos
// ni el nombre del paciente. Un solo uso.
import { useEffect, useState } from "react";
import { CheckCircle2, MessageSquareHeart } from "lucide-react";
import "./public-budget.css";
import "../components/family/experience.css";

async function call(method: "GET" | "POST", token: string, body?: unknown) {
  const res = await fetch(`/api/public/encuesta/${encodeURIComponent(token)}`, {
    method, credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json", "x-portal": "1" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  }).catch(() => null);
  if (!res) throw Object.assign(new Error("No hay conexión. Revisa tu señal e intenta de nuevo."), { status: 0 });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? "No se pudo enviar. Intenta de nuevo."), { status: res.status, code: data?.error?.code });
  return data;
}

export function PublicSurveyPage() {
  const token = window.location.pathname.split("/e/")[1]?.split(/[/?#]/)[0] ?? "";
  const [view, setView] = useState<any | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { detractor: boolean }>(null);
  useEffect(() => {
    document.title = "Tu opinión";
    call("GET", token).then(setView).catch((e) => setFatal(e.status === 404 ? "Este enlace no es válido. Revisa que lo abriste completo desde el mensaje." : e.message));
  }, [token]);
  const send = async () => {
    if (score === null) { setErr("Elige una nota del 0 al 10"); return; }
    setBusy(true); setErr(null);
    try { const r = await call("POST", token, { score, comment: comment.trim() || null }); setDone({ detractor: r.detractor }); }
    catch (e: any) { if (e.code === "survey_answered") setView({ ...view, state: "answered" }); else setErr(e.message); }
    finally { setBusy(false); }
  };
  return (
    <main className="pb" lang="es">
      <div className="pb-wrap">
        <div className="pb-top"><MessageSquareHeart size={18} aria-hidden="true" /><span>{view?.clinicName ?? "Encuesta"}</span></div>
        {fatal && <div className="card"><div className="card-pad stack"><h1>Enlace no disponible</h1><p>{fatal}</p></div></div>}
        {!fatal && !view && <div className="skeleton" style={{ height: 200 }} />}
        {view && (
          <div className="card"><div className="card-pad stack">
            {done || view.state === "answered" ? (
              <div className="stack xp-center">
                <div className="xp-big-icon ok"><CheckCircle2 size={34} aria-hidden="true" /></div>
                <h1>¡Gracias por tu opinión!</h1>
                <p role="status">{done?.detractor ? "Sentimos que tu visita no haya sido la mejor. Alguien del equipo revisará lo que nos contaste." : done ? "Nos ayuda mucho a mejorar." : "Ya recibimos tu respuesta para esta visita."}</p>
              </div>
            ) : view.state === "expired" ? (
              <>
                <h1>Esta encuesta ya venció</h1>
                <p>Si quieres contarnos algo sobre tu visita, escríbenos directamente a la sucursal.</p>
              </>
            ) : (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <h1>¿Qué tan probable es que nos recomiendes a un familiar o amigo?</h1>
                <p className="muted" style={{ margin: 0 }}>Sobre tu visita del {view.visitDate} en {view.branchName}.</p>
                <div className="stack-sm">
                  <div className="xp-scale" role="group" aria-label="Nota del 0 al 10">
                    {Array.from({ length: 11 }, (_, n) => (
                      <button key={n} type="button" aria-pressed={score === n} aria-label={`${n}${n === 0 ? " (nada probable)" : n === 10 ? " (muy probable)" : ""}`} onClick={() => { setScore(n); setErr(null); }}>{n}</button>
                    ))}
                  </div>
                  <div className="xp-scale-legend" aria-hidden="true"><span>Nada probable</span><span>Muy probable</span></div>
                </div>
                <div className="field">
                  <label htmlFor="sv-comment" className="label">¿Quieres contarnos algo más? (opcional)</label>
                  <textarea id="sv-comment" className="input" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Lo que más te gustó o lo que podemos mejorar" />
                  <span className="hint">No escribas datos de salud: esta encuesta es sobre la atención.</span>
                </div>
                {err && <p className="pb-err" role="alert">{err}</p>}
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Enviando…" : "Enviar mi opinión"}</button>
              </form>
            )}
          </div></div>
        )}
        <p className="muted small" style={{ textAlign: "center" }}>Tu respuesta es confidencial y la lee solo la administración de la clínica.</p>
      </div>
    </main>
  );
}
