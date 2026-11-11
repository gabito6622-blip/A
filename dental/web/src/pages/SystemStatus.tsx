// Panel «Estado del sistema» (solo administradores de la plataforma): último respaldo y simulacro de
// restauración, disponibilidad (/api/ready), errores y rutas lentas de las últimas 24 h, versión,
// tiempo encendido y alertas. Sin datos de pacientes.
import { useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Empty, Loading, useToast } from "../components/ui";

const RUN: Record<string, { label: string; tone: string }> = {
  ok: { label: "Correcto", tone: "ok" },
  failed: { label: "Falló", tone: "danger" },
  running: { label: "En curso", tone: "info" },
  interrupted: { label: "Interrumpido", tone: "warn" },
};
const CHECK_LABEL: Record<string, string> = { database: "Base de datos", migrations: "Migraciones al día", storage: "Almacenamiento de archivos" };

export const fmtBytes = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} GB`;
};
const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
};
const uptime = (s: number) => {
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};
const RunBadge = ({ status }: { status: string }) => <span className={`badge ${RUN[status]?.tone ?? ""}`}>{RUN[status]?.label ?? status}</span>;

export function SystemStatusPanel() {
  const toast = useToast();
  const st = useApi<any>("/api/platform/ops/status");
  const [sending, setSending] = useState(false);
  const testAlert = async () => {
    setSending(true);
    try {
      const r = await api.post<{ channels: string[]; simulated: boolean }>("/api/platform/ops/test-alert", {});
      toast(r.simulated ? `Alerta de prueba simulada (${r.channels.join(", ")}): en este entorno no sale ningún correo` : `Alerta de prueba enviada: ${r.channels.join(", ")}`);
      st.reload();
    } catch (e: any) { toast(e.message, true); } finally { setSending(false); }
  };
  if (st.error) return <div className="alert danger" role="alert">{st.error}</div>;
  if (!st.data) return <Loading rows={6} />;
  const d = st.data;
  const lb = d.backup.last;
  const lv = d.verify.last;
  const cfg = d.alerts.config;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted small" style={{ margin: 0 }}>Entorno: {d.environment} · consultado {fmtDateTime(d.ready.checkedAt)}</p>
        <button className="btn" style={{ minHeight: 40 }} onClick={() => st.reload()} disabled={st.loading}><RefreshCw size={16} />Actualizar</button>
      </div>

      {d.alerts.active.length ? (
        <div className="alert danger stack-sm" role="alert">
          <b>Requiere atención ({d.alerts.active.length})</b>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.alerts.active.map((a: any) => <li key={a.key}><b>{a.title}.</b> {a.message}</li>)}
          </ul>
        </div>
      ) : <div className="alert ok" role="status">Todo en orden: no hay alertas activas.</div>}

      <div className="grid grid-4">
        <div className="card kpi" aria-label="Último respaldo">
          <div className="label">Último respaldo</div>
          <div className="value">{lb ? <RunBadge status={lb.status} /> : <span className="badge warn">Sin respaldos</span>}</div>
          <div className="foot">{lb ? `${ago(lb.startedAt)} · ${fmtBytes(lb.sizeBytes)}` : "Todavía no se registró ninguno"}</div>
          {lb && lb.status !== "ok" && d.backup.lastOk && <div className="foot">Último correcto: {ago(d.backup.lastOk.startedAt)}</div>}
        </div>
        <div className="card kpi" aria-label="Último simulacro de restauración">
          <div className="label">Último simulacro de restauración</div>
          <div className="value">{lv ? <RunBadge status={lv.status} /> : <span className="badge warn">Sin simulacros</span>}</div>
          <div className="foot">{lv ? `${ago(lv.startedAt)}${lv.backupName ? ` · ${lv.backupName}` : ""}` : "Nunca se probó restaurar un respaldo"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Errores del servidor (24 h)</div>
          <div className="value" style={{ color: d.metrics.totals.errors5xx ? "var(--danger)" : undefined }}>{d.metrics.totals.errors5xx}</div>
          <div className="foot">de {d.metrics.totals.requests} solicitudes · {d.metrics.totals.slow} lentas</div>
        </div>
        <div className="card kpi">
          <div className="label">Versión</div>
          <div className="value" style={{ fontSize: 20 }}>v{d.version}</div>
          <div className="foot">{d.commit ? `${d.commit} · ` : ""}encendido hace {uptime(d.uptimeSeconds)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Disponibilidad</h2>{d.ready.ok ? <span className="badge ok">Listo</span> : <span className="badge danger">No está listo</span>}</div>
        <div className="table-wrap">
          <table className="table cards-sm">
            <thead><tr><th>Comprobación</th><th>Estado</th><th>Detalle</th></tr></thead>
            <tbody>
              {Object.entries<any>(d.ready.checks).map(([k, c]) => (
                <tr key={k}><td><b>{CHECK_LABEL[k] ?? k}</b></td><td>{c.ok ? <span className="badge ok">Bien</span> : <span className="badge danger">Falla</span>}</td><td className="small">{c.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Respaldos y simulacros</h2><span className="muted small">Retención: {d.backup.retention.daily} diarios, {d.backup.retention.weekly} semanales, {d.backup.retention.monthly} mensuales</span></div>
        <div className="card-pad stack-sm small">
          <div>Destino configurado en este servidor: <b>{d.backup.target}</b></div>
          {lb && lb.status === "ok" && <div>Último respaldo cifrado: {lb.encrypted ? <span className="badge ok">Sí</span> : <span className="badge warn">No (sin BACKUP_PASSPHRASE)</span>}</div>}
          <div className="muted">Se programan fuera de la app: <code>backup:run</code> cada día y <code>backup:verify</code> cada semana (ver README).</div>
        </div>
        {!d.runs.length ? <Empty>No hay ejecuciones registradas todavía.</Empty> : (
          <div className="table-wrap">
            <table className="table cards-sm">
              <thead><tr><th>Inicio</th><th>Tipo</th><th>Resultado</th><th>Respaldo</th><th className="num">Tamaño</th><th>Detalle</th></tr></thead>
              <tbody>
                {d.runs.map((r: any) => (
                  <tr key={r.id}>
                    <td><b>{fmtDateTime(r.startedAt)}</b> <span className="muted small">· {ago(r.startedAt)}</span></td>
                    <td>{r.kind === "backup" ? "Respaldo" : "Simulacro"}</td>
                    <td><RunBadge status={r.status} /></td>
                    <td className="small"><span>{r.backupName ?? "—"}</span></td>
                    <td className="num">{fmtBytes(r.sizeBytes)}</td>
                    <td className="small">
                      <span>{r.errorSummary ?? (r.kind === "verify" && Array.isArray(r.checks)
                        ? `${r.checks.filter((c: any) => c.ok).length} de ${r.checks.length} verificaciones correctas`
                        : r.kind === "backup" && r.status === "ok" ? `${r.filesIncluded ? "con archivos clínicos" : "solo base"}${r.prunedCount ? ` · ${r.prunedCount} antiguos borrados` : ""}` : "")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-2">
        <RouteTable title="Errores del servidor (5xx) en 24 h" rows={d.metrics.errorRoutes} empty="Sin errores del servidor en las últimas 24 h." mode="errors" />
        <RouteTable title={`Rutas lentas (más de ${d.metrics.slowMs / 1000} s) en 24 h`} rows={d.metrics.slowRoutes} empty="Ninguna ruta lenta en las últimas 24 h." mode="slow" />
      </div>
      <p className="muted small" style={{ margin: 0 }}>Las métricas son de esta instancia desde que se encendió (máximo 24 h) y se agrupan por tipo de ruta, sin identificadores.</p>

      <div className="card">
        <div className="card-head"><h2>Alertas</h2><button className="btn" style={{ minHeight: 40 }} onClick={testAlert} disabled={sending}><BellRing size={16} />{sending ? "Enviando…" : "Enviar alerta de prueba"}</button></div>
        <div className="card-pad stack-sm small">
          <div>
            Se avisa a <b>{cfg.recipients}</b> {cfg.recipients === 1 ? "destinatario" : "destinatarios"} por correo{cfg.simulated ? " (simulado en este entorno)" : ""}{cfg.webhook ? " y por webhook" : ""}.
            {" "}La misma alerta no se repite antes de {cfg.repeatHours} h.
          </div>
          <div className="muted">Se avisa si el respaldo tiene más de {cfg.backupMaxAgeHours} h o falló, si el simulacro tiene más de {cfg.verifyMaxAgeDays} días o falló, si hay {cfg.errors5xxThreshold} o más errores 5xx en {cfg.errors5xxWindowMinutes} min, o si el servicio no está listo.</div>
          {!cfg.monitor && <div className="alert warn small">El monitor automático está apagado en este entorno (OPS_MONITOR): las alertas de antigüedad, errores y disponibilidad no se envían solas.</div>}
          {cfg.recipients === 0 && !cfg.webhook && <div className="alert warn small">Nadie recibiría las alertas: marca a un administrador de la plataforma o define ALERT_EMAILS o ALERT_WEBHOOK_URL.</div>}
        </div>
        {!d.alerts.recent.length ? <Empty>No se envió ninguna alerta todavía.</Empty> : (
          <div className="table-wrap">
            <table className="table cards-sm">
              <thead><tr><th>Alerta</th><th>Estado</th><th>Último envío</th><th className="num">Envíos</th><th>Canales</th></tr></thead>
              <tbody>
                {d.alerts.recent.map((a: any, i: number) => (
                  <tr key={`${a.key}-${i}`}>
                    <td><b>{a.title}</b><div className="muted small">{a.message}</div></td>
                    <td>{a.resolvedAt ? <span className="badge">Resuelta</span> : <span className={`badge ${a.severity === "critical" ? "danger" : "warn"}`}>Activa</span>}</td>
                    <td className="small">{a.lastSentAt ? fmtDateTime(a.lastSentAt) : "—"}</td>
                    <td className="num">{a.sentCount}{a.suppressedCount ? <span className="muted small"> (+{a.suppressedCount} sin repetir)</span> : null}</td>
                    <td className="small"><span>{(a.channels ?? []).join(", ") || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteTable({ title, rows, empty, mode }: { title: string; rows: any[]; empty: string; mode: "errors" | "slow" }) {
  return (
    <div className="card">
      <div className="card-head"><h2 style={{ fontSize: 15 }}>{title}</h2></div>
      {!rows.length ? <Empty>{empty}</Empty> : (
        <div className="table-wrap">
          <table className="table cards-sm">
            <thead><tr><th>Ruta</th><th className="num">{mode === "errors" ? "Errores" : "Lentas"}</th><th className="num">Solicitudes</th><th className="num">p50</th><th className="num">p95</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.route}>
                  <td><code className="small" style={{ wordBreak: "break-all" }}>{r.route}</code></td>
                  <td className="num">{mode === "errors" ? r.errors5xx : r.slow}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">≤ {r.p50Ms} ms</td>
                  <td className="num">≤ {r.p95Ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
