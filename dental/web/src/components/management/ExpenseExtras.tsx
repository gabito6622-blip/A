// B-083: reparto de un gasto entre sucursales y comprobante adjunto (imagen o PDF).
import { useRef, useState } from "react";
import { FileText, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { bs, fmtDateTime } from "../../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "../ui";

export interface ShareRow { branchId: string; percent: string }

/** Mismo reparto que el servidor: piso de cada parte y el residuo a la de mayor porcentaje. */
export function previewSplit(amount: number, bps: number[]): number[] {
  const parts = bps.map((bp) => Math.floor((amount * bp) / 10000));
  const rest = amount - parts.reduce((a, x) => a + x, 0);
  const main = bps.reduce((best, bp, i) => (bp > bps[best]! ? i : best), 0);
  if (parts.length) parts[main]! += rest;
  return parts;
}
const pctOf = (s: string) => Number(String(s).replace(",", "."));

export function SharesEditor({ rows, onChange, amountCents, error }: { rows: ShareRow[]; onChange: (r: ShareRow[]) => void; amountCents: number; error?: string }) {
  const { me } = useAuth();
  const branches = me?.branches ?? [];
  const bps = rows.map((r) => Math.round(pctOf(r.percent || "0") * 100));
  const total = bps.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const ok = total === 10000 && bps.every((x) => Number.isFinite(x) && x > 0);
  const parts = ok && amountCents > 0 ? previewSplit(amountCents, bps) : null;
  const used = new Set(rows.map((r) => r.branchId));
  return (
    <div className="span-2 stack-sm" role="group" aria-label="Reparto entre sucursales">
      {rows.map((r, i) => (
        <div key={i} className="mg-share">
          <Field label={`Sucursal ${i + 1}`}>
            <select className="input" value={r.branchId} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, branchId: e.target.value } : x)))}>
              {branches.map((b) => <option key={b.id} value={b.id} disabled={b.id !== r.branchId && used.has(b.id)}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Porcentaje (%)"><input className="input" inputMode="decimal" value={r.percent} aria-invalid={!!error} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} /></Field>
          <span className="mg-share-amount" aria-live="polite">{parts ? bs(parts[i]!) : "—"}</span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={`Quitar sucursal ${i + 1}`} disabled={rows.length <= 2} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="row-between">
        <button type="button" className="btn btn-sm" disabled={rows.length >= branches.length} onClick={() => {
          const free = branches.find((b) => !used.has(b.id));
          if (free) onChange([...rows, { branchId: free.id, percent: "" }]);
        }}><Plus size={15} />Agregar sucursal</button>
        <span className={`small ${ok ? "muted" : ""}`} style={ok ? undefined : { color: "var(--danger)" }}>Suma: {(total / 100).toLocaleString("es-BO")} % {ok ? "✓" : "(debe ser 100 %)"}</span>
      </div>
      {error && <span id="err-shares" className="hint" role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
      <p className="muted small" style={{ margin: 0 }}>Cada sucursal carga su parte en la rentabilidad. Los centavos que sobran del reparto van a la sucursal con mayor porcentaje.</p>
    </div>
  );
}

/** Valida el reparto en el navegador (el servidor vuelve a validar). */
export function sharesError(rows: ShareRow[]): string | null {
  if (rows.length < 2) return "Elige al menos dos sucursales";
  if (new Set(rows.map((r) => r.branchId)).size !== rows.length) return "Una sucursal aparece dos veces";
  for (const r of rows) {
    const p = pctOf(r.percent || "");
    if (!Number.isFinite(p) || p <= 0 || p >= 100) return "Cada porcentaje debe ser mayor que 0 y menor que 100";
    if (Math.abs(Math.round(p * 100) - p * 100) > 1e-6) return "Los porcentajes admiten como máximo 2 decimales";
  }
  const total = rows.reduce((a, r) => a + Math.round(pctOf(r.percent) * 100), 0);
  return total === 10000 ? null : `Los porcentajes deben sumar 100 % (suman ${(total / 100).toLocaleString("es-BO")} %)`;
}
export const sharesBody = (rows: ShareRow[]) => rows.map((r) => ({ branchId: r.branchId, percent: pctOf(r.percent) }));

// ---------------- Comprobantes ----------------
export function AttachmentsDialog({ expense, onClose, onChanged }: { expense: any; onClose: () => void; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const list = useApi<any>(`/api/expenses/${expense.id}/attachments`);
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canUpload = expense.state !== "voided" && expense.canEdit !== false;
  const upload = async (file: File) => {
    setErr(null);
    if (list.data && file.size > list.data.maxBytes) { setErr(`El archivo supera el límite de ${list.data.maxLabel}`); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/expenses/${expense.id}/attachments`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/octet-stream", "x-csrf-token": me?.csrfToken ?? "", "x-file-name": encodeURIComponent(file.name) }, body: file,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setErr(body?.error?.message ?? "No se pudo adjuntar el archivo"); return; }
      toast("Comprobante adjuntado");
      list.reload(); onChanged();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Dialog title={`Comprobantes · ${expense.description}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Cerrar</button>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {canUpload && (
          <div className="mg-drop">
            <label className="btn btn-primary" style={{ minHeight: 40 }}>
              <Upload size={16} />{busy ? "Subiendo…" : "Adjuntar foto o PDF"}
              <input ref={input} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy}
                aria-label="Archivo del comprobante" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            </label>
            <span className="muted small">JPG, PNG, WebP o PDF{list.data ? ` · hasta ${list.data.maxLabel}` : ""}. Se verifica el tipo real del archivo.</span>
          </div>
        )}
        {!list.data ? <Loading rows={2} /> : !list.data.items.length ? <Empty>Sin comprobantes adjuntos.</Empty> : (
          <ul className="mg-files">
            {list.data.items.map((a: any) => (
              <li key={a.id}>
                {a.isImage ? <img src={a.viewUrl} alt={`Comprobante ${a.originalName ?? ""}`} /> : <span className="mg-file-icon" aria-hidden="true"><FileText size={28} /></span>}
                <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <b style={{ overflowWrap: "anywhere" }}>{a.originalName ?? "Comprobante"}</b>
                  <span className="muted small">{a.typeLabel} · {Math.max(1, Math.round(a.sizeBytes / 1024))} KB · {fmtDateTime(a.createdAt)} · {a.uploadedBy}</span>
                  <a className="btn btn-sm" style={{ alignSelf: "flex-start" }} href={a.downloadUrl}>Descargar</a>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small" style={{ margin: 0 }}>Los comprobantes no se borran: quedan como respaldo del gasto. Los enlaces duran 5 minutos.</p>
      </div>
    </Dialog>
  );
}
