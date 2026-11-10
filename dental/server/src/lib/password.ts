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

// Hash de una contraseña inexistente para igualar tiempos cuando el usuario no existe.
let dummy: string | null = null;
export async function dummyVerify(pw: string): Promise<void> {
  dummy ??= await hashPassword("contraseña-inexistente-123");
  await verifyPassword(pw, dummy);
}
