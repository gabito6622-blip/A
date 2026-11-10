import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { withTenant } from "../server/src/lib/db.js";
import { allergyTerms, matchAllergy } from "../server/src/lib/allergies.js";
import { amountInWords, normalizeVerifyCode } from "../server/src/lib/pdf.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";
import { pdfText } from "./pdf-text.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, dentist: Agent, assistant: Agent, rec: Agent, accountant: Agent, otherDentist: Agent;
let patient: string;
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function getPdf(a: Agent, url: string) {
  const r = await env.app.inject({ method: "GET", url, headers: { cookie: a.cookie } });
  return { status: r.statusCode, buf: r.rawPayload, headers: r.headers, json: () => r.json() };
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const AMOX = { drug: "Amoxicilina", presentation: "Cápsulas 500 mg", dose: "1 cápsula", frequency: "Cada 8 horas", duration: "7 días", instructions: "Vía oral" };
const PARA = { drug: "Paracetamol", presentation: "Comprimidos 500 mg", dose: "1 comprimido", frequency: "Cada 8 horas", duration: "3 días", instructions: null };

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { name: "Clínica Peñaranda Ñuñoa" });
  K2 = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  const d = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  await env.db.adminPool.query("UPDATE memberships SET professional_license = 'MP-4321' WHERE user_id = $1", [d.id]);
  dentist = await login(env.app, d.email);
  assistant = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  accountant = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  otherDentist = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
  patient = await createPatient(owner, { firstName: "Begoña", lastName: "Íñiguez Peña", documentNumber: "7654321" });
  expect((await dentist.post(`/api/patients/${patient}/medical-history`, { allergies: "Penicilina, AINEs" })).status).toBe(200);
});
afterAll(async () => teardown(env));

async function medId(name: string, presentation: string) {
  const list = (await dentist.get("/api/medications")).body as any[];
  return list.find((m) => m.genericName === name && m.presentation === presentation)!.id as string;
}

describe("alergias (unidad)", () => {
  it("detecta grupos, plurales y respuestas negativas", () => {
    expect(matchAllergy("Penicilina", { name: "Amoxicilina", tags: ["amoxicilina", "penicilina", "betalactamico"] })).toBe("Penicilina");
    expect(matchAllergy("AINEs; látex", { name: "Ibuprofeno", tags: ["ibuprofeno", "aine"] })).toBe("AINEs");
    expect(matchAllergy("ácido acetilsalicílico", { name: "Amoxicilina + ácido clavulánico", tags: ["penicilina"] })).toBeNull();
    expect(matchAllergy("Niega alergias", { name: "Amoxicilina", tags: ["penicilina"] })).toBeNull();
    expect(allergyTerms("Ninguna")).toEqual([]);
    expect(matchAllergy("betalactámicos", { name: "Cefalexina", tags: ["cefalosporina", "betalactamico"] })).toBe("betalactámicos");
  });
  it("monto en palabras y códigos", () => {
    expect(amountInWords(15000)).toBe("Ciento cincuenta 00/100 bolivianos");
    expect(amountInWords(2125050)).toBe("Veintiún mil doscientos cincuenta 50/100 bolivianos");
    expect(normalizeVerifyCode("abcd-efgh-jkmo")).toBe("ABCDEFGHJKM0");
    expect(normalizeVerifyCode("x")).toBeNull();
  });
});

describe("catálogo de medicamentos", () => {
  it("cada clínica nace con el catálogo inicial y se edita con clinic.manage", async () => {
    const list = (await dentist.get("/api/medications")).body as any[];
    expect(list.length).toBeGreaterThanOrEqual(30);
    expect(list.some((m) => m.genericName === "Clorhexidina")).toBe(true);
    expect((await rec.get("/api/medications")).status).toBe(403);
    expect((await owner.get("/api/medications")).status).toBe(200);
    const body = { genericName: "Ácido tranexámico", presentation: "Comprimidos 500 mg", defaultDose: "1 comprimido", defaultFrequency: "Cada 8 horas", defaultDuration: "3 días", allergyTags: ["tranexamico"] };
    expect((await dentist.post("/api/medications", body)).status).toBe(403);
    const r = await owner.post("/api/medications", body);
    expect(r.status).toBe(200);
    expect((await owner.post("/api/medications", { ...body, genericName: "ÁCIDO TRANEXÁMICO" })).status).toBe(409);
    expect((await owner.put(`/api/medications/${r.body.id}`, { ...body, active: false })).status).toBe(200);
    expect(((await dentist.get("/api/medications")).body as any[]).some((m) => m.id === r.body.id)).toBe(false);
    expect(((await owner.get("/api/medications?all=1")).body as any[]).some((m) => m.id === r.body.id)).toBe(true);
    expect((await owner.post("/api/medications/seed")).body.added).toBe(0);
    // otra clínica no lo ve
    expect(((await otherDentist.get("/api/medications?all=1")).body as any[]).some((m) => m.id === r.body.id)).toBe(false);
  });
});

let rxId: string, rxCode: string;
describe("recetas", () => {
  it("avisa la alergia sin bloquear: exige marcar «Revisé la alergia»", async () => {
    const amox = await medId("Amoxicilina", "Cápsulas 500 mg");
    const chk = await dentist.post(`/api/patients/${patient}/allergy-check`, { lines: [{ medicationId: amox, drug: "Amoxicilina" }, { drug: "Paracetamol" }] });
    expect(chk.body.warnings).toEqual([{ line: 1, drug: "Amoxicilina", allergy: "Penicilina" }]);
    const body = { branchId: K.branches[0], lines: [{ ...AMOX, medicationId: amox }, PARA], indications: "Dieta blanda. Volver si hay fiebre." };
    const r1 = await dentist.post(`/api/patients/${patient}/prescriptions`, body);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe("allergy_ack_required");
    expect(r1.body.error.details.warnings[0].allergy).toBe("Penicilina");
    const r2 = await dentist.post(`/api/patients/${patient}/prescriptions`, { ...body, acknowledgeAllergy: true });
    expect(r2.status).toBe(200);
    expect(r2.body.number).toMatch(/^R-\d{6}$/);
    expect(r2.body.verifyCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    rxId = r2.body.id; rxCode = r2.body.verifyCode;
    const row = (await env.db.adminPool.query("SELECT allergy_acknowledged, allergy_warnings, note_id, issuer_license FROM clinical_documents WHERE id = $1", [rxId])).rows[0];
    expect(row).toMatchObject({ allergy_acknowledged: true, issuer_license: "MP-4321" });
    expect(row.allergy_warnings).toHaveLength(1);
    // queda en la historia clínica como nota
    const notes = (await dentist.get(`/api/patients/${patient}/notes`)).body as any[];
    expect(notes.some((n) => n.kind === "prescription" && n.body.includes("Amoxicilina"))).toBe(true);
    // sin alergia no hace falta marcar nada
    expect((await dentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [PARA] })).status).toBe(200);
  });

  it("valida líneas y sucursal", async () => {
    expect((await dentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [] })).status).toBe(400);
    expect((await dentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [{ ...PARA, dose: "" }] })).status).toBe(400);
    expect((await dentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[1], lines: [PARA] })).status).toBe(403);
  });

  it("el PDF es válido, lleva membrete, matrícula, huella, código y texto con tildes; se sirve siempre igual y cada descarga se audita", async () => {
    const a = await getPdf(dentist, `/api/clinical-documents/${rxId}/pdf`);
    expect(a.status).toBe(200);
    expect(a.headers["content-type"]).toBe("application/pdf");
    expect(a.buf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(a.buf);
    expect(text.length).toBeGreaterThan(0);
    for (const s of ["Clínica Peñaranda Ñuñoa", "RECETA MÉDICA", "Begoña Íñiguez Peña", "Amoxicilina — Cápsulas 500 mg", "Alergias declaradas por el paciente: Penicilina, AINEs",
      "Matrícula: MP-4321", rxCode, "Página 1 de 1", "Dieta blanda. Volver si hay fiebre."]) expect(text).toContain(s);
    const b = await getPdf(dentist, `/api/clinical-documents/${rxId}/pdf`);
    expect(sha(b.buf)).toBe(sha(a.buf));
    const stored = (await env.db.adminPool.query("SELECT pdf_sha256, content_hash FROM pdf_documents WHERE source_id = $1 AND variant = 'original'", [rxId])).rows[0];
    expect(stored.pdf_sha256).toBe(sha(a.buf));
    expect(text).toContain(stored.content_hash.slice(0, 4).toUpperCase());
    const aud = await env.db.adminPool.query("SELECT 1 FROM audit_log WHERE clinic_id = $1 AND action = 'pdf.downloaded' AND entity_id = $2", [K.clinicId, rxId]);
    expect(aud.rowCount).toBe(2);
  });

  it("lo emitido es inmutable, incluso para el dueño de la base", async () => {
    await expect(env.db.adminPool.query("UPDATE clinical_documents SET title = 'X' WHERE id = $1", [rxId])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM clinical_documents WHERE id = $1", [rxId])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("UPDATE pdf_documents SET pdf = '\\x00' WHERE source_id = $1", [rxId])).rejects.toThrow(/solo inserción/);
    // la app tampoco tiene privilegio de UPDATE
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("UPDATE clinical_documents SET title = 'X' WHERE id = $1", [rxId]))).rejects.toThrow();
    // y no hay ruta de edición
    expect((await dentist.put(`/api/clinical-documents/${rxId}`, { title: "X" })).status).toBe(404);
  });

  it("corregir = anular con motivo y reemitir; el PDF pasa a la copia ANULADA", async () => {
    const reissue = { branchId: K.branches[0], lines: [PARA], reissueOfId: rxId };
    expect((await dentist.post(`/api/patients/${patient}/prescriptions`, reissue)).body.error.code).toBe("not_voided");
    expect((await assistant.post(`/api/clinical-documents/${rxId}/void`, { reason: "Dosis incorrecta" })).status).toBe(403);
    expect((await dentist.post(`/api/clinical-documents/${rxId}/void`, { reason: "" })).status).toBe(400);
    expect((await dentist.post(`/api/clinical-documents/${rxId}/void`, { reason: "Dosis incorrecta" })).status).toBe(200);
    expect((await dentist.post(`/api/clinical-documents/${rxId}/void`, { reason: "Otra vez" })).status).toBe(409);
    const v = await getPdf(dentist, `/api/clinical-documents/${rxId}/pdf`);
    const t = pdfText(v.buf);
    expect(t).toContain("ANULADA");
    expect(t).toContain("Motivo: Dosis incorrecta");
    const r = await dentist.post(`/api/patients/${patient}/prescriptions`, reissue);
    expect(r.status).toBe(200);
    expect(pdfText((await getPdf(dentist, `/api/clinical-documents/${r.body.id}/pdf`)).buf)).toContain("Reemplaza a la receta");
    expect((await dentist.post(`/api/patients/${patient}/prescriptions`, reissue)).body.error.code).toBe("already_reissued");
    const list = (await assistant.get(`/api/patients/${patient}/clinical-documents`)).body as any[];
    const orig = list.find((d) => d.id === rxId);
    expect(orig).toMatchObject({ status: "voided", voidReason: "Dosis incorrecta", reissuedById: r.body.id });
    // la anulación es de solo inserción
    await expect(env.db.adminPool.query("DELETE FROM clinical_document_voids WHERE document_id = $1", [rxId])).rejects.toThrow(/solo inserción/);
  });
});

describe("certificados y derivaciones", () => {
  it("emite desde plantilla con marcadores completos y valida los campos", async () => {
    const tpls = (await dentist.get("/api/certificate-templates")).body as any[];
    expect(tpls.map((t) => t.id).sort()).toEqual(["attendance", "referral", "rest", "treatment"]);
    const base = { branchId: K.branches[0], template: "rest", fields: { attendedOn: "2026-11-10", reason: "Extracción de la pieza 38", restDays: 2, restFrom: "2026-11-10" } };
    const text = "Certifico que Begoña Íñiguez Peña fue atendida el 10/11/2026 y requiere reposo de 2 días, desde el 10/11/2026 hasta el 11/11/2026.";
    expect((await dentist.post(`/api/patients/${patient}/certificates`, { ...base, fields: { ...base.fields, restDays: null }, body: text })).status).toBe(400);
    expect((await dentist.post(`/api/patients/${patient}/certificates`, { ...base, body: "Certifico que {paciente} requiere reposo de 2 días." })).body.error.message).toMatch(/\{paciente\}/);
    const r = await dentist.post(`/api/patients/${patient}/certificates`, { ...base, body: text });
    expect(r.status).toBe(200);
    expect(r.body.number).toMatch(/^C-/);
    const pdf = pdfText((await getPdf(assistant, `/api/clinical-documents/${r.body.id}/pdf`)).buf);
    expect(pdf).toContain("Certificado de reposo");
    expect(pdf).toContain("Íñiguez");
    const snap = (await env.db.adminPool.query("SELECT snapshot FROM clinical_documents WHERE id = $1", [r.body.id])).rows[0].snapshot;
    expect(snap.fields.restTo).toBe("2026-11-11");
    const ref = await dentist.post(`/api/patients/${patient}/certificates`, {
      branchId: K.branches[0], template: "referral", fields: { specialty: "Cirugía bucomaxilofacial", reason: "Tercer molar incluido", summary: "Rx panorámica adjunta." },
      body: "Derivo a la paciente para valoración por Cirugía bucomaxilofacial. Motivo: tercer molar incluido.",
    });
    expect(ref.body.number).toMatch(/^D-/);
  });
});

describe("verificación pública", () => {
  it("dice si existe y está íntegro, con tipo, fecha y clínica, sin datos del paciente", async () => {
    const r = await env.app.inject({ method: "GET", url: `/api/public/verify/${rxCode.toLowerCase()}` });
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v).toMatchObject({ found: true, intact: true, status: "voided", kind: "prescription", clinicName: "Clínica Peñaranda Ñuñoa" });
    const raw = r.body;
    for (const leak of ["Begoña", "Íñiguez", "7654321", "Amoxicilina", "Penicilina", patient]) expect(raw).not.toContain(leak);
    expect(Object.keys(v).sort()).toEqual(["clinicName", "code", "fingerprint", "found", "intact", "issuedAt", "kind", "kindLabel", "pdfSha256", "status", "statusLabel"]);
    expect((await env.app.inject({ method: "GET", url: "/api/public/verify/ZZZZ-ZZZZ-ZZZZ" })).statusCode).toBe(404);
    expect((await env.app.inject({ method: "GET", url: "/api/public/verify/no-valido" })).statusCode).toBe(404);
  });

  it("detecta un PDF alterado en la base", async () => {
    const r = await dentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [PARA] });
    const ok = await env.app.inject({ method: "GET", url: `/api/public/verify/${r.body.verifyCode}` });
    expect(ok.json()).toMatchObject({ intact: true, status: "valid" });
    const c = await env.db.adminPool.connect();
    try {
      await c.query("ALTER TABLE pdf_documents DISABLE TRIGGER pdf_documents_immutable");
      await c.query("UPDATE pdf_documents SET pdf = pdf || '\\x20'::bytea WHERE source_id = $1", [r.body.id]);
      await c.query("ALTER TABLE pdf_documents ENABLE TRIGGER pdf_documents_immutable");
    } finally { c.release(); }
    const bad = await env.app.inject({ method: "GET", url: `/api/public/verify/${r.body.verifyCode}` });
    expect(bad.json()).toMatchObject({ found: true, intact: false });
  });
});

describe("PDF de documentos existentes", () => {
  it("presupuesto aceptado: líneas, totales, cuotas, aceptación en línea y firma", async () => {
    const b = await dentist.post("/api/budgets", {
      branchId: K.branches[0], patientId: patient, dentistId: (await env.db.adminPool.query("SELECT user_id FROM memberships WHERE clinic_id = $1 AND role = 'dentist'", [K.clinicId])).rows[0].user_id,
      installments: 3, items: [{ procedureId: await procedureId(env.db, K.clinicId, "PRE-01") }, { procedureId: await procedureId(env.db, K.clinicId, "OPE-01"), tooth: 16, surfaces: ["O"] }],
    });
    expect(b.status).toBe(200);
    expect((await dentist.get(`/api/budgets/${b.body.id}/pdf`)).status).toBe(409); // borrador
    expect((await dentist.post(`/api/budgets/${b.body.id}/status`, { status: "presented" })).status).toBe(200);
    expect((await dentist.post(`/api/budgets/${b.body.id}/status`, { status: "accepted", note: "Firmó en recepción" })).status).toBe(200);
    await env.db.adminPool.query(
      `INSERT INTO budget_events (clinic_id, budget_id, kind, channel, signer_name, signer_relationship, signature_png, content_hash) VALUES ($1,$2,'accepted','link','Begoña Íñiguez Peña','patient',$3,$4)`,
      [K.clinicId, b.body.id, SIG, "a".repeat(64)]);
    const r = await getPdf(accountant, `/api/budgets/${b.body.id}/pdf`);
    expect(r.status).toBe(200);
    const t = pdfText(r.buf);
    for (const s of ["PRESUPUESTO", "Profilaxis (limpieza dental)", "Bs 450,00", "Cuota 3 de 3", "Aceptado en línea", "Begoña Íñiguez Peña"]) expect(t).toContain(s);
    expect((await getPdf(rec, `/api/budgets/${b.body.id}/pdf`)).status).toBe(200);
    // la otra clínica no lo encuentra
    expect((await getPdf(otherDentist, `/api/budgets/${b.body.id}/pdf`)).status).toBe(404);
  });

  it("consentimiento firmado: texto, firma y huella del documento", async () => {
    const t = ((await dentist.get("/api/consent-templates")).body as any[]).find((x) => x.kind === "informed_consent");
    const s = await dentist.post(`/api/patients/${patient}/documents`, { templateId: t.id, branchId: K.branches[0], decision: "granted", method: "signature_pad", signerName: "Begoña Íñiguez Peña", signaturePng: SIG, procedure: "Extracción pieza 38" });
    expect(s.status).toBe(200);
    const r = await getPdf(dentist, `/api/consent-documents/${s.body.id}/pdf`);
    expect(r.status).toBe(200);
    const text = pdfText(r.buf);
    expect(text).toContain(t.title);
    expect(text.replace(/\s+/g, " ")).toContain("Extracción pieza 38");
    expect(text.replace(/\s/g, "")).toContain(s.body.contentHash);
    // mismo criterio que la vista del consentimiento: limpieza y apoyo no ve pacientes
    const support = await login(env.app, (await addUser(env.db, K.clinicId, "support", { branchIds: [K.branches[0]!] })).email);
    expect((await getPdf(support, `/api/consent-documents/${s.body.id}/pdf`)).status).toBe(403);
  });

  it("recibo: solo pagos confirmados, con la leyenda «no es una factura fiscal»; anulado sale marcado", async () => {
    const pay = await owner.post("/api/payments", { branchId: K.branches[0], patientId: patient, amountCents: 15000, method: "cash", idempotencyKey: `t-${Date.now()}` });
    expect(pay.status).toBe(200);
    const r = await getPdf(rec, `/api/payments/${pay.body.id}/receipt.pdf`);
    expect(r.status).toBe(200);
    const t = pdfText(r.buf);
    for (const s of ["RECIBO DE PAGO", "Este recibo no es una factura fiscal.", "Bs 150,00", "Ciento cincuenta 00/100 bolivianos", "Begoña Íñiguez Peña"]) expect(t).toContain(s);
    const pend = await owner.post("/api/payments", { branchId: K.branches[0], patientId: patient, amountCents: 5000, method: "transfer", bankReference: `OP-${Date.now()}`, idempotencyKey: `t2-${Date.now()}` });
    expect((await getPdf(rec, `/api/payments/${pend.body.id}/receipt.pdf`)).status).toBe(409);
    expect((await owner.post(`/api/payments/${pay.body.id}/void`, { reason: "Error de registro" })).status).toBe(200);
    const v = await getPdf(accountant, `/api/payments/${pay.body.id}/receipt.pdf`);
    expect(pdfText(v.buf)).toContain("ANULADO");
    const code = v.headers["x-verify-code"] as string;
    expect((await env.app.inject({ method: "GET", url: `/api/public/verify/${code}` })).json()).toMatchObject({ status: "voided", kind: "receipt" });
    expect((await getPdf(dentist, `/api/payments/${pay.body.id}/receipt.pdf`)).status).toBe(403);
  });
});

describe("permisos y aislamiento entre clínicas", () => {
  it("permisos por rol", async () => {
    expect((await rec.get(`/api/patients/${patient}/clinical-documents`)).status).toBe(403);
    expect((await getPdf(rec, `/api/clinical-documents/${rxId}/pdf`)).status).toBe(403);
    expect((await accountant.get(`/api/patients/${patient}/prescription-context`)).status).toBe(403);
    expect((await assistant.get(`/api/patients/${patient}/clinical-documents`)).status).toBe(200);
    expect((await getPdf(assistant, `/api/clinical-documents/${rxId}/pdf`)).status).toBe(200);
    expect((await assistant.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [PARA] })).status).toBe(403);
    expect((await owner.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [PARA] })).status).toBe(403); // no es profesional
    const ctx = (await dentist.get(`/api/patients/${patient}/prescription-context`)).body;
    expect(ctx).toMatchObject({ allergies: "Penicilina, AINEs", issuer: { license: "MP-4321" }, canIssue: true });
  });

  it("otra clínica no lee, no descarga ni anula; RLS en las tablas nuevas", async () => {
    expect((await getPdf(otherDentist, `/api/clinical-documents/${rxId}/pdf`)).status).toBe(404);
    expect((await otherDentist.get(`/api/clinical-documents/${rxId}`)).status).toBe(404);
    expect((await otherDentist.post(`/api/clinical-documents/${rxId}/void`, { reason: "intento ajeno" })).status).toBe(404);
    expect((await otherDentist.get(`/api/patients/${patient}/clinical-documents`)).body).toEqual([]);
    expect((await otherDentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K2.branches[0], lines: [PARA] })).status).toBeGreaterThanOrEqual(400);
    await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) => {
      for (const t of ["clinical_documents", "clinical_document_voids", "pdf_documents"]) {
        expect((await c.query(`SELECT 1 FROM ${t} WHERE clinic_id = $1`, [K.clinicId])).rowCount).toBe(0);
      }
      expect((await c.query("SELECT 1 FROM medications WHERE clinic_id = $1", [K.clinicId])).rowCount).toBe(0);
      expect((await c.query("SELECT count(*)::int AS n FROM medications")).rows[0].n).toBeGreaterThan(0);
    });
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO medications (clinic_id, generic_name, presentation) VALUES ($1, 'Intruso', 'Comprimidos')", [K.clinicId]))).rejects.toThrow(/row-level security/);
    // sembrar el catálogo de otra clínica desde la app tampoco es posible
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query("SELECT seed_medications($1)", [K.clinicId]))).rejects.toThrow();
  });
});
