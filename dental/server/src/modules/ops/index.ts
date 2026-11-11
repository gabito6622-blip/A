// Operación diaria (Equipo V): /api/ready, métricas por patrón de ruta, panel «Estado del sistema»
// de la plataforma y monitor de alertas. Los respaldos y simulacros son CLI (server/src/cli/backup.ts).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import type { Mail, Mailer } from "../../lib/mailer.js";
import { evaluateConditions, MONITOR_KEYS, processAlerts, recipientCount, sendTestAlert, type AlertDeps } from "./alerts.js";
import { loadOpsConfig, targetLabel, type OpsConfig } from "./config.js";
import { OpsMetrics, routeLabel } from "./metrics.js";
import { Readiness } from "./ready.js";
import { STALE_RUN_HOURS, summarizeError } from "./runs.js";

export interface OpsRuntime {
  ops: OpsConfig;
  metrics: OpsMetrics;
  readiness: Readiness;
  alertDeps: AlertDeps;
  /** Correos de alerta simulados (fuera de producción). */
  outbox: Mail[];
}

declare module "fastify" {
  interface FastifyInstance { ops: OpsRuntime }
}

export function opsRoutes(route: Route, cfg: Config, app: FastifyInstance, db: Db, mailer: Mailer, ops: OpsConfig = loadOpsConfig(cfg)) {
  const metrics = new OpsMetrics({ slowMs: ops.slowMs });
  const outbox: Mail[] = [];
  const runtime: OpsRuntime = {
    ops, metrics, readiness: new Readiness(db, ops), outbox,
    alertDeps: { ops, mailer, outbox, memory: new Map(), log: (m) => app.log.warn(m) },
  };
  app.decorate("ops", runtime);

  // Métricas por patrón de ruta y registro de solicitudes lentas (sin URL ni identificadores).
  metrics.onSlow = (e) => app.log.warn(e, "solicitud lenta");
  app.addHook("onResponse", async (req, reply) => {
    metrics.record(routeLabel(req.method, req.routeOptions?.url, req.url), reply.statusCode, reply.elapsedTime);
  });

  route({
    method: "GET", url: "/api/ready", summary: "Disponibilidad: base de datos, migraciones al día y almacenamiento escribible (sin detalles internos)", tags: ["operación"],
    access: "public", noTx: true,
    handler: async ({ reply }) => {
      const r = await runtime.readiness.check();
      if (!r.ok) reply.code(503);
      return { ok: r.ok };
    },
  });

  route({
    method: "GET", url: "/api/platform/ops/status", summary: "Estado del sistema: respaldos, simulacros, disponibilidad, errores y rutas lentas (sin datos de pacientes)", tags: ["plataforma"], access: "platform",
    handler: async ({ c }) => {
      const now = new Date();
      const runs = (await c.query(
        `SELECT id, kind, CASE WHEN status = 'running' AND started_at < now() - make_interval(hours => $1) THEN 'interrupted' ELSE status END AS status,
                started_at AS "startedAt", finished_at AS "finishedAt", backup_name AS "backupName", storage, encrypted, size_bytes AS "sizeBytes",
                sha256, files_included AS "filesIncluded", tables_count AS "tablesCount", rows_total AS "rowsTotal", pruned_count AS "prunedCount",
                error_summary AS "errorSummary", details->'checks' AS checks
           FROM backup_runs ORDER BY started_at DESC LIMIT 20`, [STALE_RUN_HOURS])).rows;
      const pick = async (kind: string, okOnly: boolean) => (await c.query(
        `SELECT started_at AS "startedAt", finished_at AS "finishedAt", status, backup_name AS "backupName", size_bytes AS "sizeBytes", encrypted, error_summary AS "errorSummary", details->'checks' AS checks
           FROM backup_runs WHERE kind = $1 ${okOnly ? "AND status = 'ok'" : "AND status <> 'running'"} ORDER BY started_at DESC LIMIT 1`, [kind])).rows[0] ?? null;
      const ready = await runtime.readiness.check();
      const active = await evaluateConditions(db.adminPool, ops, metrics, ready, now);
      const alerts = (await c.query(
        `SELECT alert_key AS key, severity, title, message, first_seen_at AS "firstSeenAt", last_sent_at AS "lastSentAt", sent_count AS "sentCount",
                suppressed_count AS "suppressedCount", channels, resolved_at AS "resolvedAt"
           FROM ops_alerts ORDER BY last_seen_at DESC LIMIT 15`)).rows;
      const routes = metrics.summary(now.getTime());
      return {
        version: ops.version, commit: ops.commit, environment: ops.isProduction ? "producción" : "desarrollo",
        startedAt: metrics.startedAt.toISOString(), uptimeSeconds: Math.round((now.getTime() - metrics.startedAt.getTime()) / 1000),
        backup: { last: await pick("backup", false), lastOk: await pick("backup", true), target: targetLabel(ops.backup.target), retention: ops.backup.retention },
        verify: { last: await pick("verify", false), lastOk: await pick("verify", true) },
        runs,
        ready,
        metrics: {
          slowMs: metrics.slowMs, windowHours: 24,
          totals: { requests: routes.reduce((s, r) => s + r.count, 0), errors5xx: routes.reduce((s, r) => s + r.errors5xx, 0), slow: routes.reduce((s, r) => s + r.slow, 0) },
          errorRoutes: routes.filter((r) => r.errors5xx > 0).sort((a, b) => b.errors5xx - a.errors5xx).slice(0, 15),
          slowRoutes: routes.filter((r) => r.slow > 0 || r.p95Ms > metrics.slowMs).sort((a, b) => b.slow - a.slow || b.p95Ms - a.p95Ms).slice(0, 15),
        },
        alerts: {
          active, recent: alerts,
          config: {
            recipients: await recipientCount(db.adminPool, ops), webhook: !!ops.alerts.webhookUrl, monitor: ops.alerts.monitorEnabled, simulated: !ops.isProduction,
            repeatHours: ops.alerts.repeatHours, backupMaxAgeHours: ops.alerts.backupMaxAgeHours, verifyMaxAgeDays: ops.alerts.verifyMaxAgeDays,
            errors5xxThreshold: ops.alerts.errors5xxThreshold, errors5xxWindowMinutes: ops.alerts.errors5xxWindowMinutes,
          },
        },
      };
    },
  });

  route({
    method: "POST", url: "/api/platform/ops/test-alert", summary: "Enviar una alerta de prueba a los administradores de la plataforma (simulada fuera de producción)", tags: ["plataforma"], access: "platform",
    body: z.object({}).optional(), limit: { max: 3, timeWindow: "10 minutes" }, noTx: true,
    handler: async ({ auth }) => {
      const channels = await sendTestAlert(db.adminPool, runtime.alertDeps, new Date());
      await db.adminPool.query("INSERT INTO audit_log (user_id, action, entity, data, ip) VALUES ($1,'platform.ops_test_alert','ops_alert',$2,$3)", [auth.userId, JSON.stringify({ channels }), auth.ip]);
      return { channels, simulated: !ops.isProduction };
    },
  });
}

/** Una pasada del monitor: evalúa y envía (con deduplicación). */
export async function runOpsMonitorOnce(app: FastifyInstance, db: Db, now = new Date()) {
  const rt = app.ops;
  const ready = await rt.readiness.check(now.getTime());
  const pool = ready.checks.database.ok ? db.adminPool : null;
  const active = await evaluateConditions(pool, rt.ops, rt.metrics, ready, now);
  // Sin base no se pudieron evaluar respaldos ni simulacros: solo se cierran los de memoria y disponibilidad.
  const evaluated = pool ? MONITOR_KEYS : MONITOR_KEYS.filter((k) => k === "errors_5xx" || k === "ready_failed");
  return processAlerts(pool, active, rt.alertDeps, now, evaluated);
}

/** Monitor periódico (OPS_MONITOR=1; activo por defecto en producción). */
export function startOpsMonitor(app: FastifyInstance, db: Db): () => void {
  const { ops } = app.ops;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runOpsMonitorOnce(app, db);
      if (r.sent.length) app.log.warn({ sent: r.sent }, "alertas enviadas");
    } catch (e) {
      app.log.error({ err: { message: summarizeError(e) } }, "monitor de operación");
    } finally { running = false; }
  };
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, ops.alerts.monitorIntervalMs);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
