// Almacenamiento S3 compatible (B-081): firma SigV4 con los vectores oficiales de AWS, controlador
// S3 contra un servidor S3 FALSO local (http 127.0.0.1, valida la firma; nunca un proveedor real),
// configuración por variables y la app completa guardando originales y miniaturas en el falso.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRequest, EMPTY_SHA256, payloadSha256, signingKey, signV4, stringToSign } from "../server/src/lib/sigv4.js";
import { loadFilesConfig, newStorageKey, storeFor, LocalFileStore } from "../server/src/lib/filestore.js";
import { S3Error, S3FileStore, type S3Config } from "../server/src/lib/filestore-s3.js";
import { sweepFiles } from "../server/src/modules/clinicalFilesSweep.js";
import { encodePng } from "../server/src/lib/png.js";
import { startFakeS3, type FakeS3 } from "./fake-s3.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Env } from "./helpers.js";

// ---------------- Vectores oficiales ----------------
// Suite de pruebas de AWS Signature Version 4 (awslabs/aws-c-auth, tests/aws-signing-test-suite/v4,
// derivada de la suite publicada por AWS): AKIDEXAMPLE / wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY,
// us-east-1, servicio "service", 2015-08-30T12:36:00Z, host example.amazonaws.com, normalize=true.
const SUITE_CREDS = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const SUITE_SCOPE = { region: "us-east-1", service: "service", amzDate: "20150830T123600Z" };
interface Vector { name: string; method: string; path: string; query?: [string, string][]; headers?: Record<string, string>; body?: string; canonical?: string; sts: string; signature: string }
const SUITE: Vector[] = [
  { name: "get-vanilla", method: "GET", path: "/", sts: "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63", signature: "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    canonical: "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  { name: "get-vanilla-query-order-key-case", method: "GET", path: "/", query: [["Param2", "value2"], ["Param1", "value1"]], sts: "816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0", signature: "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
    canonical: "GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  { name: "get-header-value-trim", method: "GET", path: "/", headers: { "My-Header1": " value1", "My-Header2": ' "a   b   c"' }, sts: "a726db9b0df21c14f559d0a978e563112acb1b9e05476f0a6a1c7d68f28605c7", signature: "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
    canonical: 'GET\n/\n\nhost:example.amazonaws.com\nmy-header1:value1\nmy-header2:"a b c"\nx-amz-date:20150830T123600Z\n\nhost;my-header1;my-header2;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { name: "get-unreserved", method: "GET", path: "/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", sts: "6a968768eefaa713e2a6b16b589a8ea192661f098f37349f4e2c0082757446f9", signature: "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f" },
  { name: "get-utf8", method: "GET", path: "/ሴ", sts: "2a0a97d02205e45ce2e994789806b19270cfbbb0921b278ccf58f5249ac42102", signature: "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85",
    canonical: "GET\n/%E1%88%B4\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  { name: "get-vanilla-utf8-query", method: "GET", path: "/", query: [["ሴ", "bar"]], sts: "eb30c5bed55734080471a834cc727ae56beb50e5f39d1bff6d0d38cb192a7073", signature: "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04" },
  { name: "get-space-normalized", method: "GET", path: "/example space/", sts: "63ee75631ed7234ae61b5f736dfc7754cdccfedbff4b5128a915706ee9390d86", signature: "652487583200325589f1fba4c7e578f72c47cb61beeca81406b39ddec1366741" },
  { name: "get-slash-dot-slash-normalized", method: "GET", path: "/./", sts: "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63", signature: "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31" },
  { name: "post-vanilla-query", method: "POST", path: "/", query: [["Param1", "value1"]], sts: "9d659678c1756bb3113e2ce898845a0a79dbbc57b740555917687f1b3340fbbd", signature: "28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11" },
  { name: "post-header-key-sort", method: "POST", path: "/", headers: { "My-Header1": "value1" }, sts: "9368318c2967cf6de74404b30c65a91e8f6253e0a8659d6d5319f1a812f87d65", signature: "c5410059b04c1ee005303aed430f6e6645f61f4dc9e1461ec8f8916fdf18852c" },
  { name: "post-x-www-form-urlencoded (cuerpo firmado)", method: "POST", path: "/", body: "Param1=value1", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "13" },
    sts: "b1edd1d03544c25390e32085d55b57acc9a3961bb59415ff86c45c3d89d16cfb", signature: "d3875051da38690788ef43de4db0d8f280229d82040bfac253562e56c3f20e0b" },
];

describe("firma AWS SigV4 (vectores oficiales)", () => {
  for (const v of SUITE) {
    it(v.name, () => {
      const payloadHash = v.body ? payloadSha256(v.body) : EMPTY_SHA256;
      const headers: Record<string, string> = { Host: "example.amazonaws.com", ...(v.headers ?? {}), "X-Amz-Date": SUITE_SCOPE.amzDate, ...(v.body ? { "x-amz-content-sha256": payloadHash } : {}) };
      const r = signV4({ method: v.method, path: v.path, query: v.query, headers, payloadHash }, SUITE_SCOPE, SUITE_CREDS, { normalizePath: true });
      if (v.canonical) expect(r.canonicalRequest).toBe(v.canonical);
      expect(r.stringToSign.split("\n")[3]).toBe(v.sts);
      expect(r.signature).toBe(v.signature);
      expect(r.authorization).toBe(`AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=${r.signedHeaders}, Signature=${v.signature}`);
    });
  }

  it("clave derivada: ejemplos de la documentación de AWS", () => {
    expect(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam").toString("hex")).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
    expect(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam").toString("hex")).toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });

  // Ejemplos de la guía de S3 «Signature calculations for the Authorization header: single chunk».
  const S3_CREDS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
  const S3_SCOPE = { region: "us-east-1", service: "s3", amzDate: "20130524T000000Z" };
  const host = "examplebucket.s3.amazonaws.com";
  it("S3: GetObject con Range", () => {
    const r = signV4({ method: "GET", path: "/test.txt", headers: { host, range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": S3_SCOPE.amzDate }, payloadHash: EMPTY_SHA256 }, S3_SCOPE, S3_CREDS);
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
  it("S3: PutObject (la ruta no se normaliza ni codifica dos veces: test$file.text)", () => {
    const body = "Welcome to Amazon S3.";
    const h = payloadSha256(body);
    expect(h).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const r = signV4({ method: "PUT", path: "/test$file.text", headers: { host, date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-date": S3_SCOPE.amzDate, "x-amz-storage-class": "REDUCED_REDUNDANCY", "x-amz-content-sha256": h }, payloadHash: h }, S3_SCOPE, S3_CREDS);
    expect(r.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(r.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });
  it("S3: ListObjects con consulta", () => {
    const r = signV4({ method: "GET", path: "/", query: [["prefix", "J"], ["max-keys", "2"]], headers: { host, "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": S3_SCOPE.amzDate }, payloadHash: EMPTY_SHA256 }, S3_SCOPE, S3_CREDS);
    expect(r.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
  it("rechaza fechas mal formadas y la falta de host", () => {
    expect(() => signV4({ method: "GET", path: "/", headers: { host }, payloadHash: EMPTY_SHA256 }, { ...S3_SCOPE, amzDate: "2013-05-24" }, S3_CREDS)).toThrow(/fecha/);
    expect(() => canonicalRequest({ method: "GET", path: "/", headers: { "x-amz-date": "x" }, payloadHash: EMPTY_SHA256 })).toThrow(/host/);
    expect(stringToSign("x", S3_SCOPE).split("\n")[2]).toBe("20130524/us-east-1/s3/aws4_request");
  });
});

// ---------------- Controlador contra el S3 falso ----------------
let fake: FakeS3;
const CLINIC = "00000000-0000-4000-8000-000000000001";
const s3cfg = (over: Partial<S3Config> = {}): S3Config => ({
  endpoint: fake.url, region: fake.region, bucket: fake.bucket, accessKeyId: fake.accessKeyId, secretAccessKey: fake.secretAccessKey,
  pathStyle: true, sse: "AES256", conditionalPut: true, ...over,
});
const read = async (s: { stream: NodeJS.ReadableStream }) => { const c: Buffer[] = []; for await (const x of s.stream) c.push(x as Buffer); return Buffer.concat(c); };

beforeAll(async () => { fake = await startFakeS3(); });
afterAll(async () => { await fake.close(); });

describe("controlador S3 (servidor falso local)", () => {
  it("sube con cifrado del lado del servidor, lee en streaming, lista y borra", async () => {
    const store = new S3FileStore(s3cfg());
    const key = newStorageKey(CLINIC);
    const data = Buffer.from("radiografía sintética de prueba ".repeat(50));
    await store.put(key, data);
    expect(fake.objects.get(key)?.body.equals(data)).toBe(true);
    expect(fake.objects.get(key)?.sse).toBe("AES256");
    const o = await store.open(key);
    expect(o.size).toBe(data.length);
    expect((await read(o)).equals(data)).toBe(true);
    const listed: string[] = [];
    for await (const x of store.list()) listed.push(x.key);
    expect(listed).toContain(key);
    await store.remove(key);
    expect(fake.objects.has(key)).toBe(false);
    await store.remove(key); // borrar algo que no está no falla
    expect(fake.log.every((l) => l.status < 400)).toBe(true);
  });

  it("nunca sobrescribe (If-None-Match) y un objeto que falta responde 410", async () => {
    const store = new S3FileStore(s3cfg());
    const key = newStorageKey(CLINIC);
    await store.put(key, Buffer.from("uno"));
    await expect(store.put(key, Buffer.from("dos"))).rejects.toThrow(/ya existe/);
    expect(fake.objects.get(key)!.body.toString()).toBe("uno");
    await expect(store.open(newStorageKey(CLINIC))).rejects.toMatchObject({ status: 410, code: "file_missing" });
    await expect(store.put("../../etc/passwd", Buffer.from("x"))).rejects.toThrow(/Clave de almacenamiento inválida/);
  });

  it("firma inválida: clave secreta equivocada o acceso desconocido → error sin filtrar el secreto", async () => {
    const bad = new S3FileStore(s3cfg({ secretAccessKey: "otra-clave-secreta" }));
    const key = newStorageKey(CLINIC);
    const e = await bad.put(key, Buffer.from("x")).catch((x) => x);
    expect(e).toBeInstanceOf(S3Error);
    expect(e).toMatchObject({ status: 403, code: "SignatureDoesNotMatch" });
    expect(String(e.message)).not.toContain("otra-clave-secreta");
    expect(fake.objects.has(key)).toBe(false);
    await expect(new S3FileStore(s3cfg({ accessKeyId: "AKIDOTRA" })).open(key)).rejects.toMatchObject({ code: "InvalidAccessKeyId" });
    // un reloj desfasado también se rechaza (la firma lleva la hora)
    const late = new S3FileStore(s3cfg(), fetch, () => new Date(Date.now() - 3_600_000));
    await expect(late.put(newStorageKey(CLINIC), Buffer.from("x"))).rejects.toMatchObject({ code: "RequestTimeTooSkewed" });
  });

  it("proveedor sin cifrado del lado del servidor: falla claro con AES256 y funciona con sse desactivado", async () => {
    fake.supportsSse = false;
    try {
      await expect(new S3FileStore(s3cfg()).put(newStorageKey(CLINIC), Buffer.from("x"))).rejects.toMatchObject({ status: 501, code: "NotImplemented" });
      const key = newStorageKey(CLINIC);
      await new S3FileStore(s3cfg({ sse: null })).put(key, Buffer.from("sin sse"));
      expect(fake.objects.get(key)!.sse).toBeNull();
    } finally { fake.supportsSse = true; }
  });

  it("listado paginado (ListObjectsV2 con continuation-token)", async () => {
    fake.pageSize = 2;
    try {
      const store = new S3FileStore(s3cfg());
      for (let i = 0; i < 5; i++) await store.put(newStorageKey(CLINIC), Buffer.from(`p${i}`));
      const keys: string[] = [];
      for await (const x of store.list()) keys.push(x.key);
      expect(keys.length).toBe(fake.objects.size);
      expect(new Set(keys).size).toBe(keys.length);
    } finally { fake.pageSize = 1000; }
  });

  it("estilo de host virtual (AWS): bucket en el nombre del host", async () => {
    const seen: string[] = [];
    const spy: typeof fetch = async (input) => { seen.push(String(input)); return new Response(null, { status: 200 }); };
    await new S3FileStore(s3cfg({ endpoint: "https://s3.us-east-1.amazonaws.com", pathStyle: false, region: "us-east-1" }), spy).put(`${CLINIC}/2026/${"a".repeat(32)}`, Buffer.from("x"));
    expect(seen[0]).toBe(`https://${fake.bucket}.s3.us-east-1.amazonaws.com/${CLINIC}/2026/${"a".repeat(32)}`);
  });
});

describe("configuración por variables", () => {
  const base = { DENTAL_S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com", DENTAL_S3_BUCKET: "dentalia-archivos", DENTAL_S3_ACCESS_KEY_ID: "id", DENTAL_S3_SECRET_ACCESS_KEY: "secreto" };
  it("local por defecto; s3 con todo lo necesario; errores claros", () => {
    expect(loadFilesConfig({}, true)).toEqual({ filesDriver: "local", s3: null });
    const r2 = loadFilesConfig({ ...base, DENTAL_FILES_DRIVER: "s3", DENTAL_S3_REGION: "auto" }, true);
    expect(r2).toMatchObject({ filesDriver: "s3", s3: { region: "auto", bucket: "dentalia-archivos", pathStyle: true, sse: "AES256", conditionalPut: true } });
    expect(loadFilesConfig({ ...base, DENTAL_FILES_DRIVER: "s3", DENTAL_S3_SSE: "off", DENTAL_S3_PATH_STYLE: "0", DENTAL_S3_CONDITIONAL_PUT: "0" }, true).s3)
      .toMatchObject({ sse: null, pathStyle: false, conditionalPut: false, region: "us-east-1" });
    expect(() => loadFilesConfig({ DENTAL_FILES_DRIVER: "s3", DENTAL_S3_ENDPOINT: base.DENTAL_S3_ENDPOINT }, true)).toThrow(/DENTAL_S3_BUCKET.*DENTAL_S3_ACCESS_KEY_ID.*DENTAL_S3_SECRET_ACCESS_KEY/);
    expect(() => loadFilesConfig({ ...base, DENTAL_FILES_DRIVER: "s3", DENTAL_S3_ENDPOINT: "http://s3.ejemplo.com" }, true)).toThrow(/https/);
    expect(loadFilesConfig({ ...base, DENTAL_FILES_DRIVER: "s3", DENTAL_S3_ENDPOINT: "http://127.0.0.1:9000" }, true).s3?.endpoint).toBe("http://127.0.0.1:9000");
    expect(() => loadFilesConfig({ DENTAL_FILES_DRIVER: "ftp" }, false)).toThrow(/local.*s3/);
    expect(() => loadFilesConfig({ ...base, DENTAL_FILES_DRIVER: "s3", DENTAL_S3_SSE: "aws:kms" }, false)).toThrow(/AES256/);
  });
  it("cada archivo se lee con el controlador con el que se guardó", () => {
    const local = new LocalFileStore(tmpdir());
    const s3 = new S3FileStore(s3cfg());
    expect(storeFor("local", local, { filesDir: tmpdir() })).toBe(local);
    expect(storeFor("local", s3, { filesDir: tmpdir() }).driver).toBe("local");
    expect(storeFor("s3", local, { filesDir: tmpdir(), s3: s3cfg() }).driver).toBe("s3");
    expect(() => storeFor("s3", local, { filesDir: tmpdir(), s3: null })).toThrow(/ya no está configurado/);
  });
});

// ---------------- La app completa con DENTAL_FILES_DRIVER=s3 ----------------
describe("archivos clínicos guardados en S3 (app completa contra el falso)", () => {
  let env: Env;
  const saved: Record<string, string | undefined> = {};
  const VARS = ["DENTAL_FILES_DRIVER", "DENTAL_S3_ENDPOINT", "DENTAL_S3_REGION", "DENTAL_S3_BUCKET", "DENTAL_S3_ACCESS_KEY_ID", "DENTAL_S3_SECRET_ACCESS_KEY", "DENTAL_FILES_DIR"];
  const dir = mkdtempSync(join(tmpdir(), "dental-s3-app-"));
  beforeAll(async () => {
    for (const k of VARS) saved[k] = process.env[k];
    Object.assign(process.env, {
      DENTAL_FILES_DRIVER: "s3", DENTAL_S3_ENDPOINT: fake.url, DENTAL_S3_REGION: fake.region, DENTAL_S3_BUCKET: fake.bucket,
      DENTAL_S3_ACCESS_KEY_ID: fake.accessKeyId, DENTAL_S3_SECRET_ACCESS_KEY: fake.secretAccessKey, DENTAL_FILES_DIR: dir,
    });
    env = await setupEnv();
  });
  afterAll(async () => {
    await teardown(env);
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(dir, { recursive: true, force: true });
  });

  it("sube original + miniatura al bucket, los entrega y el barrido los ve referenciados", async () => {
    const K = await createClinic(env.db);
    const owner = await login(env.app, K.ownerEmail);
    const dentist = await login(env.app, (await addUser(env.db, K.clinicId, "dentist", { allBranches: true })).email);
    const pid = await createPatient(owner);
    const original = encodePng(64, 48, (x, y) => [x * 3, y * 4, 90]);
    const thumb = encodePng(32, 24, (x, y) => [x * 6, y * 8, 90]);
    const meta = { branchId: K.branches[0], kind: "photo_intraoral", takenOn: new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" }), teeth: [], thumbBytes: thumb.length };
    const before = fake.objects.size;
    const up = await env.app.inject({
      method: "POST", url: `/api/patients/${pid}/clinical-files`, payload: Buffer.concat([original, thumb]),
      headers: { cookie: dentist.cookie, "x-csrf-token": dentist.csrf, "content-type": "application/octet-stream", "x-file-meta": encodeURIComponent(JSON.stringify(meta)) },
    });
    expect(up.statusCode, up.body).toBe(200);
    expect(fake.objects.size).toBe(before + 2);
    const rows = (await env.db.adminPool.query(
      "SELECT f.storage_driver, f.storage_key, t.storage_driver AS td, t.storage_key AS tk FROM clinical_files f JOIN clinical_file_thumbs t ON t.file_id = f.id WHERE f.id = $1", [up.json().id])).rows[0];
    expect(rows).toMatchObject({ storage_driver: "s3", td: "s3" });
    expect(fake.objects.get(rows.storage_key)!.body.equals(original)).toBe(true);
    expect(fake.objects.get(rows.tk)!.body.equals(thumb)).toBe(true);
    expect(fake.objects.get(rows.storage_key)!.sse).toBe("AES256");

    const item = (await dentist.get(`/api/patients/${pid}/clinical-files`)).body.items[0];
    const t = await env.app.inject({ method: "GET", url: item.thumbUrl, headers: { cookie: dentist.cookie } });
    expect(t.statusCode).toBe(200);
    expect(createHash("sha256").update(t.rawPayload).digest("hex")).toBe(createHash("sha256").update(thumb).digest("hex"));
    const link = (await dentist.get(`/api/clinical-files/${item.id}/link?purpose=view`)).body.url;
    const o = await env.app.inject({ method: "GET", url: link, headers: { cookie: dentist.cookie } });
    expect(o.statusCode).toBe(200);
    expect(o.rawPayload.equals(original)).toBe(true);

    // Barrido sobre el bucket: lo referenciado nunca es huérfano; un objeto suelto viejo sí.
    const stray = newStorageKey(K.clinicId);
    fake.objects.set(stray, { body: Buffer.from("subida cortada"), lastModified: new Date(Date.now() - 48 * 3_600_000), sse: "AES256" });
    const r = await sweepFiles(env.db.adminPool, new S3FileStore(s3cfg()), { apply: true });
    expect(r.driver).toBe("s3");
    expect(r.deleted).toEqual([stray]);
    expect(fake.objects.has(rows.storage_key) && fake.objects.has(rows.tk)).toBe(true);
    expect(fake.objects.has(stray)).toBe(false);
  });
});
