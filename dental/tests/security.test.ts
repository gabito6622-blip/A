import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { base32Decode, base32Encode, totp, verifyTotp } from "../server/src/lib/totp.js";
import { open, seal } from "../server/src/lib/secretbox.js";
import { addUser, createClinic, createPatient, login, PASSWORD, setupEnv, teardown, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
beforeAll(async () => { env = await setupEnv(); K = await createClinic(env.db); });
afterAll(async () => teardown(env));

/** Inicio de sesión "crudo" que no asume acceso inmediato (para flujos con 2 pasos). */
async function rawLogin(app: FastifyInstance, email: string, password = PASSWORD) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  const cookie = String(r.headers["set-cookie"] ?? "").split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  const csrf = me.json().csrfToken as string;
  const call = async (method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: { cookie, "x-csrf-token": csrf }, ...(method !== "GET" ? { payload: payload ?? {} } : {}) });
    return { status: res.statusCode, body: res.json() as any };
  };
  return { login: r.json(), me: me.json(), call };
}

describe("TOTP (RFC 6238) y cifrado de secretos", () => {
  it("cumple el vector de prueba del RFC 6238 (SHA-1, T=59 s → 287082)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1_111_111_109_000)).toBe("081804");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("acepta ±1 ventana de desfase y rechaza códigos viejos", () => {
    const secret = base32Encode(Buffer.from("abcdefghijabcdefghij"));
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
  it("el secreto cifrado no se puede leer ni alterar sin la clave", () => {
    const key = Buffer.alloc(32, 1);
    const sealed = seal(key, "SECRETO");
    expect(sealed).not.toContain("SECRETO");
    expect(open(key, sealed)).toBe("SECRETO");
    expect(() => open(Buffer.alloc(32, 2), sealed)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("otro").toString("base64");
    expect(() => open(key, parts.join("."))).toThrow();
  });
});

describe("verificación en dos pasos", () => {
  it("activar, ingresar con código y con código de recuperación (una sola vez)", async () => {
    const u = await addUser(env.db, K.clinicId, "admin", { allBranches: true });
    const s = await rawLogin(env.app, u.email);
    expect((await s.call("POST", "/api/auth/mfa/setup", { password: "incorrecta" })).status).toBe(400);
    const setup = await s.call("POST", "/api/auth/mfa/setup", { password: PASSWORD });
    expect(setup.body.qrSvg).toContain("<svg");
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);
    // el secreto queda cifrado en la base
    const stored = (await env.db.adminPool.query("SELECT mfa_pending_secret_enc FROM users WHERE id = $1", [u.id])).rows[0].mfa_pending_secret_enc;
    expect(stored).not.toContain(setup.body.secret);
    expect((await s.call("POST", "/api/auth/mfa/enable", { code: "000000" })).status).toBe(400);
    const en = await s.call("POST", "/api/auth/mfa/enable", { code: totp(setup.body.secret) });
    expect(en.body.recoveryCodes).toHaveLength(10);

    // Nuevo ingreso: la contraseña sola no da acceso
    const s2 = await rawLogin(env.app, u.email);
    expect(s2.login.mfaRequired).toBe(true);
    expect(s2.me.mfaPending).toBe(true);
    expect((await s2.call("GET", "/api/patients")).body.error.code).toBe("mfa_required");
    expect((await s2.call("POST", "/api/auth/mfa/verify", { code: "123456" })).status).toBe(401);
    expect((await s2.call("POST", "/api/auth/mfa/verify", { code: totp(setup.body.secret) })).status).toBe(200);
    expect((await s2.call("GET", "/api/patients")).status).toBe(200);

    // Código de recuperación: sirve una vez
    const s3 = await rawLogin(env.app, u.email);
    expect((await s3.call("POST", "/api/auth/mfa/verify", { recoveryCode: en.body.recoveryCodes[0].toLowerCase() })).status).toBe(200);
    const s4 = await rawLogin(env.app, u.email);
    expect((await s4.call("POST", "/api/auth/mfa/verify", { recoveryCode: en.body.recoveryCodes[0] })).status).toBe(401);
  });

  it("5 códigos incorrectos anulan la sesión pendiente", async () => {
    const u = await addUser(env.db, K.clinicId, "accountant", { allBranches: true });
    const s = await rawLogin(env.app, u.email);
    const setup = await s.call("POST", "/api/auth/mfa/setup", { password: PASSWORD });
    await s.call("POST", "/api/auth/mfa/enable", { code: totp(setup.body.secret) });
    const s2 = await rawLogin(env.app, u.email);
    for (let i = 0; i < 5; i++) await s2.call("POST", "/api/auth/mfa/verify", { code: "999999" });
    const after = await s2.call("POST", "/api/auth/mfa/verify", { code: totp(setup.body.secret) });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("unauthenticated");
    const a = await env.db.adminPool.query("SELECT 1 FROM audit_log WHERE user_id = $1 AND action = 'auth.mfa_locked'", [u.id]);
    expect(a.rowCount).toBe(1);
  });

  it("la clínica puede exigir 2 pasos por rol (solo el propietario cambia la política)", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const admin = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { allBranches: true })).email);
    expect((await admin.patch("/api/clinic", { mfaRequiredRoles: [] })).status).toBe(403);
    expect((await owner.patch("/api/clinic", { mfaRequiredRoles: ["receptionist"] })).status).toBe(200);
    const rec = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    const s = await rawLogin(env.app, rec.email);
    expect(s.me.mfaEnrollmentRequired).toBe(true);
    const blocked = await s.call("GET", "/api/patients");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("mfa_enrollment_required");
    const setup = await s.call("POST", "/api/auth/mfa/setup", { password: PASSWORD });
    await s.call("POST", "/api/auth/mfa/enable", { code: totp(setup.body.secret) });
    expect((await s.call("GET", "/api/patients")).status).toBe(200);
    await owner.patch("/api/clinic", { mfaRequiredRoles: [] });
  });
});

describe("recuperación y restablecimiento de contraseña", () => {
  it("'olvidé mi contraseña' responde igual exista o no el correo, y el enlace sirve una sola vez", async () => {
    const u = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
    const old = await login(env.app, u.email);
    const before = env.mailer.sent.length;
    const a = await env.app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: "nadie@test.local" } });
    const b = await env.app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: u.email } });
    expect(a.json()).toEqual(b.json());
    expect(env.mailer.sent.length).toBe(before + 1);
    const mail = env.mailer.sent.at(-1)!;
    expect(mail.to).toBe(u.email);
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    // contraseña débil rechazada; luego éxito
    expect((await env.app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, newPassword: "corta" } })).statusCode).toBe(400);
    expect((await env.app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, newPassword: "NuevaClave2026x" } })).statusCode).toBe(200);
    expect((await env.app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, newPassword: "OtraClave2026x" } })).statusCode).toBe(400);
    expect((await old.get("/api/patients")).status).toBe(401); // sesiones anteriores cerradas
    await login(env.app, u.email, "NuevaClave2026x");
  });

  it("un enlace vencido no sirve", async () => {
    const u = await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] });
    await env.app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: u.email } });
    const token = new URL(env.mailer.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    await env.db.adminPool.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [u.id]);
    const r = await env.app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, newPassword: "NuevaClave2026x" } });
    expect(r.json().error.code).toBe("invalid_token");
  });

  it("administración genera una contraseña temporal que obliga a cambiarla", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    const r = await owner.post(`/api/staff/${u.id}/reset-password`);
    expect(r.body.temporaryPassword).toMatch(/^Tmp-/);
    const s = await rawLogin(env.app, u.email, r.body.temporaryPassword);
    expect(s.me.mustChangePassword).toBe(true);
    expect((await s.call("GET", "/api/patients")).body.error.code).toBe("password_change_required");
    expect((await s.call("POST", "/api/auth/change-password", { currentPassword: r.body.temporaryPassword, newPassword: "MiClaveSegura2026" })).status).toBe(200);
    expect((await s.call("GET", "/api/patients")).status).toBe(200);
  });

  it("no se puede restablecer la contraseña de alguien que también trabaja en otra clínica", async () => {
    const other = await createClinic(env.db);
    const u = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
    await env.db.adminPool.query("INSERT INTO memberships (clinic_id, user_id, role, branch_ids) VALUES ($1,$2,'dentist',$3)", [other.clinicId, u.id, [other.branches[0]]]);
    const owner = await login(env.app, K.ownerEmail);
    const r = await owner.post(`/api/staff/${u.id}/reset-password`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("multi_clinic_user");
  });
});

describe("consentimientos y documentos firmados", () => {
  const PNG = "data:image/png;base64," + Buffer.from("firma-de-prueba").toString("base64");

  it("firma en pantalla: copia el texto, calcula el hash, verifica integridad y actualiza la ficha", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const p = await createPatient(owner, { firstName: "Firma", consentReminders: false });
    const t = (await owner.get("/api/consent-templates?kind=reminders")).body[0];
    expect((await owner.post(`/api/patients/${p}/documents`, { templateId: t.id, decision: "granted", method: "signature_pad", signerName: "Firma Prueba" })).status).toBe(400);
    const r = await owner.post(`/api/patients/${p}/documents`, { templateId: t.id, decision: "granted", method: "signature_pad", signerName: "Firma Prueba", signaturePng: PNG });
    expect(r.status).toBe(200);
    expect(r.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const d = (await owner.get(`/api/documents/${r.body.id}`)).body;
    expect(d.integrityOk).toBe(true);
    expect(d.body).toContain("Firma");
    expect(d.body).not.toContain("{paciente}");
    expect((await owner.get(`/api/patients/${p}`)).body.patient.consentReminders).toBe(true);
    // revocar
    await owner.post(`/api/patients/${p}/documents`, { templateId: t.id, decision: "revoked", method: "paper_signed", signerName: "Firma Prueba" });
    expect((await owner.get(`/api/patients/${p}`)).body.patient.consentReminders).toBe(false);
    const docs = (await owner.get(`/api/patients/${p}/documents`)).body;
    expect(docs.current.reminders).toBe("revoked");
    expect(docs.documents).toHaveLength(2);
    // inmutable a nivel de base
    await expect(env.db.adminPool.query("UPDATE signed_documents SET body = 'x' WHERE id = $1", [r.body.id])).rejects.toThrow(/solo inserción/);
  });

  it("los cambios de consentimiento hechos desde la ficha también quedan registrados", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const p = await createPatient(owner, { consentReminders: true });
    const docs = (await owner.get(`/api/patients/${p}/documents`)).body;
    expect(docs.documents[0]).toMatchObject({ kind: "reminders", decision: "granted", method: "staff_registered" });
  });

  it("un menor de edad no firma por sí mismo; firma su representante", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const p = await createPatient(owner, { birthDate: "2016-03-01", guardianName: "Madre Prueba" });
    const t = (await owner.get("/api/consent-templates?kind=informed_consent")).body[0];
    expect((await owner.post(`/api/patients/${p}/documents`, { templateId: t.id, decision: "granted", method: "signature_pad", signerName: "Niño", signaturePng: PNG })).status).toBe(400);
    expect((await owner.post(`/api/patients/${p}/documents`, { templateId: t.id, decision: "granted", method: "signature_pad", signerName: "Madre Prueba", signerRelationship: "guardian", signaturePng: PNG, procedure: "Extracción pieza 85" })).status).toBe(200);
  });

  it("una nueva versión de plantilla desactiva la anterior; firmar con la versión vieja se rechaza", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const old = (await owner.get("/api/consent-templates?kind=marketing")).body[0];
    const v2 = await owner.post("/api/consent-templates", { kind: "marketing", title: old.title, body: old.body + "\nCambio de la versión 2." });
    expect(v2.body.version).toBe(old.version + 1);
    const p = await createPatient(owner);
    const r = await owner.post(`/api/patients/${p}/documents`, { templateId: old.id, decision: "granted", method: "paper_signed", signerName: "X Y Z" });
    expect(r.body.error.code).toBe("template_inactive");
  });

  it("un asistente puede ver pero no firmar consentimientos informados; contabilidad no ve los de recordatorios si no tiene acceso a pacientes", async () => {
    const owner = await login(env.app, K.ownerEmail);
    const asst = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
    const p = await createPatient(owner);
    const t = (await owner.get("/api/consent-templates?kind=informed_consent")).body[0];
    const r = await asst.post(`/api/patients/${p}/documents`, { templateId: t.id, decision: "granted", method: "paper_signed", signerName: "Ana Prueba" });
    expect(r.status).toBe(403);
  });
});
