// Importar datos desde el sistema anterior (B-006): pacientes, citas futuras y saldos iniciales.
// Siempre en dos pasos: «Revisar» (no guarda nada) e «Importar» (con el número exacto confirmado).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, FileSpreadsheet, Info, Upload } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { fmtDateTime, localDate } from "../lib/format";
import { Empty, Field, Loading, useAsk, useToast } from "../components/ui";
import "../components/onboarding/onboarding.css";

type Kind = "patients" | "appointments" | "balances";
const KINDS: { id: Kind; label: string; noun: [string, string]; hint: string }[] = [
  { id: "patients", label: "Pacientes", noun: ["paciente", "pacientes"], hint: "Datos personales y de contacto. Empieza por aquí." },
  { id: "appointments", label: "Citas futuras", noun: ["cita", "citas"], hint: "Se validan con la agenda: sin solapes y dentro del horario." },
  { id: "balances", label: "Saldos iniciales", noun: ["saldo inicial", "saldos iniciales"], hint: "Deuda o saldo a favor de cada paciente al día del corte." },
];
interface FieldDef { key: string; label: string; required?: boolean; help: string }
interface RowResult { row: number; status: "ok" | "duplicate" | "error" | "review" | "skipped"; message?: string; ref?: string; imported?: boolean; values: Record<string, string> }
interface Summary { dryRun: boolean; total: number; create: number; duplicates: number; errors: number; review: number; reviewIncluded: number; skipped: number }

const STATUS: Record<RowResult["status"], [string, string]> = {
  ok: ["Se creará", "ok"], duplicate: ["Ya existe", "warn"], error: ["Error", "danger"], review: ["Para revisar", "warn"], skipped: ["Se omite", ""],
};

const readFile = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("No se pudo leer el archivo"));
  r.readAsDataURL(f);
});

export function ImportPage() {
  const { can, me } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const [sp, setSp] = useSearchParams();
  const kind = (KINDS.some((k) => k.id === sp.get("tipo")) ? sp.get("tipo") : "patients") as Kind;
  const meta = KINDS.find((k) => k.id === kind)!;
  const fields = useApi<{ fields: FieldDef[] }>(can("patients.import") ? `/api/imports/${kind}/fields` : null);
  const batches = useApi<any[]>(can("patients.import") ? "/api/imports/batches" : null);
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [inspect, setInspect] = useState<{ headers: string[]; rowCount: number; preview: { row: number; cells: string[] }[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [includeReview, setIncludeReview] = useState(false);
  const [cutoff, setCutoff] = useState(localDate());
  const [review, setReview] = useState<{ summary: Summary; results: RowResult[]; truncated?: boolean } | null>(null);
  const [done, setDone] = useState<{ summary: Summary; batchId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Cambiar de tipo reinicia todo (y descarta respuestas de un archivo leído con el tipo anterior)
  const kindRef = useRef(kind);
  kindRef.current = kind;
  useEffect(() => { setFile(null); setInspect(null); setMapping({}); setReview(null); setDone(null); setErr(null); setIncludeReview(false); }, [kind]);
  const invalidate = () => { setReview(null); setDone(null); };

  const body = useMemo(() => file ? {
    fileBase64: file.b64, fileName: file.name, mapping, includeReview, ...(kind === "balances" ? { cutoffDate: cutoff } : {}),
  } : null, [file, mapping, includeReview, cutoff, kind]);

  if (!can("patients.import")) return <Empty>Tu rol no puede importar datos. Pide a propietario o administración que lo haga.</Empty>;

  const choose = async (f: File | undefined) => {
    invalidate(); setErr(null); setInspect(null);
    if (!f) { setFile(null); return; }
    if (!/\.xlsx$/i.test(f.name)) { setFile(null); setErr("Elige un archivo de Excel (.xlsx). Si tienes .xls o .csv, ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)»."); return; }
    if (f.size > 10 * 1024 * 1024) { setFile(null); setErr("El archivo pesa más de 10 MB: divídelo en partes."); return; }
    setBusy("inspect");
    try {
      const k = kind;
      const b64 = await readFile(f);
      const r = await api.post(`/api/imports/${k}/inspect`, { fileBase64: b64 });
      if (kindRef.current !== k) return;
      setFile({ name: f.name, b64 }); setInspect(r); setMapping(r.mapping);
    } catch (e: any) { setFile(null); setErr(e.message); } finally { setBusy(null); }
  };

  const runReview = async () => {
    if (!body) return;
    setBusy("review"); setErr(null); setDone(null);
    try { setReview(await api.post(`/api/imports/${kind}`, { ...body, dryRun: true })); }
    catch (e: any) { setReview(null); setErr(e.message); } finally { setBusy(null); }
  };

  const runImport = async () => {
    if (!body || !review) return;
    const n = review.summary.create;
    const noun = meta.noun[n === 1 ? 0 : 1];
    const ok = await ask({
      title: `Importar ${n} ${noun}`,
      message: `Se crearán exactamente ${n} ${noun}. Las filas con errores, duplicadas${includeReview ? "" : " o para revisar"} no se importan. Esta acción queda registrada y no se deshace con un clic (los registros creados se corrigen o anulan uno por uno).`,
      confirmLabel: `Importar ${n} ${noun}`,
    });
    if (!ok) return;
    setBusy("import"); setErr(null);
    try {
      const r = await api.post(`/api/imports/${kind}`, { ...body, dryRun: false, expectedCreate: n });
      setDone({ summary: r.summary, batchId: r.batchId }); setReview(null);
      toast(`Importación lista: ${r.summary.create === 1 ? "se creó" : "se crearon"} ${r.summary.create} ${meta.noun[r.summary.create === 1 ? 0 : 1]}`);
      batches.reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  const downloadReview = async () => {
    if (!body) return;
    setBusy("report");
    try {
      const res = await fetch(`/api/imports/${kind}/report.xlsx`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": me?.csrfToken ?? "" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "No se pudo generar el reporte");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `revision-${kind}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  const fieldList = fields.data?.fields ?? [];
  const problems = review?.results.filter((r) => r.status !== "ok") ?? [];
  const step = done ? 4 : review ? 3 : inspect ? 2 : 1;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Importar datos</h1>
          <p className="sub">Trae tus pacientes, citas futuras y saldos desde el sistema que usabas antes, con un archivo de Excel.</p>
        </div>
      </div>

      <div className="ob-kinds" role="group" aria-label="Qué quieres importar">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="ob-kind" aria-pressed={kind === k.id} onClick={() => setSp({ tipo: k.id }, { replace: true })}>
            <b>{k.label}</b><span className="muted small">{k.hint}</span>
          </button>
        ))}
      </div>

      <ol className="ob-steps" aria-label="Pasos">
        {["Archivo", "Columnas", "Revisar", "Importar"].map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "done" : ""}>{i + 1}. {s}</li>
        ))}
      </ol>

      <section className="card" aria-labelledby="imp-file">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <h2 id="imp-file" style={{ margin: 0 }}>1. Elige el archivo de {meta.label.toLowerCase()}</h2>
          <a className="btn" style={{ minHeight: 40 }} href={`/api/imports/${kind}/template.xlsx`}><Download size={16} />Descargar plantilla</a>
        </div>
        <div className="card-pad stack">
          {kind === "appointments" && <div className="alert info small">Importa primero los pacientes: cada cita se vincula al paciente por su CI o su N° de ficha. Los profesionales deben existir en <Link to="/configuracion?tab=staff">Configuración › Personal</Link> con su horario.</div>}
          {kind === "balances" && <div className="alert info small">El saldo inicial es un movimiento de apertura aparte: suma a la deuda o al saldo a favor del paciente, pero no cuenta como producción ni como cobro de caja. Un paciente tiene un solo saldo inicial; si te equivocas se anula desde su cuenta.</div>}
          <label className="ob-file">
            <FileSpreadsheet size={22} aria-hidden="true" />
            <span className="stack-sm" style={{ gap: 2 }}>
              <b>Archivo de Excel (.xlsx)</b>
              <span className="muted small">La primera fila debe tener los títulos. Máximo 5000 filas.</span>
            </span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Archivo de Excel" onChange={(e) => choose(e.target.files?.[0])} />
          </label>
          {busy === "inspect" && <Loading rows={2} />}
          {file && inspect && <p className="small"><b>{file.name}</b>: {inspect.rowCount} filas con datos.</p>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", minHeight: 40 }} aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}>
            <Info size={15} />{showHelp ? "Ocultar qué columnas acepta" : "Ver qué columnas acepta"}
          </button>
          {showHelp && (
            <div className="table-wrap"><table className="table cards-sm">
              <thead><tr><th aria-label="Columna" /><th>Obligatoria</th><th>Qué escribir</th></tr></thead>
              <tbody>{fieldList.map((f) => <tr key={f.key}><td><b>{f.label}</b></td><td>{f.required ? "Sí" : "No"}</td><td className="small">{f.help}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </section>

      {err && <div className="alert danger" role="alert">{err}</div>}

      {inspect && file && (
        <section className="card" aria-labelledby="imp-map">
          <div className="card-head"><h2 id="imp-map" style={{ margin: 0 }}>2. Revisa qué columna es cada dato</h2></div>
          <div className="card-pad stack">
            <p className="muted small" style={{ margin: 0 }}>Reconocimos las columnas por su título. Corrige las que no correspondan; lo que no esté en tu archivo déjalo en «No está en mi archivo».</p>
            <div className="ob-map">
              {fieldList.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} hint={f.help}>
                  <select className="input" value={mapping[f.key] ?? ""} onChange={(e) => { invalidate(); setMapping({ ...mapping, [f.key]: e.target.value ? Number(e.target.value) : null }); }}>
                    <option value="">— No está en mi archivo —</option>
                    {inspect.headers.map((h, i) => <option key={i} value={i + 1}>{h || `Columna ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div className="stack-sm">
              <span className="label">Vista previa (primeras filas)</span>
              <div className="table-wrap ob-preview"><table className="table">
                <thead><tr><th>Fila</th>{inspect.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>{inspect.preview.map((r) => <tr key={r.row}><td className="muted">{r.row}</td>{r.cells.map((c, i) => <td key={i} className="small">{c}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
            <div className="form-grid">
              {kind === "balances" && (
                <Field label="Fecha de corte" hint="Para las filas sin fecha propia: el día al que corresponden los saldos.">
                  <input className="input" type="date" value={cutoff} max={localDate()} onChange={(e) => { invalidate(); setCutoff(e.target.value); }} />
                </Field>
              )}
              {kind !== "balances" && (
                <label className="check span-2">
                  <input type="checkbox" checked={includeReview} onChange={(e) => { invalidate(); setIncludeReview(e.target.checked); }} />
                  {kind === "appointments" ? "Importar también las citas fuera del horario del profesional (quedan marcadas para revisar)" : "Importar también los posibles duplicados (mismo celular o nombre parecido)"}
                </label>
              )}
            </div>
            <button className="btn btn-primary" style={{ alignSelf: "flex-start", minHeight: 40 }} disabled={!!busy} onClick={runReview}>
              {busy === "review" ? "Revisando…" : "Revisar"}
            </button>
          </div>
        </section>
      )}

      {review && (
        <section className="card" aria-labelledby="imp-review">
          <div className="card-head" style={{ flexWrap: "wrap" }}>
            <h2 id="imp-review" style={{ margin: 0 }}>3. Resultado de la revisión</h2>
            <span className="badge info">No se guardó nada todavía</span>
          </div>
          <div className="card-pad stack">
            <div className="ob-sum" role="status">
              <div className="ok"><span className="muted small">Se crearán</span><b>{review.summary.create}</b></div>
              <div className="warn"><span className="muted small">Duplicados</span><b>{review.summary.duplicates}</b></div>
              <div className="danger"><span className="muted small">Errores</span><b>{review.summary.errors}</b></div>
              <div className="warn"><span className="muted small">Para revisar{review.summary.reviewIncluded ? " (se importan)" : ""}</span><b>{review.summary.review}</b></div>
            </div>
            {review.summary.skipped > 0 && <p className="muted small" style={{ margin: 0 }}>{review.summary.skipped} filas se omiten porque no tienen nada que registrar (por ejemplo, saldo cero).</p>}
            {problems.length > 0 ? (
              <div className="table-wrap" style={{ maxHeight: 420 }}><table className="table cards-sm">
                <thead><tr><th aria-label="Fila" /><th>Resultado</th><th>Detalle</th></tr></thead>
                <tbody>{problems.slice(0, 300).map((r) => (
                  <tr key={r.row}>
                    <td><b>Fila {r.row}</b></td>
                    <td><span className={`badge ${STATUS[r.status][1]}`}>{r.status === "review" && r.imported ? "Se importará para revisar" : STATUS[r.status][0]}</span></td>
                    <td className="small">{r.message}{r.ref ? <span className="muted"> · {r.ref}</span> : null}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <div className="alert ok">Todas las filas están correctas.</div>}
            {problems.length > 300 && <p className="muted small">Se muestran las primeras 300 filas con observaciones; el reporte completo está en el Excel.</p>}
            <div className="row">
              <button className="btn" style={{ minHeight: 40 }} disabled={!!busy} onClick={downloadReview}><Download size={16} />{busy === "report" ? "Generando…" : "Descargar reporte (Excel)"}</button>
              <button className="btn btn-primary" style={{ minHeight: 40 }} disabled={!!busy || review.summary.create === 0} onClick={runImport}>
                <Upload size={16} />{busy === "import" ? "Importando…" : `Importar ${review.summary.create} ${meta.noun[review.summary.create === 1 ? 0 : 1]}`}
              </button>
            </div>
            {review.summary.create === 0 && <p className="muted small" style={{ margin: 0 }}>No hay nada nuevo para importar. Corrige el archivo con ayuda del reporte y vuelve a elegirlo.</p>}
          </div>
        </section>
      )}

      {done && (
        <div className="alert ok stack-sm" role="status">
          <b>4. Importación lista: {done.summary.create === 1 ? "se creó" : "se crearon"} {done.summary.create} {meta.noun[done.summary.create === 1 ? 0 : 1]}.</b>
          <span>{done.summary.duplicates} duplicados y {done.summary.errors} con errores no se importaron{done.summary.review ? `; ${done.summary.review} para revisar` : ""}. Puedes volver a importar el mismo archivo corregido: lo que ya entró no se duplica.</span>
          <div className="row">
            <a className="btn btn-sm" style={{ minHeight: 40 }} href={`/api/imports/batches/${done.batchId}/report.xlsx`}><Download size={15} />Reporte fila por fila</a>
            {kind === "patients" && <Link className="btn btn-sm" style={{ minHeight: 40 }} to="/importar?tipo=appointments">Seguir con las citas futuras</Link>}
            {kind === "appointments" && <Link className="btn btn-sm" style={{ minHeight: 40 }} to="/importar?tipo=balances">Seguir con los saldos iniciales</Link>}
            <Link className="btn btn-sm" style={{ minHeight: 40 }} to="/">Volver al Inicio</Link>
          </div>
        </div>
      )}

      <section className="card" aria-labelledby="imp-hist">
        <div className="card-head"><h2 id="imp-hist" style={{ margin: 0 }}>Importaciones realizadas</h2></div>
        {!batches.data ? <Loading rows={2} /> : batches.data.length === 0 ? <Empty>Todavía no importaste nada.</Empty> : (
          <div className="table-wrap"><table className="table cards-sm">
            <thead><tr><th aria-label="Tipo" /><th>Fecha</th><th>Archivo</th><th className="num">Creados</th><th className="num">Duplicados</th><th className="num">Errores</th><th>Por</th><th /></tr></thead>
            <tbody>{batches.data.map((b) => (
              <tr key={b.id}>
                <td><b>{b.kindLabel}</b></td><td className="nowrap">{fmtDateTime(b.createdAt)}</td><td className="small">{b.fileName ?? "—"}</td>
                <td className="num">{b.createdCount}</td><td className="num">{b.duplicateCount}</td><td className="num">{b.errorCount}</td><td className="small">{b.createdBy}</td>
                <td><a className="btn btn-sm" style={{ minHeight: 40 }} href={`/api/imports/batches/${b.id}/report.xlsx`} aria-label={`Reporte de la importación del ${fmtDateTime(b.createdAt)}`}><Download size={14} />Reporte</a></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
