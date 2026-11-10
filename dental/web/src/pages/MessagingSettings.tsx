// Configuración → «Mensajes automáticos»: reglas de envío, plantillas con vista previa en vivo,
// horario de silencio, tope diario y el botón «Ejecutar ahora». Fuera de producción todo es simulado.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Play, Plus } from "lucide-react";
import { useApi, useDebounced } from "../lib/hooks";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Dialog, Empty, Field, Loading, useToast } from "../components/ui";

interface Settings {
  quietStart: string; quietEnd: string; maxPerDay: number; timezone: string; mode: "simulate" | "queue" | "provider";
  schedulerEnabled: boolean; portalEnabled: boolean; optOutLine: string;
  variables: { name: string; label: string }[];
  triggers: { id: string; label: string; variables: string[]; offset: { min: number; max: number; hint: string } }[];
}
interface Template { id: string; name: string; purpose: "reminders" | "marketing"; body: string; version: number; active: boolean; metaTemplateName: string | null; metaLanguage: string; rulesCount: number; versionAt: string; versionBy: string | null; meta: { text: string; params: string[] } }
interface Rule { id: string; name: string; trigger: string; triggerLabel: string; offsetMinutes: number; branchId: string | null; branchName: string | null; templateId: string; templateName: string; purpose: string; procedureId: string | null; procedureName: string | null; channel: string; active: boolean; pending: number; sent30d: number; skipped30d: number }

export const PURPOSE_LABEL: Record<string, string> = { reminders: "Recordatorios", marketing: "Marketing" };
const MODE: Record<string, { tone: string; text: string }> = {
  simulate: { tone: "info", text: "Modo de pruebas: ningún mensaje sale del sistema. Todo queda como «Simulado» en Mensajes." },
  queue: { tone: "warn", text: "Producción sin proveedor de WhatsApp configurado: los mensajes quedan en cola y no se envían." },
  provider: { tone: "ok", text: "WhatsApp Business (Cloud API) conectado: los mensajes se envían de verdad." },
};

/** "24 h antes de la cita", "7 días después de la visita"… */
export function whenText(trigger: string, minutes: number) {
  const amount = minutes % 1440 === 0 && minutes > 0 ? `${minutes / 1440} ${minutes === 1440 ? "día" : "días"}` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  switch (trigger) {
    case "appointment_created": return "Al agendar la cita";
    case "appointment_reminder": return `${amount} antes de la cita`;
    case "after_visit": return minutes ? `${amount} después de la visita` : "Al terminar la visita";
    case "recall_due": return minutes ? `${amount} antes de la fecha del control` : "El día del control";
    default: return `${amount} después de presentar el presupuesto`;
  }
}

export function MessagingSettingsTab() {
  const s = useApi<Settings>("/api/messaging/settings");
  const rules = useApi<Rule[]>("/api/messaging/rules");
  const templates = useApi<Template[]>("/api/messaging/templates");
  if (!s.data) return <div className="card">{s.error ? <div className="alert danger">{s.error}</div> : <Loading />}</div>;
  return (
    <div className="stack">
      <RunCard settings={s.data} onRun={() => rules.reload()} />
      <RulesCard settings={s.data} rules={rules.data} templates={templates.data ?? []} reload={() => rules.reload()} />
      <TemplatesCard settings={s.data} templates={templates.data} reload={() => { templates.reload(); rules.reload(); }} />
      <QuietCard settings={s.data} reload={s.reload} />
    </div>
  );
}

// ---------------- Estado y «Ejecutar ahora» ----------------
function RunCard({ settings, onRun }: { settings: Settings; onRun: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mode = MODE[settings.mode]!;
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/messaging/run");
      setLast(r); onRun();
      toast(`Listo: ${r.sent} mensaje(s) a la bandeja, ${r.skipped} omitido(s)`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="card-pad stack">
        <div className={`alert ${mode.tone}`}>{mode.text}</div>
        <p className="muted small" style={{ margin: 0 }}>
          {settings.schedulerEnabled
            ? "El programador revisa cada minuto qué mensajes tocan."
            : "El programador automático está apagado en este servidor (variable MESSAGING_SCHEDULER=1). Puedes ejecutarlo a mano."}
          {" "}Cada ejecución es segura: si la repites, no se duplican mensajes.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={run}><Play size={16} />{busy ? "Ejecutando…" : "Ejecutar ahora"}</button>
          <Link className="btn" to="/mensajes">Ver entregas</Link>
        </div>
        {err && <div className="alert danger" role="alert">{err}</div>}
        {last && (
          <p className="small" role="status" style={{ margin: 0 }}>
            Última ejecución: <b>{last.sent}</b> a la bandeja · <b>{last.planned}</b> programado(s) · <b>{last.skipped}</b> omitido(s) · <b>{last.cancelled}</b> anulado(s) · <b>{last.deferred}</b> postergado(s)
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------- Reglas ----------------
function RulesCard({ settings, rules, templates, reload }: { settings: Settings; rules: Rule[] | null; templates: Template[]; reload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (r: Rule) => {
    setBusy(r.id);
    try {
      await api.put(`/api/messaging/rules/${r.id}`, { name: r.name, trigger: r.trigger, offsetMinutes: r.offsetMinutes, branchId: r.branchId, templateId: r.templateId, procedureId: r.procedureId, channel: r.channel, active: !r.active });
      toast(r.active ? `Regla «${r.name}» desactivada` : `Regla «${r.name}» activada`);
      reload();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(null); }
  };
  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div><h2>Reglas de envío</h2><p className="muted small">Qué mensaje sale, cuándo y en qué sucursal. Sin consentimiento del paciente no se envía nada.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={16} />Nueva regla</button>
      </div>
      {!rules ? <Loading /> : !rules.length ? <Empty>Todavía no hay reglas.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Regla</th><th>Cuándo</th><th className="hide-mobile">Sucursal</th><th className="hide-mobile">Plantilla</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b><div className="muted small">{r.sent30d} enviado(s) y {r.skipped30d} omitido(s) en 30 días{r.pending ? ` · ${r.pending} programado(s)` : ""}</div></td>
              <td>{whenText(r.trigger, r.offsetMinutes)}{r.procedureName && <div className="muted small">Solo {r.procedureName}</div>}</td>
              <td className="hide-mobile">{r.branchName ?? "Todas"}</td>
              <td className="hide-mobile">{r.templateName} <span className={`badge ${r.purpose === "marketing" ? "warn" : "info"}`}>{PURPOSE_LABEL[r.purpose]}</span></td>
              <td>
                <button className={`btn btn-sm ${r.active ? "" : "btn-ghost"}`} aria-pressed={r.active} disabled={busy === r.id} onClick={() => toggle(r)}
                  aria-label={`${r.active ? "Desactivar" : "Activar"} regla ${r.name}`}>
                  <span className={`badge ${r.active ? "ok" : ""}`}>{r.active ? "Activa" : "Inactiva"}</span>
                </button>
              </td>
              <td><button className="btn btn-sm" onClick={() => setEdit(r)} aria-label={`Editar regla ${r.name}`}><Pencil size={14} />Editar</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <RuleDialog settings={settings} rule={edit === "new" ? null : edit} templates={templates} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function splitOffset(min: number): { value: string; unit: "min" | "h" | "d" } {
  if (min && min % 1440 === 0) return { value: String(min / 1440), unit: "d" };
  if (min && min % 60 === 0) return { value: String(min / 60), unit: "h" };
  return { value: String(min), unit: min ? "min" : "h" };
}
const UNIT_MIN = { min: 1, h: 60, d: 1440 } as const;

function RuleDialog({ settings, rule, templates, onClose, onSaved }: { settings: Settings; rule: Rule | null; templates: Template[]; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth();
  const procs = useApi<any[]>("/api/procedures");
  const init = rule ? splitOffset(rule.offsetMinutes) : { value: "24", unit: "h" as const };
  const [f, setF] = useState({
    name: rule?.name ?? "", trigger: rule?.trigger ?? "appointment_reminder", value: init.value, unit: init.unit as "min" | "h" | "d",
    branchId: rule?.branchId ?? "", templateId: rule?.templateId ?? "", procedureId: rule?.procedureId ?? "", active: rule?.active ?? true,
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trig = settings.triggers.find((t) => t.id === f.trigger)!;
  const apptTrigger = ["appointment_created", "appointment_reminder"].includes(f.trigger);
  const usable = templates.filter((t) => t.active && (!apptTrigger || t.purpose === "reminders"));
  const offsetMinutes = f.trigger === "appointment_created" ? 0 : Math.round(Number(f.value.replace(",", ".")) * UNIT_MIN[f.unit]);
  const save = async () => {
    const v: Record<string, string> = {};
    if (f.name.trim().length < 3) v.name = "Escribe un nombre (al menos 3 caracteres)";
    if (!f.templateId) v.templateId = "Elige una plantilla";
    if (f.trigger !== "appointment_created" && (!Number.isFinite(offsetMinutes) || offsetMinutes < trig.offset.min || offsetMinutes > trig.offset.max)) v.offsetMinutes = trig.offset.hint;
    setErrs(v); setErr(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const body = { name: f.name.trim(), trigger: f.trigger, offsetMinutes, branchId: f.branchId || null, templateId: f.templateId, procedureId: f.trigger === "after_visit" && f.procedureId ? f.procedureId : null, channel: "whatsapp", active: f.active };
    try {
      if (rule) await api.put(`/api/messaging/rules/${rule.id}`, body);
      else await api.post("/api/messaging/rules", body);
      onSaved();
    } catch (e: any) {
      const d: Record<string, string> = {};
      for (const x of e.details ?? []) if (x.path && !d[x.path]) d[x.path] = x.message;
      setErrs(d);
      if (!Object.keys(d).length) setErr(e.message);
    } finally { setBusy(false); }
  };
  const fe = (k: string) => errs[k] && <span className="hint" style={{ color: "var(--danger)" }} role="alert">{errs[k]}</span>;
  return (
    <Dialog title={rule ? "Editar regla" : "Nueva regla"} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar regla"}</button>
    </>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nombre de la regla" span2><input className="input" value={f.name} aria-invalid={!!errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej.: Recordatorio 24 h" /></Field>
          {fe("name")}
          <Field label="Cuándo se envía" span2 hint={rule ? "El momento de envío no se cambia en una regla existente." : undefined}>
            <select className="input" value={f.trigger} disabled={!!rule} onChange={(e) => {
              const t = e.target.value;
              const d = t === "appointment_reminder" ? { value: "24", unit: "h" as const } : t === "after_visit" ? { value: "1", unit: "d" as const } : t === "appointment_created" ? { value: "0", unit: "h" as const } : { value: "7", unit: "d" as const };
              setF({ ...f, trigger: t, ...d });
            }}>
              {settings.triggers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          {f.trigger !== "appointment_created" && (
            <Field label={f.trigger === "appointment_reminder" || f.trigger === "recall_due" ? "Anticipación" : "Espera"} group span2 hint={trig.offset.hint}>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" style={{ maxWidth: 110 }} inputMode="numeric" aria-label="Cantidad" aria-invalid={!!errs.offsetMinutes} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
                <select className="input" style={{ maxWidth: 150 }} aria-label="Unidad" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as any })}>
                  <option value="min">minutos</option><option value="h">horas</option><option value="d">días</option>
                </select>
              </div>
            </Field>
          )}
          {fe("offsetMinutes")}
          <Field label="Sucursal">
            <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <option value="">Todas las sucursales</option>
              {me?.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Plantilla">
            <select className="input" value={f.templateId} aria-invalid={!!errs.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
              <option value="">Elige…</option>
              {usable.map((t) => <option key={t.id} value={t.id}>{t.name} ({PURPOSE_LABEL[t.purpose]})</option>)}
            </select>
          </Field>
          {(errs.templateId || errs.branchId) && <div className="span-2">{fe("templateId")}{fe("branchId")}</div>}
          {f.trigger === "after_visit" && (
            <Field label="Solo después de esta prestación (opcional)" span2>
              <select className="input" value={f.procedureId} onChange={(e) => setF({ ...f, procedureId: e.target.value })}>
                <option value="">Cualquier prestación</option>
                {procs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Variables que sirven aquí: {trig.variables.map((v) => `{${v}}`).join(" ")}</p>
        {f.trigger === "after_visit" && <p className="muted small" style={{ margin: 0 }}>Opcional para la clínica: actívala solo si quieres enviar cuidados o una encuesta. Llega solo a quien aceptó recordatorios.</p>}
        {(f.trigger === "recall_due" || f.trigger === "budget_unanswered") && !settings.portalEnabled && <div className="alert warn">La reserva online está desactivada: {"{enlace_portal}"} se reemplazará por el teléfono de la sucursal.</div>}
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Regla activa</label>
      </div>
    </Dialog>
  );
}

// ---------------- Plantillas ----------------
function TemplatesCard({ settings, templates, reload }: { settings: Settings; templates: Template[] | null; reload: () => void }) {
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div><h2>Plantillas</h2><p className="muted small">Cada cambio de texto crea una versión nueva. Nunca incluyen tratamientos ni diagnósticos.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={16} />Nueva plantilla</button>
      </div>
      {!templates ? <Loading /> : !templates.length ? <Empty>No hay plantillas.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Plantilla</th><th className="hide-mobile">Texto</th><th>Versión</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{templates.map((t) => (
            <tr key={t.id}>
              <td><b>{t.name}</b><div><span className={`badge ${t.purpose === "marketing" ? "warn" : "info"}`}>{PURPOSE_LABEL[t.purpose]}</span>{!t.active && <span className="badge">Desactivada</span>}</div></td>
              <td className="hide-mobile small" style={{ maxWidth: 420 }}>{t.body}</td>
              <td className="nowrap">v{t.version}<div className="muted small">{fmtDateTime(t.versionAt)}</div></td>
              <td><button className="btn btn-sm" onClick={() => setEdit(t)} aria-label={`Editar plantilla ${t.name}`}><Pencil size={14} />Editar</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <TemplateDialog settings={settings} tpl={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function TemplateDialog({ settings, tpl, onClose, onSaved }: { settings: Settings; tpl: Template | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: tpl?.name ?? "", purpose: tpl?.purpose ?? "reminders", body: tpl?.body ?? "Hola {nombre}, ", metaTemplateName: tpl?.metaTemplateName ?? "", metaLanguage: tpl?.metaLanguage ?? "es", active: tpl?.active ?? true });
  const [pv, setPv] = useState<{ ok: boolean; errors: { message: string }[]; warnings: string[]; preview: string | null; meta: { text: string; params: string[] }; length: number } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const body = useDebounced(f.body, 300);
  useEffect(() => {
    let alive = true;
    api.post("/api/messaging/templates/preview", { body, purpose: f.purpose }).then((r) => alive && setPv(r)).catch(() => {});
    return () => { alive = false; };
  }, [body, f.purpose]);
  const insert = (v: string) => {
    const el = area.current;
    const tag = `{${v}}`;
    if (!el) return setF({ ...f, body: f.body + tag });
    const a = el.selectionStart ?? f.body.length, b = el.selectionEnd ?? a;
    const next = f.body.slice(0, a) + tag + f.body.slice(b);
    setF({ ...f, body: next });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const live = pv && body === f.body ? pv : null;
  const save = async () => {
    const v: Record<string, string> = {};
    if (f.name.trim().length < 3) v.name = "Escribe un nombre (al menos 3 caracteres)";
    if (live && !live.ok) v.body = live.errors[0]!.message;
    setErrs(v); setErr(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const payload = { name: f.name.trim(), body: f.body, metaTemplateName: f.metaTemplateName || null, metaLanguage: f.metaLanguage || "es" };
      const r = tpl ? await api.put(`/api/messaging/templates/${tpl.id}`, { ...payload, active: f.active }) : await api.post("/api/messaging/templates", { ...payload, purpose: f.purpose });
      toast(tpl && r.version !== tpl.version ? `Plantilla guardada como versión ${r.version}` : "Plantilla guardada");
      onSaved();
    } catch (e: any) {
      const d: Record<string, string> = {};
      for (const x of e.details ?? []) if (x.path && !d[x.path]) d[x.path] = x.message;
      setErrs(d);
      if (!Object.keys(d).length) setErr(e.message);
    } finally { setBusy(false); }
  };
  const bodyErrors = live?.errors ?? [];
  return (
    <Dialog wide title={tpl ? `Editar plantilla (v${tpl.version})` : "Nueva plantilla"} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={busy || bodyErrors.length > 0} onClick={save}>{busy ? "Guardando…" : "Guardar plantilla"}</button>
    </>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nombre de la plantilla"><input className="input" value={f.name} aria-invalid={!!errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Propósito" hint={tpl ? "El propósito no cambia: crea otra plantilla si lo necesitas." : "Marketing solo llega a quien aceptó promociones."}>
            <select className="input" value={f.purpose} disabled={!!tpl} onChange={(e) => setF({ ...f, purpose: e.target.value as any })}>
              <option value="reminders">Recordatorios (citas, cuidados, controles)</option>
              <option value="marketing">Marketing (promociones, campañas)</option>
            </select>
          </Field>
          {errs.name && <span className="hint span-2" style={{ color: "var(--danger)" }} role="alert">{errs.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="tpl-body" className="label">Texto del mensaje</label>
          <textarea id="tpl-body" ref={area} className="input" rows={5} style={{ minHeight: 120, resize: "vertical" }} value={f.body}
            aria-invalid={bodyErrors.length > 0 || !!errs.body} aria-describedby="tpl-body-msg" onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div id="tpl-body-msg" className="stack-sm" aria-live="polite">
            {bodyErrors.map((x, i) => <span key={i} className="hint" style={{ color: "var(--danger)", display: "block" }}>{x.message}</span>)}
            {!bodyErrors.length && errs.body && <span className="hint" style={{ color: "var(--danger)", display: "block" }}>{errs.body}</span>}
            {live?.warnings.map((x, i) => <span key={i} className="hint" style={{ display: "block" }}>{x}</span>)}
            <span className="hint">{f.body.length} / 1000 caracteres</span>
          </div>
        </div>
        <div role="group" aria-label="Insertar variable" className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {settings.variables.map((v) => <button key={v.name} type="button" className="btn btn-sm" title={v.label} onClick={() => insert(v.name)}>{`{${v.name}}`}</button>)}
        </div>
        <div className="card" style={{ background: "var(--bg)" }}>
          <div className="card-pad stack-sm">
            <b className="small">Vista previa (datos ficticios)</b>
            {live?.preview ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }} data-testid="tpl-preview">{live.preview}</p> : <p className="muted small" style={{ margin: 0 }}>{bodyErrors.length ? "Corrige el texto para ver la vista previa." : "Escribe el mensaje…"}</p>}
          </div>
        </div>
        <details>
          <summary className="small">WhatsApp Cloud API (producción)</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <p className="muted small" style={{ margin: 0 }}>Meta exige registrar cada plantilla antes de usarla. Registra este texto con el mismo nombre; las variables van en este orden: {live?.meta.params.map((p) => `{${p}}`).join(", ") || "ninguna"}.</p>
            {live && <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, padding: 10, background: "var(--bg)", borderRadius: 8 }}>{live.meta.text}</pre>}
            <div className="form-grid">
              <Field label="Nombre aprobado en Meta" hint="Minúsculas y guion bajo, p. ej. recordatorio_cita"><input className="input" value={f.metaTemplateName} onChange={(e) => setF({ ...f, metaTemplateName: e.target.value })} /></Field>
              <Field label="Idioma"><input className="input" value={f.metaLanguage} onChange={(e) => setF({ ...f, metaLanguage: e.target.value })} /></Field>
            </div>
            {(errs.metaTemplateName || errs.metaLanguage) && <span className="hint" style={{ color: "var(--danger)" }} role="alert">{errs.metaTemplateName ?? errs.metaLanguage}</span>}
          </div>
        </details>
        {tpl && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Plantilla activa</label>}
        {errs.active && <span className="hint" style={{ color: "var(--danger)" }} role="alert">{errs.active}</span>}
      </div>
    </Dialog>
  );
}

// ---------------- Horario de silencio y tope ----------------
function QuietCard({ settings, reload }: { settings: Settings; reload: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ quietStart: settings.quietStart, quietEnd: settings.quietEnd, maxPerDay: String(settings.maxPerDay) });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v: Record<string, string> = {};
    if (!/^\d{2}:\d{2}$/.test(f.quietStart)) v.quietStart = "Hora inválida";
    if (!/^\d{2}:\d{2}$/.test(f.quietEnd)) v.quietEnd = "Hora inválida";
    const n = Number(f.maxPerDay);
    if (!Number.isInteger(n) || n < 1 || n > 10) v.maxPerDay = "Entre 1 y 10 mensajes";
    setErrs(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await api.put("/api/messaging/settings", { quietStart: f.quietStart, quietEnd: f.quietEnd, maxPerDay: n });
      toast("Horario de silencio guardado"); reload();
    } catch (e: any) {
      const d: Record<string, string> = {};
      for (const x of e.details ?? []) if (x.path) d[x.path] = x.message;
      setErrs(Object.keys(d).length ? d : { quietStart: e.message });
    } finally { setBusy(false); }
  };
  const fe = (k: string) => errs[k] && <span className="hint" style={{ color: "var(--danger)" }} role="alert">{errs[k]}</span>;
  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}><div><h2>Horario de silencio y tope diario</h2><p className="muted small">Hora de {settings.timezone}. Lo que toque en silencio sale al terminar; un recordatorio que quedaría sin margen sale antes de que empiece.</p></div></div>
      <div className="card-pad stack">
        <div className="form-grid">
          <Field label="Silencio desde"><input type="time" className="input" value={f.quietStart} aria-invalid={!!errs.quietStart} onChange={(e) => setF({ ...f, quietStart: e.target.value })} /></Field>
          <Field label="Silencio hasta"><input type="time" className="input" value={f.quietEnd} aria-invalid={!!errs.quietEnd} onChange={(e) => setF({ ...f, quietEnd: e.target.value })} /></Field>
          {(errs.quietStart || errs.quietEnd) && <div className="span-2">{fe("quietStart") || fe("quietEnd")}</div>}
          <Field label="Máximo de mensajes por paciente al día" hint="Los avisos de cita tienen prioridad; el resto pasa al día siguiente.">
            <input className="input" inputMode="numeric" value={f.maxPerDay} aria-invalid={!!errs.maxPerDay} onChange={(e) => setF({ ...f, maxPerDay: e.target.value })} />
          </Field>
          {fe("maxPerDay")}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Iguales (p. ej. 00:00 y 00:00) = sin horario de silencio. Los mensajes de marketing siempre terminan con «{settings.optOutLine}».</p>
        <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}
