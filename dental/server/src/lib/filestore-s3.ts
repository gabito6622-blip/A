// Controlador S3 compatible para FileStore (B-081): AWS S3, Cloudflare R2, Backblaze B2 y MinIO.
//
// Implementado con `fetch` y la firma SigV4 propia de lib/sigv4.ts (sin SDK ni paquetes nuevos):
//   put    = PutObject (If-None-Match: * para no sobrescribir nunca; cifrado del lado del servidor
//            x-amz-server-side-encryption: AES256 cuando el proveedor lo admite)
//   open   = GetObject en streaming (404 → 410 «ya no está en el almacenamiento»)
//   remove = DeleteObject
//   list   = ListObjectsV2 paginado (lo usa el barrido de huérfanos)
// Cada solicitud firma host, x-amz-date, x-amz-content-sha256 (SHA-256 real del cuerpo) y los
// encabezados x-amz-* que se envían. El error del proveedor se registra solo con su código (nunca la
// clave secreta ni el contenido).
import { Readable } from "node:stream";
import { AppError } from "./errors.js";
import { amzDate, EMPTY_SHA256, payloadSha256, signV4, uriEncode } from "./sigv4.js";
import { assertStorageKey, type FileStore, type StoredObject } from "./filestore.js";

export interface S3Config {
  /** https://<cuenta>.r2.cloudflarestorage.com, https://s3.us-west-004.backblazeb2.com, https://s3.us-east-1.amazonaws.com… */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true: https://endpoint/bucket/clave (R2, B2, MinIO). false: https://bucket.endpoint/clave (AWS). */
  pathStyle: boolean;
  /** Cifrado del lado del servidor solicitado en cada subida ("AES256") o null si el proveedor no lo admite. */
  sse: "AES256" | null;
  /** Enviar If-None-Match: * al subir (AWS, R2 y MinIO lo admiten). */
  conditionalPut: boolean;
  /** Tiempo máximo por solicitud (ms). */
  timeoutMs?: number;
}

export class S3Error extends Error {
  constructor(readonly status: number, readonly code: string, op: string) {
    super(`Almacenamiento S3: ${op} falló (${status} ${code})`);
  }
}

const xmlText = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]!) : null;
};
const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/**
 * Cliente S3 genérico (PutObject, GetObject, DeleteObject y ListObjectsV2 con prefijo) firmado con
 * SigV4. Lo usan los archivos clínicos (S3FileStore, claves validadas) y los respaldos
 * (modules/ops, bajo su propio prefijo o bucket).
 */
export class S3ObjectClient {
  private readonly base: URL;

  constructor(readonly cfg: S3Config, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {
    this.base = new URL(cfg.endpoint);
    if (!/^https?:$/.test(this.base.protocol)) throw new Error("DENTAL_S3_ENDPOINT debe empezar con https://");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket)) throw new Error("DENTAL_S3_BUCKET no es un nombre de bucket válido");
  }

  /** URL y ruta canónica (sin codificar) del objeto o del bucket. */
  private target(key: string | null, query: [string, string][] = []): { url: URL; path: string } {
    const basePath = this.base.pathname.replace(/\/+$/, "");
    const objectPath = key ? `/${key}` : "/";
    const path = this.cfg.pathStyle ? `${basePath}/${this.cfg.bucket}${key ? objectPath : ""}` || "/" : `${basePath}${objectPath}`;
    const url = new URL(this.base.toString());
    if (!this.cfg.pathStyle) url.hostname = `${this.cfg.bucket}.${this.base.hostname}`;
    url.pathname = uriEncode(path, false);
    url.search = query.length ? query.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&") : "";
    return { url, path };
  }

  async send(op: string, method: string, key: string | null, opts: { body?: Buffer; query?: [string, string][]; headers?: Record<string, string>; timeoutMs?: number } = {}) {
    const { url, path } = this.target(key, opts.query);
    const payloadHash = opts.body ? payloadSha256(opts.body) : EMPTY_SHA256;
    const date = amzDate(this.now());
    const headers: Record<string, string> = { host: url.host, "x-amz-date": date, "x-amz-content-sha256": payloadHash, ...(opts.headers ?? {}) };
    const sig = signV4({ method, path, query: opts.query, headers, payloadHash }, { region: this.cfg.region, service: "s3", amzDate: date },
      { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey });
    const { host: _host, ...sendHeaders } = headers; // fetch fija Host a partir de la URL (el mismo valor firmado)
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method, headers: { ...sendHeaders, authorization: sig.authorization }, body: opts.body ? new Uint8Array(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.cfg.timeoutMs ?? 30_000), redirect: "manual",
      });
    } catch (e) {
      throw new S3Error(0, (e as Error).name === "TimeoutError" ? "Timeout" : "NetworkError", op);
    }
    return res;
  }

  async fail(op: string, res: Response): Promise<never> {
    const text = await res.text().catch(() => "");
    throw new S3Error(res.status, xmlText(text, "Code") ?? "Unknown", op);
  }

  /** Sube un objeto. Con `ifNoneMatch` nunca sobrescribe (412 → error «ya existe»). */
  async putObject(key: string, data: Buffer, opts: { ifNoneMatch?: boolean; contentType?: string } = {}): Promise<void> {
    const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/octet-stream" };
    if (this.cfg.sse) headers["x-amz-server-side-encryption"] = this.cfg.sse;
    if (opts.ifNoneMatch && this.cfg.conditionalPut) headers["if-none-match"] = "*";
    const res = await this.send("subir", "PUT", key, { body: data, headers });
    if (res.status === 412) { await res.body?.cancel(); throw new Error("La clave de almacenamiento ya existe"); }
    if (!res.ok) await this.fail("subir", res);
    await res.body?.cancel();
  }

  // ---------------- Subida por partes (B-101: respaldos de más de 4,5 GB) ----------------
  /** CreateMultipartUpload: devuelve el UploadId. */
  async createMultipartUpload(key: string, opts: { contentType?: string } = {}): Promise<string> {
    const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/octet-stream" };
    if (this.cfg.sse) headers["x-amz-server-side-encryption"] = this.cfg.sse;
    const res = await this.send("iniciar subida por partes", "POST", key, { query: [["uploads", ""]], headers });
    if (!res.ok) await this.fail("iniciar subida por partes", res);
    const id = xmlText(await res.text(), "UploadId");
    if (!id) throw new S3Error(res.status, "NoUploadId", "iniciar subida por partes");
    return id;
  }

  /** UploadPart: devuelve el ETag de la parte (hace falta para completar). */
  async uploadPart(key: string, uploadId: string, partNumber: number, data: Buffer, timeoutMs = 300_000): Promise<string> {
    const res = await this.send("subir parte", "PUT", key, { body: data, query: [["partNumber", String(partNumber)], ["uploadId", uploadId]], timeoutMs });
    if (!res.ok) await this.fail("subir parte", res);
    await res.body?.cancel();
    const etag = res.headers.get("etag");
    if (!etag) throw new S3Error(res.status, "NoETag", "subir parte");
    return etag;
  }

  /** CompleteMultipartUpload. Con `ifNoneMatch` (si el proveedor lo admite) nunca sobrescribe. */
  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[], opts: { ifNoneMatch?: boolean } = {}): Promise<void> {
    const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${parts
      .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}</ETag></Part>`).join("")}</CompleteMultipartUpload>`);
    const headers: Record<string, string> = { "content-type": "application/xml" };
    if (opts.ifNoneMatch && this.cfg.conditionalPut) headers["if-none-match"] = "*";
    const res = await this.send("completar subida por partes", "POST", key, { body, query: [["uploadId", uploadId]], headers, timeoutMs: 300_000 });
    if (res.status === 412) { await res.body?.cancel(); throw new Error("La clave de almacenamiento ya existe"); }
    // S3 puede responder 200 con un <Error> en el cuerpo si la unión falla al final.
    const text = await res.text().catch(() => "");
    if (!res.ok || /<Error>/.test(text)) throw new S3Error(res.status, xmlText(text, "Code") ?? "Unknown", "completar subida por partes");
  }

  /** AbortMultipartUpload: libera las partes ya subidas (si falla, el proveedor las limpia con su regla de ciclo de vida). */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const res = await this.send("cancelar subida por partes", "DELETE", key, { query: [["uploadId", uploadId]] }).catch(() => null);
    await res?.body?.cancel();
  }

  /** GetObject en streaming; null si no existe (404). */
  async getObject(key: string): Promise<{ stream: Readable; size: number } | null> {
    const res = await this.send("leer", "GET", key);
    if (res.status === 404) { await res.body?.cancel(); return null; }
    if (!res.ok || !res.body) await this.fail("leer", res);
    const size = Number(res.headers.get("content-length"));
    return { stream: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>), size: Number.isFinite(size) ? size : 0 };
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.send("borrar", "DELETE", key);
    await res.body?.cancel();
    if (!res.ok && res.status !== 404) throw new S3Error(res.status, "DeleteFailed", "borrar");
  }

  /** ListObjectsV2 paginado, opcionalmente solo bajo `prefix`. */
  async *listObjects(prefix?: string): AsyncIterable<StoredObject> {
    let token: string | null = null;
    for (let page = 0; page < 100_000; page++) {
      const query: [string, string][] = [["list-type", "2"], ["max-keys", "1000"]];
      if (prefix) query.push(["prefix", prefix]);
      if (token) query.push(["continuation-token", token]);
      const res = await this.send("listar", "GET", null, { query });
      if (!res.ok) await this.fail("listar", res);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = xmlText(m[1]!, "Key");
        if (!key) continue;
        yield { key, size: Number(xmlText(m[1]!, "Size") ?? 0), modifiedAt: new Date(xmlText(m[1]!, "LastModified") ?? 0) };
      }
      token = xmlText(xml, "IsTruncated") === "true" ? xmlText(xml, "NextContinuationToken") : null;
      if (!token) return;
    }
  }
}

export class S3FileStore implements FileStore {
  readonly driver = "s3" as const;
  private readonly client: S3ObjectClient;

  constructor(readonly cfg: S3Config, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()) {
    this.client = new S3ObjectClient(cfg, fetchImpl, now);
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertStorageKey(key);
    await this.client.putObject(key, data, { ifNoneMatch: true });
  }

  async open(key: string): Promise<{ stream: Readable; size: number }> {
    assertStorageKey(key);
    const o = await this.client.getObject(key);
    if (!o) throw new AppError(410, "file_missing", "El archivo ya no está en el almacenamiento. Avisa a administración para restaurarlo desde el respaldo.");
    return o;
  }

  async remove(key: string): Promise<void> {
    assertStorageKey(key);
    await this.client.deleteObject(key);
  }

  list(): AsyncIterable<StoredObject> {
    return this.client.listObjects();
  }
}
