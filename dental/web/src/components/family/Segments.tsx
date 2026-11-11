// Segmentos guardados por filtros, lista exportable y campaña manual con consentimiento (R2-38).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Megaphone, Save, Search } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { bs, fmtDate, fmtDateTime } from "../../lib/format";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "../ui";
import { TagChip, type PatientTagT } from "./PatientTags";

interface Filters {
  tagIds: string[]; tagMode: "any" | "all"; ageMin: number | null; ageMax: number | null; visitedWithinDays: number | null; noVisitDays: number | null;
  balance: "any" | "debt" | "credit" | "clear"; minDebtCents: number | null; branchId: string | null; pendingTreatment: boolean; overdueRecall: boolean;
}
const EMPTY: Filters = { tagIds: [], tagMode: "any", ageMin: null, ageMax: null, visitedWithinDays: null, noVisitDays: null, balance: "any", minDebtCents: null, branchId: null, pendingTreatment: false, overdueRecall: false };
interface Segment { id: string; name: string; filters: Filters }
interface Row { id: string; recordNumber: number; firstName: string; lastName: string; age: number | null; phone: string | null; branchName: string | null; tags: PatientTagT[]; lastVisit: string | null; balanceCents?: number; consentMarketing: boolean }

const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.floor(Number(s))));

export function SegmentsTab() {
  const { can, me } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const segs = useApi<Segment[]>("/api/segments");
  const tags = useApi<PatientTagT[]>("/api/patient-tags");
  const [f, setF] = useState<Filters>(EMPTY);
  const [current, setCurrent] = useState<Segment | null>(null);
  const [res, setRes] = useState<{ total: number; items: Row[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [campaign, setCampaign] = useState(false);
  const money = can("payments.read") || can("budgets.read");
  const visit = f.visitedWithinDays != null ? "within" : f.noVisitDays != null ? "none" : "any";

  const run = async (filters = f) => {
    setBusy(true); setErr(null);
    try { setRes(await api.post("/api/segments/preview", { filters })); } catch (e: any) { setErr(e.message); setRes(null); } finally { setBusy(false); }
  };
  const open = (s: Segment) => { const x = { ...EMPTY, ...s.filters }; setCurrent(s); setF(x); run(x); };
  const save = async () => {
    const name = await ask({ title: current ? "Guardar cambios del segmento" : "Guardar segmento", inputLabel: "Nombre del segmento", placeholder: "Ej.: Ortodoncia activa con deuda", confirmLabel: "Guardar" });
    if (!name) return;
    try {
      if (current) { await api.put(`/api/segments/${current.id}`, { name, filters: f }); setCurrent({ ...current, name, filters: f }); }
      else { const r = await api.post("/api/segments", { name, filters: f }); setCurrent({ id: r.id, name, filters: f }); }
      toast("Segmento guardado"); segs.reload();
    } catch (e: any) { toast(e.message, true); }
  };
  const archive = async () => {
    if (!current) return;
    const ok = await ask({ title: "Quitar segmento", message: `«${current.name}» deja de aparecer en la lista. Las campañas enviadas lo conservan.`, confirmLabel: "Quitar", danger: true });
    if (!ok) return;
    try { await api.post(`/api/segments/${current.id}/archive`); setCurrent(null); segs.reload(); toast("Segmento quitado"); } catch (e: any) { toast(e.message, true); }
  };
  const tagName = (id: string) => tags.data?.find((t) => t.id === id);
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row-between">
          <h2>Segmentos guardados</h2>
          {current && <span className="muted small">Editando: <b>{current.name}</b> · <button className="btn btn-ghost btn-sm" onClick={() => { setCurrent(null); setF(EMPTY); setRes(null); }}>Nuevo segmento</button></span>}
        </div>
        {!segs.data ? <Loading rows={1} /> : segs.data.length ? (
          <div className="xp-chips" role="group" aria-label="Segmentos guardados">
            {segs.data.map((s) => <button key={s.id} type="button" className="xp-chip xp-chip-toggle" aria-pressed={current?.id === s.id} onClick={() => open(s)}>{s.name}</button>)}
          </div>
        ) : <p className="muted small" style={{ margin: 0 }}>Todavía no hay segmentos guardados. Arma los filtros y guárdalos.</p>}
      </div>

      <div className="card card-pad stack">
        <h2>Filtros</h2>
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Etiquetas" group>
          <div className="stack-sm">
            <div className="xp-chips">
              {(tags.data ?? []).filter((t) => t.active).map((t) => (
                <button key={t.id} type="button" className="xp-chip xp-chip-toggle" aria-pressed={f.tagIds.includes(t.id)}
                  onClick={() => setF({ ...f, tagIds: f.tagIds.includes(t.id) ? f.tagIds.filter((x) => x !== t.id) : [...f.tagIds, t.id] })}>
                  <span className="dot" style={{ background: t.color }} aria-hidden="true" />{t.name}
                </button>
              ))}
              {tags.data && !tags.data.length && <span className="muted small">Sin etiquetas: créalas en la pestaña Etiquetas.</span>}
            </div>
            {f.tagIds.length > 1 && (
              <select className="input" style={{ maxWidth: 320 }} aria-label="Cómo combinar etiquetas" value={f.tagMode} onChange={(e) => setF({ ...f, tagMode: e.target.value as Filters["tagMode"] })}>
                <option value="any">Con cualquiera de las etiquetas</option><option value="all">Con todas las etiquetas</option>
              </select>
            )}
          </div>
        </Field>
        <div className="form-grid">
          <Field label="Edad" group>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input className="input" inputMode="numeric" aria-label="Edad desde" placeholder="Desde" value={f.ageMin ?? ""} onChange={(e) => setF({ ...f, ageMin: num(e.target.value) })} />
              <input className="input" inputMode="numeric" aria-label="Edad hasta" placeholder="Hasta" value={f.ageMax ?? ""} onChange={(e) => setF({ ...f, ageMax: num(e.target.value) })} />
            </div>
          </Field>
          <Field label="Última visita atendida" group>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select className="input" aria-label="Tipo de filtro de visita" value={visit} onChange={(e) => {
                const v = e.target.value;
                setF({ ...f, visitedWithinDays: v === "within" ? 90 : null, noVisitDays: v === "none" ? 180 : null });
              }}>
                <option value="any">Cualquiera</option><option value="within">Hace menos de…</option><option value="none">Sin visitas hace más de…</option>
              </select>
              {visit !== "any" && (
                <select className="input" aria-label="Días" value={(visit === "within" ? f.visitedWithinDays : f.noVisitDays) ?? 90}
                  onChange={(e) => setF({ ...f, [visit === "within" ? "visitedWithinDays" : "noVisitDays"]: Number(e.target.value) })}>
                  {[30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d < 365 ? `${d / 30} meses` : `${d / 365} ${d === 365 ? "año" : "años"}`}</option>)}
                </select>
              )}
            </div>
          </Field>
          {money && (
            <Field label="Saldo">
              <select className="input" value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value as Filters["balance"], minDebtCents: null })}>
                <option value="any">Cualquiera</option><option value="debt">Con deuda</option><option value="credit">Con saldo a favor</option><option value="clear">Al día</option>
              </select>
            </Field>
          )}
          {money && f.balance === "debt" && (
            <Field label="Deuda mayor a (Bs)"><input className="input" inputMode="decimal" value={f.minDebtCents != null ? f.minDebtCents / 100 : ""} onChange={(e) => setF({ ...f, minDebtCents: e.target.value ? Math.round(Number(e.target.value.replace(",", ".")) * 100) : null })} /></Field>
          )}
          <Field label="Sucursal (habitual o con citas)">
            <select className="input" value={f.branchId ?? ""} onChange={(e) => setF({ ...f, branchId: e.target.value || null })}>
              <option value="">Todas</option>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="row">
          {can("budgets.read") && <label className="check"><input type="checkbox" checked={f.pendingTreatment} onChange={(e) => setF({ ...f, pendingTreatment: e.target.checked })} />Con tratamiento aceptado pendiente</label>}
          {can("agenda.read") && <label className="check"><input type="checkbox" checked={f.overdueRecall} onChange={(e) => setF({ ...f, overdueRecall: e.target.checked })} />Con control vencido</label>}
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => run()}><Search size={16} />{busy ? "Buscando…" : "Ver pacientes"}</button>
          {can("patients.write") && <button className="btn" onClick={save}><Save size={16} />{current ? "Guardar cambios" : "Guardar segmento"}</button>}
          {current && can("patients.export") && <a className="btn" href={`/api/segments/${current.id}/export.xlsx`} download><Download size={16} />Exportar Excel</a>}
          {current && can("clinic.manage") && <button className="btn" onClick={() => setCampaign(true)}><Megaphone size={16} />Preparar campaña</button>}
          {current && can("patients.write") && <button className="btn btn-ghost" onClick={archive}>Quitar segmento</button>}
        </div>
        {!current && can("clinic.manage") && <p className="muted small" style={{ margin: 0 }}>Para exportar o preparar una campaña, guarda primero el segmento.</p>}
      </div>

      {res && (
        <div className="card">
          <div className="card-head"><h2>{res.total} {res.total === 1 ? "paciente" : "pacientes"}</h2>{res.total > res.items.length && <span className="muted small">Se muestran los primeros {res.items.length}</span>}</div>
          {res.items.length ? (
            <div className="table-wrap"><table className="table xp-table">
              <thead><tr><th>Paciente</th><th>Edad</th><th>Celular</th><th>Etiquetas</th><th>Última visita</th>{money && <th className="num">Saldo</th>}<th>Promociones</th></tr></thead>
              <tbody>{res.items.map((p) => (
                <tr key={p.id}>
                  <td className="xp-main"><Link to={`/pacientes/${p.id}`}>{p.firstName} {p.lastName}</Link><div className="muted small">Ficha {p.recordNumber}{p.branchName ? ` · ${p.branchName}` : ""}</div></td>
                  <td data-label="Edad">{p.age ?? "—"}</td>
                  <td data-label="Celular" className="nowrap">{p.phone ?? "—"}</td>
                  <td data-label="Etiquetas"><div className="xp-chips">{p.tags.map((t) => <TagChip key={t.id} tag={t} />)}</div></td>
                  <td data-label="Última visita">{p.lastVisit ? fmtDate(p.lastVisit) : <span className="muted">Nunca</span>}</td>
                  {money && <td data-label="Saldo" className="num">{bs(p.balanceCents ?? 0)}</td>}
                  <td data-label="Promociones">{p.consentMarketing ? <span className="badge ok">Acepta</span> : <span className="badge">No</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>Ningún paciente cumple estos filtros.</Empty>}
        </div>
      )}

      {can("clinic.manage") && <CampaignHistory key={String(campaign)} />}
      {campaign && current && <CampaignDialog segment={current} tagName={tagName} onClose={() => setCampaign(false)} />}
    </div>
  );
}

function CampaignDialog({ segment, onClose }: { segment: Segment; tagName: (id: string) => PatientTagT | undefined; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(`Campaña · ${segment.name}`);
  const [body, setBody] = useState("Hola {nombre}, en {clinica} te invitamos a tu revisión preventiva. Escríbenos para reservar tu hora.");
  const [pv, setPv] = useState<any | null>(null);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<any | null>(null);
  useEffect(() => { setPv(null); setConfirm(""); }, [body, name]);
  const preview = async () => {
    setBusy(true); setErr(null);
    try { setPv(await api.post("/api/campaigns/preview", { name, segmentId: segment.id, body })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post("/api/campaigns", { name, segmentId: segment.id, body, confirmCount: Number(confirm) }); setSent(r); toast("Campaña enviada a la bandeja"); }
    catch (e: any) { setErr(e.message); if (e.code === "count_changed") preview(); } finally { setBusy(false); }
  };
  const canSend = pv && !pv.errors.length && pv.eligible > 0 && !pv.overCap && !pv.quietNow && Number(confirm) === pv.eligible;
  return (
    <Dialog wide title="Campaña manual" onClose={onClose} footer={sent ? <button className="btn btn-primary" onClick={onClose}>Listo</button> : <>
      <button className="btn" onClick={onClose}>Cancelar</button>
      {!pv ? <button className="btn btn-primary" disabled={busy} onClick={preview}>{busy ? "Calculando…" : "Revisar destinatarios"}</button>
        : <button className="btn btn-primary" disabled={busy || !canSend} onClick={send}>{busy ? "Enviando…" : `Enviar a ${pv.eligible} ${pv.eligible === 1 ? "persona" : "personas"}`}</button>}
    </>}>
      <div className="stack xp">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {sent ? (
          <div className="alert ok" role="status">
            Quedaron {sent.recipients} mensajes en la bandeja{sent.mode === "simulate" ? " en modo de prueba (simulados: no salió ningún mensaje real)" : ""}. {sent.excluded} personas excluidas. Puedes revisarlos en <Link to="/mensajes">Mensajes</Link>.
          </div>
        ) : (
          <>
            <p className="muted small" style={{ margin: 0 }}>Segmento: <b>{segment.name}</b>. Solo recibe quien aceptó promociones y no se dio de baja. El mensaje no puede llevar datos clínicos: usa solo {"{nombre}"} y {"{clinica}"}.</p>
            <Field label="Nombre de la campaña"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Mensaje" hint={`${body.length} de 1000 caracteres. Al final se agrega: «Responde BAJA para no recibir más.»`}>
              <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={!!pv?.errors.length} />
            </Field>
            {pv?.errors.map((e: string) => <span key={e} className="hint" style={{ color: "var(--danger)" }} role="alert">{e}</span>)}
            {pv && !pv.errors.length && (
              <div className="stack">
                <div className="grid grid-2">
                  <div className="card kpi"><div className="label">Recibirán el mensaje</div><div className="value">{pv.eligible}</div><div className="foot">de {pv.segmentTotal} en el segmento</div></div>
                  <div className="card kpi"><div className="label">Excluidos</div><div className="value">{pv.excluded}</div><div className="foot">Tope por campaña: {pv.cap}</div></div>
                </div>
                {!!pv.reasons.length && (
                  <div className="stack-sm">
                    <b className="small">Por qué se excluyen</b>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{pv.reasons.map((r: any) => <li key={r.reason}>{r.label}: <b>{r.count}</b></li>)}</ul>
                  </div>
                )}
                {pv.example && <div className="card card-pad" style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)" }}><span className="muted small">Así lo verá {pv.eligible ? "el primer destinatario" : "un paciente"}:</span><br />{pv.example}</div>}
                {pv.warnings.map((w: string) => <div key={w} className="alert info small">{w}</div>)}
                {pv.mode === "simulate" && <div className="alert info small">Modo de prueba: los mensajes se guardan como simulados y no sale ninguno real.</div>}
                {pv.overCap && <div className="alert warn">La campaña supera el tope de {pv.cap} personas. Agrega filtros al segmento para dividirla.</div>}
                {pv.quietNow && <div className="alert warn">Es horario de silencio ({pv.quiet.start} a {pv.quiet.end}). Vuelve a intentarlo después de las {pv.quiet.end}.</div>}
                {pv.eligible > 0 && !pv.overCap && !pv.quietNow && (
                  <Field label={`Para confirmar, escribe el número de destinatarios (${pv.eligible})`}>
                    <input className="input" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} style={{ maxWidth: 160 }} />
                  </Field>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function CampaignHistory() {
  const list = useApi<any[]>("/api/campaigns");
  if (!list.data?.length) return null;
  return (
    <div className="card">
      <div className="card-head"><h2>Campañas enviadas</h2></div>
      <div className="table-wrap"><table className="table xp-table">
        <thead><tr><th>Campaña</th><th>Fecha</th><th className="num">Destinatarios</th><th className="num">Excluidos</th><th>Modo</th></tr></thead>
        <tbody>{list.data.map((k) => (
          <tr key={k.id}>
            <td className="xp-main">{k.name}<div className="muted small">{k.segmentName ?? "Filtros sin guardar"} · {k.createdBy}</div></td>
            <td data-label="Fecha">{fmtDateTime(k.createdAt)}</td>
            <td data-label="Destinatarios" className="num">{k.recipients}</td>
            <td data-label="Excluidos" className="num" title={k.excludedReasons.map((r: any) => `${r.label}: ${r.count}`).join("\n")}>{k.excluded}</td>
            <td data-label="Modo">{k.mode === "simulate" ? <span className="badge">Simulado</span> : <span className="badge info">Bandeja</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
