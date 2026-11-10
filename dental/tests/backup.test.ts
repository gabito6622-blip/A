import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { createDb } from "../server/src/lib/db.js";
import { withTenant } from "../server/src/lib/db.js";
import { createClinic, createPatient, login, setupEnv, teardown } from "./helpers.js";

const hasTools = spawnSync("pg_dump", ["--version"]).status === 0 && spawnSync("openssl", ["version"]).status === 0;

describe.skipIf(!hasTools)("copias de seguridad", () => {
  it("un respaldo cifrado se restaura en una base vacía con los mismos datos y el aislamiento intacto", async () => {
    const env = await setupEnv();
    const K = await createClinic(env.db);
    const owner = await login(env.app, K.ownerEmail);
    const pid = await createPatient(owner, { firstName: "Respaldo" });
    await teardown(env);

    const src = process.env.DATABASE_URL!;
    const target = new URL(src); target.pathname = "/dental_restore_test";
    const admin = new URL(src); admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    await c.query("DROP DATABASE IF EXISTS dental_restore_test WITH (FORCE)");
    await c.query("CREATE DATABASE dental_restore_test");
    await c.end();

    const dir = mkdtempSync(join(tmpdir(), "bk-"));
    const envVars = { ...process.env, BACKUP_PASSPHRASE: "clave-de-prueba-larga", DATABASE_URL: src, TARGET_DATABASE_URL: target.toString() };
    const file = execFileSync("bash", ["scripts/backup.sh", dir], { env: envVars }).toString().trim().split("\n").pop()!;
    expect(file).toMatch(/\.dump\.enc$/);
    execFileSync("bash", ["scripts/restore.sh", file], { env: envVars, stdio: "pipe" });

    const restored = createDb(target.toString());
    try {
      const counts = async (pool: pg.Pool) => (await pool.query("SELECT (SELECT count(*) FROM patients)::int AS p, (SELECT count(*) FROM audit_log)::int AS a, (SELECT count(*) FROM clinics)::int AS c")).rows[0];
      const original = createDb(src);
      expect(await counts(restored.adminPool)).toEqual(await counts(original.adminPool));
      await original.close();
      // RLS sigue activo tras restaurar
      const visible = await withTenant(restored.appPool, { clinicId: K.clinicId, userId: null }, async (cl) => (await cl.query("SELECT first_name FROM patients WHERE id = $1", [pid])).rows);
      expect(visible).toEqual([{ first_name: "Respaldo" }]);
      const hidden = await withTenant(restored.appPool, { clinicId: null, userId: null }, async (cl) => (await cl.query("SELECT count(*)::int AS n FROM patients")).rows[0].n);
      expect(hidden).toBe(0);
    } finally { await restored.close(); }
  }, 120_000);
});
