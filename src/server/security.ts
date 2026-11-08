// Contraseñas, tokens de sesión, códigos de acceso y límites de intentos.
import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashSecret(plain: string, min = 8): string {
  if (typeof plain !== "string" || plain.length < min) throw new Error(`La contrasena necesita al menos ${min} caracteres`);
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function hashPassword(plain: string): string {
  if (typeof plain !== "string" || plain.length < 10) throw new Error("La contraseña necesita al menos 10 caracteres");
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Hash de relleno para que un usuario inexistente tarde lo mismo que uno real. */
const DUMMY = hashPassword("contraseña-de-relleno-para-tiempos-iguales");

export function verifyPassword(plain: string, stored: string | undefined): boolean {
  const [alg, n, r, p, salt, key] = (stored ?? DUMMY).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(key, "base64");
  const got = scryptSync(String(plain ?? ""), Buffer.from(salt, "base64"), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(expected, got) && stored !== undefined;
}

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Ventana deslizante simple en memoria: N intentos por clave cada `windowMs`. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number) {}
  /** Registra un intento. Devuelve false si se pasó del límite. */
  take(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    return true;
  }
  /** true si ya se pasó del límite (sin registrar un intento nuevo). */
  blocked(key: string): boolean {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs).length >= this.max;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}

interface PendingCode {
  hash: string;
  expiresAt: number;
  attempts: number;
}

/** Códigos de un solo uso para que el cliente entre con su teléfono. Se guardan hasheados. */
export class OtpStore {
  private codes = new Map<string, PendingCode>();
  constructor(private ttlMs: number, private now: () => number) {}

  issue(phone: string): string {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.codes.set(phone, { hash: sha256(`${phone}:${code}`), expiresAt: this.now() + this.ttlMs, attempts: 0 });
    return code;
  }

  /** Máximo 5 intentos por código; después hay que pedir uno nuevo. */
  verify(phone: string, code: string): boolean {
    const p = this.codes.get(phone);
    if (!p || p.expiresAt < this.now() || p.attempts >= 5) {
      this.codes.delete(phone);
      return false;
    }
    p.attempts++;
    const a = Buffer.from(p.hash), b = Buffer.from(sha256(`${phone}:${String(code ?? "").trim()}`));
    if (a.length === b.length && timingSafeEqual(a, b)) {
      this.codes.delete(phone);
      return true;
    }
    return false;
  }
}

/* ---------------- Verificación en dos pasos (TOTP, RFC 6238) ---------------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

/** Código de 6 dígitos para el paso de 30 s `step`. */
export function totpAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Devuelve el paso usado si el código es válido (±1 paso de tolerancia), o null. */
export function verifyTotp(secret: string, code: string, now: number): number | null {
  const c = String(code ?? "").replace(/\D/g, "");
  if (c.length !== 6) return null;
  const step = Math.floor(now / 30_000);
  for (const d of [0, -1, 1]) {
    const a = Buffer.from(totpAt(secret, step + d)), b = Buffer.from(c);
    if (timingSafeEqual(a, b)) return step + d;
  }
  return null;
}
