// Piezas de convenios para la ficha del paciente y el presupuesto: afiliación, precios del
// convenio al presupuestar, nota por línea, parte de la empresa y «marcar para facturar».
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, FileCheck2, Plus } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { bs, fmtDate, localDate, parseBs, toBsInput } from "../../lib/format";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "../ui";
import "./agreements.css";

export const ymdText = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
export const pctText = (n: number | string | null | undefined) => `${String(Number(n ?? 0)).replace(".", ",")} %`;

/** Errores de validación del servidor por campo (primer segmento de la ruta). */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError && Array.isArray(e.details)) for (const d of e.details) if (d?.path) out[String(d.path)] ??= d.message;
  return out;
}

// ---------------- Ficha del paciente ----------------
export function PatientAgreementsCard({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const list = useApi<any[]>(`/api/patients/${patientId}/agreements`);
  const [adding, setAdding] = useState(false);
  const end = async (pa: any) => {
    const reason = await ask({ title: `Dar de baja: ${pa.agreementName}`, message: "Desde hoy el convenio deja de aplicarse a nuevos presupuestos y tratamientos. Lo ya presupuestado conserva sus precios.", inputLabel: "Motivo de la baja", placeholder: "Ej.: dejó de trabajar en la empresa", confirmLabel: "Dar de baja", danger: true });
    if (!reason) return;
    try { await api.post(`/api/patient-agreements/${pa.id}/end`, { endDate: localDate(), reason }); toast("Afiliación dada de baja"); list.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const current = list.data?.filter((x) => x.inForce) ?? [];
  const past = list.data?.filter((x) => !x.inForce) ?? [];
  return (
    <div className="card">
      <div className="card-head"><h2>Convenio</h2>{can("patients.write") && <button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={15} />Afiliar</button>}</div>
      {!list.data ? <Loading rows={2} /> : !list.data.length ? <Empty>Sin convenio: paga como particular.</Empty> : (
        <div className="card-pad stack-sm">
          {current.map((a) => (
            <div key={a.id} className="stack-sm" style={{ gap: 4 }}>
              <div className="row-between"><b><BadgeCheck size={16} style={{ verticalAlign: "-3px", color: "var(--ok)" }} /> {a.agreementName}</b><span className="badge ok">Vigente</span></div>
              <span className="small">N° de afiliado <b>{a.memberNumber}</b>{a.holderName ? ` · titular: ${a.holderName}` : ""} · desde {ymdText(a.validFrom)}{a.validTo ? ` hasta ${ymdText(a.validTo)}` : ""}</span>
              {Number(a.companySharePercent) > 0
                ? <span className="small muted">La empresa paga el {pctText(a.companySharePercent)} de cada tratamiento{a.companyCapCents ? ` hasta ${bs(a.companyCapCents)} por año (usado este año: ${bs(a.companyUsedThisYearCents ?? 0)})` : ""}.</span>
                : <span className="small muted">Solo precios especiales: paga el paciente.</span>}
              {can("patients.write") && <div><button className="btn btn-ghost btn-sm" onClick={() => end(a)}>Dar de baja</button></div>}
            </div>
          ))}
          {past.length > 0 && <details><summary className="small muted">Afiliaciones anteriores ({past.length})</summary>
            {past.map((a) => <div key={a.id} className="small muted" style={{ marginTop: 4 }}>{a.agreementName} · N° {a.memberNumber} · {ymdText(a.validFrom)} – {ymdText(a.validTo)}{a.endReason ? ` · baja: ${a.endReason}` : ""}</div>)}
          </details>}
        </div>
      )}
      {adding && <EnrollDialog patientId={patientId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); }} />}
    </div>
  );
}

function EnrollDialog({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const ags = useApi<any[]>("/api/agreements?active=1");
  const [f, setF] = useState({ agreementId: "", memberNumber: "", holderName: "", validFrom: localDate(), validTo: "" });
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.agreementId) e.agreementId = "Elige el convenio";
    if (!f.memberNumber.trim()) e.memberNumber = "Escribe el N° de afiliado";
    if (f.validTo && f.validTo < f.validFrom) e.validTo = "Termina antes de empezar";
    setFe(e); setErr(null);
    if (Object.keys(e).length) return;
    try {
      await api.post(`/api/patients/${patientId}/agreements`, { ...f, holderName: f.holderName || null, validTo: f.validTo || null });
      toast("Paciente afiliado al convenio"); onSaved();
    } catch (x: any) { setFe(fieldErrors(x)); setErr(x.message); }
  };
  return (
    <Dialog title="Afiliar a un convenio" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar afiliación</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Convenio" span2>
            <select className="input" value={f.agreementId} aria-invalid={!!fe.agreementId} onChange={(e) => setF({ ...f, agreementId: e.target.value })}>
              <option value="">Elegir…</option>
              {ags.data?.filter((a) => a.inForce).map((a) => <option key={a.id} value={a.id}>{a.name}{Number(a.companySharePercent) ? ` · empresa paga ${pctText(a.companySharePercent)}` : ""}</option>)}
            </select>
            {fe.agreementId && <span className="ag-err">{fe.agreementId}</span>}
          </Field>
          <Field label="N° de afiliado"><input className="input" value={f.memberNumber} aria-invalid={!!fe.memberNumber} onChange={(e) => setF({ ...f, memberNumber: e.target.value })} />{fe.memberNumber && <span className="ag-err">{fe.memberNumber}</span>}</Field>
          <Field label="Titular (si es dependiente)"><input className="input" value={f.holderName} placeholder="Opcional" onChange={(e) => setF({ ...f, holderName: e.target.value })} /></Field>
          <Field label="Vigente desde"><input className="input" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
          <Field label="Vigente hasta"><input className="input" type="date" value={f.validTo} aria-invalid={!!fe.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />{fe.validTo && <span className="ag-err">{fe.validTo}</span>}</Field>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Presupuesto ----------------
export interface AgreementPrices { agreement: null | { id: string; name: string; memberNumber: string; companySharePercent: number; companyCapCents: number | null; companyUsedThisYearCents: number | null }; prices: { procedureId: string; listPriceCents: number; unitPriceCents: number; note: string }[] }

export function useAgreementPrices(patientId: string | null | undefined) {
  const r = useApi<AgreementPrices>(patientId ? `/api/patients/${patientId}/agreement-prices` : null);
  return useMemo(() => {
    const map = new Map((r.data?.prices ?? []).map((p) => [p.procedureId, p]));
    return { agreement: r.data?.agreement ?? null, price: (procedureId: string) => (r.data?.agreement ? map.get(procedureId) ?? null : null) };
  }, [r.data]);
}

export function AgreementBanner({ agreement }: { agreement: AgreementPrices["agreement"] }) {
  if (!agreement) return null;
  return (
    <div className="alert info" role="status">
      <Building2 size={16} style={{ verticalAlign: "-3px" }} /> Paciente afiliado a <b>{agreement.name}</b> (N° {agreement.memberNumber}): se aplican los precios del convenio y quedan copiados en el presupuesto.
      {agreement.companySharePercent > 0 && <> La empresa paga el {pctText(agreement.companySharePercent)}{agreement.companyCapCents ? ` hasta ${bs(agreement.companyCapCents)} por año (le quedan ${bs(Math.max(agreement.companyCapCents - (agreement.companyUsedThisYearCents ?? 0), 0))})` : ""}.</>}
    </div>
  );
}

/** Nota de la línea: precio de lista tachado y regla del convenio aplicada (copia guardada). */
export function AgreementLineNote({ item }: { item: any }) {
  if (!item.agreementNote) return null;
  return (
    <div className="stack-sm" style={{ gap: 2, marginTop: 4 }}>
      <span className="ag-note">{item.agreementNote}</span>
      {item.listUnitPriceCents != null && item.listUnitPriceCents !== item.unitPriceCents && <span className="ag-list-price">Lista: {bs(item.listUnitPriceCents)}</span>}
      {item.companyCents > 0 && <span className="small muted">Empresa: {bs(item.companyCents)}{item.companyEstimated ? " (estimado)" : ""}</span>}
    </div>
  );
}

export function BudgetCompanyShare({ budget, onInvoice }: { budget: any; onInvoice?: () => void }) {
  if (!budget.companyCents && !onInvoice) return null;
  return (
    <div className="card card-pad row-between">
      <div className="stack-sm" style={{ gap: 2 }}>
        {budget.companyCents > 0 ? <>
          <b>Paga la empresa · {budget.agreementName}: {bs(budget.companyCents)}</b>
          <span className="small muted">A cargo del paciente: {bs(budget.patientShareCents)}. Lo no realizado es estimado: el tope anual y la vigencia se aplican al registrar cada tratamiento.</span>
        </> : <span className="small muted">Marca qué líneas o sesiones deben facturarse y a nombre de quién.</span>}
      </div>
      {onInvoice && <button className="btn ag-tap" onClick={onInvoice}><FileCheck2 size={15} />Marcar para facturar</button>}
    </div>
  );
}

// ---------------- Marcar para facturar ----------------
type BillTo = "patient" | "agreement" | "other";
const DOC_TYPES = [["NIT", "NIT"], ["CI", "Cédula de identidad"], ["CEX", "Cédula de extranjero"], ["PAS", "Pasaporte"], ["OD", "Otro documento"]] as const;

export function InvoiceRequestDialog({ budgetId, onClose, onSaved }: { budgetId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const inv = useApi<any>(`/api/budgets/${budgetId}/invoiceable`);
  const [billTo, setBillTo] = useState<BillTo>("patient");
  const [buyer, setBuyer] = useState({ buyerDocType: "CI", buyerTaxId: "", buyerName: "", buyerEmail: "" });
  const [sel, setSel] = useState<Record<string, { on: boolean; part: string; amount: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const d = inv.data;
  const pendingFor = (l: any, part: string) => {
    const payer = billTo === "agreement" ? l.pendingCompanyCents : l.pendingPatientCents;
    if (part === "line") return payer;
    const s = l.sessions.find((x: any) => x.id === part);
    return Math.max(0, Math.min(payer, s?.pendingCents ?? 0));
  };
  // Al cambiar de pagador se recalculan los datos del comprador y los montos sugeridos.
  useEffect(() => {
    if (!d) return;
    const b = billTo === "agreement" ? d.buyers.agreement : billTo === "patient" ? d.buyers.patient : null;
    setBuyer({ buyerDocType: b?.docType ?? "CI", buyerTaxId: b?.taxId ?? "", buyerName: b?.name ?? "", buyerEmail: b?.email ?? "" });
    const next: typeof sel = {};
    for (const l of d.lines) {
      if (billTo === "agreement" && !l.agreementId) continue;
      const p = pendingFor(l, "line");
      next[l.itemId] = { on: false, part: "line", amount: p > 0 ? toBsInput(p) : "" };
    }
    setSel(next);
    setFe({}); setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, billTo]);
  if (!d) return <Dialog title="Marcar para facturar" onClose={onClose}><Loading /></Dialog>;
  const lines = d.lines.filter((l: any) => billTo !== "agreement" || l.agreementId);
  const chosen = lines.filter((l: any) => sel[l.itemId]?.on);
  const total = chosen.reduce((s: number, l: any) => s + (parseBs(sel[l.itemId]!.amount || "0") || 0), 0);
  const setAll = (on: boolean) => setSel(Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, { ...v, on: on && pendingFor(lines.find((l: any) => l.itemId === k), v.part) > 0 }])));
  const save = async () => {
    const e: Record<string, string> = {};
    if (!buyer.buyerTaxId.trim()) e.buyerTaxId = "Escribe el NIT o documento";
    else if (buyer.buyerDocType === "NIT" && !/^\d{1,15}$/.test(buyer.buyerTaxId.trim())) e.buyerTaxId = "El NIT tiene solo números";
    if (buyer.buyerName.trim().length < 2) e.buyerName = "Escribe el nombre o razón social";
    for (const l of chosen) {
      const s = sel[l.itemId]!;
      const cents = parseBs(s.amount || "0");
      const max = pendingFor(l, s.part);
      if (!cents || cents <= 0) e[`line-${l.itemId}`] = "Monto inválido";
      else if (cents > max) e[`line-${l.itemId}`] = `Máximo ${bs(max)}`;
    }
    if (!chosen.length) e.lines = "Elige al menos una línea";
    setFe(e); setErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.post("/api/invoice-requests", {
        budgetId, billTo, ...buyer, buyerTaxId: buyer.buyerTaxId.trim(), buyerEmail: buyer.buyerEmail || null,
        lines: chosen.map((l: any) => ({ budgetItemId: l.itemId, sessionId: sel[l.itemId]!.part === "line" ? null : sel[l.itemId]!.part, amountCents: parseBs(sel[l.itemId]!.amount) })),
      });
      toast(`Marcado como pendiente de facturar (N° ${r.number})`); onSaved();
    } catch (x: any) { setFe(fieldErrors(x)); setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={`Marcar para facturar · presupuesto N° ${d.budget.number}`} onClose={onClose} footer={<>
      <span className="muted" style={{ marginRight: "auto" }}>Total: <b style={{ color: "var(--ink)" }}>{bs(total)}</b></span>
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Marcar pendiente de facturar"}</button></>}>
      <div className="stack">
        <div className="alert warn" role="note">Esto <b>no emite una factura fiscal</b>: queda como «Pendiente de facturar» para cuando la clínica integre un proveedor autorizado por el SIN (SIAT).</div>
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="¿A nombre de quién?" group>
          <div className="row">
            {([["patient", "Paciente"], ...(d.buyers.agreement ? [["agreement", `Empresa: ${d.buyers.agreement.agreementName}`]] : []), ["other", "Otra persona (familiar responsable)"]] as [BillTo, string][]).map(([k, l]) => (
              <button key={k} type="button" className={`btn ag-tap ${billTo === k ? "btn-primary" : ""}`} aria-pressed={billTo === k} onClick={() => setBillTo(k)}>{l}</button>))}
          </div>
        </Field>
        <div className="form-grid">
          <Field label="Tipo de documento"><select className="input" value={buyer.buyerDocType} onChange={(e) => setBuyer({ ...buyer, buyerDocType: e.target.value })}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="N° de NIT o documento"><input className="input" inputMode={buyer.buyerDocType === "NIT" ? "numeric" : "text"} value={buyer.buyerTaxId} aria-invalid={!!fe.buyerTaxId} onChange={(e) => setBuyer({ ...buyer, buyerTaxId: e.target.value })} />{fe.buyerTaxId && <span className="ag-err">{fe.buyerTaxId}</span>}</Field>
          <Field label="Nombre o razón social" span2><input className="input" value={buyer.buyerName} aria-invalid={!!fe.buyerName} onChange={(e) => setBuyer({ ...buyer, buyerName: e.target.value })} />{fe.buyerName && <span className="ag-err">{fe.buyerName}</span>}</Field>
          <Field label="Correo para la factura (opcional)" span2><input className="input" type="email" value={buyer.buyerEmail} onChange={(e) => setBuyer({ ...buyer, buyerEmail: e.target.value })} /></Field>
        </div>
        <div className="row-between"><b>Líneas</b><div className="row"><button type="button" className="btn btn-sm" onClick={() => setAll(true)}>Todas</button><button type="button" className="btn btn-sm" onClick={() => setAll(false)}>Ninguna</button></div></div>
        {fe.lines && <span className="ag-err" role="alert">{fe.lines}</span>}
        {!lines.length ? <Empty>No hay líneas para este pagador.</Empty> : lines.map((l: any) => {
          const s = sel[l.itemId] ?? { on: false, part: "line", amount: "" };
          const max = pendingFor(l, s.part);
          const upd = (patch: Partial<typeof s>) => setSel({ ...sel, [l.itemId]: { ...s, ...patch } });
          return (
            <div key={l.itemId} className="ag-alloc">
              <input type="checkbox" className="check" style={{ width: 20, height: 20 }} aria-label={`Facturar ${l.description}`} checked={s.on} disabled={max <= 0 && !s.on} onChange={(e) => upd({ on: e.target.checked })} />
              <div className="stack-sm" style={{ gap: 2 }}>
                <span><b>{l.description}</b>{l.tooth ? ` (pieza ${l.tooth})` : ""}</span>
                <span className="small muted">Neto {bs(l.netCents)}{l.companyCents > 0 ? ` · empresa ${bs(l.companyCents)}${l.companyEstimated ? " (estimado)" : ""} · paciente ${bs(l.patientCents)}` : ""} · pendiente de facturar a este pagador: <b>{bs(pendingFor(l, "line"))}</b></span>
                {l.sessions.length > 0 && (
                  <select className="input" style={{ maxWidth: 320 }} aria-label={`Qué se factura de ${l.description}`} value={s.part} onChange={(e) => { const part = e.target.value; const p = pendingFor(l, part); upd({ part, amount: p > 0 ? toBsInput(p) : "" }); }}>
                    <option value="line">Toda la línea</option>
                    {l.sessions.map((x: any) => <option key={x.id} value={x.id}>Sesión {x.position}: {x.name} ({bs(x.pendingCents)} pendiente)</option>)}
                  </select>
                )}
              </div>
              <div>
                <input className="input" inputMode="decimal" aria-label={`Monto a facturar de ${l.description} (Bs)`} value={s.amount} disabled={!s.on} aria-invalid={!!fe[`line-${l.itemId}`]} onChange={(e) => upd({ amount: e.target.value })} />
                {fe[`line-${l.itemId}`] && <span className="ag-err">{fe[`line-${l.itemId}`]}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Solicitudes pendientes de facturar de un presupuesto (en su detalle). */
export function BudgetInvoiceRequests({ budgetId, refreshKey }: { budgetId: string; refreshKey: number }) {
  const list = useApi<any[]>(`/api/invoice-requests?budgetId=${budgetId}&status=pending`, [refreshKey]);
  if (!list.data?.length) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>Pendiente de facturar</h3><span className="badge warn">{list.data.length}</span></div>
      <div className="card-pad stack-sm">
        {list.data.map((r) => <div key={r.id} className="small">N° {r.number} · {fmtDate(r.createdAt)} · a nombre de <b>{r.buyerName}</b> ({r.buyerDocType} {r.buyerTaxId}) · {bs(r.totalCents)}</div>)}
      </div>
    </div>
  );
}
