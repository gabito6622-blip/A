// Puesta en marcha: primeros pasos derivados de los datos, permisos, migración de pacientes, citas
// futuras y saldos iniciales (B-006), idempotencia, reporte sin fórmulas y aislamiento entre clínicas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

const ZONE = "America/La_Paz";
const day = (n: number) => DateTime.now().setZone(ZONE).plus({ days: n });

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Datos");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
}

async function rawPost(env: Env, a: Agent, url: string, body: unknown) {
  return env.app.inject({ method: "POST", url, headers: { cookie: a.cookie, "x-csrf-token": a.csrf }, payload: body as object });
}
async function readXlsx(payload: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(payload as unknown as ArrayBuffer);
  return wb;
}

let env: Env;
let A: TestClinic, B: TestClinic;
let owner: Agent, ownerB: Agent, reception: Agent, accountant: Agent;
let dentist: { id: string; email: string };

beforeAll(async () => {
  env = await setupEnv();
  A = await createClinic(env.db, { branches: 2, name: "Clínica Inicio A" });
  B = await createClinic(env.db, { branches: 1, name: "Clínica Inicio B" });
  owner = await login(env.app, A.ownerEmail);
  ownerB = await login(env.app, B.ownerEmail);
  reception = await login(env.app, (await addUser(env.db, A.clinicId, "receptionist", { branchIds: A.branches })).email);
  accountant = await login(env.app, (await addUser(env.db, A.clinicId, "accountant", { allBranches: true })).email);
});
afterAll(async () => teardown(env));

const item = (cl: any, id: string) => cl.items.find((i: any) => i.id === id);

describe("primeros pasos", () => {
  it("se calcula desde los datos reales y cambia al completar cada paso", async () => {
    // Clínica recién creada (otra, para no depender del orden de las pruebas)
    const C = await createClinic(env.db, { branches: 1, name: "Clínica Nueva" });
    const o = await login(env.app, C.ownerEmail);
    let cl = (await o.get("/api/onboarding")).body;
    expect(cl.items.map((i: any) => i.id)).toEqual(["clinic", "branches", "staff", "schedules", "procedures", "appointmentTypes", "consents", "ownerMfa", "patients", "portal", "messaging"]);
    expect(cl.items.filter((i: any) => i.optional).map((i: any) => i.id)).toEqual(["portal", "messaging"]);
    expect(cl.requiredDone).toBe(0);
    expect(cl.progressPct).toBe(0);
    expect(cl.complete).toBe(false);
    expect(item(cl, "procedures").warning).toMatch(/18 de 18 prestaciones siguen con el precio de ejemplo/);
    expect(item(cl, "clinic").href).toBe("/configuracion?tab=clinic");

    // 1-2. Datos de la clínica, membrete, consultorios y horario de la sucursal
    await o.patch("/api/clinic", { legalName: "Clínica Nueva S.R.L.", taxId: "1020304050" });
    cl = (await o.get("/api/onboarding")).body;
    expect(item(cl, "clinic").done).toBe(false);
    expect(item(cl, "clinic").detail.join(" ")).toMatch(/Sucursal 1/);
    const hours = { "1": [["08:00", "12:00"]], "2": [["08:00", "12:00"]] };
    expect((await o.put(`/api/branches/${C.branches[0]}`, { code: "S1", name: "Sucursal 1", address: "Calle Falsa 1", city: "La Paz", phone: "22000000", openingHours: hours, active: true })).status).toBe(200);
    cl = (await o.get("/api/onboarding")).body;
    expect(item(cl, "clinic").done).toBe(true);
    expect(item(cl, "branches").done).toBe(true);

    // 3-4. Personal y horarios
    const dent = await addUser(env.db, C.clinicId, "dentist", { branchIds: C.branches });
    cl = (await o.get("/api/onboarding")).body;
    expect(item(cl, "staff").done).toBe(true);
    expect(item(cl, "schedules").done).toBe(false);
    expect(item(cl, "schedules").detail[0]).toMatch(/Sin horario/);
    await o.put(`/api/schedules/${dent.id}`, { slots: [{ branchId: C.branches[0], weekday: 1, start: "08:00", end: "12:00" }] });
    expect(item((await o.get("/api/onboarding")).body, "schedules").done).toBe(true);

    // 5. Prestaciones: con un precio propio el paso queda hecho, pero sigue el aviso de los de ejemplo
    const procs = (await o.get("/api/procedures")).body;
    const con = procs.find((p: any) => p.code === "CON-01");
    await o.put(`/api/procedures/${con.id}`, { code: con.code, name: con.name, category: con.category, priceCents: 15000, durationMin: con.durationMin, scope: con.scope, active: true });
    cl = (await o.get("/api/onboarding")).body;
    expect(item(cl, "procedures").done).toBe(true);
    expect(item(cl, "procedures").warning).toMatch(/17 de 18/);

    // 6. Tipos de cita (los sugeridos se crean al abrir la agenda)
    expect(item(cl, "appointmentTypes").done).toBe(false);
    await o.get("/api/appointment-types");
    expect(item((await o.get("/api/onboarding")).body, "appointmentTypes").done).toBe(true);

    // 7. Consentimientos: revisados cuando la clínica guarda su versión
    const tpls = (await o.get("/api/consent-templates")).body;
    expect(tpls.length).toBeGreaterThan(1);
    await o.post("/api/consent-templates", { kind: tpls[0].kind, title: tpls[0].title, body: tpls[0].body, category: tpls[0].category });
    cl = (await o.get("/api/onboarding")).body;
    expect(item(cl, "consents").done).toBe(false);
    expect(item(cl, "consents").detail[0]).toMatch(new RegExp(`Sin revisar \\(${tpls.length - 1} de ${tpls.length}\\)`));
    for (const t of tpls.slice(1)) await o.post("/api/consent-templates", { kind: t.kind, title: t.title, body: t.body, category: t.category });
    expect(item((await o.get("/api/onboarding")).body, "consents").done).toBe(true);

    // 8. Dos pasos del propietario
    expect(item(cl, "ownerMfa").href).toBe("/cuenta");
    await env.db.adminPool.query("UPDATE users SET mfa_enabled_at = now() WHERE id = $1", [C.ownerId]);
    expect(item((await o.get("/api/onboarding")).body, "ownerMfa").done).toBe(true);

    // No se puede ocultar mientras falte algo
    expect((await o.put("/api/onboarding/visibility", { hidden: true })).status).toBe(409);

    // 9. Pacientes
    await createPatient(o);
    cl = (await o.get("/api/onboarding")).body;
    expect(cl.complete).toBe(true);
    expect(cl.progressPct).toBe(100);
    expect(item(cl, "portal").done).toBe(false); // opcional: no cuenta para el progreso
    expect((await o.put("/api/onboarding/visibility", { hidden: true })).status).toBe(200);
    expect((await o.get("/api/onboarding")).body.hidden).toBe(true);
    // Si algo vuelve a faltar, reaparece
    await env.db.adminPool.query("INSERT INTO branches (clinic_id, code, name) VALUES ($1, 'S9', 'Sucursal nueva')", [C.clinicId]);
    cl = (await o.get("/api/onboarding")).body;
    expect(cl.complete).toBe(false);
    expect(cl.hidden).toBe(false);
  });

  it("recepción y contabilidad no ven los primeros pasos", async () => {
    expect((await reception.get("/api/onboarding")).status).toBe(403);
    expect((await accountant.get("/api/onboarding")).status).toBe(403);
    expect((await reception.put("/api/onboarding/visibility", { hidden: false })).status).toBe(403);
  });
});

describe("importación: permisos y plantillas", () => {
  it("recepción y contabilidad no importan ni descargan plantillas", async () => {
    const file = await xlsx([["Nombres", "Apellidos"], ["Ana", "Prueba"]]);
    for (const a of [reception, accountant]) {
      expect((await a.post("/api/imports/patients", { fileBase64: file, dryRun: true })).status).toBe(403);
      expect((await a.post("/api/imports/patients/inspect", { fileBase64: file })).status).toBe(403);
      expect((await a.get("/api/imports/batches")).status).toBe(403);
      const t = await env.app.inject({ method: "GET", url: "/api/imports/balances/template.xlsx", headers: { cookie: a.cookie } });
      expect(t.statusCode).toBe(403);
    }
  });

  it("las plantillas traen ejemplos y la explicación de cada columna", async () => {
    for (const kind of ["patients", "appointments", "balances"]) {
      const r = await env.app.inject({ method: "GET", url: `/api/imports/${kind}/template.xlsx`, headers: { cookie: owner.cookie } });
      expect(r.statusCode).toBe(200);
      const wb = await readXlsx(r.rawPayload);
      const data = wb.getWorksheet("Datos")!;
      const fields = (await owner.get(`/api/imports/${kind}/fields`)).body.fields;
      expect(data.getRow(1).values).toEqual([undefined, ...fields.map((f: any) => f.label)]);
      expect(data.rowCount).toBeGreaterThan(1);
      const info = wb.getWorksheet("Instrucciones")!;
      const helpTexts = info.getColumn(3).values.map(String);
      for (const f of fields) expect(helpTexts).toContain(f.help);
    }
  });
});

describe("importación de pacientes", () => {
  it("mapea columnas con otros títulos, muestra vista previa y detecta duplicados en el archivo y en la base", async () => {
    const existing = await createPatient(owner, { firstName: "Rosa", lastName: "Existente", documentNumber: "5550001", phone: "70000001", birthDate: "1980-01-01" });
    expect(existing).toBeTruthy();
    const file = await xlsx([
      ["Paciente", "C.I.", "Fecha Nac.", "Telf.", "Observaciones", "Código"],
      ["Flores, Lucía", "1112223 LP", "05/03/1985", "71234567", "Prefiere la tarde", "OLD-1"],
      ["Mamani, Pedro", "5550001", "1979-11-20", "", "", "OLD-2"], // mismo CI que una ficha existente
      ["Quispe, Carla", "1112223", "", "", "", "OLD-3"], // CI repetido en el archivo
      ["Paz, Hugo", "", "31/02/1990", "", "", "OLD-4"], // fecha inexistente
      ["Gómez, Juan", "", "", "70000001", "", "OLD-5"], // mismo celular que otra ficha: para revisar
      ["Flores, Lucía", "1112223 LP", "05/03/1985", "71234567", "Prefiere la tarde", "OLD-1"], // fila idéntica
      ["Ríos, Tomás", "", "", "", "=HYPERLINK(\"http://x\",\"clic\")", "OLD-6"],
    ]);
    const ins = (await owner.post("/api/imports/patients/inspect", { fileBase64: file })).body;
    expect(ins.rowCount).toBe(7);
    expect(ins.preview).toHaveLength(5);
    expect(ins.mapping).toMatchObject({ fullName: 1, documentNumber: 2, birthDate: 3, phone: 4, notes: 5, externalId: 6, firstName: null });
    const dry = await owner.post("/api/imports/patients", { fileBase64: file, mapping: ins.mapping, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.summary).toMatchObject({ dryRun: true, total: 7, create: 2, duplicates: 3, errors: 1, review: 1 });
    const byRow = (r: number) => dry.body.results.find((x: any) => x.row === r);
    expect(byRow(3).message).toMatch(/mismo documento/);
    expect(byRow(4).message).toMatch(/repetido en el archivo \(igual a la fila 2\)/);
    expect(byRow(5).message).toMatch(/Fecha de nacimiento no válida/);
    expect(byRow(6)).toMatchObject({ status: "review" });
    expect(byRow(7).message).toMatch(/Fila repetida/);
    // La revisión no guardó nada
    expect((await owner.get("/api/patients?q=lucia flores")).body.items).toHaveLength(0);
    expect((await owner.get("/api/imports/batches")).body).toHaveLength(0);

    // Importar exige el número exacto confirmado
    expect((await owner.post("/api/imports/patients", { fileBase64: file, mapping: ins.mapping, dryRun: false })).status).toBe(400);
    const wrong = await owner.post("/api/imports/patients", { fileBase64: file, mapping: ins.mapping, dryRun: false, expectedCreate: 3 });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe("count_changed");
    expect((await owner.get("/api/patients?q=lucia flores")).body.items).toHaveLength(0);
    const real = await owner.post("/api/imports/patients", { fileBase64: file, mapping: ins.mapping, dryRun: false, expectedCreate: 2, fileName: "pacientes.xlsx" });
    expect(real.status).toBe(200);
    expect(real.body.summary.create).toBe(2);
    const lucia = (await owner.get("/api/patients?q=lucia flores")).body.items[0];
    expect(lucia).toMatchObject({ firstName: "Lucía", lastName: "Flores", documentNumber: "1112223", documentIssued: "LP", birthDate: "1985-03-05", phone: "+59171234567" });

    // Idempotente: reimportar el mismo archivo no crea nada
    const again = (await owner.post("/api/imports/patients", { fileBase64: file, mapping: ins.mapping, dryRun: true })).body;
    expect(again.summary.create).toBe(0);
    expect(again.results.find((x: any) => x.row === 2).message).toMatch(/Ya se importó/);
    // Con «importar también las filas para revisar» entra el posible duplicado
    const rev = (await owner.post("/api/imports/patients", { fileBase64: file, mapping: ins.mapping, dryRun: true, includeReview: true })).body;
    expect(rev.summary).toMatchObject({ create: 1, reviewIncluded: 1 });

    // Historial y reporte descargable de la importación real (con protección contra fórmulas)
    const batches = (await owner.get("/api/imports/batches")).body;
    expect(batches[0]).toMatchObject({ kind: "patients", createdCount: 2, duplicateCount: 3, errorCount: 1, reviewCount: 1, fileName: "pacientes.xlsx" });
    const rep = await env.app.inject({ method: "GET", url: `/api/imports/batches/${batches[0].id}/report.xlsx`, headers: { cookie: owner.cookie } });
    expect(rep.statusCode).toBe(200);
    const ws = (await readXlsx(rep.rawPayload)).getWorksheet("Reporte")!;
    const all = ws.getSheetValues().flat().filter((v) => typeof v === "string") as string[];
    expect(all.some((v) => v.startsWith("=") || v.startsWith("+") || v.startsWith("@"))).toBe(false);
    expect(all).toContain("'=HYPERLINK(\"http://x\",\"clic\")");
    // Ninguna celda es una fórmula
    let formulas = 0;
    ws.eachRow((row) => row.eachCell((cell) => { if (cell.type === ExcelJS.ValueType.Formula) formulas++; }));
    expect(formulas).toBe(0);
  });

  it("un archivo que no es Excel o sin las columnas obligatorias se rechaza con un mensaje claro", async () => {
    const bad = await owner.post("/api/imports/patients", { fileBase64: Buffer.from("hola").toString("base64"), dryRun: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/no es un Excel/);
    const noName = await owner.post("/api/imports/patients", { fileBase64: await xlsx([["Teléfono"], ["70000000"]]), dryRun: true });
    expect(noName.status).toBe(400);
    expect(noName.body.error.message).toMatch(/Nombres y Apellidos, o la de Nombre completo/);
    const twice = await owner.post("/api/imports/patients", { fileBase64: await xlsx([["Nombres", "Apellidos"], ["A", "B"]]), mapping: { firstName: 1, lastName: 1 }, dryRun: true });
    expect(twice.status).toBe(400);
    expect(twice.body.error.message).toMatch(/está elegida para/);
  });
});

describe("importación de citas futuras", () => {
  let pA: string, pB: string, recordB: number;
  beforeAll(async () => {
    dentist = await addUser(env.db, A.clinicId, "dentist", { branchIds: A.branches });
    await env.db.adminPool.query("UPDATE users SET full_name = 'Dra. Elena Prueba' WHERE id = $1", [dentist.id]);
    for (let d = 1; d <= 7; d++) {
      await env.db.adminPool.query("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,'08:00','12:00')", [A.clinicId, dentist.id, A.branches[0], d]);
    }
    pA = await createPatient(owner, { firstName: "Cita", lastName: "Uno", documentNumber: "7770001" });
    pB = await createPatient(owner, { firstName: "Cita", lastName: "Dos", documentNumber: "7770002" });
    recordB = (await owner.get(`/api/patients/${pB}`)).body.patient.recordNumber;
    // Cita existente que choca con una fila del archivo
    const ex = await owner.post("/api/appointments", { branchId: A.branches[0], dentistId: dentist.id, patientId: pA, startsAt: day(5).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toISO(), durationMin: 30 });
    expect(ex.status).toBe(200);
  });

  it("valida con el motor de la agenda: solape, fuera de horario, profesional y paciente inexistentes", async () => {
    const d3 = day(3).toFormat("dd/MM/yyyy"), d4 = day(4).toFormat("dd/MM/yyyy"), d5 = day(5).toFormat("dd/MM/yyyy");
    const file = await xlsx([
      ["Fecha", "Hora", "Duración (min)", "Odontólogo", "Sucursal", "CI del paciente", "N° de ficha", "Prestación", "Motivo"],
      [d3, "09:00", 30, "Elena Prueba", "Sucursal 1", "7770001", "", "CON-01", "Control"], // ok (sin «Dra.»)
      [d5, "10:15", 30, "Dra. Elena Prueba", "S1", "7770002", "", "", ""], // solapa con la cita existente del profesional
      [d4, "09:00", 30, dentist.email, "S1", "", String(recordB), "", ""], // ok por N° de ficha y correo
      [d4, "09:15", 30, "Elena Prueba", "S1", "7770001", "", "", ""], // solapa con la fila anterior del archivo
      [d3, "15:00", 30, "Elena Prueba", "S1", "7770002", "", "", ""], // fuera de horario: para revisar
      [d3, "10:00", 30, "Dr. Nadie Inventado", "S1", "7770001", "", "", ""], // profesional inexistente
      [d3, "11:00", 30, "Elena Prueba", "S1", "9999999", "", "", ""], // paciente inexistente
      [day(-2).toFormat("dd/MM/yyyy"), "09:00", 30, "Elena Prueba", "S1", "7770001", "", "", ""], // pasada
      [d3, "25:00", 30, "Elena Prueba", "S1", "7770001", "", "", ""], // hora inválida
    ]);
    const ins = (await owner.post("/api/imports/appointments/inspect", { fileBase64: file })).body;
    expect(ins.mapping).toMatchObject({ date: 1, time: 2, durationMin: 3, professional: 4, branch: 5, patientDoc: 6, patientRecord: 7, procedure: 8, reason: 9 });
    const dry = await owner.post("/api/imports/appointments", { fileBase64: file, mapping: ins.mapping, dryRun: true });
    expect(dry.status).toBe(200);
    const r = (row: number) => dry.body.results.find((x: any) => x.row === row);
    expect(r(2).status).toBe("ok");
    expect(r(3)).toMatchObject({ status: "error" });
    expect(r(3).message).toMatch(/profesional ya tiene una cita en ese horario/);
    expect(r(4).status).toBe("ok");
    expect(r(5).message).toMatch(/fila anterior de este archivo/);
    expect(r(6)).toMatchObject({ status: "review" });
    expect(r(6).message).toMatch(/Fuera del horario/);
    expect(r(7).message).toMatch(/No hay un profesional activo llamado «Dr. Nadie Inventado»/);
    expect(r(8).message).toMatch(/No existe un paciente con el documento 9999999/);
    expect(r(9).message).toMatch(/solo se importan citas futuras/);
    expect(r(10).message).toMatch(/Hora no válida/);
    expect(dry.body.summary).toMatchObject({ create: 2, errors: 6, review: 1, duplicates: 0 });
    // Nada guardado
    const from = day(2).startOf("day").toISO(), to = day(6).endOf("day").toISO();
    const count = async () => (await owner.get(`/api/appointments?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}&dentistId=${dentist.id}`)).body.length;
    expect(await count()).toBe(1);

    // Reporte de la revisión (Excel) con el error de cada fila
    const rep = await rawPost(env, owner, "/api/imports/appointments/report.xlsx", { fileBase64: file, mapping: ins.mapping });
    expect(rep.statusCode).toBe(200);
    const ws = (await readXlsx(rep.rawPayload)).getWorksheet("Reporte")!;
    expect(ws.getRow(1).values).toEqual(expect.arrayContaining(["Fila", "Resultado", "Detalle", "Fecha", "Hora", "Profesional"]));
    expect(ws.getRow(7).getCell(1).value).toBe(7);
    expect(String(ws.getRow(7).getCell(3).value)).toMatch(/No hay un profesional activo/);

    // Importar con las filas para revisar: 3 citas; la de fuera de horario queda marcada
    const real = await owner.post("/api/imports/appointments", { fileBase64: file, mapping: ins.mapping, dryRun: false, includeReview: true, expectedCreate: 3 });
    expect(real.status).toBe(200);
    expect(await count()).toBe(4);
    const rec = await env.db.adminPool.query("SELECT needs_review, a.notes FROM import_records ir JOIN appointments a ON a.id = ir.appointment_id WHERE ir.batch_id = $1 ORDER BY source_row", [real.body.batchId]);
    expect(rec.rows.map((x) => x.needs_review)).toEqual([false, false, true]);
    expect(rec.rows[2].notes).toMatch(/fuera del horario/);
    // Cada cita importada tiene su evento en el historial de la cita
    const ev = await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointment_events e JOIN import_records ir ON ir.appointment_id = e.appointment_id WHERE ir.batch_id = $1", [real.body.batchId]);
    expect(ev.rows[0].n).toBe(3);
    // Reimportar: nada nuevo
    const again = (await owner.post("/api/imports/appointments", { fileBase64: file, mapping: ins.mapping, dryRun: true, includeReview: true })).body;
    expect(again.summary.create).toBe(0);
    expect(again.summary.duplicates).toBe(3);
  });

  it("una sucursal sin acceso o desconocida se informa por fila", async () => {
    const file = await xlsx([["Fecha", "Hora", "Profesional", "Sucursal", "CI"], [day(6).toFormat("dd/MM/yyyy"), "08:30", "Elena Prueba", "Marte", "7770001"]]);
    const dry = (await owner.post("/api/imports/appointments", { fileBase64: file, dryRun: true })).body;
    expect(dry.results[0].message).toMatch(/No existe una sucursal activa «Marte»/);
  });
});

describe("saldos iniciales", () => {
  let p1: string, p2: string, p3: string, rec3: number;
  beforeAll(async () => {
    p1 = await createPatient(owner, { firstName: "Saldo", lastName: "Deudor", documentNumber: "8880001" });
    p2 = await createPatient(owner, { firstName: "Saldo", lastName: "AFavor", documentNumber: "8880002" });
    p3 = await createPatient(owner, { firstName: "Saldo", lastName: "Columnas", documentNumber: "8880003" });
    rec3 = (await owner.get(`/api/patients/${p3}`)).body.patient.recordNumber;
  });
  const money = async (id: string) => (await env.db.adminPool.query("SELECT * FROM patient_money($1)", [id])).rows[0];

  it("crea un movimiento de apertura que patient_money suma, sin tocar producción ni caja, y no se duplica", async () => {
    const cutoff = day(-10).toFormat("dd/MM/yyyy");
    const file = await xlsx([
      ["CI", "N° de ficha", "Saldo (Bs)", "Debe (Bs)", "A favor (Bs)", "Fecha de corte", "Nota"],
      ["8880001", "", "1.350,50", "", "", cutoff, "Restauraciones"],
      ["8880002", "", "-120,00", "", "", cutoff, "Adelanto"],
      ["", String(rec3), "", "800", "100", "", "Ortodoncia"], // fecha de corte por defecto (pantalla)
      ["8880001", "", "50", "", "", cutoff, ""], // mismo paciente otra vez
      ["7770001", "", "0", "", "", cutoff, ""], // saldo cero: se omite
      ["9999998", "", "10", "", "", cutoff, ""], // paciente inexistente
      ["8880002", "", "10", "", "", day(3).toFormat("dd/MM/yyyy"), ""], // corte futuro
      ["8880003", "", "abc", "", "", cutoff, ""], // monto inválido
    ]);
    const mapping = (await owner.post("/api/imports/balances/inspect", { fileBase64: file })).body.mapping;
    expect(mapping).toMatchObject({ patientDoc: 1, patientRecord: 2, balance: 3, debt: 4, credit: 5, cutoffDate: 6, notes: 7 });
    // Sin fecha de corte por defecto, la fila 4 da error
    const noCut = (await owner.post("/api/imports/balances", { fileBase64: file, mapping, dryRun: true })).body;
    expect(noCut.results.find((x: any) => x.row === 4).message).toMatch(/Falta la fecha de corte/);
    const cutoffDate = day(-1).toISODate();
    const dry = (await owner.post("/api/imports/balances", { fileBase64: file, mapping, dryRun: true, cutoffDate })).body;
    expect(dry.summary).toMatchObject({ create: 3, duplicates: 1, skipped: 1, errors: 3 });
    expect(dry.results.find((x: any) => x.row === 5).message).toMatch(/fila 2/);
    expect(dry.results.find((x: any) => x.row === 8).message).toMatch(/no puede ser futura/);
    expect((await money(p1)).balance_cents).toBe(0);

    const before = await env.db.adminPool.query("SELECT (SELECT count(*) FROM charges WHERE clinic_id = $1)::int AS ch, (SELECT count(*) FROM payments WHERE clinic_id = $1)::int AS py", [A.clinicId]);
    const real = await owner.post("/api/imports/balances", { fileBase64: file, mapping, dryRun: false, cutoffDate, expectedCreate: 3 });
    expect(real.status).toBe(200);
    const m1 = await money(p1), m2 = await money(p2), m3 = await money(p3);
    expect(m1).toMatchObject({ opening_cents: 135050, balance_cents: 135050, charged_cents: 0, paid_cents: 0 });
    expect(m2).toMatchObject({ opening_cents: -12000, balance_cents: -12000 });
    expect(m3).toMatchObject({ opening_cents: 70000, balance_cents: 70000 });
    expect((await env.db.adminPool.query("SELECT cutoff_date::text AS d FROM opening_balances WHERE patient_id = $1", [p3])).rows[0].d).toBe(cutoffDate);
    // Ni cargos (producción) ni pagos (caja)
    const after = await env.db.adminPool.query("SELECT (SELECT count(*) FROM charges WHERE clinic_id = $1)::int AS ch, (SELECT count(*) FROM payments WHERE clinic_id = $1)::int AS py", [A.clinicId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    // La cuenta del paciente, la ficha y las cuentas por cobrar usan el mismo saldo
    const acc = (await owner.get(`/api/patients/${p1}/account`)).body;
    expect(acc).toMatchObject({ balanceCents: 135050, openingCents: 135050, chargedCents: 0 });
    expect((await owner.get(`/api/patients/${p1}`)).body.account.balance).toBe(135050);
    const rx = (await owner.get("/api/reports/receivables")).body;
    expect(Number(rx.find((x: any) => x.patientId === p1).balanceCents)).toBe(135050);
    expect(rx.find((x: any) => x.patientId === p2)).toBeUndefined();
    // Historial del paciente
    const tl = (await owner.get(`/api/patients/${p1}/timeline`)).body;
    expect(JSON.stringify(tl)).toMatch(/Saldo inicial del sistema anterior: deuda/);

    // Reimportar el mismo archivo: no duplica
    const again = (await owner.post("/api/imports/balances", { fileBase64: file, mapping, dryRun: true, cutoffDate })).body;
    expect(again.summary.create).toBe(0);
    // Otro archivo con el mismo paciente: un solo saldo inicial vigente
    const other = (await owner.post("/api/imports/balances", { fileBase64: await xlsx([["CI", "Saldo"], ["8880001", "99"]]), dryRun: true, cutoffDate })).body;
    expect(other.results[0]).toMatchObject({ status: "duplicate" });
    expect(other.results[0].message).toMatch(/ya tiene un saldo inicial/);

    // Un pago a cuenta lo salda
    const pay = await owner.post("/api/payments", { branchId: A.branches[0], patientId: p1, amountCents: 135050, method: "cash", idempotencyKey: `ob-${p1}` });
    expect(pay.status).toBe(200);
    expect((await money(p1)).balance_cents).toBe(0);
  });

  it("es de solo inserción: se corrige con una anulación con motivo", async () => {
    const ob = (await owner.get(`/api/patients/${p2}/opening-balances`)).body;
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({ amountCents: -12000, voided: false });
    const app = await env.db.appPool.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.clinic_id', $1, true)", [A.clinicId]);
      await expect(app.query("UPDATE opening_balances SET amount_cents = 1 WHERE id = $1", [ob[0].id])).rejects.toThrow();
      await app.query("ROLLBACK");
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.clinic_id', $1, true)", [A.clinicId]);
      await expect(app.query("DELETE FROM opening_balances WHERE id = $1", [ob[0].id])).rejects.toThrow();
      await app.query("ROLLBACK");
    } finally { app.release(); }
    // El dueño de la base tampoco puede modificarlo (trigger)
    await expect(env.db.adminPool.query("UPDATE opening_balances SET amount_cents = 1 WHERE id = $1", [ob[0].id])).rejects.toThrow(/solo inserción/);
    // Un segundo saldo vigente para el mismo paciente lo impide la base
    await expect(env.db.adminPool.query(
      "INSERT INTO opening_balances (clinic_id, patient_id, amount_cents, cutoff_date, created_by) VALUES ($1,$2,500,'2026-01-01',$3)", [A.clinicId, p2, A.ownerId])).rejects.toThrow(/ya tiene un saldo inicial vigente/);

    expect((await reception.post(`/api/opening-balances/${ob[0].id}/void`, { reason: "Error de carga" })).status).toBe(403);
    expect((await owner.post(`/api/opening-balances/${ob[0].id}/void`, { reason: "x" })).status).toBe(400);
    expect((await owner.post(`/api/opening-balances/${ob[0].id}/void`, { reason: "Era de otro paciente" })).status).toBe(200);
    expect((await owner.post(`/api/opening-balances/${ob[0].id}/void`, { reason: "Otra vez" })).status).toBe(409);
    expect((await money(p2))).toMatchObject({ opening_cents: 0, balance_cents: 0 });
    const list = (await owner.get(`/api/patients/${p2}/opening-balances`)).body;
    expect(list.map((x: any) => [x.amountCents, x.voided, x.voidReason])).toEqual([[-12000, true, null], [12000, false, "Era de otro paciente"]]);
    // La anulación debe ser exactamente el opuesto
    await expect(env.db.adminPool.query(
      "INSERT INTO opening_balances (clinic_id, patient_id, amount_cents, cutoff_date, voids_id, void_reason, created_by) VALUES ($1,$2,70001,'2026-01-01',(SELECT id FROM opening_balances WHERE patient_id = $2 AND voids_id IS NULL),'mal',$3)",
      [A.clinicId, p3, A.ownerId])).rejects.toThrow(/monto opuesto/);
  });
});

describe("aislamiento entre clínicas", () => {
  it("B no ve lotes, reportes, saldos ni pacientes de A, ni puede importar contra ellos", async () => {
    const batchesA = (await owner.get("/api/imports/batches")).body;
    expect(batchesA.length).toBeGreaterThan(0);
    expect((await ownerB.get("/api/imports/batches")).body).toEqual([]);
    const rep = await env.app.inject({ method: "GET", url: `/api/imports/batches/${batchesA[0].id}/report.xlsx`, headers: { cookie: ownerB.cookie } });
    expect(rep.statusCode).toBe(404);
    const obA = (await env.db.adminPool.query("SELECT id, patient_id FROM opening_balances WHERE clinic_id = $1 AND voids_id IS NULL LIMIT 1", [A.clinicId])).rows[0];
    expect((await ownerB.get(`/api/patients/${obA.patient_id}/opening-balances`)).body).toEqual([]);
    expect((await ownerB.post(`/api/opening-balances/${obA.id}/void`, { reason: "Intento cruzado" })).status).toBe(404);
    // El CI de un paciente de A no existe para B
    const dry = (await ownerB.post("/api/imports/balances", { fileBase64: await xlsx([["CI", "Saldo"], ["8880003", "10"]]), dryRun: true, cutoffDate: "2026-01-01" })).body;
    expect(dry.results[0].message).toMatch(/No existe un paciente/);
    // Misma clave externa en otra clínica: no choca (UNIQUE por clínica)
    const fileB = await xlsx([["Nombres", "Apellidos", "N° de ficha anterior"], ["Lucía", "Flores", "OLD-1"]]);
    expect((await ownerB.post("/api/imports/patients", { fileBase64: fileB, dryRun: true })).body.summary.create).toBe(1);
    // SQL directo con el contexto de B: ninguna fila de A
    const app = await env.db.appPool.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.clinic_id', $1, true)", [B.clinicId]);
      for (const t of ["import_batches", "import_records", "opening_balances"]) {
        expect((await app.query(`SELECT count(*)::int AS n FROM ${t} WHERE clinic_id = $1`, [A.clinicId])).rows[0].n).toBe(0);
      }
      await expect(app.query(
        "INSERT INTO opening_balances (clinic_id, patient_id, amount_cents, cutoff_date, created_by) VALUES ($1,$2,100,'2026-01-01',$3)", [A.clinicId, obA.patient_id, B.ownerId])).rejects.toThrow();
      await app.query("ROLLBACK");
    } finally { app.release(); }
  });
});
