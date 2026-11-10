// Configuración → "Reserva online": activar, dirección pública, reglas, modo por sucursal,
// WhatsApp y mapa por sucursal, prestaciones reservables y precio "desde".
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { bs, parseBs, toBsInput } from "../lib/format";
import { Field, Loading, useToast } from "../components/ui";

interface BranchCfg { branchId: string; name: string; address: string | null; enabled: boolean; mode: "instant" | "request"; whatsapp: string; mapUrl: string }
interface ServiceCfg { procedureId: string; name: string; category: string; durationMin: number; priceCents: number; bookable: boolean; priceFrom: string }

export function PortalSettingsTab() {
  const toast = useToast();
  const s = useApi<any>("/api/portal/settings");
  const [f, setF] = useState<any | null>(null);
  const [branches, setBranches] = useState<BranchCfg[]>([]);
  const [services, setServices] = useState<ServiceCfg[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!s.data) return;
    const st = s.data.settings;
    setF({ enabled: st.enabled, slug: s.data.slug, leadTimeHours: String(st.leadTimeHours), maxDaysAhead: String(st.maxDaysAhead), changeWindowHours: String(st.changeWindowHours), showPrices: st.showPrices, instructions: st.instructions ?? "" });
    setBranches(s.data.branches.map((b: any) => ({ branchId: b.id, name: b.name, address: b.address, enabled: b.enabled, mode: b.mode, whatsapp: b.whatsapp ?? "", mapUrl: b.mapUrl ?? "" })));
    setServices(s.data.services.map((x: any) => ({ ...x, priceFrom: x.priceFromCents != null ? toBsInput(x.priceFromCents) : "" })));
  }, [s.data]);
  if (!s.data || !f) return <div className="card"><Loading /></div>;

  const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
  const save = async () => {
    const v: Record<string, string> = {};
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(f.slug)) v.slug = "Usa solo minúsculas, números y guiones (2 a 41 caracteres)";
    const lead = num(f.leadTimeHours), max = num(f.maxDaysAhead), win = num(f.changeWindowHours);
    if (!(lead >= 0 && lead <= 168)) v.leadTimeHours = "Entre 0 y 168 horas";
    if (!(max >= 1 && max <= 180)) v.maxDaysAhead = "Entre 1 y 180 días";
    if (!(win >= 0 && win <= 168)) v.changeWindowHours = "Entre 0 y 168 horas";
    branches.forEach((b, i) => {
      if (b.whatsapp && !/^\+?[\d\s-]{7,18}$/.test(b.whatsapp)) v[`branches.${i}.whatsapp`] = "WhatsApp inválido (ej.: 71234567)";
      if (b.mapUrl && !/^https:\/\/\S+$/.test(b.mapUrl)) v[`branches.${i}.mapUrl`] = "Debe empezar con https://";
    });
    const chosen = services.filter((x) => x.bookable);
    chosen.forEach((x) => { if (x.priceFrom && !(parseBs(x.priceFrom) >= 0)) v[`price.${x.procedureId}`] = "Monto inválido"; });
    if (f.enabled && !branches.some((b) => b.enabled)) v.branches = "Activa al menos una sucursal";
    if (f.enabled && !chosen.length) v.services = "Elige al menos una prestación";
    setErrs(v); setErr(null);
    if (Object.keys(v).length) { setErr("Revisa los campos marcados."); return; }
    setBusy(true);
    try {
      await api.put("/api/portal/settings", {
        enabled: f.enabled, slug: f.slug, leadTimeHours: lead, maxDaysAhead: max, changeWindowHours: win, showPrices: f.showPrices, instructions: f.instructions || null,
        branches: branches.map((b) => ({ branchId: b.branchId, enabled: b.enabled, mode: b.mode, whatsapp: b.whatsapp || null, mapUrl: b.mapUrl || null })),
        services: chosen.map((x) => ({ procedureId: x.procedureId, priceFromCents: x.priceFrom ? parseBs(x.priceFrom) : null })),
      });
      toast("Reserva online guardada");
      s.reload();
    } catch (e: any) {
      const d: Record<string, string> = {};
      for (const x of e.details ?? []) if (x.path) d[x.path] = x.message;
      setErrs(d); setErr(e.message);
    } finally { setBusy(false); }
  };
  const link = `${window.location.origin}/reservar/${s.data.slug}`;
  const setB = (i: number, p: Partial<BranchCfg>) => setBranches(branches.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const setS = (id: string, p: Partial<ServiceCfg>) => setServices(services.map((x) => (x.procedureId === id ? { ...x, ...p } : x)));
  const Err = ({ k }: { k: string }) => (errs[k] ? <span className="small" style={{ color: "var(--danger)", fontWeight: 600 }} role="alert">{errs[k]}</span> : null);

  return (
    <div className="stack">
      {err && <div className="alert danger" role="alert">{err}</div>}
      <div className="card">
        <div className="card-head"><h2>Reserva online</h2><span className={`badge ${s.data.settings.enabled ? "ok" : ""}`}>{s.data.settings.enabled ? "Activa" : "Desactivada"}</span></div>
        <div className="card-pad stack">
          <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Permitir que los pacientes reserven desde el celular</label>
          {s.data.settings.enabled && (
            <p className="small">Enlace para compartir: <a href={link} target="_blank" rel="noopener noreferrer">{link} <ExternalLink size={13} /></a> · Portal del paciente: <a href={`/mi-cuenta/${s.data.slug}`} target="_blank" rel="noopener noreferrer">/mi-cuenta/{s.data.slug}</a></p>
          )}
          {s.data.messagingMode !== "provider" && (
            <div className="alert warn">Los códigos y confirmaciones se envían por WhatsApp. {s.data.messagingMode === "simulate"
              ? "Este entorno es de pruebas: los mensajes no salen y se ven en «Mensajes»."
              : "Aún no hay un proveedor de WhatsApp conectado: los pacientes no recibirán el código hasta configurarlo."}</div>
          )}
          <div className="form-grid">
            <Field label="Dirección pública (identificador)" hint="Aparece en el enlace. Cambiarlo invalida los enlaces ya compartidos.">
              <input className="input" value={f.slug} aria-invalid={!!errs.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="Anticipación mínima (horas)" hint="No se ofrecen horarios más cercanos que esto.">
              <input className="input" inputMode="numeric" value={f.leadTimeHours} aria-invalid={!!errs.leadTimeHours} onChange={(e) => setF({ ...f, leadTimeHours: e.target.value })} />
            </Field>
            <Field label="Hasta cuántos días adelante"><input className="input" inputMode="numeric" value={f.maxDaysAhead} aria-invalid={!!errs.maxDaysAhead} onChange={(e) => setF({ ...f, maxDaysAhead: e.target.value })} /></Field>
            <Field label="Plazo para reprogramar o cancelar (horas antes)"><input className="input" inputMode="numeric" value={f.changeWindowHours} aria-invalid={!!errs.changeWindowHours} onChange={(e) => setF({ ...f, changeWindowHours: e.target.value })} /></Field>
            <Field label="Indicaciones para el paciente (opcional)" span2 hint="Se muestran en la revisión y en la confirmación. Sin datos clínicos.">
              <textarea className="input" maxLength={1000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
            </Field>
          </div>
          <div className="stack-sm"><Err k="slug" /><Err k="leadTimeHours" /><Err k="maxDaysAhead" /><Err k="changeWindowHours" /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Sucursales</h2></div>
        <div className="card-pad stack">
          <p className="muted small"><b>Confirmación inmediata:</b> la cita se crea al instante con las reglas de la agenda. <b>Solicitud:</b> entra a «Solicitudes web» en la Agenda y recepción la aprueba o rechaza.</p>
          <Err k="branches" />
          {branches.map((b, i) => (
            <div key={b.branchId} className="card card-pad stack-sm" style={{ boxShadow: "none" }}>
              <label className="check"><input type="checkbox" checked={b.enabled} onChange={(e) => setB(i, { enabled: e.target.checked })} /><b>{b.name}</b>{b.address && <span className="muted small">{b.address}</span>}</label>
              {b.enabled && (
                <div className="form-grid">
                  <Field label="Modo">
                    <select className="input" value={b.mode} onChange={(e) => setB(i, { mode: e.target.value as BranchCfg["mode"] })}>
                      <option value="instant">Confirmación inmediata</option><option value="request">Solicitud con aprobación</option>
                    </select>
                  </Field>
                  <Field label="WhatsApp o teléfono de la sucursal"><input className="input" inputMode="tel" value={b.whatsapp} aria-invalid={!!errs[`branches.${i}.whatsapp`]} onChange={(e) => setB(i, { whatsapp: e.target.value })} /></Field>
                  <Field label="Enlace del mapa (opcional)" span2 hint="Si lo dejas vacío, se usa una búsqueda con la dirección.">
                    <input className="input" placeholder="https://maps.app.goo.gl/…" value={b.mapUrl} aria-invalid={!!errs[`branches.${i}.mapUrl`]} onChange={(e) => setB(i, { mapUrl: e.target.value })} />
                  </Field>
                </div>
              )}
              <Err k={`branches.${i}.whatsapp`} /><Err k={`branches.${i}.mapUrl`} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Prestaciones que se reservan en línea</h2></div>
        <div className="card-pad stack-sm">
          <label className="check"><input type="checkbox" checked={f.showPrices} onChange={(e) => setF({ ...f, showPrices: e.target.checked })} />Mostrar el precio «desde» a los pacientes</label>
          <Err k="services" />
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Reservable</th><th>Prestación</th><th className="hide-mobile">Duración</th><th>Precio desde (Bs)</th></tr></thead>
            <tbody>{services.map((x) => (
              <tr key={x.procedureId}>
                <td><input type="checkbox" style={{ width: 20, height: 20 }} aria-label={`Reservable: ${x.name}`} checked={x.bookable} onChange={(e) => setS(x.procedureId, { bookable: e.target.checked })} /></td>
                <td>{x.name}<div className="muted small">{x.category} · lista {bs(x.priceCents)}</div></td>
                <td className="hide-mobile">{x.durationMin} min</td>
                <td>
                  <input className="input" style={{ maxWidth: 120 }} inputMode="decimal" disabled={!x.bookable} aria-label={`Precio desde: ${x.name}`} value={x.priceFrom}
                    aria-invalid={!!errs[`price.${x.procedureId}`]} onChange={(e) => setS(x.procedureId, { priceFrom: e.target.value })} />
                  <Err k={`price.${x.procedureId}`} />
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      </div>
      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar reserva online"}</button>
    </div>
  );
}
