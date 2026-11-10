// Conteo físico por sucursal: hoja, carga de lo contado, ajustes propuestos y aprobación.
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { bs, fmtDateTime } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Empty, Loading, StatusBadge, useAsk, useToast } from "../ui";
import { FormAlert, parseQty, qty, useFormErrors } from "./shared";

const STATUS: Record<string, [string, string]> = { open: ["presented", "Abierta"], approved: ["accepted", "Aprobada"], cancelled: ["cancelled", "Anulada"] };

export function CountsTab({ branchId, onStockChanged }: { branchId: string | null; onStockChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const list = useApi<any[]>(`/api/inventory/counts${branchId ? `?branchId=${branchId}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const openSheet = (list.data ?? []).find((k) => k.status === "open" && (!branchId || k.branchId === branchId));
  useEffect(() => { if (openSheet && !open) setOpen(openSheet.id); }, [openSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    try { const r = await api.post("/api/inventory/counts", { branchId }); toast(`Hoja de conteo N° ${r.number} generada`); list.reload(); setOpen(r.id); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      {!branchId && <div className="alert info">Elige una sucursal arriba para generar o cargar una hoja de conteo.</div>}
      {branchId && !openSheet && can("inventory.write") && (
        <div className="card card-pad row-between">
          <span>Genera la hoja con el saldo actual de cada insumo; luego anota lo que cuentes en los estantes.</span>
          <button className="btn btn-primary" onClick={create}><ClipboardList size={16} />Generar hoja de conteo</button>
        </div>
      )}
      {open && <CountSheet id={open} onChanged={list.reload} onClosed={() => { setOpen(null); list.reload(); onStockChanged?.(); }} />}
      <section className="card">
        <div className="card-head"><h2>Historial de conteos</h2></div>
        {!list.data ? <Loading /> : !list.data.length ? <Empty>Aún no hay conteos.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th className="hide-mobile">Sucursal</th><th>Fecha</th><th className="num">Contadas</th><th>Estado</th></tr></thead>
            <tbody>{list.data.map((k) => (
              <tr key={k.id} className="clickable" tabIndex={0} onClick={() => setOpen(k.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(k.id)}>
                <td>{k.number}</td><td className="hide-mobile">{k.branchName}</td><td>{fmtDateTime(k.createdAt)}</td><td className="num">{k.counted}/{k.lines}</td>
                <td><StatusBadge status={STATUS[k.status]![0]} label={STATUS[k.status]![1]} /></td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>
    </div>
  );
}

function CountSheet({ id, onChanged, onClosed }: { id: string; onChanged: () => void; onClosed: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const sheet = useApi<any>(`/api/inventory/counts/${id}`);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const d = sheet.data;
  useEffect(() => {
    if (d) setVals(Object.fromEntries(d.lines.map((l: any) => [l.id, l.countedQty == null ? "" : String(Number(l.countedQty)).replace(".", ",")])));
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Loading />;
  const editable = d.status === "open" && can("inventory.write");
  const save = async () => {
    const errs: Record<string, string> = {};
    const lines = d.lines.map((l: any) => {
      const n = parseQty(vals[l.id] ?? "");
      if (n != null && (Number.isNaN(n) || n < 0)) errs[l.id] = "Número inválido";
      return { lineId: l.id, countedQty: n };
    });
    if (Object.keys(errs).length) return E.set(errs, "Revisa las cantidades marcadas");
    setBusy(true); E.clear();
    try { const r = await api.put(`/api/inventory/counts/${id}/lines`, { lines }); sheet.setData(r); toast("Conteo guardado"); onChanged(); return true; }
    catch (e) { E.fail(e); return false; } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!(await save())) return;
    const fresh = await api.get<any>(`/api/inventory/counts/${id}`);
    const ok = await ask({ title: "Aprobar ajustes del conteo", message: `Se aplicarán ${fresh.summary.adjustments} ajuste(s) por un total de ${bs(fresh.summary.differenceCents)}. Las líneas sin contar no se modifican.`, confirmLabel: "Aprobar y aplicar" });
    if (!ok) return;
    try { const r = await api.post(`/api/inventory/counts/${id}/approve`, {}); toast(`Conteo aprobado: ${r.adjustments} ajuste(s) aplicados`); onClosed(); }
    catch (e) { E.fail(e); }
  };
  const cancel = async () => {
    const reason = await ask({ title: "Anular hoja de conteo", inputLabel: "Motivo", confirmLabel: "Anular", danger: true });
    if (!reason) return;
    try { await api.post(`/api/inventory/counts/${id}/cancel`, { reason }); toast("Hoja anulada"); onClosed(); } catch (e) { E.fail(e); }
  };
  const rows = d.lines.filter((l: any) => !filter || `${l.itemName} ${l.sku} ${l.lotCode ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="card" aria-label={`Hoja de conteo N° ${d.number}`}>
      <div className="card-head row-between">
        <h2>Hoja de conteo N° {d.number} · {d.branchName}</h2>
        <StatusBadge status={STATUS[d.status]![0]} label={STATUS[d.status]![1]} />
      </div>
      <div className="card-pad stack">
        <FormAlert msg={E.msg} />
        <div className="row-between">
          <input className="input" style={{ maxWidth: 280 }} placeholder="Buscar insumo o lote" aria-label="Buscar en la hoja" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="muted small">Contadas {d.summary.counted} de {d.summary.lines} · {d.summary.adjustments} ajuste(s) propuesto(s) · {bs(d.summary.differenceCents)}</span>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Insumo</th><th className="hide-mobile">Lote</th><th className="num">Sistema</th><th className="num">Contado</th><th className="num">Diferencia</th></tr></thead>
          <tbody>{rows.map((l: any) => (
            <tr key={l.id}>
              <td><b>{l.itemName}</b><span className="inv-sub">{l.sku}{l.lotCode ? <span className="inv-mobile-only"> · lote {l.lotCode}</span> : ""}</span></td>
              <td className="hide-mobile">{l.lotCode ?? "—"}{l.expiresOn && <span className="inv-sub">vence {l.expiresOn.split("-").reverse().join("/")}</span>}</td>
              <td className="num">{qty(l.expectedQty)} <span className="muted small">{l.useUnit}</span></td>
              <td className="num">
                {editable ? (
                  <>
                    <input className="input inv-count-input" inputMode="decimal" aria-label={`Contado de ${l.itemName}${l.lotCode ? ` lote ${l.lotCode}` : ""}`}
                      value={vals[l.id] ?? ""} aria-invalid={!!E.field(l.id)} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} />
                    {E.field(l.id) && <span className="inv-err" role="alert" style={{ display: "block" }}>{E.field(l.id)}</span>}
                  </>
                ) : qty(l.countedQty)}
              </td>
              <td className="num">{l.difference == null ? <span className="muted">—</span> : l.difference === 0 ? "0" : <span className={`badge ${l.difference < 0 ? "danger" : "ok"}`}>{l.difference > 0 ? "+" : ""}{qty(l.difference)}</span>}</td>
            </tr>))}
          </tbody></table></div>
        {d.status === "open" && (
          <div className="inv-actions">
            {editable && <button className="btn" disabled={busy} onClick={save}>Guardar lo contado</button>}
            {can("inventory.manage") && <button className="btn btn-primary" disabled={busy} onClick={approve}>Aprobar ajustes</button>}
            {can("inventory.manage") && <button className="btn btn-danger" onClick={cancel}>Anular hoja</button>}
            {!can("inventory.manage") && <span className="muted small">Cuando termines, la administración revisa y aprueba los ajustes.</span>}
          </div>
        )}
        {d.decidedNote && <p className="small muted">{d.status === "cancelled" ? "Motivo" : "Nota"}: {d.decidedNote}</p>}
      </div>
    </section>
  );
}
