// Convenios (empresas, colegios, asociaciones), cuentas por cobrar a empresas y «pendiente de facturar».
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileSpreadsheet, Plus, Trash2, Wallet, XCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, newKey, qs } from "../lib/api";
import { bs, fmtDate, localDate, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, StatusBadge, Tabs, useAsk, useToast } from "../components/ui";
import { PdfButton } from "../components/ClinicalDocuments";
import { fieldErrors, pctText, ymdText } from "../components/agreements/AgreementWidgets";
import "../components/agreements/agreements.css";

type Tab = "agreements" | "receivables" | "invoices";

export function AgreementsPage() {
  const { can, me } = useAuth();
  const allBranches = !!me?.membership?.allBranches || me?.membership?.role === "owner";
  const showAr = can("payments.read") && allBranches;
  const [tab, setTab] = useState<Tab>("agreements");
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Convenios</h1><p className="sub">Empresas, colegios y asociaciones: precios especiales, parte que paga la empresa y su cuenta.</p></div></div>
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: "agreements", label: "Convenios" },
        { id: "receivables", label: "Por cobrar a empresas", hidden: !showAr },
        { id: "invoices", label: "Pendiente de facturar", hidden: !can("payments.read") },
      ]} />
      {tab === "agreements" && <AgreementList />}
      {tab === "receivables" && showAr && <Receivables />}
      {tab === "invoices" && <InvoiceRequests />}
    </div>
  );
}

// ---------------- Convenios ----------------
function AgreementList() {
  const { can } = useAuth();
  const list = useApi<any[]>("/api/agreements");
  const [edit, setEdit] = useState<any | null>(null);
  const openOne = async (id: string) => setEdit(await api.get(`/api/agreements/${id}`));
  return (
    <div className="card">
      <div className="card-head"><h2>Convenios</h2>{can("clinic.manage") && <button className="btn btn-primary ag-tap" onClick={() => setEdit({})}><Plus size={16} />Nuevo convenio</button>}</div>
      {!list.data ? <Loading /> : !list.data.length ? <Empty>Todavía no hay convenios. Crea el primero con «Nuevo convenio».</Empty> : (
        <table className="table rt">
          <thead><tr><th>Convenio</th><th>NIT</th><th>Vigencia</th><th>Paga la empresa</th><th className="num">Afiliados</th><th>Estado</th></tr></thead>
          <tbody>{list.data.map((a) => (
            <tr key={a.id} className="clickable" onClick={() => openOne(a.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openOne(a.id)}>
              <td className="rt-main"><b>{a.name}</b><div className="muted small">{a.kindLabel}{Number(a.defaultDiscountPercent) ? ` · descuento general ${pctText(a.defaultDiscountPercent)}` : ""}{a.rulesCount ? ` · ${a.rulesCount} reglas de precio` : ""}</div></td>
              <td data-label="NIT">{a.taxId ?? "—"}</td>
              <td data-label="Vigencia">{ymdText(a.validFrom)} – {a.validTo ? ymdText(a.validTo) : "sin fin"}</td>
              <td data-label="Paga la empresa">{Number(a.companySharePercent) ? `${pctText(a.companySharePercent)}${a.companyCapCents ? ` (tope ${bs(a.companyCapCents)}/año)` : ""}` : "Nada (solo precios)"}</td>
              <td data-label="Afiliados" className="num">{a.affiliates}</td>
              <td data-label="Estado">{!a.active ? <span className="badge">Inactivo</span> : a.inForce ? <span className="badge ok">Vigente</span> : <span className="badge warn">Fuera de vigencia</span>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {edit && <AgreementDialog agreement={edit} readOnly={!can("clinic.manage")} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

interface RuleRow { target: string; mode: "price" | "percent"; value: string }

function AgreementDialog({ agreement, readOnly, onClose, onSaved }: { agreement: any; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const procs = useApi<any[]>("/api/procedures");
  const isNew = !agreement.id;
  const [f, setF] = useState({
    name: agreement.name ?? "", kind: agreement.kind ?? "company", taxId: agreement.taxId ?? "", billingName: agreement.billingName ?? "",
    contactName: agreement.contactName ?? "", contactPhone: agreement.contactPhone ?? "", contactEmail: agreement.contactEmail ?? "",
    validFrom: agreement.validFrom ?? localDate(), validTo: agreement.validTo ?? "",
    defaultDiscountPercent: agreement.defaultDiscountPercent != null ? String(agreement.defaultDiscountPercent) : "0",
    companySharePercent: agreement.companySharePercent != null ? String(agreement.companySharePercent) : "0",
    companyCap: agreement.companyCapCents ? toBsInput(agreement.companyCapCents) : "",
    paymentTermsDays: String(agreement.paymentTermsDays ?? 30), notes: agreement.notes ?? "", active: agreement.active ?? true,
  });
  const [rules, setRules] = useState<RuleRow[]>((agreement.rules ?? []).map((r: any) => ({
    target: r.procedureId ? `p:${r.procedureId}` : `c:${r.category}`, mode: r.priceCents != null ? "price" : "percent",
    value: r.priceCents != null ? toBsInput(r.priceCents) : String(r.discountPercent).replace(".", ","),
  })));
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const categories = useMemo(() => [...new Set((procs.data ?? []).map((p) => p.category))].sort(), [procs.data]);
  const pct = (s: string) => Number(String(s).replace(",", "."));
  const save = async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = "Escribe el nombre";
    if (f.taxId && !/^\d{5,15}$/.test(f.taxId)) e.taxId = "El NIT tiene solo números (5 a 15)";
    if (f.validTo && f.validTo < f.validFrom) e.validTo = "Termina antes de empezar";
    for (const [k, v] of [["defaultDiscountPercent", f.defaultDiscountPercent], ["companySharePercent", f.companySharePercent]] as const) {
      const n = pct(v || "0");
      if (!Number.isFinite(n) || n < 0 || n > 100) e[k] = "De 0 a 100 %";
    }
    const cap = f.companyCap ? parseBs(f.companyCap) : null;
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) e.companyCapCents = "Monto inválido";
    if (cap && !pct(f.companySharePercent)) e.companyCapCents = "El tope solo aplica si la empresa paga un porcentaje";
    const outRules = rules.map((r, k) => {
      const [kind, val] = [r.target.slice(0, 1), r.target.slice(2)];
      if (!val) e[`rules.${k}`] = "Elige la prestación o la categoría";
      if (kind === "c" && r.mode === "price") e[`rules.${k}`] = "Para una categoría usa un % de descuento";
      const v = r.mode === "price" ? parseBs(r.value || "") : pct(r.value || "");
      if (!Number.isFinite(v) || v < 0 || (r.mode === "percent" && v > 100)) e[`rules.${k}`] = r.mode === "price" ? "Precio inválido" : "De 0 a 100 %";
      return { procedureId: kind === "p" ? val : null, category: kind === "c" ? val : null, priceCents: r.mode === "price" ? v : null, discountPercent: r.mode === "percent" ? v : null };
    });
    setFe(e); setErr(null);
    if (Object.keys(e).length) return setErr("Revisa los campos marcados");
    const body = {
      ...f, taxId: f.taxId || null, billingName: f.billingName || null, contactName: f.contactName || null, contactPhone: f.contactPhone || null, contactEmail: f.contactEmail || null,
      validTo: f.validTo || null, defaultDiscountPercent: pct(f.defaultDiscountPercent || "0"), companySharePercent: pct(f.companySharePercent || "0"),
      companyCapCents: cap, paymentTermsDays: Number(f.paymentTermsDays) || 0, notes: f.notes || null, rules: outRules,
    };
    try {
      if (isNew) await api.post("/api/agreements", body); else await api.put(`/api/agreements/${agreement.id}`, body);
      toast(isNew ? "Convenio creado" : "Convenio actualizado. Los presupuestos ya hechos conservan sus precios."); onSaved();
    } catch (x: any) { setFe(fieldErrors(x)); setErr(x.message); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ferr = (k: string) => fe[k] ? <span className="ag-err">{fe[k]}</span> : null;
  return (
    <Dialog wide title={isNew ? "Nuevo convenio" : readOnly ? agreement.name : `Editar: ${agreement.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{readOnly ? "Cerrar" : "Cancelar"}</button>
      {!readOnly && <button className="btn btn-primary" onClick={save}>{isNew ? "Crear convenio" : "Guardar cambios"}</button>}</>}>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {!isNew && <div className="alert info" role="note">Cambiar precios o porcentajes no modifica los presupuestos ya hechos: cada línea guarda una copia de las condiciones.</div>}
        <div className="form-grid">
          <Field label="Nombre del convenio"><input className="input" value={f.name} aria-invalid={!!fe.name} onChange={set("name")} />{ferr("name")}</Field>
          <Field label="Tipo"><select className="input" value={f.kind} onChange={set("kind")}><option value="company">Empresa</option><option value="school">Colegio</option><option value="association">Asociación</option><option value="other">Otro</option></select></Field>
          <Field label="NIT (opcional)"><input className="input" inputMode="numeric" value={f.taxId} aria-invalid={!!fe.taxId} onChange={set("taxId")} />{ferr("taxId")}</Field>
          <Field label="Razón social (para facturar)"><input className="input" value={f.billingName} onChange={set("billingName")} /></Field>
          <Field label="Contacto"><input className="input" value={f.contactName} onChange={set("contactName")} /></Field>
          <Field label="Teléfono"><input className="input" inputMode="tel" value={f.contactPhone} onChange={set("contactPhone")} /></Field>
          <Field label="Correo"><input className="input" type="email" value={f.contactEmail} aria-invalid={!!fe.contactEmail} onChange={set("contactEmail")} />{ferr("contactEmail")}</Field>
          <Field label="Plazo de pago de la empresa (días)"><input className="input" type="number" min={0} max={180} value={f.paymentTermsDays} onChange={set("paymentTermsDays")} /></Field>
          <Field label="Vigente desde"><input className="input" type="date" value={f.validFrom} onChange={set("validFrom")} /></Field>
          <Field label="Vigente hasta (opcional)"><input className="input" type="date" value={f.validTo} aria-invalid={!!fe.validTo} onChange={set("validTo")} />{ferr("validTo")}</Field>
          <Field label="Descuento general (%)" hint="Para prestaciones sin regla propia."><input className="input" inputMode="decimal" value={f.defaultDiscountPercent} aria-invalid={!!fe.defaultDiscountPercent} onChange={set("defaultDiscountPercent")} />{ferr("defaultDiscountPercent")}</Field>
          <Field label="La empresa paga (%)" hint="0 = solo precios especiales; paga el paciente."><input className="input" inputMode="decimal" value={f.companySharePercent} aria-invalid={!!fe.companySharePercent} onChange={set("companySharePercent")} />{ferr("companySharePercent")}</Field>
          <Field label="Tope por paciente y año (Bs, opcional)" hint="Lo que exceda el tope lo paga el paciente."><input className="input" inputMode="decimal" value={f.companyCap} aria-invalid={!!fe.companyCapCents} onChange={set("companyCap")} />{ferr("companyCapCents")}</Field>
          <label className="check" style={{ alignSelf: "end", minHeight: 40 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Convenio activo</label>
          <Field label="Notas" span2><textarea className="input" value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <div className="stack-sm">
          <div className="row-between"><h3>Precios del convenio</h3>{!readOnly && <button type="button" className="btn btn-sm ag-tap" onClick={() => setRules([...rules, { target: "", mode: "percent", value: "" }])}><Plus size={15} />Agregar regla</button>}</div>
          <p className="small muted">Precio especial por prestación, o % de descuento por prestación o por categoría del catálogo. La regla de la prestación gana a la de la categoría.</p>
          {!rules.length && <p className="small muted">Sin reglas: se aplica el descuento general.</p>}
          <div className="ag-rules">
            {rules.map((r, k) => {
              const upd = (patch: Partial<RuleRow>) => setRules(rules.map((x, j) => (j === k ? { ...x, ...patch } : x)));
              return (
                <div key={k}>
                  <div className="ag-rule">
                    <Field label={`Regla ${k + 1}: se aplica a`}>
                      <select className="input" value={r.target} aria-invalid={!!fe[`rules.${k}`]} onChange={(e) => upd({ target: e.target.value, mode: e.target.value.startsWith("c:") ? "percent" : r.mode })}>
                        <option value="">Elegir…</option>
                        <optgroup label="Categoría">{categories.map((c) => <option key={c} value={`c:${c}`}>Toda la categoría {c}</option>)}</optgroup>
                        <optgroup label="Prestación">{procs.data?.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.code} · {p.name} ({bs(p.priceCents)})</option>)}</optgroup>
                      </select>
                    </Field>
                    <Field label="Tipo de regla"><select className="input" value={r.mode} onChange={(e) => upd({ mode: e.target.value as RuleRow["mode"] })}><option value="percent">Descuento %</option>{!r.target.startsWith("c:") && <option value="price">Precio especial (Bs)</option>}</select></Field>
                    <Field label={r.mode === "price" ? "Precio (Bs)" : "Descuento (%)"}><input className="input" inputMode="decimal" value={r.value} onChange={(e) => upd({ value: e.target.value })} /></Field>
                    {!readOnly ? <button type="button" className="btn btn-ghost btn-icon ag-tap" aria-label={`Quitar regla ${k + 1}`} onClick={() => setRules(rules.filter((_, j) => j !== k))}><Trash2 size={16} /></button> : <span />}
                  </div>
                  {fe[`rules.${k}`] && <span className="ag-err">{fe[`rules.${k}`]}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </fieldset>
    </Dialog>
  );
}

// ---------------- Cuentas por cobrar a empresas ----------------
const PAY_STATUS: Record<string, string> = { pending_verification: "Por verificar", confirmed: "Confirmado", rejected: "Rechazado", voided: "Anulado" };

function Receivables() {
  const { can, me } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const rx = useApi<any[]>("/api/payers/receivables");
  const pending = useApi<any[]>("/api/payer-payments?status=pending_verification");
  const recent = useApi<any[]>("/api/payer-payments");
  const [statement, setStatement] = useState<any | null>(null);
  const [paying, setPaying] = useState<any | null>(null);
  const reload = () => { rx.reload(); pending.reload(); recent.reload(); };
  const verify = async (p: any, decision: "confirmed" | "rejected") => {
    const reason = decision === "rejected" ? await ask({ title: "Rechazar pago de la empresa", inputLabel: "Motivo del rechazo", placeholder: "Ej.: no figura en el extracto", confirmLabel: "Rechazar", danger: true }) : null;
    if (decision === "rejected" && !reason) return;
    try { await api.post(`/api/payer-payments/${p.id}/verify`, { decision, reason }); toast(decision === "confirmed" ? "Pago confirmado" : "Pago rechazado"); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const voidPay = async (p: any) => {
    const reason = await ask({ title: `Anular pago N° ${p.number}`, message: "Los cargos vuelven a quedar pendientes de cobro a la empresa.", inputLabel: "Motivo de la anulación", confirmLabel: "Anular pago", danger: true });
    if (!reason) return;
    try { await api.post(`/api/payer-payments/${p.id}/void`, { reason }); toast("Pago anulado"); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const total = (rx.data ?? []).reduce((s, x) => s + Number(x.balanceCents), 0);
  return (
    <div className="stack">
      <div className="grid grid-3">
        <div className="card kpi"><div className="label">Saldo por cobrar a empresas</div><div className="value">{bs(total)}</div></div>
        <div className="card kpi"><div className="label">Vencido (fuera de plazo)</div><div className="value" style={{ color: (rx.data ?? []).some((x) => x.overdueCents > 0) ? "var(--danger)" : undefined }}>{bs((rx.data ?? []).reduce((s, x) => s + x.overdueCents, 0))}</div></div>
        <div className="card kpi"><div className="label">Pagos de empresas por verificar</div><div className="value">{bs((pending.data ?? []).reduce((s, x) => s + Number(x.amountCents), 0))}</div><div className="foot">{pending.data?.length ?? 0} pagos</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Por empresa</h2></div>
        {!rx.data ? <Loading /> : !rx.data.length ? <Empty>Ninguna empresa tiene cargos todavía.</Empty> : (
          <table className="table rt">
            <thead><tr><th>Empresa</th><th className="num">Facturado a la empresa</th><th className="num">Cobrado</th><th className="num">Por verificar</th><th className="num">Saldo</th><th /></tr></thead>
            <tbody>{rx.data.map((a) => (
              <tr key={a.id}>
                <td className="rt-main"><b>{a.name}</b><div className="muted small">{a.openCharges} cargos con saldo{a.overdueCents > 0 ? ` · ${bs(a.overdueCents)} vencido (plazo ${a.paymentTermsDays} días)` : ""}</div></td>
                <td data-label="Facturado" className="num">{bs(a.billedCents)}</td>
                <td data-label="Cobrado" className="num">{bs(a.paidCents)}</td>
                <td data-label="Por verificar" className="num">{a.pendingCents ? <span style={{ color: "var(--warn)" }}>{bs(a.pendingCents)}</span> : "—"}</td>
                <td data-label="Saldo" className="num"><b>{bs(a.balanceCents)}</b></td>
                <td className="nowrap"><div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-sm ag-tap" onClick={() => setStatement(a)}>Estado de cuenta</button>
                  {can("payments.create") && a.openCharges > 0 && <button className="btn btn-sm btn-primary ag-tap" onClick={() => setPaying(a)}><Wallet size={15} />Registrar pago</button>}
                </div></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
      {can("payments.verify") && (
        <div className="card">
          <div className="card-head"><h2>Pagos de empresas por verificar</h2><span className="badge warn">{pending.data?.length ?? 0}</span></div>
          <div className="card-pad" style={{ paddingBottom: 0 }}><p className="muted small">Confirma solo después de ver el ingreso en el banco (o concílialo con el extracto). Quien registró el pago no puede verificarlo.</p></div>
          {!pending.data ? <Loading /> : !pending.data.length ? <Empty>No hay pagos de empresas por verificar.</Empty> : (
            <table className="table rt">
              <thead><tr><th>Pago</th><th>Empresa</th><th>Referencia</th><th className="num">Monto</th><th>Registró</th><th /></tr></thead>
              <tbody>{pending.data.map((p) => {
                const self = p.receivedBy === me?.user.id && me?.membership?.role !== "owner";
                return (
                  <tr key={p.id}>
                    <td className="rt-main">N° {p.number} · {fmtDate(p.receivedAt)}<div className="muted small">{p.methodLabel} · {p.chargesCount} cargos</div></td>
                    <td data-label="Empresa">{p.agreementName}</td>
                    <td data-label="Referencia"><code>{p.bankReference}</code></td>
                    <td data-label="Monto" className="num"><b>{bs(p.amountCents)}</b></td>
                    <td data-label="Registró">{p.receivedByName}</td>
                    <td className="nowrap"><div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-sm btn-primary ag-tap" disabled={self} title={self ? "Debe verificarlo otra persona" : ""} onClick={() => verify(p, "confirmed")}><CheckCircle2 size={15} />Confirmar</button>
                      <button className="btn btn-sm btn-danger ag-tap" onClick={() => verify(p, "rejected")}><XCircle size={15} />Rechazar</button>
                    </div>{self && <div className="small muted">Lo registraste tú: debe confirmarlo otra persona.</div>}</td>
                  </tr>);
              })}</tbody>
            </table>
          )}
        </div>
      )}
      <div className="card">
        <div className="card-head"><h2>Últimos pagos de empresas</h2></div>
        {!recent.data ? <Loading /> : !recent.data.length ? <Empty>Sin pagos registrados.</Empty> : (
          <table className="table rt">
            <thead><tr><th>Pago</th><th>Empresa</th><th className="num">Monto</th><th>Estado</th><th /></tr></thead>
            <tbody>{recent.data.slice(0, 20).map((p) => (
              <tr key={p.id}>
                <td className="rt-main">N° {p.number} · {fmtDate(p.receivedAt)}<div className="muted small">{p.methodLabel} · ref. {p.bankReference}</div></td>
                <td data-label="Empresa">{p.agreementName}</td>
                <td data-label="Monto" className="num">{bs(p.amountCents)}</td>
                <td data-label="Estado"><StatusBadge status={p.status} label={PAY_STATUS[p.status]} />{p.statusReason && <div className="small muted">{p.statusReason}</div>}</td>
                <td>{can("payments.void") && p.status === "confirmed" && <button className="btn btn-ghost btn-sm ag-tap" onClick={() => voidPay(p)}>Anular</button>}</td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
      {statement && <StatementDialog agreement={statement} onClose={() => setStatement(null)} />}
      {paying && <PayerPaymentDialog agreement={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); reload(); }} />}
    </div>
  );
}

function StatementDialog({ agreement, onClose }: { agreement: any; onClose: () => void }) {
  const [from, setFrom] = useState(localDate().slice(0, 8) + "01");
  const [to, setTo] = useState(localDate());
  const ok = from && to && to >= from;
  const st = useApi<any>(ok ? `/api/agreements/${agreement.id}/statement${qs({ from, to })}` : null);
  return (
    <Dialog wide title={`Estado de cuenta · ${agreement.name}`} onClose={onClose} footer={<>
      {ok && <a className="btn ag-tap" href={`/api/agreements/${agreement.id}/statement.xlsx${qs({ from, to })}`}><FileSpreadsheet size={16} />Excel</a>}
      {ok && <PdfButton url={`/api/agreements/${agreement.id}/statement.pdf${qs({ from, to })}`} label="PDF" className="btn ag-tap" title="Emitir el estado de cuenta en PDF (queda registrado con código de verificación)" />}
      <button className="btn" onClick={onClose}>Cerrar</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Desde"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={to} aria-invalid={!ok} onChange={(e) => setTo(e.target.value)} />{!ok && <span className="ag-err">El período termina antes de empezar</span>}</Field>
        </div>
        {!st.data ? (ok ? <Loading /> : null) : <>
          <div className="ag-money">
            <div className="card kpi"><div className="label">Saldo inicial</div><div className="value">{bs(st.data.openingCents)}</div></div>
            <div className="card kpi"><div className="label">Cargos del período</div><div className="value">{bs(st.data.debitCents)}</div></div>
            <div className="card kpi"><div className="label">Pagos confirmados</div><div className="value">{bs(st.data.creditCents)}</div></div>
            <div className="card kpi"><div className="label">Saldo final</div><div className="value">{bs(st.data.closingCents)}</div></div>
          </div>
          {!st.data.movements.length ? <Empty>Sin movimientos en el período.</Empty> : (
            <table className="table rt">
              <thead><tr><th>Fecha</th><th>Detalle</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr></thead>
              <tbody>{st.data.movements.map((m: any) => (
                <tr key={m.id}>
                  <td data-label="Fecha">{ymdText(m.date)}</td>
                  <td className="rt-main">{m.patient && <b>{m.patient}</b>}{m.memberNumber && <span className="muted small"> · afiliado {m.memberNumber}</span>}<div className={m.patient ? "small muted" : ""}>{m.description}</div></td>
                  <td data-label="Debe" className="num">{m.debitCents ? bs(m.debitCents) : "—"}</td>
                  <td data-label="Haber" className="num">{m.creditCents ? bs(m.creditCents) : "—"}</td>
                  <td data-label="Saldo" className="num">{bs(m.balanceCents)}</td>
                </tr>))}
              </tbody>
            </table>
          )}
          {st.data.pendingPayments.length > 0 && <div className="alert warn" role="note">Pagos por verificar (aún no descuentan el saldo): {st.data.pendingPayments.map((p: any) => `N° ${p.number} por ${bs(p.amountCents)}`).join(", ")}.</div>}
        </>}
      </div>
    </Dialog>
  );
}

function PayerPaymentDialog({ agreement, onClose, onSaved }: { agreement: any; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const toast = useToast();
  const charges = useApi<any[]>(`/api/agreements/${agreement.id}/charges?open=1`);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [f, setF] = useState({ method: "transfer", bankReference: "", notes: "", branchId: branchId ?? me?.branches[0]?.id ?? "" });
  const [key] = useState(newKey());
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const total = Object.values(sel).reduce((s, v) => s + (parseBs(v || "0") || 0), 0);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.bankReference.trim()) e.bankReference = "Escribe el N° de operación del banco";
    const allocations = Object.entries(sel).map(([chargeId, v]) => ({ chargeId, amountCents: parseBs(v || "0") }));
    for (const a of allocations) {
      const ch = charges.data?.find((x) => x.id === a.chargeId);
      if (!a.amountCents || a.amountCents <= 0) e[a.chargeId] = "Monto inválido";
      else if (ch && a.amountCents > ch.openCents) e[a.chargeId] = `Máximo ${bs(ch.openCents)}`;
    }
    if (!allocations.length) e.allocations = "Elige al menos un cargo";
    setFe(e); setErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/agreements/${agreement.id}/payments`, { ...f, notes: f.notes || null, amountCents: total, idempotencyKey: key, allocations });
      toast(`Pago N° ${r.number} registrado; queda por verificar en el banco`); onSaved();
    } catch (x: any) { setFe(fieldErrors(x)); setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={`Registrar pago · ${agreement.name}`} onClose={onClose} footer={<>
      <span className="muted" style={{ marginRight: "auto" }}>Monto del pago: <b style={{ color: "var(--ink)" }}>{bs(total)}</b></span>
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Registrando…" : "Registrar pago"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Medio"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="transfer">Transferencia</option><option value="qr">QR bancario</option><option value="card">Tarjeta</option></select></Field>
          <Field label="N° de operación / referencia" hint="Queda por verificar hasta que otra persona lo confirme en el banco."><input className="input" value={f.bankReference} aria-invalid={!!fe.bankReference} onChange={(e) => setF({ ...f, bankReference: e.target.value })} />{fe.bankReference && <span className="ag-err">{fe.bankReference}</span>}</Field>
          <Field label="Sucursal que registra"><select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Nota"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <div className="row-between"><b>¿Qué cargos paga?</b>{charges.data && <button type="button" className="btn btn-sm" onClick={() => setSel(Object.fromEntries(charges.data!.map((c) => [c.id, toBsInput(c.openCents)])))}>Todos con su saldo</button>}</div>
        {fe.allocations && <span className="ag-err" role="alert">{fe.allocations}</span>}
        {!charges.data ? <Loading /> : !charges.data.length ? <Empty>No hay cargos pendientes de esta empresa.</Empty> : charges.data.map((c) => (
          <div key={c.id} className="ag-alloc">
            <input type="checkbox" style={{ width: 20, height: 20 }} aria-label={`Aplicar a ${c.patientName} · ${c.service}`} checked={c.id in sel}
              onChange={(e) => { const n = { ...sel }; if (e.target.checked) n[c.id] = toBsInput(c.openCents); else delete n[c.id]; setSel(n); }} />
            <div className="stack-sm" style={{ gap: 2 }}>
              <span><b>{c.patientName}</b>{c.memberNumber ? ` · afiliado ${c.memberNumber}` : ""}</span>
              <span className="small muted">{fmtDate(c.createdAt)} · {c.service} · parte de la empresa {bs(c.companyCents + c.voidedCents)} · saldo {bs(c.openCents)}{c.pendingCents ? ` (${bs(c.pendingCents)} en pagos por verificar)` : ""}</span>
            </div>
            <div>
              <input className="input" inputMode="decimal" aria-label={`Monto aplicado a ${c.patientName} (Bs)`} disabled={!(c.id in sel)} value={sel[c.id] ?? ""} aria-invalid={!!fe[c.id]} onChange={(e) => setSel({ ...sel, [c.id]: e.target.value })} />
              {fe[c.id] && <span className="ag-err">{fe[c.id]}</span>}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------- Pendiente de facturar ----------------
function InvoiceRequests() {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const [status, setStatus] = useState<"pending" | "cancelled">("pending");
  const list = useApi<any[]>(`/api/invoice-requests?status=${status}`);
  const cancel = async (r: any) => {
    const reason = await ask({ title: `Anular solicitud N° ${r.number}`, message: "Lo marcado vuelve a quedar disponible para facturar.", inputLabel: "Motivo", confirmLabel: "Anular", danger: true });
    if (!reason) return;
    try { await api.post(`/api/invoice-requests/${r.id}/cancel`, { reason }); toast("Solicitud anulada"); list.reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      <div className="alert warn" role="note">Estas solicitudes <b>no son facturas fiscales</b>. Quedan listas para cuando la clínica integre un proveedor de facturación autorizado por el SIN (SIAT). Mientras tanto, la factura se emite por el medio que use hoy la clínica.</div>
      <div className="row">{([["pending", "Pendientes de facturar"], ["cancelled", "Anuladas"]] as const).map(([k, l]) => <button key={k} className={`btn btn-sm ag-tap ${status === k ? "btn-primary" : ""}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <div className="card">
        {!list.data ? <Loading /> : !list.data.length ? <Empty>{status === "pending" ? "No hay nada pendiente de facturar. Se marca desde el detalle de un presupuesto aceptado." : "Sin solicitudes anuladas."}</Empty> : (
          <table className="table rt">
            <thead><tr><th>Solicitud</th><th>A nombre de</th><th>Paciente</th><th>Detalle</th><th className="num">Total</th><th /></tr></thead>
            <tbody>{list.data.map((r) => (
              <tr key={r.id}>
                <td className="rt-main"><b>N° {r.number}</b> · {fmtDate(r.createdAt)}<div className="muted small">{r.billToLabel} · presupuesto N° {r.budgetNumber} · {r.branchName}</div></td>
                <td data-label="A nombre de">{r.buyerName}<div className="muted small">{r.buyerDocType} {r.buyerTaxId}</div></td>
                <td data-label="Paciente"><Link to={`/pacientes/${r.patientId}`}>{r.patientName}</Link></td>
                <td data-label="Detalle"><div className="small">{(r.lines ?? []).map((l: any, k: number) => <div key={k}>{l.description}: {bs(l.amountCents)}</div>)}</div>{r.cancelReason && <div className="small muted">Anulada: {r.cancelReason}</div>}</td>
                <td data-label="Total" className="num"><b>{bs(r.totalCents)}</b></td>
                <td>{can("payments.void") && r.status === "pending" && <button className="btn btn-ghost btn-sm ag-tap" onClick={() => cancel(r)}>Anular</button>}</td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
