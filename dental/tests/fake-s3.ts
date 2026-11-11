// Servidor S3 FALSO para las pruebas (B-081): http en 127.0.0.1, en memoria. Nunca se llama a un
// proveedor real. Verifica la firma SigV4 de cada solicitud con la clave secreta conocida (rechaza
// con 403 SignatureDoesNotMatch como AWS), el SHA-256 del cuerpo declarado y la fecha; implementa
// PutObject (con If-None-Match y cifrado del lado del servidor), GetObject, DeleteObject y
// ListObjectsV2 con prefijo y paginación, y la subida por partes (Create/UploadPart/Complete/Abort).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { EMPTY_SHA256, parseAuthorization, signV4 } from "../server/src/lib/sigv4.js";

export interface FakeObject { body: Buffer; lastModified: Date; sse: string | null }

export interface FakeS3 {
  url: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  objects: Map<string, FakeObject>;
  /** Solicitudes recibidas (método, ruta y si la firma fue válida). */
  log: { method: string; path: string; status: number; sse: string | null }[];
  /** Si es false, responde como un proveedor que no admite x-amz-server-side-encryption. */
  supportsSse: boolean;
  pageSize: number;
  /** Subidas por partes en curso (UploadId → partes). */
  uploads: Map<string, { key: string; parts: Map<number, Buffer>; sse: string | null }>;
  /** Tamaño mínimo de cada parte salvo la última (AWS: 5 MB). */
  minPartSize: number;
  /** Si se define, esa parte responde 500 (para probar la cancelación). */
  failPart: number | null;
  close(): Promise<void>;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const err = (res: ServerResponse, status: number, code: string) => {
  res.writeHead(status, { "content-type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
  return status;
};

export async function startFakeS3(opts: { bucket?: string; accessKeyId?: string; secretAccessKey?: string; region?: string } = {}): Promise<FakeS3> {
  const s3: Omit<FakeS3, "url" | "close"> = {
    bucket: opts.bucket ?? "dental-test", accessKeyId: opts.accessKeyId ?? "AKIDFAKETEST", secretAccessKey: opts.secretAccessKey ?? "secreto/de+prueba/NO-REAL",
    region: opts.region ?? "auto", objects: new Map(), log: [], supportsSse: true, pageSize: 1000,
    uploads: new Map(), minPartSize: 5 * 1024 * 1024, failPart: null,
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<number> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const u = new URL(req.url ?? "/", "http://x");
    const path = decodeURIComponent(u.pathname);
    // --- firma ---
    const auth = parseAuthorization(req.headers.authorization);
    if (!auth || auth.accessKeyId !== s3.accessKeyId) return err(res, 403, "InvalidAccessKeyId");
    const amz = String(req.headers["x-amz-date"] ?? "");
    const declared = String(req.headers["x-amz-content-sha256"] ?? "");
    if (!/^\d{8}T\d{6}Z$/.test(amz) || auth.date !== amz.slice(0, 8)) return err(res, 403, "AuthorizationHeaderMalformed");
    const when = Date.parse(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
    if (Math.abs(Date.now() - when) > 15 * 60_000) return err(res, 403, "RequestTimeTooSkewed");
    for (const h of ["host", "x-amz-date", "x-amz-content-sha256"]) if (!auth.signedHeaders.includes(h)) return err(res, 403, "AccessDenied");
    for (const h of Object.keys(req.headers)) if (h.startsWith("x-amz-") && !auth.signedHeaders.includes(h)) return err(res, 403, "AccessDenied");
    const realHash = body.length ? createHash("sha256").update(body).digest("hex") : EMPTY_SHA256;
    if (declared !== realHash) return err(res, 400, "XAmzContentSHA256Mismatch");
    const headers: Record<string, string> = {};
    for (const h of auth.signedHeaders) headers[h] = String(req.headers[h] ?? "");
    const query = [...u.searchParams.entries()] as [string, string][];
    const expected = signV4({ method: req.method!, path, query, headers, payloadHash: declared },
      { region: auth.region, service: auth.service, amzDate: amz }, { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey });
    if (auth.region !== s3.region || auth.service !== "s3" || expected.signature !== auth.signature) return err(res, 403, "SignatureDoesNotMatch");

    // --- operaciones (estilo de ruta: /bucket/clave) ---
    const prefix = `/${s3.bucket}`;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return err(res, 404, "NoSuchBucket");
    const key = path.slice(prefix.length + 1);
    if (req.method === "GET" && !key) {
      if (u.searchParams.get("list-type") !== "2") return err(res, 400, "InvalidArgument");
      const pfx = u.searchParams.get("prefix") ?? "";
      const all = [...s3.objects.keys()].filter((k) => k.startsWith(pfx)).sort();
      const start = u.searchParams.get("continuation-token") ? Number(Buffer.from(u.searchParams.get("continuation-token")!, "base64url").toString()) : 0;
      const page = all.slice(start, start + s3.pageSize);
      const next = start + s3.pageSize < all.length ? Buffer.from(String(start + s3.pageSize)).toString("base64url") : null;
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${s3.bucket}</Name><KeyCount>${page.length}</KeyCount>`
        + page.map((k) => { const o = s3.objects.get(k)!; return `<Contents><Key>${xml(k)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`; }).join("")
        + `<IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`);
      return 200;
    }
    // --- subida por partes ---
    if (req.method === "POST" && u.searchParams.has("uploads")) {
      const sse = (req.headers["x-amz-server-side-encryption"] as string | undefined) ?? null;
      const id = createHash("sha256").update(`${key}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
      s3.uploads.set(id, { key, parts: new Map(), sse });
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${s3.bucket}</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      return 200;
    }
    const uploadId = u.searchParams.get("uploadId");
    if (uploadId) {
      const up = s3.uploads.get(uploadId);
      if (!up || up.key !== key) return err(res, 404, "NoSuchUpload");
      if (req.method === "PUT") {
        const n = Number(u.searchParams.get("partNumber"));
        if (!Number.isInteger(n) || n < 1 || n > 10_000) return err(res, 400, "InvalidArgument");
        if (s3.failPart === n) return err(res, 500, "InternalError");
        up.parts.set(n, body);
        res.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"` });
        res.end();
        return 200;
      }
      if (req.method === "POST") {
        const listed = [...body.toString().matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag><\/Part>/g)].map((m) => ({ n: Number(m[1]), etag: m[2]!.replace(/&quot;/g, '"') }));
        if (!listed.length) return err(res, 400, "MalformedXML");
        for (let i = 0; i < listed.length; i++) {
          const part = up.parts.get(listed[i]!.n);
          if (!part || `"${createHash("md5").update(part).digest("hex")}"` !== listed[i]!.etag) return err(res, 400, "InvalidPart");
          if (i > 0 && listed[i]!.n <= listed[i - 1]!.n) return err(res, 400, "InvalidPartOrder");
          if (i < listed.length - 1 && part.length < s3.minPartSize) return err(res, 400, "EntityTooSmall");
        }
        if (req.headers["if-none-match"] === "*" && s3.objects.has(key)) return err(res, 412, "PreconditionFailed");
        s3.objects.set(key, { body: Buffer.concat(listed.map((p) => up.parts.get(p.n)!)), lastModified: new Date(), sse: up.sse });
        s3.uploads.delete(uploadId);
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Key>${xml(key)}</Key></CompleteMultipartUploadResult>`);
        return 200;
      }
      if (req.method === "DELETE") {
        s3.uploads.delete(uploadId);
        res.writeHead(204);
        res.end();
        return 204;
      }
    }
    if (req.method === "PUT") {
      const sse = (req.headers["x-amz-server-side-encryption"] as string | undefined) ?? null;
      if (sse && !s3.supportsSse) return err(res, 501, "NotImplemented");
      if (sse && sse !== "AES256") return err(res, 400, "InvalidArgument");
      if (req.headers["if-none-match"] === "*" && s3.objects.has(key)) return err(res, 412, "PreconditionFailed");
      s3.objects.set(key, { body, lastModified: new Date(), sse });
      res.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"`, ...(sse ? { "x-amz-server-side-encryption": sse } : {}) });
      res.end();
      return 200;
    }
    if (req.method === "GET") {
      const o = s3.objects.get(key);
      if (!o) return err(res, 404, "NoSuchKey");
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(o.body.length) });
      res.end(o.body);
      return 200;
    }
    if (req.method === "DELETE") {
      s3.objects.delete(key);
      res.writeHead(204);
      res.end();
      return 204;
    }
    return err(res, 405, "MethodNotAllowed");
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).then(
      (status) => s3.log.push({ method: req.method!, path: req.url!, status, sse: (req.headers["x-amz-server-side-encryption"] as string) ?? null }),
      () => { if (!res.headersSent) err(res, 500, "InternalError"); },
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    ...s3,
    get supportsSse() { return s3.supportsSse; }, set supportsSse(v) { s3.supportsSse = v; },
    get pageSize() { return s3.pageSize; }, set pageSize(v) { s3.pageSize = v; },
    get minPartSize() { return s3.minPartSize; }, set minPartSize(v) { s3.minPartSize = v; },
    get failPart() { return s3.failPart; }, set failPart(v) { s3.failPart = v; },
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
