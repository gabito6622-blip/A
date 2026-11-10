// Inventario por sucursal: stock con alertas, lotes, movimientos, transferencias, conteo, compras y proveedores.
// Pensado para la asistente que repone el sillón (tablet), la gerencia que pide insumos y el dueño
// que quiere ver costos y pérdidas por vencimiento.
import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, Minus, PackagePlus, Pencil, Plus, SlidersHorizontal, Truck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDateTime } from "../lib/format";
import { Empty, Loading, Tabs, useAsk, useToast } from "../components/ui";
import { AdjustDialog, ConsumeDialog, ItemDialog, ReceiptDialog, ReceiveTransferDialog, TransferDialog, type InvItem } from "../components/inventory/Dialogs";
import { PurchasingTab, SuppliersTab } from "../components/inventory/Purchasing";
import { CountsTab } from "../components/inventory/Counts";
import { AlertBadges, ExpiryBadge, KIND_LABELS, qty, useInvBranch } from "../components/inventory/shared";

type Tab = "stock" | "alerts" | "lots" | "movements" | "transfers" | "count" | "purchases" | "suppliers";
type DialogState =
  | { kind: "consume"; itemId?: string }
  | { kind: "adjust"; itemId?: string; lotId?: string; direction?: "in" | "out"; reason?: string; branchId?: string }
  | { kind: "receipt"; itemId?: string }
  | { kind: "item"; item: Partial<InvItem> }
  | { kind: "transfer" }
  | { kind: "receiveTransfer"; transfer: any }
  | null;

export function InventoryPage() {
  const { can } = useAuth();
  const { current, defaultBranch, branchName } = useInvBranch();
  const [tab, setTab] = useState<Tab>("stock");
  const [dlg, setDlg] = useState<DialogState>(null);
  const [rev, setRev] = useState(0);
  const scope = current ? `?branchId=${current}` : "";
  const stock = useApi<any>(`/api/inventory/stock${scope}`, [rev]);
  const alerts = useApi<any>(`/api/inventory/alerts${scope}`, [rev]);
  const catalog = useApi<InvItem[]>("/api/inventory/items", [rev]);
  const inbox = useApi<any[]>(`/api/inventory/transfers?status=in_transit${current ? `&branchId=${current}` : ""}`, [rev]);
  const refresh = () => setRev((x) => x + 1);
  const done = () => { setDlg(null); refresh(); };
  const items = (catalog.data ?? []) as InvItem[];
  const s = alerts.data?.summary;
  const toReceive = (inbox.data ?? []).filter((t) => !current || t.toBranchId === current).length;
  const canWrite = can("inventory.write");
  const writeBranch = current ?? defaultBranch;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="sub">{current ? branchName(current) : "Todas las sucursales (consolidado)"}{stock.data ? ` · ${stock.data.items.length} insumos` : ""}</p>
        </div>
        <div className="inv-actions">
          {canWrite && <button className="btn btn-primary" onClick={() => setDlg({ kind: "consume" })}><Minus size={16} />Consumir</button>}
          {canWrite && <button className="btn" onClick={() => setDlg({ kind: "adjust" })}><SlidersHorizontal size={16} />Ajustar</button>}
          {canWrite && <button className="btn" onClick={() => setDlg({ kind: "receipt" })}><PackagePlus size={16} />Ingresar compra</button>}
          {can("inventory.manage") && <button className="btn" onClick={() => setDlg({ kind: "item", item: {} })}><Plus size={16} />Nuevo insumo</button>}
        </div>
      </div>

      {s && (
        <div className="inv-kpis">
          <button className="card kpi" onClick={() => setTab("alerts")}><div className="label">Bajo el mínimo</div><div className="value">{s.belowMin}</div><div className="foot">insumos por reponer</div></button>
          <button className="card kpi" onClick={() => setTab("alerts")}><div className="label">Vencen en 30 días</div><div className="value">{s.expiring30}</div><div className="foot">{s.expiring60} en 60 · {s.expiring90} en 90 días</div></button>
          <button className="card kpi" onClick={() => setTab("alerts")}><div className="label">Vencidos</div><div className="value">{s.expired}</div><div className="foot">lotes que hay que dar de baja</div></button>
          <button className="card kpi" onClick={() => setTab("alerts")}><div className="label">Consumos pendientes</div><div className="value">{s.pending}</div><div className="foot">tratamientos sin stock al realizarse</div></button>
        </div>
      )}

      <Tabs value={tab} onChange={setTab} items={[
        { id: "stock", label: "Stock" },
        { id: "alerts", label: `Alertas${alerts.data ? ` (${alerts.data.alerts.length})` : ""}` },
        { id: "lots", label: "Lotes" },
        { id: "movements", label: "Movimientos" },
        { id: "transfers", label: `Transferencias${toReceive ? ` (${toReceive} por recibir)` : ""}` },
        { id: "count", label: "Conteo físico" },
        { id: "purchases", label: "Compras" },
        { id: "suppliers", label: "Proveedores" },
      ]} />

      {tab === "stock" && <StockTab data={stock.data} consolidated={!current} canWrite={canWrite} canManage={can("inventory.manage")} catalog={items}
        onConsume={(itemId) => setDlg({ kind: "consume", itemId })} onAdjust={(itemId) => setDlg({ kind: "adjust", itemId })} onEdit={(item) => setDlg({ kind: "item", item })} />}
      {tab === "alerts" && <AlertsTab data={alerts.data} consolidated={!current} onChanged={refresh}
        onWriteOff={(a) => setDlg({ kind: "adjust", itemId: a.itemId, lotId: a.lotId, direction: "out", reason: "expiry", branchId: a.branchId })} onReorder={() => setTab("purchases")} />}
      {tab === "lots" && <LotsTab branchId={current} rev={rev} />}
      {tab === "movements" && <MovementsTab branchId={current} items={items} rev={rev} />}
      {tab === "transfers" && <TransfersTab branchId={current} rev={rev} canWrite={canWrite} onNew={() => setDlg({ kind: "transfer" })} onReceive={(t) => setDlg({ kind: "receiveTransfer", transfer: t })} />}
      {tab === "count" && <CountsTab branchId={current} onStockChanged={refresh} />}
      {tab === "purchases" && <PurchasingTab items={items} onStockChanged={refresh} />}
      {tab === "suppliers" && <SuppliersTab />}

      {dlg?.kind === "consume" && <ConsumeDialog items={items} branchId={writeBranch} itemId={dlg.itemId} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === "adjust" && <AdjustDialog items={items} branchId={dlg.branchId ?? writeBranch} itemId={dlg.itemId} lotId={dlg.lotId} direction={dlg.direction} reason={dlg.reason} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === "receipt" && <ReceiptDialog items={items} branchId={writeBranch} itemId={dlg.itemId} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === "item" && <ItemDialog item={dlg.item} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === "transfer" && <TransferDialog items={items} branchId={writeBranch} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === "receiveTransfer" && <ReceiveTransferDialog transfer={dlg.transfer} onClose={() => setDlg(null)} onDone={done} />}
    </div>
  );
}

function StockTab({ data, consolidated, canWrite, canManage, catalog, onConsume, onAdjust, onEdit }: {
  data: any; consolidated: boolean; canWrite: boolean; canManage: boolean; catalog: InvItem[];
  onConsume: (id: string) => void; onAdjust: (id: string) => void; onEdit: (item: Partial<InvItem>) => void;
}) {
  const [filter, setFilter] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  if (!data) return <Loading />;
  const rows = data.items.filter((x: any) => (!filter || `${x.name} ${x.sku} ${x.category}`.toLowerCase().includes(filter.toLowerCase())) && (!onlyAlerts || x.alerts.length));
  return (
    <section className="card">
      <div className="card-head row-between">
        <input className="input" style={{ maxWidth: 300 }} placeholder="Buscar por nombre, SKU o categoría" aria-label="Buscar insumo" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />Solo con alertas</label>
      </div>
      {!rows.length ? <Empty>{data.items.length ? "Ningún insumo coincide con la búsqueda." : "Aún no hay insumos en el catálogo."}</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Insumo</th><th className="num">Stock</th><th className="hide-mobile">Próx. vencimiento</th><th className="num hide-mobile">Valor</th><th className="hide-mobile">Alertas</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{rows.map((x: any) => (
            <tr key={x.id}>
              <td>
                <b>{x.name}</b><span className="inv-sub">{x.sku} · {x.category}{x.tracksLots ? ` · ${x.lots} lote(s)` : ""}</span>
                <span className="inv-mobile-only"><AlertBadges alerts={x.alerts} showBranch={consolidated} /></span>
              </td>
              <td className="num nowrap">
                <b>{qty(x.qty)}</b> <span className="muted small">{x.useUnit}</span>
                {Number(x.minQty) > 0 && <span className="inv-sub">mín. {qty(x.minQty)}</span>}
                {Number(x.inTransit) > 0 && <span className="inv-sub">+{qty(x.inTransit)} en tránsito</span>}
              </td>
              <td className="hide-mobile">{x.nextExpiry ? <ExpiryBadge expiresOn={x.nextExpiry} daysLeft={Math.round((+new Date(x.nextExpiry + "T12:00:00Z") - +new Date(data.today + "T12:00:00Z")) / 86400000)} /> : <span className="muted">—</span>}</td>
              <td className="num hide-mobile">{bs(Number(x.valueCents))}</td>
              <td className="hide-mobile"><AlertBadges alerts={x.alerts} showBranch={consolidated} /></td>
              <td>
                <div className="inv-row-actions">
                  {canWrite && <button className="btn btn-sm" onClick={() => onConsume(x.id)} aria-label={`Consumir ${x.name}`}><Minus size={14} /><span className="hide-mobile">Consumir</span></button>}
                  {canWrite && <button className="btn btn-sm" onClick={() => onAdjust(x.id)} aria-label={`Ajustar ${x.name}`}><SlidersHorizontal size={14} /><span className="hide-mobile">Ajustar</span></button>}
                  {canManage && <button className="btn btn-sm btn-ghost" onClick={() => onEdit(catalog.find((c) => c.id === x.id) ?? x)} aria-label={`Editar ${x.name}`}><Pencil size={14} /></button>}
                </div>
              </td>
            </tr>))}
          </tbody></table></div>
      )}
    </section>
  );
}

function AlertsTab({ data, consolidated, onChanged, onWriteOff, onReorder }: { data: any; consolidated: boolean; onChanged: () => void; onWriteOff: (a: any) => void; onReorder: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  if (!data) return <Loading />;
  const resolve = async (a: any, action: "consume" | "dismiss") => {
    let note: string | null = null;
    if (action === "dismiss") { note = await ask({ title: "Descartar consumo pendiente", message: `${a.itemName}: ${qty(a.qtyMissing)} ${a.unit} no se descontarán.`, inputLabel: "Motivo", confirmLabel: "Descartar", danger: true }); if (!note) return; }
    try { await api.post(`/api/inventory/pending/${a.pendingId}/resolve`, { action, note }); toast(action === "consume" ? "Consumo regularizado" : "Consumo pendiente descartado"); onChanged(); }
    catch (e: any) { toast(e.message, true); }
  };
  const groups: [string, string, any[]][] = [
    ["pending_consumption", "Consumos pendientes", data.alerts.filter((a: any) => a.type === "pending_consumption")],
    ["expired", "Lotes vencidos", data.alerts.filter((a: any) => a.type === "expired")],
    ["below_min", "Bajo el mínimo", data.alerts.filter((a: any) => a.type === "below_min")],
    ["expiring", "Por vencer (90 días)", data.alerts.filter((a: any) => a.type === "expiring")],
  ];
  if (!data.alerts.length) return <Empty>Sin alertas: el stock está sobre el mínimo y no hay lotes por vencer.</Empty>;
  return (
    <div className="stack">
      {groups.filter(([, , l]) => l.length).map(([type, title, list]) => (
        <section key={type} className="card">
          <div className="card-head row-between"><h2 className="row"><AlertTriangle size={18} />{title} ({list.length})</h2>
            {type === "below_min" && <button className="btn btn-sm" onClick={onReorder}>Ver sugerencia de compra</button>}</div>
          <div className="table-wrap"><table className="table"><tbody>
            {list.map((a: any, i: number) => (
              <tr key={i}>
                <td><b>{a.itemName}</b><span className="inv-sub">{a.sku}{consolidated ? ` · ${a.branchName}` : ""}{a.lotCode ? ` · lote ${a.lotCode}` : ""}</span></td>
                <td className="num nowrap">
                  {type === "below_min" && <>{qty(a.qty)} / mín. {qty(a.minQty)} {a.unit}</>}
                  {(type === "expired" || type === "expiring") && <>{qty(a.qty)} {a.unit} · <ExpiryBadge expiresOn={a.expiresOn} daysLeft={a.daysLeft} /></>}
                  {type === "pending_consumption" && <>Faltaron {qty(a.qtyMissing)} {a.unit}<span className="inv-sub">{fmtDateTime(a.createdAt)}</span></>}
                </td>
                <td>
                  <div className="inv-row-actions">
                    {type === "pending_consumption" && can("inventory.write") && <button className="btn btn-sm" onClick={() => resolve(a, "consume")}>Descontar ahora</button>}
                    {type === "pending_consumption" && can("inventory.manage") && <button className="btn btn-sm btn-ghost" onClick={() => resolve(a, "dismiss")}>Descartar</button>}
                    {type === "expired" && can("inventory.write") && <button className="btn btn-sm" onClick={() => onWriteOff(a)}>Dar de baja</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      ))}
    </div>
  );
}

function LotsTab({ branchId, rev }: { branchId: string | null; rev: number }) {
  const [withEmpty, setWithEmpty] = useState(false);
  const lots = useApi<any[]>(`/api/inventory/lots${qs({ branchId, withEmpty: withEmpty ? "1" : null })}`, [rev]);
  return (
    <section className="card">
      <div className="card-head row-between"><h2>Lotes</h2><label className="check"><input type="checkbox" checked={withEmpty} onChange={(e) => setWithEmpty(e.target.checked)} />Mostrar lotes agotados</label></div>
      {!lots.data ? <Loading /> : !lots.data.length ? <Empty>No hay lotes con saldo.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Insumo</th><th>Lote</th>{!branchId && <th className="hide-mobile">Sucursal</th>}<th className="num">Saldo</th><th>Vence</th><th className="num hide-mobile">Costo unit.</th><th className="num hide-mobile">Valor</th><th className="hide-mobile">Proveedor</th></tr></thead>
          <tbody>{lots.data.map((l) => (
            <tr key={l.id}>
              <td><b>{l.itemName}</b><span className="inv-sub">{l.sku}</span></td>
              <td>{l.lotCode ?? <span className="muted">Sin lote</span>}</td>
              {!branchId && <td className="hide-mobile">{l.branchName}</td>}
              <td className="num nowrap">{qty(l.qty)} <span className="muted small">{l.useUnit}</span></td>
              <td><ExpiryBadge expiresOn={l.expiresOn} daysLeft={l.daysLeft} /></td>
              <td className="num hide-mobile">{bs(Number(l.unitCost))}</td>
              <td className="num hide-mobile">{bs(Number(l.valueCents))}</td>
              <td className="hide-mobile">{l.supplierName ?? "—"}</td>
            </tr>))}
          </tbody></table></div>
      )}
    </section>
  );
}

function MovementsTab({ branchId, items, rev }: { branchId: string | null; items: InvItem[]; rev: number }) {
  const [f, setF] = useState({ itemId: "", kind: "", from: "", to: "" });
  const mv = useApi<any[]>(`/api/inventory/movements${qs({ branchId, itemId: f.itemId, kind: f.kind, from: f.from, to: f.to })}`, [rev]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card">
      <div className="card-pad inv-filters" role="group" aria-label="Filtros de movimientos">
        <div className="field"><label style={{ display: "contents" }}><span className="label">Insumo</span>
          <select className="input" value={f.itemId} onChange={set("itemId")}><option value="">Todos</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label></div>
        <div className="field"><label style={{ display: "contents" }}><span className="label">Tipo</span>
          <select className="input" value={f.kind} onChange={set("kind")}><option value="">Todos</option>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
        <div className="field"><label style={{ display: "contents" }}><span className="label">Desde</span><input className="input" type="date" value={f.from} onChange={set("from")} /></label></div>
        <div className="field"><label style={{ display: "contents" }}><span className="label">Hasta</span><input className="input" type="date" value={f.to} onChange={set("to")} /></label></div>
      </div>
      {!mv.data ? <Loading /> : !mv.data.length ? <Empty>No hay movimientos con esos filtros.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Movimiento</th><th className="num">Cantidad</th><th className="hide-mobile">Lote</th>{!branchId && <th className="hide-mobile">Sucursal</th>}<th className="hide-mobile">Quién</th><th className="hide-mobile">Detalle</th></tr></thead>
          <tbody>{mv.data.map((m) => (
            <tr key={m.id}>
              <td className="nowrap">{fmtDateTime(m.createdAt)}</td>
              <td><b>{m.itemName}</b><span className="inv-sub">{m.kindLabel}{m.reasonLabel ? ` · ${m.reasonLabel}` : ""}</span></td>
              <td className="num nowrap"><span className={`badge ${m.qty < 0 ? "danger" : "ok"}`}>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</span> <span className="muted small">{m.useUnit}</span></td>
              <td className="hide-mobile">{m.lotCode ?? "—"}</td>
              {!branchId && <td className="hide-mobile">{m.branchName}</td>}
              <td className="hide-mobile">{m.userName ?? "—"}</td>
              <td className="hide-mobile small">
                {m.poNumber && `OC-${String(m.poNumber).padStart(4, "0")} `}{m.transferNumber && `Transferencia N° ${m.transferNumber} `}{m.countNumber && `Conteo N° ${m.countNumber} `}
                {m.budgetItemId && "Tratamiento realizado "}{m.note}
              </td>
            </tr>))}
          </tbody></table></div>
      )}
    </section>
  );
}

function TransfersTab({ branchId, rev, canWrite, onNew, onReceive }: { branchId: string | null; rev: number; canWrite: boolean; onNew: () => void; onReceive: (t: any) => void }) {
  const { me } = useAuth();
  const list = useApi<any[]>(`/api/inventory/transfers${qs({ branchId })}`, [rev]);
  const mine = (id: string) => (branchId ? id === branchId : !!me?.branches.some((b) => b.id === id));
  const data = list.data ?? [];
  const incoming = data.filter((t) => t.status === "in_transit" && mine(t.toBranchId));
  const outgoing = data.filter((t) => t.status === "in_transit" && !mine(t.toBranchId));
  const history = data.filter((t) => t.status === "received");
  const lineSummary = (t: any) => t.lines.map((l: any) => `${l.itemName} ${qty(l.qtySent)}${l.qtyReceived != null && Number(l.qtyReceived) !== Number(l.qtySent) ? ` (llegó ${qty(l.qtyReceived)})` : ""}`).join(" · ");
  return (
    <div className="stack">
      {canWrite && <div><button className="btn btn-primary" onClick={onNew}><ArrowLeftRight size={16} />Enviar a otra sucursal</button></div>}
      {!list.data ? <Loading /> : <>
        <section className="card">
          <div className="card-head"><h2 className="row"><Truck size={18} />Por recibir ({incoming.length})</h2></div>
          {!incoming.length ? <Empty>No hay envíos en camino a esta sucursal.</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>
              {incoming.map((t) => (
                <tr key={t.id}>
                  <td><b>N° {t.number} · desde {t.fromBranchName}</b><span className="inv-sub">{lineSummary(t)}</span><span className="inv-sub">Enviado {fmtDateTime(t.sentAt)} por {t.sentByName}{t.note ? ` · ${t.note}` : ""}</span></td>
                  <td className="num">{canWrite && <button className="btn btn-primary" onClick={() => onReceive(t)}>Recibir</button>}</td>
                </tr>))}
            </tbody></table></div>
          )}
        </section>
        {outgoing.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Enviadas, en tránsito ({outgoing.length})</h2></div>
            <div className="table-wrap"><table className="table"><tbody>
              {outgoing.map((t) => <tr key={t.id}><td><b>N° {t.number} → {t.toBranchName}</b><span className="inv-sub">{lineSummary(t)}</span></td><td className="nowrap muted small">{fmtDateTime(t.sentAt)}</td></tr>)}
            </tbody></table></div>
          </section>
        )}
        <section className="card">
          <div className="card-head"><h2>Recibidas</h2></div>
          {!history.length ? <Empty>Aún no hay transferencias recibidas.</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>
              {history.map((t) => (
                <tr key={t.id}>
                  <td><b>N° {t.number} · {t.fromBranchName} → {t.toBranchName}</b><span className="inv-sub">{lineSummary(t)}</span>
                    {t.lines.some((l: any) => l.differenceReason) && <span className="inv-sub">Diferencias: {t.lines.filter((l: any) => l.differenceReason).map((l: any) => `${l.itemName}: ${l.differenceReason}`).join(" · ")}</span>}</td>
                  <td className="nowrap muted small">{fmtDateTime(t.receivedAt)}<span className="inv-sub">{t.receivedByName}</span></td>
                </tr>))}
            </tbody></table></div>
          )}
        </section>
      </>}
    </div>
  );
}
