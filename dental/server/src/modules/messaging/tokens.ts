// Enlace de confirmación /c/:token — firmado con HMAC (clave del servidor) y de un solo uso.
// El token lleva la clínica y un id aleatorio; la firma impide fabricar o alterar uno. En la base
// solo se guarda su SHA-256, así que una copia de la base no permite confirmar citas.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const uuidToBytes = (u: string) => Buffer.from(u.replace(/-/g, ""), "hex");
const bytesToUuid = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const mac = (key: Buffer, payload: string) => createHmac("sha256", key).update(`confirmar:${payload}`).digest().subarray(0, 16);

export function signConfirmToken(key: Buffer, clinicId: string, tokenId: string): string {
  const payload = Buffer.concat([uuidToBytes(clinicId), uuidToBytes(tokenId)]).toString("base64url");
  return `${payload}.${mac(key, payload).toString("base64url")}`;
}

/** Devuelve la clínica y el id si la firma es válida; null si el token fue alterado o no tiene formato. */
export function verifyConfirmToken(key: Buffer, token: string): { clinicId: string; tokenId: string } | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const given = Buffer.from(m[2]!, "base64url");
  const expected = mac(key, m[1]!);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const raw = Buffer.from(m[1]!, "base64url");
  if (raw.length !== 32) return null;
  return { clinicId: bytesToUuid(raw.subarray(0, 16)), tokenId: bytesToUuid(raw.subarray(16)) };
}

export const confirmTokenHash = (token: string) => createHash("sha256").update(token).digest();
