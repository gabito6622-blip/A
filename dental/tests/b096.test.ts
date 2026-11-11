// B-096: «Marcar revisada» en plantillas de consentimiento, logo de la clínica y miniaturas de las
// imágenes antiguas. Datos ficticios; archivos en una carpeta temporal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodePng } from "../server/src/lib/png.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

process.env.DENTAL_FILES_DIR = mkdtempSync(join(tmpdir(), "dental-b096-test-"));

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, rec: Agent, dentist: Agent;
let n = 0;
const png = (w = 64, h = 48) => { const k = ++n; return encodePng(w, h, (x, y) => [(x * 7 + k) % 256, (y * 11 + k * 5) % 256, (k * 29) % 256]); };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

const bin = async (a: Agent, url: string, body: Buffer, extra: Record<string, string> = {}) => {
  const r = await env.app.inject({ method: "POST", url, headers: { cookie: a.cookie, "x-csrf-token": a.csrf, "content-type": "application/octet-stream", ...extra }, payload: body });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json };
};
const raw = async (a: Agent | null, url: string) => {
  const r = await env.app.inject({ method: "GET", url, headers: a ? { cookie: a.cookie } : {} });
  return { status: r.statusCode, buf: r.rawPayload, headers: r.headers };
};

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  dentist = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] })).email);
}, 60_000);
afterAll(async () => teardown(env));

describe("«Marcar revisada» en plantillas de consentimiento", () => {
  it("queda con quién y cuándo, auditada, solo con permiso, y Primeros pasos la cuenta", async () => {
    const tpls = (await owner.get("/api/consent-templates")).body as any[];
    const t = tpls[0];
    expect(t.reviewedAt).toBeNull();
    expect((await rec.post(`/api/consent-templates/${t.id}/review`, {})).status).toBe(403);
    expect((await owner2.post(`/api/consent-templates/${t.id}/review`, {})).status).toBe(404);
    const r = await owner.post(`/api/consent-templates/${t.id}/review`, { note: "Leída por la asesoría" });
    expect(r.status).toBe(200);
    const after = ((await owner.get("/api/consent-templates")).body as any[]).find((x) => x.id === t.id);
    expect(after).toMatchObject({ reviewNote: "Leída por la asesoría" });
    expect(after.reviewedAt).toBeTruthy();
    expect(after.reviewedByName).toBeTruthy();
    const a = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'consent_template.reviewed'", [t.id])).rows;
    expect(a).toHaveLength(1);
    // Solo inserción: una revisión no se borra ni se cambia.
    await expect(env.db.adminPool.query("DELETE FROM consent_template_reviews WHERE template_id = $1", [t.id])).rejects.toThrow(/solo inserción/);
    // Primeros pasos: la plantilla revisada deja de figurar como pendiente.
    const steps = (await owner.get("/api/onboarding")).body;
    const consents = (steps.items ?? steps).find((x: any) => x.id === "consents");
    expect(JSON.stringify(consents.detail)).not.toContain(t.title);
    // La otra clínica no ve la revisión.
    const other = ((await owner2.get("/api/consent-templates")).body as any[]).filter((x) => x.reviewedAt);
    expect(other).toEqual([]);
  });
});

describe("logo de la clínica", () => {
  it("sube un PNG verificado, se ve en la app y el portal, se reemplaza y se quita; recepción no puede subirlo", async () => {
    expect((await owner.get("/api/clinic/logo-info")).body).toBeNull();
    expect((await raw(owner, "/api/clinic/logo")).status).toBe(404);
    const logo = png(200, 80);
    expect((await bin(rec, "/api/clinic/logo", logo)).status).toBe(403);
    const up = await bin(owner, "/api/clinic/logo", logo);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body).toMatchObject({ width: 200, height: 80, mimeType: "image/png" });
    const info = (await rec.get("/api/clinic/logo-info")).body; // cualquier persona de la clínica lo ve
    expect(info.version).toBe(up.body.version);
    const img = await raw(rec, `/api/clinic/logo?v=${info.version}`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(img.buf, logo)).toBe(0);
    // Otra clínica: su propio logo (ninguno), nunca el de K.
    expect((await owner2.get("/api/clinic/logo-info")).body).toBeNull();
    expect((await raw(owner2, "/api/clinic/logo")).status).toBe(404);
    // Reemplazo y baja: quedan en el historial (solo inserción) y auditados.
    const second = await bin(owner, "/api/clinic/logo", png(120, 120));
    expect(second.body.version).not.toBe(up.body.version);
    expect((await owner.post("/api/clinic/logo/remove")).body).toMatchObject({ removed: true });
    expect((await owner.get("/api/clinic/logo-info")).body).toBeNull();
    const hist = (await env.db.adminPool.query("SELECT removed FROM clinic_logos WHERE clinic_id = $1 ORDER BY created_at", [K.clinicId])).rows.map((r) => r.removed);
    expect(hist).toEqual([false, false, true]);
    const acts = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE clinic_id = $1 AND action LIKE 'clinic.logo_%' ORDER BY id", [K.clinicId])).rows.map((r) => r.action);
    expect(acts).toEqual(["clinic.logo_set", "clinic.logo_set", "clinic.logo_removed"]);
  });

  it("rechaza lo que no es PNG o JPG, imágenes enormes o diminutas y archivos pesados", async () => {
    expect((await bin(owner, "/api/clinic/logo", Buffer.from("%PDF-1.4\n%%EOF\n"))).status).toBe(415);
    expect((await bin(owner, "/api/clinic/logo", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).status).toBe(415);
    expect((await bin(owner, "/api/clinic/logo", png(900, 100))).status).toBe(400);
    expect((await bin(owner, "/api/clinic/logo", png(8, 8))).status).toBe(400);
    const heavy = encodePng(500, 500, () => [...randomBytes(3)] as [number, number, number]);
    expect(heavy.length).toBeGreaterThan(300 * 1024);
    expect((await bin(owner, "/api/clinic/logo", heavy)).status).toBe(413);
  });

  it("aparece en el portal del paciente y en los PDF nuevos", async () => {
    const logo = png(160, 60);
    expect((await bin(owner, "/api/clinic/logo", logo)).status).toBe(200);
    // Portal (sin sesión): se activa la reserva para obtener el slug.
    const ps = (await owner.get("/api/portal/settings")).body;
    const put = await owner.put("/api/portal/settings", {
      enabled: true, slug: ps.slug, leadTimeHours: 2, maxDaysAhead: 30, changeWindowHours: 24, showPrices: false, instructions: null,
      branches: [{ branchId: K.branches[0], enabled: true, mode: "request", whatsapp: null, mapUrl: null }],
      services: ps.services.slice(0, 1).map((x: any) => ({ procedureId: x.procedureId, priceFromCents: null })),
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const slug = ps.slug;
    const info = await env.app.inject({ method: "GET", url: `/api/public/c/${slug}/info` });
    expect(info.json().clinic.logoVersion).toBeTruthy();
    const pub = await raw(null, `/api/public/c/${slug}/logo`);
    expect(pub.status).toBe(200);
    expect(Buffer.compare(pub.buf, logo)).toBe(0);
    // PDF: el membrete lleva una imagen (el PDF crece y contiene un XObject de imagen).
    const { renderPdf } = await import("../server/src/lib/pdf.js");
    const meta = (withLogo: boolean) => ({
      docTitle: "Receta médica", docLabel: "Receta N° 1", issuedAt: new Date(), zone: "America/La_Paz",
      letterhead: { clinicName: "Clínica Prueba", branchName: "Centro", logo: withLogo ? logo : null },
      issuer: null, fingerprint: "a".repeat(64), verifyCode: "ABCD1234EFGH", verifyUrl: "http://localhost/verificar/ABCD", watermark: null,
    });
    const without = await renderPdf(meta(false) as any, (w) => { w.text("Texto"); });
    const withL = await renderPdf(meta(true) as any, (w) => { w.text("Texto"); });
    // El membrete ya trae una imagen (el QR de verificación): con logo hay una más.
    const images = (b: Buffer) => (b.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;
    expect(images(withL)).toBe(images(without) + 1);
  });
});

describe("miniaturas de imágenes antiguas", () => {
  it("lista las que faltan, acepta una miniatura válida una sola vez y respeta permisos y clínica", async () => {
    const patient = await createPatient(owner, { firstName: "Antigua" });
    const meta = { branchId: K.branches[0], kind: "photo_intraoral", takenOn: today(), teeth: [], fileName: "foto.png" };
    const up = await bin(dentist, `/api/patients/${patient}/clinical-files`, png(300, 200), { "x-file-meta": encodeURIComponent(JSON.stringify(meta)) });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const id = up.body.id;
    const missing = (await dentist.get("/api/clinical-files/missing-thumbs")).body;
    expect(missing.items.map((x: any) => x.id)).toContain(id);
    expect(missing.items.find((x: any) => x.id === id).viewUrl).toMatch(/\/content\?t=/);
    // Recepción no ve fotos clínicas: ni en la lista ni para subir su miniatura.
    expect((await rec.get("/api/clinical-files/missing-thumbs")).body.items.map((x: any) => x.id)).not.toContain(id);
    expect((await bin(rec, `/api/clinical-files/${id}/thumb`, png(120, 80))).status).toBe(403);
    // Otra clínica: no existe.
    const d2 = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
    expect((await bin(d2, `/api/clinical-files/${id}/thumb`, png(120, 80))).status).toBe(404);
    // Miniatura inválida (demasiado grande en píxeles) y válida.
    expect((await bin(dentist, `/api/clinical-files/${id}/thumb`, encodePng(500, 10, () => [200, 200, 200]))).status).toBe(400);
    const ok = await bin(dentist, `/api/clinical-files/${id}/thumb`, png(120, 80));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.thumbUrl).toMatch(/\/thumb\?t=/);
    expect((await bin(dentist, `/api/clinical-files/${id}/thumb`, png(120, 80))).status).toBe(409);
    expect((await dentist.get("/api/clinical-files/missing-thumbs")).body.items.map((x: any) => x.id)).not.toContain(id);
    const gallery = (await dentist.get(`/api/patients/${patient}/clinical-files`)).body.items.find((x: any) => x.id === id);
    expect(gallery.thumbUrl).toBeTruthy();
    const a = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'clinical_file.thumb_added'", [id])).rows[0].n;
    expect(a).toBe(1);
  });
});
