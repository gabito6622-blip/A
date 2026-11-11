// Contraseñas con scrypt (node:crypto, sin dependencias nativas).
// Formato: scrypt$N$r$p$saltB64$hashB64
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";

const N = Number(process.env.DENTAL_SCRYPT_N ?? 32768);
const R = 8, P = 1, KEYLEN = 32;

function scrypt(pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((res, rej) =>
    scryptCb(pw.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? rej(e) : res(k))),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, s, h] = parts;
  const expected = Buffer.from(h!, "base64");
  const key = await scrypt(pw, Buffer.from(s!, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Política mínima: 10+ caracteres, letras y números. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres";
  if (pw.length > 200) return "La contraseña es demasiado larga";
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(pw) || !/\d/.test(pw)) return "La contraseña debe combinar letras y números";
  return null;
}

/**
 * Calcula el hash de `pw` con los parámetros y la sal de `prefix` ("scrypt$N$r$p$sal"), en el mismo
 * formato que hashPassword. Así la app compara contra el hash guardado SIN leerlo (B-091: la base
 * solo entrega la sal con auth_password_salt y compara con auth_password_matches).
 * Devuelve null si el prefijo no tiene un formato o parámetros válidos.
 */
export async function hashWithSalt(pw: string, prefix: string): Promise<string | null> {
  const parts = prefix.split("$");
  if (parts.length !== 5 || parts[0] !== "scrypt") return null;
  const [, n, r, p, s] = parts;
  const N = Number(n), Rr = Number(r), Pp = Number(p);
  // Límites defensivos: N potencia de 2 hasta 2^20, r ≤ 32, p ≤ 4.
  if (!Number.isInteger(N) || N < 2 || N > 1 << 20 || (N & (N - 1)) !== 0 || !Number.isInteger(Rr) || Rr < 1 || Rr > 32 || !Number.isInteger(Pp) || Pp < 1 || Pp > 4) return null;
  const key = await scrypt(pw, Buffer.from(s!, "base64"), N, Rr, Pp);
  return `${prefix}$${key.toString("base64")}`;
}

// Hash de una contraseña inexistente para igualar tiempos cuando el usuario no existe o no se
// puede verificar (cuenta bloqueada): cuesta lo mismo que una verificación real.
let dummy: string | null = null;
export async function dummyVerify(pw: string): Promise<void> {
  dummy ??= await hashPassword("contraseña-inexistente-123");
  await verifyPassword(pw, dummy);
}
