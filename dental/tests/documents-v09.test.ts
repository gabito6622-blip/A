// v0.9 · B-075 (aviso de interacciones al recetar; textos de certificados por clínica con versiones)
// y B-066 (orden de sondaje del periodontograma guardado por clínica).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupsOf, interactionWarnings } from "../server/src/lib/interactions.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";
import { pdfText } from "./pdf-text.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, dentist: Agent, dentist2: Agent, assistant: Agent;
let patient: string;
const line = (drug: string) => ({ drug, presentation: null, dose: "1 comprimido", frequency: "Cada 8 horas", duration: "3 días", instructions: null });

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db, { name: "Otra clínica" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  dentist = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] })).email);
  dentist2 = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
  assistant = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
  patient = await createPatient(owner, { firstName: "Ficticia", lastName: "Prueba Interacción" });
  const h = await dentist.post(`/api/patients/${patient}/medical-history`, { allergies: "Ninguna", medications: "Warfarina 5 mg/día, Enalapril 10 mg", anticoagulants: true });
  expect(h.status).toBe(200);
});
afterAll(async () => teardown(env));

describe("interacciones (unidad)", () => {
  it("reconoce principios activos sin tildes, en mayúsculas o a medias", () => {
    expect([...groupsOf("IBUPROFENO 400")]).toEqual(["nsaid"]);
    expect(groupsOf("toma acenocumarol (Sintrom)").has("anticoag")).toBe(true);
    expect(groupsOf("Losartán 50 mg").has("antihtn")).toBe(true);
    expect(groupsOf("Paracetamol").size).toBe(0);
    expect(groupsOf("").size).toBe(0);
  });
  it("avisa con la medicación actual, con la marca de anticoagulantes, dentro de la receta y en el embarazo", () => {
    const w = interactionWarnings({ medications: "Warfarina, Enalapril" }, [{ name: "Ibuprofeno" }, { name: "Amoxicilina" }]);
    expect(w.filter((x) => x.line === 1).map((x) => x.text).sort()).toEqual(["más riesgo de sangrado", "puede bajar el efecto del antihipertensivo y afectar el riñón"]);
    expect(w.some((x) => x.line === 2)).toBe(false); // amoxicilina: fuera de la lista corta, no inventa avisos
    expect(interactionWarnings({ anticoagulants: true }, [{ name: "Ketorolaco" }])[0]).toMatchObject({ with: "antecedentes: toma anticoagulantes", text: "más riesgo de sangrado" });
    const same = interactionWarnings({}, [{ name: "Ibuprofeno" }, { name: "Diclofenaco" }]);
    expect(same).toEqual([{ line: 2, drug: "Diclofenaco", with: "Ibuprofeno en esta receta", text: "dos antiinflamatorios juntos: más riesgo digestivo y renal" }]);
    expect(interactionWarnings({ medications: "Ibuprofeno 400" }, [{ name: "Ibuprofeno" }])[0]!.text).toBe("el paciente ya toma ibuprofeno");
    expect(interactionWarnings({ pregnant: true }, [{ name: "Doxiciclina" }])[0]!.text).toMatch(/embarazo/);
    expect(interactionWarnings({ medications: "Sertralina" }, [{ name: "Tramadol" }])[0]!.text).toMatch(/serotonin/);
    expect(interactionWarnings(null, [{ name: "Paracetamol" }])).toEqual([]);
  });
});

describe("interacciones al recetar (API)", () => {
  it("la comprobación en vivo avisa y la emisión NO se bloquea: queda anotado en la historia", async () => {
    const chk = await dentist.post(`/api/patients/${patient}/allergy-check`, { lines: [{ drug: "Ibuprofeno 400 mg" }, { drug: "Paracetamol" }] });
    expect(chk.status).toBe(200);
    expect(chk.body.currentMedications).toMatch(/Warfarina/);
    expect(chk.body.warnings).toEqual([]);
    expect(chk.body.interactions.map((x: any) => x.text).sort()).toEqual(["más riesgo de sangrado", "puede bajar el efecto del antihipertensivo y afectar el riñón"]);
    expect(chk.body.interactions.every((x: any) => x.line === 1)).toBe(true);

    const r = await dentist.post(`/api/patients/${patient}/prescriptions`, { branchId: K.branches[0], lines: [line("Ibuprofeno"), line("Paracetamol")] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.interactions.length).toBe(2);
    const note = (await env.db.adminPool.query("SELECT body FROM clinical_notes WHERE patient_id = $1 AND kind = 'prescription' ORDER BY created_at DESC LIMIT 1", [patient])).rows[0].body;
    expect(note).toMatch(/Aviso de interacción mostrado al emitir: Ibuprofeno con .*más riesgo de sangrado/);
    // Otra clínica no ve al paciente
    expect((await dentist2.post(`/api/patients/${patient}/allergy-check`, { lines: [{ drug: "Ibuprofeno" }] })).status).toBe(404);
  });
});

describe("textos de certificados por clínica (B-075)", () => {
  const cur = async (a: Agent, id = "rest") => (await a.get("/api/certificate-templates")).body.find((t: any) => t.id === id);

  it("solo gerencia edita; se validan los marcadores y los datos obligatorios", async () => {
    // Gerencia sin permiso clínico también ve la lista (para editarla); contabilidad no.
    expect((await owner.get("/api/certificate-templates")).status).toBe(200);
    const acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
    expect((await acct.get("/api/certificate-templates")).status).toBe(403);
    const base = await cur(dentist);
    expect(base).toMatchObject({ version: 0, customized: false });
    expect(base.placeholders).toEqual(expect.arrayContaining(["paciente", "restDays", "restFrom", "restTo"]));
    const url = "/api/certificate-templates/rest/versions";
    const ok = "Se certifica que {paciente}, {documento}, atendido(a) el {attendedOn} por {reason}, debe guardar reposo de {restDays} día(s) desde el {restFrom} hasta el {restTo}.";
    expect((await dentist.post(url, { title: "Reposo", body: ok })).status).toBe(403);
    expect((await assistant.get(url)).status).toBe(403);
    const unknown = await owner.post(url, { title: "Reposo", body: `${ok} Firma: {firma}` });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/\{firma\}/);
    const noPatient = await owner.post(url, { title: "Reposo", body: "Se certifica reposo de {restDays} día(s) desde el {restFrom}, atendido el {attendedOn} por {reason}." });
    expect(noPatient.body.error.message).toMatch(/\{paciente\}/);
    const noDays = await owner.post(url, { title: "Reposo", body: "Se certifica que {paciente} fue atendido(a) el {attendedOn} por {reason} y debe guardar reposo." });
    expect(noDays.body.error.message).toMatch(/restDays/);
    expect((await owner.post(url, { title: CERT_BASE_TITLE, body: base.baseBody })).status).toBe(409); // sin cambios
    expect((await owner.post("/api/certificate-templates/otra/versions", { title: "x", body: ok })).status).toBe(400);
  });

  const CERT_BASE_TITLE = "Certificado de reposo";

  it("cada cambio es una versión; lo emitido conserva su texto y su versión; volver al original", async () => {
    const url = "/api/certificate-templates/rest/versions";
    const v1 = "Se certifica que {paciente}, {documento}, atendido(a) el {attendedOn} por {reason}, debe guardar reposo de {restDays} día(s) desde el {restFrom} hasta el {restTo}.";
    const r1 = await owner.post(url, { title: "Certificado médico de reposo", body: v1, note: "Redacción revisada" });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.version).toBe(1);
    const t = await cur(dentist);
    expect(t).toMatchObject({ version: 1, customized: true, title: "Certificado médico de reposo", body: v1, baseTitle: CERT_BASE_TITLE });
    // La otra clínica sigue con el texto base
    expect((await cur(dentist2))).toMatchObject({ version: 0, customized: false, title: CERT_BASE_TITLE });

    // Emitir con el texto nuevo: título nuevo en el PDF y versión en lo congelado
    const fields = { attendedOn: "2026-11-10", reason: "Exodoncia de la pieza 48", restDays: 2, restFrom: "2026-11-10" };
    const body = "Se certifica que Ficticia Prueba Interacción, sin documento, atendido(a) el 10/11/2026 por exodoncia, debe guardar reposo de 2 día(s) desde el 10/11/2026 hasta el 11/11/2026.";
    const doc = await dentist.post(`/api/patients/${patient}/certificates`, { branchId: K.branches[0], template: "rest", fields, body });
    expect(doc.status, JSON.stringify(doc.body)).toBe(200);
    const row = (await env.db.adminPool.query("SELECT title, snapshot FROM clinical_documents WHERE id = $1", [doc.body.id])).rows[0];
    expect(row.title).toBe("Certificado médico de reposo");
    expect(row.snapshot.templateVersion).toBe(1);
    const pdf = await env.app.inject({ method: "GET", url: `/api/clinical-documents/${doc.body.id}/pdf`, headers: { cookie: dentist.cookie } });
    expect(pdfText(pdf.rawPayload)).toContain("Certificado médico de reposo");

    // Volver al original: versión 2, marcada como texto base
    const r2 = await owner.post(url, { restoreDefault: true });
    expect(r2.body.version).toBe(2);
    expect(await cur(dentist)).toMatchObject({ version: 2, customized: false, title: CERT_BASE_TITLE });
    const hist = (await owner.get(url)).body;
    expect(hist.map((h: any) => [h.version, h.isDefault])).toEqual([[2, true], [1, false]]);
    expect(hist[1].note).toBe("Redacción revisada");
    // Lo emitido no cambió
    expect((await env.db.adminPool.query("SELECT title FROM clinical_documents WHERE id = $1", [doc.body.id])).rows[0].title).toBe("Certificado médico de reposo");

    // Solo inserción y auditoría
    await expect(env.db.adminPool.query("UPDATE certificate_template_versions SET body = 'x' WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow();
    await expect(env.db.adminPool.query("DELETE FROM certificate_template_versions WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow();
    const au = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1 AND action = 'certificate_template.versioned'", [K.clinicId])).rows[0].n;
    expect(au).toBe(2);
  });
});

describe("orden de sondaje por clínica (B-066)", () => {
  it("lo guarda gerencia en el servidor y lo lee cualquier miembro; cada clínica el suyo", async () => {
    expect((await dentist.get("/api/clinic")).body.perioOrder).toBe("standard");
    expect((await dentist.patch("/api/clinic", { perioOrder: "quadrant" })).status).toBe(403);
    expect((await owner.patch("/api/clinic", { perioOrder: "zigzag" })).status).toBe(400);
    expect((await owner.patch("/api/clinic", { perioOrder: "buccal_first" })).status).toBe(200);
    expect((await dentist.get("/api/clinic")).body.perioOrder).toBe("buccal_first");
    expect((await owner2.get("/api/clinic")).body.perioOrder).toBe("standard");
    // Cambiar otra cosa de la clínica no lo pisa
    expect((await owner.patch("/api/clinic", { name: "Clínica con orden propio" })).status).toBe(200);
    expect((await owner.get("/api/clinic")).body.perioOrder).toBe("buccal_first");
  });
});
