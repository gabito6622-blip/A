// Firma AWS Signature Version 4 (encabezado Authorization), sin SDK.
//
// Implementa lo que necesita un almacenamiento S3 compatible (AWS S3, Cloudflare R2, Backblaze B2,
// MinIO) y está probada con los vectores oficiales de AWS (tests/files-s3.test.ts):
//   1. solicitud canónica: método, ruta codificada, consulta ordenada, encabezados en minúsculas
//      con espacios compactados, lista de encabezados firmados y hash del cuerpo;
//   2. texto a firmar: algoritmo, fecha, alcance (fecha/región/servicio/aws4_request) y hash (1);
//   3. clave derivada: HMAC encadenado "AWS4"+secreto → fecha → región → servicio → aws4_request;
//   4. firma = HMAC(clave, texto) en hexadecimal.
// S3 no normaliza la ruta ni la codifica dos veces (normalizePath: false); el resto de los servicios
// de AWS sí normaliza los segmentos "." y "..".
import { createHash, createHmac } from "node:crypto";

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const ALGORITHM = "AWS4-HMAC-SHA256";

export interface SigV4Credentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string | null }

export interface SigV4Request {
  method: string;
  /** Ruta SIN codificar (p. ej. "/bucket/clínica/a b"). */
  path: string;
  /** Parámetros de consulta sin codificar, en cualquier orden (pueden repetirse). */
  query?: [string, string][];
  /** Encabezados a firmar (se incluyen todos los que se pasen; "host" es obligatorio). */
  headers: Record<string, string>;
  /** SHA-256 hexadecimal del cuerpo (EMPTY_SHA256 sin cuerpo) o "UNSIGNED-PAYLOAD". */
  payloadHash: string;
}

export interface SigV4Scope { region: string; service: string; /** YYYYMMDDTHHMMSSZ */ amzDate: string }

const sha256hex = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** Codificación RFC 3986 que exige SigV4 (no deja sin codificar ! ' ( ) *). */
export function uriEncode(s: string, encodeSlash = true): string {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += ch;
    else for (const b of Buffer.from(ch, "utf8")) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function canonicalPath(path: string, normalizePath: boolean): string {
  let p = path || "/";
  if (normalizePath) {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    p = `/${out.join("/")}${out.length && /\/\.?$/.test(path) ? "/" : ""}`;
  }
  return uriEncode(p, false);
}

export function canonicalQuery(query: [string, string][] = []): string {
  return query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function canonicalHeaders(headers: Record<string, string>) {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase().trim();
    const val = String(v).trim().replace(/\s+/g, " ");
    m.set(name, m.has(name) ? `${m.get(name)},${val}` : val);
  }
  const names = [...m.keys()].sort();
  return { text: names.map((n) => `${n}:${m.get(n)}\n`).join(""), signed: names.join(";") };
}

export function canonicalRequest(r: SigV4Request, normalizePath = false): { text: string; signedHeaders: string } {
  const h = canonicalHeaders(r.headers);
  if (!h.signed.split(";").includes("host")) throw new Error("SigV4: falta el encabezado host");
  return {
    text: [r.method.toUpperCase(), canonicalPath(r.path, normalizePath), canonicalQuery(r.query), h.text, h.signed, r.payloadHash].join("\n"),
    signedHeaders: h.signed,
  };
}

export const credentialScope = (s: SigV4Scope) => `${s.amzDate.slice(0, 8)}/${s.region}/${s.service}/aws4_request`;

export function stringToSign(canonical: string, s: SigV4Scope): string {
  return [ALGORITHM, s.amzDate, credentialScope(s), sha256hex(canonical)].join("\n");
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

export interface SigV4Result { authorization: string; signature: string; canonicalRequest: string; stringToSign: string; signedHeaders: string }

export function signV4(r: SigV4Request, scope: SigV4Scope, creds: SigV4Credentials, opts: { normalizePath?: boolean } = {}): SigV4Result {
  if (!/^\d{8}T\d{6}Z$/.test(scope.amzDate)) throw new Error("SigV4: fecha inválida (YYYYMMDDTHHMMSSZ)");
  const cr = canonicalRequest(r, opts.normalizePath ?? false);
  const sts = stringToSign(cr.text, scope);
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, scope.amzDate.slice(0, 8), scope.region, scope.service)).update(sts, "utf8").digest("hex");
  return {
    authorization: `${ALGORITHM} Credential=${creds.accessKeyId}/${credentialScope(scope)}, SignedHeaders=${cr.signedHeaders}, Signature=${signature}`,
    signature, canonicalRequest: cr.text, stringToSign: sts, signedHeaders: cr.signedHeaders,
  };
}

/** 2026-11-11T10:20:30.123Z → 20261111T102030Z */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export const payloadSha256 = (b: Buffer | string) => sha256hex(b);

/** Interpreta un encabezado Authorization SigV4 (lo usa el servidor S3 falso de las pruebas). */
export function parseAuthorization(h: string | undefined): { accessKeyId: string; date: string; region: string; service: string; signedHeaders: string[]; signature: string } | null {
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(h ?? "");
  if (!m) return null;
  return { accessKeyId: m[1]!, date: m[2]!, region: m[3]!, service: m[4]!, signedHeaders: m[5]!.split(";"), signature: m[6]! };
}
