// Logo de la clínica (B-096).
//
//  * Lo sube owner/admin desde Configuración › Clínica. El navegador lo reescala a 512 px como
//    máximo y lo convierte a PNG. El servidor exige PNG o JPEG por firma de bytes, de 16 a 512 px
//    por lado y hasta 300 KB.
//  * Los bytes van al almacenamiento privado (disco o S3) con clave aleatoria bajo el prefijo de la
//    clínica, separados de los archivos de pacientes por su propia tabla (clinic_logos).
//  * El historial es de solo inserción: el logo vigente es la última fila; quitarlo es otra fila.
//  * Se muestra en la barra lateral, en los PDF nuevos (los ya emitidos no cambian) y en el portal.
import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import type { Client } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { createFileStore, imageDimensions, newStorageKey, sniffType, storeFor, type FileStore } from "../lib/filestore.js";
import type { Route } from "../lib/http.js";

export const LOGO_MAX_BYTES = 300 * 1024;
export const LOGO_MIN_SIDE = 16;
export const LOGO_MAX_SIDE = 512;
const LOGO_MIME = ["image/png", "image/jpeg"];

interface LogoRow { id: string; removed: boolean; mime_type: string | null; width: number | null; height: number | null; sha256: string | null; storage_driver: string | null; storage_key: string | null }

/** Logo vigente de la clínica del contexto (RLS) o null. */
export async function currentLogo(c: Client): Promise<LogoRow | null> {
  const r = (await c.query<LogoRow>(
    "SELECT id, removed, mime_type, width, height, sha256, storage_driver, storage_key FROM clinic_logos ORDER BY created_at DESC, id DESC LIMIT 1")).rows[0];
  return r && !r.removed ? r : null;
}

/** Versión corta para las URLs (cambia con cada logo nuevo; sirve para la caché del navegador). */
export const logoVersion = (r: LogoRow | null) => (r?.sha256 ? r.sha256.slice(0, 12) : null);

// Los PDF se generan en módulos que no reciben el almacenamiento: se registra una sola vez al
// armar las rutas (y las pruebas que arman la app también lo registran).
let registered: { store: FileStore; cfg: Config } | null = null;

async function readBytes(row: LogoRow): Promise<Buffer | null> {
  if (!registered || !row.storage_key || !row.storage_driver) return null;
  const { stream } = await storeFor(row.storage_driver, registered.store, registered.cfg).open(row.storage_key);
  const chunks: Buffer[] = [];
  for await (const ch of stream) chunks.push(ch as Buffer);
  return Buffer.concat(chunks);
}

/** Bytes del logo vigente para el membrete de un PDF; null si no hay o no se puede leer (el PDF sale sin logo). */
export async function logoForPdf(c: Client): Promise<Buffer | null> {
  try {
    const row = await currentLogo(c);
    return row ? await readBytes(row) : null;
  } catch {
    return null;
  }
}

function validateLogo(b: Buffer): { mime: string; width: number; height: number } {
  if (b.length === 0) throw badRequest("El archivo está vacío");
  if (b.length > LOGO_MAX_BYTES) throw new AppError(413, "logo_too_large", `El logo supera el límite de ${LOGO_MAX_BYTES / 1024} KB`);
  const mime = sniffType(b);
  if (!mime || !LOGO_MIME.includes(mime)) throw new AppError(415, "logo_type_not_allowed", "El logo debe ser una imagen PNG o JPG");
  const dim = imageDimensions(b);
  if (!dim) throw new AppError(415, "logo_type_not_allowed", "No se pudo leer el tamaño de la imagen");
  if (dim.width < LOGO_MIN_SIDE || dim.height < LOGO_MIN_SIDE || dim.width > LOGO_MAX_SIDE || dim.height > LOGO_MAX_SIDE) {
    throw badRequest(`El logo mide ${dim.width}×${dim.height} px: debe medir entre ${LOGO_MIN_SIDE} y ${LOGO_MAX_SIDE} px por lado`);
  }
  return { mime, ...dim };
}

/** Cabeceras y bytes del logo (misma política que las miniaturas: sin ejecutar nada). El handler devuelve los bytes. */
function sendLogo(reply: any, row: LogoRow, bytes: Buffer, cache: string) {
  reply
    .header("content-type", row.mime_type)
    .header("content-length", String(bytes.length))
    .header("content-disposition", "inline")
    .header("cache-control", cache)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    .header("cross-origin-resource-policy", "same-origin");
  return bytes;
}

export function clinicLogoRoutes(route: Route, cfg: Config, store: FileStore = createFileStore(cfg)) {
  registered = { store, cfg };

  route({
    method: "GET", url: "/api/clinic/logo-info", summary: "Logo vigente de la clínica (versión y tamaño) o null", tags: ["clínica"],
    handler: async ({ c }) => {
      const r = await currentLogo(c);
      return r ? { version: logoVersion(r), width: r.width, height: r.height, mimeType: r.mime_type } : null;
    },
  });

  route({
    method: "GET", url: "/api/clinic/logo", summary: "Imagen del logo de la clínica (para la barra lateral)", tags: ["clínica"],
    handler: async ({ c, reply }) => {
      const r = await currentLogo(c);
      if (!r) throw notFound("Logo");
      const bytes = await readBytes(r);
      if (!bytes) throw notFound("Logo");
      // La URL lleva ?v=<versión>: se puede guardar en caché (privada) sin ver un logo viejo.
      return sendLogo(reply, r, bytes, "private, max-age=86400");
    },
  });

  route({
    method: "POST", url: "/api/clinic/logo",
    summary: "Subir el logo de la clínica (cuerpo application/octet-stream; PNG o JPG de 16 a 512 px por lado, hasta 300 KB, verificado por firma de bytes)",
    tags: ["clínica"], perm: "clinic.manage", limit: { max: 20, timeWindow: "1 minute" },
    handler: async ({ c, auth, req }) => {
      const body = req.body;
      if (!Buffer.isBuffer(body)) throw new AppError(415, "unsupported_media_type", "Envía la imagen como application/octet-stream");
      const v = validateLogo(body);
      const sha256 = createHash("sha256").update(body).digest("hex");
      const key = newStorageKey(auth.clinicId!);
      await store.put(key, body);
      try {
        await c.query(
          `INSERT INTO clinic_logos (clinic_id, mime_type, width, height, size_bytes, sha256, storage_driver, storage_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [auth.clinicId, v.mime, v.width, v.height, body.length, sha256, store.driver, key, auth.userId]);
        await audit(c, auth, "clinic.logo_set", "clinic", auth.clinicId, { mimeType: v.mime, width: v.width, height: v.height, sizeBytes: body.length, sha256 });
      } catch (e) {
        await store.remove(key).catch(() => {});
        throw e;
      }
      return { version: sha256.slice(0, 12), width: v.width, height: v.height, mimeType: v.mime };
    },
  });

  route({
    method: "POST", url: "/api/clinic/logo/remove", summary: "Quitar el logo de la clínica (queda en el historial)", tags: ["clínica"], perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      if (!(await currentLogo(c))) return { ok: true, removed: false };
      await c.query("INSERT INTO clinic_logos (clinic_id, removed, created_by) VALUES ($1, true, $2)", [auth.clinicId, auth.userId]);
      await audit(c, auth, "clinic.logo_removed", "clinic", auth.clinicId);
      return { ok: true, removed: true };
    },
  });
}

/** Para el portal del paciente (sin sesión): bytes del logo vigente de la clínica ya fijada por RLS. */
export async function portalLogo(c: Client): Promise<{ row: LogoRow; bytes: Buffer } | null> {
  const row = await currentLogo(c);
  if (!row) return null;
  const bytes = await readBytes(row);
  return bytes ? { row, bytes } : null;
}
export { sendLogo };
