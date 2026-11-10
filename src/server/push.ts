// Avisos al celular (Web Push) sin dependencias.
//
// Mandamos un "toque" SIN contenido: el aviso no viaja con datos de la tienda por los servidores
// de Google/Apple/Mozilla. Cuando el celular lo recibe, el service worker (public/sw.js) le pide
// el texto al panel con la sesión del usuario y recién ahí muestra la notificación.
// Para firmar usamos VAPID (RFC 8292): un par de claves P-256 que se pasan por variables de entorno.
import { createECDH, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

export interface VapidKeys {
  /** Clave pública sin comprimir (65 bytes) en base64url: la que usa el navegador. */
  publicKey: string;
  /** Clave privada (32 bytes) en base64url. */
  privateKey: string;
  /** Contacto que piden los servicios de push: "mailto:..." o "https://...". */
  subject: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

const b64u = (b: Buffer) => b.toString("base64url");

/** Genera un par de claves VAPID nuevo (para `npm run vapid`). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]);
  return { publicKey: b64u(raw), privateKey: jwk.d! };
}

/** Arma la clave privada a partir de las dos cadenas; tira error si no son un par válido. */
export function vapidKeyObject(k: VapidKeys): KeyObject {
  const raw = Buffer.from(k.publicKey, "base64url");
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("VAPID_PUBLIC_KEY inválida (tienen que ser 65 bytes en base64url)");
  const d = Buffer.from(k.privateKey, "base64url");
  if (d.length !== 32) throw new Error("VAPID_PRIVATE_KEY inválida (tienen que ser 32 bytes en base64url)");
  // Que la privada corresponda a la pública (la pública se recalcula desde la privada).
  const ecdh = createECDH("prime256v1");
  try { ecdh.setPrivateKey(d); } catch { throw new Error("VAPID_PRIVATE_KEY inválida"); }
  if (!ecdh.getPublicKey().equals(raw)) throw new Error("Las claves VAPID no son un par");
  const jwk = { kty: "EC", crv: "P-256", x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)), d: b64u(d) };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  if (!/^(mailto:|https:\/\/)/.test(k.subject)) throw new Error("VAPID_SUBJECT tiene que empezar con mailto: o https://");
  return key;
}

/** JWT firmado (ES256) para el servicio de push de `endpoint`. Vale 12 horas. */
export function vapidJwt(endpoint: string, k: VapidKeys, key: KeyObject, nowMs: number): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: k.subject })));
  const sig = sign("sha256", Buffer.from(`${header}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${b64u(sig)}`;
}

/** Servicios de push conocidos: solo mandamos a estos (así nadie usa el servidor para llamar a otro lado). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^android\.googleapis\.com$/];

export function validSubscription(s: unknown): PushSubscriptionData | null {
  const o = s as PushSubscriptionData;
  if (!o || typeof o.endpoint !== "string" || o.endpoint.length > 1000) return null;
  let u: URL;
  try { u = new URL(o.endpoint); } catch { return null; }
  if (u.protocol !== "https:" || u.port || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  const keys = o.keys && typeof o.keys === "object" ? { p256dh: String(o.keys.p256dh ?? "").slice(0, 200), auth: String(o.keys.auth ?? "").slice(0, 100) } : undefined;
  return { endpoint: u.toString(), ...(keys ? { keys } : {}) };
}

/**
 * Manda un toque sin contenido. Devuelve "gone" si el navegador ya no tiene esa suscripción
 * (hay que borrarla), "ok" si salió, o tira error.
 */
export async function sendPush(sub: PushSubscriptionData, k: VapidKeys, key: KeyObject, f: typeof fetch, nowMs: number): Promise<"ok" | "gone"> {
  const r = await f(sub.endpoint, {
    method: "POST",
    headers: { TTL: String(24 * 3600), Urgency: "high", "Content-Length": "0", Authorization: `vapid t=${vapidJwt(sub.endpoint, k, key, nowMs)}, k=${k.publicKey}` },
  });
  if (r.status === 404 || r.status === 410) return "gone";
  if (!r.ok) throw new Error(`push ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  return "ok";
}
