// Auditoría automática de acceso (Equipo Q): recorre TODAS las rutas del OpenAPI (/api/docs/json)
// y verifica por ruta que
//  * sin sesión responde 401, salvo las públicas de la lista explícita (y toda ruta pública está en ella);
//  * con un rol que NO tiene el permiso declarado responde 403;
//  * ninguna ruta del personal queda pública ni sin permiso por accidente (listas explícitas).
// Si agregas una ruta pública o una ruta «para todo el personal», agrégala a la lista con su motivo.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permissionsFor, ROLES, type Permission, type Role } from "../server/src/lib/rbac.js";
import { addUser, createClinic, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
interface Op { method: string; path: string; access: string; perm: string | null; security: boolean }
let ops: Op[] = [];
const agents = new Map<Role, Agent>();

// ---- Lista explícita de rutas sin sesión del personal (con su protección propia) ----
const PUBLIC_ROUTES = new Set([
  // Ingreso y recuperación de contraseña (límite por IP, respuesta genérica)
  "POST /api/auth/login", "POST /api/auth/forgot", "POST /api/auth/reset",
  // Desbloqueo con el enlace recibido por correo (firmado, de un solo uso, con vencimiento y límite por IP)
  "POST /api/auth/unlock",
  // Presupuesto por enlace (token de 256 bits + verificación + bloqueo tras 5 intentos)
  "POST /api/public/budget-links/{token}/verify", "POST /api/public/budget-links/{token}/view",
  "POST /api/public/budget-links/{token}/accept", "POST /api/public/budget-links/{token}/reject",
  // Verificación de documentos por código (60 bits, sin datos del paciente)
  "GET /api/public/verify/{code}",
  // Encuesta y QR de llegada (tokens HMAC por propósito)
  "GET /api/public/llegada/{token}", "POST /api/public/llegada/{token}",
  "GET /api/public/llegada-recordatorio/{token}", "POST /api/public/llegada-recordatorio/{token}",
  "GET /api/public/encuesta/{token}", "POST /api/public/encuesta/{token}",
  // Confirmación de cita (token HMAC de un solo uso)
  "GET /api/public/confirmar/{token}", "POST /api/public/confirmar/{token}",
  // Disponibilidad para el monitoreo externo (solo responde {ok}: sin datos internos ni de pacientes)
  "GET /api/ready",
  // Webhook de WhatsApp (firma HMAC de Meta)
  "GET /api/webhooks/whatsapp", "POST /api/webhooks/whatsapp",
  // Reserva online y portal del paciente (slug habilitado + código de un solo uso + sesión psid)
  ...[
    "GET /info", "GET /dentists", "GET /days", "GET /slots", "POST /holds", "POST /holds/release", "GET /review",
    "POST /auth/existing", "POST /auth/signup", "POST /auth/verify", "POST /auth/logout", "GET /me", "POST /bookings",
    "GET /me/bookings/{id}", "POST /me/bookings/{id}/cancel", "GET /me/appointments", "GET /me/appointments/{id}/ics",
    "POST /me/appointments/{id}/cancel", "POST /me/appointments/{id}/reschedule", "GET /me/account", "GET /me/payments/{id}",
    "GET /me/budgets", "POST /me/messages/opt-out",
  ].map((s) => { const [m, p] = s.split(" "); return `${m} /api/public/c/{slug}${p}`; }),
]);

// ---- Rutas con sesión pero sin clínica (la propia cuenta) ----
const SESSION_ROUTES = new Set([
  "POST /api/auth/mfa/verify", "POST /api/auth/logout", "GET /api/auth/me", "POST /api/auth/switch-clinic", "POST /api/auth/change-password",
  "POST /api/auth/mfa/setup", "POST /api/auth/mfa/enable", "POST /api/auth/mfa/disable", "POST /api/auth/mfa/recovery-codes",
]);

// ---- Rutas de la clínica SIN permiso específico: catálogos que necesita cualquier miembro ----
const ANY_MEMBER_ROUTES = new Set([
  "GET /api/clinic", "GET /api/branches", "GET /api/staff", "GET /api/schedules", "GET /api/procedures",
  "GET /api/consent-templates", "GET /api/medications", "GET /api/procedure-sessions",
]);

const key = (o: Pick<Op, "method" | "path">) => `${o.method} ${o.path}`;
const fill = (path: string) => path
  .replace(/\{slug\}/g, "clinica-que-no-existe")
  .replace(/\{token\}/g, "x".repeat(43) + "." + "y".repeat(22))
  .replace(/\{code\}/g, "AAAA-BBBB-CCCC")
  .replace(/\{name\}/g, "resumen_agenda")
  .replace(/\{[^}]+\}/g, () => randomUUID());

async function call(method: string, url: string, a?: Agent) {
  const headers: Record<string, string> = a ? { cookie: a.cookie, "x-csrf-token": a.csrf } : {};
  const r = await env.app.inject({ method: method as "GET", url, headers, ...(method === "GET" ? {} : { payload: {} }) });
  let body: any = null;
  try { body = r.json(); } catch { body = r.body; }
  return { status: r.statusCode, body };
}

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  const spec = (await env.app.inject({ method: "GET", url: "/api/docs/json" })).json();
  for (const [path, item] of Object.entries<Record<string, any>>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      ops.push({ method: method.toUpperCase(), path, access: op["x-access"], perm: op["x-permission"] ?? null, security: !!op.security });
    }
  }
  agents.set("owner", await login(env.app, K.ownerEmail));
  for (const r of ROLES) {
    if (r === "owner") continue;
    const u = await addUser(env.db, K.clinicId, r, { allBranches: true });
    agents.set(r, await login(env.app, u.email));
  }
}, 120_000);
afterAll(async () => teardown(env));

describe("inventario de rutas (OpenAPI)", () => {
  it("el OpenAPI lista todas las rutas de /api con su tipo de acceso", () => {
    expect(ops.length).toBeGreaterThan(350);
    const sinMeta = ops.filter((o) => o.path.startsWith("/api/") && !o.path.startsWith("/api/docs") && !o.access).map(key);
    expect(sinMeta, "rutas registradas sin route() de lib/http.ts").toEqual([]);
  });

  it("toda ruta pública está en la lista explícita y vive bajo /api/public, /api/webhooks o el ingreso", () => {
    const pub = ops.filter((o) => o.access === "public").map(key);
    expect(pub.filter((k) => !PUBLIC_ROUTES.has(k)), "ruta pública no declarada").toEqual([]);
    expect([...PUBLIC_ROUTES].filter((k) => !pub.includes(k)), "lista desactualizada").toEqual([]);
    for (const k of pub) expect(k).toMatch(/^(GET|POST) \/api\/(public\/|webhooks\/|auth\/(login|forgot|reset|unlock)$|ready$)/);
    // Y al revés: nada bajo /api/public exige sesión del personal ni queda fuera de la lista.
    const underPublic = ops.filter((o) => o.path.startsWith("/api/public/") && o.access !== "public").map(key);
    expect(underPublic).toEqual([]);
  });

  it("toda ruta del personal declara la cookie de sesión en el OpenAPI", () => {
    expect(ops.filter((o) => o.access !== "public" && !o.security).map(key)).toEqual([]);
  });

  it("solo las rutas de la propia cuenta usan acceso 'session' y solo /api/platform usa 'platform'", () => {
    expect(ops.filter((o) => o.access === "session").map(key).sort()).toEqual([...SESSION_ROUTES].sort());
    for (const o of ops.filter((x) => x.access === "platform")) expect(o.path).toMatch(/^\/api\/platform\//);
    for (const o of ops.filter((x) => x.path.startsWith("/api/platform/"))) expect(o.access).toBe("platform");
  });

  it("toda ruta de la clínica declara un permiso (salvo los catálogos de la lista explícita)", () => {
    const sinPerm = ops.filter((o) => o.access === "clinic" && !o.perm).map(key);
    expect(sinPerm.filter((k) => !ANY_MEMBER_ROUTES.has(k)), "ruta del personal sin perm").toEqual([]);
    expect([...ANY_MEMBER_ROUTES].filter((k) => !sinPerm.includes(k)), "lista desactualizada").toEqual([]);
    // Los catálogos abiertos a todo el personal son solo de lectura.
    for (const k of ANY_MEMBER_ROUTES) expect(k.startsWith("GET ")).toBe(true);
  });
});

describe("sin sesión", () => {
  it("toda ruta del personal responde 401 (y no lee el cuerpo)", async () => {
    const bad: string[] = [];
    for (const o of ops.filter((x) => x.access && x.access !== "public")) {
      const r = await call(o.method, fill(o.path));
      if (r.status !== 401 || r.body?.error?.code !== "unauthenticated") bad.push(`${key(o)} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  it("un cuerpo grande sin sesión se rechaza con 401 antes de procesarlo", async () => {
    const big = JSON.stringify({ q: "x".repeat(5 * 1024 * 1024) });
    const r = await env.app.inject({ method: "POST", url: "/api/patients", headers: { "content-type": "application/json" }, payload: big });
    expect(r.statusCode).toBe(401);
  });

  it("las rutas públicas aceptan como máximo 1 MB de cuerpo", async () => {
    const big = JSON.stringify({ action: "confirm", pad: "x".repeat(2 * 1024 * 1024) });
    const r = await env.app.inject({ method: "POST", url: fill("/api/public/confirmar/{token}"), headers: { "content-type": "application/json", "x-portal": "1" }, payload: big });
    expect(r.statusCode).toBe(413);
  });

  it("las rutas públicas con datos inválidos no producen errores internos (500)", async () => {
    const bad: string[] = [];
    for (const o of ops.filter((x) => x.access === "public")) {
      const r = await call(o.method, fill(o.path));
      if (r.status === 500) bad.push(`${key(o)} → 500 ${JSON.stringify(r.body)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("con sesión y sin el permiso", () => {
  it("cada ruta responde 403 a un rol que no tiene su permiso", async () => {
    const lacking = (p: Permission) => ROLES.filter((r) => !permissionsFor(r, false).has(p));
    const bad: string[] = [];
    let checked = 0;
    for (const o of ops.filter((x) => x.perm)) {
      const roles = lacking(o.perm as Permission);
      for (const role of roles) {
        const r = await call(o.method, fill(o.path), agents.get(role));
        checked++;
        if (r.status !== 403) bad.push(`${key(o)} [${o.perm}] como ${role} → ${r.status}`);
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(500);
  }, 180_000);

  it("las rutas de plataforma responden 403 al propietario de una clínica", async () => {
    const bad: string[] = [];
    for (const o of ops.filter((x) => x.access === "platform")) {
      const r = await call(o.method, fill(o.path), agents.get("owner"));
      if (r.status !== 403) bad.push(`${key(o)} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  it("el rol de limpieza no accede a ninguna ruta con datos de pacientes, agenda o dinero", async () => {
    const support = permissionsFor("support", false);
    const sensitive: Permission[] = ["patients.read", "agenda.read", "clinical.read", "budgets.read", "payments.read", "reports.financial", "reports.operational", "audit.read"];
    for (const p of sensitive) expect(support.has(p)).toBe(false);
  });
});
