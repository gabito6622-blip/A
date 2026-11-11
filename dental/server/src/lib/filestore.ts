// Almacenamiento privado de archivos clínicos (B-012).
//
// La API nunca arma rutas con datos del usuario: cada archivo se guarda bajo una clave
// aleatoria `<clinic_id>/<año>/<32 hex>` generada aquí. El controlador local escribe en
// DENTAL_FILES_DIR (por defecto ./data/files, fuera de web/dist y de cualquier carpeta
// servida como estática), con permisos 0600/0700 y escritura atómica (temporal + rename).
//
// El controlador S3 compatible (AWS S3, Cloudflare R2, Backblaze B2, MinIO) está en
// lib/filestore-s3.ts y se elige con DENTAL_FILES_DRIVER=s3 (ver loadFilesConfig). La base guarda
// `storage_driver` por archivo, así que pueden convivir archivos antiguos en disco y nuevos en S3:
// storeFor() abre cada archivo con el controlador con el que se guardó.
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { AppError } from "./errors.js";
import { S3FileStore, type S3Config } from "./filestore-s3.js";

export type StorageDriver = "local" | "s3";

/** Objeto del almacenamiento (para el barrido de huérfanos). */
export interface StoredObject { key: string; size: number; modifiedAt: Date }

export interface FileStore {
  readonly driver: StorageDriver;
  /** Guarda los bytes bajo `key`. Falla si la clave ya existe (nunca sobrescribe). */
  put(key: string, data: Buffer): Promise<void>;
  /** Abre el archivo para enviarlo en streaming. Lanza 410 si ya no está en el almacenamiento. */
  open(key: string): Promise<{ stream: Readable; size: number }>;
  /** Solo para deshacer una subida cuya transacción falló (archivar NO borra). */
  remove(key: string): Promise<void>;
  /** Recorre todo lo guardado (claves con "/" aunque el disco use carpetas). */
  list(): AsyncIterable<StoredObject>;
}

export const KEY_RE = /^[0-9a-f-]{36}\/[0-9]{4}\/[0-9a-f]{32}$/;
export function assertStorageKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error("Clave de almacenamiento inválida");
}

/** Clave nueva, aleatoria (128 bits), con el prefijo de la clínica. */
export function newStorageKey(clinicId: string, now = new Date()): string {
  if (!/^[0-9a-f-]{36}$/.test(clinicId)) throw new Error("clinicId inválido para la clave de almacenamiento");
  return `${clinicId}/${now.getUTCFullYear()}/${randomBytes(16).toString("hex")}`;
}

export class LocalFileStore implements FileStore {
  readonly driver = "local" as const;
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertStorageKey(key);
    const p = resolve(join(this.root, ...key.split("/")));
    if (!p.startsWith(this.root + sep)) throw new Error("Clave de almacenamiento fuera de la carpeta");
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, data, { flag: "wx", mode: 0o600 });
      // La clave es aleatoria; aun así, nunca se reemplaza un archivo existente.
      const exists = await stat(p).then(() => true, () => false);
      if (exists) throw new Error("La clave de almacenamiento ya existe");
      await rename(tmp, p);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }

  async open(key: string): Promise<{ stream: Readable; size: number }> {
    const p = this.pathFor(key);
    let fh;
    try {
      fh = await open(p, "r");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new AppError(410, "file_missing", "El archivo ya no está en el almacenamiento. Avisa a administración para restaurarlo desde el respaldo.");
      throw e;
    }
    const { size } = await fh.stat();
    return { stream: createReadStream("", { fd: fh, autoClose: true }), size };
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async *list(): AsyncIterable<StoredObject> {
    const walk = async function* (root: string, dir: string): AsyncIterable<StoredObject> {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) yield* walk(root, p);
        else if (e.isFile()) {
          const st = await stat(p);
          yield { key: relative(root, p).split(sep).join("/"), size: st.size, modifiedAt: st.mtime };
        }
      }
    };
    yield* walk(this.root, this.root);
  }
}

// ---------------- Configuración y elección del controlador ----------------
export interface FilesConfig { filesDir: string; filesDriver?: StorageDriver; s3?: S3Config | null }

/**
 * Lee la configuración del almacenamiento desde variables de entorno:
 *   DENTAL_FILES_DRIVER=local|s3 (local por defecto; DENTAL_FILES_DIR para el disco)
 *   DENTAL_S3_ENDPOINT, DENTAL_S3_REGION (auto en R2), DENTAL_S3_BUCKET,
 *   DENTAL_S3_ACCESS_KEY_ID, DENTAL_S3_SECRET_ACCESS_KEY,
 *   DENTAL_S3_PATH_STYLE=1|0 (1 por defecto), DENTAL_S3_SSE=AES256|off (AES256 por defecto),
 *   DENTAL_S3_CONDITIONAL_PUT=1|0 (1 por defecto).
 */
export function loadFilesConfig(env: NodeJS.ProcessEnv, isProduction: boolean): { filesDriver: StorageDriver; s3: S3Config | null } {
  const driver = (env.DENTAL_FILES_DRIVER ?? "local").trim().toLowerCase();
  if (driver !== "local" && driver !== "s3") throw new Error("DENTAL_FILES_DRIVER debe ser «local» o «s3»");
  const anyS3 = !!(env.DENTAL_S3_ENDPOINT || env.DENTAL_S3_BUCKET);
  if (driver === "local" && !anyS3) return { filesDriver: "local", s3: null };
  const missing = ["DENTAL_S3_ENDPOINT", "DENTAL_S3_BUCKET", "DENTAL_S3_ACCESS_KEY_ID", "DENTAL_S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
  if (missing.length) {
    if (driver === "local") return { filesDriver: "local", s3: null }; // configuración S3 a medias sin usarla
    throw new Error(`Faltan variables para el almacenamiento S3: ${missing.join(", ")}`);
  }
  const endpoint = env.DENTAL_S3_ENDPOINT!.trim().replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("DENTAL_S3_ENDPOINT no es una URL válida"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (local || !isProduction))) throw new Error("DENTAL_S3_ENDPOINT debe usar https:// en producción");
  const flag = (v: string | undefined, def: boolean) => (v == null || v === "" ? def : !["0", "false", "no", "off"].includes(v.trim().toLowerCase()));
  const sse = (env.DENTAL_S3_SSE ?? "AES256").trim();
  if (!["AES256", "off", "none", ""].includes(sse)) throw new Error("DENTAL_S3_SSE debe ser «AES256» u «off»");
  return {
    filesDriver: driver,
    s3: {
      endpoint, region: (env.DENTAL_S3_REGION ?? "us-east-1").trim() || "us-east-1", bucket: env.DENTAL_S3_BUCKET!.trim(),
      accessKeyId: env.DENTAL_S3_ACCESS_KEY_ID!.trim(), secretAccessKey: env.DENTAL_S3_SECRET_ACCESS_KEY!,
      pathStyle: flag(env.DENTAL_S3_PATH_STYLE, true), sse: sse === "AES256" ? "AES256" : null, conditionalPut: flag(env.DENTAL_S3_CONDITIONAL_PUT, true),
    },
  };
}

/** Controlador para los archivos NUEVOS. */
export function createFileStore(cfg: FilesConfig): FileStore {
  if ((cfg.filesDriver ?? "local") === "s3") {
    if (!cfg.s3) throw new Error("DENTAL_FILES_DRIVER=s3 sin configuración S3");
    return new S3FileStore(cfg.s3);
  }
  return new LocalFileStore(cfg.filesDir);
}

/**
 * Controlador con el que se guardó un archivo (puede no ser el actual: al pasar a S3, los
 * archivos antiguos siguen en el disco y se leen de ahí).
 */
export function storeFor(driver: string, primary: FileStore, cfg: FilesConfig): FileStore {
  if (driver === primary.driver) return primary;
  if (driver === "local") return new LocalFileStore(cfg.filesDir);
  if (driver === "s3" && cfg.s3) return new S3FileStore(cfg.s3);
  throw new AppError(410, "file_missing", "El archivo está en un almacenamiento que ya no está configurado. Avisa a administración.");
}

// ---------------- Detección del tipo por firma de bytes ----------------
export type DetectedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "application/dicom";

/** Tipo real según los primeros bytes (nunca según la extensión ni el Content-Type del cliente). */
export function sniffType(b: Buffer): DetectedType | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 16 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" && b.toString("latin1", 12, 15) === "VP8") return "image/webp";
  if (b.length >= 8 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 132 && b.toString("latin1", 128, 132) === "DICM") return "application/dicom";
  return null;
}

export const EXTENSION: Record<DetectedType, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "application/dicom": "dcm",
};

export const isImage = (t: string) => t === "image/jpeg" || t === "image/png" || t === "image/webp";

// ---------------- Dimensiones de una imagen (sin decodificarla) ----------------
/** Ancho y alto leídos de la cabecera (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X). null si no se reconoce. */
export function imageDimensions(b: Buffer): { width: number; height: number } | null {
  const t = sniffType(b);
  if (t === "image/png") {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (t === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xff) { i++; continue; } // relleno
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // sin longitud
      if (m === 0xd9 || m === 0xda) return null; // fin o datos sin haber visto el tamaño
      const len = b.readUInt16BE(i + 2);
      if (len < 2) return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (t === "image/webp") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X" && b.length >= 30) {
      return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    }
  }
  return null;
}
