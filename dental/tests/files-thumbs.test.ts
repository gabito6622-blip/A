// Miniaturas de archivos clínicos y barrido de huérfanos (B-081): la miniatura viaja en la misma
// subida y se valida (firma, ≤ 100 KB, ≤ 400 px); la galería solo entrega miniaturas y abrirla no
// audita originales; enlaces separados por propósito; archivos antiguos sin miniatura; permisos,
// aislamiento (API y RLS), inmutabilidad; barrido simulado y con --apply respetando 24 h.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withTenant } from "../server/src/lib/db.js";
import { loadConfig } from "../server/src/config.js";
import { encodePng } from "../server/src/lib/png.js";
import { imageDimensions, LocalFileStore, newStorageKey } from "../server/src/lib/filestore.js";
import { signFileToken, thumbUrl } from "../server/src/modules/clinicalFiles-core.js";
import { formatSweepReport, sweepFiles } from "../server/src/modules/clinicalFilesSweep.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

const FILES_DIR = mkdtempSync(join(tmpdir(), "dental-thumbs-test-"));
process.env.DENTAL_FILES_DIR = FILES_DIR;
process.env.DENTAL_FILES_MAX_MB = "2";

let env: Env;
let K: TestClinic, K2: TestClinic;
let dentist: Agent, rec: Agent, otherDentist: Agent;
let patient: string;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let n = 0;
const png = (w = 40, h = 30) => { const k = ++n; return encodePng(w, h, (x, y) => [(x * 7 + k) % 256, (y * 11 + k * 5) % 256, (k * 29) % 256]); };
/** JPEG mínimo con cabecera SOF0 (el servidor no decodifica: lee firma y dimensiones). */
const jpeg = (w: number, h: number, pad = 300) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1"),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  randomBytes(pad), Buffer.from([0xff, 0xd9]),
]);
/** WebP sin pérdida (VP8L): solo la cabecera con el ancho y el alto. */
const webp = (w: number, h: number) => {
  const bits = Buffer.alloc(4); bits.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14));
  const data = Buffer.concat([Buffer.from([0x2f]), bits, randomBytes(40)]);
  const chunk = Buffer.concat([Buffer.from("VP8L"), Buffer.from([data.length & 255, data.length >> 8, 0, 0]), data]);
  const riff = Buffer.alloc(4); riff.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([Buffer.from("RIFF"), riff, Buffer.from("WEBP"), chunk]);
};
const PDF = () => Buffer.from(`%PDF-1.4\n% documento ${++n}\n%%EOF\n`);

async function upload(a: Agent, pid: string, original: Buffer, thumb: Buffer | null, meta: Record<string, unknown> = {}) {
  const m = { branchId: K.branches[0], kind: "photo_intraoral", takenOn: today(), teeth: [], fileName: "foto.png", ...(thumb ? { thumbBytes: thumb.length } : {}), ...meta };
  const r = await env.app.inject({
    method: "POST", url: `/api/patients/${pid}/clinical-files`,
    headers: { cookie: a.cookie, "x-csrf-token": a.csrf, "content-type": "application/octet-stream", "x-file-meta": encodeURIComponent(JSON.stringify(m)) },
    payload: thumb ? Buffer.concat([original, thumb]) : original,
  });
  let body: any = null;
  try { body = r.json(); } catch { body = r.body; }
  return { status: r.statusCode, body };
}
const raw = async (a: Agent, url: string) => {
  const r = await env.app.inject({ method: "GET", url, headers: { cookie: a.cookie } });
  return { status: r.statusCode, buf: r.rawPayload, headers: r.headers, json: () => r.json() };
};
const deliveries = async (ids: string[]) => (await env.db.adminPool.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM audit_log WHERE action IN ('clinical_file.viewed','clinical_file.downloaded') AND entity_id = ANY($1::text[])", [ids])).rows[0]!.n;
const stored = () => { const out: string[] = []; const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : out.push(p); } }; walk(FILES_DIR); return out; };

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db);
  const owner = await login(env.app, K.ownerEmail);
  dentist = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  otherDentist = await login(env.app, (await addUser(env.db, K2.clinicId, "dentist", { allBranches: true })).email);
  patient = await createPatient(owner, { firstName: "Miniatura" });
});
afterAll(async () => {
  await teardown(env);
  rmSync(FILES_DIR, { recursive: true, force: true });
});

describe("lectura de dimensiones (unidad)", () => {
  it("PNG, JPEG (SOF0 tras APP0), WebP VP8L/VP8X y nada más", () => {
    expect(imageDimensions(png(37, 21))).toEqual({ width: 37, height: 21 });
    expect(imageDimensions(jpeg(320, 240))).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(webp(320, 180))).toEqual({ width: 320, height: 180 });
    const vp8x = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBPVP8X"), Buffer.from([10, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0x01, 0, 0xef, 0, 0]), Buffer.alloc(8)]);
    expect(imageDimensions(vp8x)).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(PDF())).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, 0, 0, 0, 0]))).toBeNull(); // JPEG sin SOF
  });
});

describe("subida con miniatura", () => {
  let id: string, legacy: string;
  const original = png(120, 90);
  const thumb = jpeg(320, 240);

  it("original y miniatura en la misma solicitud; cada uno con su clave aleatoria", async () => {
    const before = stored().length;
    const r = await upload(dentist, patient, original, thumb);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ mimeType: "image/png", sha256: sha(original), thumbnail: { mimeType: "image/jpeg", width: 320, height: 240 } });
    id = r.body.id;
    expect(stored().length).toBe(before + 2);
    const row = (await env.db.adminPool.query("SELECT t.mime_type, t.width, t.height, t.size_bytes, t.sha256, t.storage_key <> f.storage_key AS distinct_key FROM clinical_file_thumbs t JOIN clinical_files f ON f.id = t.file_id WHERE t.file_id = $1", [id])).rows[0];
    expect(row).toEqual({ mime_type: "image/jpeg", width: 320, height: 240, size_bytes: thumb.length, sha256: sha(thumb), distinct_key: true });
    const a = (await env.db.adminPool.query("SELECT data FROM audit_log WHERE action = 'clinical_file.uploaded' AND entity_id = $1", [id])).rows[0].data;
    expect(a).toMatchObject({ thumbnail: true, sizeBytes: original.length });
    legacy = (await upload(dentist, patient, png(50, 50), null)).body.id;
    expect((await upload(dentist, patient, png(10, 400), webp(10, 400))).status).toBe(200); // WebP alto y angosto
  });

  it("la galería solo carga miniaturas: abrirla no audita entregas de originales", async () => {
    const l = await dentist.get(`/api/patients/${patient}/clinical-files`);
    const items = l.body.items as any[];
    const it0 = items.find((i) => i.id === id);
    expect(it0.thumbUrl).toMatch(/^\/api\/clinical-files\/[0-9a-f-]+\/thumb\?t=/);
    expect(items.find((i) => i.id === legacy).thumbUrl).toBeNull(); // archivo sin miniatura → marcador
    for (const i of items.filter((x) => x.thumbUrl)) expect((await raw(dentist, i.thumbUrl)).status).toBe(200);
    const t = await raw(dentist, it0.thumbUrl);
    expect(sha(t.buf)).toBe(sha(thumb));
    expect(t.headers["content-type"]).toBe("image/jpeg");
    expect(t.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(t.headers["content-security-policy"])).toContain("sandbox");
    expect(t.headers["cache-control"]).toBe("no-store");
    expect(await deliveries(items.map((i) => i.id))).toBe(0);
    // abrir el original en el visor sí se audita (una entrega)
    const view = (await dentist.get(`/api/clinical-files/${id}/link?purpose=view`)).body.url;
    const o = await raw(dentist, view);
    expect(sha(o.buf)).toBe(sha(original));
    expect(await deliveries([id])).toBe(1);
  });

  it("enlaces por propósito: la miniatura no abre el original ni al revés; vencidos y de otra persona no sirven", async () => {
    const me = (await dentist.get("/api/auth/me")).body.user.id;
    const key = loadConfig().keys.link;
    const tt = signFileToken(key, { f: id, c: K.clinicId, u: me, p: "thumb" }).token;
    const asContent = await raw(dentist, `/api/clinical-files/${id}/content?t=${encodeURIComponent(tt)}`);
    expect(asContent.status).toBe(403);
    expect(asContent.json().error.code).toBe("invalid_link");
    const vt = signFileToken(key, { f: id, c: K.clinicId, u: me, p: "view" }).token;
    expect((await raw(dentist, thumbUrl(id, vt))).status).toBe(403);
    const old = signFileToken(key, { f: id, c: K.clinicId, u: me, p: "thumb" }, Date.now() - 6 * 60_000).token;
    expect((await raw(dentist, thumbUrl(id, old))).json().error.code).toBe("link_expired");
    expect((await raw(rec, thumbUrl(id, tt))).status).toBe(403); // emitido para otra persona
    expect((await env.app.inject({ method: "GET", url: thumbUrl(id, tt) })).statusCode).toBe(401);
    // archivo antiguo sin miniatura: 404 claro
    const lt = signFileToken(key, { f: legacy, c: K.clinicId, u: me, p: "thumb" }).token;
    const nf = await raw(dentist, thumbUrl(legacy, lt));
    expect(nf.status).toBe(404);
    expect(nf.json().error.message).toMatch(/Miniatura/);
    expect(await deliveries([id, legacy])).toBe(1); // nada de esto entregó originales
  });

  it("si la miniatura falta en el almacenamiento responde 410 (la galería muestra el marcador)", async () => {
    const r = await upload(dentist, patient, png(30, 30), jpeg(100, 80));
    const tk = (await env.db.adminPool.query("SELECT storage_key FROM clinical_file_thumbs WHERE file_id = $1", [r.body.id])).rows[0].storage_key;
    unlinkSync(join(FILES_DIR, tk));
    const item = (await dentist.get(`/api/patients/${patient}/clinical-files`)).body.items.find((i: any) => i.id === r.body.id);
    expect((await raw(dentist, item.thumbUrl)).status).toBe(410);
  });
});

describe("miniaturas rechazadas", () => {
  it("enorme, demasiado grande en píxeles, que no es imagen, de un PDF o sin original; nada queda guardado", async () => {
    const before = stored().length;
    const big = jpeg(320, 240, 150 * 1024);
    const r1 = await upload(dentist, patient, png(), big);
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toMatch(/miniatura supera el límite de 100 KB/);
    const r2 = await upload(dentist, patient, png(), jpeg(2000, 1500));
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toMatch(/2000×1500 px.*400 px/);
    const r3 = await upload(dentist, patient, png(), Buffer.from("<html><script>alert(1)</script></html>"));
    expect(r3.status).toBe(415);
    expect(r3.body.error.code).toBe("thumb_type_not_allowed");
    expect((await upload(dentist, patient, png(), PDF())).status).toBe(415);
    expect((await upload(dentist, patient, png(), Buffer.from("GIF89a\x10\x00\x10\x00......"))).status).toBe(415);
    const vp8zero = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBPVP8 "), Buffer.alloc(30)]); // WebP sin tamaño legible
    expect((await upload(dentist, patient, png(), vp8zero)).body.error.message).toMatch(/no se pudo leer su tamaño/);
    const r4 = await upload(dentist, patient, PDF(), jpeg(100, 100), { kind: "scanned_document" });
    expect(r4.status).toBe(400);
    expect(r4.body.error.message).toMatch(/Solo las imágenes llevan miniatura/);
    const t = jpeg(100, 100);
    const r5 = await env.app.inject({
      method: "POST", url: `/api/patients/${patient}/clinical-files`, payload: t,
      headers: { cookie: dentist.cookie, "x-csrf-token": dentist.csrf, "content-type": "application/octet-stream",
        "x-file-meta": encodeURIComponent(JSON.stringify({ branchId: K.branches[0], kind: "other", takenOn: today(), thumbBytes: t.length })) },
    });
    expect(r5.statusCode).toBe(400);
    expect((await upload(dentist, patient, png(), jpeg(10, 10), { thumbBytes: 0 })).status).toBe(400);
    expect(stored().length).toBe(before);
    // la base tampoco acepta una miniatura de un PDF aunque se intente por SQL
    const pdfId = (await upload(dentist, patient, PDF(), null, { kind: "scanned_document" })).body.id;
    await expect(env.db.adminPool.query(
      `INSERT INTO clinical_file_thumbs (clinic_id, file_id, mime_type, width, height, size_bytes, sha256, storage_driver, storage_key, created_by)
       SELECT clinic_id, id, 'image/jpeg', 10, 10, 10, $2, 'local', $3, uploaded_by FROM clinical_files WHERE id = $1`,
      [pdfId, "a".repeat(64), newStorageKey(K.clinicId)])).rejects.toThrow(/Solo las imágenes llevan miniatura/);
  });
});

describe("permisos y aislamiento", () => {
  let xray: string, doc: string;
  beforeAll(async () => {
    xray = (await upload(dentist, patient, png(), jpeg(200, 150), { kind: "xray_periapical", teeth: [36] })).body.id;
    const d = await upload(rec, patient, png(), webp(240, 320), { kind: "scanned_document" });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    doc = d.body.id;
  });

  it("recepción ve la miniatura del documento escaneado, no la de una radiografía", async () => {
    const items = (await rec.get(`/api/patients/${patient}/clinical-files`)).body.items as any[];
    expect(items.some((i) => i.id === xray)).toBe(false);
    const di = items.find((i) => i.id === doc);
    expect((await raw(rec, di.thumbUrl)).status).toBe(200);
    const me = (await rec.get("/api/auth/me")).body.user.id;
    const forged = signFileToken(loadConfig().keys.link, { f: xray, c: K.clinicId, u: me, p: "thumb" }).token;
    const r = await raw(rec, thumbUrl(xray, forged));
    expect(r.status).toBe(403);
    expect(r.json().error.message).toMatch(/No tienes permiso/);
  });

  it("otra clínica: la miniatura no se entrega aunque tenga el enlace, y RLS no muestra filas ajenas", async () => {
    const url = (await dentist.get(`/api/patients/${patient}/clinical-files`)).body.items.find((i: any) => i.id === xray).thumbUrl;
    expect((await raw(otherDentist, url)).status).toBe(403);
    const me2 = (await otherDentist.get("/api/auth/me")).body.user.id;
    const forged = signFileToken(loadConfig().keys.link, { f: xray, c: K2.clinicId, u: me2, p: "thumb" }).token;
    expect((await raw(otherDentist, thumbUrl(xray, forged))).status).toBe(404); // RLS: el archivo no existe para K2
    const seen = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) => (await c.query("SELECT count(*)::int AS n FROM clinical_file_thumbs")).rows[0].n);
    expect(seen).toBe(0);
    const mine = await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, async (c) => (await c.query("SELECT count(*)::int AS n FROM clinical_file_thumbs WHERE file_id = $1", [xray])).rows[0].n);
    expect(mine).toBe(1);
    const owner2 = (await env.db.adminPool.query("SELECT user_id FROM memberships WHERE clinic_id = $1 LIMIT 1", [K2.clinicId])).rows[0].user_id;
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query(
      `INSERT INTO clinical_file_thumbs (clinic_id, file_id, mime_type, width, height, size_bytes, sha256, storage_driver, storage_key, created_by)
       VALUES ($1,$2,'image/jpeg',10,10,10,$3,'local',$4,$5)`, [K.clinicId, xray, "b".repeat(64), newStorageKey(K.clinicId), owner2]))).rejects.toThrow();
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query(
      `INSERT INTO clinical_file_thumbs (clinic_id, file_id, mime_type, width, height, size_bytes, sha256, storage_driver, storage_key, created_by)
       VALUES ($1,$2,'image/jpeg',10,10,10,$3,'local',$4,$5)`, [K2.clinicId, xray, "b".repeat(64), newStorageKey(K2.clinicId), owner2]))).rejects.toThrow();
  });

  it("las miniaturas son de solo inserción", async () => {
    await expect(env.db.adminPool.query("UPDATE clinical_file_thumbs SET width = 1 WHERE file_id = $1", [xray])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM clinical_file_thumbs WHERE file_id = $1", [xray])).rejects.toThrow(/solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("DELETE FROM clinical_file_thumbs WHERE file_id = $1", [xray]))).rejects.toThrow();
  });
});

describe("barrido de huérfanos", () => {
  const store = () => new LocalFileStore(FILES_DIR);
  const put = (key: string, hoursAgo: number, body = "bytes sueltos") => {
    const p = join(FILES_DIR, ...key.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    const t = new Date(Date.now() - hoursAgo * 3_600_000);
    utimesSync(p, t, t);
    return p;
  };
  let oldOrphan: string, recentOrphan: string, foreignPath: string, referencedOld: string, missingId: string;

  beforeAll(async () => {
    oldOrphan = newStorageKey(K.clinicId); put(oldOrphan, 30);
    recentOrphan = newStorageKey(K.clinicId); put(recentOrphan, 2);
    foreignPath = join(FILES_DIR, "notas-del-tecnico.txt"); writeFileSync(foreignPath, "no borrar"); utimesSync(foreignPath, new Date(0), new Date(0));
    // un archivo referenciado y viejo: nunca se borra
    const r = await upload(dentist, patient, png(), jpeg(64, 48));
    const keys = (await env.db.adminPool.query("SELECT f.storage_key AS k, t.storage_key AS tk FROM clinical_files f JOIN clinical_file_thumbs t ON t.file_id = f.id WHERE f.id = $1", [r.body.id])).rows[0];
    referencedOld = keys.k;
    for (const k of [keys.k, keys.tk]) { const p = join(FILES_DIR, ...k.split("/")); utimesSync(p, new Date(0), new Date(0)); }
    // una fila cuyo archivo se perdió
    missingId = (await upload(dentist, patient, png(), null)).body.id;
    const mk = (await env.db.adminPool.query("SELECT storage_key FROM clinical_files WHERE id = $1", [missingId])).rows[0].storage_key;
    unlinkSync(join(FILES_DIR, ...mk.split("/")));
  });

  it("simulación por defecto: informa huérfanos, recientes, ajenos y filas sin archivo; no borra nada", async () => {
    const r = await sweepFiles(env.db.adminPool, store());
    expect(r.mode).toBe("dry-run");
    const o = new Map(r.orphans.map((x) => [x.key, x]));
    expect(o.get(oldOrphan)).toMatchObject({ deletable: true });
    expect(o.get(oldOrphan)!.ageHours).toBeGreaterThanOrEqual(29.9);
    expect(o.get(recentOrphan)).toMatchObject({ deletable: false });
    expect(o.has(referencedOld)).toBe(false);
    expect(r.foreign).toContain("notas-del-tecnico.txt");
    expect(r.missing.some((m) => m.id === missingId && m.table === "clinical_files")).toBe(true);
    expect(r.deleted).toEqual([]);
    expect(existsSync(join(FILES_DIR, ...oldOrphan.split("/")))).toBe(true);
    const text = formatSweepReport(r);
    expect(text).toMatch(/simulación: no se borra nada/);
    expect(text).toMatch(/--apply/);
    expect(text).toMatch(/Filas sin archivo en el almacenamiento: [1-9]/);
  });

  it("con --apply borra solo huérfanos de más de 24 h (no se puede bajar el umbral) y nunca lo referenciado", async () => {
    const r = await sweepFiles(env.db.adminPool, store(), { apply: true, minAgeHours: 1 });
    expect(r.minAgeHours).toBe(24);
    expect(r.deleted).toEqual([oldOrphan]);
    expect(existsSync(join(FILES_DIR, ...oldOrphan.split("/")))).toBe(false);
    expect(existsSync(join(FILES_DIR, ...recentOrphan.split("/")))).toBe(true);
    expect(existsSync(join(FILES_DIR, ...referencedOld.split("/")))).toBe(true);
    expect(existsSync(foreignPath)).toBe(true);
    // todo lo que la base referencia en este almacenamiento sigue ahí (salvo el que ya faltaba)
    const refs = (await env.db.adminPool.query<{ k: string; id: string }>(
      "SELECT storage_key AS k, id FROM clinical_files WHERE clinic_id = $1 UNION ALL SELECT storage_key, file_id FROM clinical_file_thumbs WHERE clinic_id = $1", [K.clinicId])).rows;
    const lost = refs.filter((x) => !existsSync(join(FILES_DIR, ...x.k.split("/"))));
    expect(lost.every((x) => r.missing.some((m) => m.key === x.k))).toBe(true);
    // 25 h después el reciente ya se puede borrar
    const later = await sweepFiles(env.db.adminPool, store(), { apply: true, now: new Date(Date.now() + 25 * 3_600_000) });
    expect(later.deleted).toEqual([recentOrphan]);
  });

  it("comando npm run files:sweep: simulación en JSON y opciones inválidas", () => {
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "server/src/cli/filesSweep.ts", ...args], {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, DENTAL_FILES_DIR: FILES_DIR }, encoding: "utf8", timeout: 60_000,
    });
    const ok = run(["--json"]);
    const report = JSON.parse(ok.stdout);
    expect(report.mode).toBe("dry-run");
    expect(ok.status).toBe(report.missing.length ? 2 : 0);
    const bad = run(["--borrar-todo"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/Uso: files:sweep/);
    expect(run(["--apply", "--dry-run"]).status).toBe(1);
  });
});
