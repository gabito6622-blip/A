// Conciliación bancaria por extracto (B-021): subir Excel o CSV, elegir columnas, vista previa,
// importar y confirmar cada emparejamiento (nunca se verifica solo).
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileUp, Landmark } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { bs, fmtDate, fmtDateTime } from "../lib/format";
import { Empty, Field, Loading, Tabs, useAsk, useToast } from "../components/ui";
import { ymdText } from "../components/agreements/AgreementWidgets";
import "../components/agreements/agreements.css";

interface Mapping { headerRow: number; date: number; amount: number; description: number | null; reference: number | null; dateOrder: "dmy" | "ymd" | "mdy" }

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("No se pudo leer el archivo"));
  r.readAsDataURL(file);
});

const ROW_STATUS: Record<string, [string, string]> = { ok: ["Nuevo", "info"], dup: ["Ya importado", ""], debit: ["No se concilia", ""], error: ["Error", "danger"] };
const MATCH: Record<string, [string, string]> = { exact: ["Coincidencia exacta", "ok"], suggested: ["Sugerencia", "warn"], already_verified: ["Ya verificado", ""] };

export function ReconciliationPage() {
  const [tab, setTab] = useState<"unmatched" | "matched" | "ignored" | "statements">("unmatched");
  const [key, setKey] = useState(0);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Conciliación bancaria</h1><p className="sub">Sube el extracto del banco y confirma qué pagos QR o transferencias ingresaron de verdad.</p></div></div>
      <div className="alert info" role="note"><Landmark size={16} style={{ verticalAlign: "-3px" }} /> El sistema solo <b>sugiere</b> emparejamientos. Cada pago se confirma cuando una persona lo revisa y pulsa «Confirmar»; quien registró el pago no puede confirmarlo.</div>
      <UploadCard onImported={() => { setKey((k) => k + 1); setTab("unmatched"); }} />
      <Tabs value={tab} onChange={setTab} items={[{ id: "unmatched", label: "Por conciliar" }, { id: "matched", label: "Conciliados" }, { id: "ignored", label: "Descartados" }, { id: "statements", label: "Extractos importados" }]} />
      {tab === "statements" ? <Statements key={key} /> : <Lines key={`${tab}-${key}`} status={tab} />}
    </div>
  );
}

function UploadCard({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [account, setAccount] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [pv, setPv] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accErr, setAccErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = async (f: { name: string; b64: string }, m: Mapping | null) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/bank-statements/preview", { fileBase64: f.b64, fileName: f.name, mapping: m });
      setPv(r); setMapping(r.mapping);
    } catch (e: any) {
      setErr(e.message);
      if (e.code === "mapping_required" && Array.isArray(e.details?.headers)) {
        // No se reconocieron los títulos: se muestran las primeras filas para elegir las columnas a mano.
        const sample: string[][] = e.details.headers.map((r: unknown[]) => r.map((x) => (x == null ? "" : String(x))));
        setPv({ headers: sample[0] ?? [], sample, rows: [], summary: { toImport: 0, exact: 0, suggested: 0, duplicates: 0, debits: 0, errors: 0 } });
        setMapping({ headerRow: 0, date: 0, amount: Math.max(0, (sample[0]?.length ?? 1) - 1), description: null, reference: null, dateOrder: "dmy" });
      } else setPv(null);
    } finally { setBusy(false); }
  };
  const pick = async (fl: FileList | null) => {
    const x = fl?.[0];
    if (!x) return;
    if (x.size > 5 * 1024 * 1024) { setErr("El archivo supera 5 MB"); return; }
    const f = { name: x.name, b64: await toBase64(x) };
    setFile(f); setMapping(null); await preview(f, null);
  };
  const changeMap = (patch: Partial<Mapping>) => { if (!file || !mapping) return; const m = { ...mapping, ...patch }; setMapping(m); preview(file, m); };
  const doImport = async () => {
    if (!file || !mapping) return;
    if (account.trim().length < 2) { setAccErr("Indica la cuenta o el banco del extracto"); return; }
    setAccErr(null); setBusy(true);
    try {
      const r = await api.post("/api/bank-statements", { fileBase64: file.b64, fileName: file.name, mapping, accountLabel: account.trim() });
      toast(`Extracto importado: ${r.imported} movimientos nuevos${r.duplicates ? `, ${r.duplicates} ya estaban` : ""}. Ningún pago se verificó solo.`);
      setFile(null); setPv(null); setMapping(null); onImported();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const headers: string[] = pv?.headers ?? [];
  const colSel = (label: string, k: keyof Mapping, optional = false) => (
    <Field label={label}>
      <select className="input" value={mapping?.[k] === null || mapping?.[k] === undefined ? "" : String(mapping[k])} onChange={(e) => changeMap({ [k]: e.target.value === "" ? null : Number(e.target.value) } as Partial<Mapping>)}>
        {optional && <option value="">(sin columna)</option>}
        {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
      </select>
    </Field>
  );
  return (
    <div className="card card-pad stack">
      <h2>Subir extracto</h2>
      <div className="ag-drop">
        <label className="stack-sm" style={{ alignItems: "center", cursor: "pointer" }}>
          <FileUp size={22} aria-hidden="true" />
          <span><b>Elegir archivo del extracto</b> (Excel .xlsx o CSV, hasta 5 MB)</span>
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Archivo del extracto" onChange={(e) => pick(e.target.files)} />
        </label>
        {file && <div className="small muted" style={{ marginTop: 6 }}>{file.name}</div>}
      </div>
      {err && <div className="alert danger" role="alert">{err}</div>}
      {busy && !pv && <Loading rows={2} />}
      {pv && mapping && <>
        <div className="ag-map">
          <Field label="Fila de títulos"><select className="input" value={mapping.headerRow} onChange={(e) => changeMap({ headerRow: Number(e.target.value) })}>{pv.sample.map((r: string[], i: number) => <option key={i} value={i}>Fila {i + 1}: {r.filter(Boolean).slice(0, 3).join(" · ").slice(0, 40)}</option>)}</select></Field>
          {colSel("Fecha", "date")}
          {colSel("Monto del abono", "amount")}
          {colSel("Referencia / N° de operación", "reference", true)}
          {colSel("Descripción", "description", true)}
          <Field label="Formato de fecha"><select className="input" value={mapping.dateOrder} onChange={(e) => changeMap({ dateOrder: e.target.value as Mapping["dateOrder"] })}><option value="dmy">día/mes/año</option><option value="ymd">año-mes-día</option><option value="mdy">mes/día/año</option></select></Field>
        </div>
        <div className="row">
          <span className="badge info">{pv.summary.toImport} abonos nuevos</span>
          <span className="badge ok">{pv.summary.exact} exactos</span>
          <span className="badge warn">{pv.summary.suggested} sugeridos</span>
          {pv.summary.duplicates > 0 && <span className="badge">{pv.summary.duplicates} ya importados</span>}
          {pv.summary.debits > 0 && <span className="badge">{pv.summary.debits} débitos (no se concilian)</span>}
          {pv.summary.errors > 0 && <span className="badge danger">{pv.summary.errors} con error</span>}
        </div>
        <table className="table rt">
          <thead><tr><th>Fila</th><th>Fecha</th><th>Descripción</th><th>Referencia</th><th className="num">Monto</th><th>Estado</th></tr></thead>
          <tbody>{pv.rows.slice(0, 60).map((r: any) => {
            const st = r.status === "ok" ? (r.duplicate ? ROW_STATUS.dup! : ROW_STATUS.ok!) : ROW_STATUS[r.status]!;
            return (
              <tr key={r.rowNumber}>
                <td data-label="Fila">{r.rowNumber}</td>
                <td data-label="Fecha">{r.date ? ymdText(r.date) : "—"}</td>
                <td className="rt-main">{r.description ?? "—"}</td>
                <td data-label="Referencia"><code>{r.reference ?? "—"}</code></td>
                <td data-label="Monto" className="num">{r.amountCents != null ? bs(r.amountCents) : "—"}</td>
                <td data-label="Estado"><span className={`badge ${st[1]}`}>{st[0]}</span>{r.match && !r.duplicate && <> <span className={`badge ${MATCH[r.match]![1]}`}>{MATCH[r.match]![0]}</span></>}{r.message && <div className="small muted">{r.message}</div>}</td>
              </tr>);
          })}</tbody>
        </table>
        {pv.rows.length > 60 && <p className="small muted">Se muestran 60 de {pv.rows.length} filas.</p>}
        <div className="form-grid">
          <Field label="Cuenta o banco del extracto"><input className="input" value={account} placeholder="Ej.: Banco X, cuenta 1-234567" aria-invalid={!!accErr} onChange={(e) => setAccount(e.target.value)} />{accErr && <span className="ag-err">{accErr}</span>}</Field>
          <div style={{ alignSelf: "end" }}><button className="btn btn-primary ag-tap" disabled={busy || !pv.summary.toImport} onClick={doImport}>{busy ? "Importando…" : `Importar ${pv.summary.toImport} movimientos`}</button></div>
        </div>
      </>}
    </div>
  );
}

function Lines({ status }: { status: "unmatched" | "matched" | "ignored" }) {
  const toast = useToast();
  const ask = useAsk();
  const lines = useApi<any[]>(`/api/bank-lines?status=${status}`);
  const confirm = async (l: any, c: any) => {
    const ok = await ask({ title: "Confirmar pago con el extracto", message: `Se confirmará el pago de ${c.who} por ${bs(c.amountCents)} (ref. ${c.bankReference ?? "—"}) con el movimiento del ${ymdText(l.date)}${l.reference ? ` (ref. ${l.reference})` : ""}. Quedará registrado a tu nombre.`, confirmLabel: "Confirmar pago" });
    if (!ok) return;
    try {
      await api.post(`/api/bank-lines/${l.id}/match`, c.kind === "payment" ? { paymentId: c.id } : { payerPaymentId: c.id });
      toast(c.status === "confirmed" ? "Movimiento vinculado al pago ya verificado" : "Pago confirmado con el extracto"); lines.reload();
    } catch (e: any) { toast(e.message, true); }
  };
  const ignore = async (l: any) => {
    const reason = await ask({ title: "Descartar movimiento", message: "Úsalo para movimientos que no son cobros a pacientes ni a empresas (depósitos propios, intereses…).", inputLabel: "Motivo", confirmLabel: "Descartar", danger: true });
    if (!reason) return;
    try { await api.post(`/api/bank-lines/${l.id}/ignore`, { reason }); toast("Movimiento descartado"); lines.reload(); } catch (e: any) { toast(e.message, true); }
  };
  if (!lines.data) return <Loading />;
  if (!lines.data.length) return <div className="card"><Empty>{status === "unmatched" ? "No hay movimientos por conciliar." : "Sin movimientos."}</Empty></div>;
  return (
    <div className="stack">
      {lines.data.map((l) => (
        <div key={l.id} className="card card-pad stack-sm" data-testid="bank-line">
          <div className="row-between">
            <div className="stack-sm" style={{ gap: 2 }}>
              <b>{bs(l.amountCents)} · {ymdText(l.date)}</b>
              <span className="small muted">{l.description ?? "Sin descripción"}{l.reference ? <> · ref. <code>{l.reference}</code></> : null} · {l.accountLabel}</span>
            </div>
            {status === "unmatched" && <button className="btn btn-ghost btn-sm ag-tap" onClick={() => ignore(l)}>Descartar</button>}
            {status === "matched" && <span className="badge ok">{MATCH[l.matchKind]?.[0] ?? (l.matchKind === "manual" ? "Emparejado a mano" : "Conciliado")}</span>}
          </div>
          {status === "matched" && <span className="small">Pago de <b>{l.matchedWho}</b> (ref. {l.matchedReference}) · {l.resolvedByName} · {fmtDateTime(l.resolvedAt)}</span>}
          {status === "ignored" && <span className="small">Descartado por {l.resolvedByName} el {fmtDate(l.resolvedAt)}: {l.note}</span>}
          {status === "unmatched" && (l.candidates.length ? l.candidates.map((c: any) => (
            <div key={c.id} className="ag-cand">
              <div className="stack-sm" style={{ gap: 2 }}>
                <span><span className={`badge ${MATCH[c.matchKind]![1]}`}>{MATCH[c.matchKind]![0]}</span> {c.kind === "payment" ? <Link to="/caja">{c.who}</Link> : c.who}</span>
                <span className="small muted">{c.methodLabel} · ref. {c.bankReference ?? "—"} · registrado el {fmtDate(c.receivedAt)} por {c.receivedByName}{c.status === "confirmed" ? " · ya verificado a mano" : " · por verificar"}</span>
                {c.blockedReason && <span className="small" style={{ color: "var(--warn)" }}>{c.blockedReason}</span>}
              </div>
              <button className="btn btn-primary btn-sm ag-tap" disabled={!c.canConfirm} onClick={() => confirm(l, c)}><CheckCircle2 size={15} />{c.status === "confirmed" ? "Vincular" : "Confirmar"}</button>
            </div>
          )) : <span className="small muted">Sin pago que coincida: queda para revisión. Revisa si falta registrar el pago en Caja o Convenios.</span>)}
        </div>
      ))}
    </div>
  );
}

function Statements() {
  const { can } = useAuth();
  const list = useApi<any[]>(can("payments.verify") ? "/api/bank-statements" : null);
  if (!list.data) return <Loading />;
  if (!list.data.length) return <div className="card"><Empty>Todavía no se importó ningún extracto.</Empty></div>;
  return (
    <div className="card">
      <table className="table rt">
        <thead><tr><th>Extracto</th><th>Importado</th><th className="num">Nuevos</th><th className="num">Repetidos</th><th className="num">Por conciliar</th><th className="num">Conciliados</th></tr></thead>
        <tbody>{list.data.map((s) => (
          <tr key={s.id}>
            <td className="rt-main"><b>{s.accountLabel}</b><div className="muted small">{s.fileName}</div></td>
            <td data-label="Importado">{fmtDateTime(s.uploadedAt)}<div className="muted small">{s.uploadedByName}</div></td>
            <td data-label="Nuevos" className="num">{s.importedRows}</td>
            <td data-label="Repetidos" className="num">{s.duplicateRows}</td>
            <td data-label="Por conciliar" className="num">{s.unmatched}</td>
            <td data-label="Conciliados" className="num">{s.matched}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}
