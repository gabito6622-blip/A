// Cifrado de respaldos compatible con `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt`
// (el formato de scripts/backup.sh), para que scripts/restore.sh siga sirviendo:
//   "Salted__" + sal (8 bytes) + AES-256-CBC con relleno PKCS#7;
//   clave (32) + IV (16) = PBKDF2-HMAC-SHA256(frase, sal, 200 000 iteraciones, 48 bytes).
// Se hace en Node (sin el binario openssl) y en streaming: el volcado en claro nunca toca el disco.
import { createCipheriv, createDecipheriv, createHash, pbkdf2, randomBytes, type Decipher } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const PBKDF2_ITER = 200_000;
const MAGIC = Buffer.from("Salted__", "latin1");

export class BackupError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const derive = (pass: string, salt: Buffer) => new Promise<Buffer>((res, rej) => pbkdf2(pass, salt, PBKDF2_ITER, 48, "sha256", (e, k) => (e ? rej(e) : res(k))));

/** Escribe `source` en `dest` (cifrado si hay frase) y devuelve tamaño y SHA-256 del archivo escrito. */
export async function writeMaybeEncrypted(source: Readable, dest: string, passphrase: string | null): Promise<{ size: number; sha256: string }> {
  // Se engancha YA (antes de cualquier await): si la salida es de un proceso hijo que termina mientras
  // se deriva la clave, Node vacía (descarta) la salida que nadie está leyendo.
  const input = source.pipe(new PassThrough({ highWaterMark: 1 << 20 }));
  source.once("error", (e) => input.destroy(e));
  const hash = createHash("sha256");
  let size = 0;
  const tap = new Transform({ transform(chunk: Buffer, _e, cb) { hash.update(chunk); size += chunk.length; cb(null, chunk); } });
  const stages: Transform[] = [];
  if (passphrase) {
    const salt = randomBytes(8);
    const dk = await derive(passphrase, salt);
    const cipher = createCipheriv("aes-256-cbc", dk.subarray(0, 32), dk.subarray(32, 48));
    const header = Buffer.concat([MAGIC, salt]);
    let first = true;
    const prefix = new Transform({
      transform(chunk: Buffer, _e, cb) { if (first) { first = false; cb(null, Buffer.concat([header, chunk])); } else cb(null, chunk); },
      flush(cb) { if (first) this.push(header); cb(); },
    });
    stages.push(cipher as unknown as Transform, prefix);
  }
  await pipeline([input, ...stages, tap, createWriteStream(dest, { flags: "wx", mode: 0o600 })]);
  return { size, sha256: hash.digest("hex") };
}

/** Transformación que descifra el formato de openssl enc (falla con BackupError si la clave no corresponde). */
export function decryptor(passphrase: string): Transform {
  let head = Buffer.alloc(0);
  let decipher: Decipher | null = null;
  return new Transform({
    transform(chunk: Buffer, _e, cb) {
      if (decipher) {
        try { cb(null, decipher.update(chunk)); } catch (e) { cb(e as Error); }
        return;
      }
      head = Buffer.concat([head, chunk]);
      if (head.length < 16) return cb();
      if (!head.subarray(0, 8).equals(MAGIC)) return cb(new BackupError("bad_format", "El archivo no tiene el formato cifrado esperado (openssl enc)"));
      derive(passphrase, head.subarray(8, 16)).then((dk) => {
        decipher = createDecipheriv("aes-256-cbc", dk.subarray(0, 32), dk.subarray(32, 48));
        try { cb(null, decipher.update(head.subarray(16))); } catch (e) { cb(e as Error); }
      }, (e) => cb(e as Error));
    },
    flush(cb) {
      if (!decipher) return cb(new BackupError("truncated", "El archivo cifrado está incompleto"));
      try { this.push(decipher.final()); cb(); } catch {
        cb(new BackupError("bad_decrypt", "No se pudo descifrar: la clave no corresponde o el archivo está dañado"));
      }
    },
  });
}

/**
 * Comprueba la frase descifrando solo el primer bloque y buscando la firma del contenido
 * («PGDMP» de pg_dump o 1f 8b de gzip). Así una clave equivocada se informa como tal, sin
 * empezar a restaurar basura.
 */
export async function passphraseMatches(path: string, passphrase: string, kind: "dump" | "gzip"): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(48);
    const { bytesRead } = await fh.read(buf, 0, 48, 0);
    if (bytesRead < 32 || !buf.subarray(0, 8).equals(MAGIC)) return false;
    const dk = await derive(passphrase, buf.subarray(8, 16));
    const d = createDecipheriv("aes-256-cbc", dk.subarray(0, 32), dk.subarray(32, 48));
    d.setAutoPadding(false);
    const plain = d.update(buf.subarray(16, 32));
    return kind === "dump" ? plain.subarray(0, 5).toString("latin1") === "PGDMP" : plain[0] === 0x1f && plain[1] === 0x8b;
  } finally { await fh.close(); }
}

/** SHA-256 de un archivo en disco. */
export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const ch of createReadStream(path)) h.update(ch as Buffer);
  return h.digest("hex");
}
