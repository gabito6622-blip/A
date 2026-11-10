import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDate, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, StatusBadge, Tabs, useToast } from "../components/ui";
import { BudgetFunnel, DecisionDialog, SessionList, SharePanel, VersionPanel, parsePct, pctOf, prorate, ymd } from "../components/BudgetV2";
import { PatientPicker } from "./Agenda";
import { PaymentDialog } from "./Cash";

const STATUSES = [["", "Todos"], ["draft", "Borrador"], ["presented", "Presentados"], ["accepted", "Aceptados"], ["completed", "Completados"], ["rejected", "Rechazados"], ["cancelled", "Anulados"], ["superseded", "Reemplazados"]] as const;

export function BudgetsPage() {
  const { can, branchId } = useAuth();
  const [tab, setTab] = useState<"funnel" | "list">("funnel");
  const [status, setStatus] = useState("presented");
  const list = useApi<any[]>(tab === "list" ? `/api/budgets${qs({ status, branchId })}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [funnelKey, setFunnelKey] = useState(0);
  const total = list.data?.reduce((s, b) => s + Number(b.totalCents), 0) ?? 0;
  const changed = () => { list.reload(); setFunnelKey((k) => k + 1); };
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Presupuestos</h1><p className="sub">{tab === "funnel" ? "Seguimiento: qué presupuestos necesitan atención y cuántos días llevan así" : list.data ? `${list.data.length} presupuestos · ${bs(total)}` : " "}</p></div>
        {can("budgets.write") && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nuevo presupuesto</button>}
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: "funnel", label: "Seguimiento" }, { id: "list", label: "Listado" }]} />
      {tab === "funnel" && <BudgetFunnel key={funnelKey} branchId={branchId} onOpen={setOpen} />}
      {tab === "list" && <>
      <div className="row">{STATUSES.map(([k, l]) => <button key={k} className={`btn btn-sm ${status === k ? "btn-primary" : ""}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <div className="card">
        {!list.data ? <Loading /> : list.data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Paciente</th><th className="hide-mobile">Sucursal</th><th className="hide-mobile">Profesional</th><th className="hide-mobile">Presentado</th><th className="num">Total</th><th className="num">Pagado</th><th>Estado</th></tr></thead>
            <tbody>{list.data.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => setOpen(b.id)}>
                <td className="nowrap">{b.number}{b.version > 1 ? ` v${b.version}` : ""}</td><td><b>{b.patientName}</b></td><td className="hide-mobile">{b.branchName}</td><td className="hide-mobile">{b.dentistName}</td>
                <td className="hide-mobile">{b.presentedAt ? `${fmtDate(b.presentedAt)} (${Math.floor((Date.now() - +new Date(b.presentedAt)) / 86400000)} d)` : "—"}</td>
                <td className="num">{bs(b.totalCents)}</td><td className="num">{bs(b.paidCents)}</td><td><StatusBadge status={b.status} label={b.statusLabel} /></td>
              </tr>))}
            </tbody></table></div>
        ) : <Empty>No hay presupuestos con ese estado.</Empty>}
      </div>
      </>}
      {creating && <BudgetEditor onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); changed(); setOpen(id); }} />}
      {open && <BudgetDetailDialog key={open} id={open} onClose={() => setOpen(null)} onChanged={changed} onOpen={setOpen} />}
    </div>
  );
}

interface Item { procedureId: string; tooth: string; surfaces: string[]; quantity: number; price: string; discount: string; discountKind: "amount" | "percent" }

/** Neto de cada línea antes del global y descuento de la línea, como lo calcula el servidor. */
function lineCalc(i: Item) {
  const gross = (parseBs(i.price || "0") || 0) * i.quantity;
  const disc = i.discountKind === "percent" ? pctOf(gross, parsePct(i.discount || "0") || 0) : parseBs(i.discount || "0") || 0;
  return { gross, disc, net: gross - disc };
}

export function BudgetEditor({ patientId, budgetId, onClose, onSaved }: { patientId?: string; budgetId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { me, branchId } = useAuth();
  const toast = useToast();
  const procs = useApi<any[]>("/api/procedures");
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const sessions = useApi<any[]>("/api/procedure-sessions");
  const existing = useApi<any>(budgetId ? `/api/budgets/${budgetId}` : null);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(patientId ? { id: patientId, name: "Paciente actual" } : null);
  const [head, setHead] = useState({ branchId: branchId ?? me?.branches[0]?.id ?? "", dentistId: me?.membership?.role === "dentist" ? me.user.id : "", installments: 1, notes: "", validUntil: "" });
  const [items, setItems] = useState<Item[]>([]);
  const [gd, setGd] = useState<{ kind: "none" | "percent" | "amount"; value: string }>({ kind: "none", value: "" });
  const [err, setErr] = useState<string | null>(null);
  const [lineErr, setLineErr] = useState<Record<number, string>>({});
  useEffect(() => {
    const b = existing.data;
    if (!b) return;
    setPatient({ id: b.patientId, name: b.patientName });
    setHead({ branchId: b.branchId, dentistId: b.dentistId, installments: b.installments, notes: b.notes ?? "", validUntil: b.validUntil ?? "" });
    setItems(b.items.filter((i: any) => i.status !== "cancelled").map((i: any) => ({
      procedureId: i.procedureId, tooth: i.tooth ? String(i.tooth) : "", surfaces: i.surfaces, quantity: i.quantity, price: toBsInput(i.unitPriceCents),
      discountKind: i.discountPercent != null ? "percent" : "amount", discount: i.discountPercent != null ? String(i.discountPercent) : toBsInput(i.discountCents),
    })));
    setGd(b.globalDiscountPercent != null ? { kind: "percent", value: String(b.globalDiscountPercent) } : b.globalDiscountCents ? { kind: "amount", value: toBsInput(b.globalDiscountCents) } : { kind: "none", value: "" });
  }, [existing.data]);
  const proc = (id: string) => procs.data?.find((p) => p.id === id);
  const add = (id: string) => {
    const p = proc(id);
    if (p) setItems([...items, { procedureId: id, tooth: "", surfaces: [], quantity: 1, price: toBsInput(p.priceCents), discount: "0", discountKind: "amount" }]);
  };
  const calcs = items.map(lineCalc);
  const sumNet = calcs.reduce((s, c) => s + Math.max(0, c.net), 0);
  const gdCents = gd.kind === "percent" ? pctOf(sumNet, parsePct(gd.value || "0") || 0) : gd.kind === "amount" ? parseBs(gd.value || "0") || 0 : 0;
  const shares = gdCents <= sumNet ? prorate(gdCents, calcs.map((c) => Math.max(0, c.net))) : calcs.map(() => 0);
  const total = Math.max(0, sumNet - gdCents);
  const gdErr = gd.kind === "percent" && (parsePct(gd.value || "0") > 100 || parsePct(gd.value || "0") < 0) ? "El descuento va de 0 a 100 %"
    : gdCents > sumNet ? `No puede superar el total de las líneas (${bs(sumNet)})` : null;
  const validate = () => {
    const le: Record<number, string> = {};
    items.forEach((i, k) => {
      const c = calcs[k]!;
      if (i.discountKind === "percent" && (parsePct(i.discount || "0") > 100 || parsePct(i.discount || "0") < 0)) le[k] = "El % va de 0 a 100";
      else if (c.disc > c.gross) le[k] = "Supera el importe";
      else if (!Number.isFinite(c.gross)) le[k] = "Precio inválido";
    });
    setLineErr(le);
    return !Object.keys(le).length && !gdErr;
  };
  const save = async () => {
    setErr(null);
    if (!patient) return setErr("Elige el paciente");
    if (!head.dentistId) return setErr("Elige el profesional");
    if (!validate()) return setErr("Revisa los descuentos marcados");
    const lines = items.map((i) => ({
      procedureId: i.procedureId, tooth: i.tooth ? Number(i.tooth) : null, surfaces: i.surfaces, quantity: i.quantity, unitPriceCents: parseBs(i.price || "0"),
      ...(i.discountKind === "percent" ? { discountPercent: parsePct(i.discount || "0"), discountCents: 0 } : { discountCents: parseBs(i.discount || "0") || 0, discountPercent: null }),
    }));
    const globalDiscount = gd.kind === "none" ? { kind: "none", value: 0 } : gd.kind === "percent" ? { kind: "percent", value: parsePct(gd.value || "0") } : { kind: "amount", value: parseBs(gd.value || "0") || 0 };
    try {
      if (budgetId) {
        await api.put(`/api/budgets/${budgetId}/items`, { items: lines, installments: Number(head.installments), notes: head.notes || null, globalDiscount });
        await api.put(`/api/budgets/${budgetId}/terms`, { validUntil: head.validUntil || null });
        toast("Borrador actualizado"); onSaved(budgetId);
      } else {
        const r = await api.post("/api/budgets", {
          branchId: head.branchId, patientId: patient.id, dentistId: head.dentistId, installments: Number(head.installments), notes: head.notes || null, validUntil: head.validUntil || null,
          items: lines, globalDiscount,
        });
        toast(`Presupuesto N° ${r.number} creado`); onSaved(r.id);
      }
    } catch (e: any) { setErr(e.message); }
  };
  if (budgetId && !existing.data) return <Dialog wide title="Editar borrador" onClose={onClose}><Loading /></Dialog>;
  return (
    <Dialog wide title={budgetId ? `Editar borrador N° ${existing.data.number}${existing.data.version > 1 ? ` (v${existing.data.version})` : ""}` : "Nuevo presupuesto"} onClose={onClose} footer={<><span className="muted" style={{ marginRight: "auto" }}>Total: <b style={{ color: "var(--ink)", fontSize: 17 }}>{bs(total)}</b>{head.installments > 1 && ` · ${head.installments} cuotas de ~${bs(Math.floor(total / head.installments))}`}</span><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!items.length} onClick={save}>Guardar borrador</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          {!patientId && !budgetId && <Field label="Paciente" span2 group><PatientPicker value={patient} onChange={setPatient} /></Field>}
          {budgetId && <div className="span-2"><b>{patient?.name}</b></div>}
          <Field label="Sucursal"><select className="input" disabled={!!budgetId} value={head.branchId} onChange={(e) => setHead({ ...head, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Profesional"><select className="input" disabled={!!budgetId} value={head.dentistId} onChange={(e) => setHead({ ...head, dentistId: e.target.value })}><option value="">Elegir…</option>{staff.data?.map((s) => <option key={s.userId} value={s.userId}>{s.fullName}</option>)}</select></Field>
          <Field label="Cuotas"><input className="input" type="number" min={1} max={60} value={head.installments} onChange={(e) => setHead({ ...head, installments: Number(e.target.value) })} /></Field>
          <Field label="Válido hasta"><input className="input" type="date" value={head.validUntil} onChange={(e) => setHead({ ...head, validUntil: e.target.value })} /></Field>
        </div>
        <Field label="Agregar prestación">
          <select className="input" value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">Elegir del catálogo…</option>
            {procs.data?.map((p) => { const n = sessions.data?.find((x) => x.procedureId === p.id)?.sessions?.length; return <option key={p.id} value={p.id}>{p.code} · {p.name} — {bs(p.priceCents)}{n ? ` · ${n} sesiones` : ""}</option>; })}
          </select>
        </Field>
        {items.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Prestación</th><th>Pieza</th><th>Superficies</th><th>Cant.</th><th>Precio (Bs)</th><th>Descuento</th><th className="num">Neto</th><th /></tr></thead>
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
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <input className="input" style={{ width: 76 }} inputMode="decimal" aria-label={`Descuento de ${p?.name ?? "la línea"}`} aria-invalid={!!lineErr[k]} value={i.discount} onChange={(e) => upd({ discount: e.target.value })} />
                      <select className="input" style={{ width: 62, padding: "0 4px" }} aria-label="Tipo de descuento" value={i.discountKind} onChange={(e) => upd({ discountKind: e.target.value as Item["discountKind"] })}><option value="amount">Bs</option><option value="percent">%</option></select>
                    </div>
                    {lineErr[k] && <div className="small" style={{ color: "var(--danger)" }}>{lineErr[k]}</div>}
                  </td>
                  <td className="num">{shares[k] ? <><div className="muted small">−{bs(shares[k]!)} global</div>{bs(Math.max(0, calcs[k]!.net - shares[k]!))}</> : bs(Math.max(0, calcs[k]!.net))}</td>
                  <td><button className="btn btn-ghost btn-icon" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Quitar"><Trash2 size={16} /></button></td>
                </tr>);
            })}</tbody></table></div>
        )}
        {items.length > 0 && (
          <div className="form-grid">
            <Field label="Descuento global" hint="Se reparte entre las líneas según su neto; el redondeo va a la última.">
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <select className="input" style={{ width: 150 }} aria-label="Tipo de descuento global" value={gd.kind} onChange={(e) => setGd({ kind: e.target.value as any, value: e.target.value === "none" ? "" : gd.value })}>
                  <option value="none">Sin descuento</option><option value="percent">Porcentaje (%)</option><option value="amount">Monto (Bs)</option>
                </select>
                {gd.kind !== "none" && <input className="input" inputMode="decimal" aria-label="Valor del descuento global" aria-invalid={!!gdErr} value={gd.value} onChange={(e) => setGd({ ...gd, value: e.target.value })} />}
              </div>
            </Field>
            <div className="stack-sm" style={{ justifyContent: "flex-end" }}>
              {gdErr && <span className="small" role="alert" style={{ color: "var(--danger)" }}>{gdErr}</span>}
              <span className="small muted">Subtotal {bs(calcs.reduce((s, c) => s + c.gross, 0))} · descuentos {bs(calcs.reduce((s, c) => s + c.disc, 0) + gdCents)}</span>
            </div>
          </div>
        )}
        <Field label="Notas para el paciente" hint="El paciente las verá en su enlace."><textarea className="input" value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

const ACTION_LABEL: Record<string, string> = { presented: "Marcar como presentado", accepted: "Paciente aceptó", rejected: "Paciente rechazó", cancelled: "Anular", draft: "Volver a borrador" };

export function BudgetDetailDialog({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen?: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState(id);
  const b = useApi<any>(`/api/budgets/${current}`);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const open = (x: string) => { setCurrent(x); onOpen?.(x); onChanged(); };
  const setStatus = async (status: string, note: string | null) => {
    await api.post(`/api/budgets/${current}/status`, { status, note }); toast("Presupuesto actualizado"); setDeciding(null); b.reload(); onChanged();
  };
  const act = async (status: string) => {
    if (["accepted", "rejected", "cancelled"].includes(status)) return setDeciding(status);
    try { await setStatus(status, null); } catch (e: any) { toast(e.message, true); }
  };
  const perform = async (itemId: string) => {
    try { await api.post(`/api/budget-items/${itemId}/perform`, {}); toast("Tratamiento registrado como realizado"); b.reload(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const d = b.data;
  const reload = () => { b.reload(); onChanged(); };
  return (
    <Dialog wide title={d ? `Presupuesto N° ${d.number}${d.versionsCount > 1 ? ` · v${d.version}` : ""}` : "Presupuesto"} onClose={onClose} footer={d && <>
      <button className="btn" onClick={() => window.print()}><Printer size={15} />Imprimir</button>
      {can("budgets.write") && d.status === "draft" && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Editar</button>}
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
          {d.status === "superseded" && <div className="alert warn" role="status">Esta versión fue reemplazada: ya no se puede aceptar ni cobrar. {d.latestVersionId && <button className="btn btn-sm" onClick={() => open(d.latestVersionId)}>Ver versión vigente</button>}</div>}
          {d.onlineAcceptance && <div className="alert ok" role="status">Aceptado por el paciente en línea: {d.onlineAcceptance.signerName} ({d.onlineAcceptance.signerRelationship === "guardian" ? "madre, padre o tutor" : "paciente"}) el {fmtDate(d.onlineAcceptance.at)}{d.onlineAcceptance.hasSignature ? ", con firma" : ""}.</div>}
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Prestación</th><th>Pieza</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Desc.</th><th className="num">Neto</th><th>Estado</th><th /></tr></thead>
            <tbody>{d.items.filter((i: any) => i.status !== "cancelled" || d.status !== "draft").map((i: any) => (
              <tr key={i.id} style={i.status === "cancelled" ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                <td>{i.description}<div className="muted small">{i.procedureCode}</div><SessionList item={i} budgetStatus={d.status} onChanged={reload} /></td><td>{i.tooth ?? "—"}{i.surfaces.length ? ` (${i.surfaces.join("")})` : ""}</td>
                <td className="num">{i.quantity}</td>
                <td className="num">{i.totalCents !== i.grossCents ? <><s className="muted">{bs(i.grossCents)}</s></> : bs(i.unitPriceCents * i.quantity)}</td>
                <td className="num">{i.discountCents ? <div>{i.discountPercent != null ? `${i.discountPercent} %` : bs(i.discountCents)}</div> : null}{i.globalDiscountCents ? <div className="muted small">{bs(i.globalDiscountCents)} global</div> : null}{!i.discountCents && !i.globalDiscountCents && "—"}</td>
                <td className="num"><b>{bs(i.totalCents)}</b></td>
                <td>{i.status === "done" ? <span className="badge ok">Realizado</span> : i.status === "cancelled" ? <span className="badge">Anulado</span> : <span className="badge info">Pendiente</span>}{i.performedByName && <div className="muted small">{i.performedByName}</div>}</td>
                <td>{i.status === "pending" && d.status === "accepted" && can("treatments.perform") && <button className="btn btn-sm btn-primary" onClick={() => perform(i.id)}>{i.sessions?.length ? "Completar todo" : "Realizado"}</button>}</td>
              </tr>))}
            </tbody>
            {(d.lineDiscountCents > 0 || d.globalDiscountCents > 0) && (
              <tfoot>
                <tr><td colSpan={5}>Subtotal</td><td className="num">{bs(d.subtotalCents)}</td><td colSpan={2} /></tr>
                {d.lineDiscountCents > 0 && <tr><td colSpan={5}>Descuentos por línea</td><td className="num">−{bs(d.lineDiscountCents)}</td><td colSpan={2} /></tr>}
                {d.globalDiscountCents > 0 && <tr><td colSpan={5}>Descuento global{d.globalDiscountPercent != null ? ` (${d.globalDiscountPercent} %)` : ""}</td><td className="num">−{bs(d.globalDiscountCents)}</td><td colSpan={2} /></tr>}
                <tr><td colSpan={5}>Total</td><td className="num">{bs(d.totalCents)}</td><td colSpan={2} /></tr>
              </tfoot>
            )}
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
          {d.validUntil && <p className="small muted">Válido hasta el {ymd(d.validUntil)}</p>}
          {d.decidedNote && <p className="small">Nota de decisión: {d.decidedNote}</p>}
          <div className="grid grid-2">
            <SharePanel budget={d} onChanged={reload} />
            <VersionPanel budget={d} onOpen={open} />
          </div>
        </div>
      )}
      {editing && d && <BudgetEditor budgetId={d.id} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {deciding && <DecisionDialog title={ACTION_LABEL[deciding]!} danger={deciding !== "accepted"} onClose={() => setDeciding(null)} onConfirm={(note) => setStatus(deciding, note)} />}
      {paying && d && <PaymentDialog patientId={d.patientId} budgetId={d.id} maxCents={d.remainingCents - d.pendingVerificationCents} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); b.reload(); onChanged(); }} />}
    </Dialog>
  );
}

export { qs };
