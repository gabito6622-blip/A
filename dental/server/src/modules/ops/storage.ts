// Dónde viven los respaldos: una carpeta local o un bucket S3 compatible bajo su propio prefijo
// (distinto de los archivos clínicos). Solo se listan, descargan o borran archivos con el nombre
// exacto de un respaldo (dental-AAAAMMDDTHHMMSSZ…), y solo dentro de la carpeta o prefijo propio.
import { constants, createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { S3ObjectClient } from "../../lib/filestore-s3.js";
import { targetLabel, type BackupTarget } from "./config.js";

/** Archivos que forman un juego de respaldo. */
export const BACKUP_FILE_RE = /^dental-(?:files-)?(\d{8}T\d{6}Z)\.(?:dump(?:\.enc)?(?:\.sha256)?|tar\.gz(?:\.enc)?(?:\.sha256)?|manifest\.json)$/;
/** Límite de una subida en un solo PUT (S3 admite 5 GB; las subidas por partes quedan pendientes). */
export const MAX_SINGLE_PUT = 4.5 * 1024 ** 3;

export interface BackupObject { name: string; size: number; modifiedAt: Date }

export interface BackupStorage {
  readonly kind: "local" | "s3";
  readonly label: string;
  list(): Promise<BackupObject[]>;
  upload(name: string, srcPath: string): Promise<void>;
  download(name: string, destPath: string): Promise<void>;
  remove(name: string): Promise<void>;
}

function assertName(name: string) {
  if (!BACKUP_FILE_RE.test(name)) throw new Error(`Nombre de archivo de respaldo inválido: ${name}`);
}

export class LocalBackupStorage implements BackupStorage {
  readonly kind = "local" as const;
  constructor(readonly dir: string) {}
  get label() { return targetLabel({ kind: "local", dir: this.dir }); }

  async list(): Promise<BackupObject[]> {
    let names: string[];
    try { names = await readdir(this.dir); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: BackupObject[] = [];
    for (const name of names) {
      if (!BACKUP_FILE_RE.test(name)) continue;
      const st = await stat(join(this.dir, name));
      if (st.isFile()) out.push({ name, size: st.size, modifiedAt: st.mtime });
    }
    return out;
  }

  async upload(name: string, srcPath: string) {
    assertName(name);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await copyFile(srcPath, join(this.dir, name), constants.COPYFILE_EXCL);
  }

  async download(name: string, destPath: string) {
    assertName(name);
    await pipeline(createReadStream(join(this.dir, name)), createWriteStream(destPath, { flags: "wx", mode: 0o600 }));
  }

  async remove(name: string) {
    assertName(name);
    await rm(join(this.dir, name), { force: true });
  }
}

export class S3BackupStorage implements BackupStorage {
  readonly kind = "s3" as const;
  private readonly client: S3ObjectClient;
  constructor(private readonly target: Extract<BackupTarget, { kind: "s3" }>, fetchImpl: typeof fetch = fetch) {
    this.client = new S3ObjectClient(target.s3, fetchImpl);
  }
  get label() { return targetLabel(this.target); }

  async list(): Promise<BackupObject[]> {
    const out: BackupObject[] = [];
    for await (const o of this.client.listObjects(this.target.prefix)) {
      if (!o.key.startsWith(this.target.prefix)) continue;
      const name = o.key.slice(this.target.prefix.length);
      if (BACKUP_FILE_RE.test(name)) out.push({ name, size: o.size, modifiedAt: o.modifiedAt });
    }
    return out;
  }

  async upload(name: string, srcPath: string) {
    assertName(name);
    const st = await stat(srcPath);
    if (st.size > MAX_SINGLE_PUT) throw new Error("El respaldo supera 4,5 GB: hace falta la subida por partes (pendiente)");
    await this.client.putObject(this.target.prefix + name, await readFile(srcPath), { ifNoneMatch: true });
  }

  async download(name: string, destPath: string) {
    assertName(name);
    const o = await this.client.getObject(this.target.prefix + name);
    if (!o) throw new Error(`El archivo ${name} ya no está en el almacenamiento de respaldos`);
    await pipeline(o.stream, createWriteStream(destPath, { flags: "wx", mode: 0o600 }));
  }

  async remove(name: string) {
    assertName(name);
    await this.client.deleteObject(this.target.prefix + name);
  }
}

export function createBackupStorage(target: BackupTarget, fetchImpl: typeof fetch = fetch): BackupStorage {
  return target.kind === "s3" ? new S3BackupStorage(target, fetchImpl) : new LocalBackupStorage(target.dir);
}
