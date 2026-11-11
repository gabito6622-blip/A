// Decisiones de seguridad de v0.7 (B-090 a B-094): bloqueo por intentos sin revelar cuentas ni
// permitir bloquear a otros, secretos de users fuera del alcance de la app, documentación de la API
// solo para la plataforma en producción, mensajes por sucursal, «BAJA» por número completo y
// claves separadas con rotación.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../server/src/app.js";
import { loadConfig, loadKeys } from "../server/src/config.js";
import { signLink, verifyLink, sealWith, openWith } from "../server/src/lib/keys.js";
import { hashPassword } from "../server/src/lib/password.js";
import { totp } from "../server/src/lib/totp.js";
import { ACCOUNT_MAX_FAILED, PAIR_MAX_FAILED, signUnlockToken } from "../server/src/modules/loginGuard.js";
import { signWebhookBody } from "../server/src/modules/messaging/whatsapp.js";
import { addUser, createClinic, createPatient, login, PASSWORD, setupEnv, teardown, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
}, 60_000);
afterAll(async () => teardown(env));

const attempt = (email: string, password: string, remoteAddress = "192.0.2.1") =>
  env.app.inject({ method: "POST", url: "/api/auth/login", remoteAddress, payload: { email, password } });

describe("B-090 · bloqueo por intentos", () => {
  it("la respuesta es idéntica exista o no el correo, esté o no bloqueado o deshabilitado", async () => {
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    const off = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    await env.db.adminPool.query("UPDATE users SET disabled_at = now() WHERE id = $1", [off.id]);
    const ghost = await attempt(`nadie-${randomUUID()}@test.local`, "mala");
    const wrong = await attempt(u.email, "mala");
    const disabled = await attempt(off.email, PASSWORD);
    for (let i = 1; i < PAIR_MAX_FAILED; i++) await attempt(u.email, "mala");
    const lockedRightPw = await attempt(u.email, PASSWORD);
    for (const r of [wrong, disabled, lockedRightPw]) {
      expect(r.statusCode).toBe(ghost.statusCode);
      expect(r.body).toBe(ghost.body);
      expect(r.headers["content-type"]).toBe(ghost.headers["content-type"]);
    }
    expect(ghost.statusCode).toBe(401);
    expect(ghost.json().error.message).not.toMatch(/bloquead/i);
  });

  it("un atacante desde otra red no deja fuera a la persona", async () => {
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    for (let i = 0; i < PAIR_MAX_FAILED + 3; i++) await attempt(u.email, "adivinanza", "203.0.113.66");
    expect((await attempt(u.email, PASSWORD, "203.0.113.66")).statusCode).toBe(401);
    expect((await attempt(u.email, PASSWORD, "198.51.100.7")).statusCode).toBe(200);
    // IPv6: todo el /64 cuenta como un mismo origen.
    for (let i = 0; i < PAIR_MAX_FAILED; i++) await attempt(u.email, "mala", `2001:db8:1:2::${i + 1}`);
    expect((await attempt(u.email, PASSWORD, "2001:db8:1:2::ffff")).statusCode).toBe(401);
    expect((await attempt(u.email, PASSWORD, "2001:db8:1:3::1")).statusCode).toBe(200);
  });

  it("ataque distribuido: al límite global se bloquea la cuenta y llega un enlace de desbloqueo de un solo uso", async () => {
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    const before = env.mailer.sent.length;
    for (let i = 0; i < ACCOUNT_MAX_FAILED; i++) {
      const r = await attempt(u.email, "mala", `198.18.${Math.floor(i / (PAIR_MAX_FAILED - 1))}.1`);
      expect(r.statusCode).toBe(401);
    }
    // Bloqueada desde CUALQUIER red, con la misma respuesta de siempre.
    expect((await attempt(u.email, PASSWORD, "100.64.0.9")).statusCode).toBe(401);
    const mails = env.mailer.sent.slice(before).filter((m) => m.to === u.email);
    expect(mails).toHaveLength(1);
    const token = decodeURIComponent(/desbloquear\?token=([^\s]+)/.exec(mails[0]!.text)![1]!);
    const unlock = (t: string) => env.app.inject({ method: "POST", url: "/api/auth/unlock", remoteAddress: "100.64.0.9", payload: { token: t } });
    // Manipulado o firmado con otra clave: no sirve.
    expect((await unlock(token.slice(0, -3) + "AAA")).statusCode).toBe(400);
    const cfg = loadConfig();
    const nonce = (await env.db.adminPool.query("SELECT unlock_nonce FROM login_account_guard WHERE user_id = $1", [u.id])).rows[0].unlock_nonce;
    expect((await unlock(signUnlockToken({ keys: { ...cfg.keys, link: { current: Buffer.alloc(32, 9), previous: null } } }, u.id, nonce))).statusCode).toBe(400);
    // Vencido.
    expect((await unlock(signUnlockToken(cfg, u.id, nonce, Date.now() - 2 * 3600_000))).statusCode).toBe(410);
    // Válido, una sola vez.
    expect((await unlock(token)).statusCode).toBe(200);
    expect((await unlock(token)).statusCode).toBe(409);
    expect((await attempt(u.email, PASSWORD, "100.64.0.9")).statusCode).toBe(200);
    const actions = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE user_id = $1", [u.id])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.account_locked", "auth.unlock_link_sent", "auth.unlocked_by_link"]));
  });

  it("el propietario ve quién está bloqueado y lo desbloquea; recepción no; otra clínica no", async () => {
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    for (let i = 0; i < PAIR_MAX_FAILED; i++) await attempt(u.email, "mala", "192.0.2.77");
    const owner = await login(env.app, K.ownerEmail);
    expect((await owner.get("/api/staff/locks")).body.map((x: any) => x.userId)).toContain(u.id);
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
    expect((await rec.post(`/api/staff/${u.id}/unlock`)).status).toBe(403);
    const other = await createClinic(env.db);
    expect((await (await login(env.app, other.ownerEmail)).post(`/api/staff/${u.id}/unlock`)).status).toBe(404);
    expect((await owner.post(`/api/staff/${u.id}/unlock`)).status).toBe(200);
    expect((await attempt(u.email, PASSWORD, "192.0.2.77")).statusCode).toBe(200);
    expect((await owner.get("/api/staff/locks")).body.map((x: any) => x.userId)).not.toContain(u.id);
    const a = (await env.db.adminPool.query("SELECT user_id FROM audit_log WHERE action = 'auth.unlocked_by_admin' AND entity_id = $1", [u.id])).rows;
    expect(a).toEqual([{ user_id: K.ownerId }]);
  });
});

describe("B-091 · secretos de users", () => {
  it("ingreso, cambio de contraseña y 2 pasos siguen funcionando sin leer el hash", async () => {
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    const s = await login(env.app, u.email);
    expect((await s.post("/api/auth/change-password", { currentPassword: "mala", newPassword: "OtraClave2026x" })).status).toBe(400);
    expect((await s.post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "OtraClave2026x" })).status).toBe(200);
    expect((await attempt(u.email, PASSWORD, "192.0.2.90")).statusCode).toBe(401);
    expect((await attempt(u.email, "OtraClave2026x", "192.0.2.90")).statusCode).toBe(200);
  });
});

describe("B-092 · documentación de la API y mensajes por sucursal", () => {
  it("en producción /api/docs responde 404 salvo a la plataforma", async () => {
    const cfg = { ...loadConfig(), isProduction: true };
    const app = await buildApp(cfg, env.db, { mailer: env.mailer });
    try {
      expect((await app.inject({ method: "GET", url: "/api/docs/json" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/docs" })).statusCode).toBe(404);
      const owner = await login(app, K.ownerEmail);
      expect((await app.inject({ method: "GET", url: "/api/docs/json", headers: { cookie: owner.cookie } })).statusCode).toBe(404);
      const email = `plataforma-${randomUUID()}@test.local`;
      await env.db.adminPool.query("INSERT INTO users (email, full_name, password_hash, is_platform_admin) VALUES ($1,'Plataforma',$2,true)", [email, await hashPassword(PASSWORD)]);
      const plat = await login(app, email);
      expect((await app.inject({ method: "GET", url: "/api/docs/json", headers: { cookie: plat.cookie } })).statusCode).toBe(200);
    } finally { await app.close(); }
    // Fuera de producción sigue pública (la usan las pruebas de permisos).
    expect((await env.app.inject({ method: "GET", url: "/api/docs/json" })).statusCode).toBe(200);
  });

  it("la bandeja de mensajes solo muestra las sucursales permitidas", async () => {
    const [b0, b1] = K.branches as [string, string];
    const tag = randomUUID().slice(0, 8);
    for (const [branch, label] of [[b0, "s0"], [b1, "s1"], [null, "sin"]] as const) {
      await env.db.adminPool.query(
        "INSERT INTO outbound_messages (clinic_id, branch_id, channel, recipient, template, body, status) VALUES ($1,$2,'whatsapp','70000000','prueba.sucursal',$3,'simulated')",
        [K.clinicId, branch, `${tag}-${label}`]);
    }
    const mine = (items: any[]) => items.map((m) => m.body).filter((b: string) => b.startsWith(tag)).sort();
    const owner = await login(env.app, K.ownerEmail);
    expect(mine((await owner.get("/api/messages")).body.items)).toEqual([`${tag}-s0`, `${tag}-s1`, `${tag}-sin`]);
    const admin0 = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { branchIds: [b0] })).email);
    const r = await admin0.get("/api/messages");
    expect(r.status).toBe(200);
    expect(mine(r.body.items)).toEqual([`${tag}-s0`]);
  });
});

describe("B-093 · «BAJA» por número completo", () => {
  it("dos clínicas con celulares que comparten los últimos 8 dígitos: solo se da de baja quien recibió el mensaje", async () => {
    const A = await createClinic(env.db);
    const B = await createClinic(env.db);
    const ownerA = await login(env.app, A.ownerEmail);
    const ownerB = await login(env.app, B.ownerEmail);
    const pA = await createPatient(ownerA, { phone: "71234567", consentReminders: true, consentMarketing: true });
    // Mismo final, otro país (Argentina): antes coincidía por los últimos 8 dígitos.
    const pB = await createPatient(ownerB, { phone: "+54 9 11 71234567", consentReminders: true, consentMarketing: true });
    await env.db.adminPool.query(
      `INSERT INTO outbound_messages (clinic_id, branch_id, patient_id, channel, recipient, template, purpose, body, status, created_at)
       VALUES ($1,$2,$3,'whatsapp','71234567','prueba.baja','reminders','Recordatorio','sent', now() - interval '2 hours'),
              ($4,$5,$6,'whatsapp','+5491171234567','prueba.baja','reminders','Recordatorio','sent', now() - interval '1 hour')`,
      [A.clinicId, A.branches[0], pA, B.clinicId, B.branches[0], pB]);
    process.env.WHATSAPP_APP_SECRET = "secreto-de-prueba";
    try {
      const hook = async (from: string, id: string) => {
        const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body: "BAJA" } }] } }] }] });
        return (await env.app.inject({ method: "POST", url: "/api/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": signWebhookBody(raw, "secreto-de-prueba") }, payload: raw })).json();
      };
      // Desde el +591: aunque el último envío a «…71234567» fue de la clínica B, se asocia a A.
      expect(await hook("59171234567", `in.${randomUUID()}`)).toMatchObject({ received: 1, optOuts: 1 });
      const cons = async (id: string) => (await env.db.adminPool.query("SELECT consent_reminders FROM patients WHERE id = $1", [id])).rows[0].consent_reminders;
      expect(await cons(pA)).toBe(false);
      expect(await cons(pB)).toBe(true);
      // Un número que nunca recibió mensajes: nadie se da de baja.
      expect(await hook("59179999999", `in.${randomUUID()}`)).toMatchObject({ received: 0, optOuts: 0 });
      // La respuesta queda con la sucursal del mensaje original.
      const inb = (await env.db.adminPool.query("SELECT clinic_id, branch_id FROM inbound_messages WHERE patient_id = $1", [pA])).rows;
      expect(inb).toEqual([{ clinic_id: A.clinicId, branch_id: A.branches[0] }]);
    } finally { delete process.env.WHATSAPP_APP_SECRET; }
  });

  it("phone_e164 normaliza celulares de Bolivia y números internacionales", async () => {
    const q = async (p: string | null) => (await env.db.adminPool.query("SELECT phone_e164($1) AS e", [p])).rows[0].e;
    expect(await q("71234567")).toBe("+59171234567");
    expect(await q("+591 7123-4567")).toBe("+59171234567");
    expect(await q("0059171234567")).toBe("+59171234567");
    expect(await q("59171234567")).toBe("+59171234567");
    expect(await q("1234")).toBeNull();
    expect(await q(null)).toBeNull();
  });
});

describe("B-094 · claves separadas con rotación", () => {
  const hex = (n: number) => Buffer.alloc(32, n).toString("hex");

  it("en producción exige dos claves distintas; fuera de producción las deriva sin romper lo existente", () => {
    expect(() => loadKeys({}, true)).toThrow(/DENTAL_MFA_KEY y DENTAL_LINK_KEY/);
    expect(() => loadKeys({ DENTAL_MFA_KEY: hex(1), DENTAL_LINK_KEY: hex(1) }, true)).toThrow(/distintas/);
    expect(() => loadKeys({ DENTAL_MFA_KEY: "corta", DENTAL_LINK_KEY: hex(2) }, true)).toThrow(/32 bytes/);
    const prod = loadKeys({ DENTAL_MFA_KEY: hex(1), DENTAL_LINK_KEY: hex(2), DENTAL_LINK_KEY_PREVIOUS: hex(3) }, true);
    expect(prod.link.previous?.equals(Buffer.alloc(32, 3))).toBe(true);
    expect(prod.mfa.previous).toBeNull();
    const dev = loadKeys({ DENTAL_SECRET_KEY: hex(5) }, false);
    expect(dev.mfa.current.equals(dev.link.current)).toBe(false);
    expect(dev.mfa.previous?.equals(Buffer.alloc(32, 5))).toBe(true); // lo cifrado antes con la clave única se sigue leyendo
  });

  it("un enlace firmado con la clave anterior vale durante la rotación y deja de valer al retirarla", () => {
    const old = Buffer.alloc(32, 11), cur = Buffer.alloc(32, 12);
    const t = signLink(old, "desbloqueo", { u: "x" }, 600).token;
    expect(verifyLink({ current: cur, previous: old }, "desbloqueo", t).ok).toBe(true);
    expect(verifyLink({ current: cur, previous: null }, "desbloqueo", t).ok).toBe(false);
    expect(verifyLink({ current: cur, previous: old }, "otro-uso", t).ok).toBe(false);
    const sealed = sealWith(old, "SECRETO");
    expect(openWith({ current: cur, previous: old }, sealed)).toEqual({ plain: "SECRETO", rotated: true });
    expect(() => openWith(cur, sealed)).toThrow();
  });

  it("el secreto de los 2 pasos cifrado con la clave anterior se vuelve a cifrar con la nueva al usarse", async () => {
    const cfg = loadConfig();
    const u = await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] });
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const oldKey = cfg.keys.mfa.current;
    await env.db.adminPool.query("UPDATE users SET mfa_secret_enc = $2, mfa_enabled_at = now() WHERE id = $1", [u.id, sealWith(oldKey, secret)]);
    const newKey = Buffer.alloc(32, 21);
    const app = await buildApp({ ...cfg, keys: { ...cfg.keys, mfa: { current: newKey, previous: oldKey } } }, env.db, { mailer: env.mailer });
    try {
      const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: u.email, password: PASSWORD } });
      expect(r.statusCode).toBe(200);
      const cookie = String(r.headers["set-cookie"]).split(";")[0]!;
      const csrf = (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).json().csrfToken;
      const v = await app.inject({ method: "POST", url: "/api/auth/mfa/verify", headers: { cookie, "x-csrf-token": csrf }, payload: { code: totp(secret) } });
      expect(v.statusCode, v.body).toBe(200);
    } finally { await app.close(); }
    const enc = (await env.db.adminPool.query("SELECT mfa_secret_enc FROM users WHERE id = $1", [u.id])).rows[0].mfa_secret_enc;
    expect(openWith(newKey, enc)).toEqual({ plain: secret, rotated: false });
  });
});
