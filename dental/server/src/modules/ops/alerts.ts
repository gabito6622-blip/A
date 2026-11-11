// Alertas a los administradores de la plataforma.
//
// Condiciones: respaldo con más de ALERT_BACKUP_MAX_AGE_HOURS (26 h) o fallido; simulacro con más
// de ALERT_VERIFY_MAX_AGE_DAYS (8 días) o fallido; pico de errores 5xx (ALERT_5XX_THRESHOLD en
// ALERT_5XX_WINDOW_MINUTES); /api/ready fallando.
// Envío: correo con el mailer existente (SIMULADO fuera de producción: queda en el registro y en la
// bandeja en memoria) y, si se configura, un webhook (ALERT_WEBHOOK_URL; fuera de producción solo a
// 127.0.0.1/localhost). La misma alerta no se repite más de una vez cada ALERT_REPEAT_HOURS
// (episodios en ops_alerts; si la base no responde, en memoria). Ningún texto lleva datos de pacientes:
// solo tipos de alerta, fechas, conteos, patrones de ruta y errores resumidos.
import type pg from "pg";
import type { Mail, Mailer } from "../../lib/mailer.js";
import type { OpsConfig } from "./config.js";
import type { OpsMetrics } from "./metrics.js";
import type { ReadyResult } from "./ready.js";
import { STALE_RUN_HOURS, summarizeError } from "./runs.js";

export type AlertKey = "backup_failed" | "backup_stale" | "verify_failed" | "verify_stale" | "errors_5xx" | "ready_failed" | "test";
export const MONITOR_KEYS: AlertKey[] = ["backup_failed", "backup_stale", "verify_failed", "verify_stale", "errors_5xx", "ready_failed"];

export interface AlertCondition { key: AlertKey; severity: "warning" | "critical"; title: string; message: string }

const fmt = (d: Date) => d.toLocaleString("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const hoursAgo = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / 3600_000);

interface RunRow { status: string; started_at: Date; finished_at: Date | null; error_summary: string | null }

async function lastRuns(pool: pg.Pool, kind: "backup" | "verify", now: Date) {
  const r = await pool.query<RunRow>(
    `SELECT status, started_at, finished_at, error_summary FROM backup_runs
      WHERE kind = $1 AND (status <> 'running' OR started_at < $2::timestamptz - make_interval(hours => $3))
      ORDER BY started_at DESC LIMIT 1`, [kind, now, STALE_RUN_HOURS]);
  const ok = await pool.query<RunRow>("SELECT status, started_at, finished_at, error_summary FROM backup_runs WHERE kind = $1 AND status = 'ok' ORDER BY started_at DESC LIMIT 1", [kind]);
  return { last: r.rows[0] ?? null, lastOk: ok.rows[0] ?? null };
}

/** Evalúa las condiciones (no envía nada). `pool` null: la base no responde y solo se evalúa lo de memoria. */
export async function evaluateConditions(pool: pg.Pool | null, ops: OpsConfig, metrics: OpsMetrics | null, ready: ReadyResult | null, now: Date): Promise<AlertCondition[]> {
  const out: AlertCondition[] = [];
  const a = ops.alerts;
  if (pool) {
    for (const kind of ["backup", "verify"] as const) {
      const { last, lastOk } = await lastRuns(pool, kind, now);
      const what = kind === "backup" ? "respaldo" : "simulacro de restauración";
      const maxH = kind === "backup" ? a.backupMaxAgeHours : a.verifyMaxAgeDays * 24;
      const limit = kind === "backup" ? `${a.backupMaxAgeHours} h` : `${a.verifyMaxAgeDays} días`;
      if (last && last.status === "failed") {
        out.push({ key: `${kind}_failed`, severity: "critical", title: `El último ${what} falló`,
          message: `El ${what} del ${fmt(last.started_at)} falló. Motivo: ${summarizeError(last.error_summary ?? "sin detalle")}.` });
      }
      if (!lastOk) {
        out.push({ key: `${kind}_stale`, severity: "critical", title: kind === "backup" ? "No hay ningún respaldo correcto" : "No hay ningún simulacro de restauración correcto",
          message: kind === "backup" ? "No hay registrado ningún respaldo correcto. Programa «backup:run» (ver README)." : "Nunca se comprobó que un respaldo se pueda restaurar. Programa «backup:verify» (ver README)." });
      } else if (now.getTime() - lastOk.started_at.getTime() > maxH * 3600_000) {
        out.push({ key: `${kind}_stale`, severity: kind === "backup" ? "critical" : "warning", title: `El último ${what} correcto es antiguo`,
          message: `El último ${what} correcto es del ${fmt(lastOk.started_at)} (hace ${hoursAgo(lastOk.started_at, now)} h; el límite es ${limit}).` });
      }
    }
  }
  if (metrics) {
    const e = metrics.errors5xx(a.errors5xxWindowMinutes, now.getTime());
    if (e.total >= a.errors5xxThreshold) {
      out.push({ key: "errors_5xx", severity: "critical", title: "Pico de errores del servidor (5xx)",
        message: `Hubo ${e.total} errores 5xx en los últimos ${a.errors5xxWindowMinutes} min (de ${e.requests} solicitudes; umbral: ${a.errors5xxThreshold}). Rutas más afectadas: ${e.top.map((t) => `${t.route} (${t.count})`).join(", ")}.` });
    }
  }
  if (ready && !ready.ok) {
    const failing = Object.entries(ready.checks).filter(([, c]) => !c.ok).map(([k, c]) => `${{ database: "base de datos", migrations: "migraciones", storage: "almacenamiento de archivos" }[k] ?? k}: ${c.detail}`);
    out.push({ key: "ready_failed", severity: "critical", title: "El servicio no está listo (/api/ready falla)", message: `Falla: ${failing.join("; ")}.` });
  }
  return out;
}

// ---------------- Envío ----------------
export interface AlertDeps {
  ops: OpsConfig;
  mailer: Mailer;
  log?: (m: string) => void;
  fetchImpl?: typeof fetch;
  /** Correos simulados (fuera de producción). */
  outbox?: Mail[];
  /** Deduplicación de respaldo cuando la base no responde. */
  memory?: Map<string, number>;
}

export interface ProcessResult { sent: AlertKey[]; suppressed: AlertKey[]; resolved: string[] }

const isLoopback = (u: string) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

async function recipients(pool: pg.Pool | null, ops: OpsConfig): Promise<string[]> {
  const set = new Set(ops.alerts.extraEmails);
  if (pool) {
    try {
      for (const r of (await pool.query<{ email: string }>("SELECT email FROM users WHERE is_platform_admin AND disabled_at IS NULL ORDER BY email")).rows) set.add(r.email);
    } catch { /* sin base: solo ALERT_EMAILS */ }
  }
  return [...set];
}

/** Envía una alerta por correo y webhook. Devuelve los canales usados (para el registro). */
export async function deliver(cond: AlertCondition, to: string[], deps: AlertDeps, now: Date): Promise<string[]> {
  const { ops } = deps;
  const log = deps.log ?? (() => {});
  const channels: string[] = [];
  const subject = `[Dentalia] ${cond.severity === "critical" ? "Alerta" : "Aviso"}: ${cond.title}`;
  const text = `${cond.message}\n\nRevisa Plataforma SaaS → Estado del sistema: ${ops.publicUrl}/plataforma\nEste aviso es automático y no incluye datos de pacientes.`;
  if (to.length) {
    if (ops.isProduction) {
      let failed = 0;
      for (const addr of to) {
        try { await deps.mailer.send({ to: addr, subject, text }); } catch (e) { failed++; log(`[alerta] no se pudo enviar el correo: ${summarizeError(e)}`); }
      }
      channels.push(failed ? `correo (${to.length - failed}/${to.length})` : `correo (${to.length})`);
    } else {
      for (const addr of to) deps.outbox?.push({ to: addr, subject, text });
      log(`[alerta simulada] ${subject} → ${to.length} destinatario(s)`);
      channels.push(`correo simulado (${to.length})`);
    }
  }
  const hook = ops.alerts.webhookUrl;
  if (hook) {
    if (!ops.isProduction && !isLoopback(hook)) {
      log(`[alerta simulada] webhook ${new URL(hook).host}: ${cond.title}`);
      channels.push("webhook simulado");
    } else {
      try {
        const res = await (deps.fetchImpl ?? fetch)(hook, {
          method: "POST", headers: { "content-type": "application/json" }, redirect: "manual", signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ text: `${subject}\n${cond.message}`, alert: { key: cond.key, severity: cond.severity, title: cond.title, message: cond.message, at: now.toISOString(), environment: ops.isProduction ? "produccion" : "desarrollo" } }),
        });
        await res.body?.cancel().catch(() => {});
        channels.push(res.ok ? "webhook" : `webhook (falló ${res.status})`);
      } catch (e) {
        channels.push("webhook (falló)");
        log(`[alerta] webhook sin respuesta: ${summarizeError(e)}`);
      }
    }
  }
  if (!channels.length) { channels.push("sin destinatarios"); log(`[alerta] SIN DESTINATARIOS: ${cond.title}`); }
  return channels;
}

/**
 * Registra y envía las condiciones activas sin repetir una alerta más de una vez cada
 * ALERT_REPEAT_HOURS, y cierra los episodios de las condiciones evaluadas que ya no están.
 * `evaluated`: tipos que se evaluaron en esta pasada (solo esos se pueden cerrar).
 */
export async function processAlerts(pool: pg.Pool | null, active: AlertCondition[], deps: AlertDeps, now: Date, evaluated: AlertKey[] = MONITOR_KEYS): Promise<ProcessResult> {
  const repeatMs = deps.ops.alerts.repeatHours * 3600_000;
  const res: ProcessResult = { sent: [], suppressed: [], resolved: [] };
  const to = await recipients(pool, deps.ops);
  for (const cond of active) {
    let dbOk = false;
    if (pool) {
      const c = await pool.connect().catch(() => null);
      if (c) {
        try {
          await c.query("BEGIN");
          await c.query("SELECT pg_advisory_xact_lock(hashtext('ops_alert:' || $1))", [cond.key]);
          const open = (await c.query<{ id: string }>("SELECT id FROM ops_alerts WHERE alert_key = $1 AND resolved_at IS NULL FOR UPDATE", [cond.key])).rows[0];
          const lastSent = (await c.query<{ t: Date | null }>("SELECT max(last_sent_at) AS t FROM ops_alerts WHERE alert_key = $1", [cond.key])).rows[0]!.t;
          const memSent = deps.memory?.get(cond.key);
          const last = Math.max(lastSent?.getTime() ?? 0, memSent ?? 0);
          const due = !last || now.getTime() - last >= repeatMs;
          const id = open?.id ?? (await c.query<{ id: string }>(
            "INSERT INTO ops_alerts (alert_key, severity, title, message, first_seen_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id",
            [cond.key, cond.severity, cond.title, cond.message.slice(0, 1000), now])).rows[0]!.id;
          if (due) {
            const channels = await deliver(cond, to, deps, now);
            await c.query(`UPDATE ops_alerts SET severity = $2, title = $3, message = $4, last_seen_at = $5, last_sent_at = $5, sent_count = sent_count + 1,
                                  channels = $6 WHERE id = $1`, [id, cond.severity, cond.title, cond.message.slice(0, 1000), now, channels]);
            deps.memory?.set(cond.key, now.getTime());
            res.sent.push(cond.key);
          } else {
            await c.query("UPDATE ops_alerts SET message = $2, last_seen_at = $3, suppressed_count = suppressed_count + 1 WHERE id = $1", [id, cond.message.slice(0, 1000), now]);
            res.suppressed.push(cond.key);
          }
          await c.query("COMMIT");
          dbOk = true;
        } catch (e) {
          await c.query("ROLLBACK").catch(() => {});
          deps.log?.(`[alerta] no se pudo registrar en la base: ${summarizeError(e)}`);
        } finally { c.release(); }
      }
    }
    if (!dbOk) {
      // Sin base (p. ej. /api/ready falla porque PostgreSQL no responde): deduplicación en memoria.
      const last = deps.memory?.get(cond.key);
      if (last && now.getTime() - last < repeatMs) { res.suppressed.push(cond.key); continue; }
      await deliver(cond, to, deps, now);
      deps.memory?.set(cond.key, now.getTime());
      res.sent.push(cond.key);
    }
  }
  if (pool) {
    const activeKeys = active.map((a) => a.key);
    const closable = evaluated.filter((k) => !activeKeys.includes(k));
    if (closable.length) {
      const r = await pool.query<{ alert_key: string }>("UPDATE ops_alerts SET resolved_at = $1 WHERE resolved_at IS NULL AND alert_key = ANY($2) RETURNING alert_key", [now, closable]).catch(() => ({ rows: [] }));
      res.resolved = r.rows.map((x) => x.alert_key);
    }
  }
  return res;
}

/** Alerta de prueba (botón del panel): se envía siempre y queda registrada como resuelta. */
export async function sendTestAlert(pool: pg.Pool, deps: AlertDeps, now: Date): Promise<string[]> {
  const cond: AlertCondition = { key: "test", severity: "warning", title: "Alerta de prueba", message: "Esto es una prueba del canal de alertas de Dentalia. Si la recibiste, el canal funciona." };
  const channels = await deliver(cond, await recipients(pool, deps.ops), deps, now);
  await pool.query(
    "INSERT INTO ops_alerts (alert_key, severity, title, message, first_seen_at, last_seen_at, last_sent_at, sent_count, channels, resolved_at) VALUES ('test','warning',$1,$2,$3,$3,$3,1,$4,$3)",
    [cond.title, cond.message, now, channels]);
  return channels;
}

/** Cantidad de destinatarios por correo (para el panel). */
export async function recipientCount(pool: pg.Pool, ops: OpsConfig) { return (await recipients(pool, ops)).length; }
