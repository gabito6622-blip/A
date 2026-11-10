// Compras: sugerencia de reposición, órdenes de compra (borrador → enviada → recibida → cerrada),
// recepción por lote con rechazo y motivo, y proveedores.
import { useState } from "react";
import { PackageCheck, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { bs, fmtDate, fmtDateTime, localDate, parseBs, toBsInput } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Dialog, Empty, Loading, StatusBadge, useAsk, useToast } from "../ui";
import type { InvItem } from "./Dialogs";
import { BranchSelect, FormAlert, InvField, parseQty, qty, useFormErrors, useInvBranch } from "./shared";

const PO_TONE: Record<string, string> = { draft: "draft", sent: "presented", partial: "pending_verification", received: "accepted", closed: "completed", cancelled: "cancelled" };

export function PurchasingTab({ items, onStockChanged }: { items: InvItem[]; onStockChanged?: () => void }) {
  const { can } = useAuth();
  const { current, defaultBranch } = useInvBranch();
  const [status, setStatus] = useState("");
  const list = useApi<any[]>(`/api/inventory/purchase-orders?${current ? `branchId=${current}&` : ""}${status ? `status=${status}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  return (
    <div className="stack">
      {current && <Reorder branchId={current} onCreated={(id) => { list.reload(); setOpen(id); }} canWrite={can("inventory.write")} />}
      <section className="card">
        <div className="card-head row-between">
          <h2 className="row"><ShoppingCart size={18} />Órdenes de compra</h2>
          <div className="row">
            <select className="input" style={{ width: "auto" }} aria-label="Estado de la orden" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option><option value="draft">Borradores</option><option value="sent">Enviadas</option><option value="partial">Recibidas en parte</option>
              <option value="received">Recibidas</option><option value="closed">Cerradas</option><option value="cancelled">Anuladas</option>
            </select>
            {can("inventory.write") && <button className="btn btn-primary" onClick={() => setEditing({ branchId: defaultBranch, lines: [] })}><Plus size={16} />Nueva orden</button>}
          </div>
        </div>
        {!list.data ? <Loading /> : !list.data.length ? <Empty>No hay órdenes de compra.</Empty> : (
          <div className="table-wrap"><table className="table cards-sm">
            <thead><tr><th>N°</th><th>Proveedor</th><th className="hide-mobile">Llega a</th><th className="hide-mobile">Entrega prevista</th><th className="num">Total</th><th>Estado</th></tr></thead>
            <tbody>{list.data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(p.id)}>
                <td className="nowrap"><b>{p.code}</b></td><td>{p.supplierName}</td><td className="hide-mobile">{p.branchName}</td>
                <td className="hide-mobile">{p.expectedOn ? fmtDate(p.expectedOn + "T12:00:00Z") : "—"}</td><td className="num">{bs(p.totalCents)}</td>
                <td><StatusBadge status={PO_TONE[p.status] ?? ""} label={p.statusLabel} /></td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>
      {open && <PoDialog id={open} items={items} onClose={() => setOpen(null)} onChanged={() => { list.reload(); onStockChanged?.(); }} onEdit={(po) => { setOpen(null); setEditing(po); }} />}
      {editing && <PoEditDialog po={editing} items={items} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); list.reload(); setOpen(id); }} />}
    </div>
  );
}

function Reorder({ branchId, onCreated, canWrite }: { branchId: string; onCreated: (id: string) => void; canWrite: boolean }) {
  const toast = useToast();
  const sug = useApi<any[]>(`/api/inventory/reorder?branchId=${branchId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = sug.data ?? [];
  const groups = new Map<string, any[]>();
  for (const r of rows) if (r.suggestedPurchase > 0 && r.supplierId) groups.set(r.supplierId, [...(groups.get(r.supplierId) ?? []), r]);
  const create = async (supplierId: string, lines: any[]) => {
    setBusy(supplierId);
    try {
      const r = await api.post("/api/inventory/purchase-orders", { supplierId, branchId, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.suggestedPurchase, unitPriceCents: l.lastPriceCents ?? 0 })) });
      toast(`Orden en borrador creada (OC-${String(r.number).padStart(4, "0")})`); sug.reload(); onCreated(r.id);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(null); }
  };
  if (!sug.data) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Sugerencia de reposición</h2></div>
      {!rows.length ? <Empty>Ningún insumo está por debajo del mínimo en esta sucursal.</Empty> : (
        <div className="card-pad stack">
          <p className="muted small">Sugerido = mínimo + consumo promedio de un mes (según los últimos 60 días) − stock actual − lo ya pedido. Se redondea a unidades de compra.</p>
          <div className="table-wrap"><table className="table cards-sm">
            <thead><tr><th>Insumo</th><th className="num">Stock / mín.</th><th className="num hide-mobile">Consumo al mes</th><th className="num hide-mobile">Ya pedido</th><th className="num">Sugerido</th><th className="hide-mobile">Proveedor</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.itemId}>
                <td><b>{r.name}</b><span className="inv-sub">{r.sku}</span></td>
                <td className="num">{qty(r.qty)} / {qty(r.minQty)} {r.useUnit}</td>
                <td className="num hide-mobile">{qty(r.avgMonthly)}</td>
                <td className="num hide-mobile">{qty(r.onOrder)}</td>
                <td className="num"><b>{r.suggestedPurchase}</b> <span className="muted small">{r.purchaseUnit}</span></td>
                <td className="hide-mobile">{r.supplierName ?? <span className="muted">Sin proveedor habitual</span>}</td>
              </tr>))}
            </tbody></table></div>
          {canWrite && groups.size > 0 && (
            <div className="inv-actions">
              {[...groups.entries()].map(([sid, ls]) => (
                <button key={sid} className="btn" disabled={busy === sid} onClick={() => create(sid, ls)}><Plus size={16} />Crear borrador para {ls[0].supplierName} ({ls.length})</button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PoDialog({ id, items, onClose, onChanged, onEdit }: { id: string; items: InvItem[]; onClose: () => void; onChanged: () => void; onEdit: (po: any) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const po = useApi<any>(`/api/inventory/purchase-orders/${id}`);
  const [receiving, setReceiving] = useState(false);
  const d = po.data;
  const act = async (url: string, body: unknown, msg: string) => {
    try { await api.post(url, body); toast(msg); po.reload(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const close = async () => {
    const pending = d.lines.some((l: any) => l.qtyPending > 0);
    const note = await ask(pending
      ? { title: "Cerrar con lo recibido", message: "Quedan insumos pendientes que ya no se esperan.", inputLabel: "Motivo del cierre", confirmLabel: "Cerrar orden" }
      : { title: "Cerrar orden", message: "La orden quedará cerrada.", confirmLabel: "Cerrar orden" });
    if (note === null) return;
    await act(`/api/inventory/purchase-orders/${id}/close`, { note: pending ? note : null }, "Orden cerrada");
  };
  const cancel = async () => {
    const reason = await ask({ title: "Anular orden", inputLabel: "Motivo", confirmLabel: "Anular", danger: true });
    if (reason) await act(`/api/inventory/purchase-orders/${id}/cancel`, { reason }, "Orden anulada");
  };
  return (
    <Dialog wide title={d ? `Orden ${d.code} · ${d.supplierName}` : "Orden de compra"} onClose={onClose} footer={d && <>
      {d.status === "draft" && can("inventory.write") && <button className="btn" onClick={() => onEdit(d)}><Pencil size={15} />Editar</button>}
      {["draft", "sent"].includes(d.status) && can("inventory.manage") && <button className="btn btn-danger" onClick={cancel}>Anular</button>}
      {["partial", "received"].includes(d.status) && can("inventory.manage") && <button className="btn" onClick={close}>Cerrar orden</button>}
      {d.status === "draft" && can("inventory.manage") && <button className="btn btn-primary" onClick={() => act(`/api/inventory/purchase-orders/${id}/send`, {}, "Orden aprobada y marcada como enviada")}>Aprobar y marcar enviada</button>}
      {["sent", "partial"].includes(d.status) && can("inventory.write") && <button className="btn btn-primary" onClick={() => setReceiving(true)}><PackageCheck size={16} />Registrar lo que llegó</button>}
    </>}>
      {!d ? <Loading /> : (
        <div className="stack">
          <div className="row"><StatusBadge status={PO_TONE[d.status] ?? ""} label={d.statusLabel} /><span className="muted small">Llega a {d.branchName}{d.expectedOn ? ` · prevista ${fmtDate(d.expectedOn + "T12:00:00Z")}` : ""}</span></div>
          {d.status === "draft" && !can("inventory.manage") && <div className="alert info small">La administración debe aprobar la orden antes de enviarla al proveedor.</div>}
          <div className="small muted">Proveedor: {d.supplierName}{d.supplierContact ? ` · ${d.supplierContact}` : ""}{d.supplierPhone ? ` · ${d.supplierPhone}` : ""}{d.supplierEmail ? ` · ${d.supplierEmail}` : ""}</div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Insumo</th><th className="num">Pedido</th><th className="num">Recibido</th><th className="num">Rechazado</th><th className="num">Pendiente</th><th className="num hide-mobile">Precio</th><th className="num hide-mobile">Importe</th></tr></thead>
            <tbody>{d.lines.map((l: any) => (
              <tr key={l.id}>
                <td><b>{l.itemName}</b><span className="inv-sub">{l.purchaseUnit} = {qty(l.purchaseFactor)} {l.useUnit}</span></td>
                <td className="num">{qty(l.qtyOrdered)}</td><td className="num">{qty(l.qtyAccepted)}</td>
                <td className="num">{Number(l.qtyRejected) ? <span className="badge danger">{qty(l.qtyRejected)}</span> : "0"}</td>
                <td className="num">{l.qtyPending ? <b>{qty(l.qtyPending)}</b> : "0"}</td>
                <td className="num hide-mobile">{bs(l.unitPriceCents)}</td><td className="num hide-mobile">{bs(l.totalCents)}</td>
              </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={5}><b>Total</b></td><td className="num hide-mobile" /><td className="num"><b>{bs(d.totalCents)}</b></td></tr></tfoot>
          </table></div>
          {d.notes && <p className="small">Notas: {d.notes}</p>}
          {d.receipts.length > 0 && (
            <section className="stack-sm">
              <h3>Entregas</h3>
              {d.receipts.map((r: any) => (
                <div key={r.id} className="card card-pad small stack-sm">
                  <b>{fmtDateTime(r.receivedAt)} · {r.receivedByName}{r.documentRef ? ` · Doc. ${r.documentRef}` : ""}</b>
                  {r.lines.map((l: any, i: number) => (
                    <span key={i}>{l.itemName}: {qty(l.qtyAccepted)} aceptado{l.lotCode ? ` (lote ${l.lotCode}${l.expiresOn ? `, vence ${l.expiresOn.split("-").reverse().join("/")}` : ""})` : ""}{Number(l.qtyRejected) ? ` · ${qty(l.qtyRejected)} rechazado: ${l.rejectReason}` : ""}</span>
                  ))}
                </div>
              ))}
            </section>
          )}
          {d.closeNote && <p className="small muted">{d.status === "cancelled" ? "Motivo de anulación" : "Nota de cierre"}: {d.closeNote}</p>}
        </div>
      )}
      {receiving && d && <ReceivePoDialog po={d} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); po.reload(); onChanged(); }} />}
    </Dialog>
  );
}

function ReceivePoDialog({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const open = po.lines.filter((l: any) => l.qtyPending > 0);
  const [doc, setDoc] = useState("");
  const [vals, setVals] = useState<Record<string, { acc: string; rej: string; reason: string; lot: string; exp: string }>>(() =>
    Object.fromEntries(open.map((l: any) => [l.id, { acc: String(l.qtyPending).replace(".", ","), rej: "", reason: "", lot: "", exp: "" }])));
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const save = async () => {
    const errs: Record<string, string> = {};
    const lines = open.map((l: any, i: number) => {
      const v = vals[l.id]!;
      const acc = parseQty(v.acc) ?? 0, rej = parseQty(v.rej) ?? 0;
      const p = (k: string) => `lines.${i}.${k}`;
      if (Number.isNaN(acc) || acc < 0) errs[p("qtyAccepted")] = "Cantidad inválida";
      else if (acc > l.qtyPending) errs[p("qtyAccepted")] = `Máximo ${qty(l.qtyPending)}`;
      if (Number.isNaN(rej) || rej < 0) errs[p("qtyRejected")] = "Cantidad inválida";
      if (rej > 0 && v.reason.trim().length < 3) errs[p("rejectReason")] = "Indica el motivo del rechazo";
      if (acc > 0 && l.tracksLots) {
        if (!v.lot.trim()) errs[p("lotCode")] = "Indica el número de lote";
        if (!v.exp) errs[p("expiresOn")] = "Indica el vencimiento";
        else if (v.exp < localDate()) errs[p("expiresOn")] = "Ese lote ya está vencido: recházalo";
      }
      return { lineId: l.id, qtyAccepted: acc, qtyRejected: rej, rejectReason: v.reason || null, lotCode: l.tracksLots ? v.lot || null : null, expiresOn: l.tracksLots ? v.exp || null : null };
    });
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try {
      const r = await api.post(`/api/inventory/purchase-orders/${po.id}/receive`, { documentRef: doc || null, lines });
      toast(r.status === "received" ? "Mercadería recibida: la orden está completa" : "Entrega registrada: la orden quedó recibida en parte"); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={`Registrar lo que llegó · ${po.code}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Ingresar al stock"}</button></>}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <InvField label="Factura o nota de entrega del proveedor"><input className="input" value={doc} maxLength={60} onChange={(e) => setDoc(e.target.value)} /></InvField>
        {open.map((l: any, i: number) => {
          const v = vals[l.id]!;
          const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setVals({ ...vals, [l.id]: { ...v, [k]: e.target.value } });
          const p = (k: string) => E.field(`lines.${i}.${k}`);
          return (
            <section key={l.id} className="card card-pad stack-sm" aria-label={l.itemName}>
              <b>{l.itemName}</b>
              <span className="muted small">Pendiente: {qty(l.qtyPending)} {l.purchaseUnit} ({qty(l.qtyPending * l.purchaseFactor)} {l.useUnit})</span>
              <div className="form-grid">
                <InvField label={`Llegó bien (${l.purchaseUnit})`} error={p("qtyAccepted")}><input className="input" inputMode="decimal" value={v.acc} onChange={set("acc")} /></InvField>
                <InvField label="Rechazado" error={p("qtyRejected")}><input className="input" inputMode="decimal" value={v.rej} onChange={set("rej")} placeholder="0" /></InvField>
                {(parseQty(v.rej) ?? 0) > 0 && <InvField label="Motivo del rechazo" span2 error={p("rejectReason")}><input className="input" value={v.reason} maxLength={300} onChange={set("reason")} /></InvField>}
                {l.tracksLots && <>
                  <InvField label="Número de lote" error={p("lotCode")}><input className="input" value={v.lot} maxLength={60} onChange={set("lot")} /></InvField>
                  <InvField label="Vencimiento" error={p("expiresOn")}><input className="input" type="date" value={v.exp} onChange={set("exp")} /></InvField>
                </>}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}

function PoEditDialog({ po, items, onClose, onSaved }: { po: any; items: InvItem[]; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const suppliers = useApi<any[]>("/api/inventory/suppliers");
  const [supplierId, setSupplierId] = useState(po.supplierId ?? "");
  const [branchId, setBranchId] = useState(po.branchId ?? "");
  const [expectedOn, setExpectedOn] = useState(po.expectedOn ?? "");
  const [notes, setNotes] = useState(po.notes ?? "");
  const [lines, setLines] = useState<{ itemId: string; q: string; price: string }[]>(
    po.lines?.length ? po.lines.map((l: any) => ({ itemId: l.itemId, q: String(Number(l.qtyOrdered)), price: toBsInput(Number(l.unitPriceCents)) })) : [{ itemId: "", q: "", price: "" }]);
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const total = lines.reduce((s, l) => s + (parseQty(l.q) || 0) * (parseBs(l.price || "0") || 0), 0);
  const save = async () => {
    const errs: Record<string, string> = {};
    if (!supplierId) errs.supplierId = "Elige el proveedor";
    if (!branchId) errs.branchId = "Elige la sucursal de llegada";
    const body = lines.map((l, i) => {
      const n = parseQty(l.q), cents = parseBs(l.price || "0");
      if (!l.itemId) errs[`lines.${i}.itemId`] = "Elige el insumo";
      if (n == null || Number.isNaN(n) || n <= 0) errs[`lines.${i}.qty`] = "Cantidad inválida";
      if (!Number.isFinite(cents) || cents < 0) errs[`lines.${i}.unitPriceCents`] = "Precio inválido";
      return { itemId: l.itemId, qty: n, unitPriceCents: cents };
    });
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    const payload = { supplierId, branchId, expectedOn: expectedOn || null, notes: notes || null, lines: body };
    try {
      if (po.id) { await api.put(`/api/inventory/purchase-orders/${po.id}`, payload); toast("Borrador actualizado"); onSaved(po.id); }
      else { const r = await api.post("/api/inventory/purchase-orders", payload); toast("Orden en borrador creada"); onSaved(r.id); }
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={po.id ? `Editar ${po.code}` : "Nueva orden de compra"} onClose={onClose}
      footer={<><span className="muted" style={{ marginRight: "auto" }}>Total: <b>{bs(Math.round(total))}</b></span><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar borrador"}</button></>}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <div className="form-grid">
          <InvField label="Proveedor" error={E.field("supplierId")}>
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-invalid={!!E.field("supplierId")}>
              <option value="">Elige el proveedor</option>
              {(suppliers.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </InvField>
          <BranchSelect label="Sucursal de llegada" value={branchId} onChange={setBranchId} error={E.field("branchId")} />
          <InvField label="Entrega prevista (opcional)"><input className="input" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></InvField>
          <InvField label="Notas para el proveedor (opcional)"><input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></InvField>
        </div>
        {lines.map((l, i) => {
          const it = items.find((x) => x.id === l.itemId);
          const upd = (p: Partial<typeof l>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={i} className="inv-line" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto" }}>
              <InvField label="Insumo" error={E.field(`lines.${i}.itemId`)}>
                <select className="input" value={l.itemId} onChange={(e) => upd({ itemId: e.target.value })}>
                  <option value="">Elige un insumo</option>
                  {items.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.sku}</option>)}
                </select>
              </InvField>
              <InvField label={`Cantidad${it ? ` (${it.purchaseUnit})` : ""}`} error={E.field(`lines.${i}.qty`)}><input className="input" inputMode="decimal" value={l.q} onChange={(e) => upd({ q: e.target.value })} /></InvField>
              <InvField label="Precio unitario (Bs)" error={E.field(`lines.${i}.unitPriceCents`)}><input className="input" inputMode="decimal" value={l.price} placeholder="0,00" onChange={(e) => upd({ price: e.target.value })} /></InvField>
              {lines.length > 1 ? <button type="button" className="btn btn-ghost btn-icon" aria-label="Quitar línea" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button> : <span />}
            </div>
          );
        })}
        <div><button type="button" className="btn" onClick={() => setLines([...lines, { itemId: "", q: "", price: "" }])}><Plus size={16} />Agregar insumo</button></div>
      </div>
    </Dialog>
  );
}

// ---------------- Proveedores ----------------
export function SuppliersTab() {
  const { can } = useAuth();
  const list = useApi<any[]>("/api/inventory/suppliers");
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <section className="card">
      <div className="card-head row-between">
        <h2>Proveedores</h2>
        {can("inventory.manage") && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />Nuevo proveedor</button>}
      </div>
      {!list.data ? <Loading /> : !list.data.length ? <Empty>Aún no hay proveedores.</Empty> : (
        <div className="table-wrap"><table className="table cards-sm">
          <thead><tr><th>Proveedor</th><th className="hide-mobile">Contacto</th><th className="num hide-mobile">Órdenes</th><th className="num">A tiempo</th><th className="num">Rechazado</th><th /></tr></thead>
          <tbody>{list.data.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b>{!s.active && <span className="badge" style={{ marginLeft: 6 }}>Inactivo</span>}<span className="inv-sub">{[s.phone, s.email].filter(Boolean).join(" · ")}</span></td>
              <td className="hide-mobile">{s.contactName ?? "—"}{s.paymentTerms && <span className="inv-sub">{s.paymentTerms}</span>}</td>
              <td className="num hide-mobile">{s.orders}</td>
              <td className="num">{s.onTimePct == null ? "—" : `${s.onTimePct} %`}</td>
              <td className="num">{s.rejectedPct == null ? "—" : `${s.rejectedPct} %`}</td>
              <td className="num">{can("inventory.manage") && <button className="btn btn-sm" onClick={() => setEdit(s)}><Pencil size={14} />Editar</button>}</td>
            </tr>))}
          </tbody></table></div>
      )}
      {edit && <SupplierDialog supplier={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </section>
  );
}

function SupplierDialog({ supplier, onClose, onSaved }: { supplier: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: supplier.name ?? "", taxId: supplier.taxId ?? "", contactName: supplier.contactName ?? "", phone: supplier.phone ?? "", email: supplier.email ?? "",
    address: supplier.address ?? "", paymentTerms: supplier.paymentTerms ?? "", notes: supplier.notes ?? "", active: supplier.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.name.trim().length < 2) return E.set({ name: "Escribe el nombre del proveedor" });
    setBusy(true); E.clear();
    try {
      if (supplier.id) await api.put(`/api/inventory/suppliers/${supplier.id}`, f); else await api.post("/api/inventory/suppliers", f);
      toast("Proveedor guardado"); onSaved();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title={supplier.id ? `Editar ${supplier.name}` : "Nuevo proveedor"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <div className="form-grid">
          <InvField label="Nombre" span2 error={E.field("name")}><input className="input" value={f.name} maxLength={120} onChange={set("name")} aria-invalid={!!E.field("name")} /></InvField>
          <InvField label="NIT" error={E.field("taxId")}><input className="input" value={f.taxId} maxLength={30} onChange={set("taxId")} /></InvField>
          <InvField label="Persona de contacto" error={E.field("contactName")}><input className="input" value={f.contactName} maxLength={120} onChange={set("contactName")} /></InvField>
          <InvField label="Teléfono" error={E.field("phone")}><input className="input" inputMode="tel" value={f.phone} maxLength={40} onChange={set("phone")} /></InvField>
          <InvField label="Correo" error={E.field("email")}><input className="input" type="email" value={f.email} maxLength={160} onChange={set("email")} /></InvField>
          <InvField label="Dirección" span2 error={E.field("address")}><input className="input" value={f.address} maxLength={300} onChange={set("address")} /></InvField>
          <InvField label="Condiciones de pago" span2 error={E.field("paymentTerms")}><input className="input" value={f.paymentTerms} maxLength={200} onChange={set("paymentTerms")} placeholder="Ej.: crédito 30 días" /></InvField>
          <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo</label>
        </div>
      </div>
    </Dialog>
  );
}
