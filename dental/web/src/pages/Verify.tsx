// Página pública /verificar/:code (sin sesión del personal). Muestra SOLO si el documento
// existe y está íntegro, con su tipo, fecha y clínica. Nunca datos del paciente.
import { useEffect, useState, type FormEvent } from "react";
import { FileSearch, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import "./public-budget.css";
import "../components/documents.css";

type Result = { found: true; intact: boolean; status: "valid" | "voided" | "superseded"; statusLabel: string; kindLabel: string; issuedAt: string; clinicName: string; fingerprint: string; pdfSha256: string; code: string };

const codeFromPath = () => decodeURIComponent(window.location.pathname.replace(/^\/verificar\/?/, "").split(/[/?#]/)[0] ?? "");

export function VerifyPage() {
  const [code, setCode] = useState(codeFromPath());
  const [input, setInput] = useState(codeFromPath());
  const [res, setRes] = useState<Result | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    document.title = "Verificar documento";
    const onPop = () => { setCode(codeFromPath()); setInput(codeFromPath()); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    setRes(null); setNotFound(null); setErr(null);
    if (!code) return;
    setLoading(true);
    api.get<Result>(`/api/public/verify/${encodeURIComponent(code)}`)
      .then(setRes)
      .catch((e: ApiError) => (e.status === 404 ? setNotFound("No encontramos un documento con ese código. Revisa que esté bien escrito (12 letras y números, por ejemplo 7K2M-9QPA-X4BD).") : setErr(e.message)))
      .finally(() => setLoading(false));
  }, [code]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = input.trim();
    if (!c) return setErr("Escribe el código impreso al pie del documento.");
    window.history.pushState(null, "", `/verificar/${encodeURIComponent(c)}`);
    setCode(c);
  };
  return (
    <main className="pb" lang="es">
      <div className="pb-wrap">
        <div className="pb-top"><ShieldCheck size={18} aria-hidden />Verificación de documentos</div>
        <h1>Verificar un documento</h1>
        <p className="muted">Escribe el código que aparece al pie del documento (o escanea su código QR) para comprobar que lo emitió la clínica y que no fue modificado.</p>
        <form className="card card-pad stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="vf-code" className="label">Código de verificación</label>
            <input id="vf-code" className="input" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" />
          </div>
          <button className="btn btn-primary btn-block" disabled={loading}>{loading ? "Verificando…" : "Verificar"}</button>
        </form>
        {err && <div className="alert danger" role="alert">{err}</div>}
        {notFound && (
          <section className="card card-pad stack" aria-live="polite">
            <div className="vf-status"><div className="vf-icon warn" aria-hidden><ShieldAlert size={26} /></div><div><h2>Documento no encontrado</h2><p>{notFound}</p></div></div>
          </section>
        )}
        {res && <ResultCard r={res} />}
        <p className="muted small">Por privacidad, esta página no muestra datos del paciente ni el contenido del documento.</p>
      </div>
    </main>
  );
}

function ResultCard({ r }: { r: Result }) {
  const ok = r.intact && r.status === "valid";
  const tone = !r.intact || r.status === "voided" ? "danger" : r.status === "superseded" ? "warn" : "ok";
  const heading = !r.intact ? "El documento no coincide con el registro"
    : r.status === "voided" ? "Documento ANULADO" : r.status === "superseded" ? "Documento reemplazado" : "Documento auténtico e íntegro";
  const text = !r.intact ? "El registro de la clínica no pasó la comprobación de integridad. No lo acepte y comuníquese con la clínica."
    : r.status === "voided" ? "La clínica anuló este documento: no tiene validez (por ejemplo, no se debe dispensar una receta anulada)."
      : r.status === "superseded" ? "Existe una versión más reciente de este documento." : "La clínica emitió este documento y su contenido registrado no fue modificado.";
  return (
    <section className="card card-pad stack" aria-live="polite" aria-label="Resultado de la verificación">
      <div className="vf-status">
        <div className={`vf-icon ${tone}`} aria-hidden>{ok ? <ShieldCheck size={26} /> : tone === "warn" ? <ShieldAlert size={26} /> : <ShieldX size={26} />}</div>
        <div><h2>{heading}</h2><p>{text}</p></div>
      </div>
      <dl className="vf-dl">
        <dt>Tipo</dt><dd>{r.kindLabel}</dd>
        <dt>Fecha</dt><dd>{fmtDateTime(r.issuedAt)}</dd>
        <dt>Clínica</dt><dd>{r.clinicName}</dd>
        <dt>Estado</dt><dd>{r.statusLabel}</dd>
        <dt>Código</dt><dd>{r.code}</dd>
        <dt>Huella</dt><dd><code>{r.fingerprint}</code></dd>
      </dl>
      <p className="muted small">Compare la huella con la impresa al pie del documento: deben ser iguales.</p>
      <FileCheck expected={r.pdfSha256} />
    </section>
  );
}

/** Compara el archivo PDF recibido con el emitido (SHA-256 calculado en el navegador; el archivo no se envía). */
function FileCheck({ expected }: { expected: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const supported = typeof crypto !== "undefined" && !!crypto.subtle;
  if (!supported) return null;
  const onFile = async (f: File | undefined) => {
    setMsg(null);
    if (!f) return;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
    setMsg(hash === expected
      ? { ok: true, text: "El archivo es idéntico al que emitió la clínica." }
      : { ok: false, text: "El archivo NO es idéntico al emitido: puede ser otra copia (por ejemplo, la marcada como anulada), una foto o un archivo modificado." });
  };
  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor="vf-file" className="label"><FileSearch size={14} aria-hidden /> Comprobar un archivo PDF (opcional)</label>
        <input id="vf-file" type="file" accept="application/pdf,.pdf" className="input" onChange={(e) => onFile(e.target.files?.[0])} />
        <span className="hint">El archivo se revisa en este dispositivo y no se envía a ningún lado.</span>
      </div>
      {msg && <div className={`alert ${msg.ok ? "ok" : "danger"}`} role="status">{msg.text}</div>}
    </div>
  );
}
