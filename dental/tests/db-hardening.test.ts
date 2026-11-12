// Auditoría automática del esquema (Equipo Q): por SQL sobre el catálogo, para TODAS las tablas,
// incluidas las que se agreguen en el futuro.
//  * toda tabla con clinic_id tiene RLS habilitado y la política tenant_isolation (o una de las
//    excepciones documentadas) basada en app_clinic_id(), con WITH CHECK;
//  * dental_app no es dueño, ni superusuario, ni BYPASSRLS (por eso RLS se le aplica siempre;
//    FORCE ROW LEVEL SECURITY solo afectaría al dueño — ver el informe del Equipo Q);
//  * los registros de solo inserción no tienen UPDATE/DELETE/TRUNCATE para dental_app (ni por columna)
//    y conservan su trigger de inmutabilidad;
//  * las funciones SECURITY DEFINER son las revisadas, fijan search_path y no son ejecutables por PUBLIC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupEnv, teardown, type Env } from "./helpers.js";

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => teardown(env));
const q = async <T = any>(sql: string, p: unknown[] = []) => (await env.db.adminPool.query(sql, p)).rows as T[];

/** Tablas con clinic_id que usan políticas propias (revisadas) en lugar de tenant_isolation. */
const POLICY_EXCEPTIONS: Record<string, string[]> = {
  audit_log: ["audit_insert", "audit_read"],                        // insertar sin clínica (login fallido) y leer solo la propia
  memberships: ["membership_read", "membership_update", "membership_write"], // la persona ve sus propias membresías (cambio de clínica)
};

/** clinic_id sin RLS por diseño: la sesión se resuelve por el hash del token ANTES de conocer la clínica
 *  (clinic_id es la clínica activa elegida, no un dato de la clínica). Sin datos de pacientes. */
const NO_RLS_BY_DESIGN = ["sessions"];

/** Registros que no deben cambiar nunca (historias, cierres, intentos, eventos, asientos). */
const INSERT_ONLY = [
  "lab_payment_voids", "appointment_events", "appointment_series", "audit_log", "bank_statements", "budget_events", "cash_movements", "cash_session_reviews",
  "charges", "checkin_attempts", "cleaning_logs", "clinical_document_voids", "clinical_documents", "clinical_file_events", "clinical_files",
  "clinical_notes", "expense_voids", "fee_settlement_lines", "inbound_messages", "inv_movements", "inv_po_receipt_lines", "inv_po_receipts",
  "inv_treatment_consumptions", "invoice_request_lines", "lab_order_events", "lab_payment_allocations", "lab_payments",
  "marketing_campaign_recipients", "marketing_campaigns", "medical_histories", "message_template_versions", "odontogram_entries",
  "patient_calls", "payer_payment_allocations", "payer_statements", "pdf_documents", "recall_attempts", "signed_documents",
  "staff_task_comments", "sterilization_bio_results", "sterilization_cycles", "time_entries",
  // v0.6 (equipos P, R y S)
  "clinical_file_thumbs", "expense_attachments", "import_batches", "import_records", "opening_balances", "payer_transfers",
  // v0.7.1 (B-096)
  "clinic_logos", "consent_template_reviews",
  // v0.8 (B-070)
  "inbound_message_events",
];

/** Funciones SECURITY DEFINER revisadas: cada una solo resuelve la clínica o un agregado mínimo. */
const DEFINER_REVIEWED = [
  "budget_link_clinic", "inv_apply_movement", "messaging_active_clinics",
  "messaging_message_by_provider_id", "patient_search_ids", "pdf_document_clinic", "portal_clinic_by_slug", "user_clinic_count",
  // v0.7 (B-093): clínica del último WhatsApp enviado a ESE número completo (E.164), nunca por los últimos 8 dígitos.
  "messaging_last_outbound_to_number",
  // v0.8 (B-070): clínicas con mensajes en cola para un proveedor (solo identificadores, para el despachador).
  "messaging_clinics_with_outbox",
  // v0.7 (B-091): la app nunca lee el hash ni los secretos de users.
  "auth_password_salt",      // parámetros y sal del hash (sin el resultado) de una cuenta habilitada
  "auth_password_matches",   // compara el hash calculado por la app con el guardado; devuelve solo sí/no
  "auth_my_mfa_secret",      // secreto TOTP cifrado SOLO del usuario de la sesión (app.user_id)
  "auth_use_recovery_code",  // marca usado un código de recuperación SOLO del usuario de la sesión
];

/** Columnas secretas que dental_app no puede leer (B-091). */
const SECRET_COLUMNS: [string, string][] = [
  ["users", "password_hash"], ["users", "mfa_secret_enc"], ["users", "mfa_pending_secret_enc"], ["mfa_recovery_codes", "code_hash"],
];

describe("Row Level Security en todas las tablas con clinic_id", () => {
  it("RLS habilitado y política de aislamiento por clínica (con WITH CHECK) en cada tabla", async () => {
    const tables = await q<{ t: string; rls: boolean }>(
      `SELECT c.relname AS t, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'clinic_id' AND NOT a.attisdropped)
        ORDER BY 1`);
    expect(tables.length).toBeGreaterThan(100);
    expect(tables.filter((x) => !x.rls).map((x) => x.t), "tablas sin RLS").toEqual(NO_RLS_BY_DESIGN);
    const pols = await q<{ t: string; name: string; cmd: string; qual: string | null; chk: string | null; permissive: string; roles: string[] }>(
      "SELECT tablename AS t, policyname AS name, cmd, qual, with_check AS chk, permissive, roles FROM pg_policies WHERE schemaname = 'public'");
    const bad: string[] = [];
    for (const { t } of tables.filter((x) => !NO_RLS_BY_DESIGN.includes(x.t))) {
      const mine = pols.filter((p) => p.t === t);
      const want = POLICY_EXCEPTIONS[t] ?? ["tenant_isolation"];
      if (JSON.stringify(mine.map((p) => p.name).sort()) !== JSON.stringify([...want].sort())) bad.push(`${t}: políticas ${mine.map((p) => p.name).join(",") || "(ninguna)"}`);
      for (const p of mine) {
        if (p.permissive !== "PERMISSIVE") continue;
        // Toda política (lectura o escritura) se apoya en la clínica del contexto.
        if (!`${p.qual ?? ""} ${p.chk ?? ""}`.includes("app_clinic_id()")) bad.push(`${t}.${p.name}: no usa app_clinic_id()`);
        if (p.name === "tenant_isolation" && (p.cmd !== "ALL" || p.qual !== "(clinic_id = app_clinic_id())" || p.chk !== "(clinic_id = app_clinic_id())")) {
          bad.push(`${t}.tenant_isolation distinta: ${p.cmd} ${p.qual} / ${p.chk}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("dental_app no es dueño de ninguna tabla, ni superusuario, ni BYPASSRLS (RLS se le aplica siempre)", async () => {
    const role = (await q("SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'dental_app'"))[0];
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
    const owned = await q("SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'dental_app'");
    expect(owned).toEqual([]);
    // Ninguna política exime a dental_app (políticas restringidas a otro rol o USING (true)).
    const lax = await q("SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true')");
    expect(lax).toEqual([]);
  });

  it("las tablas globales sin clinic_id son solo las de identidad, sesión y operación de la plataforma (sin datos de pacientes)", async () => {
    const globals = await q<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity ORDER BY 1`);
    expect(globals.map((g) => g.t)).toEqual([
      // v0.7 (Equipo V): registro de respaldos/simulacros y episodios de alerta. Describen el servicio, no a una
      // clínica (sin clinic_id ni datos de pacientes); solo los usa el rol dueño (CLI, monitor y /api/platform).
      "backup_runs",
      // v0.7 (B-090): contadores de intentos fallidos por cuenta y por cuenta + origen (sin datos de pacientes).
      "login_account_guard", "login_throttle",
      "mfa_recovery_codes",
      "ops_alerts", // v0.7 (Equipo V), ver backup_runs
      "password_resets", "plans", "schema_migrations", "sessions", "users",
    ]);
    // Las tablas de operación no dan ningún privilegio a la app (mínimo privilegio).
    for (const t of ["backup_runs", "ops_alerts"]) {
      const r = (await q("SELECT has_table_privilege('dental_app', $1, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS any", [t]))[0];
      expect(r.any, t).toBe(false);
    }
  });

  it("dental_app no puede leer el hash de la contraseña ni los secretos de los 2 pasos (B-091)", async () => {
    for (const [t, col] of SECRET_COLUMNS) {
      const r = (await q("SELECT has_column_privilege('dental_app', $1, $2, 'SELECT') AS sel", [t, col]))[0];
      expect(r.sel, `${t}.${col} legible por dental_app`).toBe(false);
    }
    const c = await env.db.appPool.connect();
    try {
      await expect(c.query("SELECT password_hash FROM users LIMIT 1")).rejects.toThrow(/permission denied/);
      await expect(c.query("SELECT * FROM users LIMIT 1")).rejects.toThrow(/permission denied/);
    } finally { c.release(); }
  });
});

describe("registros de solo inserción", () => {
  it("dental_app no tiene UPDATE, DELETE ni TRUNCATE (tampoco por columna) y el trigger de inmutabilidad existe", async () => {
    const bad: string[] = [];
    for (const t of INSERT_ONLY) {
      const r = (await q(
        `SELECT has_table_privilege('dental_app', $1, 'UPDATE') AS upd, has_table_privilege('dental_app', $1, 'DELETE') AS del,
                has_table_privilege('dental_app', $1, 'TRUNCATE') AS trunc, has_any_column_privilege('dental_app', $1, 'UPDATE') AS colupd,
                has_table_privilege('dental_app', $1, 'INSERT') AS ins,
                EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid WHERE g.tgrelid = $1::regclass AND p.proname = 'forbid_mutation') AS immut`,
        [t]))[0];
      if (r.upd || r.del || r.trunc || r.colupd) bad.push(`${t}: privilegios de más ${JSON.stringify(r)}`);
      if (!r.immut) bad.push(`${t}: sin trigger forbid_mutation`);
      if (!r.ins) bad.push(`${t}: dental_app no puede insertar`);
    }
    expect(bad).toEqual([]);
  });

  it("toda tabla con trigger forbid_mutation está en la lista y no tiene UPDATE/DELETE (cubre tablas nuevas)", async () => {
    const withTrigger = (await q<{ t: string }>(
      `SELECT DISTINCT c.relname AS t FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid JOIN pg_class c ON c.oid = g.tgrelid
        WHERE p.proname = 'forbid_mutation' ORDER BY 1`)).map((x) => x.t);
    expect(withTrigger.filter((t) => !INSERT_ONLY.includes(t)), "tabla de solo inserción no listada").toEqual([]);
  });

  it("dental_app no tiene TRUNCATE en ninguna tabla (TRUNCATE no dispara los triggers de inmutabilidad)", async () => {
    const r = await q(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege('dental_app', c.oid, 'TRUNCATE')`);
    expect(r).toEqual([]);
  });

  it("un UPDATE o DELETE como dental_app sobre la auditoría y las evoluciones se rechaza", async () => {
    const c = await env.db.appPool.connect();
    try {
      for (const sql of ["UPDATE audit_log SET action = 'x'", "DELETE FROM audit_log", "UPDATE clinical_notes SET body = 'x'", "DELETE FROM charges"]) {
        await expect(c.query(sql)).rejects.toThrow(/permission denied/);
      }
    } finally { c.release(); }
  });
});

describe("vistas", () => {
  it("toda vista usa security_invoker (si no, se leería con los permisos del dueño, sin RLS)", async () => {
    const views = await q<{ v: string; opts: string[] | null }>(
      `SELECT c.relname AS v, c.reloptions AS opts FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('v','m')`);
    expect(views.length).toBeGreaterThan(0);
    for (const x of views) expect(x.opts ?? [], x.v).toContain("security_invoker=true");
  });
});

describe("funciones SECURITY DEFINER", () => {
  it("solo las revisadas, con search_path fijo y sin EXECUTE para PUBLIC", async () => {
    const fns = await q<{ name: string; config: string[] | null; pub: boolean }>(
      `SELECT p.proname AS name, p.proconfig AS config,
              EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS pub
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1`);
    expect(fns.map((f) => f.name)).toEqual([...DEFINER_REVIEWED].sort());
    for (const f of fns) {
      expect(f.config?.some((s) => s.startsWith("search_path=")), `${f.name} sin search_path`).toBe(true);
      expect(f.pub, `${f.name} ejecutable por PUBLIC`).toBe(false);
    }
  });
});
