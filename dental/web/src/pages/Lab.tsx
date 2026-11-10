// Página "Laboratorio": órdenes (con filtros y alertas), por pagar al laboratorio y catálogo de
// laboratorios; además, la orden imprimible para el laboratorio (/laboratorio/orden/:id).
import { useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarX2, Download, FileSpreadsheet, Plus, Printer, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDateTime, localDate, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, Tabs, useToast } from "../components/ui";
import { LAB_STATUS, LabStatusBadge, OrderDetailDialog, OrderDialog, TAP, WORK_TYPES, fmtDay } from "../components/lab/LabShared";

export function LabPage() {
  return (
    <Routes>
      <Route path="orden/:id" element={<OrderSlipPage />} />
      <Route path="*" element={<LabHome />} />
    </Routes>
  );
}

type Tab = "ordenes" | "por-pagar" | "laboratorios";

function LabHome() {
  const { can, me } = useAuth();
  const read = can("clinical.read") || can("budgets.read");
  const pay = (can("payments.verify") || can("clinic.manage")) && !!me?.membership?.allBranches;
  const [tab, setTab] = useState<Tab>(read ? "ordenes" : "por-pagar");
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Laboratorio</h1><div className="sub muted">Trabajos protésicos enviados a laboratorios externos, su llegada y su pago.</div></div></div>
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: "ordenes", label: "Órdenes", hidden: !read },
        { id: "por-pagar", label: "Por pagar", hidden: !pay },
        { id: "laboratorios", label: "Laboratorios" },
      ]} />
      {tab === "ordenes" && read && <OrdersTab />}
      {tab === "por-pagar" && pay && <PayablesTab />}
      {tab === "laboratorios" && <LabsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- Órdenes
function OrdersTab() {
  const { can, me, branchId: topBranch } = useAuth();
  const [flt, setFlt] = useState({ status: "open", labId: "", branchId: topBranch ?? "", overdue: false, readyNoAppointment: false });
  const labs = useApi<any[]>("/api/lab/labs?all=1");
  const alerts = useApi<any>(`/api/lab/alerts${qs({ branchId: flt.branchId || undefined })}`);
  const list = useApi<any[]>(`/api/lab/orders${qs({
    status: flt.overdue || flt.readyNoAppointment ? undefined : flt.status === "all" ? undefined : flt.status, labId: flt.labId || undefined, branchId: flt.branchId || undefined,
    overdue: flt.overdue ? "1" : undefined, readyNoAppointment: flt.readyNoAppointment ? "1" : undefined,
  })}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const reload = () => { list.reload(); alerts.reload(); };
  const write = can("clinical.write") || can("budgets.write");
  const a = alerts.data;
  return (
    <div className="stack">
      {a && (a.overdue.length > 0 || a.readyNoAppointment.length > 0) && (
        <div className="lab-chips" role="group" aria-label="Alertas de laboratorio">
          {a.overdue.length > 0 && (
            <button className={`btn ${flt.overdue ? "btn-primary" : ""}`} aria-pressed={flt.overdue} onClick={() => setFlt({ ...flt, overdue: !flt.overdue, readyNoAppointment: false })}>
              <AlertTriangle size={16} />{a.overdue.length} atrasada{a.overdue.length === 1 ? "" : "s"} según la fecha prometida
            </button>
          )}
          {a.readyNoAppointment.length > 0 && (
            <button className={`btn ${flt.readyNoAppointment ? "btn-primary" : ""}`} aria-pressed={flt.readyNoAppointment} onClick={() => setFlt({ ...flt, readyNoAppointment: !flt.readyNoAppointment, overdue: false })}>
              <CalendarX2 size={16} />{a.readyNoAppointment.length} recibida{a.readyNoAppointment.length === 1 ? "" : "s"} sin cita de colocación
            </button>
          )}
        </div>
      )}
      <div className="card card-pad stack">
        <div className="lab-filters">
          <Field label="Estado">
            <select className="input" value={flt.status} disabled={flt.overdue || flt.readyNoAppointment} onChange={(e) => setFlt({ ...flt, status: e.target.value })}>
              <option value="open">Abiertas</option><option value="all">Todas</option>
              {Object.entries(LAB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Laboratorio">
            <select className="input" value={flt.labId} onChange={(e) => setFlt({ ...flt, labId: e.target.value })}>
              <option value="">Todos</option>{labs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Sucursal">
            <select className="input" value={flt.branchId} onChange={(e) => setFlt({ ...flt, branchId: e.target.value })}>
              {(me?.membership?.allBranches || (me?.branches.length ?? 0) > 1) && <option value="">Todas</option>}
              {me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={flt.overdue} onChange={(e) => setFlt({ ...flt, overdue: e.target.checked, readyNoAppointment: false })} />Solo atrasadas</label>
          {write && <button className="btn btn-primary" style={TAP} onClick={() => setCreating(true)}><Plus size={16} />Nueva orden</button>}
        </div>
      </div>
      <div className="card">
        {!list.data ? <Loading /> : list.data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Paciente</th><th>Trabajo</th><th className="hide-mobile">Laboratorio</th><th>Fechas</th><th>Estado</th><th className="num hide-mobile">Costo</th></tr></thead>
            <tbody>{list.data.map((o) => (
              <tr key={o.id} className="clickable" tabIndex={0} onClick={() => setOpen(o.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(o.id)}>
                <td>{o.number}</td>
                <td>{o.patientName}<div className="muted small">Ficha {o.recordNumber}</div></td>
                <td><b>{o.label}</b><div className="muted small hide-mobile">{o.dentistName} · {o.branchName}</div></td>
                <td className="hide-mobile">{o.labName}</td>
                <td className="small">
                  {o.receivedOn ? <>Llegó {fmtDay(o.receivedOn)}</> : o.promisedOn ? <span style={o.overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>Prometido {fmtDay(o.promisedOn)}</span> : o.sentOn ? <>Enviado {fmtDay(o.sentOn)}</> : "—"}
                </td>
                <td><LabStatusBadge status={o.status} overdue={o.overdue} />{o.readyNoAppointment && <div className="small" style={{ color: "var(--warn)" }}>Sin cita de colocación</div>}</td>
                <td className="num hide-mobile">{bs(o.costCents)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{flt.overdue ? "No hay órdenes atrasadas." : flt.readyNoAppointment ? "Todos los trabajos recibidos tienen cita de colocación." : "No hay órdenes con estos filtros."}</Empty>}
      </div>
      {creating && <OrderDialog onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); reload(); setOpen(id); }} />}
      {open && <OrderDetailDialog id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- Por pagar
const METHODS = [["transfer", "Transferencia"], ["cash", "Efectivo"], ["qr", "QR"], ["check", "Cheque"], ["card", "Tarjeta"], ["other", "Otro"]] as const;
const firstOfMonth = () => `${localDate().slice(0, 8)}01`;

function PayablesTab() {
  const p = useApi<any>("/api/lab/payables");
  const labs = useApi<any[]>("/api/lab/labs?all=1");
  const payments = useApi<any[]>("/api/lab/payments");
  const [sel, setSel] = useState<Record<string, string>>({}); // orderId → monto (Bs)
  const [paying, setPaying] = useState<null | { labId: string; allocations: any[] }>(null);
  const [st, setSt] = useState({ labId: "", from: firstOfMonth(), to: localDate() });
  const [stQ, setStQ] = useState<typeof st | null>(null);
  const statement = useApi<any>(stQ?.labId ? `/api/lab/statement${qs(stQ)}` : null);
  const selected = (p.data?.orders ?? []).filter((o: any) => sel[o.id] !== undefined);
  const selLab = selected[0]?.labId as string | undefined;
  const toggle = (o: any) => {
    const n = { ...sel };
    if (n[o.id] !== undefined) delete n[o.id];
    else {
      if (selLab && selLab !== o.labId) return; // un pago es a un solo laboratorio
      n[o.id] = toBsInput(o.outstandingCents);
    }
    setSel(n);
  };
  const reload = () => { p.reload(); payments.reload(); statement.reload(); setSel({}); };
  return (
    <div className="stack">
      {!p.data ? <Loading /> : (
        <>
          <div className="grid grid-4">
            <div className="card kpi"><div className="label">Total por pagar</div><div className="value">{bs(p.data.totalCents)}</div><div className="foot">{p.data.orders.length} trabajo(s) recibidos</div></div>
            {p.data.labs.map((l: any) => (
              <div key={l.labId} className="card kpi"><div className="label">{l.labName}</div><div className="value">{bs(l.outstandingCents)}</div><div className="foot">{l.orders} trabajo(s)</div></div>
            ))}
          </div>
          <section className="card" aria-label="Por pagar al laboratorio">
            <div className="card-head">
              <h2>Por pagar al laboratorio</h2>
              <div className="row">
                <a className="btn btn-sm" style={TAP} href="/api/lab/payables.xlsx"><Download size={15} />Excel</a>
                <button className="btn btn-primary btn-sm" style={TAP} disabled={!labs.data?.length}
                  onClick={() => setPaying(selected.length ? { labId: selLab!, allocations: selected.map((o: any) => ({ ...o, amount: sel[o.id] })) } : { labId: "", allocations: [] })}>
                  <Wallet size={15} />{selected.length ? `Pagar ${selected.length} seleccionada(s)` : "Registrar pago"}
                </button>
              </div>
            </div>
            {p.data.orders.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th><span className="sr-only">Seleccionar</span></th><th>Laboratorio</th><th>Trabajo</th><th className="hide-mobile">Paciente</th><th className="hide-mobile">Llegó</th><th className="num hide-mobile">Costo</th><th className="num">Pendiente</th></tr></thead>
                <tbody>{p.data.orders.map((o: any) => (
                  <tr key={o.id} className="lab-pay-row">
                    <td><input type="checkbox" aria-label={`Seleccionar orden N° ${o.number}`} checked={sel[o.id] !== undefined} disabled={!!selLab && selLab !== o.labId} onChange={() => toggle(o)} /></td>
                    <td>{o.labName}</td>
                    <td><b>{o.label}</b><div className="muted small">N° {o.number} · {o.branchName}</div></td>
                    <td className="hide-mobile">{o.patient}</td>
                    <td className="hide-mobile nowrap">{fmtDay(o.receivedOn)}</td>
                    <td className="num hide-mobile">{bs(o.costCents)}</td>
                    <td className="num"><b>{bs(o.outstandingCents)}</b>{o.paidCents > 0 && <div className="muted small">pagado {bs(o.paidCents)}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>No hay trabajos recibidos pendientes de pago.</Empty>}
            {selLab && <p className="muted small card-pad" style={{ margin: 0 }}>Un pago se registra a un solo laboratorio: las órdenes de otros laboratorios quedan deshabilitadas.</p>}
          </section>
        </>
      )}

      <section className="card card-pad stack" aria-label="Estado de cuenta">
        <h2>Estado de cuenta por laboratorio</h2>
        <form className="lab-filters" onSubmit={(e) => { e.preventDefault(); setStQ({ ...st }); }}>
          <Field label="Laboratorio">
            <select className="input" value={st.labId} onChange={(e) => setSt({ ...st, labId: e.target.value })}>
              <option value="">Elegir…</option>{labs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Desde"><input className="input" type="date" value={st.from} onChange={(e) => setSt({ ...st, from: e.target.value })} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={st.to} onChange={(e) => setSt({ ...st, to: e.target.value })} /></Field>
          <button className="btn" style={TAP} disabled={!st.labId}>Ver estado de cuenta</button>
          {stQ?.labId && <a className="btn" style={TAP} href={`/api/lab/statement.xlsx${qs(stQ)}`}><FileSpreadsheet size={16} />Excel</a>}
        </form>
        {statement.error && <div className="alert danger">{statement.error}</div>}
        {statement.data && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Detalle</th><th className="num">Trabajos</th><th className="num">Pagos</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              <tr><td className="nowrap">{fmtDay(statement.data.from)}</td><td>Saldo inicial</td><td /><td /><td className="num">{bs(statement.data.openingCents)}</td></tr>
              {statement.data.movements.map((m: any) => (
                <tr key={m.kind + m.id}><td className="nowrap">{fmtDay(m.date)}</td><td>{m.description}</td><td className="num">{m.debitCents ? bs(m.debitCents) : ""}</td><td className="num">{m.creditCents ? bs(m.creditCents) : ""}</td><td className="num">{bs(m.balanceCents)}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td /><td>Totales del período · saldo final</td><td className="num">{bs(statement.data.debitCents)}</td><td className="num">{bs(statement.data.creditCents)}</td><td className="num">{bs(statement.data.closingCents)}</td></tr>
            </tbody>
          </table></div>
        )}
      </section>

      <section className="card" aria-label="Pagos registrados">
        <div className="card-head"><h2>Pagos registrados</h2></div>
        {!payments.data ? <Loading rows={2} /> : payments.data.length ? (
          <div className="table-wrap"><table className="table"><tbody>
            {payments.data.map((x) => (
              <tr key={x.id}>
                <td className="nowrap">{fmtDay(x.paidOn)}</td>
                <td>{x.labName}<div className="muted small">{x.methodLabel}{x.reference ? ` · ref. ${x.reference}` : ""} · {x.orders?.map((o: any) => `N° ${o.number}`).join(", ")}</div></td>
                <td className="num"><b>{bs(x.amountCents)}</b></td>
                <td className="hide-mobile muted small">{x.byName}<div>{fmtDateTime(x.createdAt)}</div></td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <Empty>Aún no hay pagos registrados.</Empty>}
      </section>
      {paying && <LabPaymentDialog labs={labs.data ?? []} init={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); reload(); }} />}
    </div>
  );
}

function LabPaymentDialog({ labs, init, onClose, onSaved }: { labs: any[]; init: { labId: string; allocations: any[] }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [allocs, setAllocs] = useState<any[]>(init.allocations);
  const [f, setF] = useState({ labId: init.labId, amount: "", paidOn: localDate(), method: "transfer", reference: "", note: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = /^\d{1,7}([.,]\d{1,2})?$/;
  const total = allocs.reduce((s, a) => s + (money.test(String(a.amount).trim()) ? parseBs(a.amount) : 0), 0);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.labId) e.labId = "Elige el laboratorio";
    if (allocs.length) allocs.forEach((a) => {
      if (!money.test(String(a.amount).trim()) || parseBs(a.amount) <= 0) e[`a-${a.id}`] = "Monto en Bs";
      else if (parseBs(a.amount) > a.outstandingCents) e[`a-${a.id}`] = `Máximo ${bs(a.outstandingCents)}`;
    });
    else if (!money.test(f.amount.trim()) || parseBs(f.amount) <= 0) e.amountCents = "Monto en Bs, por ejemplo 450 o 450,50";
    if (f.method !== "cash" && !f.reference.trim()) e.reference = "Indica el N° de transferencia, cheque o comprobante";
    if (f.paidOn > localDate()) e.paidOn = "La fecha no puede ser futura";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      const amountCents = allocs.length ? total : parseBs(f.amount);
      const r = await api.post("/api/lab/payments", {
        labId: f.labId, amountCents, paidOn: f.paidOn, method: f.method, reference: f.reference.trim() || null, note: f.note.trim() || null,
        allocations: allocs.length ? allocs.map((a) => ({ orderId: a.id, amountCents: parseBs(a.amount) })) : undefined,
      });
      toast(`Pago de ${bs(amountCents)} registrado · pendiente con el laboratorio: ${bs(r.pendingAfterCents)}`);
      onSaved();
    } catch (x: any) {
      if (x.details?.field && x.details.field !== "allocations") setErrs({ [x.details.field]: x.message }); else setErr(x.message);
    } finally { setBusy(false); }
  };
  const E = ({ k }: { k: string }) => (errs[k] ? <span className="hint lab-err" role="alert">{errs[k]}</span> : null);
  return (
    <Dialog title="Registrar pago al laboratorio" onClose={onClose} footer={<div className="row lab-foot">
      <button className="btn" style={TAP} onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" style={TAP} disabled={busy} onClick={save}>{busy ? "Guardando…" : "Registrar pago"}</button>
    </div>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <p className="muted small" style={{ margin: 0 }}>El pago queda registrado y no se puede editar. Se imputa a las órdenes indicadas{allocs.length ? "" : " (o a las más antiguas pendientes)"}.</p>
        <div className="form-grid">
          <Field label="Laboratorio">
            <select className="input" value={f.labId} disabled={allocs.length > 0} aria-invalid={!!errs.labId} onChange={(e) => setF({ ...f, labId: e.target.value })}>
              <option value="">Elegir…</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select><E k="labId" />
          </Field>
          {allocs.length ? (
            <Field label="Monto total (Bs)"><input className="input" value={toBsInput(total)} readOnly aria-readonly /></Field>
          ) : (
            <Field label="Monto (Bs)"><input className="input" inputMode="decimal" value={f.amount} aria-invalid={!!errs.amountCents} onChange={(e) => setF({ ...f, amount: e.target.value })} /><E k="amountCents" /></Field>
          )}
          <Field label="Fecha del pago"><input className="input" type="date" value={f.paidOn} max={localDate()} aria-invalid={!!errs.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /><E k="paidOn" /></Field>
          <Field label="Método">
            <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label={f.method === "cash" ? "Referencia (opcional)" : "Referencia"}><input className="input" value={f.reference} maxLength={80} aria-invalid={!!errs.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /><E k="reference" /></Field>
          <Field label="Nota (opcional)"><input className="input" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        {allocs.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Orden</th><th className="num">Pendiente</th><th className="num">A pagar (Bs)</th></tr></thead>
            <tbody>{allocs.map((a, i) => (
              <tr key={a.id} className="lab-pay-row">
                <td><b>N° {a.number}</b> · {a.label}</td>
                <td className="num">{bs(a.outstandingCents)}</td>
                <td className="num"><input className="input" inputMode="decimal" aria-label={`Monto para la orden N° ${a.number}`} value={a.amount} aria-invalid={!!errs[`a-${a.id}`]}
                  onChange={(e) => setAllocs(allocs.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} /><E k={`a-${a.id}`} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Laboratorios
function LabsTab() {
  const { can } = useAuth();
  const labs = useApi<any[]>("/api/lab/labs?all=1");
  const [edit, setEdit] = useState<any | null>(null);
  const manage = can("clinic.manage");
  return (
    <section className="card" aria-label="Laboratorios">
      <div className="card-head"><h2>Laboratorios</h2>{manage && <button className="btn btn-primary btn-sm" style={TAP} onClick={() => setEdit({})}><Plus size={15} />Nuevo laboratorio</button>}</div>
      {!labs.data ? <Loading /> : labs.data.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Laboratorio</th><th className="hide-mobile">Contacto</th><th>Teléfono / WhatsApp</th><th className="num hide-mobile">En curso</th><th>Estado</th>{manage && <th><span className="sr-only">Acciones</span></th>}</tr></thead>
          <tbody>{labs.data.map((l) => (
            <tr key={l.id}>
              <td><b>{l.name}</b>{Object.keys(l.priceList ?? {}).length > 0 && <div className="muted small">Lista de precios: {Object.entries(l.priceList).map(([k, v]) => `${WORK_TYPES.find((w) => w.id === k)?.label ?? k} ${bs(v as number)}`).join(" · ")}</div>}</td>
              <td className="hide-mobile">{l.contactName ?? "—"}</td>
              <td className="small">{[l.phone, l.whatsapp && `WhatsApp ${l.whatsapp}`].filter(Boolean).join(" · ") || "—"}</td>
              <td className="num hide-mobile">{l.openOrders}</td>
              <td>{l.active ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
              {manage && <td><button className="btn btn-ghost btn-sm" style={TAP} onClick={() => setEdit(l)}>Editar</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>{manage ? "Registra el primer laboratorio con el que trabaja la clínica." : "Administración aún no registró laboratorios."}</Empty>}
      {edit && <LabDialog lab={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); labs.reload(); }} />}
    </section>
  );
}

function LabDialog({ lab, onClose, onSaved }: { lab: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !lab.id;
  const [f, setF] = useState({
    name: lab.name ?? "", contactName: lab.contactName ?? "", phone: lab.phone ?? "", whatsapp: lab.whatsapp ?? "", email: lab.email ?? "", address: lab.address ?? "",
    notes: lab.notes ?? "", active: lab.active ?? true,
  });
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(lab.priceList ?? {}).map(([k, v]) => [k, toBsInput(v as number)])));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = "Escribe el nombre del laboratorio";
    for (const [k, v] of Object.entries(prices)) if (v.trim() && !/^\d{1,7}([.,]\d{1,2})?$/.test(v.trim())) e[`p-${k}`] = "Monto en Bs";
    setErrs(e);
    if (Object.keys(e).length) return;
    const priceList = Object.fromEntries(Object.entries(prices).filter(([, v]) => v.trim()).map(([k, v]) => [k, parseBs(v)]));
    const body = { ...f, contactName: f.contactName || null, phone: f.phone || null, whatsapp: f.whatsapp || null, email: f.email || null, address: f.address || null, notes: f.notes || null, priceList };
    try {
      if (isNew) { const { active: _a, ...b } = body; await api.post("/api/lab/labs", b); } else await api.patch(`/api/lab/labs/${lab.id}`, body);
      toast(isNew ? "Laboratorio registrado" : "Laboratorio actualizado");
      onSaved();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <Dialog wide title={isNew ? "Nuevo laboratorio" : `Editar ${lab.name}`} onClose={onClose} footer={<div className="row lab-foot">
      <button className="btn" style={TAP} onClick={onClose}>Cancelar</button><button className="btn btn-primary" style={TAP} onClick={save}>Guardar</button>
    </div>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nombre"><input className="input" value={f.name} maxLength={120} aria-invalid={!!errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{errs.name && <span className="hint lab-err">{errs.name}</span>}</Field>
          <Field label="Persona de contacto"><input className="input" value={f.contactName} maxLength={120} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
          <Field label="Teléfono"><input className="input" inputMode="tel" value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="WhatsApp"><input className="input" inputMode="tel" value={f.whatsapp} maxLength={30} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></Field>
          <Field label="Correo"><input className="input" type="email" value={f.email} maxLength={160} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Dirección"><input className="input" value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Notas" span2><textarea className="input" value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Horarios de recojo, días de entrega, condiciones de pago…" /></Field>
        </div>
        <Field label="Lista de precios por tipo de trabajo (Bs, opcional)" group hint="Se usa como sugerencia del costo al crear una orden (por pieza en coronas, puentes, carillas e incrustaciones).">
          <div className="lab-prices">
            {WORK_TYPES.map((w) => (
              <Field key={w.id} label={w.label}>
                <input className="input" inputMode="decimal" placeholder="—" value={prices[w.id] ?? ""} aria-invalid={!!errs[`p-${w.id}`]} onChange={(e) => setPrices({ ...prices, [w.id]: e.target.value })} />
                {errs[`p-${w.id}`] && <span className="hint lab-err">{errs[`p-${w.id}`]}</span>}
              </Field>
            ))}
          </div>
        </Field>
        {!isNew && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo (aparece al crear órdenes)</label>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Orden imprimible
function OrderSlipPage() {
  const { id } = useParams();
  const { me } = useAuth();
  const d = useApi<any>(`/api/lab/orders/${id}`);
  const back = <Link to="/laboratorio" className="btn btn-ghost no-print" style={TAP}><ArrowLeft size={16} />Volver a Laboratorio</Link>;
  if (d.error) return <div className="stack">{back}<Empty>{d.error}</Empty></div>;
  if (!d.data) return <Loading rows={6} />;
  const o = d.data;
  return (
    <div className="lab-slip stack">
      <div className="row-between no-print">{back}<button className="btn" style={TAP} onClick={() => window.print()}><Printer size={16} />Imprimir</button></div>
      <article className="card card-pad stack">
        <header className="lab-slip-head">
          <div><h1>Orden de laboratorio N° {o.number}</h1><div className="muted">{me?.clinic?.name} · {o.branchName}{o.branchAddress ? ` · ${o.branchAddress}` : ""}{o.branchPhone ? ` · Tel. ${o.branchPhone}` : ""}</div></div>
          <div style={{ textAlign: "right" }}><b>{o.labName}</b><div className="muted small">{[o.labContact, o.labPhone].filter(Boolean).join(" · ")}</div></div>
        </header>
        <table>
          <tbody>
            <tr><th>Paciente</th><td>{o.patientInitials} · ficha N° {o.recordNumber}</td></tr>
            <tr><th>Profesional</th><td>{o.dentistName}{o.dentistLicense ? ` · Mat. ${o.dentistLicense}` : ""}</td></tr>
            <tr><th>Trabajo</th><td><b>{o.workLabel}</b>{o.workDetail ? ` · ${o.workDetail}` : ""}</td></tr>
            <tr><th>Piezas (FDI)</th><td>{o.teeth.length ? o.teeth.join(", ") : "—"}</td></tr>
            <tr><th>Material</th><td>{o.material ?? "—"}</td></tr>
            <tr><th>Color (Vita clásica)</th><td>{[o.shade, o.shadeNote].filter(Boolean).join(" · ") || "—"}</td></tr>
            <tr><th>Impresión</th><td>{o.impression === "digital" ? "Digital" : o.impression === "physical" ? "Física" : "—"}</td></tr>
            <tr><th>Fecha de envío</th><td>{fmtDay(o.sentOn)}</td></tr>
            <tr><th>Entrega prometida</th><td>{fmtDay(o.promisedOn)}</td></tr>
            <tr><th>Instrucciones</th><td style={{ whiteSpace: "pre-wrap" }}>{o.instructions ?? "—"}</td></tr>
            {o.attachmentUrl && <tr><th>Archivo</th><td style={{ overflowWrap: "anywhere" }}>{o.attachmentUrl}</td></tr>}
          </tbody>
        </table>
        <div className="lab-slip-sign"><div>Firma del profesional</div><div>Recibido por el laboratorio</div></div>
        <p className="muted small" style={{ margin: 0 }}>Por privacidad, el nombre del paciente se reemplaza por sus iniciales y su N° de ficha.</p>
      </article>
    </div>
  );
}
