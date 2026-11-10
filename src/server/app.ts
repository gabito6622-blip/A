// Servidor HTTP de Gabriel Store: API JSON + archivos estáticos de la tienda y el panel.
// Sin frameworks: node:http. Cada ruta declara quién puede llamarla; el núcleo vuelve a
// validar permisos (defensa en dos capas).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createStore, DomainError, normalizePhone, systemClock, type Actor, type Clock, type GabrielStore } from "../store/index.js";
import { Db } from "./db.js";
import { LOOK_KEYS } from "../store/look.js";
import { DEFAULT_COMBO_DISCOUNTS } from "../store/types.js";
import { appendToFolder, fetchNew, testImap, type ImapConfig } from "./imap.js";
import { buildMail, emailsIn, parseMail } from "./mail.js";
import { Backups } from "./backup.js";
import { newTotpSecret, verifyTotp } from "./security.js";
import { hashPassword, hashSecret, newToken, OtpStore, RateLimiter, sha256, verifyPassword } from "./security.js";
import { sendMail } from "./smtp.js";
import { botAnswer } from "./bot.js";
import { parseWebhook, verifySignature, WaError, WhatsAppCloud, type InboundMessage } from "./whatsapp.js";
import { metaTemplateBody, templateParamOrder, TEMPLATES, type TemplateId } from "../store/index.js";
import { buildExport, customersTemplate, EXPORT_KINDS, importCustomers, importServicesFile, servicesTemplate, type ExportKind } from "./exports.js";

export interface AppConfig {
  /** Carpeta de datos: base SQLite (gabriel.db) y comprobantes (uploads/). */
  dataDir: string;
  /** Origen público, p. ej. "https://gabostore.lat". Los POST de navegador deben venir de acá. */
  publicOrigin?: string;
  /** true en producción (HTTPS): cookies con Secure. */
  secureCookies?: boolean;
  /** Carpeta con la tienda y el panel (HTML/JS/CSS). */
  staticDir?: string;
  /** Entrega del código de acceso al cliente (WhatsApp, SMS…). Sin esto, el login por código queda apagado. */
  otpSender?: (phone: string, code: string) => Promise<void> | void;
  clock?: Clock;
  /** Tareas periódicas (vencer reservas, recordatorios). Por defecto activadas. */
  jobs?: boolean;
  log?: (msg: string) => void;
  /** Solo pruebas: conectar a un servidor IMAP local en vez del real. */
  imapTest?: { host: string; port: number; tls: ImapConfig["tls"] };
  /** Solo pruebas: servidor SMTP local para los correos. */
  smtpTest?: { host: string; port: number; tls: ImapConfig["tls"] };
  /** Para pruebas: reemplaza fetch y la URL de Meta. */
  fetchImpl?: typeof fetch;
  metaBaseUrl?: string;
  /** Clave para cifrar las contraseñas de las cuentas en la base (GS_DATA_KEY). */
  dataKey?: string;
  /** true detrás de un proxy de confianza (Render, Railway, Cloudflare): usa X-Forwarded-For para los límites. */
  trustProxy?: boolean;
}

const HOUR = 3_600_000;
const STAFF_SESSION_MS = 12 * HOUR;
const CUSTOMER_SESSION_MS = 30 * 24 * HOUR;
const LINK_MS = 24 * HOUR;
const COOKIE = "gs_session";
const MAX_JSON = 100 * 1024;
const MAX_UPLOAD_JSON = 7 * 1024 * 1024; // 5 MB en base64 ≈ 6,7 MB
const MAX_FILE = 5 * 1024 * 1024;

const STATUS: Record<string, number> = {
  FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, OUT_OF_STOCK: 409, INSUFFICIENT_BALANCE: 409,
  INVALID_STATE: 409, ALREADY_PROCESSED: 409, SUPPLIER_EXPIRY_EXCEEDED: 409, NO_CONSENT: 409, SENSITIVE_DATA: 400,
};

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Who = "public" | "customer" | "staff";
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  actor?: Actor;
  session?: { tokenHash: string; kind: string; subjectId: string };
  ip: string;
  /** Cuerpo crudo (para verificar firmas de webhooks). */
  raw?: Buffer;
}
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  who: Who;
  maxBody: number;
  handler: (c: Ctx) => unknown | Promise<unknown>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".webmanifest": "application/manifest+json",
};

/** Detecta el tipo real del archivo por sus primeros bytes (no por el nombre que manda el cliente). */
function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: ".png", mime: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { ext: ".webp", mime: "image/webp" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: ".pdf", mime: "application/pdf" };
  return null;
}

export interface App {
  server: Server;
  store: GabrielStore;
  db: Db;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  /** Lee los correos nuevos ya (si no, se leen solos cada minuto). */
  pollMail(only?: string): Promise<{ checked: number; found: number; errors: number }>;
  /** Recuperación: apaga la verificación en dos pasos de un usuario (si perdió el celular). */
  resetTwoFactor(username: string): boolean;
  /** Crea el primer dueño si no existe ninguno. Devuelve false si ya había. */
  bootstrapOwner(username: string, name: string, password: string): boolean;
  /** Manda ahora los avisos pendientes por WhatsApp (si el bot está configurado). */
  flushWhatsApp(): Promise<{ sent: number; failed: number; pending: number }>;
  /** Ejecuta las tareas periódicas una vez (para pruebas o cron externo). */
  runJobs(): { expired: number; reminders: number; closed: number };
}

export function createApp(cfg: AppConfig): App {
  const clock = cfg.clock ?? systemClock;
  const log = cfg.log ?? ((m: string) => console.log(`[gabriel-store] ${m}`));
  const uploads = join(cfg.dataDir, "uploads");
  mkdirSync(uploads, { recursive: true });
  const db = new Db(join(cfg.dataDir, "gabriel.db"), { dataKey: cfg.dataKey });
  const migrated = db.encryptExisting();
  if (migrated) log(`contraseñas de cuentas cifradas en ${migrated} versión(es) guardada(s)`);
  const store = createStore({ clock, initialState: db.loadLatest(), onCommit: (s) => db.saveState(s, clock.now()) });
  const system: Actor = { id: "system:jobs", role: "system" };

  const now = () => clock.now();
  const backups = new Backups(db, uploads, cfg.dataDir, now);
  const loginLimiter = new RateLimiter(5, 15 * 60_000, now);
  /** Último paso TOTP usado por usuario: el mismo código no sirve dos veces. */
  const usedTotp = new Map<string, number>();
  const otpPhoneLimiter = new RateLimiter(3, 15 * 60_000, now);
  const otpIpLimiter = new RateLimiter(10, 15 * 60_000, now);
  const otp = new OtpStore(10 * 60_000, now);
  // Registro pendiente (nombre + consentimiento) hasta que el teléfono se verifica.
  const pendingSignup = new Map<string, { name: string; whatsappConsent: boolean }>();

  const routes: Route[] = [];
  const route = (method: string, path: string, who: Who, handler: Route["handler"], maxBody = MAX_JSON) => {
    const keys: string[] = [];
    const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)")) + "$");
    routes.push({ method, re, keys, who, maxBody, handler });
  };

  /* ---------------- sesiones ---------------- */
  function startSession(res: ServerResponse, kind: "staff" | "customer", subjectId: string) {
    const token = newToken();
    const ttl = kind === "staff" ? STAFF_SESSION_MS : CUSTOMER_SESSION_MS;
    db.putSession({ tokenHash: sha256(token), kind, subjectId, createdAt: now(), expiresAt: now() + ttl });
    const attrs = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.floor(ttl / 1000)}`];
    if (cfg.secureCookies) attrs.push("Secure");
    res.setHeader("Set-Cookie", attrs.join("; "));
  }
  function clearCookie(res: ServerResponse) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.secureCookies ? "; Secure" : ""}`);
  }
  function resolveActor(req: IncomingMessage): { actor?: Actor; session?: Ctx["session"] } {
    const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    if (!raw) return {};
    const s = db.getSession(sha256(raw), now());
    if (!s || s.kind === "link") return {};
    const st = store.engine.s;
    if (s.kind === "staff") {
      const u = st.staff[s.subjectId];
      if (!u || !u.active) return {};
      return { actor: { id: u.id, role: u.role }, session: s };
    }
    const c = st.customers[s.subjectId];
    if (!c) return {};
    return { actor: { id: `web:${c.id}`, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id }, session: s };
  }

  /* ---------------- archivos ---------------- */
  function saveUpload(b: any): string {
    if (typeof b?.contentBase64 !== "string") throw new HttpError(400, "VALIDATION", "Falta el archivo del comprobante");
    const buf = Buffer.from(b.contentBase64, "base64");
    if (!buf.length || buf.length > MAX_FILE) throw new HttpError(400, "VALIDATION", "El comprobante debe pesar hasta 5 MB");
    const type = sniff(buf);
    if (!type) throw new HttpError(400, "VALIDATION", "Solo se aceptan imágenes (JPG, PNG, WEBP) o PDF");
    const name = randomBytes(16).toString("hex") + type.ext;
    writeFileSync(join(uploads, name), buf, { flag: "wx" });
    return name;
  }
  const dropUpload = (name: string) => {
    try { unlinkSync(join(uploads, name)); } catch { /* ya no está */ }
  };

  /* ---------------- rutas públicas ---------------- */
  route("GET", "/api/health", "public", () => ({ ok: true }));

  route("GET", "/api/catalog", "public", (c) => store.catalog.publicCatalog(c.actor?.customerId));

  route("GET", "/api/settings", "public", () => {
    const st = store.engine.s.settings;
    return {
      storeName: st.storeName, platformName: st.platformName || "GaboHub", comboDiscounts: st.comboDiscounts ?? DEFAULT_COMBO_DISCOUNTS, whatsapp: st.whatsapp, paymentNote: st.paymentNote ?? "", currency: st.currency, hasQr: !!st.qrFileRef,
      accentColor: st.accentColor || "#3984ff", backgroundColor: st.backgroundColor || "#090e1d", hasLogo: !!st.logoFileRef,
      heroTitle: st.heroTitle || "Todo lo digital,", heroHighlight: st.heroHighlight || "en un solo lugar.",
      heroText: st.heroText || "Suscripciones, herramientas de IA y productividad. Pagás con QR o con tu saldo, y recibís tus accesos en tu cuenta.",
      announcement: st.announcement ?? "",
      fontFamily: st.fontFamily || "inter", corners: st.corners || "round", headingFont: st.headingFont || st.fontFamily || "inter", layout: st.layout || "clasico", storeHours: st.storeHours ?? "",
      accent2Color: st.accent2Color || "", bgStyle: st.bgStyle || "glow", cardStyle: st.cardStyle || "solid", resellerShops: st.resellerShops !== false, resellerProgramPrices: st.resellerProgramPrices !== false,
      heroChip: st.heroChip ?? "✦ Tu tienda digital en Bolivia", heroTicks: st.heroTicks ?? "Precios en bolivianos, Entrega en tu cuenta, Soporte y renovaciones",
      footerText: st.footerText ?? "", instagram: st.instagram ?? "", tiktok: st.tiktok ?? "", facebook: st.facebook ?? "",
      testimonials: (st.testimonials ?? []).map((t) => ({ name: t.name, text: t.text, ...(t.business ? { business: t.business } : {}), ...(t.rating ? { rating: t.rating } : {}) })),
      faq: (st.faq ?? []).map((f) => ({ q: f.q, a: f.a })),
    };
  });
  route("GET", "/api/products/:id/image", "public", (c) => sendImage(c, store.engine.s.products[c.params.id]?.imageFileRef, "Sin imagen"));
  route("GET", "/api/settings/logo", "public", (c) => sendImage(c, store.engine.s.settings.logoFileRef, "La tienda no tiene logo"));
  route("GET", "/api/settings/qr", "public", (c) => sendImage(c, store.engine.s.settings.qrFileRef, "La tienda todavía no subió su QR"));
  function sendImage(c: Ctx, ref: string | undefined, missing: string) {
    const file = ref && join(uploads, ref);
    if (!file || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(ref!) || !existsSync(file)) throw new HttpError(404, "NOT_FOUND", missing);
    c.res.writeHead(200, { "Content-Type": sniff(readFileSync(file).subarray(0, 16))!.mime, "Cache-Control": "no-cache" });
    createReadStream(file).pipe(c.res);
    return RAW;
  }

  route("POST", "/api/auth/staff/login", "public", (c) => {
    const username = String(c.body?.username ?? "").toLowerCase();
    if (!loginLimiter.take(`${c.ip}|${username}`)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Probá en 15 minutos.");
    const u = store.admin.findStaffForLogin(username);
    if (!verifyPassword(String(c.body?.password ?? ""), u?.passwordHash) || !u?.active) throw new HttpError(401, "BAD_LOGIN", "Usuario o contraseña incorrectos");
    // Verificación en dos pasos (si el usuario la activó).
    const totp = db.getSecret(`totp:${u.id}`);
    if (totp) {
      if (!c.body?.code) throw new HttpError(401, "TOTP_REQUIRED", "Escribí el código de 6 dígitos de tu app de verificación");
      const step = verifyTotp(totp, String(c.body.code), now());
      if (step === null || usedTotp.get(u.id) === step) throw new HttpError(401, "BAD_TOTP", "Código incorrecto o vencido. Probá con el código nuevo de tu app");
      usedTotp.set(u.id, step);
    }
    loginLimiter.reset(`${c.ip}|${username}`);
    startSession(c.res, "staff", u.id);
    return { id: u.id, name: u.name, role: u.role };
  });

  route("POST", "/api/auth/customer/request-code", "public", async (c) => {
    const phone = normalizePhone(c.body?.phone);
    if (phone.replace(/\D/g, "").length < 7) throw new HttpError(400, "VALIDATION", "Teléfono inválido");
    if (!otpSender()) throw new HttpError(503, "OTP_DISABLED", "El ingreso por código todavía no está activo. Pedile a la tienda tu link de acceso.");
    if (!otpIpLimiter.take(c.ip) || !otpPhoneLimiter.take(phone)) throw new HttpError(429, "RATE_LIMIT", "Pediste muchos códigos. Probá en 15 minutos.");
    const exists = !!store.catalog.findCustomerByPhone(phone);
    if (!exists) {
      const name = String(c.body?.name ?? "").trim();
      if (!name) return { needsName: true };
      pendingSignup.set(phone, { name: name.slice(0, 80), whatsappConsent: !!c.body?.whatsappConsent });
    }
    await otpSender()!(phone, otp.issue(phone));
    return { sent: true };
  });

  route("POST", "/api/auth/customer/verify", "public", (c) => {
    const phone = normalizePhone(c.body?.phone);
    if (!otp.verify(phone, String(c.body?.code ?? ""))) throw new HttpError(401, "BAD_CODE", "Código incorrecto o vencido");
    let cust = store.catalog.findCustomerByPhone(phone);
    if (!cust) {
      const p = pendingSignup.get(phone);
      if (!p) throw new HttpError(400, "VALIDATION", "Pedí el código de nuevo con tu nombre");
      cust = store.catalog.selfRegister({ name: p.name, phone, whatsappConsent: p.whatsappConsent });
      pendingSignup.delete(phone);
    }
    startSession(c.res, "customer", cust.id);
    return { id: cust.id, name: cust.name, kind: cust.kind };
  });

  // ---- Ingreso con número + PIN de 4 números (no depende del bot de WhatsApp ni de links que vencen) ----
  const loginPinKey = (customerId: string, pin: string) => `loginpin|${customerId}|${pin}`;
  const pinLoginLimiter = new RateLimiter(5, 15 * 60_000, now);
  const pinPhoneLimiter = new RateLimiter(10, 15 * 60_000, now);
  const setLoginPin = (customerId: string, pin: string) => {
    if (!/^\d{4}$/.test(pin)) throw new DomainError("VALIDATION", "El PIN tiene que ser de 4 números");
    db.setSecret(`loginpin:${customerId}`, hashPassword(loginPinKey(customerId, pin)), now());
  };
  const randomPin = () => String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
  route("POST", "/api/auth/customer/pin", "public", (c) => {
    const phone = normalizePhone(c.body?.phone);
    const k = `${phone}|${c.ip}`;
    if (pinLoginLimiter.blocked(k) || pinPhoneLimiter.blocked(phone)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Probá en 15 minutos o pedile un PIN nuevo a la tienda.");
    const cust = phone.replace(/\D/g, "").length >= 7 ? store.catalog.findCustomerByPhone(phone) : undefined;
    const stored = cust ? db.getSecret(`loginpin:${cust.id}`) : undefined;
    if (!cust || !verifyPassword(loginPinKey(cust.id, String(c.body?.pin ?? "")), stored)) {
      pinLoginLimiter.take(k); pinPhoneLimiter.take(phone);
      throw new HttpError(401, "BAD_PIN", cust && !stored ? "Todavía no tenés PIN. Pedíselo a la tienda por WhatsApp." : "Número o PIN incorrecto");
    }
    pinLoginLimiter.reset(k);
    startSession(c.res, "customer", cust.id);
    return { id: cust.id, name: cust.name, kind: cust.kind };
  });
  route("POST", "/api/admin/customers/:id/login-pin", "staff", (c) => {
    if (!store.catalog.canActFor(A(c), c.params.id)) throw new HttpError(403, "FORBIDDEN", "Sin permiso");
    const cust = store.engine.s.customers[c.params.id];
    if (!cust) throw new HttpError(404, "NOT_FOUND", "Cliente inexistente");
    const pin = c.body?.pin ? String(c.body.pin).trim() : randomPin();
    setLoginPin(cust.id, pin);
    store.engine.tx(() => store.engine.audit(A(c), "customer.login_pin", "customer", cust.id));
    return { pin, phone: cust.phone, loginUrl: `${cfg.publicOrigin ?? `http://${c.req.headers.host}`}/` };
  });
  route("POST", "/api/me/login-pin", "customer", (c) => {
    const id = c.actor!.customerId!;
    const stored = db.getSecret(`loginpin:${id}`);
    if (stored && !verifyPassword(loginPinKey(id, String(c.body?.current ?? "")), stored)) throw new HttpError(401, "BAD_PIN", "El PIN actual no es correcto");
    setLoginPin(id, String(c.body?.pin ?? "").trim());
    store.engine.tx(() => store.engine.audit(c.actor!, "customer.login_pin_self", "customer", id));
    return { ok: true };
  });
  route("GET", "/api/me/login-pin", "customer", (c) => ({ hasPin: !!db.getSecret(`loginpin:${c.actor!.customerId!}`) }));

  // ---- Cuentas de clientes con correo + contrasena (registro, login, recuperar) ----
  const EMAILRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const custByEmail = (email: unknown) => Object.values(store.engine.s.customers).find((c) => (c.email ?? "").toLowerCase() === String(email ?? "").trim().toLowerCase());
  /** Envia un correo con el primer Gmail conectado (Panel de codigos). */
  function emailSender() {
    const box = Object.values(store.engine.s.mailboxes).find((m) => (m.kind === "gmail" || m.host === "imap.gmail.com") && db.getSecret(`imap:${m.id}`));
    if (!box) return null;
    return { host: "smtp.gmail.com", port: 465, user: box.user || box.address, pass: db.unseal(db.getSecret(`imap:${box.id}`)!), ...(cfg.smtpTest ?? {}) };
  }
  async function sendStoreEmail(to: string, subject: string, html: string): Promise<void> {
    const snd = emailSender();
    if (!snd) throw new DomainError("VALIDATION", "La tienda todavia no conecto un Gmail para enviar correos (Panel de codigos).");
    await sendMail(snd, { to, subject, html, fromName: store.engine.s.settings.storeName });
  }
  const escH = (x: unknown) => String(x ?? "").replace(/[&<>"\x27]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\x27": "&#39;" }[ch]!));
  const emailWrap = (title: string, body: string) => `<div style="font-family:Inter,Arial,sans-serif;max-width:460px;margin:0 auto;padding:24px;background:#0b1020;color:#eef5ff;border-radius:16px"><h2 style="margin:0 0 8px">${escH(store.engine.s.settings.storeName)}</h2><p style="color:#9fb0d0;margin:0 0 16px">${escH(title)}</p>${body}<p style="color:#6b7a99;font-size:12px;margin-top:20px">Si no fuiste vos, ignora este correo.</p></div>`;

  const regLimiter = new RateLimiter(10, 60 * 60_000, now);
  route("POST", "/api/auth/customer/register", "public", async (c) => {
    if (!regLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Proba en un rato.");
    const email = String(c.body?.email ?? "").trim().toLowerCase();
    const password = String(c.body?.password ?? "");
    if (!EMAILRE.test(email)) throw new DomainError("VALIDATION", "Correo invalido");
    if (password.length < 8) throw new DomainError("VALIDATION", "La contrasena necesita al menos 8 caracteres");
    const existing = custByEmail(email);
    if (existing && db.getSecret(`custpw:${existing.id}`)) throw new DomainError("VALIDATION", "Ya tenes una cuenta con ese correo. Inicia sesion.");
    const cust = existing ?? store.catalog.registerWithEmail({ name: String(c.body?.name ?? "").trim(), email });
    db.setSecret(`custpw:${cust.id}`, hashSecret(password), now());
    startSession(c.res, "customer", cust.id);
    sendStoreEmail(email, "Bienvenido", emailWrap("Tu cuenta esta lista.", `<p>Hola ${escH(cust.name.split(" ")[0])}, ya podes comprar e iniciar sesion con tu correo y contrasena.</p>`)).catch(() => undefined);
    return { id: cust.id, name: cust.name, kind: cust.kind };
  });

  route("POST", "/api/auth/customer/login-email", "public", (c) => {
    const email = String(c.body?.email ?? "").trim().toLowerCase();
    const k = `loginem|${c.ip}|${email}`;
    if (loginLimiter.blocked(k)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Proba en 15 minutos.");
    const cust = custByEmail(email);
    const stored = cust ? db.getSecret(`custpw:${cust.id}`) : undefined;
    if (!cust || !verifyPassword(String(c.body?.password ?? ""), stored)) { loginLimiter.take(k); throw new HttpError(401, "BAD_LOGIN", "Correo o contrasena incorrectos"); }
    loginLimiter.reset(k);
    startSession(c.res, "customer", cust.id);
    return { id: cust.id, name: cust.name, kind: cust.kind };
  });

  route("POST", "/api/me/password", "customer", (c) => {
    const id = c.actor!.customerId!;
    const stored = db.getSecret(`custpw:${id}`);
    const next = String(c.body?.password ?? "");
    if (next.length < 8) throw new DomainError("VALIDATION", "La contrasena nueva necesita al menos 8 caracteres");
    if (stored && !verifyPassword(String(c.body?.current ?? ""), stored)) throw new HttpError(401, "BAD_LOGIN", "La contrasena actual no es correcta");
    // Para revendedores (y clientes sin correo): pueden fijar su correo de acceso acá.
    if (c.body?.email !== undefined && String(c.body.email).trim()) store.catalog.setOwnEmail(c.actor!, String(c.body.email));
    if (!store.engine.s.customers[id].email) throw new DomainError("VALIDATION", "Necesitás un correo para poder entrar con contraseña. Escribilo arriba.");
    db.setSecret(`custpw:${id}`, hashSecret(next), now());
    db.deleteSessionsOf?.(id);
    startSession(c.res, "customer", id);
    return { ok: true };
  });
  route("GET", "/api/me/has-password", "customer", (c) => ({ hasPassword: !!db.getSecret(`custpw:${c.actor!.customerId!}`) }));

  const forgotLimiter = new RateLimiter(5, 60 * 60_000, now);
  route("POST", "/api/auth/customer/forgot", "public", async (c) => {
    const email = String(c.body?.email ?? "").trim().toLowerCase();
    if (!EMAILRE.test(email)) throw new DomainError("VALIDATION", "Correo invalido");
    if (!forgotLimiter.take(`${c.ip}|${email}`)) throw new HttpError(429, "RATE_LIMIT", "Ya pediste varios. Proba en un rato.");
    const cust = custByEmail(email);
    if (cust) {
      const token = newToken().slice(0, 32);
      db.setSecret(`pwreset:${token}`, JSON.stringify({ id: cust.id, exp: now() + 60 * 60_000 }), now());
      const url = `${cfg.publicOrigin ?? `http://${c.req.headers.host}`}/recuperar?t=${token}`;
      try {
        await sendStoreEmail(email, "Recupera tu contrasena", emailWrap("Tocaste 'olvide mi contrasena'.", `<p>Para poner una nueva, entra a este enlace (vale 1 hora):</p><p><a href="${url}" style="display:inline-block;background:#3984ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px">Cambiar mi contrasena</a></p><p style="color:#6b7a99;font-size:12px;word-break:break-all">${url}</p>`));
      } catch (e) {
        throw new DomainError("VALIDATION", (e as Error).message);
      }
    }
    return { ok: true };
  });

  route("GET", "/api/auth/customer/reset/:token", "public", (c) => {
    const raw = db.getSecret(`pwreset:${c.params.token}`);
    const data = raw ? (JSON.parse(raw) as { id: string; exp: number }) : null;
    if (!data || data.exp < now() || !store.engine.s.customers[data.id]) throw new HttpError(404, "BAD_TOKEN", "El enlace vencio o ya se uso. Pedi uno nuevo.");
    return { email: store.engine.s.customers[data.id].email ?? "", name: store.engine.s.customers[data.id].name };
  });
  route("POST", "/api/auth/customer/reset", "public", (c) => {
    const raw = db.getSecret(`pwreset:${String(c.body?.token ?? "")}`);
    const data = raw ? (JSON.parse(raw) as { id: string; exp: number }) : null;
    if (!data || data.exp < now() || !store.engine.s.customers[data.id]) throw new HttpError(404, "BAD_TOKEN", "El enlace vencio o ya se uso. Pedi uno nuevo.");
    const next = String(c.body?.password ?? "");
    if (next.length < 8) throw new DomainError("VALIDATION", "La contrasena necesita al menos 8 caracteres");
    db.setSecret(`custpw:${data.id}`, hashSecret(next), now());
    db.setSecret(`pwreset:${String(c.body?.token)}`, null, now());
    db.deleteSessionsOf?.(data.id);
    startSession(c.res, "customer", data.id);
    return { ok: true };
  });

  /** Link de un solo uso generado por el staff (para mandar a mano por WhatsApp). */
  route("POST", "/api/auth/customer/link", "public", (c) => {
    const token = String(c.body?.token ?? "");
    if (!loginLimiter.take(`link|${c.ip}`)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos");
    const s = token && db.getSession(sha256(token), now());
    if (!s || s.kind !== "link") throw new HttpError(401, "BAD_LINK", "El link venció o ya se usó. Pedí uno nuevo a la tienda.");
    db.deleteSession(s.tokenHash); // un solo uso
    const cust = store.engine.s.customers[s.subjectId];
    if (!cust) throw new HttpError(401, "BAD_LINK", "Cliente inexistente");
    startSession(c.res, "customer", cust.id);
    return { id: cust.id, name: cust.name, kind: cust.kind };
  });

  route("POST", "/api/auth/logout", "public", (c) => {
    if (c.session) db.deleteSession(c.session.tokenHash);
    clearCookie(c.res);
    return { ok: true };
  });

  route("GET", "/api/me", "public", (c) => {
    if (!c.actor) return { loggedIn: false };
    if (c.actor.customerId) {
      const cu = store.engine.s.customers[c.actor.customerId];
      return { loggedIn: true, kind: "customer", role: c.actor.role, id: cu.id, name: cu.name, phone: cu.phone, email: cu.email ?? "", balance: store.wallet.balance(cu.id), whatsappConsent: cu.whatsappConsent, ...(cu.kind === "reseller" ? { pageAllowed: store.shops.pageAllowedFor(cu.id) } : {}) };
    }
    const u = store.engine.s.staff[c.actor.id];
    return { loggedIn: true, kind: "staff", role: u.role, id: u.id, name: u.name, username: u.username };
  });

  /* ---------------- cliente y revendedor ---------------- */
  route("GET", "/api/me/services", "customer", (c) => store.portal.services(c.actor!));
  route("GET", "/api/me/orders", "customer", (c) => store.portal.orders(c.actor!));
  route("GET", "/api/me/ledger", "customer", (c) => store.wallet.history(c.actor!, c.actor!.customerId!));
  route("GET", "/api/me/codes", "customer", (c) => store.portal.codes(c.actor!, String(c.query.get("customerId") ?? c.actor!.customerId)));
  route("PUT", "/api/me/consent", "customer", (c) => (store.catalog.setWhatsappConsent(c.actor!, c.actor!.customerId!, !!c.body?.whatsapp), { ok: true }));
  route("GET", "/api/me/customers", "customer", (c) => store.portal.customers(c.actor!));
  route("POST", "/api/me/customers", "customer", (c) => store.catalog.createCustomer(c.actor!, { name: c.body?.name, phone: c.body?.phone, email: c.body?.email, whatsappConsent: !!c.body?.whatsappConsent }));
  route("PUT", "/api/me/customers/:id", "customer", (c) => store.portal.updateClient(c.actor!, c.params.id, {
    name: c.body?.name, phone: c.body?.phone, whatsappConsent: c.body?.whatsappConsent, note: c.body?.note,
  }));
  route("GET", "/api/me/prices", "customer", (c) => store.portal.priceList(c.actor!));
  /* ---- página propia del revendedor ---- */
  route("GET", "/api/me/shop", "customer", (c) => store.shops.mine(c.actor!));
  route("PUT", "/api/me/shop", "customer", (c) => store.shops.update(c.actor!, c.body ?? {}));
  const shopImage = (kind: "logo" | "banner") => (c: Ctx) => {
    if (c.body?.remove === true) {
      const old = store.shops.setImage(c.actor!, kind, null);
      if (old) dropUpload(old);
      return store.shops.mine(c.actor!);
    }
    const file = saveUpload(c.body);
    if (file.endsWith(".pdf")) { dropUpload(file); throw new HttpError(400, "VALIDATION", "Tiene que ser una imagen (JPG, PNG o WEBP)"); }
    try {
      const old = store.shops.setImage(c.actor!, kind, file);
      if (old) dropUpload(old);
    } catch (e) { dropUpload(file); throw e; }
    return store.shops.mine(c.actor!);
  };
  route("POST", "/api/me/shop/logo", "customer", shopImage("logo"), MAX_UPLOAD_JSON);
  route("POST", "/api/me/shop/banner", "customer", shopImage("banner"), MAX_UPLOAD_JSON);
  route("GET", "/api/resellers/program", "public", () => store.shops.program());
  route("GET", "/api/shops/:slug", "public", (c) => store.shops.public(c.params.slug, c.actor ?? undefined));
  route("GET", "/api/shops/:slug/logo", "public", (c) => sendImage(c, store.shops.image(c.params.slug, "logo", c.actor ?? undefined), "Sin logo"));
  route("GET", "/api/shops/:slug/banner", "public", (c) => sendImage(c, store.shops.image(c.params.slug, "banner", c.actor ?? undefined), "Sin portada"));
  route("GET", "/api/admin/shops", "staff", (c) => store.shops.list(A(c)));
  route("POST", "/api/admin/customers/:id/shop-feature", "staff", (c) => store.shops.setFeatured(A(c), c.params.id, !!c.body?.featured));
  route("GET", "/api/admin/testimonials", "staff", () => store.engine.s.settings.testimonials ?? []);
  route("POST", "/api/admin/testimonials", "staff", (c) => store.shops.setTestimonials(A(c), c.body?.items));
  route("GET", "/api/admin/faq", "staff", () => store.engine.s.settings.faq ?? []);
  route("POST", "/api/admin/faq", "staff", (c) => store.shops.setFaq(A(c), c.body?.items));
  route("POST", "/api/admin/customers/:id/shop-block", "staff", (c) => store.shops.setBlocked(A(c), c.params.id, !!c.body?.blocked));
  route("POST", "/api/admin/customers/:id/reseller-page", "staff", (c) => store.shops.setPage(A(c), c.params.id, !!c.body?.allowed));
  route("PUT", "/api/me/prices", "customer", (c) => store.portal.setPrices(c.actor!, c.body?.prices ?? {}));

  route("POST", "/api/orders", "customer", (c) =>
    store.orders.create(c.actor!, {
      customerId: c.body?.customerId ?? c.actor!.customerId!, items: c.body?.items ?? [],
      paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey,
    }));

  route("POST", "/api/orders/:id/evidence", "customer", (c) => {
    const file = saveUpload(c.body);
    try {
      return store.orders.submitEvidence(c.actor!, c.params.id, { fileRef: file, declaredReference: String(c.body?.declaredReference ?? "") });
    } catch (e) {
      dropUpload(file);
      throw e;
    }
  }, MAX_UPLOAD_JSON);

  route("POST", "/api/orders/:id/cancel", "customer", (c) => store.orders.cancel(c.actor!, c.params.id));

  route("POST", "/api/me/renew", "customer", (c) =>
    store.orders.renew(c.actor!, String(c.body?.assignmentId), { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey }));

  route("POST", "/api/me/topups", "customer", (c) => {
    const file = saveUpload(c.body);
    try {
      return store.orders.requestTopup(c.actor!, c.body?.customerId ?? c.actor!.customerId!, c.body?.amount, { fileRef: file, declaredReference: String(c.body?.declaredReference ?? "") });
    } catch (e) {
      dropUpload(file);
      throw e;
    }
  }, MAX_UPLOAD_JSON);

  /* ---------------- panel (staff) ---------------- */
  const A = (c: Ctx) => c.actor!;
  const snap = () => store.engine.s;

  route("GET", "/api/admin/dashboard", "staff", (c) => store.stats.dashboard(A(c), Number(c.query.get("days") ?? 30)));
  route("GET", "/api/admin/stats", "staff", (c) => store.stats.summary(A(c), { from: Number(c.query.get("from") ?? now() - 30 * 24 * HOUR), to: Number(c.query.get("to") ?? now() + HOUR) }));
  route("GET", "/api/admin/suppliers-report", "staff", (c) => store.stats.suppliers(A(c)));
  route("GET", "/api/admin/audit", "staff", (c) => store.stats.audit(A(c), { action: c.query.get("action") ?? undefined, limit: Number(c.query.get("limit") ?? 200) }));
  route("GET", "/api/admin/stock", "staff", () => store.inventory.stock());
  route("GET", "/api/admin/outbox", "staff", (c) => store.notify.outbox(A(c)).slice(-200).reverse());

  route("GET", "/api/admin/products", "staff", () => Object.values(snap().products));
  route("POST", "/api/admin/products", "staff", (c) => store.catalog.upsertProduct(A(c), c.body));
  route("POST", "/api/admin/products/:id/image", "staff", (c) => {
    if (c.body?.remove === true) {
      const old = store.catalog.setProductImage(A(c), c.params.id, null);
      if (old) dropUpload(old);
      return { ok: true };
    }
    const file = saveUpload(c.body);
    if (file.endsWith(".pdf")) { dropUpload(file); throw new HttpError(400, "VALIDATION", "Tiene que ser una imagen (PNG, JPG o WEBP)"); }
    try {
      const old = store.catalog.setProductImage(A(c), c.params.id, file);
      if (old) dropUpload(old);
    } catch (e) { dropUpload(file); throw e; }
    return { ok: true };
  }, MAX_UPLOAD_JSON);
  route("GET", "/api/admin/price-groups", "staff", () => Object.values(snap().priceGroups));
  route("POST", "/api/admin/price-groups", "staff", (c) => store.catalog.upsertPriceGroup(A(c), c.body));
  route("GET", "/api/admin/suppliers", "staff", () => Object.values(snap().suppliers));
  route("POST", "/api/admin/suppliers", "staff", (c) => store.catalog.upsertSupplier(A(c), c.body));

  route("GET", "/api/admin/accounts", "staff", (c) => store.inventory.listAccounts(A(c), { withSecrets: c.query.get("secrets") === "1" }));
  route("POST", "/api/admin/accounts", "staff", (c) => {
    const b = c.body ?? {};
    return store.inventory.addAccount(A(c), { productId: b.productId, supplierId: b.supplierId, email: b.email, password: b.password, supplierExpiresAt: b.supplierExpiresAt, cost: b.cost, profiles: b.profiles ?? [], notes: b.notes,
      passwordPending: b.passwordPending === true, allowPastSupplierExpiry: b.allowPastSupplierExpiry === true });
  });
  route("POST", "/api/admin/accounts/bulk", "staff", (c) => store.inventory.addAccountsBulk(A(c), c.body?.rows ?? []), 2 * 1024 * 1024);
  route("POST", "/api/admin/accounts/:id/replace", "staff", (c) => store.orders.replaceAccount(A(c), c.params.id, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/accounts/:id", "staff", (c) => {
    const b = c.body ?? {};
    return store.inventory.updateAccount(A(c), c.params.id, {
      email: b.email, password: b.password, supplierId: b.supplierId, supplierExpiresAt: b.supplierExpiresAt, cost: b.cost, notes: b.notes,
    });
  });
  route("POST", "/api/admin/slots/:id", "staff", (c) => store.inventory.updateSlot(A(c), c.params.id, { label: c.body?.label, pin: c.body?.pin }));
  route("POST", "/api/admin/slots/:id/status", "staff", (c) => (store.inventory.setSlotStatus(A(c), c.params.id, c.body?.status, String(c.body?.note ?? "")), { ok: true }));
  route("POST", "/api/admin/slots/:id/free", "staff", (c) => store.orders.releaseSlot(A(c), c.params.id, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/assignments/:id/refund", "staff", (c) => store.orders.refundAssignment(A(c), c.params.id, { amount: c.body?.amount, reason: c.body?.reason }));

  route("GET", "/api/admin/orders", "staff", (c) => store.admin.orders(A(c), { status: (c.query.get("status") ?? undefined) as never, customerId: c.query.get("customerId") ?? undefined }));
  route("POST", "/api/admin/orders", "staff", (c) => store.orders.create(A(c), { customerId: c.body?.customerId, items: c.body?.items ?? [], paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey, preferredSlotIds: Array.isArray(c.body?.preferredSlotIds) ? c.body.preferredSlotIds : undefined }));
  route("POST", "/api/admin/orders/:id/approve", "staff", (c) => store.orders.approvePayment(A(c), c.params.id, { confirmedReference: String(c.body?.confirmedReference ?? ""), idempotencyKey: c.body?.idempotencyKey }));
  route("POST", "/api/admin/orders/:id/reject", "staff", (c) => store.orders.rejectPayment(A(c), c.params.id, String(c.body?.reason ?? "")));
  route("GET", "/api/admin/orders/:id/evidence", "staff", (c) => {
    const ev = store.admin.evidence(A(c), c.params.id);
    const file = join(uploads, ev.fileRef);
    if (!/^[a-f0-9]{32}\.(png|jpg|webp|pdf)$/.test(ev.fileRef) || !existsSync(file)) throw new HttpError(404, "NOT_FOUND", "Archivo no encontrado");
    const type = sniff(readFileSync(file).subarray(0, 16))!;
    c.res.writeHead(200, { "Content-Type": type.mime, "Content-Disposition": "inline", "Cache-Control": "private, no-store" });
    createReadStream(file).pipe(c.res);
    return RAW;
  });

  route("GET", "/api/admin/customers", "staff", (c) => store.admin.customers(A(c), c.query.get("q") ?? ""));
  route("POST", "/api/admin/customers", "staff", (c) => store.catalog.createCustomer(A(c), c.body));
  route("POST", "/api/admin/customers/bulk-kind", "staff", (c) => store.catalog.setCustomersKind(A(c), c.body?.all === true ? "all" : c.body?.ids ?? [], c.body?.kind));
  route("POST", "/api/admin/customers/:id", "staff", (c) => {
    const b = c.body ?? {};
    return store.catalog.updateCustomer(A(c), c.params.id, { name: b.name, phone: b.phone, email: b.email, notes: b.notes, kind: b.kind, priceGroupId: b.priceGroupId });
  });
  route("GET", "/api/admin/customers/:id/ledger", "staff", (c) => store.wallet.history(A(c), c.params.id));
  route("POST", "/api/admin/customers/:id/adjust", "staff", (c) => store.wallet.adjust(A(c), c.params.id, c.body?.amount, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/customers/:id/consent", "staff", (c) => (store.catalog.setWhatsappConsent(A(c), c.params.id, !!c.body?.whatsapp), { ok: true }));
  route("GET", "/api/admin/resellers", "staff", (c) => {
    const st = store.engine.s.settings;
    return { list: store.shops.resellers(A(c)), apps: store.shops.apps(A(c)), rent: st.shopRent ?? { enabled: false, price: 3000, freeIfSpent: 20000, graceDays: 3 }, marginPct: st.resellerMarginPct ?? 30 };
  });
  route("POST", "/api/admin/reseller-apps/:id/approve", "staff", (c) => {
    const r = store.shops.approve(A(c), c.params.id);
    // Por defecto entra con plan "solo panel"; si pedís la página, se la habilitás después.
    const pin = randomPin();
    setLoginPin(r.customerId, pin);
    return { ...r, pin };
  });
  route("POST", "/api/admin/reseller-apps/:id/reject", "staff", (c) => (store.shops.reject(A(c), c.params.id), { ok: true }));
  const applyLimiter = new RateLimiter(3, 60 * 60_000, now);
  route("POST", "/api/resellers/apply", "public", (c) => {
    if (!applyLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Ya mandaste solicitudes. Probá en una hora o escribinos por WhatsApp.");
    return store.shops.apply({ name: c.body?.name, phone: c.body?.phone, note: c.body?.note });
  });
  route("POST", "/api/me/shop/pay", "customer", (c) => store.shops.payRent(c.actor!));
  route("POST", "/api/admin/customers/:id/shop", "staff", (c) => store.shops.setupFor(A(c), c.params.id, c.body ?? {}));
  route("POST", "/api/admin/customers/:id/login-link", "staff", (c) => {
    if (!store.catalog.canActFor(A(c), c.params.id)) throw new HttpError(403, "FORBIDDEN", "Sin permiso");
    const cust = store.engine.s.customers[c.params.id];
    if (!cust) throw new HttpError(404, "NOT_FOUND", "Cliente inexistente");
    store.engine.tx(() => store.engine.audit(A(c), "customer.login_link", "customer", cust.id));
    return { url: makeLoginLink(cust.id, cfg.publicOrigin ?? `http://${c.req.headers.host}`), expiresAt: now() + LINK_MS };
  });

  route("GET", "/api/admin/assignments", "staff", (c) => store.admin.assignments(A(c), {
    customerId: c.query.get("customerId") ?? undefined, productId: c.query.get("productId") ?? undefined,
    expiringWithinDays: c.query.has("days") ? Number(c.query.get("days")) : undefined,
  }));
  route("GET", "/api/admin/assignments/:id/delivery", "staff", (c) => store.admin.delivery(A(c), c.params.id));
  route("POST", "/api/admin/assignments/:id/control", "staff", (c) => store.orders.setControl(A(c), c.params.id, {
    price: c.body?.price, cost: c.body?.cost, payStatus: c.body?.payStatus, note: c.body?.note, seller: c.body?.seller, startedAt: c.body?.startedAt,
  }));
  route("POST", "/api/admin/assignments/:id/expiry", "staff", (c) => store.orders.setExpiry(A(c), c.params.id, Number(c.body?.expiresAt), c.body?.note));
  route("POST", "/api/admin/assignments/:id/renew", "staff", (c) => store.orders.renew(A(c), c.params.id, { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod ?? "cash", allowBeyondSupplier: c.body?.allowBeyondSupplier, idempotencyKey: c.body?.idempotencyKey }));
  route("POST", "/api/admin/assignments/renew-many", "staff", (c) => store.orders.renewMany(A(c), c.body?.ids ?? [], { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod ?? "cash", batchKey: c.body?.batchKey, allowBeyondSupplier: c.body?.allowBeyondSupplier === true }));
  route("POST", "/api/admin/assignments/:id/transfer", "staff", (c) => store.orders.transfer(A(c), c.params.id, String(c.body?.toCustomerId ?? ""), String(c.body?.reason ?? "")));
  route("POST", "/api/admin/assignments/:id/replace", "staff", (c) => store.orders.replace(A(c), c.params.id, { reason: String(c.body?.reason ?? ""), oldSlot: c.body?.oldSlot, otherAccount: !!c.body?.otherAccount }));
  route("GET", "/api/admin/reminders/settings", "staff", () => store.orders.reminderSettings());
  route("POST", "/api/admin/reminders/settings", "staff", (c) => store.orders.updateReminderSettings(A(c), {
    enabled: c.body?.enabled, daysBefore: c.body?.daysBefore, fromHour: c.body?.fromHour, toHour: c.body?.toHour,
  }));
  route("POST", "/api/admin/reminders", "staff", (c) => ({ queued: store.orders.queueExpiryReminders(A(c), Number(c.body?.withinDays ?? 3)) }));

  route("GET", "/api/admin/staff", "staff", (c) => store.admin.listStaff(A(c)));
  route("POST", "/api/admin/staff", "staff", (c) => store.admin.createStaff(A(c), { username: c.body?.username, name: c.body?.name, role: c.body?.role, passwordHash: hashOrThrow(c.body?.password) }));
  route("POST", "/api/admin/staff/:id/active", "staff", (c) => {
    const u = store.admin.setStaffActive(A(c), c.params.id, !!c.body?.active);
    if (!u.active) db.deleteSessionsOf(u.id);
    return u;
  });
  /* ---- verificación en dos pasos del usuario actual ---- */
  route("GET", "/api/admin/me/2fa", "staff", (c) => ({ enabled: !!db.getSecret(`totp:${A(c).id}`) }));
  route("POST", "/api/admin/me/2fa/setup", "staff", (c) => {
    const me = store.engine.s.staff[A(c).id];
    if (db.getSecret(`totp:${me.id}`)) throw new HttpError(400, "VALIDATION", "Ya tenés la verificación en dos pasos activada");
    const secret = newTotpSecret();
    db.setSecret(`totp_pending:${me.id}`, secret, now());
    const issuer = encodeURIComponent(store.engine.s.settings.platformName || "GaboHub");
    return { secret, uri: `otpauth://totp/${issuer}:${encodeURIComponent(me.username)}?secret=${secret}&issuer=${issuer}&digits=6&period=30` };
  });
  route("POST", "/api/admin/me/2fa/enable", "staff", (c) => {
    const me = store.engine.s.staff[A(c).id];
    const pending = db.getSecret(`totp_pending:${me.id}`);
    if (!pending) throw new HttpError(400, "VALIDATION", "Primero tocá “Activar” para generar tu clave");
    if (verifyTotp(pending, String(c.body?.code ?? ""), now()) === null) throw new HttpError(400, "BAD_TOTP", "El código no coincide. Revisá que la hora del celular esté bien y probá con el código nuevo");
    db.setSecret(`totp:${me.id}`, pending, now());
    db.setSecret(`totp_pending:${me.id}`, null, now());
    store.engine.tx(() => store.engine.audit(A(c), "staff.2fa_on", "staff", me.id));
    return { enabled: true };
  });
  route("POST", "/api/admin/me/2fa/disable", "staff", (c) => {
    const me = store.engine.s.staff[A(c).id];
    const secret = db.getSecret(`totp:${me.id}`);
    if (!secret) return { enabled: false };
    if (!verifyPassword(String(c.body?.password ?? ""), me.passwordHash)) throw new HttpError(401, "BAD_LOGIN", "La contraseña no coincide");
    if (verifyTotp(secret, String(c.body?.code ?? ""), now()) === null) throw new HttpError(401, "BAD_TOTP", "Código incorrecto");
    db.setSecret(`totp:${me.id}`, null, now());
    store.engine.tx(() => store.engine.audit(A(c), "staff.2fa_off", "staff", me.id));
    return { enabled: false };
  });

  route("POST", "/api/admin/me/password", "staff", (c) => {
    const me = store.engine.s.staff[A(c).id];
    if (!verifyPassword(String(c.body?.current ?? ""), me.passwordHash)) throw new HttpError(401, "BAD_LOGIN", "La contraseña actual no coincide");
    store.admin.setStaffPassword(A(c), me.id, hashOrThrow(c.body?.next));
    db.deleteSessionsOf(me.id);
    startSession(c.res, "staff", me.id);
    return { ok: true };
  });

  route("POST", "/api/admin/settings", "staff", (c) => {
    const b = c.body ?? {};
    const pick: Record<string, unknown> = ["storeName", "whatsapp", "paymentNote", "platformName", ...LOOK_KEYS]
      .filter((k) => typeof b[k] === "string").reduce((o, k) => ({ ...o, [k]: b[k] }), {});
    if (Array.isArray(b.comboDiscounts)) pick.comboDiscounts = b.comboDiscounts;
    if (b.shopRent && typeof b.shopRent === "object") pick.shopRent = b.shopRent;
    if (b.resellerMarginPct !== undefined) pick.resellerMarginPct = b.resellerMarginPct;
    if (typeof b.resellerShops === "boolean") pick.resellerShops = b.resellerShops;
    if (typeof b.resellerProgramPrices === "boolean") pick.resellerProgramPrices = b.resellerProgramPrices;
    return store.catalog.updateSettings(A(c), pick);
  });
  const imageSetting = (key: "qrFileRef" | "logoFileRef", what: string) => (c: Ctx) => {
    const file = saveUpload(c.body);
    if (file.endsWith(".pdf")) {
      dropUpload(file);
      throw new HttpError(400, "VALIDATION", `${what} tiene que ser una imagen (JPG, PNG o WEBP)`);
    }
    const old = store.engine.s.settings[key];
    try {
      const out = store.catalog.updateSettings(A(c), { [key]: file });
      if (old) dropUpload(old);
      return out;
    } catch (e) {
      dropUpload(file);
      throw e;
    }
  };
  route("POST", "/api/admin/settings/qr", "staff", imageSetting("qrFileRef", "El QR"), MAX_UPLOAD_JSON);
  route("POST", "/api/admin/settings/logo", "staff", imageSetting("logoFileRef", "El logo"), MAX_UPLOAD_JSON);
  route("POST", "/api/admin/settings/logo/remove", "staff", (c) => {
    const old = store.engine.s.settings.logoFileRef;
    const out = store.catalog.updateSettings(A(c), { logoFileRef: "" });
    if (old) dropUpload(old);
    return out;
  });
  route("POST", "/api/admin/outbox/:id/sent", "staff", (c) => store.notify.markSentManually(A(c), c.params.id));

  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const sendFile = (c: Ctx, buf: Buffer, name: string) => {
    c.res.writeHead(200, { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "Content-Length": buf.length });
    c.res.end(buf);
    return RAW;
  };
  /* ---- respaldos (solo el dueño: contienen contraseñas y claves) ---- */
  const ownerOnly = (c: Ctx) => { if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño maneja los respaldos"); };
  route("GET", "/api/admin/backups", "staff", (c) => { ownerOnly(c); return { items: backups.list(), keep: 30 }; });
  route("POST", "/api/admin/backups", "staff", (c) => {
    ownerOnly(c);
    const b = backups.create();
    store.engine.tx(() => store.engine.audit(A(c), "backup.create", "backup", b.name, { bytes: b.bytes }));
    return b;
  });
  route("GET", "/api/admin/backups/:name", "staff", (c) => {
    ownerOnly(c);
    let buf: Buffer;
    try { buf = backups.read(c.params.name); } catch { throw new HttpError(404, "NOT_FOUND", "Respaldo inexistente"); }
    store.engine.tx(() => store.engine.audit(A(c), "backup.download", "backup", c.params.name, { bytes: buf.length }));
    c.res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${c.params.name}"`, "Cache-Control": "private, no-store", "Content-Length": buf.length });
    c.res.end(buf);
    return RAW;
  });

  /* ---- avisos para el dueño ---- */
  route("GET", "/api/admin/alerts", "staff", (c) => { ownerOnly(c); return store.orders.staffAlerts(); });
  route("POST", "/api/admin/alerts", "staff", (c) => store.orders.updateStaffAlerts(A(c), {
    phone: c.body?.phone, payments: c.body?.payments, supplierExpiry: c.body?.supplierExpiry, supplierDaysBefore: c.body?.supplierDaysBefore,
  }));

  route("GET", "/api/admin/export/:kind", "staff", (c) => {
    const kind = c.params.kind as ExportKind;
    if (!EXPORT_KINDS.includes(kind)) throw new HttpError(404, "NOT_FOUND", "Exportación inexistente");
    const { file, name } = buildExport(store, A(c), kind, { withSecrets: c.query.get("secrets") === "1" });
    return sendFile(c, file, name);
  });
  route("GET", "/api/admin/import/template", "staff", (c) => c.query.get("type") === "services"
    ? sendFile(c, servicesTemplate(), "plantilla-servicios.xlsx")
    : sendFile(c, customersTemplate(), "plantilla-clientes.xlsx"));
  route("POST", "/api/admin/import/services", "staff", (c) => {
    if (typeof c.body?.contentBase64 !== "string") throw new HttpError(400, "VALIDATION", "Falta el archivo");
    const buf = Buffer.from(c.body.contentBase64, "base64");
    if (!buf.length || buf.length > MAX_FILE) throw new HttpError(400, "VALIDATION", "El archivo debe pesar hasta 5 MB");
    return importServicesFile(store, A(c), buf, { dryRun: c.body?.dryRun !== false });
  }, MAX_UPLOAD_JSON);
  route("POST", "/api/admin/import/customers", "staff", (c) => {
    if (typeof c.body?.contentBase64 !== "string") throw new HttpError(400, "VALIDATION", "Falta el archivo");
    const buf = Buffer.from(c.body.contentBase64, "base64");
    if (!buf.length || buf.length > MAX_FILE) throw new HttpError(400, "VALIDATION", "El archivo debe pesar hasta 5 MB");
    return importCustomers(store, A(c), buf, { dryRun: c.body?.dryRun !== false });
  }, MAX_UPLOAD_JSON);

  // ---- Panel de códigos: buzones conectados por IMAP (Gmail con contraseña de aplicación u otro) ----
  const mailInput = (b: Record<string, unknown> | undefined) => {
    const kind = b?.kind === "imap" ? "imap" : "gmail";
    const address = String(b?.address ?? "").trim().toLowerCase();
    const subjects = typeof b?.subjects === "string" ? b.subjects.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) : undefined;
    const senders = typeof b?.senders === "string" ? b.senders.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) : undefined;
    return {
      id: b?.id ? String(b.id) : undefined, kind, address, name: b?.name ? String(b.name) : undefined, subjectAllowlist: subjects, senderAllowlist: senders,
      host: kind === "gmail" ? "imap.gmail.com" : String(b?.host ?? "").trim(),
      port: kind === "gmail" ? 993 : Number(b?.port || 993),
      user: kind === "gmail" ? address : String(b?.user ?? "").trim() || address,
      password: typeof b?.password === "string" ? (kind === "gmail" ? b.password.replace(/\s+/g, "") : b.password) : "",
    } as const;
  };
  const imapOf = (box: { host: string; port?: number; user?: string; address: string }, pass: string): ImapConfig => ({ host: box.host, port: box.port ?? 993, user: box.user ?? box.address, pass, ...(cfg.imapTest ?? {}) });
  const passOf = (id: string) => { const v = db.getSecret(`imap:${id}`); return v ? db.unseal(v) : ""; };
  const mailOwner = (c: Ctx) => { if (A(c).role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño conecta correos"); };
  route("GET", "/api/admin/mailboxes", "staff", (c) => store.codes.list(A(c)).map((m) => ({ ...m, hasPassword: !!db.getSecret(`imap:${m.id}`) })));
  route("POST", "/api/admin/mailboxes/test", "staff", async (c) => {
    mailOwner(c);
    const m = mailInput(c.body);
    const pass = m.password || (m.id ? passOf(m.id) : "");
    if (!pass) throw new DomainError("VALIDATION", "Escribí la contraseña de aplicación");
    try { return { ok: true, ...(await testImap(imapOf(m, pass))) }; } catch (e) { throw new DomainError("VALIDATION", (e as Error).message); }
  });
  route("POST", "/api/admin/mailboxes", "staff", async (c) => {
    mailOwner(c);
    const m = mailInput(c.body);
    if (!m.id && !m.password) throw new DomainError("VALIDATION", "Escribí la contraseña de aplicación");
    if (m.password) {
      try { await testImap(imapOf(m, m.password)); } catch (e) { throw new DomainError("VALIDATION", `No se pudo conectar: ${(e as Error).message}`); }
    }
    const box = store.codes.configureMailbox(A(c), m);
    if (m.password) db.setSecret(`imap:${box.id}`, db.seal(m.password), now());
    pollMail(box.id).catch(() => undefined);
    return box;
  });
  route("POST", "/api/admin/mailboxes/:id/check", "staff", async (c) => {
    mailOwner(c);
    if (!store.engine.s.mailboxes[c.params.id]) throw new DomainError("NOT_FOUND", "Correo inexistente");
    const r = await pollMail(c.params.id);
    return { ...r, mailbox: store.engine.s.mailboxes[c.params.id] };
  });
  route("POST", "/api/admin/mailboxes/:id/delete", "staff", (c) => {
    store.codes.remove(A(c), c.params.id);
    db.setSecret(`imap:${c.params.id}`, null, now());
    return { ok: true };
  });
  route("GET", "/api/admin/codes", "staff", (c) => store.codes.recent(A(c), 60));

  // ---- Link de códigos con PIN (para revendedores y sus clientes): /codigos/<token> ----
  const codeLinkUrl = (token: string, c: Ctx) => `${cfg.publicOrigin ?? `http://${c.req.headers.host}`}/codigos/${token}`;
  // El PIN se guarda con scrypt (como las contraseñas), junto con el id para que no sea reutilizable entre clientes.
  const pinKey = (customerId: string, pin: string) => `codepin|${customerId}|${pin}`;
  const linkTokenFor = (customerId: string, keepToken: boolean) => {
    const cur = store.engine.s.customers[customerId]?.codeLink;
    return keepToken && cur ? cur.token : newToken().slice(0, 24);
  };
  // Link con PIN (privado): cada cliente pone un PIN de 4 números.
  const makeCodeLink = (customerId: string, pin: unknown, actor: Actor, c: Ctx, keepToken = false) => {
    const p = String(pin ?? "").trim();
    if (!/^\d{4}$/.test(p)) throw new DomainError("VALIDATION", "El PIN tiene que ser de 4 números");
    const token = linkTokenFor(customerId, keepToken);
    store.codes.setLink(actor, customerId, token);
    db.setSecret(`codepin:${customerId}`, hashPassword(pinKey(customerId, p)), now());
    return { url: codeLinkUrl(token, c), pin: p, mode: "pin" };
  };
  // Link "escribí tu correo" (sin PIN): un solo link para todos los clientes del revendedor.
  const makeEmailLink = (customerId: string, actor: Actor, c: Ctx, keepToken = false) => {
    const token = linkTokenFor(customerId, keepToken);
    store.codes.setLink(actor, customerId, token);
    db.setSecret(`codepin:${customerId}`, null, now());
    return { url: codeLinkUrl(token, c), mode: "email" };
  };
  // Con PIN si lo mandan; si no, modo correo (lo más simple).
  const makeAnyLink = (customerId: string, actor: Actor, c: Ctx) =>
    c.body?.pin ? makeCodeLink(customerId, c.body.pin, actor, c, !!c.body?.keepLink) : makeEmailLink(customerId, actor, c, !!c.body?.keepLink);
  route("POST", "/api/admin/customers/:id/code-link", "staff", (c) => {
    if (c.body?.off) { store.codes.setLink(A(c), c.params.id, null); db.setSecret(`codepin:${c.params.id}`, null, now()); return { ok: true }; }
    return makeAnyLink(c.params.id, A(c), c);
  });
  route("GET", "/api/me/code-link", "customer", (c) => {
    const cl = store.engine.s.customers[c.actor!.customerId!]?.codeLink;
    return cl ? { url: codeLinkUrl(cl.token, c), mode: linkMode(c.actor!.customerId!) } : { url: null };
  });
  route("POST", "/api/me/code-link", "customer", (c) => {
    if (c.actor!.role !== "reseller") throw new HttpError(403, "FORBIDDEN", "Solo para revendedores");
    if (c.body?.off) { store.codes.setLink(c.actor!, c.actor!.customerId!, null); db.setSecret(`codepin:${c.actor!.customerId!}`, null, now()); return { ok: true }; }
    return makeAnyLink(c.actor!.customerId!, c.actor!, c);
  });
  // Un revendedor arma un link de códigos propio para CADA cliente suyo (con PIN).
  const ownClient = (c: Ctx) => { const cl = store.engine.s.customers[c.params.id]; if (!cl || cl.resellerId !== c.actor!.customerId) throw new HttpError(404, "NOT_FOUND", "Ese cliente no es tuyo"); return cl; };
  route("GET", "/api/me/clients/:id/code-link", "customer", (c) => {
    if (c.actor!.role !== "reseller") throw new HttpError(403, "FORBIDDEN", "Solo para revendedores");
    const cl = ownClient(c);
    return cl.codeLink ? { url: codeLinkUrl(cl.codeLink.token, c), mode: linkMode(cl.id) } : { url: null };
  });
  route("POST", "/api/me/clients/:id/code-link", "customer", (c) => {
    if (c.actor!.role !== "reseller") throw new HttpError(403, "FORBIDDEN", "Solo para revendedores");
    const cl = ownClient(c);
    if (c.body?.off) { store.codes.setLink(c.actor!, cl.id, null); db.setSecret(`codepin:${cl.id}`, null, now()); return { ok: true }; }
    return makeAnyLink(cl.id, c.actor!, c);
  });
  const pinLimiter = new RateLimiter(5, 15 * 60_000, now);
  const pinTokenLimiter = new RateLimiter(20, 15 * 60_000, now);
  // Modo "escribí tu correo" (sin PIN): se limita por si prueban muchos correos distintos.
  const emailLookupLimiter = new RateLimiter(60, 15 * 60_000, now);
  const linkMode = (customerId: string) => (db.getSecret(`codepin:${customerId}`) ? "pin" : "email");
  route("GET", "/api/code-link/:token", "public", (c) => {
    const o = store.codes.linkOwner(c.params.token);
    if (!o) throw new HttpError(404, "NOT_FOUND", "Este link no existe o fue cambiado");
    return { name: o.name, mode: linkMode(o.customerId) };
  });
  route("POST", "/api/code-link/:token", "public", (c) => {
    const o = store.codes.linkOwner(c.params.token);
    if (!o) throw new HttpError(404, "NOT_FOUND", "Este link no existe o fue cambiado");
    const minutes = store.engine.opts.codeVisibleMinutes;
    // Modo correo: el cliente escribe el correo de su cuenta y ve solo ese código (sin PIN).
    if (linkMode(o.customerId) === "email") {
      const email = String(c.body?.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "BAD_EMAIL", "Escribí un correo válido");
      const kl = `${c.params.token}|${c.ip}`;
      if (emailLookupLimiter.blocked(kl)) throw new HttpError(429, "RATE_LIMIT", "Demasiadas consultas. Probá en 15 minutos.");
      emailLookupLimiter.take(kl);
      const codes = store.codes.of(o.customerId).filter((x) => x.to === email);
      return { name: o.name, email, codes, minutes };
    }
    // Modo PIN (links viejos o privados): verifica el PIN y muestra todos los códigos.
    const k = `${c.params.token}|${c.ip}`;
    if (pinLimiter.blocked(k) || pinTokenLimiter.blocked(c.params.token)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Probá en 15 minutos.");
    if (!verifyPassword(pinKey(o.customerId, String(c.body?.pin ?? "")), db.getSecret(`codepin:${o.customerId}`))) {
      pinLimiter.take(k); pinTokenLimiter.take(c.params.token);
      throw new HttpError(401, "BAD_PIN", "PIN incorrecto");
    }
    return { name: o.name, codes: store.codes.of(o.customerId), minutes };
  });

  // ---- Copia del respaldo fuera del servidor: se guarda como correo en una carpeta de tu Gmail ----
  route("GET", "/api/admin/offsite", "staff", (c) => {
    mailOwner(c);
    const o = offsiteCfg();
    return { ...o, hasPassword: !!db.getSecret("offsite:pass"), folder: OFFSITE_FOLDER, mailboxes: Object.values(store.engine.s.mailboxes).filter((m) => db.getSecret(`imap:${m.id}`)).map((m) => ({ id: m.id, address: m.address })) };
  });
  route("POST", "/api/admin/offsite", "staff", async (c) => {
    mailOwner(c);
    const b = c.body ?? {};
    const cur = offsiteCfg();
    const next: OffsiteCfg = { ...cur, enabled: !!b.enabled };
    if (b.mailboxId) { if (!store.engine.s.mailboxes[String(b.mailboxId)]) throw new DomainError("NOT_FOUND", "Ese correo ya no está conectado"); next.mailboxId = String(b.mailboxId); delete next.address; }
    else if (b.address) {
      const address = String(b.address).trim().toLowerCase();
      if (!/^[^\s@]+@gmail\.com$/.test(address)) throw new DomainError("VALIDATION", "Usá un Gmail (…@gmail.com)");
      const pass = typeof b.password === "string" ? b.password.replace(/\s+/g, "") : "";
      if (pass) {
        try { await testImap({ host: "imap.gmail.com", port: 993, user: address, pass, ...(cfg.imapTest ?? {}) }); } catch (e) { throw new DomainError("VALIDATION", `No se pudo conectar: ${(e as Error).message}`); }
        db.setSecret("offsite:pass", db.seal(pass), now());
      } else if (!db.getSecret("offsite:pass") || cur.address !== address) throw new DomainError("VALIDATION", "Escribí la contraseña de aplicación de ese Gmail");
      next.address = address; delete next.mailboxId;
    }
    if (next.enabled && !offsiteTarget(next)) throw new DomainError("VALIDATION", "Elegí el Gmail donde se guardan los respaldos");
    db.setSecret("offsite:cfg", JSON.stringify(next), now());
    store.engine.tx(() => store.engine.audit(A(c), "backup.offsite_config", "settings", "offsite", { enabled: next.enabled }));
    return next;
  });
  route("POST", "/api/admin/offsite/send", "staff", async (c) => {
    mailOwner(c);
    await sendOffsite();
    return offsiteCfg();
  });

  function hashOrThrow(p: unknown): string {
    try {
      return hashPassword(String(p ?? ""));
    } catch (e) {
      throw new HttpError(400, "VALIDATION", (e as Error).message);
    }
  }

  /* ---------------- WhatsApp oficial (Meta) ---------------- */
  function makeLoginLink(customerId: string, base: string): string {
    const token = newToken();
    db.putSession({ tokenHash: sha256(token), kind: "link", subjectId: customerId, createdAt: now(), expiresAt: now() + LINK_MS });
    const kind = store.engine.s.customers[customerId]?.kind;
    return `${base}${kind === "reseller" ? "/" : "/tienda/"}#acceso=${token}`;
  }

  const waSecret = (k: "token" | "appSecret") => db.getSecret(k === "token" ? "wa_token" : "wa_app_secret");
  function verifyToken(): string {
    let v = db.getSecret("wa_verify_token");
    if (!v) {
      v = newToken().slice(0, 24);
      db.setSecret("wa_verify_token", v, now());
    }
    return v;
  }
  /** Cliente de Meta si hay Phone number ID y token (aunque el bot esté apagado, para probar). */
  function cloud(): WhatsAppCloud | null {
    const b = store.chats.botSettings();
    const token = waSecret("token");
    if (!b.phoneNumberId || !token) return null;
    return new WhatsAppCloud({ phoneNumberId: b.phoneNumberId, apiVersion: b.apiVersion, accessToken: token }, cfg.fetchImpl ?? fetch, cfg.metaBaseUrl);
  }
  const botOn = () => store.chats.botSettings().enabled && !!cloud();

  /** El código de acceso del cliente sale por WhatsApp si hay plantilla "login_code" aprobada. */
  function otpSender(): AppConfig["otpSender"] {
    if (cfg.otpSender) return cfg.otpSender;
    const tpl = store.chats.botSettings().templates.login_code;
    if (!botOn() || !tpl) return undefined;
    return async (phone, code) => {
      await cloud()!.sendTemplate(phone, tpl.name, tpl.lang, [code], { copyCodeButton: code });
    };
  }

  const botLimiter = new RateLimiter(8, 5 * 60_000, now);

  async function sendChat(phone: string, text: string, by: "bot" | "staff"): Promise<void> {
    const c = cloud();
    if (!c) throw new HttpError(409, "WA_OFF", "WhatsApp no está configurado");
    try {
      const r = await c.sendText(phone, text);
      store.chats.recordOutbound(phone, { text, by, waId: r.waId });
    } catch (e) {
      store.chats.recordOutbound(phone, { text, by, error: (e as Error).message });
      throw e;
    }
  }

  async function handleInbound(m: InboundMessage): Promise<void> {
    const phone = "+" + m.from.replace(/\D/g, "");
    const { duplicate } = store.chats.recordInbound({ phone, text: m.text, waId: m.waId, name: m.name, at: m.timestamp || undefined });
    if (duplicate || !botOn()) return;
    void cloud()!.markRead(m.waId);
    if (store.chats.botPaused(phone)) return;
    if (!botLimiter.take(phone)) return;
    const a = botAnswer({ store, origin: cfg.publicOrigin, loginLink: (id) => (cfg.publicOrigin ? makeLoginLink(id, cfg.publicOrigin) : null) }, phone, m.text, m.name);
    const cust = Object.values(store.engine.s.customers).find((x) => x.phone === phone);
    if (a.consent !== undefined && cust) store.catalog.setWhatsappConsent({ id: `wa:${cust.id}`, role: "customer", customerId: cust.id }, cust.id, a.consent);
    if (a.human) store.chats.requestHuman(phone, store.chats.botSettings().humanPauseHours);
    for (const text of a.replies) await sendChat(phone, text, "bot");
    if (a.sendQr && cfg.publicOrigin) {
      try {
        const r = await cloud()!.sendImage(phone, `${cfg.publicOrigin}/api/settings/qr`, "QR de cobro");
        store.chats.recordOutbound(phone, { text: "[imagen: QR de cobro]", by: "bot", waId: r.waId });
      } catch (e) {
        log(`no se pudo mandar el QR: ${(e as Error).message}`);
      }
    }
  }

  let flushing = false;
  /** Manda los avisos pendientes: texto si el cliente escribió en 24 h, si no plantilla aprobada. */
  async function flushWhatsApp(): Promise<{ sent: number; failed: number; pending: number }> {
    const res = { sent: 0, failed: 0, pending: 0 };
    if (flushing || !botOn()) return res;
    flushing = true;
    try {
      const b = store.chats.botSettings();
      const queue = store.engine.s.outbox.filter((m) => m.status === "queued").slice(0, 50).map((m) => structuredClone(m));
      for (const m of queue) {
        const tpl = b.templates[m.template];
        try {
          let waId: string | undefined;
          if (store.chats.inWindow(m.to)) waId = (await cloud()!.sendText(m.to, m.text)).waId;
          else if (tpl) waId = (await cloud()!.sendTemplate(m.to, tpl.name, tpl.lang, templateParamOrder(m.template).map((k) => m.params[k] ?? ""))).waId;
          else {
            store.notify.markSendResult(system, m.id, { ok: false, retry: false, error: `Sin plantilla aprobada para «${m.template}» y el cliente no escribió en 24 h. Cargá la plantilla o mandalo a mano.` });
            res.failed++;
            continue;
          }
          store.notify.markSendResult(system, m.id, { ok: true, waId });
          store.chats.recordOutbound(m.to, { text: m.text, by: "sistema", waId });
          res.sent++;
        } catch (e) {
          const retry = e instanceof WaError ? e.retryable : true;
          store.notify.markSendResult(system, m.id, { ok: false, retry, error: (e as Error).message });
          if (retry) res.pending++; else res.failed++;
        }
      }
    } finally {
      flushing = false;
    }
    return res;
  }

  // Meta verifica la URL del webhook con un GET.
  route("GET", "/api/whatsapp/webhook", "public", (c) => {
    const ok = c.query.get("hub.mode") === "subscribe" && c.query.get("hub.verify_token") === verifyToken();
    c.res.writeHead(ok ? 200 : 403, { "Content-Type": "text/plain; charset=utf-8" });
    c.res.end(ok ? String(c.query.get("hub.challenge") ?? "") : "token de verificación incorrecto");
    return RAW;
  });
  // Mensajes y estados. Se responde 200 enseguida (Meta reintenta si tardamos) y se procesa después.
  route("POST", "/api/whatsapp/webhook", "public", (c) => {
    const secret = waSecret("appSecret");
    if (!secret || !c.raw || !verifySignature(c.raw, c.req.headers["x-hub-signature-256"] as string | undefined, secret)) {
      throw new HttpError(403, "BAD_SIGNATURE", "Firma inválida");
    }
    const { messages, statuses } = parseWebhook(c.body);
    send(c.res, 200, { ok: true });
    void (async () => {
      for (const st of statuses) store.chats.recordStatus(st.waId, st.status, st.error);
      for (const m of messages) {
        try {
          await handleInbound(m);
        } catch (e) {
          log(`bot: ${(e as Error).message}`);
        }
      }
    })();
    return RAW;
  }, 1024 * 1024);

  const ownerOrAdmin = (c: Ctx) => {
    if (A(c).role !== "owner" && A(c).role !== "admin") throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin");
  };
  const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : null);

  route("GET", "/api/admin/whatsapp/config", "staff", (c) => {
    ownerOrAdmin(c);
    const b = store.chats.botSettings();
    const tplIds = Object.keys(TEMPLATES) as TemplateId[];
    return {
      settings: b,
      secrets: { token: mask(waSecret("token")), appSecret: mask(waSecret("appSecret")) },
      verifyToken: A(c).role === "owner" ? verifyToken() : null,
      webhookUrl: cfg.publicOrigin ? `${cfg.publicOrigin}/api/whatsapp/webhook` : null,
      publicOrigin: cfg.publicOrigin ?? null,
      ready: { phoneNumberId: !!b.phoneNumberId, token: !!waSecret("token"), appSecret: !!waSecret("appSecret"), https: !!cfg.publicOrigin?.startsWith("https://"), enabled: b.enabled },
      templates: [
        ...tplIds.map((id) => ({ id, body: metaTemplateBody(id), params: templateParamOrder(id), configured: b.templates[id] ?? null, category: "UTILITY" })),
        { id: "login_code", body: "{{1}} es tu código de verificación.", params: ["code"], configured: b.templates.login_code ?? null, category: "AUTHENTICATION" },
      ],
      pending: store.engine.s.outbox.filter((m) => m.status === "queued").length,
    };
  });
  route("POST", "/api/admin/whatsapp/config", "staff", (c) => store.chats.updateBotSettings(A(c), c.body ?? {}));
  route("POST", "/api/admin/whatsapp/secrets", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño carga las claves de Meta");
    const b = c.body ?? {};
    const changed: string[] = [];
    if (typeof b.accessToken === "string") {
      if (b.accessToken && !/^[A-Za-z0-9_\-.|]{20,1000}$/.test(b.accessToken.trim())) throw new HttpError(400, "VALIDATION", "El token no parece válido");
      db.setSecret("wa_token", b.accessToken.trim() || null, now()); changed.push("token");
    }
    if (typeof b.appSecret === "string") {
      if (b.appSecret && !/^[a-f0-9]{32}$/i.test(b.appSecret.trim())) throw new HttpError(400, "VALIDATION", "El App Secret son 32 caracteres (Meta → Configuración de la app → Básica)");
      db.setSecret("wa_app_secret", b.appSecret.trim() || null, now()); changed.push("appSecret");
    }
    if (b.regenerateVerifyToken) { db.setSecret("wa_verify_token", null, now()); verifyToken(); changed.push("verifyToken"); }
    store.engine.tx(() => store.engine.audit(A(c), "whatsapp.secrets", "settings", "whatsapp", { changed: changed.join(",") }));
    return { ok: true, changed };
  });
  route("POST", "/api/admin/whatsapp/test", "staff", async (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño");
    const cl = cloud();
    if (!cl) throw new HttpError(409, "WA_OFF", "Falta el Phone number ID o el token");
    const to = String(c.body?.to ?? "").replace(/\D/g, "");
    if (to.length < 8) throw new HttpError(400, "VALIDATION", "Número de prueba inválido (con código de país)");
    try {
      // "hello_world" viene aprobada en toda cuenta nueva de WhatsApp Business.
      const r = await cl.sendTemplate(to, "hello_world", "en_US", []);
      return { ok: true, waId: r.waId };
    } catch (e) {
      throw new HttpError(502, "META", (e as Error).message);
    }
  });
  route("POST", "/api/admin/whatsapp/flush", "staff", async (c) => {
    ownerOrAdmin(c);
    if (!botOn()) throw new HttpError(409, "WA_OFF", "El bot está apagado o falta configurarlo");
    return flushWhatsApp();
  });
  route("GET", "/api/admin/whatsapp/chats", "staff", (c) => store.chats.list(A(c)));
  route("GET", "/api/admin/whatsapp/chats/:phone", "staff", (c) => store.chats.get(A(c), c.params.phone));
  route("POST", "/api/admin/whatsapp/chats/:phone/reply", "staff", async (c) => {
    const text = String(c.body?.text ?? "").trim();
    if (!text || text.length > 4000) throw new HttpError(400, "VALIDATION", "Escribí un mensaje (hasta 4000 letras)");
    store.chats.get(A(c), c.params.phone); // permiso y existencia
    if (!store.chats.inWindow(c.params.phone)) throw new HttpError(409, "WINDOW_CLOSED", "Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo deja escribirle con una plantilla aprobada.");
    try {
      await sendChat(c.params.phone, text, "staff");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, "META", (e as Error).message);
    }
    store.chats.setHumanMode(A(c), c.params.phone, true, store.chats.botSettings().humanPauseHours);
    return { ok: true };
  });
  route("POST", "/api/admin/whatsapp/chats/:phone/human", "staff", (c) => (store.chats.setHumanMode(A(c), c.params.phone, !!c.body?.on, store.chats.botSettings().humanPauseHours), { ok: true }));

  /* ---------------- plomería ---------------- */
  const RAW = Symbol("raw");

  function send(res: ServerResponse, status: number, body: unknown) {
    if (res.headersSent) return;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage, max: number): Promise<{ body: any; raw?: Buffer }> {
    if (req.method === "GET" || req.method === "HEAD") return { body: undefined };
    const type = String(req.headers["content-type"] ?? "");
    if (!type.startsWith("application/json")) throw new HttpError(415, "VALIDATION", "Se espera JSON");
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > max) throw new HttpError(413, "TOO_LARGE", "El contenido es demasiado grande");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const ch of req) {
      size += (ch as Buffer).length;
      if (size > max) throw new HttpError(413, "TOO_LARGE", "El contenido es demasiado grande");
      chunks.push(ch as Buffer);
    }
    if (!size) return { body: {} };
    const raw = Buffer.concat(chunks);
    try {
      return { body: JSON.parse(raw.toString("utf8")), raw };
    } catch {
      throw new HttpError(400, "VALIDATION", "JSON inválido");
    }
  }

  /** Protección contra pedidos de otros sitios: si el navegador manda Origin, tiene que ser el nuestro. */
  function checkOrigin(req: IncomingMessage) {
    if (req.method === "GET" || req.method === "HEAD") return;
    const origin = req.headers.origin;
    if (!origin) return; // clientes que no son navegador; la cookie SameSite=Strict ya bloquea sitios ajenos
    const allowed = cfg.publicOrigin ?? `http://${req.headers.host}`;
    if (origin !== allowed && origin !== `https://${req.headers.host}`) throw new HttpError(403, "BAD_ORIGIN", "Origen no permitido");
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!cfg.staticDir || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const root = resolve(cfg.staticDir);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (file !== root && !file.startsWith(root + sep)) return false;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html"; // /panel → panel.html
    if (/^\/codigos\/[A-Za-z0-9_-]{16,64}\/?$/.test(pathname)) file = join(root, "codigos.html");
    if (/^\/recuperar\/?$/.test(pathname)) file = join(root, "recuperar.html");
    if (!existsSync(file)) file = join(root, "index.html");
    if (!existsSync(file)) return false;
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      // HTML, JS, CSS y manifiesto se revalidan siempre: así cada actualización se ve al instante.
      "Cache-Control": [".html", ".js", ".css", ".webmanifest"].includes(extname(file)) ? "no-cache" : "public, max-age=3600",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
    return true;
  }

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // SAMEORIGIN: el panel muestra la tienda en una vista previa; ningún otro sitio puede incrustarla.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    const url = new URL(req.url ?? "/", "http://local");
    const fwd = cfg.trustProxy ? String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ip = fwd || (req.socket.remoteAddress ?? "?");
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (!serveStatic(req, res, url.pathname)) send(res, 404, { error: "NOT_FOUND", message: "No encontrado" });
        return;
      }
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) {
        const any = routes.some((x) => x.re.test(url.pathname));
        throw new HttpError(any ? 405 : 404, any ? "METHOD" : "NOT_FOUND", any ? "Método no permitido" : "Ruta inexistente");
      }
      checkOrigin(req);
      const m = url.pathname.match(r.re)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const { actor, session } = resolveActor(req);
      if (r.who === "staff" && !(actor && !actor.customerId)) throw new HttpError(actor ? 403 : 401, actor ? "FORBIDDEN" : "LOGIN_REQUIRED", actor ? "Solo el equipo de la tienda" : "Iniciá sesión");
      if (r.who === "customer" && !actor?.customerId) throw new HttpError(401, "LOGIN_REQUIRED", "Iniciá sesión");
      const { body, raw } = await readJson(req, r.maxBody);
      const out = await r.handler({ req, res, params, query: url.searchParams, body, raw, actor, session, ip });
      if (out !== RAW) send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      if (e instanceof DomainError) return send(res, STATUS[e.code] ?? 400, { error: e.code, message: e.message });
      log(`error ${req.method} ${url.pathname}: ${(e as Error).stack ?? e}`);
      send(res, 500, { error: "INTERNAL", message: "Error interno. Probá de nuevo." });
    }
  });

  /** Configuración de la copia fuera del servidor (no es secreta, pero vive junto a los secretos del servidor). */
  type OffsiteCfg = { enabled: boolean; mailboxId?: string; address?: string; lastAt?: number; lastError?: string; lastBytes?: number; withUploads?: boolean };
  const OFFSITE_FOLDER = "Respaldos GaboHub";
  const offsiteCfg = (): OffsiteCfg => { try { return JSON.parse(db.getSecret("offsite:cfg") ?? "") as OffsiteCfg; } catch { return { enabled: false }; } };
  function offsiteTarget(o: OffsiteCfg): ImapConfig | null {
    if (o.mailboxId) {
      const box = store.engine.s.mailboxes[o.mailboxId];
      const pass = box ? passOf(box.id) : "";
      return box && pass ? imapOf(box, pass) : null;
    }
    const v = db.getSecret("offsite:pass");
    return o.address && v ? { host: "imap.gmail.com", port: 993, user: o.address, pass: db.unseal(v), ...(cfg.imapTest ?? {}) } : null;
  }
  async function sendOffsite(): Promise<void> {
    const o = offsiteCfg();
    const target = offsiteTarget(o);
    const save = (patch: Partial<OffsiteCfg>) => db.setSecret("offsite:cfg", JSON.stringify({ ...offsiteCfg(), ...patch }), now());
    if (!target) { save({ lastAt: now(), lastError: "No hay un Gmail conectado para guardar los respaldos" }); throw new DomainError("VALIDATION", "Elegí el Gmail donde se guardan los respaldos"); }
    try {
      const { data, withUploads } = backups.compact();
      const d = new Date(now());
      const p = (n: number) => String(n).padStart(2, "0");
      const name = `respaldo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
      const st = store.engine.s;
      const text = `Respaldo automático de ${st.settings.platformName || "GaboHub"} / ${st.settings.storeName}.\n\n`
        + `Clientes: ${Object.keys(st.customers).length} · Cuentas: ${Object.keys(st.accounts).length} · Pedidos: ${Object.keys(st.orders).length}\n`
        + `${withUploads ? "Incluye la base y los archivos subidos." : "Incluye la base (los comprobantes pesan mucho: descargalos desde el panel)."}\n\n`
        + "Las contraseñas de las cuentas van cifradas: para restaurar hace falta la clave GS_DATA_KEY de Railway. Guardala aparte.";
      const msg = buildMail({ from: target.user, to: target.user, subject: `Respaldo GaboHub ${name.slice(9, 19)}`, text, attachment: { name, data, type: "application/zip" }, date: now() });
      await appendToFolder(target, OFFSITE_FOLDER, msg);
      save({ lastAt: now(), lastError: undefined, lastBytes: data.length, withUploads });
      log(`respaldo guardado en el Gmail (${Math.round(data.length / 1024)} KB)`);
    } catch (e) {
      save({ lastAt: now(), lastError: (e as Error).message.slice(0, 200) });
      throw e;
    }
  }

  /** Lee los correos nuevos de los buzones conectados y guarda los códigos. */
  type PollResult = { checked: number; found: number; errors: number };
  let polling: Promise<PollResult> | null = null;
  function pollMail(only?: string): Promise<PollResult> {
    if (polling) return polling.then((): Promise<PollResult> | PollResult => (only ? pollMail(only) : { checked: 0, found: 0, errors: 0 }));
    polling = (async () => {
      let checked = 0, found = 0, errors = 0;
      for (const box of Object.values(store.engine.s.mailboxes)) {
        if (only && box.id !== only) continue;
        const pass = passOf(box.id);
        if (!pass) continue;
        checked++;
        try {
          const r = await fetchNew(imapOf(box, pass), { afterUid: box.lastUid, uidValidity: box.uidValidity, since: now() - 86_400_000, max: 40 });
          const known = store.codes.accountEmails();
          let n = 0;
          for (const m of r.mails) {
            const p = parseMail(m.raw);
            const to = p.recipients.find((x) => known.has(x)) ?? emailsIn(p.text).find((x) => known.has(x)) ?? p.recipients.find((x) => x !== box.address) ?? p.recipients[0] ?? "";
            const saved = store.codes.ingest(system, box.id, { to, from: p.fromRaw, subject: p.subject, body: p.text, html: p.html, receivedAt: Math.min(p.date ?? now(), now()) });
            if (saved) n++;
          }
          found += n;
          store.codes.setStatus(system, box.id, { lastUid: r.lastUid, uidValidity: r.uidValidity, found: n });
        } catch (e) {
          errors++;
          store.codes.setStatus(system, box.id, { error: (e as Error).message });
        }
      }
      return { checked, found, errors };
    })().finally(() => { polling = null; });
    return polling;
  }

  let lastRentRun = 0;
  function runJobs() {
    const expired = store.orders.expireReservations(system);
    const reminders = store.orders.autoReminders(system);
    const supplierAlerts = store.orders.supplierExpiryAlerts(system);
    const closed = store.orders.closeExpired(system, 2);
    db.purgeExpiredSessions(now());
    let backup: string | undefined;
    try { backup = backups.daily()?.name; } catch (e) { log(`respaldo falló: ${(e as Error).message}`); }
    // Alquiler de páginas de revendedores: se revisa una vez por hora.
    let rents: ReturnType<typeof store.shops.chargeRents> | undefined;
    if (now() - lastRentRun > 3_600_000) { lastRentRun = now(); try { rents = store.shops.chargeRents(system); } catch (e) { log(`alquileres fallaron: ${(e as Error).message}`); } }
    if (rents && (rents.charged || rents.suspended || rents.free)) log(`alquileres: ${JSON.stringify(rents)}`);
    // Una vez por día, la copia también va al Gmail (si está activada).
    const off = offsiteCfg();
    if (off.enabled && (!off.lastAt || now() - off.lastAt > 23 * 3_600_000)) sendOffsite().catch((e) => log(`copia al Gmail falló: ${(e as Error).message}`));
    return { expired, reminders, closed, supplierAlerts, ...(backup ? { backup } : {}) };
  }
  const timers: NodeJS.Timeout[] = [];
  if (cfg.jobs !== false) {
    timers.push(setInterval(() => {
      try {
        const r = runJobs();
        if (r.expired || r.reminders || r.closed || r.supplierAlerts || r.backup) log(`tareas: ${JSON.stringify(r)}`);
      } catch (e) {
        log(`tareas fallaron: ${(e as Error).message}`);
      }
      flushWhatsApp().then((r) => { if (r.sent || r.failed) log(`whatsapp: ${JSON.stringify(r)}`); }, (e) => log(`whatsapp falló: ${(e as Error).message}`));
      pollMail().then((r) => { if (r.found) log(`códigos: ${JSON.stringify(r)}`); }, (e) => log(`códigos falló: ${(e as Error).message}`));
    }, 60_000));
    timers.forEach((t) => t.unref());
  }

  return {
    server, store, db, runJobs, flushWhatsApp, pollMail,
    resetTwoFactor(username) {
      const u = store.admin.findStaffForLogin(String(username).toLowerCase());
      if (!u || !db.getSecret(`totp:${u.id}`)) return false;
      db.setSecret(`totp:${u.id}`, null, now());
      store.engine.tx(() => store.engine.audit({ id: "system:recovery", role: "system" }, "staff.2fa_reset", "staff", u.id));
      return true;
    },
    bootstrapOwner(username, name, password) {
      if (Object.keys(store.engine.s.staff).length) return false;
      store.admin.bootstrapOwner({ username, name, passwordHash: hashPassword(password) });
      return true;
    },
    listen(port, host = "0.0.0.0") {
      return new Promise((ok) => server.listen(port, host, () => ok((server.address() as { port: number }).port)));
    },
    close() {
      timers.forEach(clearInterval);
      return new Promise((ok) => server.close(() => (db.close(), ok())));
    },
  };
}
