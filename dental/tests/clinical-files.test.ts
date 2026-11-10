// Archivos clínicos e imágenes (B-012): firma de bytes, límite de tamaño, permisos por rol,
// aislamiento entre clínicas (API, SQL/RLS y enlaces firmados), enlaces vencidos, auditoría de
// cada descarga, anti-duplicado por hash, inmutabilidad y línea de tiempo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTenant } from "../server/src/lib/db.js";
import { loadConfig } from "../server/src/config.js";
import { encodePng, syntheticPeriapical } from "../server/src/lib/png.js";
import { sniffType } from "../server/src/lib/filestore.js";
import { contentUrl, signFileToken, verifyFileToken } from "../server/src/modules/clinicalFiles-core.js";
import { addUser, createClinic, createPatient, login, PASSWORD, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

const FILES_DIR = mkdtempSync(join(tmpdir(), "dental-files-test-"));
process.env.DENTAL_FILES_DIR = FILES_DIR;
process.env.DENTAL_FILES_MAX_MB = "1";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, dentist: Agent, assistant: Agent, rec: Agent, accountant: Agent, support: Agent, otherDentist: Agent;
let dentistId: string;
let patient: string, patient2: string, otherPatient: string;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let n = 0;
/** PNG distinto en cada llamada (evita el anti-duplicado salvo cuando se busca). */
const png = () => { const k = ++n; return encodePng(24, 16, (x, y) => [(x * 10 + k) % 256, (y * 13 + k * 7) % 256, (k * 31) % 256]); };
const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0" + "x".repeat(40 + ++n)), Buffer.from([0xff, 0xd9])]);
const WEBP = () => { const body = Buffer.concat([Buffer.from("WEBPVP8 "), Buffer.alloc(30 + ++n, 1)]); const h = Buffer.alloc(8); h.write("RIFF", 0, "latin1"); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };
const PDF = () => Buffer.from(`%PDF-1.4\n% documento de prueba ${++n}\n%%EOF\n`);
const DICOM = () => Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), Buffer.alloc(64 + ++n, 2)]);

async function upload(a: Agent | null, pid: string, buf: Buffer, meta: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const m = { branchId: K.branches[0], kind: "xray_periapical", takenOn: today(), teeth: [36], description: "Control", fileName: "rx.png", ...meta };
  const r = await env.app.inject({
    method: "POST", url: `/api/patients/${pid}/clinical-files`,
    headers: { ...(a ? { cookie: a.cookie, "x-csrf-token": a.csrf } : {}), "content-type": "application/octet-stream", "x-file-meta": encodeURIComponent(JSON.stringify(m)), ...headers },
    payload: buf,
  });
  let body: any = null;
  try { body = r.json(); } catch { body = r.body; }
  return { status: r.statusCode, body };
}
async function fetchRaw(a: Agent, url: string) {
  const r = await env.app.inject({ method: "GET", url, headers: { cookie: a.cookie } });
  return { status: r.statusCode, buf: r.rawPayload, headers: r.headers, json: () => r.json() };
}
const list = async (a: Agent, pid = patient, q = "") => (await a.get(`/api/patients/${pid}/clinical-files${q}`));
const storedFiles = () => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : out.push(p); } };
  walk(FILES_DIR);
  return out;
};
const auditCount = async (action: string, fileId: string) =>
  (await env.db.adminPool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = $1 AND entity_id = $2", [action, fileId])).rows[0]!.n;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  const d = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  dentistId = d.id;
  dentist = await login(env.app, d.email);
  assistant = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  accountant = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  support = await login(env.app, (await addUser(env.db, K.clinicId, "support", { branchIds: [K.branches[0]!] })).email);
  otherDentist = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
  patient = await createPatient(owner, { firstName: "Imagen" });
  patient2 = await createPatient(owner, { firstName: "Segunda" });
  otherPatient = await createPatient(await login(env.app, K2.ownerEmail), { firstName: "Ajena" });
});
afterAll(async () => {
  await teardown(env);
  rmSync(FILES_DIR, { recursive: true, force: true });
});

describe("firma de bytes (unidad)", () => {
  it("reconoce JPEG, PNG, WebP, PDF y DICOM y nada más", () => {
    expect(sniffType(JPEG())).toBe("image/jpeg");
    expect(sniffType(png())).toBe("image/png");
    expect(sniffType(WEBP())).toBe("image/webp");
    expect(sniffType(PDF())).toBe("application/pdf");
    expect(sniffType(DICOM())).toBe("application/dicom");
    expect(sniffType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffType(Buffer.from("GIF89a......"))).toBeNull();
    expect(sniffType(Buffer.from("MZ\x90\x00 programa"))).toBeNull();
  });
  it("token: firma, vencimiento y manipulación", () => {
    const key = loadConfig().secretKey;
    const s = signFileToken(key, { f: "a", c: "b", u: "c", p: "view" });
    expect(verifyFileToken(key, s.token).ok).toBe(true);
    expect(verifyFileToken(key, s.token, Date.now() + 301_000)).toEqual({ ok: false, reason: "expired" });
    const [p, mac] = s.token.split(".");
    const forged = Buffer.from(JSON.stringify({ f: "a", c: "OTRA", u: "c", p: "view", e: 9e9 })).toString("base64url");
    expect(verifyFileToken(key, `${forged}.${mac}`)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyFileToken(Buffer.alloc(32, 9), s.token)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyFileToken(key, `${p}`)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("subida y visualización", () => {
  let fileId: string;
  const img = syntheticPeriapical(3, false);

  it("el odontólogo sube una radiografía; el tipo sale de la firma y se guarda su SHA-256", async () => {
    const before = storedFiles().length;
    const r = await upload(dentist, patient, img, { fileName: "C:\\fotos\\radiografía 36.JPG", description: "Pieza 36 antes" });
    expect(r.status).toBe(200);
    expect(r.body.mimeType).toBe("image/png"); // la extensión .JPG del nombre no cuenta
    expect(r.body.sha256).toBe(sha(img));
    fileId = r.body.id;
    const files = storedFiles();
    expect(files.length).toBe(before + 1);
    // la ruta interna es aleatoria: nunca contiene el nombre que mandó el usuario
    const stored = files.find((f) => !files.slice(0, before).includes(f))!;
    expect(stored).toMatch(new RegExp(`${K.clinicId}/\\d{4}/[0-9a-f]{32}$`));
    expect(stored).not.toMatch(/radiograf|JPG/i);
    const row = (await env.db.adminPool.query("SELECT original_name, teeth, uploaded_by, branch_id FROM clinical_files WHERE id = $1", [fileId])).rows[0];
    expect(row).toEqual({ original_name: "radiografía 36.JPG", teeth: [36], uploaded_by: dentistId, branch_id: K.branches[0] });
    expect(await auditCount("clinical_file.uploaded", fileId)).toBe(1);
  });

  it("listado con enlace de vista; la entrega es la misma imagen, con cabeceras seguras y auditada", async () => {
    const l = await list(dentist);
    expect(l.status).toBe(200);
    const it0 = l.body.items.find((i: any) => i.id === fileId);
    expect(it0).toMatchObject({ kind: "xray_periapical", kindLabel: "Radiografía periapical", teeth: [36], isImage: true, archived: null, canArchive: true, uploadedBy: expect.any(String) });
    expect(it0.viewUrl).toMatch(/^\/api\/clinical-files\/[0-9a-f-]+\/content\?t=/);
    expect(Date.parse(it0.linkExpiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    expect(l.body.maxLabel).toBe("1 MB");
    const r = await fetchRaw(dentist, it0.viewUrl);
    expect(r.status).toBe(200);
    expect(sha(r.buf)).toBe(sha(img));
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(r.headers["content-disposition"])).toMatch(/^inline; filename="radiografia-periapical-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.png"$/);
    expect(String(r.headers["content-security-policy"])).toContain("sandbox");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(await auditCount("clinical_file.viewed", fileId)).toBe(1);
    // cada entrega se audita (también la segunda)
    await fetchRaw(dentist, it0.viewUrl);
    expect(await auditCount("clinical_file.viewed", fileId)).toBe(2);
    // descarga: adjunto y auditada como descarga
    const link = await dentist.get(`/api/clinical-files/${fileId}/link?purpose=download`);
    const d = await fetchRaw(dentist, link.body.url);
    expect(d.status).toBe(200);
    expect(String(d.headers["content-disposition"])).toMatch(/^attachment; /);
    expect(await auditCount("clinical_file.downloaded", fileId)).toBe(1);
  });

  it("acepta JPEG, WebP, PDF (documento) y DICOM (radiografía, solo descarga)", async () => {
    expect((await upload(dentist, patient, JPEG(), { kind: "photo_intraoral", fileName: "foto.png" })).body.mimeType).toBe("image/jpeg");
    expect((await upload(dentist, patient, WEBP(), { kind: "photo_extraoral" })).body.mimeType).toBe("image/webp");
    expect((await upload(dentist, patient, PDF(), { kind: "scanned_document", teeth: [] })).body.mimeType).toBe("application/pdf");
    const dcm = await upload(dentist, patient, DICOM(), { kind: "xray_panoramic", teeth: [] });
    expect(dcm.body.mimeType).toBe("application/dicom");
    const item = (await list(dentist)).body.items.find((i: any) => i.id === dcm.body.id);
    expect(item.viewUrl).toBeNull();
    expect((await dentist.get(`/api/clinical-files/${dcm.body.id}/link?purpose=view`)).status).toBe(400);
    const d = await fetchRaw(dentist, (await dentist.get(`/api/clinical-files/${dcm.body.id}/link`)).body.url);
    expect(d.headers["content-type"]).toBe("application/dicom");
    expect(String(d.headers["content-disposition"])).toMatch(/^attachment; filename=".*\.dcm"$/);
  });

  it("filtra por pieza y por tipo", async () => {
    const t36 = (await list(dentist, patient, "?tooth=36")).body.items;
    expect(t36.length).toBeGreaterThan(0);
    expect(t36.every((i: any) => i.teeth.includes(36))).toBe(true);
    const docs = (await list(dentist, patient, "?kind=scanned_document")).body.items;
    expect(docs.every((i: any) => i.kind === "scanned_document")).toBe(true);
    expect((await list(dentist, patient, "?tooth=19")).status).toBe(400);
  });
});

describe("rechazos de entrada", () => {
  it("rechaza por firma aunque la extensión y el Content-Type mientan", async () => {
    const before = storedFiles().length;
    const html = await upload(dentist, patient, Buffer.from("<!doctype html><script>alert(1)</script>"), { fileName: "foto.jpg" }, { "x-content-type": "image/jpeg" });
    expect(html.status).toBe(415);
    expect(html.body.error.message).toMatch(/Tipo de archivo no permitido/);
    expect((await upload(dentist, patient, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { fileName: "rx.png" })).status).toBe(415);
    expect((await upload(dentist, patient, Buffer.from("MZ\x90\x00 ejecutable"), { fileName: "rx.jpeg" })).status).toBe(415);
    // un PDF no es una foto intraoral, aunque se llame .png
    const pdfAsPhoto = await upload(dentist, patient, PDF(), { kind: "photo_intraoral", fileName: "boca.png" });
    expect(pdfAsPhoto.status).toBe(415);
    expect(pdfAsPhoto.body.error.message).toMatch(/PDF no corresponde a «Foto intraoral»/);
    // el Content-Type del cuerpo tampoco puede ser otro
    const r = await env.app.inject({ method: "POST", url: `/api/patients/${patient}/clinical-files`, headers: { cookie: dentist.cookie, "x-csrf-token": dentist.csrf, "content-type": "image/png", "x-file-meta": "x" }, payload: png() });
    expect(r.statusCode).toBe(415);
    expect(storedFiles().length).toBe(before); // nada quedó en el disco
  });

  it("límite de tamaño configurable (aquí 1 MB) y archivo vacío", async () => {
    const before = storedFiles().length;
    const big = Buffer.concat([png(), Buffer.alloc(1024 * 1024)]);
    const r = await upload(dentist, patient, big);
    expect(r.status).toBe(413);
    expect(r.body.error.message).toBe("El archivo supera el límite de 1 MB");
    const ok = Buffer.concat([png(), Buffer.alloc(1024 * 1024 - 8192)]);
    expect((await upload(dentist, patient, ok)).status).toBe(200);
    expect((await upload(dentist, patient, Buffer.alloc(0))).status).toBe(400);
    expect(storedFiles().length).toBe(before + 1);
  });

  it("valida metadatos: pieza FDI, fecha futura, sucursal ajena, descripción larga, sin sesión", async () => {
    expect((await upload(dentist, patient, png(), { teeth: [19] })).body.error.message).toMatch(/Pieza dental inválida.*19/);
    expect((await upload(dentist, patient, png(), { takenOn: "2999-01-01" })).body.error.message).toBe("La fecha de toma no puede ser futura");
    expect((await upload(dentist, patient, png(), { branchId: K.branches[1] })).status).toBe(403); // no tiene esa sucursal
    expect((await upload(dentist, patient, png(), { kind: "radiografia" })).status).toBe(400);
    const long = await upload(dentist, patient, png(), { description: "x".repeat(501) });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toMatch(/500 caracteres/);
    expect((await upload(null, patient, png())).status).toBe(401);
    const noCsrf = await env.app.inject({ method: "POST", url: `/api/patients/${patient}/clinical-files`, headers: { cookie: dentist.cookie, "content-type": "application/octet-stream", "x-file-meta": encodeURIComponent(JSON.stringify({ branchId: K.branches[0], kind: "other", takenOn: today() })) }, payload: png() });
    expect(noCsrf.statusCode).toBe(403);
  });

  it("anti-duplicado por SHA-256 dentro del mismo paciente (también si está archivado)", async () => {
    const b = png();
    const first = await upload(dentist, patient, b);
    expect(first.status).toBe(200);
    const dup = await upload(dentist, patient, b, { kind: "other", fileName: "otro-nombre.png" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("duplicate_file");
    expect(dup.body.error.details).toEqual({ fileId: first.body.id, archived: false });
    // el mismo archivo en otro paciente sí se acepta
    expect((await upload(dentist, patient2, b)).status).toBe(200);
    expect((await dentist.post(`/api/clinical-files/${first.body.id}/archive`, { reason: "Subida por error" })).status).toBe(200);
    const again = await upload(dentist, patient, b);
    expect(again.status).toBe(409);
    expect(again.body.error.details.archived).toBe(true);
    expect(again.body.error.message).toMatch(/archivado/);
  });
});

describe("permisos por rol", () => {
  let xray: string, scan: string;
  beforeAll(async () => {
    xray = (await upload(dentist, patient, png(), { kind: "xray_periapical" })).body.id;
    scan = (await upload(rec, patient, png(), { kind: "scanned_document", teeth: [], description: "Carnet escaneado" })).body.id;
  });

  it("recepción sube y ve solo documentos escaneados", async () => {
    expect(scan).toBeTruthy();
    const l = await list(rec);
    expect(l.status).toBe(200);
    expect(l.body.items.length).toBeGreaterThan(0);
    expect(l.body.items.every((i: any) => i.kind === "scanned_document")).toBe(true);
    expect(l.body.kinds.map((k: any) => k.id)).toEqual(["scanned_document"]);
    expect((await list(rec, patient, "?kind=xray_periapical")).body.items).toEqual([]);
    const up = await upload(rec, patient, png(), { kind: "xray_periapical" });
    expect(up.status).toBe(403);
    expect(up.body.error.message).toMatch(/Solo el personal clínico/);
    expect((await rec.get(`/api/clinical-files/${xray}/link?purpose=view`)).status).toBe(403);
    // aunque consiga el enlace de un odontólogo, no le sirve
    const dentLink = (await dentist.get(`/api/clinical-files/${xray}/link?purpose=view`)).body.url;
    expect((await fetchRaw(rec, dentLink)).status).toBe(403);
    // con un enlace propio pero de un archivo clínico (firmado a mano) tampoco
    const forged = signFileToken(loadConfig().secretKey, { f: xray, c: K.clinicId, u: (await rec.get("/api/auth/me")).body.user.id, p: "view" });
    expect((await fetchRaw(rec, contentUrl(xray, forged.token))).status).toBe(403);
    // su documento sí lo ve
    const own = (await rec.get(`/api/clinical-files/${scan}/link?purpose=view`)).body.url;
    expect((await fetchRaw(rec, own)).status).toBe(200);
    expect(await auditCount("clinical_file.viewed", scan)).toBe(1);
  });

  it("asistente sube imágenes clínicas pero no archiva; contabilidad solo ve documentos; limpieza nada", async () => {
    expect((await upload(assistant, patient, png(), { kind: "photo_intraoral" })).status).toBe(200);
    expect((await assistant.post(`/api/clinical-files/${xray}/archive`, { reason: "No corresponde" })).status).toBe(403);
    const acc = await list(accountant);
    expect(acc.status).toBe(200);
    expect(acc.body.items.every((i: any) => i.kind === "scanned_document")).toBe(true);
    expect((await upload(accountant, patient, png(), { kind: "scanned_document", teeth: [] })).status).toBe(403);
    expect((await list(support)).status).toBe(403);
    // propietaria sin rol profesional: no ve lo clínico
    expect((await list(owner)).body.items.every((i: any) => i.kind === "scanned_document")).toBe(true);
  });

  it("archivar y restaurar con motivo: eventos de solo inserción y transiciones válidas", async () => {
    expect((await dentist.post(`/api/clinical-files/${xray}/archive`, { reason: "x" })).status).toBe(400);
    expect((await dentist.post(`/api/clinical-files/${xray}/archive`, { reason: "Imagen movida" })).status).toBe(200);
    const twice = await dentist.post(`/api/clinical-files/${xray}/archive`, { reason: "Otra vez" });
    expect(twice.status).toBe(409);
    expect(twice.body.error.message).toBe("El archivo ya está archivado");
    expect((await list(dentist)).body.items.some((i: any) => i.id === xray)).toBe(false);
    const arch = (await list(dentist, patient, "?status=archived")).body;
    expect(arch.items.find((i: any) => i.id === xray).archived).toMatchObject({ reason: "Imagen movida" });
    expect(arch.archivedCount).toBeGreaterThanOrEqual(1);
    // archivado sigue disponible para verlo (no se borra)
    expect((await fetchRaw(dentist, arch.items.find((i: any) => i.id === xray).viewUrl)).status).toBe(200);
    expect((await dentist.post(`/api/clinical-files/${xray}/restore`, { reason: "Era correcta" })).status).toBe(200);
    expect((await dentist.post(`/api/clinical-files/${xray}/restore`, { reason: "Era correcta" })).status).toBe(409);
    expect((await list(dentist)).body.items.some((i: any) => i.id === xray)).toBe(true);
    // recepción archiva su documento, no una radiografía
    expect((await rec.post(`/api/clinical-files/${scan}/archive`, { reason: "Duplicado en papel" })).status).toBe(200);
    expect((await rec.post(`/api/clinical-files/${xray}/archive`, { reason: "No corresponde" })).status).toBe(403);
    const events = (await env.db.adminPool.query("SELECT seq, kind FROM clinical_file_events WHERE file_id = $1 ORDER BY seq", [xray])).rows;
    expect(events).toEqual([{ seq: 1, kind: "archived" }, { seq: 2, kind: "restored" }]);
    expect(await auditCount("clinical_file.archived", xray)).toBe(1);
    expect(await auditCount("clinical_file.restored", xray)).toBe(1);
  });

  it("los registros no se modifican ni se borran (ni siquiera el dueño de la base)", async () => {
    await expect(env.db.adminPool.query("UPDATE clinical_files SET description = 'cambio' WHERE id = $1", [xray])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM clinical_files WHERE id = $1", [xray])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM clinical_file_events WHERE file_id = $1", [xray])).rejects.toThrow(/solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("UPDATE clinical_files SET kind = 'other' WHERE id = $1", [xray]))).rejects.toThrow(/permission denied|solo inserción/);
  });
});

describe("enlaces firmados", () => {
  let id: string;
  beforeAll(async () => { id = (await upload(dentist, patient, png())).body.id; });

  it("un enlace vencido o manipulado no sirve", async () => {
    const me = (await dentist.get("/api/auth/me")).body.user.id;
    const old = signFileToken(loadConfig().secretKey, { f: id, c: K.clinicId, u: me, p: "view" }, Date.now() - 6 * 60_000);
    const r = await fetchRaw(dentist, contentUrl(id, old.token));
    expect(r.status).toBe(403);
    expect(r.json().error.code).toBe("link_expired");
    const fresh = (await dentist.get(`/api/clinical-files/${id}/link?purpose=view`)).body.url as string;
    expect((await fetchRaw(dentist, fresh.slice(0, -3) + "AAA")).status).toBe(403);
    // el enlace de un archivo no abre otro
    const other = (await upload(dentist, patient, png())).body.id;
    expect((await fetchRaw(dentist, fresh.replace(id, other))).json().error.code).toBe("invalid_link");
    // sin sesión no sirve
    expect((await env.app.inject({ method: "GET", url: fresh })).statusCode).toBe(401);
  });

  it("si el archivo falta en el almacenamiento responde 410 sin auditar una entrega", async () => {
    const key = (await env.db.adminPool.query("SELECT storage_key FROM clinical_files WHERE id = $1", [id])).rows[0].storage_key;
    unlinkSync(join(FILES_DIR, key));
    const r = await fetchRaw(dentist, (await dentist.get(`/api/clinical-files/${id}/link`)).body.url);
    expect(r.status).toBe(410);
    expect(await auditCount("clinical_file.downloaded", id)).toBe(0);
  });
});

describe("aislamiento entre clínicas", () => {
  let id: string;
  beforeAll(async () => { id = (await upload(dentist, patient, png())).body.id; });

  it("API: otra clínica no lista, no pide enlaces, no sube ni archiva", async () => {
    expect((await list(otherDentist)).status).toBe(404);
    expect((await otherDentist.get(`/api/clinical-files/${id}/link`)).status).toBe(404);
    expect((await otherDentist.post(`/api/clinical-files/${id}/archive`, { reason: "Ajeno" })).status).toBe(404);
    const up = await upload(otherDentist, patient, png(), { branchId: K2.branches[0] });
    expect(up.status).toBe(404);
    // un enlace válido de la clínica A no sirve con la sesión de la clínica B
    const url = (await dentist.get(`/api/clinical-files/${id}/link?purpose=view`)).body.url;
    expect((await fetchRaw(otherDentist, url)).status).toBe(403);
  });

  it("la misma persona en dos clínicas: el enlace emitido en A no sirve con B activa", async () => {
    await env.db.adminPool.query("INSERT INTO memberships (clinic_id, user_id, role, all_branches, is_professional) VALUES ($1,$2,'dentist',true,true)", [K2.clinicId, dentistId]);
    const email = (await env.db.adminPool.query("SELECT email FROM users WHERE id = $1", [dentistId])).rows[0].email;
    const a = await login(env.app, email, PASSWORD);
    expect((await a.post("/api/auth/switch-clinic", { clinicId: K.clinicId })).status).toBe(200);
    const url = (await a.get(`/api/clinical-files/${id}/link?purpose=view`)).body.url;
    expect((await fetchRaw(a, url)).status).toBe(200);
    expect((await a.post("/api/auth/switch-clinic", { clinicId: K2.clinicId })).status).toBe(200);
    expect((await fetchRaw(a, url)).status).toBe(403);
    // y en B no puede subir a un paciente de A
    expect((await upload(a, patient, png(), { branchId: K2.branches[0] })).status).toBe(404);
  });

  it("SQL con RLS: otra clínica no ve filas, no inserta con clinic_id ajeno ni apunta a un paciente ajeno", async () => {
    const seen = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) => ({
      files: (await c.query("SELECT id FROM clinical_files")).rowCount,
      events: (await c.query("SELECT id FROM clinical_file_events")).rowCount,
    }));
    expect(seen).toEqual({ files: 0, events: 0 });
    const mine = await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, async (c) => (await c.query("SELECT id FROM clinical_files")).rowCount);
    expect(mine).toBeGreaterThan(0);
    const key = `${K.clinicId}/2026/${"a".repeat(32)}`;
    const ins = (clinic: string, ctx: string, pid: string, br: string, k = key) => withTenant(env.db.appPool, { clinicId: ctx, userId: null }, (c) => c.query(
      `INSERT INTO clinical_files (clinic_id, patient_id, branch_id, kind, taken_on, mime_type, size_bytes, sha256, storage_key, uploaded_by)
       VALUES ($1,$2,$3,'other',current_date,'image/png',10,$4,$5,$6)`, [clinic, pid, br, "b".repeat(64), k, dentistId]));
    await expect(ins(K.clinicId, K2.clinicId, patient, K.branches[0]!)).rejects.toThrow(/row-level security/);
    await expect(ins(K2.clinicId, K2.clinicId, patient, K2.branches[0]!, `${K2.clinicId}/2026/${"c".repeat(32)}`)).rejects.toThrow(/foreign key/);
    // la clave de almacenamiento debe empezar con la clínica dueña
    await expect(ins(K2.clinicId, K2.clinicId, otherPatient, K2.branches[0]!, key)).rejects.toThrow(/check constraint|foreign key/);
    // eventos: no se archiva un archivo de otra clínica
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query(
      "INSERT INTO clinical_file_events (clinic_id, file_id, seq, kind, reason, user_id) VALUES ($1,$2,0,'archived','ajeno',$3)", [K2.clinicId, id, dentistId]))).rejects.toThrow(/foreign key/);
  });
});

describe("línea de tiempo del paciente", () => {
  it("el profesional ve las subidas y los archivados; recepción no recibe la fuente", async () => {
    const t = (await dentist.get(`/api/patients/${patient}/timeline?types=files&limit=200`)).body;
    expect(t.available.map((x: any) => x.id)).toContain("files");
    expect(t.items.some((i: any) => i.title === "Imagen o archivo agregado: Radiografía periapical" && /Pieza 36/.test(i.detail))).toBe(true);
    expect(t.items.some((i: any) => i.title === "Se archivó: Radiografía periapical" && /Imagen movida/.test(i.detail))).toBe(true);
    expect(t.items.some((i: any) => i.title === "Se restauró: Radiografía periapical")).toBe(true);
    const r = (await rec.get(`/api/patients/${patient}/timeline?limit=200`)).body;
    expect(r.available.map((x: any) => x.id)).not.toContain("files");
    expect((await rec.get(`/api/patients/${patient}/timeline?types=files`)).body.items).toEqual([]);
  });
});
