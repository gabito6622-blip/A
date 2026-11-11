import { useEffect, useState } from "react";
import { LogIn, LogOut, Plus, XCircle } from "lucide-react";
import { useApi } from "../../lib/hooks";
import { api, qs } from "../../lib/api";
import { fmtDateTime, fmtTime, laPazISO, localDate } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "../ui";
import { ExportLink, MonthPicker, monthLabel, thisMonth } from "./shared";

const dur = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;

/** Botón grande de entrada/salida en Inicio (solo para quien tiene el fichaje activado). */
export function TimeClockCard() {
  const { can, branchId } = useAuth();
  const toast = useToast();
  const me = useApi<any>(can("timeclock.punch") ? "/api/timeclock/me" : null);
  const [branch, setBranch] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);
  const d = me.data;
  if (!d?.enabled) return null;
  const branches = d.branches as { id: string; name: string }[];
  const chosen = d.open?.branchId ?? (branch || (branchId && branches.some((b) => b.id === branchId) ? branchId : branches[0]?.id) || "");
  const punch = async (kind: "in" | "out") => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/timeclock/punch", { branchId: chosen, kind });
      me.setData(r);
      toast(kind === "in" ? "Entrada registrada" : "Salida registrada");
    } catch (e: any) { setErr(e.message); me.reload(); } finally { setBusy(false); }
  };
  const openMin = d.open ? Math.max(0, Math.floor((Date.now() - +new Date(d.open.at)) / 60_000)) : 0;
  return (
    <section className="card" aria-labelledby="mg-clock-title">
      <div className="card-head"><h2 id="mg-clock-title">Mi asistencia</h2><span className="muted small">Hoy: {dur(d.todayMinutes + openMin)}</span></div>
      <div className="card-pad mg-clock">
        <div className="mg-clock-state" role="status">
          <span className={`mg-clock-dot ${d.open ? "on" : ""}`} aria-hidden="true" />
          {d.open ? <span>Trabajando en {d.open.branchName} desde las {fmtTime(d.open.at)}</span> : <span>No marcaste entrada{d.todayEntries.length ? " (turno de hoy cerrado)" : " hoy"}</span>}
        </div>
        {!d.open && branches.length > 1 && (
          <Field label="Sucursal">
            <select className="input" value={chosen} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
        )}
        {err && <div className="alert danger" role="alert">{err}</div>}
        {d.open
          ? <button className="btn mg-punch" onClick={() => punch("out")} disabled={busy}><LogOut size={20} />Marcar salida</button>
          : <button className="btn btn-primary mg-punch" onClick={() => punch("in")} disabled={busy || !chosen}><LogIn size={20} />Marcar entrada</button>}
        {d.todayEntries.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Marcas de hoy: {d.todayEntries.map((e: any) => `${e.kind === "in" ? "entrada" : "salida"} ${fmtTime(e.at)}${e.voided ? " (anulada)" : ""}`).join(" · ")}
          </p>
        )}
        <p className="muted small" style={{ margin: 0 }}>Se guarda la hora del sistema, sin tu ubicación. Si te equivocas, pide a la gerencia que lo corrija.</p>
      </div>
    </section>
  );
}

function CorrectionDialog({ staff, initial, onClose, onSaved }: { staff: any[]; initial: { userId?: string; branchId?: string; kind?: string; date?: string } | null; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const [f, setF] = useState({
    userId: initial?.userId ?? staff[0]?.userId ?? "", branchId: initial?.branchId ?? branchId ?? me?.branches[0]?.id ?? "",
    kind: initial?.kind ?? "out", date: initial?.date ?? localDate(), time: "", reason: "",
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    const e: Record<string, string> = {};
    if (!/^\d{2}:\d{2}$/.test(f.time)) e.time = "Escribe la hora (HH:MM)";
    if (f.reason.trim().length < 5) e.reason = "Escribe el motivo (mínimo 5 caracteres)";
    setErrs(e); setMsg(null);
    if (Object.keys(e).length) return;
    try {
      await api.post("/api/timeclock/corrections", { userId: f.userId, branchId: f.branchId, kind: f.kind, at: laPazISO(f.date, f.time), reason: f.reason.trim() });
      onSaved();
    } catch (x: any) {
      const path = x.details?.[0]?.path;
      if (path === "at") setErrs({ time: x.details[0].message ?? x.message }); else if (path === "reason") setErrs({ reason: x.message }); else setMsg(x.message);
    }
  };
  const E = ({ k }: { k: string }) => (errs[k] ? <span className="hint" id={`tc-${k}`} style={{ color: "var(--danger)" }}>{errs[k]}</span> : null);
  return (
    <Dialog title="Agregar marca (corrección)" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar corrección</button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {msg && <div className="alert danger span-2" role="alert">{msg}</div>}
        <Field label="Persona"><select className="input" value={f.userId} onChange={(e) => set("userId", e.target.value)}>{staff.map((s) => <option key={s.userId} value={s.userId}>{s.fullName}</option>)}</select></Field>
        <Field label="Sucursal"><select className="input" value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Tipo"><select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="in">Entrada</option><option value="out">Salida</option></select></Field>
        <Field label="Fecha"><input className="input" type="date" value={f.date} max={localDate()} onChange={(e) => e.target.value && set("date", e.target.value)} /></Field>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Field label="Hora"><input className="input" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} aria-invalid={!!errs.time} aria-describedby={errs.time ? "tc-time" : undefined} /></Field><E k="time" />
        </div>
        <div className="span-2" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Field label="Motivo"><input className="input" value={f.reason} maxLength={300} placeholder="Ej.: olvidó marcar la salida" onChange={(e) => set("reason", e.target.value)} aria-invalid={!!errs.reason} aria-describedby={errs.reason ? "tc-reason" : undefined} /></Field><E k="reason" />
        </div>
        <p className="muted small span-2" style={{ margin: 0 }}>La corrección se agrega como un registro nuevo con tu nombre y el motivo; las marcas originales no se modifican.</p>
      </form>
    </Dialog>
  );
}

export function TimeClockAdminTab() {
  const { can, branchId } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const manage = can("staff.manage");
  const [month, setMonth] = useState(thisMonth);
  const [showEntries, setShowEntries] = useState(false);
  const [dlg, setDlg] = useState<any | null>(null);
  const filters = { month, branchId };
  const rep = useApi<any>(`/api/timeclock/report${qs(filters)}`);
  const entries = useApi<any>(showEntries ? `/api/timeclock/entries${qs(filters)}` : null);
  const staff = useApi<any[]>(manage ? "/api/timeclock/staff" : null);
  const reload = () => { rep.reload(); entries.reload(); staff.reload(); };
  const toggle = async (s: any, enabled: boolean) => {
    try { await api.put(`/api/timeclock/staff/${s.userId}`, { enabled }); toast(enabled ? `Fichaje activado para ${s.fullName}` : `Fichaje desactivado para ${s.fullName}`); staff.reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  const voidEntry = async (e: any) => {
    const reason = await ask({ title: "Anular marca", message: `${e.fullName} · ${e.kind === "in" ? "entrada" : "salida"} del ${fmtDateTime(e.at)}. La marca original se conserva y queda anulada.`,
      inputLabel: "Motivo", minLength: 5, confirmLabel: "Anular marca", danger: true });
    if (!reason) return;
    try { await api.post(`/api/timeclock/entries/${e.id}/void`, { reason }); toast("Marca anulada"); reload(); } catch (x: any) { toast(x.message, true); }
  };
  const d = rep.data;
  return (
    <div className="stack">
      <div className="card card-pad mg-toolbar">
        <MonthPicker value={month} onChange={setMonth} max={thisMonth()} />
        <div style={{ flex: 1 }} />
        <ExportLink href={`/api/timeclock/report.xlsx${qs(filters)}`} />
        {manage && staff.data && <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={() => setDlg({})}><Plus size={16} />Agregar marca</button>}
      </div>
      {!d ? <Loading /> : (
        <>
          <div className="grid grid-3">
            <div className="card kpi"><div className="label">Horas de {monthLabel(month)}</div><div className="value">{d.totals.hours.toLocaleString("es-BO")} h</div><div className="foot">{d.totals.shifts} turnos completos</div></div>
            <div className="card kpi"><div className="label">Personas</div><div className="value">{new Set(d.rows.map((r: any) => r.userId)).size}</div><div className="foot">con marcas en el mes</div></div>
            <div className="card kpi"><div className="label">Marcas por revisar</div><div className="value">{d.totals.issues}</div><div className="foot">Entradas sin salida y similares</div></div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Horas por persona y sucursal</h2><span className="muted small">Cada turno cuenta en el mes de su entrada</span></div>
            {d.rows.length === 0 ? <Empty>No hay marcas en este mes.</Empty> : (
              <div className="table-wrap">
                <table className="table mg-cards">
                  <thead><tr><th>Persona</th><th>Rol</th><th>Sucursal</th><th className="num">Días</th><th className="num">Turnos</th><th className="num">Horas</th><th className="num">Por revisar</th></tr></thead>
                  <tbody>{d.rows.map((r: any) => (
                    <tr key={`${r.userId}-${r.branchId}`}>
                      <td className="mg-head">{r.fullName}</td><td data-label="Rol">{r.roleLabel}</td><td data-label="Sucursal">{r.branchName}</td>
                      <td data-label="Días" className="num">{r.days}</td><td data-label="Turnos" className="num">{r.shifts}</td>
                      <td data-label="Horas" className="num"><b>{r.hours.toLocaleString("es-BO")}</b></td>
                      <td data-label="Por revisar" className="num">{r.issues ? <span className="badge warn">{r.issues}</span> : "—"}</td>
                    </tr>))}
                  </tbody>
                  <tfoot><tr><td className="mg-head">Total</td><td className="mg-empty-cell" /><td className="mg-empty-cell" /><td className="mg-empty-cell" /><td data-label="Turnos" className="num">{d.totals.shifts}</td><td data-label="Horas" className="num">{d.totals.hours.toLocaleString("es-BO")}</td><td data-label="Por revisar" className="num">{d.totals.issues}</td></tr></tfoot>
                </table>
              </div>
            )}
          </div>
          {(d.issues.length > 0 || d.openNow.length > 0) && (
            <div className="card">
              <div className="card-head"><h2>Por revisar</h2></div>
              <div className="card-pad stack-sm">
                {d.openNow.map((o: any) => <div key={`open-${o.userId}`} className="row-between"><span><b>{o.fullName}</b> · {o.branchName}</span><span className="badge ok">Trabajando desde {fmtTime(o.at)}</span></div>)}
                {d.issues.map((i: any) => (
                  <div key={i.entryId + i.type} className="row-between">
                    <span><b>{i.fullName}</b> · {i.branchName} · {fmtDateTime(i.at)}</span>
                    <span className="row" style={{ gap: 6 }}><span className="badge warn">{i.label}</span>
                      {manage && staff.data && i.type === "missing_out" && <button className="btn btn-sm" onClick={() => setDlg({ userId: i.userId, branchId: i.branchId, kind: "out", date: String(i.atLocal).slice(0, 10) })}>Agregar salida</button>}
                      {manage && staff.data && i.type === "missing_in" && <button className="btn btn-sm" onClick={() => setDlg({ userId: i.userId, branchId: i.branchId, kind: "in", date: String(i.atLocal).slice(0, 10) })}>Agregar entrada</button>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head"><h2>Marcas del mes</h2><button className="btn btn-sm" aria-expanded={showEntries} onClick={() => setShowEntries(!showEntries)}>{showEntries ? "Ocultar" : "Ver todas las marcas"}</button></div>
            {showEntries && (!entries.data ? <Loading rows={3} /> : entries.data.items.length === 0 ? <Empty>Sin marcas.</Empty> : (
              <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table className="table mg-cards">
                  <thead><tr><th>Persona</th><th>Marca</th><th>Sucursal</th><th>Origen</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>{entries.data.items.map((e: any) => (
                    <tr key={e.id}>
                      <td className="mg-head">{e.fullName}</td>
                      <td data-label="Marca" className="nowrap">{e.kind === "in" ? "Entrada" : "Salida"} · {fmtDateTime(e.at)}</td>
                      <td data-label="Sucursal">{e.branchName}</td>
                      <td data-label="Origen">{e.source === "self" ? "Desde su celular" : <>Gerencia ({e.recordedByName}): {e.reason}</>}</td>
                      <td data-label="Estado">{e.voidedById ? <span className="badge danger" title={e.voidReason}>Anulada: {e.voidReason}</span> : <span className="badge ok">Vigente</span>}</td>
                      <td data-label="Acciones">{manage && !e.voidedById && <button className="btn btn-ghost btn-icon" onClick={() => voidEntry(e)} aria-label={`Anular marca de ${e.fullName}`}><XCircle size={16} /></button>}</td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
      {manage && (
        <div className="card">
          <div className="card-head"><h2>Quién ficha</h2><span className="muted small">Activa el botón de entrada y salida en el Inicio de cada persona</span></div>
          {!staff.data ? <Loading rows={3} /> : (
            <div>{staff.data.map((s) => (
              <label key={s.userId} className="mg-switch check">
                <span><b>{s.fullName}</b> <span className="muted small">· {s.roleLabel}</span></span>
                <input type="checkbox" checked={s.enabled} onChange={(e) => toggle(s, e.target.checked)} aria-label={`Fichaje de ${s.fullName}`} />
              </label>))}
            </div>
          )}
        </div>
      )}
      {dlg && staff.data && <CorrectionDialog staff={staff.data} initial={dlg} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); toast("Corrección registrada"); reload(); }} />}
    </div>
  );
}
