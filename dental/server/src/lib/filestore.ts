// Almacenamiento privado de archivos clínicos (B-012).
//
// La API nunca arma rutas con datos del usuario: cada archivo se guarda bajo una clave
// aleatoria `<clinic_id>/<año>/<32 hex>` generada aquí. El controlador local escribe en
// DENTAL_FILES_DIR (por defecto ./data/files, fuera de web/dist y de cualquier carpeta
// servida como estática), con permisos 0600/0700 y escritura atómica (temporal + rename).
//
// Para un almacenamiento de objetos S3 compatible basta otro controlador que implemente
// FileStore (put = PutObject con If-None-Match: *, open = GetObject en streaming,
// remove = DeleteObject) y una clave de cifrado del proveedor por bucket. La base guarda
// `storage_driver`, así que pueden convivir archivos antiguos en disco y nuevos en S3.
// Este módulo NO llama a ningún servicio externo.
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { AppError } from "./errors.js";

export type StorageDriver = "local" | "s3";

export interface FileStore {
  readonly driver: StorageDriver;
  /** Guarda los bytes bajo `key`. Falla si la clave ya existe (nunca sobrescribe). */
  put(key: string, data: Buffer): Promise<void>;
  /** Abre el archivo para enviarlo en streaming. Lanza 410 si ya no está en el almacenamiento. */
  open(key: string): Promise<{ stream: Readable; size: number }>;
  /** Solo para deshacer una subida cuya transacción falló (archivar NO borra). */
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9]{4}\/[0-9a-f]{32}$/;

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
    if (!KEY_RE.test(key)) throw new Error("Clave de almacenamiento inválida");
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
}

export function createFileStore(cfg: { filesDir: string }): FileStore {
  return new LocalFileStore(cfg.filesDir);
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
