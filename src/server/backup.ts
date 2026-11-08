// Respaldos: un .zip con la base (gabriel.db) y los archivos subidos (comprobantes, QR, logo).
// Se arma uno por día de forma automática y se guardan los últimos `keep` en data/backups.
//
// OJO: el respaldo contiene TODO (incluidas contraseñas de cuentas y claves de Meta).
// Solo el dueño lo puede descargar, y cada descarga queda en la auditoría.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, renameSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.js";
import { zipDeflate, zipStore } from "./xlsx.js";

const NAME = /^respaldo-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.zip$/;
const DAY = 24 * 3_600_000;
const MAX_UPLOADS_BYTES = 300 * 1024 * 1024;

export interface BackupInfo { name: string; bytes: number; createdAt: number }

const README = `RESPALDO DE GABRIEL STORE

Contiene:
  gabriel.db   la base completa (clientes, ventas, cuentas con sus contraseñas, claves de Meta)
  uploads/     comprobantes de pago, QR y logo

Guardalo en un lugar privado. Si la tienda usa GS_DATA_KEY, las contraseñas de las
cuentas van cifradas: para restaurar este respaldo hace falta esa misma clave.

Para restaurar:
  1. Apagá la tienda.
  2. En la carpeta de datos (data/ o /data) reemplazá gabriel.db y la carpeta uploads/
     por las de este respaldo. Borrá gabriel.db-wal y gabriel.db-shm si existen.
  3. Prendé la tienda.
`;

export class Backups {
  readonly dir: string;
  constructor(private db: Db, private uploadsDir: string, dataDir: string, private now: () => number, private keep = 30) {
    this.dir = join(dataDir, "backups");
    mkdirSync(this.dir, { recursive: true });
  }

  list(): BackupInfo[] {
    return readdirSync(this.dir).filter((n) => NAME.test(n)).map((name) => {
      const st = statSync(join(this.dir, name));
      return { name, bytes: st.size, createdAt: st.mtimeMs };
    }).sort((a, b) => b.createdAt - a.createdAt || b.name.length - a.name.length || (a.name < b.name ? 1 : -1));
  }

  lastAt(): number | undefined {
    return this.list()[0]?.createdAt;
  }

  create(): BackupInfo {
    const d = new Date(this.now());
    const p = (n: number) => String(n).padStart(2, "0");
    const base = `respaldo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    let name = `${base}.zip`;
    for (let i = 2; existsSync(join(this.dir, name)); i++) name = `${base}-${i}.zip`;
    const tmpDb = join(this.dir, `.tmp-${process.pid}-${Date.now()}.db`);
    try {
      this.db.backupTo(tmpDb);
      const files = [{ name: "LEEME.txt", data: Buffer.from(README, "utf8") }, { name: "gabriel.db", data: readFileSync(tmpDb) }];
      let total = 0;
      for (const f of existsSync(this.uploadsDir) ? readdirSync(this.uploadsDir) : []) {
        const full = join(this.uploadsDir, f);
        const st = statSync(full);
        if (!st.isFile()) continue;
        total += st.size;
        if (total > MAX_UPLOADS_BYTES) throw new Error("Los archivos subidos superan 300 MB: copiá la carpeta uploads a mano");
        files.push({ name: `uploads/${f}`, data: readFileSync(full) });
      }
      const tmpZip = join(this.dir, `.tmp-${process.pid}-${Date.now()}.zip`);
      writeFileSync(tmpZip, zipStore(files));
      renameSync(tmpZip, join(this.dir, name));
      const t = new Date(this.now());
      utimesSync(join(this.dir, name), t, t);
    } finally {
      try { unlinkSync(tmpDb); } catch { /* no se llegó a crear */ }
    }
    this.prune();
    return this.list().find((b) => b.name === name)!;
  }

  /**
   * Respaldo comprimido para guardar fuera del servidor (Gmail). Lleva la base y, si entra
   * en `maxBytes`, también los archivos subidos (comprobantes, logos).
   */
  compact(maxBytes = 17 * 1024 * 1024): { data: Buffer; withUploads: boolean } {
    const tmpDb = join(this.dir, `.tmp-${process.pid}-${Date.now()}-c.db`);
    try {
      this.db.backupTo(tmpDb);
      const base = [{ name: "LEEME.txt", data: Buffer.from(README, "utf8") }, { name: "gabriel.db", data: readFileSync(tmpDb) }];
      const ups = (existsSync(this.uploadsDir) ? readdirSync(this.uploadsDir) : [])
        .filter((f) => statSync(join(this.uploadsDir, f)).isFile())
        .map((f) => ({ name: `uploads/${f}`, data: readFileSync(join(this.uploadsDir, f)) }));
      const full = zipDeflate([...base, ...ups]);
      if (full.length <= maxBytes) return { data: full, withUploads: true };
      return { data: zipDeflate(base), withUploads: false };
    } finally {
      try { unlinkSync(tmpDb); } catch { /* no se llegó a crear */ }
    }
  }

  /** Arma el respaldo del día si el último tiene más de 24 h (o no hay ninguno). */
  daily(): BackupInfo | undefined {
    const last = this.lastAt();
    if (last !== undefined && this.now() - last < DAY && last <= this.now()) return undefined;
    return this.create();
  }

  read(name: string): Buffer {
    if (!NAME.test(name) || !existsSync(join(this.dir, name))) throw Object.assign(new Error("Respaldo inexistente"), { notFound: true });
    return readFileSync(join(this.dir, name));
  }

  private prune(): void {
    for (const b of this.list().slice(this.keep)) {
      try { unlinkSync(join(this.dir, b.name)); } catch { /* ya no está */ }
    }
  }
}
