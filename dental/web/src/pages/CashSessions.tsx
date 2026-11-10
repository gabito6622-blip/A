// Caja por cajero: "Mi caja" (abrir, movimientos, cerrar con arqueo), historial y reporte imprimible.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calculator, ClipboardCheck, LockOpen, Plus, Printer } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { addDays, bs, fmtDateTime, fmtTime, localDate, parseBs } from "../lib/format";
import { Dialog, Empty, Field, Loading, StatusBadge, useToast } from "../components/ui";
import "./cash-fees.css";

const DENOMS: { cents: number; label: string; kind: "bill" | "coin" }[] = [
  { cents: 20000, label: "Bs 200", kind: "bill" }, { cents: 10000, label: "Bs 100", kind: "bill" }, { cents: 5000, label: "Bs 50", kind: "bill" },
  { cents: 2000, label: "Bs 20", kind: "bill" }, { cents: 1000, label: "Bs 10", kind: "bill" }, { cents: 500, label: "Bs 5", kind: "coin" },
  { cents: 200, label: "Bs 2", kind: "coin" }, { cents: 100, label: "Bs 1", kind: "coin" }, { cents: 50, label: "50 ctvs", kind: "coin" },
  { cents: 20, label: "20 ctvs", kind: "coin" }, { cents: 10, label: "10 ctvs", kind: "coin" },
];
const MOVE_CATS: Record<string, string> = {
  change: "Cambio / sencillo", petty_expense: "Gasto menor", deposit: "Depósito o entrega a gerencia", refund: "Devolución a paciente", other: "Otro",
};
const PAY_STATUS: Record<string, string> = { confirmed: "Confirmado", pending_verification: "Por verificar", rejected: "Rechazado", voided: "Anulado" };

/** Diferencia con color y texto (no depende solo del color). */
export function Diff({ cents }: { cents: number | null | undefined }) {
  if (cents == null) return <span className="muted">—</span>;
  if (cents === 0) return <span className="cf-diff zero">Cuadra</span>;
  return <span className={`cf-diff ${cents < 0 ? "short" : "over"}`}>{cents < 0 ? "Faltante" : "Sobrante"} {bs(Math.abs(cents))}</span>;
}

const validAmount = (s: string) => /^\d{1,7}([.,]\d{1,2})?$/.test(s.trim());

// ------------------------------------------------------------------ Mi caja
export function MyCashPanel({ onChanged }: { onChanged?: () => void }) {
  const { me, branchId, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const myBranches = me?.branches ?? [];
  const [branch, setBranch] = useState<string>(branchId ?? (myBranches.length === 1 ? myBranches[0]!.id : ""));
  useEffect(() => { if (branchId) setBranch(branchId); }, [branchId]);
  const cur = useApi<any>(can("payments.create") && branch ? `/api/cash-sessions/current${qs({ branchId: branch })}` : null);
  const [float, setFloat] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [closing, setClosing] = useState(false);
  if (!can("payments.create")) return null;
  const s = cur.data?.session;
  const refresh = () => { cur.reload(); onChanged?.(); };

  const open = async () => {
    setErr(null);
    if (!validAmount(float || "0")) return setErr("Escribe el fondo inicial en Bs, por ejemplo 200 o 150,50");
    setBusy(true);
    try {
      await api.post("/api/cash-sessions", { branchId: branch, openingFloatCents: parseBs(float || "0"), note: note || null });
      toast("Caja abierta");
      setFloat(""); setNote("");
      refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card cf" aria-labelledby="mi-caja-title">
      <div className="card-head">
        <h2 id="mi-caja-title" className="row" style={{ margin: 0 }}><Calculator size={18} />Mi caja</h2>
        {s ? <span className="badge ok">Abierta · N° {s.number} desde {fmtTime(s.openedAt)}</span> : branch && cur.data && <span className="badge">Cerrada</span>}
      </div>
      <div className="card-pad stack">
        {!branchId && myBranches.length > 1 && (
          <Field label="Sucursal de mi caja">
            <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Elige la sucursal…</option>
              {myBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        {!branch ? <p className="muted">Elige la sucursal donde estás cobrando.</p> : !cur.data ? <Loading rows={2} /> : !s ? (
          <>
            {cur.data.requireCashSession
              ? <div className="alert info">Para cobrar en efectivo primero abre tu caja con el cambio que recibiste.</div>
              : <p className="muted small">Abrir caja es opcional en tu clínica, pero te permite cuadrar el efectivo al final del día.</p>}
            <div className="form-grid">
              <Field label="Fondo inicial (Bs)" hint="El cambio con el que empiezas el día">
                <input className="input" inputMode="decimal" placeholder="0,00" value={float} aria-invalid={!!err} onChange={(e) => setFloat(e.target.value)} />
              </Field>
              <Field label="Nota (opcional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: cambio entregado por gerencia" /></Field>
            </div>
            {err && <div className="alert danger" role="alert">{err}</div>}
            <div><button className="btn btn-primary" disabled={busy} onClick={open}><LockOpen size={16} />{busy ? "Abriendo…" : "Abrir caja"}</button></div>
          </>
        ) : (
          <>
            <div className="cf-totals" aria-label="Resumen de mi caja">
              <div><span className="label">Fondo inicial</span><b>{bs(s.totals.floatCents)}</b></div>
              <div><span className="label">Efectivo cobrado</span><b>{bs(s.totals.cashInCents - s.totals.voidedCents)}</b></div>
              <div><span className="label">Debe haber en caja</span><b>{bs(s.totals.expectedCents)}</b></div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Ingresos {bs(s.totals.movementsInCents)} · Egresos {bs(s.totals.movementsOutCents)}
              {s.totals.voidedCents > 0 && <> · Cobros anulados {bs(s.totals.voidedCents)}</>}
              {s.others.length > 0 && <> · Otros medios (no van al arqueo): {bs(s.others.reduce((a: number, p: any) => a + Number(p.amountCents), 0))}</>}
            </p>
            <div className="row">
              <button className="btn" onClick={() => setMoving(true)}><Plus size={16} />Ingreso o egreso</button>
              <button className="btn btn-primary" onClick={() => setClosing(true)}><Calculator size={16} />Cerrar caja (arqueo)</button>
              <Link className="btn btn-ghost" to={`/caja/sesiones/${s.id}`}>Ver detalle</Link>
            </div>
            {s.movements.length > 0 && (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Hora</th><th>Movimiento</th><th className="num">Monto</th></tr></thead>
                <tbody>{s.movements.map((m: any) => (
                  <tr key={m.id}><td>{fmtTime(m.createdAt)}</td><td>{m.categoryLabel}<div className="muted small">{m.reason}</div></td>
                    <td className="num">{m.kind === "out" ? "−" : "+"}{bs(m.amountCents)}</td></tr>))}
                </tbody></table></div>
            )}
          </>
        )}
      </div>
      {moving && s && <MovementDialog sessionId={s.id} onClose={() => setMoving(false)} onSaved={() => { setMoving(false); refresh(); }} />}
      {closing && s && <CloseDialog session={s} onClose={() => setClosing(false)} onClosed={(id) => { setClosing(false); refresh(); navigate(`/caja/sesiones/${id}`); }} />}
    </div>
  );
}

function MovementDialog({ sessionId, onClose, onSaved }: { sessionId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: "out" as "in" | "out", category: "petty_expense", amount: "", reason: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!validAmount(f.amount) || parseBs(f.amount) <= 0) e.amount = "Escribe un monto mayor a cero";
    if (f.reason.trim().length < 3) e.reason = "Escribe el motivo (por ejemplo: compra de agua, cambio de billetes)";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/api/cash-sessions/${sessionId}/movements`, { kind: f.kind, category: f.category, amountCents: parseBs(f.amount), reason: f.reason.trim() });
      toast(f.kind === "in" ? "Ingreso registrado" : "Egreso registrado");
      onSaved();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Ingreso o egreso de efectivo" onClose={onClose}
      footer={<div className="cf row"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Registrar"}</button></div>}>
      <div className="stack cf">
        <p className="muted small" style={{ margin: 0 }}>Los movimientos no se editan ni se borran. Si te equivocas, registra el movimiento contrario con su motivo.</p>
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Tipo" group>
          <div className="cf-seg">
            <button type="button" aria-pressed={f.kind === "in"} onClick={() => setF({ ...f, kind: "in", category: f.category === "petty_expense" || f.category === "refund" ? "change" : f.category })}>Ingreso</button>
            <button type="button" aria-pressed={f.kind === "out"} onClick={() => setF({ ...f, kind: "out", category: f.category === "change" ? "petty_expense" : f.category })}>Egreso</button>
          </div>
        </Field>
        <div className="form-grid">
          <Field label="Concepto">
            <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {Object.entries(MOVE_CATS).filter(([k]) => f.kind === "in" ? !["petty_expense", "refund"].includes(k) : k !== "change").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Monto (Bs)">
            <input className="input" inputMode="decimal" value={f.amount} aria-invalid={!!errs.amount} aria-describedby={errs.amount ? "mv-amount-err" : undefined} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          {errs.amount && <span id="mv-amount-err" className="cf-err span-2">{errs.amount}</span>}
          <Field label="Motivo" span2>
            <textarea className="input" style={{ minHeight: 70 }} value={f.reason} aria-invalid={!!errs.reason} aria-describedby={errs.reason ? "mv-reason-err" : undefined} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          {errs.reason && <span id="mv-reason-err" className="cf-err span-2">{errs.reason}</span>}
        </div>
      </div>
    </Dialog>
  );
}

function CloseDialog({ session, onClose, onClosed }: { session: any; onClose: () => void; onClosed: (id: string) => void }) {
  const toast = useToast();
  const [q, setQ] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qty = (c: number) => { const v = q[c] ?? ""; return /^\d+$/.test(v) ? Number(v) : 0; };
  const counted = useMemo(() => DENOMS.reduce((s, d) => s + d.cents * qty(d.cents), 0), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const expected = Number(session.totals.expectedCents);
  const diff = counted - expected;
  const badQty = DENOMS.some((d) => (q[d.cents] ?? "") !== "" && !/^\d{1,5}$/.test(q[d.cents]!));
  const save = async () => {
    setErr(null); setNoteErr(null);
    if (badQty) return setErr("Revisa las cantidades: solo números enteros");
    if (diff !== 0 && note.trim().length < 5) { setNoteErr("Hay diferencia: explica el motivo (al menos 5 letras)"); return; }
    setBusy(true);
    try {
      await api.post(`/api/cash-sessions/${session.id}/close`, { counts: Object.fromEntries(DENOMS.map((d) => [String(d.cents), qty(d.cents)])), note: note.trim() || null });
      toast("Caja cerrada");
      onClosed(session.id);
    } catch (x: any) {
      if (x.code === "note_required") setNoteErr(x.message); else setErr(x.message);
    } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={`Cerrar caja N° ${session.number}`} onClose={onClose}
      footer={<div className="cf row"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Cerrando…" : "Cerrar caja"}</button></div>}>
      <div className="stack cf">
        <p className="muted small" style={{ margin: 0 }}>Cuenta los billetes y monedas que hay en la caja y anota cuántos hay de cada uno. Al cerrar, la caja ya no se puede modificar.</p>
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="cf-totals" aria-live="polite">
          <div><span className="label">Debe haber</span><b>{bs(expected)}</b></div>
          <div><span className="label">Contado</span><b>{bs(counted)}</b></div>
          <div><span className="label">Diferencia</span><b><Diff cents={diff} /></b></div>
        </div>
        <div className="table-wrap"><table className="table cf-count">
          <thead><tr><th>Denominación</th><th className="num">Cantidad</th><th className="num">Subtotal</th></tr></thead>
          <tbody>{DENOMS.map((d) => (
            <tr key={d.cents}>
              <td className="nowrap"><b>{d.label}</b> <span className="muted small hide-mobile">{d.kind === "bill" ? "billete" : "moneda"}</span></td>
              <td className="num"><input className="input" inputMode="numeric" aria-label={`Cantidad de ${d.kind === "bill" ? "billetes" : "monedas"} de ${d.label}`} value={q[d.cents] ?? ""}
                aria-invalid={(q[d.cents] ?? "") !== "" && !/^\d{1,5}$/.test(q[d.cents]!)} placeholder="0" onChange={(e) => setQ({ ...q, [d.cents]: e.target.value.trim() })} /></td>
              <td className="num">{bs(d.cents * qty(d.cents))}</td>
            </tr>))}
          </tbody>
        </table></div>
        <Field label={diff !== 0 ? "Motivo de la diferencia (obligatorio)" : "Nota de cierre (opcional)"}>
          <textarea className="input" style={{ minHeight: 70 }} value={note} aria-invalid={!!noteErr} aria-describedby={noteErr ? "close-note-err" : undefined} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {noteErr && <span id="close-note-err" className="cf-err" role="alert">{noteErr}</span>}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Historial
export function CashSessionsHistory() {
  const { can, branchId } = useAuth();
  const toast = useToast();
  const [range, setRange] = useState({ from: addDays(localDate(), -30), to: localDate() });
  const list = useApi<any[]>(can("payments.read") ? `/api/cash-sessions${qs({ branchId, from: range.from, to: range.to })}` : null);
  const settings = useApi<{ requireCashSession: boolean }>(can("clinic.manage") ? "/api/cash-sessions/settings" : null);
  const manager = can("payments.verify") || can("clinic.manage");
  const toggle = async (v: boolean) => {
    try { await api.put("/api/cash-sessions/settings", { requireCashSession: v }); settings.reload(); toast(v ? "Ahora se exige caja abierta para cobrar en efectivo" : "Ya no se exige caja abierta"); } catch (e: any) { toast(e.message, true); }
  };
  if (!can("payments.read")) return null;
  return (
    <div className="card cf">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{manager ? "Cierres de caja" : "Mis cierres de caja"}</h2>
        <div className="row">
          <Field label="Desde"><input className="input" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      </div>
      {!list.data ? <Loading /> : list.data.length === 0 ? <Empty>No hay cajas en estas fechas.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>N°</th><th>Apertura</th><th className="hide-mobile">Sucursal</th>{manager && <th>Cajero/a</th>}<th className="num hide-mobile">Esperado</th><th className="num hide-mobile">Contado</th><th>Diferencia</th><th className="hide-mobile">Revisión</th></tr></thead>
          <tbody>{list.data.map((s) => (
            <tr key={s.id}>
              <td className="nowrap"><Link to={`/caja/sesiones/${s.id}`}>N° {s.number}</Link></td>
              <td className="nowrap">{fmtDateTime(s.openedAt)}</td>
              <td className="hide-mobile">{s.branchName}</td>
              {manager && <td>{s.cashierName}</td>}
              <td className="num hide-mobile">{bs(s.status === "open" ? s.liveExpectedCents : s.expectedCents)}</td>
              <td className="num hide-mobile">{s.status === "open" ? "—" : bs(s.countedCents)}</td>
              <td className="nowrap">{s.status === "open" ? <StatusBadge status="confirmed" label="Abierta" /> : <Diff cents={s.differenceCents} />}</td>
              <td className="hide-mobile">{s.reviewedAt ? <span className="badge ok">Revisada</span> : s.status === "closed" ? <span className="badge">Pendiente</span> : "—"}</td>
            </tr>))}
          </tbody></table></div>
      )}
      {can("clinic.manage") && settings.data && (
        <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
          <label className="check"><input type="checkbox" checked={settings.data.requireCashSession} onChange={(e) => toggle(e.target.checked)} />Exigir caja abierta para registrar cobros en efectivo</label>
          <p className="muted small" style={{ margin: "4px 0 0 26px" }}>Transferencias, QR y tarjeta no necesitan caja; aparecen en el reporte de cierre solo como referencia.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Reporte imprimible
export function CashSessionReportPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const r = useApi<any>(`/api/cash-sessions/${id}`);
  const [reviewing, setReviewing] = useState(false);
  const s = r.data;
  if (r.error) return <div className="cf stack"><Link to="/caja" className="btn btn-ghost no-print"><ArrowLeft size={16} />Volver a Caja</Link><Empty>{r.error}</Empty></div>;
  if (!s) return <Loading rows={8} />;
  const t = s.totals;
  const canReview = can("payments.verify") && s.status === "closed" && !s.reviewedAt && (s.cashierId !== me?.user.id || me?.membership?.role === "owner");
  return (
    <div className="stack cf">
      <div className="page-head">
        <div>
          <h1>{s.status === "closed" ? "Cierre de caja" : "Caja abierta"} N° {s.number}</h1>
          <p className="sub">{s.branchName} · {s.cashierName} · abierta {fmtDateTime(s.openedAt)}{s.closedAt && <> · cerrada {fmtDateTime(s.closedAt)}{s.closedByName !== s.cashierName && <> por {s.closedByName}</>}</>}</p>
        </div>
        <div className="row no-print">
          <Link to="/caja" className="btn btn-ghost"><ArrowLeft size={16} />Volver</Link>
          <button className="btn" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
          {canReview && <button className="btn btn-primary" onClick={() => setReviewing(true)}><ClipboardCheck size={16} />Marcar revisada</button>}
        </div>
      </div>
      {s.status === "open" && <div className="alert info">Esta caja sigue abierta: los montos se actualizan con cada cobro y movimiento.</div>}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2 style={{ margin: 0 }}>Resumen</h2></div>
          <table className="table cf-ledger"><tbody>
            <tr><td>Fondo inicial</td><td className="num">{bs(t.floatCents)}</td></tr>
            <tr><td>+ Cobros en efectivo</td><td className="num">{bs(t.cashInCents)}</td></tr>
            <tr><td>− Cobros anulados</td><td className="num">{bs(t.voidedCents)}</td></tr>
            <tr><td>+ Ingresos manuales</td><td className="num">{bs(t.movementsInCents)}</td></tr>
            <tr><td>− Egresos manuales</td><td className="num">{bs(t.movementsOutCents)}</td></tr>
            <tr className="total"><td>= Debe haber en caja</td><td className="num">{bs(t.expectedCents)}</td></tr>
            {s.status === "closed" && <>
              <tr><td>Contado en el arqueo</td><td className="num">{bs(s.countedCents)}</td></tr>
              <tr className="total"><td>Diferencia</td><td className="num"><Diff cents={s.differenceCents} /></td></tr>
            </>}
          </tbody></table>
          {(s.closeNote || s.openingNote) && <div className="card-pad stack-sm">
            {s.openingNote && <span className="small"><b>Apertura:</b> {s.openingNote}</span>}
            {s.closeNote && <span className="small"><b>Nota de cierre:</b> {s.closeNote}</span>}
          </div>}
          {s.reviewedAt && <div className="card-pad"><div className="alert ok">Revisada por {s.reviewedByName} el {fmtDateTime(s.reviewedAt)}{s.reviewNote && <>: {s.reviewNote}</>}</div></div>}
        </div>
        <div className="card">
          <div className="card-head"><h2 style={{ margin: 0 }}>Arqueo</h2></div>
          {!s.count ? <Empty>Se completa al cerrar la caja.</Empty> : (
            <table className="table"><thead><tr><th>Denominación</th><th className="num">Cantidad</th><th className="num">Subtotal</th></tr></thead>
              <tbody>{s.count.filter((d: any) => d.quantity > 0).map((d: any) => <tr key={d.cents}><td>{d.label}</td><td className="num">{d.quantity}</td><td className="num">{bs(d.subtotalCents)}</td></tr>)}</tbody>
              <tfoot><tr><td>Total contado</td><td /><td className="num">{bs(s.countedCents)}</td></tr></tfoot>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2 style={{ margin: 0 }}>Cobros en efectivo</h2><span className="badge">{s.payments.length}</span></div>
        {s.payments.length === 0 ? <Empty>Sin cobros en efectivo.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Recibo</th><th>Hora</th><th>Paciente</th><th className="num">Monto</th><th>Estado</th></tr></thead>
            <tbody>{s.payments.map((p: any) => <tr key={p.id}><td>{p.receiptNumber}</td><td>{fmtTime(p.receivedAt)}</td><td>{p.patientName}</td><td className="num">{bs(p.amountCents)}</td>
              <td><StatusBadge status={p.status} label={PAY_STATUS[p.status]} />{p.statusReason && <div className="muted small">{p.statusReason}</div>}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2 style={{ margin: 0 }}>Movimientos manuales</h2></div>
          {s.movements.length === 0 ? <Empty>Sin ingresos ni egresos.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Hora</th><th>Concepto</th><th className="num">Monto</th></tr></thead>
              <tbody>{s.movements.map((m: any) => <tr key={m.id}><td>{fmtTime(m.createdAt)}</td><td>{m.categoryLabel}<div className="muted small">{m.reason} · {m.createdByName}</div></td>
                <td className="num">{m.kind === "out" ? "−" : "+"}{bs(m.amountCents)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2 style={{ margin: 0 }}>Otros medios (referencia)</h2></div>
          <div className="card-pad" style={{ paddingBottom: 0 }}><p className="muted small" style={{ margin: 0 }}>Transferencias, QR y tarjeta recibidos por {s.cashierName} en esta sucursal mientras la caja estuvo abierta. No forman parte del arqueo.</p></div>
          {s.others.length === 0 ? <Empty>Ninguno.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Recibo</th><th>Medio</th><th className="num">Monto</th><th>Estado</th></tr></thead>
              <tbody>{s.others.map((p: any) => <tr key={p.id}><td>{p.receiptNumber}</td><td>{p.methodLabel}<div className="muted small">Ref. {p.bankReference}</div></td><td className="num">{bs(p.amountCents)}</td>
                <td><StatusBadge status={p.status} label={PAY_STATUS[p.status]} /></td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
      <div className="cf-sign" aria-hidden="true"><div>Firma de {s.cashierName}</div><div>Firma de gerencia / contabilidad</div></div>
      {reviewing && <ReviewDialog session={s} onClose={() => setReviewing(false)} onSaved={() => { setReviewing(false); r.reload(); }} />}
    </div>
  );
}

function ReviewDialog({ session, onClose, onSaved }: { session: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null);
    if (session.differenceCents && note.trim().length < 3) return setErr("El cierre tiene diferencia: anota qué verificaste");
    setBusy(true);
    try { await api.post(`/api/cash-sessions/${session.id}/review`, { note: note.trim() || null }); toast("Cierre revisado"); onSaved(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Revisar cierre N° ${session.number}`} onClose={onClose}
      footer={<div className="cf row"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Marcar revisada</button></div>}>
      <div className="stack cf">
        <p style={{ margin: 0 }}>Diferencia del cierre: <Diff cents={session.differenceCents} /></p>
        <Field label={session.differenceCents ? "Qué se verificó (obligatorio)" : "Nota (opcional)"}>
          <textarea className="input" value={note} aria-invalid={!!err} aria-describedby={err ? "review-err" : undefined} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && <span id="review-err" className="cf-err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}
