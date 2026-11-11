// B-082: traslado al paciente de la porción impaga de la empresa (diálogo en Convenios y aviso en la
// ficha) y cuentas por cobrar generales con antigüedad (Reportes).
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Download, Undo2 } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { bs, fmtDate, localDate } from "../../lib/format";
import { Dialog, Empty, Field, Loading, Tabs, useAsk, useToast } from "../ui";
import { fieldErrors } from "./AgreementWidgets";
import "./agreements.css";

// ---------------- Convenios → Por cobrar a empresas → «Porciones impagas» ----------------
export function TransferDialog({ agreement, onClose, onChanged }: { agreement: { id: string; name: string }; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const data = useApi<any>(`/api/agreements/${agreement.id}/transferable`);
  const done = useApi<any[]>(`/api/payer-transfers?agreementId=${agreement.id}`);
  const [sel, setSel] = useState<any | null>(null);
  const canMove = can("payments.void");
  const reload = () => { data.reload(); done.reload(); onChanged(); };
  const reverse = async (t: any) => {
    const reason = await ask({ title: "Devolver la porción a la empresa", message: `${t.patientName} · ${t.service} · ${bs(t.amountCents)}. Se registra un movimiento nuevo; el traslado original queda en el historial.`,
      inputLabel: "Motivo", minLength: 5, placeholder: "Ej.: la empresa aceptó pagarla", confirmLabel: "Devolver a la empresa" });
    if (!reason) return;
    try { await api.post(`/api/payer-transfers/${t.id}/reverse`, { reason }); toast("La porción volvió a la cuenta de la empresa"); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const active = (done.data ?? []).filter((t) => t.amountCents > 0);
  return (
    <Dialog wide title={`Porciones impagas · ${agreement.name}`} onClose={onClose} footer={<button className="btn ag-tap" onClick={onClose}>Cerrar</button>}>
      <div className="stack">
        <div className="alert info" role="note">
          Si la empresa rechaza una porción, o no la paga {data.data ? `en ${data.data.patientTransferDays} días` : "en el plazo del convenio"}, puedes trasladarla al saldo del paciente con un motivo.
          Nunca se hace sola y se puede devolver a la empresa con otro movimiento.
        </div>
        {!data.data ? <Loading /> : !data.data.charges.length ? <Empty>Esta empresa no tiene porciones impagas.</Empty> : (
          <div className="table-wrap">
            <table className="table cards-sm ag-cards">
              <thead><tr><th>Paciente</th><th>Tratamiento</th><th>Antigüedad</th><th className="num">Impago de la empresa</th><th><span className="sr-only">Acción</span></th></tr></thead>
              <tbody>{data.data.charges.map((c: any) => (
                <tr key={c.id}>
                  <td><span><b>{c.patientName}</b>{c.memberNumber ? <span className="muted small">&nbsp;· afiliado {c.memberNumber}</span> : null}</span></td>
                  <td><span>{c.service} · {fmtDate(c.createdAt)}</span></td>
                  <td><span>{c.ageDays} días {c.overdueForTransfer ? <span className="badge warn">Vencida</span> : <span className="muted small">(vence en {c.daysLeft})</span>}</span></td>
                  <td className="num"><span><b>{bs(c.openCents)}</b>{c.pendingCents ? <span className="muted small">&nbsp;+ {bs(c.pendingCents)} por verificar</span> : null}</span></td>
                  <td>{canMove && <button className="btn btn-sm ag-tap" onClick={() => setSel(c)}><ArrowRightLeft size={15} />Trasladar al paciente</button>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
        <h3 style={{ margin: "6px 0 0" }}>Trasladadas al paciente</h3>
        {!done.data ? <Loading rows={2} /> : !active.length ? <Empty>Todavía no se trasladó ninguna porción de esta empresa.</Empty> : (
          <div className="table-wrap">
            <table className="table cards-sm ag-cards">
              <thead><tr><th>Paciente</th><th>Motivo</th><th>Fecha</th><th className="num">Monto</th><th><span className="sr-only">Acción</span></th></tr></thead>
              <tbody>{active.map((t: any) => (
                <tr key={t.id}>
                  <td><span><Link to={`/pacientes/${t.patientId}`}>{t.patientName}</Link></span></td>
                  <td><span>{t.causeLabel}: {t.reason}</span></td>
                  <td>{fmtDate(t.createdAt)}</td>
                  <td className="num">{bs(t.amountCents)}</td>
                  <td>{t.reversed ? <span className="badge">Devuelta a la empresa</span> : canMove && <button className="btn btn-ghost btn-sm ag-tap" onClick={() => reverse(t)}><Undo2 size={15} />Devolver</button>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {sel && <TransferForm charge={sel} agreementName={agreement.name} onClose={() => setSel(null)} onSaved={() => { setSel(null); toast("Porción trasladada al saldo del paciente"); reload(); }} />}
    </Dialog>
  );
}

function TransferForm({ charge, agreementName, onClose, onSaved }: { charge: any; agreementName: string; onClose: () => void; onSaved: () => void }) {
  const [cause, setCause] = useState<"overdue" | "rejected">(charge.overdueForTransfer ? "overdue" : "rejected");
  const [reason, setReason] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (reason.trim().length < 5) e.reason = "Escribe el motivo (mínimo 5 caracteres)";
    setFe(e); setErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await api.post(`/api/payer-charges/${charge.id}/transfer`, { cause, reason: reason.trim() }); onSaved(); }
    catch (x: any) { setFe(fieldErrors(x)); setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Trasladar al paciente" onClose={onClose} footer={<>
      <button className="btn ag-tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary ag-tap" disabled={busy} onClick={save}>{busy ? "Trasladando…" : `Trasladar ${bs(charge.openCents)}`}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <p style={{ margin: 0 }}><b>{charge.patientName}</b> · {charge.service} ({fmtDate(charge.createdAt)})<br />
          <span className="muted small">{agreementName} no pagó {bs(charge.openCents)}. Pasará al saldo del paciente y saldrá de la cuenta de la empresa.</span></p>
        <Field label="¿Por qué se traslada?" group>
          <label className="check"><input type="radio" name="cause" checked={cause === "rejected"} onChange={() => setCause("rejected")} />La empresa rechazó la porción</label>
          <label className="check"><input type="radio" name="cause" checked={cause === "overdue"} disabled={!charge.overdueForTransfer} onChange={() => setCause("overdue")} />
            La empresa no pagó en el plazo{!charge.overdueForTransfer ? ` (faltan ${charge.daysLeft} días)` : ""}</label>
        </Field>
        <Field label="Motivo (queda en la ficha del paciente)">
          <textarea className="input" rows={3} maxLength={300} value={reason} aria-invalid={!!fe.reason} aria-describedby={fe.reason ? "tr-reason-err" : undefined}
            placeholder="Ej.: la empresa respondió que no cubre este tratamiento" onChange={(e) => setReason(e.target.value)} />
          {fe.reason && <span id="tr-reason-err" className="ag-err">{fe.reason}</span>}
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------- Ficha del paciente: aviso ----------------
export function PayerTransferNotice({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const r = useApi<any>(can("payments.read") ? `/api/patients/${patientId}/payer-transfers` : null);
  const live = (r.data?.items ?? []).filter((t: any) => t.amountCents > 0 && !t.reversed);
  if (!live.length) return null;
  const total = live.reduce((s: number, t: any) => s + t.amountCents, 0);
  return (
    <div className="alert warn" role="note" data-testid="payer-transfer-notice">
      <b>Saldo trasladado desde un convenio: {bs(total)}.</b> Ya está sumado al saldo del paciente.
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {live.map((t: any) => (
          <li key={t.id}>{t.agreementName} no pagó {bs(t.amountCents)} de «{t.service}» ({fmtDate(t.chargedAt)}). {t.causeLabel}: {t.reason}. Trasladado el {fmtDate(t.createdAt)}.</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- Reportes: cuentas por cobrar con antigüedad ----------------
const BUCKETS = ["d0_30", "d31_60", "d61_90", "d90_plus"] as const;
const BUCKET_LABELS: Record<(typeof BUCKETS)[number], string> = { d0_30: "0–30 días", d31_60: "31–60 días", d61_90: "61–90 días", d90_plus: "Más de 90 días" };

export function ReceivablesAging() {
  const [asOf, setAsOf] = useState(localDate());
  const [tab, setTab] = useState<"patients" | "companies">("patients");
  const d = useApi<any>(`/api/reports/receivables-aging?asOf=${asOf}`);
  const cells = (row: any) => BUCKETS.map((k) => <td key={k} className="num">{row[k] ? bs(row[k]) : <span className="muted">—</span>}</td>);
  return (
    <div className="card" aria-labelledby="aging-title">
      <div className="card-head">
        <h2 id="aging-title">Cuentas por cobrar por antigüedad</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Saldo al"><input className="input" type="date" max={localDate()} value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></Field>
          <a className="btn btn-sm ag-tap" href={`/api/reports/receivables-aging.xlsx?asOf=${asOf}`}><Download size={15} />Excel</a>
        </div>
      </div>
      {d.error ? <div className="card-pad"><div className="alert danger" role="alert">{d.error}</div></div> : !d.data ? <Loading /> : (
        <div className="card-pad stack">
          <div className="table-wrap">
            <table className="table cards-sm ag-cards">
              <thead><tr><th>Cuenta</th>{BUCKETS.map((k) => <th key={k} className="num">{BUCKET_LABELS[k]}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>
                <tr><td><b>Pacientes</b></td>{cells(d.data.totals.patients)}<td className="num"><b>{bs(d.data.totals.patients.totalCents)}</b></td></tr>
                {d.data.totals.companies && <tr><td><b>Empresas (convenios)</b></td>{cells(d.data.totals.companies)}<td className="num"><b>{bs(d.data.totals.companies.totalCents)}</b></td></tr>}
                <tr><td><b>Total general</b></td>{cells(d.data.totals.general)}<td className="num"><b>{bs(d.data.totals.general.totalCents)}</b></td></tr>
              </tbody>
            </table>
          </div>
          {d.data.note && <p className="muted small" style={{ margin: 0 }}>{d.data.note}</p>}
          <Tabs value={tab} onChange={setTab} items={[
            { id: "patients", label: `Pacientes (${d.data.patients.length})` },
            { id: "companies", label: `Empresas (${d.data.companies?.length ?? 0})`, hidden: !d.data.companies },
          ]} />
          {tab === "patients" && (!d.data.patients.length ? <Empty>Ningún paciente tiene saldo pendiente a esa fecha.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
              <table className="table cards-sm ag-cards">
                <thead><tr><th>Paciente</th>{BUCKETS.map((k) => <th key={k} className="num">{BUCKET_LABELS[k]}</th>)}<th className="num">Saldo</th></tr></thead>
                <tbody>{d.data.patients.map((p: any) => (
                  <tr key={p.patientId}><td><span><Link to={`/pacientes/${p.patientId}`}>{p.name}</Link></span></td>{cells(p)}<td className="num"><b>{bs(p.totalCents)}</b></td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          {tab === "companies" && d.data.companies && (!d.data.companies.length ? <Empty>Ninguna empresa tiene saldo pendiente a esa fecha.</Empty> : (
            <div className="table-wrap">
              <table className="table cards-sm ag-cards">
                <thead><tr><th>Empresa</th>{BUCKETS.map((k) => <th key={k} className="num">{BUCKET_LABELS[k]}</th>)}<th className="num">Saldo</th></tr></thead>
                <tbody>{d.data.companies.map((x: any) => (
                  <tr key={x.agreementId}><td><span><b>{x.name}</b><span className="muted small">&nbsp;· {x.charges} cargos</span></span></td>{cells(x)}<td className="num"><b>{bs(x.totalCents)}</b></td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <p className="muted small" style={{ margin: 0 }}>La antigüedad se cuenta desde la fecha del tratamiento (o del traslado al paciente). Los pagos del paciente se aplican a lo más antiguo; los pagos por verificar no descuentan hasta confirmarse.</p>
        </div>
      )}
    </div>
  );
}
