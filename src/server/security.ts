// Contraseñas, tokens de sesión, códigos de acceso y límites de intentos.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 32;

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
