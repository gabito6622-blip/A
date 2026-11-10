// Honorarios: liquidaciones por profesional (borrador → cerrada), reglas y resultado por sucursal.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Lock, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDate, fmtDateTime, localDate, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, Tabs, useToast } from "../components/ui";
import "./cash-fees.css";

const d = (iso: string) => fmtDate(iso + "T12:00:00Z");
const period = (s: { periodStart: string; periodEnd: string }) => `${d(s.periodStart)} – ${d(s.periodEnd)}`;
const KIND: Record<string, string> = { production: "Tratamiento", collected: "Cobro", adjustment: "Ajuste" };
const BASE_SHORT: Record<string, string> = { production: "Producción", collected: "Cobrado" };

function previousMonth() {
  const [y, m] = localDate().split("-").map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return { from: `${py}-${String(pm).padStart(2, "0")}-01`, to: new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10) };
}

export function ruleText(r: { category: string | null; mode: string; percentBp: number | null; fixedCents: number | null; deductCents: number }) {
  const v = r.mode === "percent" ? `${((r.percentBp ?? 0) / 100).toLocaleString("es-BO")} %` : `${bs(r.fixedCents)} por unidad`;
  return `${r.category ?? "General"}: ${v}${r.deductCents ? ` (descontando ${bs(r.deductCents)} de laboratorio y materiales)` : ""}`;
}

export function FeesPage() {
  const { can, me } = useAuth();
  const manager = can("reports.financial") && !!me?.membership?.allBranches;
  const [tab, setTab] = useState<"settlements" | "rules" | "branches">("settlements");
  return (
    <div className="stack cf" style={{ gap: 18 }}>
      <div className="page-head">
        <div><h1>Honorarios</h1><p className="sub">{manager ? "Liquidación por profesional, reglas y resultado por sucursal" : "Mis liquidaciones cerradas"}</p></div>
      </div>
      {manager ? (
        <>
          <Tabs value={tab} onChange={setTab} items={[{ id: "settlements", label: "Liquidaciones" }, { id: "rules", label: "Reglas" }, { id: "branches", label: "Resultado por sucursal" }]} />
          {tab === "settlements" && <SettlementsTab />}
          {tab === "rules" && <RulesTab />}
          {tab === "branches" && <BranchResultsTab />}
        </>
      ) : can("treatments.perform") ? <MySettlements /> : can("reports.financial") ? <Empty>Los honorarios se gestionan con acceso a todas las sucursales.</Empty> : <Empty>Tu rol no tiene acceso a honorarios.</Empty>}
    </div>
  );
}

function MySettlements() {
  const list = useApi<any[]>("/api/fees/mine");
  if (!list.data) return <Loading />;
  if (!list.data.length) return <Empty>Aún no tienes liquidaciones cerradas. Cuando administración cierre un período, aparecerá aquí con el detalle de cada tratamiento o cobro.</Empty>;
  return (
    <div className="card"><div className="table-wrap"><table className="table">
      <thead><tr><th>Período</th><th className="hide-mobile">Base</th><th className="num">Honorarios</th><th className="num">Ajustes</th><th className="num">Total</th></tr></thead>
      <tbody>{list.data.map((s) => (
        <tr key={s.id}><td><Link to={`/honorarios/${s.id}`}>{period(s)}</Link></td><td className="hide-mobile">{BASE_SHORT[s.base]}</td>
          <td className="num">{bs(s.feeTotalCents)}</td><td className="num">{s.adjustmentsCents ? bs(s.adjustmentsCents) : "—"}</td><td className="num"><b>{bs(s.totalCents)}</b></td></tr>))}
      </tbody></table></div></div>
  );
}

function SettlementsTab() {
  const toast = useToast();
  const [range, setRange] = useState(previousMonth);
  const list = useApi<any[]>(`/api/fees/settlements${qs(range)}`);
  const cfg = useApi<any>("/api/fees/config");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bulk = async () => {
    setErr(null);
    if (range.to < range.from) return setErr("La fecha final debe ser igual o posterior a la inicial");
    setBusy(true);
    try {
      const r = await api.post("/api/fees/settlements/bulk", { periodStart: range.from, periodEnd: range.to });
      toast(r.created ? `${r.created} borrador(es) preparados` : "Todos los profesionales ya tienen una liquidación en ese período");
      list.reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const missing = (cfg.data?.professionals ?? []).filter((p: any) => !p.base);
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Desde"><input className="input" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
          <button className="btn btn-primary" disabled={busy} onClick={bulk}><Plus size={16} />Preparar borradores del período</button>
        </div>
        {err && <div className="alert danger" role="alert">{err}</div>}
        <p className="muted small" style={{ margin: 0 }}>El borrador se recalcula con cada cambio hasta que administración lo cierra. Una liquidación cerrada no cambia: si luego se anula un tratamiento o un cobro ya liquidado, el ajuste aparece en la siguiente.</p>
        {missing.length > 0 && <div className="alert warn">Sin regla de honorarios (no se liquidan): {missing.map((p: any) => p.dentistName).join(", ")}. Configúrala en la pestaña «Reglas».</div>}
      </div>
      <div className="card">
        {!list.data ? <Loading /> : list.data.length === 0 ? <Empty>No hay liquidaciones en este período. Usa «Preparar borradores del período».</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Profesional</th><th className="hide-mobile">Período</th><th className="hide-mobile">Base</th><th>Estado</th><th className="num hide-mobile">Base total</th><th className="num">Honorarios</th><th className="num hide-mobile">Ajustes</th><th className="num">Total</th></tr></thead>
            <tbody>{list.data.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/honorarios/${s.id}`}><b>{s.dentistName}</b></Link></td>
                <td className="hide-mobile nowrap">{period(s)}</td>
                <td className="hide-mobile">{s.base ? BASE_SHORT[s.base] : "—"}</td>
                <td>{s.status === "closed" ? <span className="badge ok"><Lock size={12} />Cerrada</span> : <span className="badge info">Borrador</span>}</td>
                <td className="num hide-mobile">{bs(s.baseTotalCents)}</td>
                <td className="num">{bs(s.feeTotalCents)}</td>
                <td className="num hide-mobile">{s.adjustmentsCents ? bs(s.adjustmentsCents) : "—"}</td>
                <td className="num"><b>{bs(s.totalCents)}</b></td>
              </tr>))}
            </tbody></table></div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Reglas
function RulesTab() {
  const { can } = useAuth();
  const cfg = useApi<any>("/api/fees/config");
  const [editing, setEditing] = useState<any>(null);
  if (!cfg.data) return <Loading />;
  return (
    <div className="card">
      <div className="card-pad" style={{ paddingBottom: 0 }}>
        <p className="muted small" style={{ margin: 0 }}>
          <b>Producción:</b> tratamientos que el profesional marcó como realizados. <b>Cobrado:</b> pagos confirmados de presupuestos a su nombre, repartidos entre las categorías del presupuesto según sus montos.
          Los cobros sin presupuesto no se asignan a nadie y se muestran aparte en cada liquidación.
        </p>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Profesional</th><th>Base</th><th>Reglas</th>{can("staff.manage") && <th />}</tr></thead>
        <tbody>{cfg.data.professionals.map((p: any) => (
          <tr key={p.dentistId}>
            <td><b>{p.dentistName}</b></td>
            <td>{p.base ? BASE_SHORT[p.base] : <span className="badge warn">Sin regla</span>}</td>
            <td className="small">{p.rules.length ? p.rules.map((r: any) => <div key={r.category ?? "_"}>{ruleText(r)}</div>) : <span className="muted">{p.commissionPct != null ? `Comisión de referencia: ${p.commissionPct} %` : "—"}</span>}</td>
            {can("staff.manage") && <td><button className="btn btn-sm" onClick={() => setEditing(p)}><Pencil size={14} />Editar</button></td>}
          </tr>))}
        </tbody></table></div>
      {editing && <RuleDialog pro={editing} categories={cfg.data.categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); cfg.reload(); }} />}
    </div>
  );
}

interface RuleForm { category: string | null; mode: "percent" | "fixed"; value: string; deduct: string }

function RuleDialog({ pro, categories, onClose, onSaved }: { pro: any; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const init: RuleForm[] = pro.rules.length
    ? pro.rules.map((r: any) => ({ category: r.category, mode: r.mode, value: r.mode === "percent" ? String(r.percentBp / 100).replace(".", ",") : toBsInput(r.fixedCents).replace(".", ","), deduct: r.deductCents ? toBsInput(r.deductCents).replace(".", ",") : "" }))
    : [{ category: null, mode: "percent", value: pro.commissionPct != null ? String(pro.commissionPct).replace(".", ",") : "", deduct: "" }];
  const [base, setBase] = useState<"production" | "collected">(pro.base ?? "production");
  const [rules, setRules] = useState<RuleForm[]>(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, p: Partial<RuleForm>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const num = (s: string) => Number(s.replace(",", "."));
  const save = async () => {
    const e: Record<string, string> = {};
    rules.forEach((r, i) => {
      if (i > 0 && !r.category) e[`${i}.category`] = "Elige la categoría";
      if (r.mode === "percent" && (!/^\d{1,3}([.,]\d{1,2})?$/.test(r.value) || num(r.value) > 100)) e[`${i}.value`] = "Porcentaje de 0 a 100 (hasta 2 decimales)";
      if (r.mode === "fixed" && !/^\d{1,7}([.,]\d{1,2})?$/.test(r.value)) e[`${i}.value`] = "Monto en Bs, por ejemplo 150 o 150,50";
      if (r.mode === "fixed" && base === "collected") e[`${i}.mode`] = "Con base «cobrado» solo se usan porcentajes";
      if (r.deduct && (!/^\d{1,7}([.,]\d{1,2})?$/.test(r.deduct))) e[`${i}.deduct`] = "Monto en Bs";
    });
    const cats = rules.slice(1).map((r) => r.category);
    cats.forEach((c, k) => { if (c && cats.indexOf(c) !== k) e[`${k + 1}.category`] = "Categoría repetida"; });
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      await api.put(`/api/fees/config/${pro.dentistId}`, {
        base,
        rules: rules.map((r, i) => ({
          category: i === 0 ? null : r.category, mode: r.mode,
          percent: r.mode === "percent" ? num(r.value) : null, fixedCents: r.mode === "fixed" ? parseBs(r.value) : null,
          deductCents: base === "production" && r.deduct ? parseBs(r.deduct) : 0,
        })),
      });
      toast("Reglas guardadas");
      onSaved();
    } catch (x: any) {
      if (x.details?.index != null) setErrs({ [`${x.details.index}.${x.details.field}`]: x.message }); else setErr(x.message);
    } finally { setBusy(false); }
  };
  const E = ({ k }: { k: string }) => (errs[k] ? <span className="cf-err" role="alert">{errs[k]}</span> : null);
  return (
    <Dialog wide title={`Honorarios de ${pro.dentistName}`} onClose={onClose}
      footer={<div className="cf row"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar reglas"}</button></div>}>
      <div className="stack cf">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Base de cálculo" group hint={base === "production" ? "Se paga sobre los tratamientos que realizó en el período." : "Se paga sobre lo cobrado (confirmado) de sus presupuestos en el período."}>
          <div className="cf-seg">
            <button type="button" aria-pressed={base === "production"} onClick={() => setBase("production")}>Producción</button>
            <button type="button" aria-pressed={base === "collected"} onClick={() => setBase("collected")}>Cobrado</button>
          </div>
        </Field>
        <div>
          {rules.map((r, i) => (
            <div key={i} className="cf-rule-row" role="group" aria-label={i === 0 ? "Regla general" : `Excepción ${i}`}>
              <div className="field">
                {i === 0 ? <><span className="label">Aplica a</span><div style={{ minHeight: 40, display: "flex", alignItems: "center" }}><b>Todas (regla general)</b></div></> : (
                  <label style={{ display: "contents" }}><span className="label">Categoría</span>
                    <select className="input" value={r.category ?? ""} aria-invalid={!!errs[`${i}.category`]} onChange={(e) => upd(i, { category: e.target.value || null })}>
                      <option value="">Elige…</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select></label>
                )}
                <E k={`${i}.category`} />
              </div>
              <div className="field"><label style={{ display: "contents" }}><span className="label">Tipo</span>
                <select className="input" value={r.mode} aria-invalid={!!errs[`${i}.mode`]} onChange={(e) => upd(i, { mode: e.target.value as RuleForm["mode"] })}>
                  <option value="percent">Porcentaje</option><option value="fixed" disabled={base === "collected"}>Monto fijo por unidad</option>
                </select></label><E k={`${i}.mode`} /></div>
              <div className="field"><label style={{ display: "contents" }}><span className="label">{r.mode === "percent" ? "Porcentaje (%)" : "Monto (Bs)"}</span>
                <input className="input" inputMode="decimal" value={r.value} aria-invalid={!!errs[`${i}.value`]} onChange={(e) => upd(i, { value: e.target.value })} /></label><E k={`${i}.value`} /></div>
              <div className="field"><label style={{ display: "contents" }}><span className="label">Lab. y materiales (Bs)</span>
                <input className="input" inputMode="decimal" value={base === "production" && r.mode === "percent" ? r.deduct : ""} disabled={base !== "production" || r.mode !== "percent"} placeholder="0" aria-invalid={!!errs[`${i}.deduct`]} onChange={(e) => upd(i, { deduct: e.target.value })} /></label><E k={`${i}.deduct`} /></div>
              <div>{i > 0 && <button className="btn btn-ghost btn-icon" aria-label={`Quitar excepción ${i}`} onClick={() => setRules(rules.filter((_, k) => k !== i))}><Trash2 size={16} /></button>}</div>
            </div>
          ))}
        </div>
        <div><button className="btn" onClick={() => setRules([...rules, { category: null, mode: "percent", value: "", deduct: "" }])}><Plus size={16} />Agregar excepción por categoría</button></div>
        <p className="muted small" style={{ margin: 0 }}>El descuento de laboratorio y materiales se resta por unidad antes de aplicar el porcentaje. Los cambios no afectan las liquidaciones ya cerradas.</p>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Resultado por sucursal
function BranchResultsTab() {
  const [range, setRange] = useState(previousMonth);
  const r = useApi<any>(`/api/fees/branch-results${qs(range)}`);
  const rows: [string, string, boolean?][] = [
    ["collectedCents", "Cobrado (confirmado)"], ["pendingVerificationCents", "Por verificar en el banco"], ["productionCents", "Producción"],
    ["feesCents", "Honorarios liquidados"], ["pettyExpensesCents", "Gastos menores de caja"], ["resultCents", "Resultado (cobrado − honorarios − gastos)", true],
  ];
  const v = (p: number | null) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p.toLocaleString("es-BO")} %`);
  return (
    <div className="stack">
      <div className="card card-pad row" style={{ alignItems: "flex-end" }}>
        <Field label="Desde"><input className="input" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="Hasta"><input className="input" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
      </div>
      {!r.data ? <Loading /> : (
        <>
          <div className="card">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Concepto</th>{r.data.branches.map((b: any) => <th key={b.branchId} className="num">{b.branchName}</th>)}<th className="num">Consolidado</th></tr></thead>
              <tbody>{rows.map(([k, label, strong]) => (
                <tr key={k} style={strong ? { fontWeight: 700 } : undefined}>
                  <td className="nowrap">{label}</td>
                  {r.data.branches.map((b: any) => <td key={b.branchId} className="num nowrap">{bs(b[k])}</td>)}
                  <td className="num nowrap"><b>{bs(r.data.total[k])}</b></td>
                </tr>))}
              </tbody>
            </table></div>
          </div>
          <div className="grid grid-3">
            <div className="card kpi"><div className="label">Cobrado vs. período anterior</div><div className="value">{v(r.data.variationPct.collected)}</div><div className="foot">Antes: {bs(r.data.previousTotal.collectedCents)} ({d(r.data.previousRange.from)} – {d(r.data.previousRange.to)})</div></div>
            <div className="card kpi"><div className="label">Producción vs. período anterior</div><div className="value">{v(r.data.variationPct.production)}</div><div className="foot">Antes: {bs(r.data.previousTotal.productionCents)}</div></div>
            <div className="card kpi"><div className="label">Resultado vs. período anterior</div><div className="value">{v(r.data.variationPct.result)}</div><div className="foot">Antes: {bs(r.data.previousTotal.resultCents)}</div></div>
          </div>
          <p className="muted small">Honorarios: solo de liquidaciones <b>cerradas</b> cuyo período cae dentro de las fechas ({r.data.closedSettlements} en este rango). Gastos: por ahora solo los gastos menores registrados en caja; los demás gastos de la clínica todavía no se registran en el sistema.</p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Detalle / impresión
export function FeeSettlementPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const manager = can("reports.financial") && !!me?.membership?.allBranches;
  const base = manager ? `/api/fees/settlements/${id}` : `/api/fees/mine/${id}`;
  const r = useApi<any>(base);
  const [closing, setClosing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = r.data;
  if (r.error) return <div className="cf stack"><Link to="/honorarios" className="btn btn-ghost no-print"><ArrowLeft size={16} />Volver</Link><Empty>{r.error}</Empty></div>;
  if (!s) return <Loading rows={8} />;
  const close = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/api/fees/settlements/${id}/close`, { note: note.trim() || null }); toast("Liquidación cerrada"); setClosing(false); r.reload(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const discard = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/api/fees/settlements/${id}/discard`); toast("Borrador descartado"); navigate("/honorarios"); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  const regular = s.lines.filter((l: any) => l.kind !== "adjustment");
  const adjustments = s.lines.filter((l: any) => l.kind === "adjustment");
  const rule = (l: any) => (l.mode === "percent" ? `${(l.percentBp / 100).toLocaleString("es-BO")} %` : l.mode === "fixed" ? `${bs(l.fixedCents)} c/u` : "—");
  return (
    <div className="stack cf">
      <div className="page-head">
        <div>
          <h1>Liquidación de honorarios</h1>
          <p className="sub"><b>{s.dentistName}</b>{s.license && <> · Mat. {s.license}</>} · {period(s)} · base {BASE_SHORT[s.base]?.toLowerCase()}</p>
        </div>
        <div className="row no-print">
          <Link to="/honorarios" className="btn btn-ghost"><ArrowLeft size={16} />Volver</Link>
          <a className="btn" href={`${base}/export.xlsx`}><Download size={16} />Excel</a>
          <button className="btn" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
          {s.status === "draft" && manager && <button className="btn btn-danger" onClick={() => setDiscarding(true)}><Trash2 size={16} />Descartar</button>}
          {s.status === "draft" && s.canClose && <button className="btn btn-primary" onClick={() => setClosing(true)}><Lock size={16} />Cerrar liquidación</button>}
        </div>
      </div>
      {s.status === "closed"
        ? <div className="alert ok">Cerrada el {fmtDateTime(s.closedAt)} por {s.closedByName}. Este documento ya no cambia; cualquier anulación posterior se ajusta en la siguiente liquidación.{s.note && <> Nota: {s.note}</>}</div>
        : <div className="alert info">Borrador: los montos se recalculan hasta que administración cierre la liquidación.</div>}
      {s.unassigned && s.unassigned.count > 0 && <div className="alert warn">En el período hay {s.unassigned.count} cobro(s) sin presupuesto por {bs(s.unassigned.cents)}. No se atribuyen a ningún profesional; si corresponden a este, deben registrarse vinculados a su presupuesto.</div>}
      <div className="grid grid-4">
        <div className="card kpi"><div className="label">{s.base === "collected" ? "Cobrado (base)" : "Producción (base)"}</div><div className="value">{bs(s.baseTotalCents)}</div></div>
        <div className="card kpi"><div className="label">Honorarios del período</div><div className="value">{bs(s.feeTotalCents)}</div></div>
        <div className="card kpi"><div className="label">Ajustes de períodos anteriores</div><div className="value">{bs(s.adjustmentsCents)}</div></div>
        <div className="card kpi"><div className="label">Total a pagar</div><div className="value">{bs(s.totalCents)}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h2 style={{ margin: 0 }}>{s.base === "collected" ? "Cobros liquidados" : "Tratamientos liquidados"}</h2><span className="badge">{regular.length}</span></div>
        {regular.length === 0 ? <Empty>Sin {s.base === "collected" ? "cobros" : "tratamientos"} en el período.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th className="hide-mobile">Fecha</th><th className="hide-mobile">Sucursal</th><th className="hide-mobile">Paciente</th><th>Detalle</th><th className="num">Base</th><th className="num hide-mobile">Lab./mat.</th><th className="num hide-mobile">Regla</th><th className="num">Honorario</th></tr></thead>
            <tbody>{regular.map((l: any, i: number) => (
              <tr key={l.id ?? i}>
                <td className="nowrap hide-mobile">{fmtDate(l.occurredAt)}</td><td className="hide-mobile">{l.branchName}</td><td className="hide-mobile">{l.patientName}</td>
                <td>{l.description}{l.quantity > 1 && <> × {l.quantity}</>}<div className="muted small"><span className="cf-only-mobile">{fmtDate(l.occurredAt)} · </span>{l.category ?? "General"}</div></td>
                <td className="num">{bs(l.baseCents)}</td><td className="num hide-mobile">{l.deductCents ? bs(l.deductCents) : "—"}</td><td className="num hide-mobile">{rule(l)}</td><td className="num"><b>{bs(l.feeCents)}</b></td>
              </tr>))}
            </tbody>
            <tfoot><tr><td className="hide-mobile">Total</td><td className="hide-mobile" /><td className="hide-mobile" /><td><span className="cf-only-mobile">Total</span></td><td className="num">{bs(s.baseTotalCents)}</td><td className="hide-mobile" /><td className="hide-mobile" /><td className="num">{bs(s.feeTotalCents)}</td></tr></tfoot>
          </table></div>
        )}
      </div>
      {adjustments.length > 0 && (
        <div className="card">
          <div className="card-head"><h2 style={{ margin: 0 }}>Ajustes por anulaciones posteriores</h2></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Detalle</th><th className="num">Honorario</th></tr></thead>
            <tbody>{adjustments.map((l: any, i: number) => <tr key={l.id ?? i}><td className="nowrap">{fmtDate(l.occurredAt)}</td><td>{l.description}{l.patientName && <div className="muted small">{l.patientName}</div>}</td><td className="num"><b>{bs(l.feeCents)}</b></td></tr>)}</tbody>
          </table></div>
        </div>
      )}
      {s.rulesSnapshot?.rules && (
        <div className="card card-pad small"><b>Reglas aplicadas:</b> {s.rulesSnapshot.rules.map((x: any) => ruleText(x)).join(" · ")}</div>
      )}
      <div className="cf-sign" aria-hidden="true"><div>Firma de {s.dentistName}</div><div>Firma de administración</div></div>

      {closing && (
        <Dialog title="Cerrar liquidación" onClose={() => setClosing(false)}
          footer={<div className="cf row"><button className="btn" onClick={() => setClosing(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={close}>{busy ? "Cerrando…" : `Cerrar por ${bs(s.totalCents)}`}</button></div>}>
          <div className="stack cf">
            <p style={{ margin: 0 }}>Se guardará una copia fija de las {s.lines.length} líneas con las reglas actuales. Después no se puede modificar; las anulaciones posteriores se ajustan en la siguiente liquidación.</p>
            {err && <div className="alert danger" role="alert">{err}</div>}
            <Field label="Nota (opcional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: pagado por transferencia el 05/11" /></Field>
          </div>
        </Dialog>
      )}
      {discarding && (
        <Dialog title="Descartar borrador" onClose={() => setDiscarding(false)}
          footer={<div className="cf row"><button className="btn" onClick={() => setDiscarding(false)}>Cancelar</button><button className="btn btn-danger" disabled={busy} onClick={discard}>Descartar</button></div>}>
          <div className="stack cf">
            <p style={{ margin: 0 }}>El borrador se elimina; los tratamientos y cobros quedan disponibles para una nueva liquidación del período.</p>
            {err && <div className="alert danger" role="alert">{err}</div>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
