// Presupuestos v2 (B-045): compartir con el paciente, versiones, sesiones, seguimiento y embudo.
import { useState } from "react";
import { Check, Copy, FilePlus2, Hand, History, Link2, MessageCircle, PhoneCall, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDate, fmtDateTime, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, StatusBadge, useToast } from "./ui";

// ---------------------------------------------------------------------------
// Cálculo en el navegador (vista previa): mismo reparto que el servidor
// ---------------------------------------------------------------------------
export function prorate(total: number, weights: number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  const W = weights.reduce((s, w) => s + w, 0);
  if (!n || !total || !W) return out;
  let last = -1;
  for (let i = n - 1; i >= 0; i--) if (weights[i]! > 0) { last = i; break; }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i === last) continue;
    out[i] = Number((2n * BigInt(total) * BigInt(weights[i]!) + BigInt(W)) / (2n * BigInt(W)));
    acc += out[i]!;
  }
  out[last] = total - acc;
  return out;
}
export const pctOf = (cents: number, pct: number) => Number((BigInt(cents) * BigInt(Math.round(pct * 100)) + 5000n) / 10000n);
export const parsePct = (s: string) => Number(String(s).replace(",", "."));

export const ymd = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

const REL: Record<string, string> = { patient: "Paciente", guardian: "Madre, padre o tutor" };
const CHANNEL: Record<string, string> = { link: "Enlace", whatsapp: "WhatsApp", in_hand: "En mano / impreso", phone: "Teléfono", in_person: "En persona", other: "Otro" };
const EVENT: Record<string, string> = {
  link_created: "Enlace creado", link_revoked: "Enlace revocado", delivered: "Entregado en mano", whatsapp_opened: "Enviado por WhatsApp",
  verify_failed: "Intento de verificación fallido", link_locked: "Enlace bloqueado por intentos", viewed: "Visto por el paciente",
  accepted: "Aceptado por el paciente en línea", rejected: "El paciente respondió «No me interesa»", follow_up: "Seguimiento de recepción", version_created: "Versión creada",
};

// ---------------------------------------------------------------------------
// Compartir, entregar y actividad (R2-14, R2-15)
// ---------------------------------------------------------------------------
export function SharePanel({ budget, onChanged }: { budget: any; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const act = useApi<any>(`/api/budgets/${budget.id}/activity`, [budget.status]);
  const [link, setLink] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const writable = can("budgets.write") && budget.isLatest;
  const shareable = writable && ["draft", "presented", "accepted", "completed"].includes(budget.status);
  const create = async () => {
    setBusy(true); setErr(null);
    try { setLink(await api.post(`/api/budgets/${budget.id}/share-links`)); setCopied(false); act.reload(); onChanged(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setCopied(true); toast("Enlace copiado"); }
    catch { (document.getElementById("share-url") as HTMLInputElement | null)?.select(); toast("Selecciona el enlace y cópialo", true); }
  };
  const delivered = async () => {
    setErr(null);
    try { await api.post(`/api/budgets/${budget.id}/delivered`, {}); toast("Entrega registrada"); act.reload(); onChanged(); } catch (e: any) { setErr(e.message); }
  };
  const revoke = async (id: string) => {
    try { await api.post(`/api/budget-share-links/${id}/revoke`); toast("Enlace revocado"); act.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const a = act.data;
  return (
    <section className="card card-pad stack" aria-label="Compartir con el paciente">
      <div className="row-between"><h3>Enviar al paciente</h3>{budget.firstViewedAt && <span className="badge info">Visto {fmtDateTime(budget.firstViewedAt)}</span>}</div>
      {err && <div className="alert danger" role="alert">{err}</div>}
      {shareable && (
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={create}><Link2 size={15} />{link ? "Crear otro enlace" : "Compartir enlace"}</button>
          {["draft", "presented"].includes(budget.status) && <button className="btn" onClick={delivered}><Hand size={15} />Entregado en mano</button>}
          {budget.status === "presented" && <button className="btn" onClick={() => setFollowUp(true)}><PhoneCall size={15} />Registrar seguimiento</button>}
        </div>
      )}
      {link && (
        <div className="stack-sm" style={{ background: "var(--surface-2)", padding: 12, borderRadius: 10 }}>
          <Field label="Enlace para el paciente" hint={`Vence el ${fmtDate(link.expiresAt)}. El paciente confirmará su celular o fecha de nacimiento antes de ver nada.`}>
            <input id="share-url" className="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="row">
            <button className="btn" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copiado" : "Copiar enlace"}</button>
            {link.whatsappUrl
              ? <a className="btn" href={link.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => { api.post(`/api/budgets/${budget.id}/events`, { kind: "whatsapp_opened", linkId: link.linkId }).then(act.reload).catch(() => {}); }}><MessageCircle size={15} />Abrir en WhatsApp</a>
              : <span className="muted small">{link.whatsappBlockedReason}</span>}
          </div>
          <p className="muted small">El mensaje de WhatsApp no incluye tratamientos ni montos.</p>
        </div>
      )}
      {!a ? <Loading rows={2} /> : (
        <>
          {a.links.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Enlace</th><th>Estado</th><th className="num">Vistas</th><th /></tr></thead>
              <tbody>{a.links.map((l: any) => (
                <tr key={l.id}>
                  <td><div>{fmtDateTime(l.createdAt)}</div><div className="muted small">{l.createdByName} · vence {fmtDate(l.expiresAt)}</div></td>
                  <td><span className={`badge ${l.state === "active" ? "ok" : l.state === "locked" ? "danger" : ""}`}>{{ active: "Activo", locked: "Bloqueado", revoked: "Revocado", expired: "Vencido" }[l.state as string]}</span>
                    {l.state === "locked" && <div className="muted small">Crea un enlace nuevo</div>}</td>
                  <td className="num">{l.views}</td>
                  <td className="num">{l.state === "active" && can("budgets.write") && <button className="btn btn-sm btn-danger" onClick={() => revoke(l.id)}>Revocar</button>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          {a.events.filter((e: any) => e.kind !== "verify_failed").length > 0 && (
            <ul className="stack-sm" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Actividad">
              {a.events.filter((e: any) => e.kind !== "verify_failed").slice(0, 12).map((e: any) => (
                <li key={e.id} className="row-between" style={{ alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <b>{EVENT[e.kind] ?? e.kind}</b>
                    {e.kind === "accepted" && <div className="small">{e.signerName} ({REL[e.signerRelationship]}) · huella {String(e.contentHash).slice(0, 12)}…</div>}
                    {e.kind === "accepted" && e.signaturePng && <img src={e.signaturePng} alt={`Firma de ${e.signerName}`} style={{ maxWidth: 220, maxHeight: 80, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, marginTop: 4 }} />}
                    {e.reason && <div className="small muted">{e.kind === "rejected" ? "Motivo: " : ""}{e.reason}</div>}
                    {e.channel && e.kind === "follow_up" && <div className="small muted">{CHANNEL[e.channel]}</div>}
                  </div>
                  <div className="small muted" style={{ textAlign: "right", flex: "none" }}>{fmtDateTime(e.createdAt)}<div>{e.actorName ?? (["viewed", "accepted", "rejected"].includes(e.kind) ? "Paciente" : "")}</div></div>
                </li>))}
            </ul>
          )}
        </>
      )}
      {followUp && <FollowUpDialog budgetId={budget.id} onClose={() => setFollowUp(false)} onSaved={() => { setFollowUp(false); act.reload(); onChanged(); }} />}
    </section>
  );
}

export function FollowUpDialog({ budgetId, onClose, onSaved }: { budgetId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [channel, setChannel] = useState("phone");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api.post(`/api/budgets/${budgetId}/events`, { kind: "follow_up", channel, note: note || null }); toast("Seguimiento registrado"); onSaved(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Dialog title="Registrar seguimiento" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <p className="muted">Anota el contacto con el paciente. No se envía ningún mensaje automático.</p>
        <Field label="Medio"><select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="phone">Llamada</option><option value="whatsapp">WhatsApp</option><option value="in_person">En persona</option><option value="other">Otro</option></select></Field>
        <Field label="Resultado" hint="Por ejemplo: «Lo consulta con su familia, llamar el viernes»"><textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Versiones (R2-13)
// ---------------------------------------------------------------------------
export function VersionPanel({ budget, onOpen }: { budget: any; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hist = useApi<any[]>(budget.versionsCount > 1 ? `/api/budgets/${budget.id}/versions` : null, [budget.status]);
  const started = budget.doneCents !== 0 || budget.items.some((i: any) => i.status === "done" || i.sessions?.some((s: any) => s.status === "done"));
  const blockedReason = started ? "Ya tiene tratamientos realizados: para cambios, crea un presupuesto nuevo con lo que falta."
    : budget.paidCents > 0 || budget.pendingVerificationCents > 0 ? "Tiene pagos registrados: para cambios, crea un presupuesto nuevo o anula los pagos." : null;
  const canVersion = can("budgets.write") && budget.isLatest && !blockedReason && ["draft", "presented", "accepted", "rejected"].includes(budget.status);
  const create = async () => {
    setErr(null);
    try { const r = await api.post(`/api/budgets/${budget.id}/versions`, { confirm: true }); toast(`Versión ${r.version} creada como borrador`); setConfirm(false); onOpen(r.id); }
    catch (e: any) { setErr(e.message); }
  };
  if (!canVersion && budget.versionsCount <= 1 && !(blockedReason && can("budgets.write") && budget.isLatest)) return null;
  return (
    <section className="card card-pad stack" aria-label="Versiones">
      <div className="row-between"><h3><History size={16} style={{ verticalAlign: "-2px" }} /> Versiones</h3>
        {canVersion && <button className="btn btn-sm" onClick={() => setConfirm(true)}><FilePlus2 size={14} />Nueva versión</button>}</div>
      {blockedReason && budget.isLatest && <p className="muted small">{blockedReason}</p>}
      {budget.versionsCount <= 1 ? (!blockedReason && <p className="muted small">Si el paciente pide cambios, crea una nueva versión: la actual quedará reemplazada.</p>)
        : !hist.data ? <Loading rows={2} /> : (
          <ol className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
            {hist.data.map((v) => (
              <li key={v.id}>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => onOpen(v.id)} aria-current={v.id === budget.id ? "true" : undefined} style={{ fontWeight: v.id === budget.id ? 700 : 560 }}>v{v.version}</button>
                  <StatusBadge status={v.status} label={{ draft: "Borrador", presented: "Presentado", accepted: "Aceptado", rejected: "Rechazado", superseded: "Reemplazado", cancelled: "Anulado", completed: "Completado" }[v.status as string]} />
                  <span className="small">{bs(v.totalCents)}</span>
                  {v.previousTotalCents != null && v.previousTotalCents !== v.totalCents && <span className="small muted">(antes {bs(v.previousTotalCents)})</span>}
                  <span className="small muted">{fmtDate(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ""}</span>
                </div>
                {v.changes.length > 0 && <ul className="small muted" style={{ margin: "2px 0 0", paddingLeft: 16 }}>{v.changes.map((c: any, k: number) => (
                  <li key={k}>{c.kind === "added" ? `Agregado: ${c.label} (${bs(c.toCents)})` : c.kind === "removed" ? `Quitado: ${c.label} (${bs(c.fromCents)})` : `Cambiado: ${c.label} (${bs(c.fromCents)} → ${bs(c.toCents)})`}</li>))}</ul>}
              </li>))}
          </ol>
        )}
      {confirm && (
        <Dialog title={`Crear versión ${budget.version + 1}`} onClose={() => setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancelar</button><button className="btn btn-primary" onClick={create}>Crear versión {budget.version + 1}</button></>}>
          <div className="stack">
            {err && <div className="alert danger" role="alert">{err}</div>}
            <p>Se creará un borrador con las mismas líneas y descuentos para que lo ajustes.</p>
            <div className="alert warn">La versión {budget.version} quedará <b>reemplazada</b>: ya no se podrá aceptar ni cobrar, y si el paciente abre su enlace verá que hay una versión más reciente.</div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sesiones de una línea (R2-09)
// ---------------------------------------------------------------------------
export function SessionList({ item, budgetStatus, onChanged }: { item: any; budgetStatus: string; onChanged: () => void }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const staff = useApi<any[]>(can("treatments.perform") && budgetStatus === "accepted" ? "/api/staff?professionals=1" : null);
  const [who, setWho] = useState(me?.user.id ?? "");
  if (!item.sessions?.length) return null;
  const done = item.sessions.filter((s: any) => s.status === "done").length;
  const perform = async (id: string) => {
    try { const r = await api.post(`/api/budget-item-sessions/${id}/perform`, { dentistId: who || null }); toast(r.itemDone ? "Última sesión registrada: tratamiento completo" : "Sesión registrada"); onChanged(); }
    catch (e: any) { toast(e.message, true); }
  };
  const canDo = can("treatments.perform") && budgetStatus === "accepted" && item.status === "pending";
  return (
    <div className="stack-sm" style={{ marginTop: 6 }}>
      <span className="small muted">{done}/{item.sessions.length} sesiones</span>
      {canDo && staff.data && staff.data.length > 1 && (
        <label className="small row" style={{ gap: 6 }}>Realiza:
          <select className="input" style={{ minHeight: 32, width: "auto", padding: "2px 8px" }} value={who} onChange={(e) => setWho(e.target.value)}>
            {staff.data.map((s) => <option key={s.userId} value={s.userId}>{s.fullName}</option>)}
          </select></label>
      )}
      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
        {item.sessions.map((s: any) => (
          <li key={s.id} style={{ marginBottom: 4 }}>
            <span className="row" style={{ gap: 6 }}>
              <span>{s.name} · {bs(s.amountCents)}</span>
              {s.status === "done" ? <span className="badge ok">Realizada{s.performedByName ? ` · ${s.performedByName}` : ""}</span>
                : canDo ? <button className="btn btn-sm" onClick={() => perform(s.id)}>Sesión realizada</button> : <span className="badge">Pendiente</span>}
            </span>
          </li>))}
      </ol>
    </div>
  );
}

/** Editor de la plantilla de sesiones de una prestación (Configuración → Prestaciones). */
export function SessionTemplateEditor({ procedure }: { procedure: any }) {
  const toast = useToast();
  const tpl = useApi<any[]>("/api/procedure-sessions");
  const current = tpl.data?.find((x) => x.procedureId === procedure.id)?.sessions as any[] | undefined;
  const [rows, setRows] = useState<{ name: string; amount: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = rows ?? (current ?? []).map((s) => ({ name: s.name, amount: toBsInput(s.amountCents) }));
  const sum = list.reduce((s, r) => s + (parseBs(r.amount || "0") || 0), 0);
  const save = async () => {
    setErr(null);
    try {
      await api.put(`/api/procedures/${procedure.id}/sessions`, { sessions: list.map((r) => ({ name: r.name, amountCents: parseBs(r.amount || "0") })) });
      toast(list.length ? "Sesiones guardadas" : "La prestación ya no se divide en sesiones"); setRows(null); tpl.reload();
    } catch (e: any) { setErr(e.message); }
  };
  if (!tpl.data) return <Loading rows={1} />;
  return (
    <div className="stack-sm" role="group" aria-label="Sesiones">
      <span className="label">Sesiones (opcional)</span>
      <span className="muted small">Para tratamientos en varias citas (p. ej. corona: toma de medidas y colocación). Cada sesión realizada genera su cobro; la suma debe ser igual al precio.</span>
      {err && <div className="alert danger" role="alert">{err}</div>}
      {list.map((r, k) => (
        <div key={k} className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" aria-label={`Nombre de la sesión ${k + 1}`} value={r.name} placeholder={`Sesión ${k + 1}`} onChange={(e) => setRows(list.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} />
          <input className="input" style={{ width: 110 }} aria-label={`Monto de la sesión ${k + 1} (Bs)`} inputMode="decimal" value={r.amount} onChange={(e) => setRows(list.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)))} />
          <button type="button" className="btn btn-ghost btn-icon" aria-label={`Quitar sesión ${k + 1}`} onClick={() => setRows(list.filter((_, j) => j !== k))}><Trash2 size={16} /></button>
        </div>))}
      <div className="row-between">
        <button type="button" className="btn btn-sm" onClick={() => setRows([...list, { name: "", amount: "0" }])}><Plus size={14} />Agregar sesión</button>
        {list.length > 0 && <span className={`small ${sum === procedure.priceCents ? "muted" : ""}`} style={sum !== procedure.priceCents ? { color: "var(--danger)" } : undefined}>Suma {bs(sum)} de {bs(procedure.priceCents)}</span>}
      </div>
      {rows && <button type="button" className="btn btn-sm btn-primary" onClick={save}>Guardar sesiones</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decisión manual del personal (sin window.prompt)
// ---------------------------------------------------------------------------
export function DecisionDialog({ title, onClose, onConfirm, danger }: { title: string; onClose: () => void; onConfirm: (note: string | null) => Promise<void>; danger?: boolean }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { try { await onConfirm(note.trim() || null); } catch (e: any) { setErr(e.message); } };
  return (
    <Dialog title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={go}>Confirmar</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Nota (opcional)" hint="Cómo se aceptó o rechazó, firma en papel, motivo, etc."><textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Embudo (R2-16)
// ---------------------------------------------------------------------------
const BUCKETS = [
  { id: "presentedNoResponse", title: "Presentado sin respuesta", empty: "Ningún presupuesto espera respuesta.", help: "Seguimiento sugerido a los 7 y 14 días (lo hace recepción; no se envía nada automático)." },
  { id: "acceptedNoAppointment", title: "Aceptado sin cita", empty: "Todos los aceptados tienen cita.", help: "Aceptaron pero aún no tienen una cita futura." },
  { id: "inProgressNoNext", title: "En curso sin próxima cita", empty: "Todos los tratamientos en curso tienen su próxima cita.", help: "Ya empezaron el tratamiento y no tienen una cita futura." },
  { id: "expired", title: "Vencido", empty: "No hay presupuestos vencidos.", help: "Pasó la fecha de validez sin respuesta." },
] as const;

export function BudgetFunnel({ branchId, onOpen }: { branchId: string | null; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const f = useApi<any>(`/api/budget-funnel${qs({ branchId })}`);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [daysErr, setDaysErr] = useState<string | null>(null);
  if (!f.data) return <Loading rows={6} />;
  const d = f.data;
  const saveDays = async () => {
    setDaysErr(null);
    try { await api.put("/api/budget-settings", { validityDays: Number(days) }); toast("Validez actualizada"); setDays(null); f.reload(); } catch (e: any) { setDaysErr(e.message); }
  };
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="label">Conversión ({d.periodDays} días)</div><div className="value">{d.conversion.conversionPct == null ? "—" : `${d.conversion.conversionPct} %`}</div><div className="foot">{d.conversion.accepted} de {d.conversion.presented} presentados</div></div>
        <div className="card kpi"><div className="label">Aceptado</div><div className="value">{bs(d.conversion.acceptedCents)}</div><div className="foot">de {bs(d.conversion.presentedCents)} presentados</div></div>
        <div className="card kpi"><div className="label">Esperando respuesta</div><div className="value">{d.buckets.presentedNoResponse.length}</div><div className="foot">{d.buckets.presentedNoResponse.filter((x: any) => x.followUpDue).length} con seguimiento pendiente</div></div>
        <div className="card kpi"><div className="label">Aceptados en línea</div><div className="value">{d.conversion.acceptedOnline}</div><div className="foot">{d.conversion.rejected} rechazados</div></div>
      </div>
      {BUCKETS.map((b) => {
        const rows = d.buckets[b.id] as any[];
        return (
          <section key={b.id} className="card" aria-label={b.title}>
            <div className="card-head"><div><h2>{b.title} <span className="badge">{rows.length}</span></h2><p className="muted small">{b.help}</p><p className="muted small">Días en este estado a la derecha.</p></div></div>
            {rows.length === 0 ? <Empty>{b.empty}</Empty> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {rows.map((r) => (
                  <li key={r.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 18px" }}>
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                      <button className="btn-ghost" onClick={() => onOpen(r.id)} style={{ border: 0, background: "none", padding: 0, textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", minWidth: 0, minHeight: 40 }}
                        aria-label={`Abrir presupuesto ${r.number} de ${r.patientName}`}>
                        <b>{r.patientName}</b>
                        <div className="muted small">N° {r.number}{r.version > 1 ? ` v${r.version}` : ""} · {r.branchName} · {r.dentistName}</div>
                      </button>
                      <div style={{ textAlign: "right", flex: "none" }}>
                        <div className="nowrap"><b style={{ fontSize: 18 }}>{r.daysInState}</b> d</div>
                        <div className="small muted nowrap">{bs(r.totalCents)}</div>
                      </div>
                    </div>
                    <div className="row-between" style={{ marginTop: 6 }}>
                      <div className="row" style={{ gap: 4 }}>
                        {r.followUpDue && <span className="badge warn">Seguimiento {r.followUpDue} d</span>}
                        {b.id === "presentedNoResponse" && (r.firstViewedAt ? <span className="badge info">Visto</span> : <span className="badge">No visto</span>)}
                        {r.followUps > 0 && <span className="badge">{r.followUps} contacto{r.followUps > 1 ? "s" : ""}</span>}
                        {b.id === "expired" && <span className="badge danger">Venció {ymd(r.validDate)}</span>}
                      </div>
                      {can("budgets.write") && b.id !== "expired" && <button className="btn btn-sm" style={{ minHeight: 40 }} onClick={() => setFollowUp(r.id)}>Registrar seguimiento</button>}
                    </div>
                  </li>))}
              </ul>
            )}
          </section>
        );
      })}
      <div className="card card-pad stack-sm">
        <span className="muted small">Validez por defecto de un presupuesto sin fecha: <b>{d.validityDays} días</b> desde que se presenta.</span>
        {can("clinic.manage") && (days === null ? <div><button className="btn btn-sm" onClick={() => setDays(String(d.validityDays))}>Cambiar validez</button></div> : (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Días de validez (7 a 180)" hint={daysErr ?? undefined}><input className="input" type="number" min={7} max={180} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!!daysErr} style={{ width: 140 }} /></Field>
            <button className="btn btn-primary" onClick={saveDays}>Guardar</button><button className="btn" onClick={() => setDays(null)}>Cancelar</button>
          </div>
        ))}
      </div>
      {followUp && <FollowUpDialog budgetId={followUp} onClose={() => setFollowUp(null)} onSaved={() => { setFollowUp(null); f.reload(); }} />}
    </div>
  );
}
