import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, createClinic, login, PASSWORD, setupEnv, teardown, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let clinic: TestClinic;
beforeAll(async () => { env = await setupEnv(); clinic = await createClinic(env.db); });
afterAll(async () => teardown(env));

describe("autenticación", () => {
  it("rechaza credenciales con un mensaje genérico (sin revelar si el correo existe)", async () => {
    const a = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: clinic.ownerEmail, password: "incorrecta" } });
    const b = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "noexiste@test.local", password: "incorrecta" } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it("emite cookie HttpOnly y SameSite; /me devuelve permisos y la clínica activa", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: clinic.ownerEmail, password: PASSWORD } });
    const cookie = String(r.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await env.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookie.split(";")[0]! } });
    expect(me.json().clinic.id).toBe(clinic.clinicId);
    expect(me.json().permissions).toContain("reports.financial");
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("bloquea la cuenta tras 5 intentos fallidos y lo deja auditado", async () => {
    const u = await addUser(env.db, clinic.clinicId, "receptionist", { branchIds: [clinic.branches[0]!] });
    for (let i = 0; i < 5; i++) {
      const r = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: u.email, password: "mala" } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: u.email, password: PASSWORD } });
    expect(locked.statusCode).toBe(429);
    const audit = await env.db.adminPool.query("SELECT action FROM audit_log WHERE user_id = $1 ORDER BY id", [u.id]);
    expect(audit.rows.map((r) => r.action)).toContain("auth.locked");
  });

  it("exige el token CSRF en operaciones que modifican datos", async () => {
    const agent = await login(env.app, clinic.ownerEmail);
    const r = await env.app.inject({ method: "POST", url: "/api/patients", headers: { cookie: agent.cookie }, payload: { firstName: "X", lastName: "Y", documentType: "SIN" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("csrf");
  });

  it("sin sesión responde 401 y al cerrar sesión el token deja de servir", async () => {
    expect((await env.app.inject({ method: "GET", url: "/api/patients" })).statusCode).toBe(401);
    const agent = await login(env.app, clinic.ownerEmail);
    expect((await agent.post("/api/auth/logout")).status).toBe(200);
    expect((await agent.get("/api/patients")).status).toBe(401);
  });

  it("cambiar la contraseña cierra las demás sesiones", async () => {
    const u = await addUser(env.db, clinic.clinicId, "admin", { allBranches: true });
    const s1 = await login(env.app, u.email);
    const s2 = await login(env.app, u.email);
    const r = await s1.post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "NuevaClave2026" });
    expect(r.status).toBe(200);
    expect((await s2.get("/api/clinic")).status).toBe(401);
    expect((await s1.get("/api/clinic")).status).toBe(200);
  });

  it("un usuario desactivado pierde acceso a la clínica de inmediato", async () => {
    const u = await addUser(env.db, clinic.clinicId, "receptionist", { branchIds: [clinic.branches[0]!] });
    const s = await login(env.app, u.email);
    const owner = await login(env.app, clinic.ownerEmail);
    const r = await owner.put(`/api/staff/${u.id}`, { role: "receptionist", branchIds: [clinic.branches[0]], active: false });
    expect(r.status).toBe(200);
    expect((await s.get("/api/patients")).status).toBe(401);
  });
});
