import { useMemo, useState, type ReactNode } from "react";
import { Check, Paperclip, Pencil, Plus, Repeat, XCircle } from "lucide-react";
import { useApi } from "../../lib/hooks";
import { api, newKey, qs, type ApiError } from "../../lib/api";
import { bs, fmtDate, localDate, parseBs, toBsInput } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Dialog, Empty, Field, Loading, StatusBadge, useAsk, useToast } from "../ui";
import { ExportLink, MonthPicker, monthLabel, thisMonth } from "./shared";
import { AttachmentsDialog, SharesEditor, sharesBody, sharesError, type ShareRow } from "./ExpenseExtras";

export const CATEGORY_OPTIONS: [string, string][] = [
  ["rent", "Alquiler"], ["salaries", "Sueldos"], ["utilities", "Servicios básicos"], ["supplies", "Insumos fuera de inventario"],
  ["marketing", "Marketing"], ["maintenance", "Mantenimiento"], ["taxes", "Impuestos"], ["other", "Otros"],
];
const STATE_TONE: Record<string, string> = { confirmed: "confirmed", draft: "draft", voided: "voided" };

type FieldErrors = Record<string, string>;
function errorsOf(e: unknown): { fields: FieldErrors; message: string } {
  const err = e as ApiError;
  const fields: FieldErrors = {};
  for (const d of (err.details as { path?: string; message?: string }[] | undefined) ?? []) if (d?.path) fields[d.path] = d.message ?? "Valor inválido";
  return { fields, message: err.message };
}
/** Campo con su error justo debajo (aria-describedby apunta al mensaje). */
function FieldE({ label, err, id, span2, hint, children }: { label: string; err?: string; id: string; span2?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className={span2 ? "span-2" : undefined} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <Field label={label} hint={hint}>{children}</Field>
      {err && <span id={id} className="hint" style={{ color: "var(--danger)", fontSize: 12.5 }}>{err}</span>}
    </div>
  );
}

function ExpenseDialog({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const branches = me?.branches ?? [];
  const editing = !!initial?.id;
  const [f, setF] = useState(() => ({
    branchId: initial?.branchId ?? branchId ?? branches[0]?.id ?? "",
    category: initial?.category ?? "rent",
    description: initial?.description ?? "",
    amount: initial?.amountCents ? toBsInput(initial.amountCents) : "",
    expenseDate: initial?.expenseDate ?? localDate(),
    supplier: initial?.supplier ?? "",
    receiptRef: initial?.receiptRef ?? "",
    notes: initial?.notes ?? "",
    asDraft: false,
  }));
  // Gasto compartido entre sucursales (B-083)
  const [shared, setShared] = useState<boolean>(!!initial?.shares?.length);
  const [shares, setShares] = useState<ShareRow[]>(() => initial?.shares?.length
    ? initial.shares.map((x: any) => ({ branchId: x.branchId, percent: String(x.percentBp / 100).replace(".", ",") }))
    : branches.slice(0, 2).map((b, i) => ({ branchId: b.id, percent: i === 0 ? "50" : "50" })));
  const [key] = useState(newKey);
  const [errs, setErrs] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const save = async () => {
    const local: FieldErrors = {};
    const cents = parseBs(f.amount);
    if (!f.amount.trim() || !Number.isFinite(cents) || cents <= 0) local.amountCents = "Escribe un monto mayor que cero (por ejemplo 1.250,50)";
    if (f.description.trim().length < 3) local.description = "Describe el gasto (mínimo 3 caracteres)";
    if (!f.expenseDate) local.expenseDate = "Elige la fecha";
    if (shared) { const se = sharesError(shares); if (se) local.shares = se; }
    setErrs(local); setMsg(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const body = { branchId: f.branchId, category: f.category, description: f.description.trim(), amountCents: cents, expenseDate: f.expenseDate,
      supplier: f.supplier.trim() || null, receiptRef: f.receiptRef.trim() || null, notes: f.notes.trim() || null,
      shares: shared ? sharesBody(shares) : [] };
    try {
      if (editing) await api.put(`/api/expenses/${initial.id}`, body);
      else await api.post("/api/expenses", { ...body, asDraft: f.asDraft, idempotencyKey: key });
      onSaved();
    } catch (e) {
      const x = errorsOf(e);
      const shown = ["amountCents", "description", "expenseDate", "shares"];
      setErrs(x.fields);
      setMsg(Object.keys(x.fields).some((k) => shown.includes(k)) ? null : x.message);
    } finally { setBusy(false); }
  };
  return (
    <Dialog title={editing ? "Editar borrador de gasto" : "Registrar gasto"} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando…" : editing ? "Guardar borrador" : f.asDraft ? "Guardar borrador" : "Registrar gasto"}</button>
    </>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {msg && <div className="alert danger span-2" role="alert">{msg}</div>}
        {!shared && (
          <Field label="Sucursal">
            <select className="input" value={f.branchId} onChange={(e) => set("branchId", e.target.value)} aria-invalid={!!errs.branchId}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Categoría">
          <select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <FieldE label="Descripción" span2 id="err-desc" err={errs.description}>
          <input className="input" value={f.description} maxLength={200} onChange={(e) => set("description", e.target.value)} placeholder="Ej.: Alquiler de noviembre" aria-invalid={!!errs.description} aria-describedby={errs.description ? "err-desc" : undefined} />
        </FieldE>
        <FieldE label="Monto (Bs)" id="err-amount" err={errs.amountCents}>
          <input className="input" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0,00" aria-invalid={!!errs.amountCents} aria-describedby={errs.amountCents ? "err-amount" : undefined} />
        </FieldE>
        <FieldE label="Fecha del gasto" id="err-date" err={errs.expenseDate}>
          <input className="input" type="date" value={f.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} aria-invalid={!!errs.expenseDate} aria-describedby={errs.expenseDate ? "err-date" : undefined} />
        </FieldE>
        <Field label="Proveedor (opcional)"><input className="input" value={f.supplier} maxLength={120} onChange={(e) => set("supplier", e.target.value)} /></Field>
        <Field label="Comprobante (opcional)" hint="N° de factura, recibo o referencia"><input className="input" value={f.receiptRef} maxLength={120} onChange={(e) => set("receiptRef", e.target.value)} /></Field>
        <Field label="Notas (opcional)" span2><textarea className="input" rows={2} value={f.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} /></Field>
        {branches.length > 1 && (
          <label className="check span-2"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Gasto compartido entre sucursales (repartir por porcentaje)</label>
        )}
        {shared && <SharesEditor rows={shares} onChange={setShares} amountCents={Number.isFinite(parseBs(f.amount)) ? parseBs(f.amount) : 0} error={errs.shares} />}
        {!editing && (
          <label className="check span-2"><input type="checkbox" checked={f.asDraft} onChange={(e) => set("asDraft", e.target.checked)} />Guardar como borrador (todavía no se pagó; no cuenta en la rentabilidad hasta confirmarlo)</label>
        )}
        <p className="muted small span-2" style={{ margin: 0 }}>Un gasto confirmado ya no se edita: si hay un error, se anula con motivo y se registra de nuevo.</p>
      </form>
    </Dialog>
  );
}

function RecurringDialog({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const editing = !!initial?.id;
  const [f, setF] = useState(() => ({
    branchId: initial?.branchId ?? branchId ?? me?.branches[0]?.id ?? "", category: initial?.category ?? "rent", description: initial?.description ?? "",
    amount: initial?.amountCents ? toBsInput(initial.amountCents) : "", supplier: initial?.supplier ?? "", dayOfMonth: String(initial?.dayOfMonth ?? 5),
    startsMonth: initial?.startsMonth ?? thisMonth(), active: initial?.active ?? true,
  }));
  // Gasto fijo compartido entre sucursales (B-097): cada borrador mensual se reparte igual.
  const branches = me?.branches ?? [];
  const [shared, setShared] = useState<boolean>(!!initial?.shares?.length);
  const [shares, setShares] = useState<ShareRow[]>(() => initial?.shares?.length
    ? initial.shares.map((x: any) => ({ branchId: x.branchId, percent: String(x.percentBp / 100).replace(".", ",") }))
    : branches.slice(0, 2).map((b) => ({ branchId: b.id, percent: "50" })));
  const [errs, setErrs] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const save = async () => {
    const cents = parseBs(f.amount);
    const local: FieldErrors = {};
    if (!f.amount.trim() || !Number.isFinite(cents) || cents <= 0) local.amountCents = "Escribe un monto mayor que cero";
    if (f.description.trim().length < 3) local.description = "Describe el gasto (mínimo 3 caracteres)";
    const day = Number(f.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 28) local.dayOfMonth = "Día entre 1 y 28";
    if (shared) { const se = sharesError(shares); if (se) local.shares = se; }
    setErrs(local); setMsg(null);
    if (Object.keys(local).length) return;
    const body = { category: f.category, description: f.description.trim(), amountCents: cents, supplier: f.supplier.trim() || null, dayOfMonth: day,
      shares: shared ? sharesBody(shares) : [] };
    try {
      if (editing) await api.put(`/api/expenses/recurring/${initial.id}`, { ...body, active: f.active });
      else await api.post("/api/expenses/recurring", { ...body, branchId: f.branchId, startsMonth: f.startsMonth });
      onSaved();
    } catch (e) { const x = errorsOf(e); setErrs(x.fields); setMsg(x.message); }
  };
  return (
    <Dialog title={editing ? "Editar gasto fijo" : "Nuevo gasto fijo mensual"} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button>
    </>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {msg && <div className="alert danger span-2" role="alert">{msg}</div>}
        {!editing && !shared && <Field label="Sucursal"><select className="input" value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        <Field label="Categoría"><select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>{CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <FieldE label="Descripción" span2 id="rerr-desc" err={errs.description}><input className="input" value={f.description} maxLength={200} onChange={(e) => set("description", e.target.value)} aria-invalid={!!errs.description} aria-describedby={errs.description ? "rerr-desc" : undefined} /></FieldE>
        <FieldE label="Monto mensual (Bs)" id="rerr-amount" err={errs.amountCents}><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} aria-invalid={!!errs.amountCents} aria-describedby={errs.amountCents ? "rerr-amount" : undefined} /></FieldE>
        <FieldE label="Día del mes" hint="Fecha del borrador (1 a 28)" id="rerr-day" err={errs.dayOfMonth}><input className="input" inputMode="numeric" value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} aria-invalid={!!errs.dayOfMonth} aria-describedby={errs.dayOfMonth ? "rerr-day" : undefined} /></FieldE>
        {!editing && <Field label="Desde el mes"><input className="input" type="month" value={f.startsMonth} onChange={(e) => e.target.value && set("startsMonth", e.target.value)} /></Field>}
        <Field label="Proveedor (opcional)"><input className="input" value={f.supplier} maxLength={120} onChange={(e) => set("supplier", e.target.value)} /></Field>
        {branches.length > 1 && (
          <label className="check span-2"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Gasto fijo compartido entre sucursales (repartir por porcentaje)</label>
        )}
        {shared && <SharesEditor rows={shares} onChange={setShares} amountCents={Number.isFinite(parseBs(f.amount)) ? parseBs(f.amount) : 0} error={errs.shares} />}
        {editing && <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} />Activo (genera un borrador cada mes)</label>}
        <p className="muted small span-2" style={{ margin: 0 }}>Cada mes se genera un borrador con este monto para confirmarlo cuando se pague (o ajustar el monto antes). Nunca se genera dos veces el mismo mes.</p>
      </form>
    </Dialog>
  );
}

export function ExpensesTab() {
  const { branchId } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const [month, setMonth] = useState(thisMonth);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("all");
  const [dlg, setDlg] = useState<any | null>(null);
  const [rdlg, setRdlg] = useState<any | null>(null);
  const [files, setFiles] = useState<any | null>(null);
  const filters = useMemo(() => ({ month, branchId, category: category || undefined, status }), [month, branchId, category, status]);
  const list = useApi<any>(`/api/expenses${qs(filters)}`);
  const rec = useApi<any[]>(`/api/expenses/recurring${qs({ branchId })}`);
  const d = list.data;
  const reload = () => { list.reload(); rec.reload(); };

  const generate = async () => {
    try { const r = await api.post("/api/expenses/recurring/generate", { month, branchId }); toast(`${r.created} borrador(es) generado(s)`); reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  const confirm = async (x: any) => {
    try { await api.post(`/api/expenses/${x.id}/confirm`); toast("Gasto confirmado"); reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  const voidIt = async (x: any) => {
    const reason = await ask({ title: "Anular gasto", message: `${x.description} · ${bs(x.amountCents)}. El gasto queda en el historial como anulado y deja de contar en la rentabilidad.`,
      inputLabel: "Motivo de la anulación", minLength: 5, placeholder: "Ej.: se registró dos veces", confirmLabel: "Anular gasto", danger: true });
    if (!reason) return;
    try { await api.post(`/api/expenses/${x.id}/void`, { reason }); toast("Gasto anulado"); reload(); }
    catch (e: any) { toast(e.message, true); }
  };

  return (
    <div className="stack">
      <div className="card card-pad mg-toolbar">
        <MonthPicker value={month} onChange={setMonth} />
        <Field label="Categoría">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>{CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Estado">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos</option><option value="confirmed">Confirmados</option><option value="draft">Borradores</option><option value="voided">Anulados</option>
          </select>
        </Field>
        <div className="grow" style={{ flex: 1 }} />
        <ExportLink href={`/api/expenses.xlsx${qs(filters)}`} />
        <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={() => setDlg({})}><Plus size={16} />Registrar gasto</button>
      </div>

      {d && d.recurringPending > 0 && (
        <div className="alert info row-between" role="note">
          <span>Hay {d.recurringPending} gasto(s) fijo(s) de {monthLabel(month)} por generar como borrador.</span>
          <button className="btn btn-sm" onClick={generate}><Repeat size={15} />Generar borradores</button>
        </div>
      )}

      {!d ? <Loading /> : (
        <>
          <div className="grid grid-3">
            <div className="card kpi"><div className="label">Confirmado en {monthLabel(month)}</div><div className="value">{bs(d.totals.confirmedCents)}</div><div className="foot">{d.totals.confirmedCount} gasto(s) · cuenta en la rentabilidad</div></div>
            <div className="card kpi"><div className="label">Borradores por confirmar</div><div className="value">{d.totals.draftCount}</div><div className="foot">{bs(d.totals.draftCents)} todavía no cuentan</div></div>
            <div className="card kpi"><div className="label">Anulados</div><div className="value">{d.totals.voidedCount}</div><div className="foot">Quedan en el historial con su motivo</div></div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Gastos de {monthLabel(month)}</h2><span className="muted small">{d.items.length} en la lista · {bs(d.totals.listedCents)}</span></div>
            {d.items.length === 0 ? <Empty>No hay gastos con estos filtros. Registra el primero con «Registrar gasto».</Empty> : (
              <div className="table-wrap">
                <table className="table mg-cards">
                  <thead><tr><th>Descripción</th><th>Fecha</th><th>Sucursal</th><th>Categoría</th><th>Comprobante</th><th>Estado</th><th className="num">Monto</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>
                    {d.items.map((x: any) => (
                      <tr key={x.id}>
                        <td className="mg-head">{x.description}{x.supplier ? <span className="muted small" style={{ display: "block", fontWeight: 400 }}>{x.supplier}</span> : null}</td>
                        <td data-label="Fecha" className="nowrap">{fmtDate(x.expenseDate + "T12:00:00Z")}</td>
                        <td data-label="Sucursal">{x.shares?.length
                          ? <span>Compartido<span className="mg-split">{x.shares.map((sh: any) => `${sh.branchName} ${String(sh.percentBp / 100).replace(".", ",")} %`).join(" · ")}</span></span>
                          : x.branchName}</td>
                        <td data-label="Categoría"><span>{x.categoryLabel}{x.recurringId && <span className="badge" style={{ marginLeft: 6 }} title="Generado por un gasto fijo mensual">fijo</span>}</span></td>
                        <td data-label="Comprobante"><span>{x.receiptRef ?? (x.attachmentCount ? null : <span className="muted">—</span>)}{x.attachmentCount > 0 && <span className="badge" style={{ marginLeft: x.receiptRef ? 6 : 0 }}>{x.attachmentCount} adjunto(s)</span>}</span></td>
                        <td data-label="Estado"><span><StatusBadge status={STATE_TONE[x.state] ?? x.state} label={x.stateLabel} />{x.voidReason && <span className="muted small" style={{ display: "block" }}>{x.voidReason}</span>}</span></td>
                        <td data-label="Monto" className="num" style={x.state === "voided" ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}><span>{bs(x.amountCents)}{x.scopeCents !== x.amountCents && <span className="mg-split">cuenta aquí {bs(x.scopeCents)}</span>}</span></td>
                        <td data-label="Acciones">
                          <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                            {x.state === "draft" && x.canEdit !== false && <button className="btn btn-sm" onClick={() => confirm(x)} title="Confirmar (ya se pagó)"><Check size={15} />Confirmar</button>}
                            <button className="btn btn-ghost btn-icon" onClick={() => setFiles(x)} aria-label={`Comprobantes de ${x.description}`} title="Comprobantes"><Paperclip size={15} /></button>
                            {x.state === "draft" && x.canEdit !== false && <button className="btn btn-ghost btn-icon" onClick={() => setDlg(x)} aria-label={`Editar ${x.description}`}><Pencil size={15} /></button>}
                            {x.state !== "voided" && x.canEdit !== false && <button className="btn btn-ghost btn-icon" onClick={() => voidIt(x)} aria-label={`Anular ${x.description}`}><XCircle size={16} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head"><h2>Gastos fijos mensuales</h2><button className="btn btn-sm" onClick={() => setRdlg({})}><Plus size={15} />Nuevo gasto fijo</button></div>
        {!rec.data ? <Loading rows={2} /> : rec.data.length === 0 ? <Empty>Sin gastos fijos. Agrega el alquiler, los sueldos o los servicios para generarlos cada mes como borrador.</Empty> : (
          <div className="table-wrap">
            <table className="table mg-cards">
              <thead><tr><th>Descripción</th><th>Sucursal</th><th>Categoría</th><th>Día</th><th className="num">Monto</th><th>Último mes generado</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>{rec.data.map((t) => (
                <tr key={t.id}>
                  <td className="mg-head">{t.description}</td>
                  <td data-label="Sucursal">{t.shares?.length
                    ? <span>Compartido<span className="mg-split">{t.shares.map((sh: any) => `${sh.branchName} ${String(sh.percentBp / 100).replace(".", ",")} %`).join(" · ")}</span></span>
                    : t.branchName}</td>
                  <td data-label="Categoría">{t.categoryLabel}</td>
                  <td data-label="Día">{t.dayOfMonth}</td>
                  <td data-label="Monto" className="num">{bs(t.amountCents)}</td>
                  <td data-label="Último mes generado">{t.lastGenerated ? monthLabel(t.lastGenerated) : "—"}</td>
                  <td data-label="Estado">{t.active ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                  <td data-label="Acciones"><button className="btn btn-ghost btn-icon" onClick={() => setRdlg(t)} aria-label={`Editar ${t.description}`}><Pencil size={15} /></button></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dlg && <ExpenseDialog initial={dlg.id ? dlg : null} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); toast(dlg.id ? "Borrador actualizado" : "Gasto registrado"); reload(); }} />}
      {files && <AttachmentsDialog expense={files} onClose={() => setFiles(null)} onChanged={reload} />}
      {rdlg && <RecurringDialog initial={rdlg.id ? rdlg : null} onClose={() => setRdlg(null)} onSaved={() => { setRdlg(null); toast("Gasto fijo guardado"); reload(); }} />}
    </div>
  );
}
