import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { loadConfig } from "../server/src/config.js";
import { createDb, type Db } from "../server/src/lib/db.js";
import { buildApp } from "../server/src/app.js";
import { hashPassword } from "../server/src/lib/password.js";
import { seedCatalog } from "../server/src/lib/catalog.js";
import type { Role } from "../server/src/lib/rbac.js";

export const PASSWORD = "Prueba12345";
let pwHash: string | null = null;

export interface Env { app: FastifyInstance; db: Db }

export async function setupEnv(): Promise<Env> {
  const cfg = loadConfig();
  const db = createDb(cfg.databaseUrl);
  const app = await buildApp(cfg, db);
  await app.ready();
  return { app, db };
}

export async function teardown(env: Env) {
  await env.app.close();
  await env.db.close();
}

export interface TestClinic {
  clinicId: string;
  branches: string[];
  chairs: string[][];
  ownerEmail: string;
  ownerId: string;
}

/** Crea una clínica completa con el pool de administración (como lo haría el superadmin). */
export async function createClinic(db: Db, opts: { branches?: number; name?: string } = {}): Promise<TestClinic> {
  pwHash ??= await hashPassword(PASSWORD);
  const tag = randomUUID().slice(0, 8);
  const c = await db.adminPool.connect();
  try {
    const plan = (await c.query<{ id: string }>(
      `INSERT INTO plans (code, name, max_branches, max_users, price_cents) VALUES ($1, 'Test', 10, 50, 0) RETURNING id`, [`test-${tag}`])).rows[0]!.id;
    const clinicId = (await c.query<{ id: string }>(
      "INSERT INTO clinics (slug, name, plan_id, status) VALUES ($1,$2,$3,'active') RETURNING id", [`c-${tag}`, opts.name ?? `Clínica ${tag}`, plan])).rows[0]!.id;
    const ownerEmail = `owner-${tag}@test.local`;
    const ownerId = (await c.query<{ id: string }>("INSERT INTO users (email, full_name, password_hash) VALUES ($1,'Dueña Prueba',$2) RETURNING id", [ownerEmail, pwHash])).rows[0]!.id;
    await c.query("INSERT INTO memberships (clinic_id, user_id, role, all_branches) VALUES ($1,$2,'owner',true)", [clinicId, ownerId]);
    const branches: string[] = [];
    const chairs: string[][] = [];
    for (let i = 0; i < (opts.branches ?? 2); i++) {
      const b = (await c.query<{ id: string }>("INSERT INTO branches (clinic_id, code, name) VALUES ($1,$2,$3) RETURNING id", [clinicId, `S${i + 1}`, `Sucursal ${i + 1}`])).rows[0]!.id;
      branches.push(b);
      const ch: string[] = [];
      for (let j = 0; j < 2; j++) ch.push((await c.query<{ id: string }>("INSERT INTO chairs (clinic_id, branch_id, name) VALUES ($1,$2,$3) RETURNING id", [clinicId, b, `Consultorio ${j + 1}`])).rows[0]!.id);
      chairs.push(ch);
    }
    await seedCatalog(c, clinicId);
    return { clinicId, branches, chairs, ownerEmail, ownerId };
  } finally {
    c.release();
  }
}

export async function addUser(db: Db, clinicId: string, role: Role, opts: { branchIds?: string[]; allBranches?: boolean; professional?: boolean; commissionPct?: number } = {}) {
  pwHash ??= await hashPassword(PASSWORD);
  const email = `${role}-${randomUUID().slice(0, 8)}@test.local`;
  const id = (await db.adminPool.query<{ id: string }>("INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id", [email, `${role} ${email.slice(-14, -11)}`, pwHash])).rows[0]!.id;
  await db.adminPool.query(
    "INSERT INTO memberships (clinic_id, user_id, role, all_branches, branch_ids, is_professional, commission_pct) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [clinicId, id, role, opts.allBranches ?? false, opts.branchIds ?? [], opts.professional ?? role === "dentist", opts.commissionPct ?? null],
  );
  return { id, email };
}

/** Horario amplio todos los días para que las pruebas no dependan del día de la semana. */
export async function fullSchedule(db: Db, clinicId: string, dentistId: string, branchId: string) {
  for (let d = 1; d <= 7; d++) {
    await db.adminPool.query("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,'07:00','21:00')", [clinicId, dentistId, branchId, d]);
  }
}

export interface Agent {
  get(url: string): Promise<{ status: number; body: any; headers: Record<string, unknown> }>;
  post(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  put(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  patch(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  cookie: string;
  csrf: string;
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<Agent> {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login ${email} -> ${r.statusCode} ${r.body}`);
  const setCookie = String(r.headers["set-cookie"]);
  const cookie = setCookie.split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  const csrf = me.json().csrfToken as string;
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: { cookie, "x-csrf-token": csrf }, ...(body !== undefined ? { payload: body as object } : method !== "GET" ? { payload: {} } : {}) });
    let parsed: unknown = null;
    try { parsed = res.json(); } catch { parsed = res.body; }
    return { status: res.statusCode, body: parsed as any, headers: res.headers as Record<string, unknown> };
  };
  return {
    cookie, csrf,
    get: (u) => call("GET", u),
    post: (u, b) => call("POST", u, b),
    put: (u, b) => call("PUT", u, b),
    patch: (u, b) => call("PATCH", u, b),
  };
}

/** Fecha/hora futura en La Paz: dentro de `days` días a la hora indicada. */
export function future(days: number, hour: number, minute = 0): string {
  return DateTime.now().setZone("America/La_Paz").plus({ days }).set({ hour, minute, second: 0, millisecond: 0 }).toISO()!;
}

export async function createPatient(agent: Agent, over: Record<string, unknown> = {}) {
  const r = await agent.post("/api/patients", {
    firstName: "Ana", lastName: `Prueba ${randomUUID().slice(0, 6)}`, documentType: "CI", documentNumber: String(Math.floor(Math.random() * 1e9)),
    birthDate: "1990-05-10", phone: `7${Math.floor(1000000 + Math.random() * 8999999)}`, allowDuplicate: true, ...over,
  });
  if (r.status !== 200) throw new Error(`createPatient ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}

export async function procedureId(db: Db, clinicId: string, code: string) {
  return (await db.adminPool.query<{ id: string }>("SELECT id FROM procedures WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0]!.id;
}
