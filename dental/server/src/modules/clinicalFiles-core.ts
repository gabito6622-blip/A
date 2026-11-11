// Archivos clínicos (B-012): tipos, permisos por tipo, enlaces firmados y lectura del cuerpo binario.
//
// Permisos (reutiliza los de lib/rbac.ts, sin permisos nuevos):
//  * Imágenes clínicas (radiografías, fotos, "otro"): ver con clinical.read; subir con clinical.read +
//    patients.write (odontólogo, asistente y propietario/administrador que atiende); archivar con
//    clinical.write (el profesional).
//  * "Documento escaneado" (no clínico: carnet, formulario del seguro, autorización firmada en papel):
//    ver con patients.read y subir o archivar con patients.write. Así recepción digitaliza papeles
//    sin acceder a radiografías ni fotos clínicas.
//
// Enlaces de corta duración: token HMAC-SHA256 (subclave derivada de DENTAL_LINK_KEY) que fija el
// archivo, la clínica, la persona, el propósito (ver o descargar) y el vencimiento (5 minutos).
// Además se exige la sesión de ESA persona en ESA clínica y se vuelve a comprobar el permiso al
// descargar: un enlace copiado no sirve a otra persona, a otra clínica ni después de 5 minutos.
import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { ringOf, verifyWithAny, type Keys } from "../lib/keys.js";
import type { AuthCtx } from "../lib/rbac.js";

export const FILE_KINDS = ["xray_periapical", "xray_panoramic", "photo_intraoral", "photo_extraoral", "scanned_document", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  xray_periapical: "Radiografía periapical",
  xray_panoramic: "Radiografía panorámica",
  photo_intraoral: "Foto intraoral",
  photo_extraoral: "Foto extraoral",
  scanned_document: "Documento escaneado",
  other: "Otro",
};

const FILE_SLUG: Record<FileKind, string> = {
  xray_periapical: "radiografia-periapical", xray_panoramic: "radiografia-panoramica", photo_intraoral: "foto-intraoral",
  photo_extraoral: "foto-extraoral", scanned_document: "documento-escaneado", other: "archivo",
};

/** Tipos de archivo (por firma) que acepta cada clase. */
export const KIND_MIME: Record<FileKind, string[]> = {
  xray_periapical: ["image/jpeg", "image/png", "image/webp", "application/dicom"],
  xray_panoramic: ["image/jpeg", "image/png", "image/webp", "application/dicom"],
  photo_intraoral: ["image/jpeg", "image/png", "image/webp"],
  photo_extraoral: ["image/jpeg", "image/png", "image/webp"],
  scanned_document: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  other: ["image/jpeg", "image/png", "image/webp", "application/pdf", "application/dicom"],
};

export const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP", "application/pdf": "PDF", "application/dicom": "DICOM",
};

type Perms = Pick<AuthCtx, "permissions">;
export const isClinicalKind = (k: string) => k !== "scanned_document";
export const canViewKind = (a: Perms, k: string) => (isClinicalKind(k) ? a.permissions.has("clinical.read") : a.permissions.has("patients.read"));
export const canUploadKind = (a: Perms, k: string) =>
  a.permissions.has("patients.write") && (isClinicalKind(k) ? a.permissions.has("clinical.read") : true);
export const canArchiveKind = (a: Perms, k: string) => (isClinicalKind(k) ? a.permissions.has("clinical.write") : a.permissions.has("patients.write"));
/** Clases que el rol puede ver (para filtrar listados en SQL). */
export const viewableKinds = (a: Perms): FileKind[] => FILE_KINDS.filter((k) => canViewKind(a, k));

export function downloadName(kind: FileKind, takenOn: string, id: string, ext: string) {
  return `${FILE_SLUG[kind]}-${takenOn}-${id.slice(0, 8)}.${ext}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Nombre original solo para mostrar: sin carpetas ni caracteres de control. */
export function cleanOriginalName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const s = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s || null;
}

// ---------------- Límite de tamaño ----------------
export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.DENTAL_FILES_MAX_MB ?? 15);
  if (!Number.isFinite(mb) || mb <= 0 || mb > 100) throw new Error("DENTAL_FILES_MAX_MB debe ser un número entre 1 y 100");
  return Math.floor(mb * 1024 * 1024);
}
export const fmtMb = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`.replace(".", ",");
export const tooLarge = (max: number) => new AppError(413, "file_too_large", `El archivo supera el límite de ${fmtMb(max)}`);

/**
 * Lee el cuerpo application/octet-stream con un límite propio (mensaje en español). Rechaza antes
 * de leer si no hay sesión o si Content-Length ya excede el límite, para no acumular bytes ajenos.
 */
export function registerBinaryParser(app: FastifyInstance, max: number, shownMax = max) {
  if (app.hasContentTypeParser("application/octet-stream")) return;
  app.addContentTypeParser("application/octet-stream", async (req: FastifyRequest, payload: NodeJS.ReadableStream) => {
    if (!req.auth) throw new AppError(401, "unauthenticated", "Inicia sesión para continuar");
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) throw tooLarge(shownMax);
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const chunk of payload as AsyncIterable<Buffer | string>) {
      const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      n += b.length;
      if (n > max) throw tooLarge(shownMax);
      chunks.push(b);
    }
    return Buffer.concat(chunks, n);
  });
}

// ---------------- Enlaces firmados ----------------
export const LINK_TTL_SECONDS = 300;
/** view: original en el visor; download: adjunto; thumb: miniatura de la galería (sin auditar). */
export type LinkPurpose = "view" | "download" | "thumb";
export interface FileToken { f: string; c: string; u: string; p: LinkPurpose; e: number }

const tokenKey = (secret: Buffer) => createHmac("sha256", secret).update("dentalia:clinical-files:link:v1").digest();
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Firma con la clave vigente del anillo (o con la clave suelta). */
export function signFileToken(secret: Keys, t: Omit<FileToken, "e">, nowMs = Date.now()): { token: string; expiresAt: string } {
  const e = Math.floor(nowMs / 1000) + LINK_TTL_SECONDS;
  const payload = b64(JSON.stringify({ ...t, e }));
  const mac = createHmac("sha256", tokenKey(ringOf(secret).current)).update(payload).digest();
  return { token: `${payload}.${b64(mac)}`, expiresAt: new Date(e * 1000).toISOString() };
}

/** Verifica con la clave vigente o con la anterior (rotación de DENTAL_LINK_KEY). */
export function verifyFileToken(secret: Keys, token: string, nowMs = Date.now()): { ok: true; t: FileToken } | { ok: false; reason: "invalid" | "expired" } {
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return { ok: false, reason: "invalid" };
  const got = Buffer.from(mac, "base64url");
  if (!verifyWithAny(secret, (k) => createHmac("sha256", tokenKey(k)).update(payload).digest(), got)) return { ok: false, reason: "invalid" };
  let t: FileToken;
  try { t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "invalid" }; }
  if (!t || typeof t.f !== "string" || typeof t.c !== "string" || typeof t.u !== "string" || typeof t.e !== "number" || (t.p !== "view" && t.p !== "download" && t.p !== "thumb")) {
    return { ok: false, reason: "invalid" };
  }
  if (Math.floor(nowMs / 1000) >= t.e) return { ok: false, reason: "expired" };
  return { ok: true, t };
}

export const contentUrl = (id: string, token: string) => `/api/clinical-files/${id}/content?t=${encodeURIComponent(token)}`;
export const thumbUrl = (id: string, token: string) => `/api/clinical-files/${id}/thumb?t=${encodeURIComponent(token)}`;

// ---------------- Miniaturas (B-081) ----------------
/** Tamaño máximo de una miniatura (la del navegador pesa ~10-40 KB). */
export const THUMB_MAX_BYTES = 100 * 1024;
/** Lado máximo de una miniatura (el navegador la genera a 320 px). */
export const THUMB_MAX_SIDE = 400;
export const THUMB_MIME = ["image/jpeg", "image/webp", "image/png"] as const;
