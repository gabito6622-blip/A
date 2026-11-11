// Operación diaria (Equipo V): /api/ready, métricas por patrón de ruta, panel «Estado del sistema» solo
// para la plataforma, alertas con deduplicación (fechas simuladas), webhook a un servidor LOCAL,
// retención de respaldos con fechas simuladas y mínimo privilegio de las tablas nuevas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../server/src/config.js";
import { MemoryMailer } from "../server/src/lib/mailer.js";
import { hashPassword } from "../server/src/lib/password.js";
import type { Db } from "../server/src/lib/db.js";
import { loadOpsConfig, type OpsConfig } from "../server/src/modules/ops/config.js";
import { evaluateConditions, processAlerts, type AlertDeps } from "../server/src/modules/ops/alerts.js";
import { OpsMetrics, routeLabel } from "../server/src/modules/ops/metrics.js";
import { Readiness } from "../server/src/modules/ops/ready.js";
import { groupSets, planRetention, stampOf } from "../server/src/modules/ops/retention.js";
import { pruneBackups } from "../server/src/modules/ops/backup.js";
import { LocalBackupStorage, S3BackupStorage, type BackupStorage } from "../server/src/modules/ops/storage.js";
import { summarizeError } from "../server/src/modules/ops/runs.js";
import { runOpsMonitorOnce } from "../server/src/modules/ops/index.js";
import { startFakeS3 } from "./fake-s3.js";
import { createClinic, createPatient, login, PASSWORD, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent;
let platform: Agent;
let platformEmail = "";
let ops: OpsConfig;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  platformEmail = `plataforma-${randomUUID().slice(0, 8)}@test.local`;
  await env.db.adminPool.query("INSERT INTO users (email, full_name, password_hash, is_platform_admin) VALUES ($1,'Plataforma Prueba',$2,true)", [platformEmail, await hashPassword(PASSWORD)]);
  platform = await login(env.app, platformEmail);
  ops = structuredClone(env.app.ops.ops);
});
afterAll(async () => teardown(env));

const deps = (over: Partial<AlertDeps> = {}): AlertDeps & { outbox: NonNullable<AlertDeps["outbox"]> } =>
  ({ ops, mailer: new MemoryMailer(), outbox: [], memory: new Map(), log: () => {}, ...over }) as AlertDeps & { outbox: NonNullable<AlertDeps["outbox"]> };

async function clearRuns() {
  await env.db.adminPool.query("DELETE FROM backup_runs");
  await env.db.adminPool.query("DELETE FROM ops_alerts");
}
async function addRun(kind: "backup" | "verify", status: "ok" | "failed", startedAt: Date, error: string | null = null) {
  await env.db.adminPool.query(
    "INSERT INTO backup_runs (kind, status, started_at, finished_at, backup_name, error_summary, size_bytes) VALUES ($1,$2,$3,$3::timestamptz + interval '2 minutes',$4,$5,1000)",
    [kind, status, startedAt, `dental-${stampOf(startedAt)}`, error]);
}

describe("/api/ready", () => {
  it("responde {ok:true} sin sesión y sin datos internos", async () => {
    env.app.ops.readiness.reset();
    const r = await env.app.inject({ method: "GET", url: "/api/ready" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(r.headers["cache-control"]).toBe("no-store");
    // /api/health sigue siendo la prueba simple de vida.
    expect((await env.app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
  });

  it("almacenamiento no escribible → 503 {ok:false}; el detalle solo lo ve la plataforma", async () => {
    const original = env.app.ops.readiness;
    const blocker = join(mkdtempSync(join(tmpdir(), "ready-")), "soy-un-archivo");
    writeFileSync(blocker, "x");
    env.app.ops.readiness = new Readiness(env.db, { ...ops, filesDir: join(blocker, "archivos") });
    try {
      const r = await env.app.inject({ method: "GET", url: "/api/ready" });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ ok: false });
      expect(r.body).not.toContain("soy-un-archivo");
      const st = await platform.get("/api/platform/ops/status");
      expect(st.body.ready.ok).toBe(false);
      expect(st.body.ready.checks.storage).toMatchObject({ ok: false, detail: expect.stringMatching(/no se puede escribir/) });
      expect(st.body.alerts.active.map((a: any) => a.key)).toContain("ready_failed");
    } finally { env.app.ops.readiness = original; }
  });

  it("migraciones pendientes → no está listo", async () => {
    const fakeDb = { appPool: env.db.appPool, adminPool: { query: async () => ({ rows: [{ name: "0001_core.sql" }] }) } } as unknown as Db;
    const r = await new Readiness(fakeDb, ops).check();
    expect(r.ok).toBe(false);
    expect(r.checks.migrations.ok).toBe(false);
    expect(r.checks.migrations.detail).toMatch(/pendientes: .*0027_ops_backups_monitoring\.sql/);
    expect(r.checks.database.ok).toBe(true);
  });

  it("base de datos sin respuesta → no está listo", async () => {
    const fakeDb = { appPool: { query: async () => { throw new Error("connect ECONNREFUSED postgres://usuario:clave@db:5432/x"); } }, adminPool: env.db.adminPool } as unknown as Db;
    const r = await new Readiness(fakeDb, ops).check();
    expect(r.ok).toBe(false);
    expect(r.checks.database.detail).not.toContain("clave");
  });
});

describe("métricas por patrón de ruta", () => {
  it("registra el patrón (nunca la URL con identificadores) y las lentas sin datos personales", async () => {
    const m = env.app.ops.metrics;
    const slow: unknown[] = [];
    const prev = { onSlow: m.onSlow, slowMs: m.slowMs };
    m.onSlow = (e) => slow.push(e);
    m.slowMs = 0;
    try {
      const pid = await createPatient(owner, { firstName: "Métrica", lastName: "Confidencial" });
      await owner.get(`/api/patients/${pid}`);
      await owner.get(`/api/patients?q=Confidencial`);
      await owner.get(`/api/no-existe/${pid}`);
    } finally { m.onSlow = prev.onSlow; m.slowMs = prev.slowMs; }
    const routes = m.summary().map((r) => r.route);
    expect(routes).toContain("GET /api/patients/:id");
    expect(routes).toContain("GET /api/patients");
    expect(routes).toContain("GET (ruta inexistente)");
    for (const r of routes) expect(r).not.toMatch(UUID);
    expect(slow.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(slow);
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/Confidencial|q=/);
    expect(slow[0]).toEqual({ route: expect.any(String), statusCode: expect.any(Number), ms: expect.any(Number) });
  });

  it("p50/p95 por intervalos, 5xx y ventana de 24 h", () => {
    const m = new OpsMetrics({ slowMs: 1000 });
    const t0 = Date.parse("2026-11-11T12:00:00Z");
    for (let i = 0; i < 95; i++) m.record("GET /api/x", 200, 8, t0);
    for (let i = 0; i < 5; i++) m.record("GET /api/x", 503, 2500, t0);
    const s = m.summary(t0)[0]!;
    expect(s).toEqual({ route: "GET /api/x", count: 100, errors5xx: 5, slow: 5, p50Ms: 10, p95Ms: 10 });
    m.record("GET /api/x", 200, 2500, t0);
    expect(m.summary(t0)[0]!.p95Ms).toBe(3000);
    expect(m.errors5xx(10, t0)).toMatchObject({ total: 5, requests: 101, top: [{ route: "GET /api/x", count: 5 }] });
    expect(m.errors5xx(10, t0 + 11 * 60_000).total).toBe(0);
    expect(m.summary(t0 + 25 * 3600_000)).toEqual([]);
    expect(routeLabel("GET", undefined, "/assets/app.js")).toBe("GET (interfaz)");
  });
});

describe("panel «Estado del sistema» (solo plataforma)", () => {
  it("sin sesión 401; propietario de clínica 403; plataforma 200 con último respaldo, simulacro, versión y tiempo encendido", async () => {
    await clearRuns();
    const now = Date.now();
    await addRun("backup", "ok", new Date(now - 3 * 3600_000));
    await addRun("verify", "ok", new Date(now - 2 * 86_400_000));
    expect((await env.app.inject({ method: "GET", url: "/api/platform/ops/status" })).statusCode).toBe(401);
    expect((await owner.get("/api/platform/ops/status")).status).toBe(403);
    expect((await owner.post("/api/platform/ops/test-alert", {})).status).toBe(403);
    const r = await platform.get("/api/platform/ops/status");
    expect(r.status).toBe(200);
    expect(r.body.backup.last).toMatchObject({ status: "ok", sizeBytes: 1000 });
    expect(r.body.backup.lastOk.backupName).toMatch(/^dental-\d{8}T\d{6}Z$/);
    expect(r.body.verify.last).toMatchObject({ status: "ok" });
    expect(r.body.backup.retention).toEqual({ daily: 7, weekly: 4, monthly: 12 });
    expect(r.body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(r.body.metrics.totals.requests).toBeGreaterThan(0);
    expect(r.body.alerts.active.map((a: any) => a.key).filter((k: string) => k.startsWith("backup") || k.startsWith("verify"))).toEqual([]);
    expect(r.body.alerts.config.recipients).toBeGreaterThanOrEqual(1);
    // Sin datos de pacientes en el panel.
    expect(JSON.stringify(r.body)).not.toMatch(/Métrica|Confidencial/);
  });

  it("alerta de prueba: queda simulada fuera de producción, registrada y auditada", async () => {
    const before = env.app.ops.outbox.length;
    const r = await platform.post("/api/platform/ops/test-alert", {});
    expect(r.status).toBe(200);
    expect(r.body.simulated).toBe(true);
    expect(r.body.channels[0]).toMatch(/^correo simulado/);
    const sent = env.app.ops.outbox.slice(before);
    expect(sent.map((m) => m.to)).toContain(platformEmail);
    expect(sent[0]!.subject).toBe("[Dentalia] Aviso: Alerta de prueba");
    const row = (await env.db.adminPool.query("SELECT resolved_at IS NOT NULL AS resolved, sent_count FROM ops_alerts WHERE alert_key = 'test' ORDER BY first_seen_at DESC LIMIT 1")).rows[0];
    expect(row).toEqual({ resolved: true, sent_count: 1 });
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'platform.ops_test_alert'")).rows[0].n).toBeGreaterThan(0);
  });
});

describe("alertas", () => {
  it("condiciones: respaldo fallido o con más de 26 h, simulacro fallido o con más de 8 días", async () => {
    await clearRuns();
    const now = new Date("2026-11-11T12:00:00Z");
    const keys = async () => (await evaluateConditions(env.db.adminPool, ops, null, null, now)).map((c) => c.key).sort();
    expect(await keys()).toEqual(["backup_stale", "verify_stale"]); // nunca hubo
    await addRun("backup", "ok", new Date(now.getTime() - 25 * 3600_000));
    await addRun("verify", "ok", new Date(now.getTime() - 7 * 86_400_000));
    expect(await keys()).toEqual([]);
    await clearRuns();
    await addRun("backup", "ok", new Date(now.getTime() - 27 * 3600_000));
    await addRun("verify", "ok", new Date(now.getTime() - 9 * 86_400_000));
    expect(await keys()).toEqual(["backup_stale", "verify_stale"]);
    await addRun("backup", "failed", new Date(now.getTime() - 3600_000), "pg_dump terminó con error (1): DETAIL: Key (document_number)=(1234567) already exists");
    const conds = await evaluateConditions(env.db.adminPool, ops, null, null, now);
    const failed = conds.find((c) => c.key === "backup_failed")!;
    expect(failed.severity).toBe("critical");
    expect(failed.message).not.toContain("1234567");
  });

  it("pico de 5xx según el umbral configurable", async () => {
    const m = new OpsMetrics();
    const now = new Date();
    for (let i = 0; i < 4; i++) m.record("POST /api/payments", 500, 20, now.getTime());
    const o = { ...ops, alerts: { ...ops.alerts, errors5xxThreshold: 5 } };
    expect((await evaluateConditions(null, o, m, null, now)).map((c) => c.key)).toEqual([]);
    m.record("POST /api/payments", 502, 20, now.getTime());
    const c = (await evaluateConditions(null, o, m, null, now))[0]!;
    expect(c.key).toBe("errors_5xx");
    expect(c.message).toContain("POST /api/payments (5)");
  });

  it("deduplicación: la misma alerta no se repite antes de ALERT_REPEAT_HOURS (fechas simuladas) y se cierra al resolverse", async () => {
    await clearRuns();
    const t0 = new Date("2026-11-11T12:00:00Z");
    const h = (n: number) => new Date(t0.getTime() + n * 3600_000);
    await addRun("backup", "failed", h(-1), "No se encontró pg_dump");
    await addRun("verify", "ok", h(-24));
    const d = deps();
    const pass = async (now: Date) => processAlerts(env.db.adminPool, await evaluateConditions(env.db.adminPool, ops, null, null, now), d, now);

    let r = await pass(t0);
    expect(r.sent.sort()).toEqual(["backup_failed", "backup_stale"]);
    const firstBatch = d.outbox.length;
    expect(firstBatch).toBeGreaterThanOrEqual(2);
    expect(d.outbox.map((m) => m.to)).toContain(platformEmail);
    expect(d.outbox[0]!.text).toMatch(/no incluye datos de pacientes/);

    r = await pass(h(1));
    expect(r.sent).toEqual([]);
    expect(r.suppressed.sort()).toEqual(["backup_failed", "backup_stale"]);
    expect(d.outbox.length).toBe(firstBatch);

    r = await pass(h(6));
    expect(r.sent.sort()).toEqual(["backup_failed", "backup_stale"]);

    // Se resuelve: respaldo correcto → episodios cerrados.
    await addRun("backup", "ok", h(6.2));
    r = await pass(h(6.3));
    expect(r.sent).toEqual([]);
    expect(r.resolved.sort()).toEqual(["backup_failed", "backup_stale"]);
    // Vuelve a fallar enseguida: nuevo episodio, pero no se reenvía antes de 6 h desde el último envío.
    await addRun("backup", "failed", h(6.5), "tiempo agotado");
    r = await pass(h(7));
    expect(r.suppressed).toEqual(["backup_failed"]);
    r = await pass(h(12.1));
    expect(r.sent).toEqual(["backup_failed"]);
    const rows = (await env.db.adminPool.query("SELECT alert_key, sent_count, suppressed_count, resolved_at IS NULL AS open FROM ops_alerts WHERE alert_key = 'backup_failed' ORDER BY first_seen_at")).rows;
    expect(rows).toEqual([
      { alert_key: "backup_failed", sent_count: 2, suppressed_count: 1, open: false },
      { alert_key: "backup_failed", sent_count: 1, suppressed_count: 1, open: true },
    ]);
  });

  it("webhook configurable (simulado con un servidor local) y en producción el correo sale por el mailer", async () => {
    const got: any[] = [];
    const server: Server = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => { b += c; });
      req.on("end", () => { got.push(JSON.parse(b)); res.writeHead(204).end(); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      await clearRuns();
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/alertas`;
      const mailer = new MemoryMailer();
      const prod = { ...ops, isProduction: true, alerts: { ...ops.alerts, webhookUrl: url } };
      const d = deps({ ops: prod, mailer });
      const now = new Date();
      const r = await processAlerts(env.db.adminPool, await evaluateConditions(env.db.adminPool, prod, null, null, now), d, now);
      expect(r.sent.sort()).toEqual(["backup_stale", "verify_stale"]);
      expect(got).toHaveLength(2);
      expect(got[0]).toMatchObject({ text: expect.stringMatching(/^\[Dentalia\] Alerta: /), alert: { key: expect.any(String), severity: "critical", environment: "produccion" } });
      expect(mailer.sent.map((m) => m.to)).toContain(platformEmail);
      expect(d.outbox).toEqual([]);
      const ch = (await env.db.adminPool.query("SELECT channels FROM ops_alerts WHERE alert_key = 'backup_stale' AND resolved_at IS NULL")).rows[0].channels;
      expect(ch).toEqual([expect.stringMatching(/^correo \(\d+\)$/), "webhook"]);

      // Fuera de producción, un webhook que no es local queda simulado (no se llama).
      await clearRuns();
      let called = 0;
      const dev = { ...ops, alerts: { ...ops.alerts, webhookUrl: "https://hooks.ejemplo.invalid/x" } };
      await processAlerts(env.db.adminPool, await evaluateConditions(env.db.adminPool, dev, null, null, now), deps({ ops: dev, fetchImpl: (async () => { called++; return new Response(null); }) as typeof fetch }), now);
      expect(called).toBe(0);
    } finally { server.close(); }
  });

  it("si la base no responde, deduplica en memoria y avisa a ALERT_EMAILS", async () => {
    const o = { ...ops, alerts: { ...ops.alerts, extraEmails: ["guardia@ejemplo.bo"] } };
    const d = deps({ ops: o });
    const cond = { key: "ready_failed" as const, severity: "critical" as const, title: "El servicio no está listo", message: "Falla: base de datos: sin respuesta." };
    const t = new Date("2026-11-11T00:00:00Z");
    expect((await processAlerts(null, [cond], d, t)).sent).toEqual(["ready_failed"]);
    expect((await processAlerts(null, [cond], d, new Date(t.getTime() + 3600_000))).suppressed).toEqual(["ready_failed"]);
    expect(d.outbox.map((m) => m.to)).toEqual(["guardia@ejemplo.bo"]);
  });

  it("el monitor de la app evalúa todo en una pasada (sin repetir)", async () => {
    await clearRuns();
    await addRun("backup", "ok", new Date(Date.now() - 3600_000));
    await addRun("verify", "ok", new Date(Date.now() - 3600_000));
    env.app.ops.readiness.reset();
    const r = await runOpsMonitorOnce(env.app, env.db);
    expect(r.sent).toEqual([]);
  });
});

describe("retención (fechas simuladas)", () => {
  const set = (iso: string, complete = true) => ({ name: `dental-${stampOf(new Date(iso))}`, stamp: stampOf(new Date(iso)), date: new Date(iso), files: [], sizeBytes: 1, complete });

  it("por defecto 7 diarios, 4 semanales y 12 mensuales; nunca el más reciente; incompletos solo si son antiguos", () => {
    // Un respaldo diario a las 03:15 de La Paz (07:15 UTC) durante 400 días, más uno manual el último día.
    const now = new Date("2026-11-11T12:00:00Z");
    const sets = Array.from({ length: 400 }, (_, i) => set(new Date(Date.parse("2026-11-11T07:15:00Z") - i * 86_400_000).toISOString()));
    sets.push(set("2026-11-11T09:00:00Z"));
    sets.push(set("2026-11-11T11:00:00Z", false)); // subiéndose ahora
    sets.push(set("2026-10-01T11:00:00Z", false)); // subida interrumpida hace tiempo
    const plan = planRetention(sets, { daily: 7, weekly: 4, monthly: 12 }, now);
    const kept = plan.keep.filter((k) => k.set.complete).map((k) => k.set.date.toISOString().slice(0, 10));
    // 7 días (el del 11 es el de las 09:00, el más reciente de ese día) + domingos de semanas anteriores + fin de mes.
    expect(plan.keep.find((k) => k.set.name === "dental-20261111T090000Z")!.reasons).toEqual(expect.arrayContaining(["diario 2026-11-11", "el más reciente"]));
    expect(kept.slice(0, 7)).toEqual(["2026-11-11", "2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05"]);
    expect(kept).toEqual(expect.arrayContaining(["2026-11-01", "2026-10-25", "2026-10-31", "2026-09-30", "2026-01-31", "2025-12-31"]));
    expect(kept).not.toContain("2025-11-30"); // el 13.º mes
    expect(new Set(kept).size).toBe(kept.length);
    expect(kept.length).toBeLessThanOrEqual(7 + 4 + 12);
    // 7 diarios + 2 semanas que no tenían diario (1/11 y 25/10) + 11 fines de mes (noviembre ya tiene el diario).
    expect(kept.length).toBe(20);
    expect(plan.keep.some((k) => k.set.name === "dental-20261111T110000Z")).toBe(true);
    expect(plan.remove.find((r) => r.set.name === "dental-20261001T110000Z")?.reason).toMatch(/incompleto/);
    expect(plan.remove.some((r) => r.set.name === "dental-20261111T071500Z")).toBe(true); // mismo día que uno más nuevo
    expect(plan.keep.length + plan.remove.length).toBe(sets.length);
  });

  it("aunque la política no conserve nada, el más reciente válido se queda", () => {
    const plan = planRetention([set("2026-01-01T07:15:00Z"), set("2026-01-02T07:15:00Z"), set("2026-01-03T07:15:00Z", false)], { daily: 0, weekly: 0, monthly: 0 }, new Date("2026-03-01T00:00:00Z"));
    expect(plan.keep.map((k) => k.set.name)).toEqual(["dental-20260102T071500Z"]);
    expect(plan.remove.map((r) => r.set.name)).toEqual(["dental-20260103T071500Z", "dental-20260101T071500Z"]);
  });

  it("el borrado solo toca juegos descartados dentro de la carpeta propia, y el manifiesto primero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ret-"));
    try {
      const day = (d: string) => `dental-${d}T071500Z`;
      for (const d of ["20261101", "20261102", "20261103"]) {
        for (const suffix of [".dump.enc", ".dump.enc.sha256", ".manifest.json"]) writeFileSync(join(dir, `${day(d)}${suffix}`), "x");
      }
      writeFileSync(join(dir, "dental-20261001T071500Z.dump.enc"), "x"); // incompleto antiguo
      writeFileSync(join(dir, "copia-manual.dump"), "x");               // ajeno: nunca se toca
      mkdirSync(join(dir, "otra-carpeta"));
      const order: string[] = [];
      const local = new LocalBackupStorage(dir);
      const spy: BackupStorage = { kind: "local", label: local.label, list: () => local.list(), upload: local.upload.bind(local), download: local.download.bind(local),
        remove: async (n) => { order.push(n); await local.remove(n); } };
      const o = { ...ops, backup: { ...ops.backup, retention: { daily: 2, weekly: 0, monthly: 0 } } };
      const removed = await pruneBackups(spy, o, new Date("2026-11-11T00:00:00Z"));
      expect(removed.sort()).toEqual(["dental-20261001T071500Z", "dental-20261101T071500Z"]);
      expect(order.indexOf("dental-20261101T071500Z.manifest.json")).toBeLessThan(order.indexOf("dental-20261101T071500Z.dump.enc"));
      expect(readdirSync(dir).sort()).toEqual([
        "copia-manual.dump", `${day("20261102")}.dump.enc`, `${day("20261102")}.dump.enc.sha256`, `${day("20261102")}.manifest.json`,
        `${day("20261103")}.dump.enc`, `${day("20261103")}.dump.enc.sha256`, `${day("20261103")}.manifest.json`, "otra-carpeta",
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("en S3 solo lista y borra bajo su prefijo (las claves clínicas del mismo bucket no se tocan)", async () => {
    const s3 = await startFakeS3();
    try {
      const put = (k: string) => s3.objects.set(k, { body: Buffer.from("x"), lastModified: new Date(), sse: null });
      put(`${K.clinicId}/2026/${"d".repeat(32)}`);
      put("dental-20250101T071500Z.manifest.json"); // en la raíz: fuera del prefijo
      for (const d of ["20250101", "20261110", "20261111"]) { put(`respaldos/dental-${d}T071500Z.dump.enc`); put(`respaldos/dental-${d}T071500Z.manifest.json`); }
      const cfg = loadConfig({ ...process.env });
      const o = loadOpsConfig(cfg, { BACKUP_S3_ENDPOINT: s3.url, BACKUP_S3_REGION: s3.region, BACKUP_S3_BUCKET: s3.bucket, BACKUP_S3_ACCESS_KEY_ID: s3.accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: s3.secretAccessKey, BACKUP_KEEP_DAILY: "1", BACKUP_KEEP_WEEKLY: "0", BACKUP_KEEP_MONTHLY: "0" });
      const storage = new S3BackupStorage(o.backup.target as Extract<OpsConfig["backup"]["target"], { kind: "s3" }>);
      expect(groupSets(await storage.list()).map((s) => s.name)).toEqual(["dental-20261111T071500Z", "dental-20261110T071500Z", "dental-20250101T071500Z"]);
      expect((await pruneBackups(storage, o, new Date("2026-11-11T12:00:00Z"))).sort()).toEqual(["dental-20250101T071500Z", "dental-20261110T071500Z"]);
      // Ambos lados ordenados: la clave clínica empieza con un id aleatorio y su posición varía.
      expect([...s3.objects.keys()].sort()).toEqual([
        `${K.clinicId}/2026/${"d".repeat(32)}`, "dental-20250101T071500Z.manifest.json",
        "respaldos/dental-20261111T071500Z.dump.enc", "respaldos/dental-20261111T071500Z.manifest.json",
      ].sort());
    } finally { await s3.close(); }
  });
});

describe("configuración y mínimo privilegio", () => {
  it("valores por defecto y validaciones claras", () => {
    const cfg = loadConfig({ ...process.env, DENTAL_FILES_DIR: "/srv/dental/archivos" });
    const o = loadOpsConfig(cfg, {});
    expect(o.backup.retention).toEqual({ daily: 7, weekly: 4, monthly: 12 });
    expect(o.backup.target.kind).toBe("local");
    expect(o.alerts).toMatchObject({ backupMaxAgeHours: 26, verifyMaxAgeDays: 8, repeatHours: 6, monitorEnabled: false });
    expect(() => loadOpsConfig(cfg, { BACKUP_DIR: "/srv/dental/archivos/respaldos" })).toThrow(/BACKUP_DIR no puede estar dentro/);
    expect(() => loadOpsConfig(cfg, { BACKUP_VERIFY_DB_PREFIX: "produccion" })).toThrow(/dental_restore/);
    expect(() => loadOpsConfig(cfg, { BACKUP_KEEP_DAILY: "0" })).toThrow(/BACKUP_KEEP_DAILY/);
    expect(() => loadOpsConfig(cfg, { BACKUP_STORAGE: "s3" })).toThrow(/BACKUP_STORAGE=s3 necesita/);
    const s3env = { DENTAL_S3_ENDPOINT: "https://s3.ejemplo.invalid", DENTAL_S3_BUCKET: "archivos-clinicos", DENTAL_S3_ACCESS_KEY_ID: "id", DENTAL_S3_SECRET_ACCESS_KEY: "secreto" };
    const sameBucket = loadOpsConfig(cfg, s3env);
    expect(sameBucket.backup.target).toMatchObject({ kind: "s3", prefix: "respaldos/", s3: { bucket: "archivos-clinicos" } });
    expect(() => loadOpsConfig(cfg, { ...s3env, BACKUP_S3_PREFIX: "" })).toThrow(/BACKUP_S3_PREFIX/);
    expect(() => loadOpsConfig(cfg, { ...s3env, BACKUP_S3_PREFIX: "0f3a9c1e-1234-/" })).toThrow(/clínica/);
    const prodCfg = { ...cfg, isProduction: true };
    expect(() => loadOpsConfig(prodCfg, { ALERT_WEBHOOK_URL: "http://hooks.ejemplo.invalid/x" })).toThrow(/https/);
    expect(loadOpsConfig(prodCfg, {}).alerts.monitorEnabled).toBe(true);
    expect(() => loadOpsConfig(cfg, { ALERT_EMAILS: "guardia@ejemplo.bo, no-es-correo" })).toThrow(/ALERT_EMAILS/);
  });

  it("el error resumido no lleva valores de filas, URLs de conexión ni contraseñas", () => {
    const s = summarizeError(new Error("pg_restore: error: COPY failed for table \"patients\": ERROR:  duplicate key value violates unique constraint \"patients_document_uq\"\nDETAIL:  Key (clinic_id, document_number)=(a, 1234567) already exists.\nCONTEXT:  COPY patients, line 3: \"Juana Pérez\"\nconnect to postgres://admin:SuperClave@db/x failed password=otra"));
    expect(s).not.toMatch(/1234567|Juana|SuperClave|otra/);
    expect(s).toMatch(/duplicate key/);
    expect(s.length).toBeLessThanOrEqual(300);
  });

  it("dental_app no puede leer ni escribir backup_runs ni ops_alerts", async () => {
    const c = await env.db.appPool.connect();
    try {
      await expect(c.query("SELECT * FROM backup_runs")).rejects.toThrow(/permission denied/);
      await expect(c.query("INSERT INTO ops_alerts (alert_key, severity, title, message) VALUES ('x','warning','x','x')")).rejects.toThrow(/permission denied/);
    } finally { c.release(); }
  });
});

describe("subida por partes de respaldos grandes (B-101)", () => {
  const s3cfg = (s3: Awaited<ReturnType<typeof startFakeS3>>) => loadOpsConfig(loadConfig({ ...process.env }), {
    BACKUP_S3_ENDPOINT: s3.url, BACKUP_S3_REGION: s3.region, BACKUP_S3_BUCKET: s3.bucket,
    BACKUP_S3_ACCESS_KEY_ID: s3.accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: s3.secretAccessKey, BACKUP_S3_PREFIX: "respaldos/",
  }).backup.target as Extract<OpsConfig["backup"]["target"], { kind: "s3" }>;

  it("un archivo más grande que el umbral se sube por partes y queda idéntico; uno chico, de una vez", async () => {
    const s3 = await startFakeS3();
    s3.minPartSize = 1024;
    try {
      const dir = mkdtempSync(join(tmpdir(), "dental-multipart-"));
      const big = Buffer.from(randomUUID().repeat(400)); // ~14 KB
      writeFileSync(join(dir, "big"), big);
      const storage = new S3BackupStorage(s3cfg(s3), fetch, { singlePutMax: 4096, partSize: 4096 });
      await storage.upload("dental-20261111T071500Z.dump.enc", join(dir, "big"));
      const o = s3.objects.get("respaldos/dental-20261111T071500Z.dump.enc")!;
      expect(Buffer.compare(o.body, big)).toBe(0);
      expect(o.sse).toBe("AES256");
      const parts = s3.log.filter((l) => l.method === "PUT" && l.path.includes("partNumber="));
      expect(parts).toHaveLength(Math.ceil(big.length / 4096));
      expect(s3.uploads.size).toBe(0);
      // No sobrescribe un respaldo existente.
      await expect(storage.upload("dental-20261111T071500Z.dump.enc", join(dir, "big"))).rejects.toThrow(/ya existe/);
      // Uno chico: un solo PUT, sin partes.
      writeFileSync(join(dir, "small"), Buffer.from("chico"));
      const before = s3.log.length;
      await storage.upload("dental-20261111T071500Z.manifest.json", join(dir, "small"));
      expect(s3.log.slice(before).map((l) => l.method)).toEqual(["PUT"]);
      rmSync(dir, { recursive: true, force: true });
    } finally { await s3.close(); }
  });

  it("si una parte falla, la subida se cancela (sin partes huérfanas) y el respaldo no aparece", async () => {
    const s3 = await startFakeS3();
    s3.minPartSize = 1024;
    s3.failPart = 2;
    try {
      const dir = mkdtempSync(join(tmpdir(), "dental-multipart-"));
      writeFileSync(join(dir, "big"), Buffer.alloc(10_000, 7));
      const storage = new S3BackupStorage(s3cfg(s3), fetch, { singlePutMax: 4096, partSize: 4096 });
      await expect(storage.upload("dental-20261112T071500Z.dump.enc", join(dir, "big"))).rejects.toThrow();
      expect(s3.uploads.size).toBe(0);
      expect(s3.objects.has("respaldos/dental-20261112T071500Z.dump.enc")).toBe(false);
      expect(s3.log.some((l) => l.method === "DELETE" && l.path.includes("uploadId="))).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    } finally { await s3.close(); }
  });
});
