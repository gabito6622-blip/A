import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, newKey, qs } from "../lib/api";
import { bs, fmtDateTime, localDate, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, StatusBadge, useAsk, useToast } from "../components/ui";
import { CashSessionsHistory, MyCashPanel } from "./CashSessions";

const PAY_STATUS: Record<string, string> = { confirmed: "Confirmado", pending_verification: "Por verificar", rejected: "Rechazado", voided: "Anulado" };

export function CashPage() {
  const { can, branchId, me } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const [date, setDate] = useState(localDate());
  const summary = useApi<any[]>(`/api/cash-summary${qs({ date, branchId })}`);
  const pending = useApi<any[]>(`/api/payments${qs({ status: "pending_verification", branchId })}`);
  const day = useApi<any[]>(`/api/payments${qs({ from: date, to: date, branchId })}`);
  const reload = () => { summary.reload(); pending.reload(); day.reload(); };
  const verify = async (id: string, decision: "confirmed" | "rejected") => {
    const reason = decision === "rejected" ? await ask({ title: "Rechazar pago", inputLabel: "Motivo del rechazo", placeholder: "Ej.: no figura en el extracto bancario", confirmLabel: "Rechazar", danger: true }) : null;
    if (decision === "rejected" && !reason) return;
    try { await api.post(`/api/payments/${id}/verify`, { decision, reason }); toast(decision === "confirmed" ? "Pago confirmado" : "Pago rechazado"); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const voidPay = async (id: string) => {
    const reason = await ask({ title: "Anular pago", inputLabel: "Motivo de la anulación", placeholder: "Devolución, error de registro…", confirmLabel: "Anular pago", danger: true });
    if (!reason) return;
    try { await api.post(`/api/payments/${id}/void`, { reason }); toast("Pago anulado"); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const byMethod = (status: string): Record<string, number> => {
    const acc: Record<string, number> = {};
    for (const x of summary.data ?? []) if (x.status === status) acc[x.methodLabel] = (acc[x.methodLabel] ?? 0) + Number(x.amountCents);
    return acc;
  };
  const confirmed = byMethod("confirmed");
  const totalConfirmed = Object.values(confirmed).reduce((s, x) => s + x, 0);
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Caja</h1><p className="sub">{branchId ? me?.branches.find((b) => b.id === branchId)?.name : "Todas las sucursales"}</p></div>
        <Field label="Fecha"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="grid grid-4">
        <div className="card kpi"><div className="label">Cobrado confirmado del día</div><div className="value">{bs(totalConfirmed)}</div></div>
        {["Efectivo", "Transferencia", "QR"].map((m) => <div key={m} className="card kpi"><div className="label">{m}</div><div className="value">{bs(confirmed[m] ?? 0)}</div></div>)}
      </div>

      <MyCashPanel onChanged={reload} />
      {can("payments.verify") && (
        <div className="card">
          <div className="card-head"><h2>Pagos por verificar en el banco</h2><span className="badge warn">{pending.data?.length ?? 0}</span></div>
          <div className="card-pad" style={{ paddingBottom: 0 }}><p className="muted small">Un comprobante o captura de QR no prueba que el dinero ingresó. Confirma solo después de verlo en el extracto o la banca por internet. Quien registró el pago no puede verificarlo.</p></div>
          {!pending.data ? <Loading /> : pending.data.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Registrado</th><th>Paciente</th><th>Medio</th><th>Referencia</th><th className="num">Monto</th><th className="hide-mobile">Registró</th><th /></tr></thead>
              <tbody>{pending.data.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{fmtDateTime(p.receivedAt)}<div className="muted small">{p.branchName}</div></td><td><Link to={`/pacientes/${p.patientId}`}>{p.patientName}</Link></td>
                  <td>{p.methodLabel}</td><td><code>{p.bankReference}</code></td><td className="num"><b>{bs(p.amountCents)}</b></td><td className="hide-mobile">{p.receivedByName}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm btn-primary" onClick={() => verify(p.id, "confirmed")} disabled={p.receivedBy === me?.user.id && me?.membership?.role !== "owner"} title={p.receivedBy === me?.user.id ? "Debe verificarlo otra persona" : ""}><CheckCircle2 size={15} />Confirmar</button>{" "}
                    <button className="btn btn-sm btn-danger" onClick={() => verify(p.id, "rejected")}><XCircle size={15} />Rechazar</button>
                  </td>
                </tr>))}
              </tbody></table></div>
          ) : <Empty>No hay pagos pendientes de verificación.</Empty>}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Movimientos del día</h2></div>
        {!day.data ? <Loading /> : day.data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Recibo</th><th>Hora</th><th>Paciente</th><th>Medio</th><th className="num">Monto</th><th>Estado</th><th className="hide-mobile">Registró</th><th /></tr></thead>
            <tbody>{day.data.map((p) => (
              <tr key={p.id}>
                <td>{p.receiptNumber}</td><td>{fmtDateTime(p.receivedAt).slice(11)}</td><td><Link to={`/pacientes/${p.patientId}`}>{p.patientName}</Link></td><td>{p.methodLabel}{p.bankReference && <div className="muted small">Ref. {p.bankReference}</div>}</td>
                <td className="num">{bs(p.amountCents)}</td><td><StatusBadge status={p.status} label={PAY_STATUS[p.status]} /></td><td className="hide-mobile">{p.receivedByName}</td>
                <td>{can("payments.void") && p.status === "confirmed" && <button className="btn btn-ghost btn-sm" onClick={() => voidPay(p.id)}>Anular</button>}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Empty>Sin movimientos en esta fecha.</Empty>}
      </div>
      <CashSessionsHistory />
    </div>
  );
}

export function PaymentDialog({ patientId, budgetId, maxCents, onClose, onSaved }: { patientId: string; budgetId?: string; maxCents?: number; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ branchId: branchId ?? me?.branches[0]?.id ?? "", amount: maxCents && maxCents > 0 ? toBsInput(maxCents) : "", method: "cash", bankReference: "", notes: "" });
  // La clave se genera una vez por diálogo: un doble clic o un reintento no duplica el cobro.
  const [key] = useState(newKey());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null);
    const cents = parseBs(f.amount || "0");
    if (!cents || cents <= 0) return setErr("Ingresa un monto válido");
    if (f.method !== "cash" && !f.bankReference.trim()) return setErr("Ingresa el número de operación o referencia del banco");
    setBusy(true);
    try {
      const r = await api.post("/api/payments", { branchId: f.branchId, patientId, budgetId: budgetId ?? null, amountCents: cents, method: f.method, bankReference: f.bankReference || null, notes: f.notes || null, idempotencyKey: key });
      toast(r.status === "confirmed" ? `Pago registrado · recibo ${r.receiptNumber}` : `Pago registrado (recibo ${r.receiptNumber}); queda por verificar en el banco`);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Registrar pago" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Registrando…" : "Registrar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Monto (Bs)" hint={maxCents ? `Saldo del presupuesto: ${bs(maxCents)}` : undefined}><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
          <Field label="Medio de pago"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR bancario</option><option value="card">Tarjeta</option></select></Field>
          {f.method !== "cash" && <Field label="N° de operación / referencia" span2 hint="Queda pendiente hasta que otra persona lo verifique en el banco. La misma referencia no puede registrarse dos veces."><input className="input" value={f.bankReference} onChange={(e) => setF({ ...f, bankReference: e.target.value })} /></Field>}
          <Field label="Sucursal"><select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Nota"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
