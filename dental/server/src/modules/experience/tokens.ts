// Enlaces públicos firmados (HMAC con la clave del servidor) para la encuesta y el QR de llegada.
// El token lleva la clínica y un id aleatorio; la firma (con un propósito distinto por tipo de
// enlace) impide fabricar, alterar o reutilizar un token de otro tipo. En la base solo se guarda
// el SHA-256 del token (encuestas) o el id (QR, que se puede renovar).
import { createHash, createHmac } from "node:crypto";
import { ringOf, verifyWithAny, type Keys } from "../../lib/keys.js";

export type TokenPurpose = "encuesta" | "llegada";

const uuidToBytes = (u: string) => Buffer.from(u.replace(/-/g, ""), "hex");
const bytesToUuid = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const mac = (key: Buffer, purpose: TokenPurpose, payload: string) => createHmac("sha256", key).update(`${purpose}:${payload}`).digest().subarray(0, 16);

export function signToken(key: Keys, purpose: TokenPurpose, clinicId: string, id: string): string {
  const payload = Buffer.concat([uuidToBytes(clinicId), uuidToBytes(id)]).toString("base64url");
  return `${payload}.${mac(ringOf(key).current, purpose, payload).toString("base64url")}`;
}

/** Devuelve la clínica y el id si la firma es válida para ese propósito; null si no. */
export function verifyToken(key: Keys, purpose: TokenPurpose, token: string): { clinicId: string; id: string } | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  if (!verifyWithAny(key, (k) => mac(k, purpose, m[1]!), Buffer.from(m[2]!, "base64url"))) return null;
  const raw = Buffer.from(m[1]!, "base64url");
  if (raw.length !== 32) return null;
  return { clinicId: bytesToUuid(raw.subarray(0, 16)), id: bytesToUuid(raw.subarray(16)) };
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest();
export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
