import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Printer, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDate, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, StatusBadge, useToast } from "../components/ui";
import { PatientPicker } from "./Agenda";
import { PaymentDialog } from "./Cash";

const STATUSES = [["", "Todos"], ["draft", "Borrador"], ["presented", "Presentados"], ["accepted", "Aceptados"], ["completed", "Completados"], ["rejected", "Rechazados"], ["cancelled", "Anulados"]] as const;

export function BudgetsPage() {
  const { can, branchId } = useAuth();
  const [status, setStatus] = useState("presented");
  const list = useApi<any[]>(`/api/budgets${qs({ status, branchId })}`);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const total = list.data?.reduce((s, b) => s + Number(b.totalCents), 0) ?? 0;
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Presupuestos</h1><p className="sub">{list.data ? `${list.data.length} presupuestos · ${bs(total)}` : " "}</p></div>
        {can("budgets.write") && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nuevo presupuesto</button>}
      </div>
      <div className="row">{STATUSES.map(([k, l]) => <button key={k} className={`btn btn-sm ${status === k ? "btn-primary" : ""}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <div className="card">
        {!list.data ? <Loading /> : list.data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Paciente</th><th className="hide-mobile">Sucursal</th><th className="hide-mobile">Profesional</th><th className="hide-mobile">Presentado</th><th className="num">Total</th><th className="num">Pagado</th><th>Estado</th></tr></thead>
            <tbody>{list.data.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => setOpen(b.id)}>
                <td>{b.number}</td><td><b>{b.patientName}</b></td><td className="hide-mobile">{b.branchName}</td><td className="hide-mobile">{b.dentistName}</td>
                <td className="hide-mobile">{b.presentedAt ? `${fmtDate(b.presentedAt)} (${Math.floor((Date.now() - +new Date(b.presentedAt)) / 86400000)} d)` : "—"}</td>
                <td className="num">{bs(b.totalCents)}</td><td className="num">{bs(b.paidCents)}</td><td><StatusBadge status={b.status} label={b.statusLabel} /></td>
              </tr>))}
            </tbody></table></div>
        ) : <Empty>No hay presupuestos con ese estado.</Empty>}
      </div>
      {creating && <BudgetEditor onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); list.reload(); setOpen(id); }} />}
      {open && <BudgetDetailDialog id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

interface Item { procedureId: string; tooth: string; surfaces: string[]; quantity: number; price: string; discount: string }

export function BudgetEditor({ patientId, onClose, onSaved }: { patientId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { me, branchId } = useAuth();
  const toast = useToast();
  const procs = useApi<any[]>("/api/procedures");
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(patientId ? { id: patientId, name: "Paciente actual" } : null);
  const [head, setHead] = useState({ branchId: branchId ?? me?.branches[0]?.id ?? "", dentistId: me?.membership?.role === "dentist" ? me.user.id : "", installments: 1, notes: "", validUntil: "" });
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const proc = (id: string) => procs.data?.find((p) => p.id === id);
  const add = (id: string) => {
    const p = proc(id);
    if (p) setItems([...items, { procedureId: id, tooth: "", surfaces: [], quantity: 1, price: toBsInput(p.priceCents), discount: "0" }]);
  };
  const lineTotal = (i: Item) => Math.max(0, parseBs(i.price || "0") * i.quantity - parseBs(i.discount || "0"));
  const total = items.reduce((s, i) => s + lineTotal(i), 0);
  const save = async () => {
    setErr(null);
    if (!patient) return setErr("Elige el paciente");
    if (!head.dentistId) return setErr("Elige el profesional");
    try {
      const r = await api.post("/api/budgets", {
        branchId: head.branchId, patientId: patient.id, dentistId: head.dentistId, installments: Number(head.installments), notes: head.notes || null, validUntil: head.validUntil || null,
        items: items.map((i) => ({ procedureId: i.procedureId, tooth: i.tooth ? Number(i.tooth) : null, surfaces: i.surfaces, quantity: i.quantity, unitPriceCents: parseBs(i.price || "0"), discountCents: parseBs(i.discount || "0") })),
      });
      toast(`Presupuesto N° ${r.number} creado`); onSaved(r.id);
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Dialog wide title="Nuevo presupuesto" onClose={onClose} footer={<><span className="muted" style={{ marginRight: "auto" }}>Total: <b style={{ color: "var(--ink)", fontSize: 17 }}>{bs(total)}</b>{head.installments > 1 && ` · ${head.installments} cuotas de ~${bs(Math.floor(total / head.installments))}`}</span><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!items.length} onClick={save}>Guardar borrador</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          {!patientId && <Field label="Paciente" span2 group><PatientPicker value={patient} onChange={setPatient} /></Field>}
          <Field label="Sucursal"><select className="input" value={head.branchId} onChange={(e) => setHead({ ...head, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Profesional"><select className="input" value={head.dentistId} onChange={(e) => setHead({ ...head, dentistId: e.target.value })}><option value="">Elegir…</option>{staff.data?.map((s) => <option key={s.userId} value={s.userId}>{s.fullName}</option>)}</select></Field>
          <Field label="Cuotas"><input className="input" type="number" min={1} max={60} value={head.installments} onChange={(e) => setHead({ ...head, installments: Number(e.target.value) })} /></Field>
          <Field label="Válido hasta"><input className="input" type="date" value={head.validUntil} onChange={(e) => setHead({ ...head, validUntil: e.target.value })} /></Field>
        </div>
        <Field label="Agregar prestación">
          <select className="input" value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">Elegir del catálogo…</option>
            {procs.data?.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} — {bs(p.priceCents)}</option>)}
          </select>
        </Field>
        {items.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Prestación</th><th>Pieza</th><th>Superficies</th><th>Cant.</th><th>Precio (Bs)</th><th>Desc. (Bs)</th><th className="num">Subtotal</th><th /></tr></thead>
            <tbody>{items.map((i, k) => {
              const p = proc(i.procedureId);
              const upd = (patch: Partial<Item>) => setItems(items.map((x, j) => (j === k ? { ...x, ...patch } : x)));
              return (
                <tr key={k}>
                  <td>{p?.name}</td>
                  <td><input className="input" style={{ width: 64 }} inputMode="numeric" value={i.tooth} onChange={(e) => upd({ tooth: e.target.value.replace(/\D/g, "").slice(0, 2) })} disabled={p?.scope === "mouth" || p?.scope === "quadrant"} placeholder={p?.scope === "tooth" || p?.scope === "surface" ? "Req." : "—"} /></td>
                  <td>{p?.scope === "surface" ? <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>{["M", "D", "O", "V", "L"].map((s) => <button key={s} type="button" className={`btn btn-sm ${i.surfaces.includes(s) ? "btn-primary" : ""}`} style={{ padding: "0 7px" }} onClick={() => upd({ surfaces: i.surfaces.includes(s) ? i.surfaces.filter((x) => x !== s) : [...i.surfaces, s] })}>{s}</button>)}</div> : "—"}</td>
                  <td><input className="input" style={{ width: 60 }} type="number" min={1} value={i.quantity} onChange={(e) => upd({ quantity: Math.max(1, Number(e.target.value)) })} /></td>
                  <td><input className="input" style={{ width: 100 }} inputMode="decimal" value={i.price} onChange={(e) => upd({ price: e.target.value })} /></td>
                  <td><input className="input" style={{ width: 90 }} inputMode="decimal" value={i.discount} onChange={(e) => upd({ discount: e.target.value })} /></td>
                  <td className="num">{bs(lineTotal(i))}</td>
                  <td><button className="btn btn-ghost btn-icon" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Quitar"><Trash2 size={16} /></button></td>
                </tr>);
            })}</tbody></table></div>
        )}
        <Field label="Notas para el paciente"><textarea className="input" value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

const ACTION_LABEL: Record<string, string> = { presented: "Marcar como presentado", accepted: "Paciente aceptó", rejected: "Paciente rechazó", cancelled: "Anular", draft: "Volver a borrador" };

export function BudgetDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const b = useApi<any>(`/api/budgets/${id}`);
  const [paying, setPaying] = useState(false);
  const act = async (status: string) => {
    const note = ["accepted", "rejected", "cancelled"].includes(status) ? window.prompt("Nota (opcional): cómo se aceptó/rechazó, firma, etc.") ?? "" : null;
    try { await api.post(`/api/budgets/${id}/status`, { status, note: note || null }); toast("Presupuesto actualizado"); b.reload(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const perform = async (itemId: string) => {
    try { await api.post(`/api/budget-items/${itemId}/perform`, {}); toast("Tratamiento registrado como realizado"); b.reload(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const d = b.data;
  return (
    <Dialog wide title={d ? `Presupuesto N° ${d.number}` : "Presupuesto"} onClose={onClose} footer={d && <>
      <button className="btn" onClick={() => window.print()}><Printer size={15} />Imprimir</button>
      {can("budgets.write") && d.allowedTransitions.map((s: string) => <button key={s} className={`btn ${s === "accepted" || s === "presented" ? "btn-primary" : s === "cancelled" || s === "rejected" ? "btn-danger" : ""}`} onClick={() => act(s)}>{ACTION_LABEL[s]}</button>)}
      {can("payments.create") && ["presented", "accepted", "completed"].includes(d.status) && d.remainingCents > 0 && <button className="btn btn-primary" onClick={() => setPaying(true)}>Registrar pago</button>}
    </>}>
      {!d ? <Loading /> : (
        <div className="stack">
          <div className="row-between">
            <div className="stack-sm" style={{ gap: 2 }}>
              <Link to={`/pacientes/${d.patientId}`} style={{ fontWeight: 650, fontSize: 16 }}>{d.patientName}</Link>
              <span className="muted small">{d.branchName} · {d.dentistName} · {fmtDate(d.createdAt)}</span>
            </div>
            <StatusBadge status={d.status} label={d.statusLabel} />
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Prestación</th><th>Pieza</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Desc.</th><th className="num">Total</th><th>Estado</th><th /></tr></thead>
            <tbody>{d.items.filter((i: any) => i.status !== "cancelled" || d.status !== "draft").map((i: any) => (
              <tr key={i.id} style={i.status === "cancelled" ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                <td>{i.description}<div className="muted small">{i.procedureCode}</div></td><td>{i.tooth ?? "—"}{i.surfaces.length ? ` (${i.surfaces.join("")})` : ""}</td>
                <td className="num">{i.quantity}</td><td className="num">{bs(i.unitPriceCents)}</td><td className="num">{i.discountCents ? bs(i.discountCents) : "—"}</td><td className="num"><b>{bs(i.totalCents)}</b></td>
                <td>{i.status === "done" ? <span className="badge ok">Realizado</span> : i.status === "cancelled" ? <span className="badge">Anulado</span> : <span className="badge info">Pendiente</span>}{i.performedByName && <div className="muted small">{i.performedByName}</div>}</td>
                <td>{i.status === "pending" && d.status === "accepted" && can("treatments.perform") && <button className="btn btn-sm btn-primary" onClick={() => perform(i.id)}>Realizado</button>}</td>
              </tr>))}
            </tbody>
          </table></div>
          <div className="grid grid-4">
            <div className="card kpi"><div className="label">Total</div><div className="value">{bs(d.totalCents)}</div></div>
            <div className="card kpi"><div className="label">Realizado</div><div className="value">{bs(d.doneCents)}</div></div>
            <div className="card kpi"><div className="label">Pagado</div><div className="value">{bs(d.paidCents)}</div>{d.pendingVerificationCents > 0 && <div className="foot" style={{ color: "var(--warn)" }}>{bs(d.pendingVerificationCents)} por verificar</div>}</div>
            <div className="card kpi"><div className="label">Saldo del presupuesto</div><div className="value">{bs(d.remainingCents)}</div></div>
          </div>
          {d.installments > 1 && (
            <div className="card card-pad"><b>Plan de pagos ({d.installments} cuotas)</b><div className="row" style={{ marginTop: 8 }}>{d.installmentPlan.map((c: number, k: number) => <span key={k} className="badge">Cuota {k + 1}: {bs(c)}</span>)}</div></div>
          )}
          {d.notes && <p className="muted">{d.notes}</p>}
          {d.decidedNote && <p className="small">Nota de decisión: {d.decidedNote}</p>}
        </div>
      )}
      {paying && d && <PaymentDialog patientId={d.patientId} budgetId={d.id} maxCents={d.remainingCents - d.pendingVerificationCents} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); b.reload(); onChanged(); }} />}
    </Dialog>
  );
}

export { qs };
