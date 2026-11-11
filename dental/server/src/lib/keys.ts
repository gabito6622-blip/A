// Claves del servidor separadas por uso, con rotación (B-094).
//
//  * mfa  — cifra el secreto de la verificación en dos pasos (AES-256-GCM, lib/secretbox.ts).
//  * link — firma enlaces y códigos: archivos clínicos y comprobantes, desbloqueo de cuenta,
//           confirmación de citas, encuestas, QR de llegada, presupuesto por enlace y los códigos
//           de un solo uso del portal. Cada uso deriva su propia subclave o firma con un prefijo
//           distinto, así un token de un tipo no sirve para otro.
//
// Rotación: cada anillo tiene la clave vigente (`current`, con la que se firma o cifra) y,
// opcionalmente, la anterior (`previous`, solo para verificar o descifrar). Un secreto TOTP
// descifrado con la anterior se vuelve a cifrar con la vigente al usarse.
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { open, seal } from "./secretbox.js";

export interface KeyRing {
  current: Buffer;
  previous: Buffer | null;
}

/** Acepta una clave suelta (pruebas, herramientas) o un anillo con rotación. */
export type Keys = Buffer | KeyRing;

export const ringOf = (k: Keys): KeyRing => (Buffer.isBuffer(k) ? { current: k, previous: null } : k);

/** Claves con las que se acepta verificar o descifrar: primero la vigente. */
export const verifyKeys = (k: Keys): Buffer[] => {
  const r = ringOf(k);
  return r.previous && !r.previous.equals(r.current) ? [r.current, r.previous] : [r.current];
};

/** Aplica la misma derivación a la clave vigente y a la anterior. */
export function deriveRing(k: Keys, derive: (key: Buffer) => Buffer): KeyRing {
  const r = ringOf(k);
  return { current: derive(r.current), previous: r.previous ? derive(r.previous) : null };
}

/** HKDF-SHA256 de 32 bytes (derivación de claves fuera de producción). */
export const hkdf32 = (base: Buffer, info: string): Buffer => Buffer.from(hkdfSync("sha256", base, Buffer.from("dentalia-keys"), Buffer.from(info), 32));

/** Comparación en tiempo constante de dos MAC. */
export function sameMac(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** true si `given` es la firma de `data` con alguna clave aceptada (vigente o anterior). */
export function verifyWithAny(k: Keys, mac: (key: Buffer) => Buffer, given: Buffer): boolean {
  let ok = false;
  for (const key of verifyKeys(k)) ok = sameMac(mac(key), given) || ok; // sin cortocircuito: tiempo parejo
  return ok;
}

/** Cifra con la clave vigente. */
export const sealWith = (k: Keys, plain: string) => seal(ringOf(k).current, plain);

/**
 * Descifra con la vigente o, si falla, con la anterior. `rotated` indica que se usó la anterior:
 * quien llama debe volver a cifrar con `sealWith` y guardar el resultado.
 */
export function openWith(k: Keys, sealed: string): { plain: string; rotated: boolean } {
  const keys = verifyKeys(k);
  let last: unknown = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      return { plain: open(keys[i]!, sealed), rotated: i > 0 };
    } catch (e) { last = e; }
  }
  throw last ?? new Error("No se pudo descifrar el secreto");
}

// ---------------- Enlaces firmados genéricos (desbloqueo de cuenta) ----------------
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const purposeKey = (key: Buffer, purpose: string) => createHmac("sha256", key).update(`dentalia:link:${purpose}:v1`).digest();

/** Token `datos.firma` con vencimiento (`e`, segundos epoch) y propósito propio. */
export function signLink(k: Keys, purpose: string, data: Record<string, string>, ttlSeconds: number, nowMs = Date.now()): { token: string; expiresAt: Date } {
  const e = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = b64(JSON.stringify({ ...data, e }));
  const mac = createHmac("sha256", purposeKey(ringOf(k).current, purpose)).update(payload).digest();
  return { token: `${payload}.${b64(mac)}`, expiresAt: new Date(e * 1000) };
}

export type LinkCheck = { ok: true; data: Record<string, string> } | { ok: false; reason: "invalid" | "expired" };

export function verifyLink(k: Keys, purpose: string, token: string, nowMs = Date.now()): LinkCheck {
  if (typeof token !== "string" || token.length > 600) return { ok: false, reason: "invalid" };
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return { ok: false, reason: "invalid" };
  const given = Buffer.from(m[2]!, "base64url");
  if (!verifyWithAny(k, (key) => createHmac("sha256", purposeKey(key, purpose)).update(m[1]!).digest(), given)) return { ok: false, reason: "invalid" };
  let d: Record<string, unknown>;
  try { d = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")); } catch { return { ok: false, reason: "invalid" }; }
  if (!d || typeof d !== "object" || typeof d.e !== "number") return { ok: false, reason: "invalid" };
  if (Math.floor(nowMs / 1000) >= d.e) return { ok: false, reason: "expired" };
  const data: Record<string, string> = {};
  for (const [key, v] of Object.entries(d)) if (key !== "e" && typeof v === "string") data[key] = v;
  return { ok: true, data };
}
