import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { addUser, createClinic, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent;
beforeAll(async () => { env = await setupEnv(); K = await createClinic(env.db); owner = await login(env.app, K.ownerEmail); });
afterAll(async () => teardown(env));

describe("pacientes", () => {
  it("asigna N° de ficha correlativo y busca sin importar tildes", async () => {
    const a = await owner.post("/api/patients", { firstName: "José", lastName: "Mamani Quispe", documentNumber: "4455667", phone: "71234567" });
    const b = await owner.post("/api/patients", { firstName: "María", lastName: "Choque", documentNumber: "8899001" });
    expect(b.body.recordNumber).toBe(a.body.recordNumber + 1);
    const s = await owner.get("/api/patients?q=jose mamani");
    expect(s.body.items[0].firstName).toBe("José");
    expect(s.body.items[0].phone).toBe("+59171234567");
    expect((await owner.get("/api/patients?q=4455667")).body.items).toHaveLength(1);
  });

  it("detecta duplicados por documento, teléfono o nombre parecido", async () => {
    const r = await owner.post("/api/patients", { firstName: "Jose", lastName: "Mamani Quispe", documentType: "SIN" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("possible_duplicate");
    const byPhone = await owner.post("/api/patients/check-duplicates", { phone: "7123 4567" });
    expect(byPhone.body.duplicates[0].reason).toBe("teléfono");
    const sameDoc = await owner.post("/api/patients", { firstName: "Otro", lastName: "Nombre", documentNumber: "4455667", allowDuplicate: true });
    expect(sameDoc.status).toBe(409);
    expect(sameDoc.body.error.code).toBe("duplicate_document");
  });

  it("menores de edad requieren responsable", async () => {
    const r = await owner.post("/api/patients", { firstName: "Niño", lastName: "Prueba", documentType: "SIN", birthDate: "2018-01-01" });
    expect(r.status).toBe(400);
    expect((await owner.post("/api/patients", { firstName: "Niño", lastName: "Prueba", documentType: "SIN", birthDate: "2018-01-01", guardianName: "Madre Prueba" })).status).toBe(200);
  });

  it("registra la fecha en que cambia el consentimiento", async () => {
    const r = await owner.post("/api/patients", { firstName: "Consen", lastName: "Timiento", documentType: "SIN" });
    const p = (await owner.get(`/api/patients/${r.body.id}`)).body.patient;
    expect(p.consentUpdatedAt).toBeNull();
    await owner.put(`/api/patients/${r.body.id}`, { ...p, email: null, consentReminders: true });
    expect((await owner.get(`/api/patients/${r.body.id}`)).body.patient.consentUpdatedAt).not.toBeNull();
  });

  it("archivar no borra: el paciente sale de la lista pero se conserva", async () => {
    const r = await owner.post("/api/patients", { firstName: "Archivo", lastName: "Prueba", documentType: "SIN" });
    await owner.post(`/api/patients/${r.body.id}/archive`, { archived: true });
    expect((await owner.get("/api/patients?q=archivo prueba")).body.items).toHaveLength(0);
    expect((await owner.get("/api/patients?q=archivo prueba&archived=1")).body.items).toHaveLength(1);
  });

  it("importa desde Excel: valida primero (dryRun) y luego registra, omitiendo duplicados", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Hoja1");
    ws.addRow(["Nombre", "Apellido", "CI", "Fecha de nacimiento", "Celular", "Sexo"]);
    ws.addRow(["Lucía", "Flores", "1112223", "05/03/1985", "76543210", "F"]);
    ws.addRow(["Pedro", "Rojas", "4455667", "1979-11-20", "", "M"]); // duplicado (ya existe)
    ws.addRow(["", "SinNombre", "", "", "", ""]);
    ws.addRow(["Carla", "Vargas", "1112223", "", "", ""]); // documento repetido en el archivo
    ws.addRow(["Hugo", "Paz", "9990001", new Date("1992-02-02"), "", ""]);
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
    const dry = await owner.post("/api/patients/import", { fileBase64: b64, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.summary).toMatchObject({ dryRun: true, ok: 2, duplicates: 2, errors: 1 });
    expect((await owner.get("/api/patients?q=lucia flores")).body.items).toHaveLength(0);
    const real = await owner.post("/api/patients/import", { fileBase64: b64, dryRun: false });
    expect(real.body.summary.ok).toBe(2);
    const lucia = (await owner.get("/api/patients?q=lucia flores")).body.items[0];
    expect(lucia.birthDate).toBe("1985-03-05");
  });

  it("exporta a Excel con protección contra fórmulas y solo con permiso", async () => {
    await owner.post("/api/patients", { firstName: "=HYPERLINK(\"x\")", lastName: "Inyección", documentType: "SIN" });
    const r = await env.app.inject({ method: "GET", url: "/api/patients/export.xlsx", headers: { cookie: owner.cookie } });
    expect(r.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    const names = wb.worksheets[0]!.getColumn(2).values.map(String);
    expect(names).toContain(`'=HYPERLINK("x")`);
    expect(names.some((v) => v.startsWith("="))).toBe(false);
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
    expect((await rec.get("/api/patients/export.xlsx")).status).toBe(403);
  });
});
