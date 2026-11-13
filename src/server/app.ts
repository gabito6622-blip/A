// Servidor HTTP de Gabriel Store: API JSON + archivos estáticos de la tienda y el panel.
// Sin frameworks: node:http. Cada ruta declara quién puede llamarla; el núcleo vuelve a
// validar permisos (defensa en dos capas).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fetchBcbRate } from "./bcbRate.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
const timingSafeEqualStr = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
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
import { OG_H, OG_W, ogCard, ogTags } from "./og.js";
import { generateVapidKeys, sendPush, validSubscription, vapidKeyObject, type PushSubscriptionData, type VapidKeys } from "./push.js";
import { AGENT_KINDS, AI_MODELS, Agents, AiError, defaultAiCfg, type AgentKind, type AiCfg, type ReceiptCheck } from "./agents.js";
import { runBank, type BankResult } from "./agent-bank.js";
import { localHour } from "../store/orders.js";
import { overview as resellerOverview } from "../store/resellerStats.js";
import type { KeyObject } from "node:crypto";
import { BinancePay, verifyWebhook as verifyBinanceWebhook, parseWebhook as parseBinanceWebhook } from "./binance.js";
import { metaTemplateBody, templateParamOrder, TEMPLATES, type TemplateId } from "../store/index.js";
import { registerOwnStockRoutes } from "./ownStockRoutes.js";
import { registerSelfCodesRoutes } from "./selfCodesRoutes.js";
import { registerSearchRoutes } from "./searchRoutes.js";
import { createExpiryPush } from "./expiryPush.js";
import { createOffice, firstName } from "./office.js";
import { ownSoonFor, ownPushText, withOwnSuffix } from "../store/ownAlerts.js";
import { writeXlsx } from "./xlsx.js";
import { buildExport, customersTemplate, EXPORT_KINDS, importCustomers, importServicesFile, servicesTemplate, type ExportKind } from "./exports.js";
import { catalogData, catalogImageRefs, filterCatalog, whatsappCatalog, type CatalogFilter } from "./exportCenter.js";
import { catalogPdf, type CatalogDesign } from "./catalogPdf.js";
import { shrinkPng } from "./pdf.js";
import { findBySlug as findShopBySlug, type HubFeature } from "../store/resellerShop.js";
import { businessReport, parsePeriod } from "./reportXlsx.js";

/** Content-Security-Policy: qué puede cargar el navegador en la tienda y el panel.
 *  - script-src 'self': solo nuestros .js (ningún <script> en línea ni onclick=).
 *  - style-src 'unsafe-inline': las vistas usan atributos style="…" (no ejecutan código).
 *  - img-src https:: el QR de Binance Pay viene de un servidor de Binance.
 *  - frame-ancestors 'self': nadie de afuera puede incrustar la tienda (anti clickjacking). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

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
  /** Para pruebas: URL base de la API de Telegram (por defecto https://api.telegram.org). */
  telegramBaseUrl?: string;
  /** Clave de la API de Claude para los agentes (ANTHROPIC_API_KEY). Sin ella, los agentes quedan apagados. */
  anthropicApiKey?: string;
  /** Para pruebas: fetch falso para la API de Claude (no se llama a nada real). */
  anthropicFetch?: typeof fetch;
  /** Claves VAPID para avisos al celular (Web Push). Sin ellas, los avisos al celular quedan apagados. */
  vapid?: VapidKeys | null;
  /** Para pruebas: URL base de Binance Pay (por defecto https://bpay.binanceapi.com). */
  binanceBaseUrl?: string;
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
  INVALID_STATE: 409, ALREADY_PROCESSED: 409, SUPPLIER_EXPIRY_EXCEEDED: 409, NO_CONSENT: 409, DUPLICATE_EVIDENCE: 409, SENSITIVE_DATA: 400,
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
  /** Lee la tasa oficial del Banco Central (dólar flexible); `force` la trae aunque no toque. */
  checkBcbRate(force?: boolean): Promise<{ rate: number; date: string; applied: boolean } | null>;
  server: Server;
  store: GabrielStore;
  db: Db;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  /** Lee los correos nuevos ya (si no, se leen solos cada minuto). */
  pollMail(only?: string): Promise<{ checked: number; found: number; errors: number }>;
  /** Revisa si hay avisos nuevos y los manda al celular (lo corre el reloj cada minuto). */
  checkPushAlerts(): Promise<void>;
  /** Aviso diario al celular de cada revendedor (una vez por día, desde las 9 de Bolivia). */
  checkResellerPush(): Promise<void>;
  checkNoonPush(): Promise<void>;
  /** "🔔 Avisarme antes de que venza": avisos a clientes finales (una vez por día, desde las 9 de Bolivia). */
  checkExpiryPush(): Promise<unknown>;
  /** Si toca, arma el reporte del día con Claude (lo corre el reloj cada minuto). */
  checkDailyReport(): Promise<void>;
  /** Vigilante de cuentas: revisa un correo de una cuenta (lo usa la lectura de correos; expuesto para pruebas). */
  watchMail(m: { to: string; from: string; subject: string; body: string; at: number }): void;
  /** Procesa un mensaje de WhatsApp entrante (lo usa el webhook; expuesto para pruebas). */
  handleInbound(m: InboundMessage): Promise<void>;
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
    // Último ingreso de clientes y revendedores: así el dueño sabe a quién le falta entrar.
    if (kind === "customer") db.setSecret(`lastlogin:${subjectId}`, String(now()), now());
    const attrs = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.floor(ttl / 1000)}`];
    if (cfg.secureCookies) attrs.push("Secure");
    res.setHeader("Set-Cookie", attrs.join("; "));
  }
  function clearCookie(res: ServerResponse) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.secureCookies ? "; Secure" : ""}`);
  }
  // Llave del asistente: el dueño la crea en Usuarios y la apaga cuando quiere. Entra como un Admin
  // propio ("asistente"), nunca como dueño; todo lo que hace queda en la Auditoría con su nombre.
  type AssistKey = { hash: string; staffId: string; createdAt: number; lastUsedAt?: number };
  const assistGet = (): AssistKey | null => { try { return JSON.parse(db.getSecret("assistant_key") ?? "null"); } catch { return null; } };
  function resolveAssistant(req: IncomingMessage): { actor?: Actor } {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+(gsa_[A-Za-z0-9_-]{20,})$/.exec(h);
    if (!m) return {};
    const k = assistGet();
    if (!k || !timingSafeEqualStr(sha256(m[1]), k.hash)) return {};
    const u = store.engine.s.staff[k.staffId];
    if (!u || !u.active || u.role === "owner") return {};
    if (!k.lastUsedAt || now() - k.lastUsedAt > 10 * 60_000) db.setSecret("assistant_key", JSON.stringify({ ...k, lastUsedAt: now() }), now());
    return { actor: { id: u.id, role: u.role } };
  }
  function resolveActor(req: IncomingMessage): { actor?: Actor; session?: Ctx["session"] } {
    if (req.headers.authorization) { const a = resolveAssistant(req); if (a.actor) return a; }
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
  /** Huella del archivo subido (para detectar el mismo comprobante en dos pedidos). */
  const fileHash = (name: string) => sha256(readFileSync(join(uploads, name)).toString("base64"));
  const dropUpload = (name: string) => {
    try { unlinkSync(join(uploads, name)); } catch { /* ya no está */ }
  };

  /* ---------------- rutas públicas ---------------- */
  route("GET", "/api/health", "public", () => ({ ok: true }));

  route("GET", "/api/catalog", "public", (c) => store.catalog.publicCatalog(c.actor?.customerId));

  route("GET", "/api/settings", "public", () => {
    const st = store.engine.s.settings;
    return {
      storeName: st.storeName, platformName: st.platformName || "GaboHub", comboDiscounts: st.comboDiscounts ?? DEFAULT_COMBO_DISCOUNTS, whatsapp: st.whatsapp, paymentNote: st.paymentNote ?? "", currency: st.currency, currencySymbol: st.currencySymbol || "Bs", hasQr: !!st.qrFileRef, binance: binanceOn(),
      usdt: st.usdt?.enabled && (st.usdt.address || st.usdt.payId) && st.usdt.rate ? { address: st.usdt.address ?? "", network: st.usdt.network ?? "", payId: st.usdt.payId ?? "", rate: st.usdt.rate, rateAt: st.usdt.rateAt ?? null, note: st.usdt.note ?? "" } : null,
      accentColor: st.accentColor || "#3984ff", backgroundColor: st.backgroundColor || "#090e1d", hasLogo: !!st.logoFileRef, hasBanner: !!st.bannerFileRef,
      heroTitle: st.heroTitle || "Todo lo digital,", heroHighlight: st.heroHighlight || "en un solo lugar.",
      heroText: st.heroText || "Suscripciones, herramientas de IA y productividad. Pagás con QR o con tu saldo, y recibís tus accesos en tu cuenta.",
      announcement: st.announcement ?? "",
      fontFamily: st.fontFamily || "inter", corners: st.corners || "round", headingFont: st.headingFont || st.fontFamily || "inter", layout: st.layout || "clasico", storeHours: st.storeHours ?? "",
      accent2Color: st.accent2Color || "", bgStyle: st.bgStyle || "glow", cardStyle: st.cardStyle || "solid", resellerShops: st.resellerShops !== false, alwaysAvailable: !!st.alwaysAvailable, resellerOnlyCatalog: !!st.resellerOnlyCatalog, resellerProgramPrices: st.resellerProgramPrices !== false,
      heroChip: st.heroChip ?? "✦ Tu tienda digital en Bolivia", heroTicks: st.heroTicks ?? "Precios en bolivianos, Entrega en tu cuenta, Soporte y renovaciones",
      footerText: st.footerText ?? "", instagram: st.instagram ?? "", tiktok: st.tiktok ?? "", facebook: st.facebook ?? "", seoTitle: st.seoTitle ?? "", seoDescription: st.seoDescription ?? "",
      testimonials: (st.testimonials ?? []).map((t) => ({ name: t.name, text: t.text, ...(t.business ? { business: t.business } : {}), ...(t.rating ? { rating: t.rating } : {}) })),
      faq: (st.faq ?? []).map((f) => ({ q: f.q, a: f.a })),
    };
  });
  route("GET", "/api/products/:id/image", "public", (c) => sendImage(c, store.engine.s.products[c.params.id]?.imageFileRef, "Sin imagen"));
  route("GET", "/api/settings/logo", "public", (c) => sendImage(c, store.engine.s.settings.logoFileRef, "La tienda no tiene logo"));
  route("GET", "/api/settings/banner", "public", (c) => sendImage(c, store.engine.s.settings.bannerFileRef, "La tienda no tiene portada"));
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
  // Probar códigos de cupón en páginas públicas: límite por IP para que no se adivinen a fuerza bruta.
  const couponLimiter = new RateLimiter(30, 10 * 60_000, now);
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
  // Atención (seller) no entrega llaves de cuentas con plata: ni a revendedores ni a quien tiene saldo.
  const sellerKeyGuard = (actor: Actor, cust: { id: string; kind: string }) => {
    if (actor.role === "seller" && (cust.kind === "reseller" || store.wallet.balance(cust.id) > 0)) throw new HttpError(403, "FORBIDDEN", "El acceso de un revendedor o de un cliente con saldo lo da el dueño o un admin");
  };
  route("POST", "/api/admin/customers/:id/login-pin", "staff", (c) => {
    if (!store.catalog.canActFor(A(c), c.params.id)) throw new HttpError(403, "FORBIDDEN", "Sin permiso");
    const cust = store.engine.s.customers[c.params.id];
    if (!cust) throw new HttpError(404, "NOT_FOUND", "Cliente inexistente");
    sellerKeyGuard(A(c), cust);
    const pin = c.body?.pin ? String(c.body.pin).trim() : randomPin();
    setLoginPin(cust.id, pin);
    store.engine.tx(() => store.engine.audit(A(c), "customer.login_pin", "customer", cust.id));
    return { pin, phone: cust.phone, loginUrl: `${cfg.publicOrigin ?? `http://${c.req.headers.host}`}/hub` };
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
    // Si el correo ya es de alguien (tenga o no contraseña), NO se abre sesión: sería tomar una cuenta ajena
    // con solo saber el correo. Para ponerle contraseña a una cuenta existente está "Olvidé mi contraseña",
    // que manda el enlace a ese correo y así prueba que es suyo.
    if (custByEmail(email)) throw new DomainError("VALIDATION", "Ya hay una cuenta con ese correo. Entrá con tu número y PIN, o tocá \"Olvidé mi contraseña\" para crear una clave.");
    const cust = store.catalog.registerWithEmail({ name: String(c.body?.name ?? "").trim(), email });
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
      return { loggedIn: true, kind: "customer", role: c.actor.role, id: cu.id, name: cu.name, phone: cu.phone, email: cu.email ?? "", hasPassword: !!db.getSecret(`custpw:${cu.id}`), balance: store.wallet.balance(cu.id), currency: store.usd.currency(cu.id), whatsappConsent: cu.whatsappConsent, ...(cu.kind === "reseller" ? { pageAllowed: store.shops.pageAllowedFor(cu.id), locale: store.locale.of(cu.id) } : {}) };
    }
    const u = store.engine.s.staff[c.actor.id];
    return { loggedIn: true, kind: "staff", role: u.role, id: u.id, name: u.name, username: u.username };
  });

  /* ---------------- cliente y revendedor ---------------- */
  route("GET", "/api/me/services", "customer", (c) => store.portal.services(c.actor!));
  route("GET", "/api/me/orders", "customer", (c) => store.portal.orders(c.actor!));
  route("GET", "/api/me/ledger", "customer", (c) => store.wallet.history(c.actor!, c.actor!.customerId!));
  route("GET", "/api/me/codes", "customer", (c) => store.portal.codes(c.actor!, String(c.query.get("customerId") ?? c.actor!.customerId)));
  route("PUT", "/api/me/consent", "customer", (c) => (store.catalog.setWhatsappConsent(c.actor!, c.actor!.customerId!, !!c.body?.whatsapp, "cliente"), { ok: true }));
  route("GET", "/api/me/customers", "customer", (c) => store.portal.customers(c.actor!));
  // Herramientas del revendedor: su control tipo Excel, su fiado (lo que le deben a él) y sus ganancias.
  // Suscripción GaboHub vencida (y cobro prendido para todos): se pausan estas pantallas. Vender, anotar fiados,
  // comprar, cuentas, códigos y recargar NUNCA se bloquean (las rutas que escriben siguen abiertas).
  // Tres niveles (13/11): cada herramienta pide un plan (Gratis / Vendedor / Negocio). Sin pagar rige Gratis.
  const needPlan = (feature: HubFeature) => (c: { actor?: Actor }) => {
    const cid = c.actor?.customerId; if (!cid) return;
    const need = store.shops.planGate(cid, feature); if (!need) return;
    const name = store.shops.planNames[need];
    if (store.shops.hubLockReason(cid) === "suspended") throw new HttpError(402, "HUB_UNPAID", `Tu suscripción de GaboHub venció y hoy estás en Gratis. Esta herramienta es del plan ${name}: pagalo desde tu Inicio y se activa al instante`);
    throw new HttpError(402, "HUB_PLAN", `Esta herramienta es del plan ${name} de GaboHub: pasate desde tu Inicio y se activa al instante`);
  };
  const hubGuard = needPlan("control"), sellerGuard = needPlan("links");
  route("POST", "/api/me/hub/plan", "customer", (c) => store.shops.setPlan(c.actor!, c.actor!.customerId!, c.body?.plan));
  route("GET", "/api/me/control", "customer", (c) => { hubGuard(c); return store.rtools.control(c.actor!); });
  // «Mi día» del revendedor: misma suscripción que Mi control (plan Completo).
  route("GET", "/api/me/dia", "customer", (c) => { needPlan("dia")(c); return store.rtools.day(c.actor!); });
  route("GET", "/api/me/dia/preview/:id", "customer", (c) => { needPlan("dia")(c); return store.rtools.dayPreview(c.actor!, c.params.id); });
  route("POST", "/api/me/dia/pay/:id", "customer", (c) => { needPlan("dia")(c); return store.rtools.dayPay(c.actor!, c.params.id, c.body ?? {}); });
  // «Que vuelvan» del revendedor: va con Mi día (plan Negocio). Solo lo suyo.
  route("GET", "/api/me/vuelvan", "customer", (c) => { needPlan("dia")(c); return store.rtools.winback(c.actor!); });
  route("POST", "/api/me/vuelvan/escrito", "customer", (c) => { needPlan("dia")(c); return store.rtools.markBack(c.actor!, c.body?.key, c.body?.off === true); });
  // Repartir perfiles de las cuentas completas alquiladas (cuaderno del revendedor).
  route("GET", "/api/me/subs", "customer", (c) => ({ list: store.subs.list(c.actor!), summary: store.subs.summary(c.actor!) }));
  route("POST", "/api/me/subs/:id", "customer", (c) => store.subs.save(c.actor!, c.params.id, c.body ?? {}));
  route("POST", "/api/me/subs/:id/:sub/renew", "customer", (c) => store.subs.renew(c.actor!, c.params.id, c.params.sub, c.body?.paid !== false));
  route("POST", "/api/me/subs/:id/:sub/delete", "customer", (c) => { const r = store.subs.remove(c.actor!, c.params.id, c.params.sub); expiry.purge(); return r; });
  // Link de cobro de un perfil repartido (/c/<token>): lo arma el revendedor, lo abre su cliente sin cuenta.
  const cobroUrl = (token: string, c: Ctx) => `${cfg.publicOrigin ?? `http://${c.req.headers.host}`}/c/${token}`;
  route("POST", "/api/me/subs/:id/:sub/link", "customer", (c) => { sellerGuard(c); const r = store.subs.link(c.actor!, c.params.id, c.params.sub); return { ...r, url: cobroUrl(r.token, c) }; });
  route("POST", "/api/me/subs/:id/:sub/link/revoke", "customer", (c) => { const r = store.subs.revokeLink(c.actor!, c.params.id, c.params.sub); expiry.purge(); return r; });
  // Link de cobro de un cliente REGISTRADO del revendedor (13/11): misma página /c/<token>.
  route("POST", "/api/me/control/:id/link", "customer", (c) => { sellerGuard(c); const r = store.rtools.clientLink(c.actor!, c.params.id); return { ...r, url: cobroUrl(r.token, c) }; });
  route("POST", "/api/me/control/:id/link/revoke", "customer", (c) => { const r = store.rtools.revokeClientLink(c.actor!, c.params.id); expiry.purge(); return r; });
  // Contra el barrido de tokens: cada link que no sirve cuenta por IP; pasado el límite, 429 a todo por un rato.
  const cobroMissLimiter = new RateLimiter(20, 15 * 60_000, now);
  const cobro = <T>(c: Ctx, fn: () => T): T => {
    if (cobroMissLimiter.blocked(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Probá en 15 minutos.");
    try { return fn(); } catch (e) { if (e instanceof DomainError && e.code === "NOT_FOUND") cobroMissLimiter.take(c.ip); throw e; }
  };
  // Avisos automáticos de vencimiento al celular del cliente final (expiryPush.ts). `alerts`: si alguien los activó en ese link.
  /* ---------------- Optimización 2: links de renovación (QR o saldo), apagados por defecto ----------------
     El link lleva un token (sesión de tipo "renew", con cliente|servicio) que vale `hours` horas. No es una sesión del
     cliente: solo sirve para ver ese servicio y pagar su renovación. Con saldo se entrega al instante (la plata ya
     entró); con QR queda «En revisión» y el dueño aprueba como siempre. Si el dueño eligió acceso "full", el cliente
     puede además entrar a Mis cuentas con el mismo link. Nunca muestra correos ni claves. */
  const renewCfg = () => store.engine.s.settings.renewLink ?? { enabled: false, access: "renew" as const, hours: 48 };
  // Por IP: alcanza para ver, pagar, subir el comprobante y volver a mirar; frena a quien pruebe tokens al azar.
  const renewLimiter = new RateLimiter(40, 15 * 60_000, now);
  const renewTokenOf = (token: string) => { const s = token && /^[\w-]{16,}$/.test(token) ? db.getSession(sha256(token), now()) : null; if (!s || s.kind !== "renew") return null; const [customerId, assignmentId] = s.subjectId.split("|"); return { s, customerId, assignmentId }; };
  function makeRenewLink(assignmentId: string, base: string): { url: string; expiresAt: number } {
    const r = renewCfg();
    if (!r.enabled) throw new HttpError(409, "RENEW_LINKS_OFF", "Los links de renovación están apagados (Configuración → Soporte)");
    const a = store.engine.s.assignments[assignmentId];
    if (!a || a.status !== "active") throw new HttpError(404, "NOT_FOUND", "Servicio inexistente o inactivo");
    const cust = store.engine.s.customers[a.customerId];
    if (!cust) throw new HttpError(404, "NOT_FOUND", "Cliente inexistente");
    if (cust.resellerId && store.engine.s.customers[cust.resellerId]) throw new HttpError(409, "VIA_RESELLER", "Este cliente renueva con su revendedor: el link es para clientes que te pagan a vos");
    const token = newToken(), expiresAt = now() + r.hours * HOUR;
    db.putSession({ tokenHash: sha256(token), kind: "renew", subjectId: `${a.customerId}|${a.id}`, createdAt: now(), expiresAt });
    return { url: `${base}/tienda/#renovar=${token}`, expiresAt };
  }
  const renewActor = (customerId: string, token: string): Actor => ({ id: `renewlink:${sha256(token).slice(0, 12)}`, role: "customer", customerId });
  route("POST", "/api/admin/assignments/:id/renew-link", "staff", (c) => makeRenewLink(c.params.id, cfg.publicOrigin ?? `http://${c.req.headers.host}`));
  const renewView = (token: string) => {
    const r = renewCfg();
    const tk = r.enabled ? renewTokenOf(token) : null;
    if (!tk) throw new HttpError(404, "BAD_LINK", "El link venció o ya se usó. Escribinos por WhatsApp y te mandamos otro.");
    const e = store.engine.s, a = e.assignments[tk.assignmentId], cust = e.customers[tk.customerId];
    if (!a || !cust || a.status !== "active") throw new HttpError(404, "BAD_LINK", "Ese servicio ya no está activo");
    const prod = e.products[a.productId], slot = e.slots[a.slotId], acc = slot ? e.accounts[slot.accountId] : undefined;
    const actor = renewActor(cust.id, token);
    const usd = store.usd.isUsd(cust.id);
    const price: number | null = prod && prod.published !== false ? store.catalog.renewPriceFor(cust.id, a) : null;
    const bal = store.wallet.balance(cust.id);
    const pending = Object.values(e.orders).find((o) => o.kind === "renewal" && o.renewal?.assignmentId === a.id && (o.status === "awaiting_payment" || o.status === "payment_review"));
    const days = prod?.durationDays ?? 30;
    const from = Math.max(a.customerExpiresAt, now()), to = from + days * 86_400_000;
    const st = e.settings;
    return {
      name: String(cust.name).split(" ")[0], product: prod?.name ?? "", profile: slot?.label ?? "", expiresAt: a.customerExpiresAt, from, to, days,
      price, currency: usd ? "USD" : "BOB", balance: bal, canBalance: price !== null && price > 0 && bal >= price,
      supplierOk: !acc || to <= acc.supplierExpiresAt, access: r.access, storeName: st.storeName, whatsapp: st.whatsapp, hasQr: !!st.qrFileRef, paymentNote: st.paymentNote ?? "",
      pending: pending ? { id: pending.id, status: pending.status, hasEvidence: !!pending.evidence } : null,
      actorId: actor.id,
    };
  };
  route("GET", "/api/renovar/:token", "public", (c) => { if (!renewLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos: esperá unos minutos"); return renewView(c.params.token); });
  route("POST", "/api/renovar/:token", "public", (c) => {
    if (!renewLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos: esperá unos minutos");
    const v = renewView(c.params.token), tk = renewTokenOf(c.params.token)!;
    const method = c.body?.method === "balance" ? "balance" : c.body?.method === "qr" ? "qr" : null;
    if (!method) throw new HttpError(400, "VALIDATION", "Elegí cómo pagás: saldo o QR");
    if (!v.supplierOk) throw new HttpError(409, "SUPPLIER_EXPIRY_EXCEEDED", "Este servicio no se puede renovar todavía: escribinos por WhatsApp");
    if (v.pending) throw new HttpError(409, "ALREADY_PENDING", "Ya hay una renovación en curso para este servicio");
    const r = store.orders.renew(renewActor(tk.customerId, c.params.token), tk.assignmentId, { periods: 1, paymentMethod: method, idempotencyKey: typeof c.body?.idempotencyKey === "string" ? c.body.idempotencyKey.slice(0, 80) : undefined });
    if (method === "balance" && renewCfg().access === "renew") db.deleteSession(tk.s.tokenHash); // ya cumplió: un solo uso
    return { order: { id: r.order.id, status: r.order.status, total: r.order.total }, assignment: { expiresAt: r.assignment.customerExpiresAt } };
  });
  route("POST", "/api/renovar/:token/evidence", "public", (c) => {
    if (!renewLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos: esperá unos minutos");
    const v = renewView(c.params.token), tk = renewTokenOf(c.params.token)!;
    if (!v.pending || v.pending.status !== "awaiting_payment") throw new HttpError(409, "INVALID_STATE", "No hay una renovación esperando comprobante");
    const file = saveUpload(c.body);
    try {
      const o = store.orders.submitEvidence(renewActor(tk.customerId, c.params.token), v.pending.id, { fileRef: file, declaredReference: String(c.body?.declaredReference ?? ""), hash: fileHash(file) });
      autoReview(o.id);
      if (renewCfg().access === "renew") db.deleteSession(tk.s.tokenHash);
      return { id: o.id, status: o.status };
    } catch (err) { try { unlinkSync(join(uploads, file)); } catch { /* */ } throw err; }
  }, MAX_UPLOAD_JSON);
  route("POST", "/api/renovar/:token/entrar", "public", (c) => {
    if (!renewLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos: esperá unos minutos");
    const tk = renewCfg().enabled ? renewTokenOf(c.params.token) : null;
    if (!tk) throw new HttpError(404, "BAD_LINK", "El link venció o ya se usó");
    if (renewCfg().access !== "full") throw new HttpError(403, "FORBIDDEN", "Este link solo sirve para renovar");
    startSession(c.res, "customer", tk.customerId);
    return { ok: true };
  });

  const expiry = createExpiryPush({ route, store, db, now, pushOn: () => pushOn(), publicKey: () => cfg.vapid?.publicKey ?? null,
    renewLink: (assignmentId) => { try { return renewCfg().enabled && cfg.publicOrigin ? makeRenewLink(assignmentId, cfg.publicOrigin).url : null; } catch { return null; } },
    send: (sub) => sendPush(sub, cfg.vapid!, vapidKey!, cfg.fetchImpl ?? fetch, now()), customerPush, customerIds: () => cpushSubs().map((x) => x.customerId),
    cobro, tooMany: () => { throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Probá en 15 minutos."); } });
  route("GET", "/api/cobro/:token", "public", (c) => cobro(c, () => ({ ...store.subs.publicView(c.params.token), alerts: expiry.hasAlerts(c.params.token) })));
  route("GET", "/api/cobro/:token/qr", "public", (c) => cobro(c, () => sendImage(c, store.subs.publicQr(c.params.token), "Sin QR")));
  registerOwnStockRoutes({ route, store, saveUpload, dropUpload, sendImage, cobroUrl, maxUpload: MAX_UPLOAD_JSON, onLinkGone: () => expiry.purge() }); // país/moneda y cuentas propias
  route("GET", "/api/cobro/:token/logo", "public", (c) => cobro(c, () => sendImage(c, store.subs.publicLogo(c.params.token), "Sin logo")));
  // "📩 Ver mi código de acceso" en /c/<token> + interruptores del revendedor y del dueño.
  registerSelfCodesRoutes({ route, store, cobro, now, tooMany: (m) => { throw new HttpError(429, "RATE_LIMIT", m); } });
  // 🔎 Buscador del panel (searchRoutes.ts): clientes, revendedores, servicios, cuentas y pedidos, según permisos.
  registerSearchRoutes({ route, store });
  route("POST", "/api/me/control/:id", "customer", (c) => store.rtools.setControl(c.actor!, c.params.id, c.body ?? {}));
  route("GET", "/api/me/tickets", "customer", (c) => ({ kinds: store.tickets.kinds, list: store.tickets.mine(c.actor!) }));
  route("POST", "/api/me/tickets", "customer", (c) => store.tickets.report(c.actor!, { assignmentId: String(c.body?.assignmentId ?? ""), kind: c.body?.kind, note: c.body?.note }));
  route("GET", "/api/admin/tickets", "staff", (c) => store.tickets.list(A(c)));
  // Premium 2.0 (etapa 8): lo que el dueño configuró para soporte (respuestas guardadas y mensajes de la secretaria).
  route("GET", "/api/admin/settings/soporte", "staff", () => ({ ticketReplies: store.engine.s.settings.ticketReplies ?? [], secretaryMsg: store.engine.s.settings.secretaryMsg ?? {}, renewLink: renewCfg() }));
  route("POST", "/api/admin/tickets/:id", "staff", (c) => {
    const r = store.tickets.setStatus(A(c), c.params.id, { status: c.body?.status, reply: c.body?.reply });
    if (r.notify) {
      const t = r.ticket, st = { recibido: "📥 Recibimos tu reporte", revisando: "🔧 Estamos revisando", solucionado: "✅ Falla solucionada" }[t.status];
      customerPush(r.notify, { title: `${st}: ${t.product}`, body: `${t.client}${t.reply ? ` · ${t.reply}` : ""}`.slice(0, 160), url: "/hub#fallas" }).catch(() => {});
    }
    return r.ticket;
  });
  route("GET", "/api/me/earnings", "customer", (c) => { needPlan("ganancias")(c); return store.rtools.earnings(c.actor!); });
  route("GET", "/api/me/fiado", "customer", (c) => { needPlan("debe")(c); return store.fiado.overview(c.actor!); });
  route("GET", "/api/me/fiado/:id", "customer", (c) => { needPlan("debe")(c); return store.fiado.history(c.actor!, c.params.id); });
  route("POST", "/api/me/fiado/charge", "customer", (c) => store.fiado.charge(c.actor!, { customerId: String(c.body?.customerId ?? ""), amount: c.body?.amount, note: c.body?.note, dueAt: c.body?.dueAt, assignmentId: c.body?.assignmentId ? String(c.body.assignmentId) : undefined }));
  route("POST", "/api/me/fiado/payment", "customer", (c) => store.fiado.pay(c.actor!, { customerId: String(c.body?.customerId ?? ""), amount: c.body?.amount, note: c.body?.note }));
  route("POST", "/api/me/fiado/:id/from-control", "customer", (c) => store.fiado.fromControl(c.actor!, c.params.id));
  route("POST", "/api/me/fiado/entry/:id/delete", "customer", (c) => store.fiado.remove(c.actor!, c.params.id));
  route("POST", "/api/me/customers", "customer", (c) => store.catalog.createCustomer(c.actor!, { name: c.body?.name, phone: c.body?.phone, email: c.body?.email, whatsappConsent: !!c.body?.whatsappConsent }));
  route("PUT", "/api/me/customers/:id", "customer", (c) => store.portal.updateClient(c.actor!, c.params.id, {
    name: c.body?.name, phone: c.body?.phone, whatsappConsent: c.body?.whatsappConsent, note: c.body?.note,
  }));
  route("GET", "/api/me/prices", "customer", (c) => store.portal.priceList(c.actor!));
  /* ---- página propia del revendedor ---- */
  route("GET", "/api/me/shop", "customer", (c) => store.shops.mine(c.actor!));
  route("GET", "/api/me/referrals", "customer", (c) => store.shops.referrals(c.actor!));
  // Su página, cupones e imágenes: plan Vendedor en adelante (leerlas sigue libre para que vea qué tiene).
  route("PUT", "/api/me/shop", "customer", (c) => { needPlan("pagina")(c); return store.shops.update(c.actor!, c.body ?? {}); });
  // Cupones propios del revendedor (si el dueño lo permite) y presupuesto público en su página.
  route("GET", "/api/me/shop/coupons", "customer", (c) => store.shops.myCoupons(c.actor!));
  route("POST", "/api/me/shop/coupons", "customer", (c) => { needPlan("pagina")(c); return store.shops.saveCoupon(c.actor!, c.body ?? {}); });
  route("POST", "/api/me/shop/coupons/:id/delete", "customer", (c) => store.shops.deleteCoupon(c.actor!, c.params.id));
  route("POST", "/api/shops/:slug/coupon", "public", (c) => {
    if (!couponLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Probá en unos minutos.");
    return store.shops.quoteCoupon(c.params.slug, c.body?.code, c.body?.items);
  });
  route("GET", "/api/admin/reseller-coupons", "staff", () => ({ allowed: !!store.engine.s.settings.resellerCoupons }));
  route("POST", "/api/admin/reseller-coupons", "staff", (c) => store.shops.setCouponsAllowed(A(c), !!c.body?.allowed));
  const shopImageRaw = (kind: "logo" | "banner" | "qr") => (c: Ctx) => {
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
  const shopImage = (kind: "logo" | "banner" | "qr") => (c: Ctx) => { needPlan("pagina")(c); return shopImageRaw(kind)(c); };
  route("POST", "/api/me/shop/logo", "customer", shopImage("logo"), MAX_UPLOAD_JSON);
  route("POST", "/api/me/shop/banner", "customer", shopImage("banner"), MAX_UPLOAD_JSON);
  route("POST", "/api/me/shop/qr", "customer", shopImage("qr"), MAX_UPLOAD_JSON);
  route("GET", "/api/resellers/program", "public", () => store.shops.program());
  route("GET", "/api/shops/:slug", "public", (c) => store.shops.public(c.params.slug, c.actor ?? undefined));
  route("GET", "/api/shops/:slug/logo", "public", (c) => sendImage(c, store.shops.image(c.params.slug, "logo", c.actor ?? undefined), "Sin logo"));
  route("GET", "/api/shops/:slug/qr", "public", (c) => sendImage(c, store.shops.image(c.params.slug, "qr", c.actor ?? undefined), "Sin QR"));
  route("GET", "/api/shops/:slug/banner", "public", (c) => sendImage(c, store.shops.image(c.params.slug, "banner", c.actor ?? undefined), "Sin portada"));
  route("GET", "/api/admin/shops", "staff", (c) => store.shops.list(A(c)));
  route("POST", "/api/admin/customers/:id/shop-feature", "staff", (c) => store.shops.setFeatured(A(c), c.params.id, !!c.body?.featured));
  route("GET", "/api/admin/testimonials", "staff", () => store.engine.s.settings.testimonials ?? []);
  route("POST", "/api/admin/testimonials", "staff", (c) => store.shops.setTestimonials(A(c), c.body?.items));
  route("GET", "/api/admin/finance", "staff", (c) => store.finance.report(A(c), Number(c.query.get("months")) || 6));
  // Premium 2.0 (etapa 9): cierre de un mes y su Excel.
  route("GET", "/api/admin/finance/cierre", "staff", (c) => store.finance.monthClose(A(c), c.query.get("month") ?? undefined));
  route("GET", "/api/admin/finance/cierre.xlsx", "staff", (c) => {
    const d = store.finance.monthClose(A(c), c.query.get("month") ?? undefined);
    const bsn = (v: number) => Math.round(v) / 100;
    const rows: (string | number | null)[][] = [
      ["Cierre de mes", d.label], [],
      ["Entró (total)", bsn(d.ingresos)], ["· por pedidos", bsn(d.dePedidos)], ["· cobros marcados en el Control", bsn(d.delControl)],
      ["Ventas", d.ventas], ["Renovaciones", d.renovaciones], ["Cobros del Control", d.cobrosControl],
      ["Gastos", bsn(d.gastos)], ["· de cuentas", bsn(d.cuentas)], ["Te quedó", bsn(d.ganancia)],
      ...(d.cuentasEstimado ? [["Cuentas sin anotar (estimado)", bsn(d.cuentasEstimado)], ["Te quedó (estimado)", bsn(d.gananciaEstimada)]] : []),
      [], ["Mes anterior", d.prev.key], ["Entró", bsn(d.prev.ingresos)], ["Gastos", bsn(d.prev.gastos)], ["Te quedó", bsn(d.prev.ganancia)],
      ["Variación de ingresos", d.vs.ingresosPct === null ? "—" : `${d.vs.ingresosPct} %`],
      [], ["Apps que más dejaron", "Entró", "Unidades", "Costo", "Ganancia"],
      ...d.topApps.map((a) => [a.name, bsn(a.ingresos), a.units, bsn(a.costo), bsn(a.gana)]),
      [], ["Quién te pagó más", "Tipo", "Monto"],
      ...d.topPayers.map((p) => [p.name, p.kind === "reseller" ? "Revendedor" : "Cliente", bsn(p.amount)]),
    ];
    store.engine.tx(() => store.engine.audit(A(c), "export", "export", "cierre", { month: d.month }));
    return sendFile(c, writeXlsx([{ name: `Cierre ${d.month}`, widths: [34, 16, 12, 12, 12], rows }]), `cierre-${d.month}.xlsx`);
  });
  route("POST", "/api/admin/expenses", "staff", (c) => store.finance.addExpense(A(c), c.body?.amount, c.body?.note));
  route("POST", "/api/admin/expenses/:id/remove", "staff", (c) => store.finance.removeExpense(A(c), c.params.id));
  route("GET", "/api/admin/finance/margins", "staff", (c) => store.finance.margins(A(c)));
  route("POST", "/api/admin/finance/min-margin", "staff", (c) => store.finance.setMinMargin(A(c), c.body?.pct));
  route("GET", "/api/admin/faq", "staff", () => store.engine.s.settings.faq ?? []);
  route("POST", "/api/admin/faq", "staff", (c) => store.shops.setFaq(A(c), c.body?.items));
  route("POST", "/api/admin/customers/:id/shop-block", "staff", (c) => store.shops.setBlocked(A(c), c.params.id, !!c.body?.blocked));
  route("POST", "/api/admin/customers/:id/reseller-page", "staff", (c) => store.shops.setPage(A(c), c.params.id, !!c.body?.allowed));
  route("PUT", "/api/me/prices", "customer", (c) => store.portal.setPrices(c.actor!, c.body?.prices ?? {}));

  route("POST", "/api/orders", "customer", (c) =>
    store.orders.create(c.actor!, {
      customerId: c.body?.customerId ?? c.actor!.customerId!, items: c.body?.items ?? [],
      paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey,
      couponCode: c.body?.couponCode ? String(c.body.couponCode) : undefined,
      localMethodId: c.body?.localMethodId ? String(c.body.localMethodId) : undefined,
    }));
  // Cuánto saldría el pedido con el cupón (para mostrarlo en el carrito antes de pagar).
  route("POST", "/api/orders/quote", "customer", (c) =>
    store.orders.quote(c.actor!, { customerId: c.body?.customerId ?? c.actor!.customerId!, items: c.body?.items ?? [], couponCode: c.body?.couponCode ? String(c.body.couponCode) : undefined }));

  route("POST", "/api/orders/:id/evidence", "customer", (c) => {
    const file = saveUpload(c.body);
    try {
      const o = store.orders.submitEvidence(c.actor!, c.params.id, { fileRef: file, declaredReference: String(c.body?.declaredReference ?? ""), hash: fileHash(file) });
      autoReview(o.id);
      return o;
    } catch (e) {
      dropUpload(file);
      throw e;
    }
  }, MAX_UPLOAD_JSON);

  // Crea la orden de pago en Binance para un pedido ya creado con método "binance". Devuelve enlace/QR.
  route("POST", "/api/orders/:id/binance", "customer", async (c) => {
    if (!binanceOn()) throw new HttpError(409, "BINANCE_OFF", "Los pagos con Binance no están disponibles ahora");
    const o = store.engine.s.orders[c.params.id];
    if (!o) throw new HttpError(404, "NOT_FOUND", "Pedido no encontrado");
    if (!store.catalog.canActFor(c.actor!, o.payerId ?? o.customerId)) throw new HttpError(403, "FORBIDDEN", "Ese pedido no es tuyo");
    if (o.paymentMethod !== "binance") throw new HttpError(400, "VALIDATION", "Ese pedido no se paga con Binance");
    if (o.status !== "awaiting_payment") throw new HttpError(409, "INVALID_STATE", "Ese pedido ya no espera pago");
    const client = binanceClient()!;
    const rate = binCfg().rate;
    const usdt = usdtFor(o.total);
    const merchantTradeNo = "BP" + randomBytes(12).toString("hex"); // alfanumérico, 26 caracteres
    let res;
    try {
      res = await client.createOrder({ merchantTradeNo, amount: usdt, goodsName: `Pedido ${o.id}`, returnUrl: cfg.publicOrigin ? `${cfg.publicOrigin}/tienda/` : undefined, expireAt: now() + 60 * 60_000 });
    } catch (e) { binSave({ lastError: (e as Error).message.slice(0, 200) }); throw new HttpError(502, "BINANCE", (e as Error).message); }
    const link = res.checkoutUrl || res.universalUrl || res.deeplink;
    store.orders.attachBinance(c.actor!, o.id, { merchantTradeNo, prepayId: res.prepayId, link, qr: res.qrcodeLink, usdt, rate });
    return { orderId: o.id, usdt, rate, link, qr: res.qrcodeLink ?? null, qrContent: res.qrContent ?? null, expireAt: res.expireTime ?? null };
  });

  route("POST", "/api/orders/:id/cancel", "customer", (c) => store.orders.cancel(c.actor!, c.params.id));

  route("POST", "/api/me/renew", "customer", (c) =>
    store.orders.renew(c.actor!, String(c.body?.assignmentId), { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey }));

  route("POST", "/api/me/topups", "customer", (c) => {
    const file = saveUpload(c.body);
    try {
      const o = store.orders.requestTopup(c.actor!, c.body?.customerId ?? c.actor!.customerId!, c.body?.amount, { fileRef: file, declaredReference: String(c.body?.declaredReference ?? ""), hash: fileHash(file) }, c.body?.method === "usdt" ? "usdt" : "qr", c.body?.usdtAmount, typeof c.body?.idempotencyKey === "string" ? c.body.idempotencyKey.slice(0, 80) : undefined);
      autoReview(o.id);
      return o;
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
  // Proveedores: solo dueño/admin. A Atención (seller) le devolvemos la lista vacía para que sus pantallas no se rompan.
  route("GET", "/api/admin/suppliers", "staff", (c) => (A(c).role === "seller" ? [] : Object.values(snap().suppliers)));
  route("POST", "/api/admin/suppliers", "staff", (c) => store.catalog.upsertSupplier(A(c), c.body));
  // Fiado: lo que te deben (cargos y pagos por cliente, pagos parciales y fecha de cobro).
  route("GET", "/api/admin/winback", "staff", (c) => store.winback.list(A(c)));
  route("POST", "/api/admin/winback/:customerId", "staff", (c) => store.winback.mark(A(c), c.params.customerId, c.body?.outcome));
  route("GET", "/api/admin/fiado", "staff", (c) => store.fiado.overview(A(c)));
  route("GET", "/api/admin/fiado/:id", "staff", (c) => store.fiado.history(A(c), c.params.id));
  route("POST", "/api/admin/fiado/charge", "staff", (c) => store.fiado.charge(A(c), { customerId: String(c.body?.customerId ?? ""), amount: c.body?.amount, note: c.body?.note, dueAt: c.body?.dueAt, assignmentId: c.body?.assignmentId ? String(c.body.assignmentId) : undefined }));
  route("POST", "/api/admin/fiado/payment", "staff", (c) => store.fiado.pay(A(c), { customerId: String(c.body?.customerId ?? ""), amount: c.body?.amount, note: c.body?.note }));
  route("POST", "/api/admin/fiado/:id/from-control", "staff", (c) => store.fiado.fromControl(A(c), c.params.id));
  route("POST", "/api/admin/fiado/entry/:id/delete", "staff", (c) => store.fiado.remove(A(c), c.params.id));
  // Borrar un proveedor: sus cuentas pasan a "Propias" (las tuyas). No se pierde nada.
  route("POST", "/api/admin/suppliers/:id/delete", "staff", (c) => store.catalog.deleteSupplier(A(c), c.params.id));

  route("GET", "/api/admin/accounts", "staff", (c) => store.inventory.listAccounts(A(c), { withSecrets: c.query.get("secrets") === "1" }));
  route("POST", "/api/admin/accounts", "staff", (c) => {
    const b = c.body ?? {};
    const r = store.inventory.addAccount(A(c), { productId: b.productId, supplierId: b.supplierId, email: b.email, password: b.password, supplierExpiresAt: b.supplierExpiresAt, cost: b.cost, costUsd: b.costUsd, profiles: b.profiles ?? [], notes: b.notes,
      passwordPending: b.passwordPending === true, allowPastSupplierExpiry: b.allowPastSupplierExpiry === true, iptv: b.iptv });
    // "Ya la pagué": el costo entra como gasto de este mes (para la ganancia real).
    if (b.paidNow === true) store.finance.recordAccountCost(A(c), r.account.id);
    return r;
  });
  route("GET", "/api/admin/cortes", "staff", (c) => store.inventario.cuts(A(c)));
  // «Me pagó» desde Mi secretaria: primero la vista previa, después el guardado (idempotente por idempotencyKey).
  route("GET", "/api/admin/assignments/:id/pay-preview", "staff", (c) => store.cobro.preview(A(c), c.params.id, { periods: c.query.get("periods") ?? undefined }));
  route("POST", "/api/admin/assignments/:id/pay", "staff", (c) => store.cobro.apply(A(c), c.params.id, { periods: c.body?.periods, price: c.body?.price, idempotencyKey: c.body?.idempotencyKey }));
  route("POST", "/api/admin/accounts/:id/password", "staff", (c) => store.inventario.rotatePassword(A(c), c.params.id, c.body?.password));
  route("POST", "/api/admin/accounts/:id/renew-paid", "staff", (c) => store.finance.payRenewal(A(c), c.params.id, { amount: c.body?.amount, months: c.body?.months, usd: c.body?.usd, rate: c.body?.rate }));
  route("POST", "/api/admin/accounts/bulk", "staff", (c) => store.inventory.addAccountsBulk(A(c), c.body?.rows ?? []), 2 * 1024 * 1024);
  route("POST", "/api/admin/accounts/:id/replace", "staff", (c) => store.orders.replaceAccount(A(c), c.params.id, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/accounts/:id/move-all", "staff", (c) => store.orders.moveAll(A(c), c.params.id, { toAccountId: String(c.body?.toAccountId ?? ""), reason: String(c.body?.reason ?? "") }));
  route("POST", "/api/admin/accounts/:id", "staff", (c) => {
    const b = c.body ?? {};
    return store.inventory.updateAccount(A(c), c.params.id, {
      email: b.email, password: b.password, supplierId: b.supplierId, supplierExpiresAt: b.supplierExpiresAt, cost: b.cost, costUsd: b.costUsd, notes: b.notes,
    });
  });
  route("POST", "/api/admin/slots/:id", "staff", (c) => store.inventory.updateSlot(A(c), c.params.id, { label: c.body?.label, pin: c.body?.pin }));
  route("POST", "/api/admin/slots/:id/status", "staff", (c) => (store.inventory.setSlotStatus(A(c), c.params.id, c.body?.status, String(c.body?.note ?? "")), { ok: true }));
  route("POST", "/api/admin/slots/:id/free", "staff", (c) => store.orders.releaseSlot(A(c), c.params.id, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/assignments/:id/test", "staff", (c) => store.orders.markTest(A(c), c.params.id, c.body?.reason));
  route("POST", "/api/admin/assignments/:id/refund", "staff", (c) => store.orders.refundAssignment(A(c), c.params.id, { amount: c.body?.amount, reason: c.body?.reason }));
  route("GET", "/api/admin/relocations", "staff", (c) => store.orders.relocationQueue(A(c)));
  route("GET", "/api/admin/notifications", "staff", (c) => store.stats.notifications(A(c)));
  // "Mi secretaria": todo lo pendiente en una pantalla (solo lee).
  route("GET", "/api/admin/secretaria", "staff", (c) => store.stats.secretary(A(c)));
  route("POST", "/api/admin/assignments/:id/relocate", "staff", (c) => store.orders.replace(A(c), c.params.id, { reason: String(c.body?.reason ?? "Reubicación: cuenta caída"), oldSlot: "retired", otherAccount: true }));

  route("GET", "/api/admin/orders", "staff", (c) => store.admin.orders(A(c), { status: (c.query.get("status") ?? undefined) as never, customerId: c.query.get("customerId") ?? undefined })
    .map((o) => { const ai = o.evidence ? aiCheckOf(o.id) : null; return ai ? { ...o, aiCheck: ai } : o; }));
  route("POST", "/api/admin/orders/:id/ai-check", "staff", async (c) => {
    if (!["owner", "admin"].includes(A(c).role)) throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin revisan pagos");
    try { return await reviewOrder(c.params.id); }
    catch (e) { if (e instanceof AiError) throw new HttpError(409, e.code, e.message); throw e; }
  });
  route("POST", "/api/admin/orders", "staff", (c) => store.orders.create(A(c), { customerId: c.body?.customerId, items: c.body?.items ?? [], paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey, preferredSlotIds: Array.isArray(c.body?.preferredSlotIds) ? c.body.preferredSlotIds : undefined, couponCode: c.body?.couponCode ? String(c.body.couponCode) : undefined, periods: c.body?.periods }));
  route("POST", "/api/admin/orders/quote", "staff", (c) => store.orders.quote(A(c), { customerId: c.body?.customerId, items: c.body?.items ?? [], couponCode: c.body?.couponCode ? String(c.body.couponCode) : undefined, periods: c.body?.periods }));
  route("GET", "/api/admin/coupons", "staff", (c) => store.coupons.list(A(c)));
  route("POST", "/api/admin/coupons", "staff", (c) => store.coupons.save(A(c), c.body ?? {}));
  route("POST", "/api/admin/coupons/:id/delete", "staff", (c) => store.coupons.remove(A(c), c.params.id));
  route("POST", "/api/admin/orders/:id/approve", "staff", (c) => store.orders.approvePayment(A(c), c.params.id, {
    confirmedReference: String(c.body?.confirmedReference ?? ""), idempotencyKey: c.body?.idempotencyKey,
    force: c.body?.force === true, forceReason: c.body?.forceReason === undefined ? undefined : String(c.body.forceReason),
    verifiedAmount: c.body?.verifiedAmount === undefined || c.body?.verifiedAmount === null || c.body?.verifiedAmount === "" ? undefined : Number(c.body.verifiedAmount),
    verifiedUsd: c.body?.verifiedUsd === undefined || c.body?.verifiedUsd === null || c.body?.verifiedUsd === "" ? undefined : Number(c.body.verifiedUsd),
  }));
  route("POST", "/api/admin/trials", "staff", (c) => {
    const r = store.orders.createTrial(A(c), { customerId: c.body?.customerId, productId: c.body?.productId, hours: c.body?.hours, preferredSlotId: c.body?.preferredSlotId });
    return { ...r, delivery: store.admin.delivery(A(c), r.assignment.id) };
  });
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
    return store.catalog.updateCustomer(A(c), c.params.id, { name: b.name, phone: b.phone, email: b.email, notes: b.notes, kind: b.kind, priceGroupId: b.priceGroupId, tag: b.tag });
  });
  route("GET", "/api/admin/customers/:id/ledger", "staff", (c) => store.wallet.history(A(c), c.params.id));
  route("POST", "/api/admin/customers/:id/adjust", "staff", (c) => store.wallet.adjust(A(c), c.params.id, c.body?.amount, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/customers/:id/consent", "staff", (c) => (store.catalog.setWhatsappConsent(A(c), c.params.id, !!c.body?.whatsapp, "panel"), { ok: true }));
  // Ficha del revendedor: todos sus perfiles (los suyos y los de sus clientes) por cuenta, lo que debe y su link de códigos.
  route("GET", "/api/admin/resellers/:id/sheet", "staff", (c) => {
    const st = store.engine.s, r = st.customers[c.params.id];
    if (!r || r.kind !== "reseller") throw new HttpError(404, "NOT_FOUND", "No es un revendedor");
    // Mismo precio que Dashboard, Control e Inicio: admin.effectivePrice (lo que te paga el revendedor).
    // Revendedor en dólares: sus montos van en US$ (lo que te paga en su moneda), nunca Bs mezclados.
    const inUsd = store.usd.currency(r.id).code === "USD";
    const rows = store.admin.assignments(A(c)).filter((a) => a.customerId === r.id || st.customers[a.customerId]?.resellerId === r.id).map((a) => ({
      id: a.id, client: a.customerId === r.id ? "" : a.customerName ?? "", clientPhone: a.customerId === r.id ? "" : a.customerPhone, product: a.product ?? "", email: a.email, profile: a.profile,
      expiresAt: a.customerExpiresAt, holdOpen: a.holdOpen, price: inUsd ? ((a as { payUsd?: number | null }).payUsd ?? null) : a.effectivePrice, pay: a.control?.payStatus ?? "pagado",
    }));
    const cl = r.codeLink;
    return { id: r.id, name: r.name, phone: r.phone, balance: store.wallet.balance(r.id), currency: store.usd.currency(r.id).code, owed: store.fiado.owedBy(r.id), codeLink: cl ? codeLinkUrl(cl.token, c) : null, rows };
  });
  // 📋 Cargar sus cuentas: anotar en lote lo que ya le vendiste (solo dueño y admin; no cobra ni avisa).
  route("POST", "/api/admin/customers/:id/bulk-assign/preview", "staff", (c) => store.bulk.preview(A(c), c.params.id, c.body?.text));
  route("POST", "/api/admin/customers/:id/bulk-assign", "staff", (c) => store.bulk.apply(A(c), c.params.id, c.body?.text));
  // 📈 Cómo van tus revendedores (solo dueño y admin: son montos del negocio).
  route("GET", "/api/admin/resellers/overview", "staff", (c) => {
    const r = resellerOverview(store.engine, A(c), now());
    return { ...r, list: r.list.map((x) => ({ ...x, lastLoginAt: Number(db.getSecret(`lastlogin:${x.id}`) ?? 0) || null })) };
  });
  route("GET", "/api/admin/resellers", "staff", (c) => {
    const st = store.engine.s.settings;
    const list = store.shops.resellers(A(c)).map((r) => ({ ...r, hasPin: !!db.getSecret(`loginpin:${r.id}`), lastLoginAt: Number(db.getSecret(`lastlogin:${r.id}`) ?? 0) || null }));
    return { list, apps: store.shops.apps(A(c)), rent: st.shopRent ?? { enabled: false, price: 3000, freeIfSpent: 20000, graceDays: 3 }, marginPct: st.resellerMarginPct ?? 30, referralBonus: st.referralBonus ?? 0 };
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
    return store.shops.apply({ name: c.body?.name, phone: c.body?.phone, note: c.body?.note, ref: c.body?.ref });
  });
  route("POST", "/api/me/shop/pay", "customer", (c) => store.shops.payRent(c.actor!));
  route("POST", "/api/admin/resellers/:id/plan", "staff", (c) => store.shops.setPlan(A(c), c.params.id, c.body?.plan));
  route("POST", "/api/admin/customers/:id/shop", "staff", (c) => store.shops.setupFor(A(c), c.params.id, c.body ?? {}));
  route("POST", "/api/admin/customers/:id/login-link", "staff", (c) => {
    if (!store.catalog.canActFor(A(c), c.params.id)) throw new HttpError(403, "FORBIDDEN", "Sin permiso");
    const cust = store.engine.s.customers[c.params.id];
    if (!cust) throw new HttpError(404, "NOT_FOUND", "Cliente inexistente");
    sellerKeyGuard(A(c), cust);
    store.engine.tx(() => store.engine.audit(A(c), "customer.login_link", "customer", cust.id));
    return { url: makeLoginLink(cust.id, cfg.publicOrigin ?? `http://${c.req.headers.host}`), expiresAt: now() + LINK_MS };
  });

  route("GET", "/api/admin/assignments", "staff", (c) => store.admin.assignments(A(c), {
    customerId: c.query.get("customerId") ?? undefined, productId: c.query.get("productId") ?? undefined,
    expiringWithinDays: c.query.has("days") ? Number(c.query.get("days")) : undefined,
  }));
  route("GET", "/api/admin/assignments/:id/delivery", "staff", (c) => store.admin.delivery(A(c), c.params.id));
  route("POST", "/api/admin/assignments/notified", "staff", (c) => store.orders.markNoticed(A(c), c.body?.ids, c.body?.off === true));
  route("POST", "/api/admin/assignments/:id/control", "staff", (c) => store.orders.setControl(A(c), c.params.id, {
    price: c.body?.price, priceUsd: c.body?.priceUsd, cost: c.body?.cost, payStatus: c.body?.payStatus, note: c.body?.note, seller: c.body?.seller, startedAt: c.body?.startedAt,
  }));
  route("POST", "/api/admin/assignments/:id/expiry", "staff", (c) => store.orders.setExpiry(A(c), c.params.id, Number(c.body?.expiresAt), c.body?.note));
  route("POST", "/api/admin/assignments/:id/renew", "staff", (c) => store.orders.renew(A(c), c.params.id, { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod ?? "cash", allowBeyondSupplier: c.body?.allowBeyondSupplier, idempotencyKey: c.body?.idempotencyKey }));
  route("POST", "/api/admin/assignments/renew-many", "staff", (c) => store.orders.renewMany(A(c), c.body?.ids ?? [], { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod ?? "cash", batchKey: c.body?.batchKey, allowBeyondSupplier: c.body?.allowBeyondSupplier === true }));
  route("POST", "/api/admin/assignments/:id/transfer", "staff", (c) => store.orders.transfer(A(c), c.params.id, String(c.body?.toCustomerId ?? ""), String(c.body?.reason ?? "")));
  route("POST", "/api/admin/assignments/:id/replace", "staff", (c) => store.orders.replace(A(c), c.params.id, { reason: String(c.body?.reason ?? ""), oldSlot: c.body?.oldSlot, otherAccount: !!c.body?.otherAccount, ...(c.body?.toSlotId ? { toSlotId: String(c.body.toSlotId) } : {}) }));
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
  // Acceso para el asistente: crear (o cambiar) la llave, ver cuándo la usó y apagarla.
  route("GET", "/api/admin/assistant", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño");
    const k = assistGet(), u = k ? store.engine.s.staff[k.staffId] : undefined;
    return { enabled: !!(k && u?.active), username: u?.username ?? null, createdAt: k?.createdAt ?? null, lastUsedAt: k?.lastUsedAt ?? null };
  });
  route("POST", "/api/admin/assistant", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño crea el acceso del asistente");
    const st = store.engine.s;
    let u = Object.values(st.staff).find((x) => x.username === "asistente");
    if (u && u.role === "owner") throw new HttpError(400, "VALIDATION", "El usuario \"asistente\" ya existe como dueño");
    if (!u) u = st.staff[store.admin.createStaff(A(c), { username: "asistente", name: "Claude (asistente)", role: "admin", passwordHash: hashPassword(randomBytes(24).toString("hex")) }).id];
    else if (!u.active) store.admin.setStaffActive(A(c), u.id, true);
    const token = "gsa_" + randomBytes(24).toString("base64url");
    db.setSecret("assistant_key", JSON.stringify({ hash: sha256(token), staffId: u.id, createdAt: now() }), now());
    store.engine.tx(() => store.engine.audit(A(c), "assistant.key", "staff", u!.id, {}));
    return { token, username: u.username };
  });
  route("POST", "/api/admin/assistant/off", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño");
    const k = assistGet();
    db.setSecret("assistant_key", null, now());
    if (k && store.engine.s.staff[k.staffId]?.active) { store.admin.setStaffActive(A(c), k.staffId, false); db.deleteSessionsOf(k.staffId); }
    store.engine.tx(() => store.engine.audit(A(c), "assistant.off", "staff", k?.staffId ?? "-", {}));
    return { ok: true };
  });
  // El dueño le pone una contraseña nueva a un admin o vendedor que se la olvidó (y lo saca de las sesiones abiertas).
  route("POST", "/api/admin/staff/:id/password", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño cambia contraseñas de otros usuarios");
    const u = store.engine.s.staff[c.params.id];
    if (!u) throw new HttpError(404, "NOT_FOUND", "No existe ese usuario");
    if (u.role === "owner") throw new HttpError(400, "VALIDATION", "Tu propia contraseña se cambia en Seguridad");
    store.admin.setStaffPassword(A(c), u.id, hashOrThrow(c.body?.password));
    db.deleteSessionsOf(u.id);
    return { ok: true };
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
    const pick: Record<string, unknown> = ["storeName", "whatsapp", "paymentNote", "platformName", "currencySymbol", ...LOOK_KEYS]
      .filter((k) => typeof b[k] === "string").reduce((o, k) => ({ ...o, [k]: b[k] }), {});
    if (Array.isArray(b.comboDiscounts)) pick.comboDiscounts = b.comboDiscounts;
    if (b.shopRent && typeof b.shopRent === "object") pick.shopRent = b.shopRent;
    if (Array.isArray(b.ticketReplies)) pick.ticketReplies = b.ticketReplies;
    if (b.secretaryMsg && typeof b.secretaryMsg === "object") pick.secretaryMsg = b.secretaryMsg;
    if (b.renewLink && typeof b.renewLink === "object") pick.renewLink = b.renewLink;
    if (b.resellerMarginPct !== undefined) pick.resellerMarginPct = b.resellerMarginPct;
    if (b.referralBonus !== undefined) pick.referralBonus = b.referralBonus;
    if (typeof b.resellerShops === "boolean") pick.resellerShops = b.resellerShops;
    if (typeof b.resellerProgramPrices === "boolean") pick.resellerProgramPrices = b.resellerProgramPrices;
    if (typeof b.alwaysAvailable === "boolean") pick.alwaysAvailable = b.alwaysAvailable;
    if (typeof b.resellerOnlyCatalog === "boolean") pick.resellerOnlyCatalog = b.resellerOnlyCatalog;
    if (b.usdt && typeof b.usdt === "object") pick.usdt = b.usdt;
    return store.catalog.updateSettings(A(c), pick);
  });
  const imageSetting = (key: "qrFileRef" | "logoFileRef" | "bannerFileRef", what: string) => (c: Ctx) => {
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
  route("POST", "/api/admin/settings/banner", "staff", imageSetting("bannerFileRef", "La portada"), MAX_UPLOAD_JSON);
  route("POST", "/api/admin/settings/banner/remove", "staff", (c) => {
    const old = store.engine.s.settings.bannerFileRef;
    const out = store.catalog.updateSettings(A(c), { bannerFileRef: "" });
    if (old) dropUpload(old);
    return out;
  });
  route("POST", "/api/admin/settings/logo/remove", "staff", (c) => {
    const old = store.engine.s.settings.logoFileRef;
    const out = store.catalog.updateSettings(A(c), { logoFileRef: "" });
    if (old) dropUpload(old);
    return out;
  });
  route("POST", "/api/admin/outbox/:id/sent", "staff", (c) => store.notify.markSentManually(A(c), c.params.id, { force: c.body?.force === true, reason: c.body?.reason === undefined ? undefined : String(c.body.reason) }));

  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const sendFile = (c: Ctx, buf: Buffer, name: string, mime = XLSX) => {
    c.res.writeHead(200, { "Content-Type": mime, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "Content-Length": buf.length });
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

  /* ---------------- Centro de exportaciones (13/11): catálogo WhatsApp / PDF y reporte Excel, para la tienda y para cada revendedor ---------------- */
  const catFilter = (c: Ctx): CatalogFilter => ({ categories: (c.query.get("cats") ?? "").split(",").map((x) => x.trim()).filter(Boolean), productIds: (c.query.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
  const descargasCatalogo = (c: Ctx, actor: Actor) => { const d = catalogData(store, actor, { origin: originOf(c.req) }); return { ...d, business: { ...d.business, hasLogo: !!d.business.logoRef, logoRef: undefined }, categories: d.categories.map((cat) => ({ ...cat, items: cat.items.map(({ imageRef: _r, ...it }) => it) })) }; };
  const descargasWhatsapp = (c: Ctx, actor: Actor) => whatsappCatalog(filterCatalog(catalogData(store, actor, { origin: originOf(c.req) }), catFilter(c)), { descriptions: c.query.get("desc") !== "0" });
  // El catálogo (WhatsApp y PDF, con sus precios) es del plan Gratis: nunca se frena.
  const hubPaid = needPlan("catalogo");
  const descargasLogo = (c: Ctx, actor: Actor) => sendImage(c, catalogData(store, actor).business.logoRef, "Sin logo");
  route("GET", "/api/admin/descargas/catalogo", "staff", (c) => descargasCatalogo(c, A(c)));
  route("GET", "/api/admin/descargas/whatsapp", "staff", (c) => descargasWhatsapp(c, A(c)));
  route("GET", "/api/admin/descargas/logo", "staff", (c) => descargasLogo(c, A(c)));
  const logoCache = new Map<string, Buffer | null>();
  const slugOf = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catalogo";
  const descargasPdf = (c: Ctx, actor: Actor) => {
    const d = filterCatalog(catalogData(store, actor, { origin: originOf(c.req) }), catFilter(c));
    const design: CatalogDesign = c.query.get("design") === "clasico" ? "clasico" : "premium";
    const ref = d.business.logoRef, file = ref && /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(ref) ? join(uploads, ref) : null;
    const logo = file && existsSync(file) ? readFileSync(file) : undefined;
    // Logos de las apps, achicados a 160 px y guardados en memoria por archivo (los catálogos se bajan seguido).
    const images = new Map<string, Buffer>();
    for (const [id, r] of catalogImageRefs(d, store.engine.s.products)) {
      let small = logoCache.get(r);
      if (small === undefined) {
        const f = /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(r) ? join(uploads, r) : null;
        try { small = f && existsSync(f) ? shrinkPng(readFileSync(f), 160) : null; } catch { small = null; }
        if (logoCache.size > 400) logoCache.clear();
        logoCache.set(r, small);
      }
      if (small) images.set(id, small);
    }
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date(now()));
    return sendFile(c, catalogPdf(d, design, logo, images), `catalogo-${slugOf(d.business.name)}-${design}-${day}.pdf`, "application/pdf");
  };
  route("GET", "/api/admin/descargas/catalogo.pdf", "staff", (c) => descargasPdf(c, A(c)));
  // Catálogo PÚBLICO (13/11): el cliente lo baja desde la tienda o desde la página del revendedor, sin sesión. Se arma con el
  // mismo generador, se guarda en memoria 5 minutos (si 50 personas lo bajan seguido, se genera una vez) y tiene límite por IP.
  const publicPdfCache = new Map<string, { at: number; buf: Buffer; name: string }>();
  const publicPdfLimiter = new RateLimiter(12, 10 * 60_000, now);
  const publicPdf = (c: Ctx, key: string, actor: Actor) => {
    if (!publicPdfLimiter.take(c.ip)) throw new HttpError(429, "RATE_LIMIT", "Demasiadas descargas seguidas: probá en unos minutos");
    const design: CatalogDesign = c.query.get("design") === "clasico" ? "clasico" : "premium";
    const k = `${key}|${design}`, hit = publicPdfCache.get(k);
    if (hit && now() - hit.at < 5 * 60_000) return sendFile(c, hit.buf, hit.name, "application/pdf");
    const d = catalogData(store, actor, { origin: originOf(c.req) });
    const ref = d.business.logoRef, file = ref && /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(ref) ? join(uploads, ref) : null;
    const logo = file && existsSync(file) ? readFileSync(file) : undefined;
    const images = new Map<string, Buffer>();
    for (const [id, r] of catalogImageRefs(d, store.engine.s.products)) {
      let small = logoCache.get(r);
      if (small === undefined) { const f = /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(r) ? join(uploads, r) : null; try { small = f && existsSync(f) ? shrinkPng(readFileSync(f), 160) : null; } catch { small = null; } if (logoCache.size > 400) logoCache.clear(); logoCache.set(r, small); }
      if (small) images.set(id, small);
    }
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date(now()));
    const buf = catalogPdf(d, design, logo, images), name = `catalogo-${slugOf(d.business.name)}-${day}.pdf`;
    if (publicPdfCache.size > 200) publicPdfCache.clear();
    publicPdfCache.set(k, { at: now(), buf, name });
    return sendFile(c, buf, name, "application/pdf");
  };
  route("GET", "/api/catalogo.pdf", "public", (c) => publicPdf(c, "tienda", { id: "public:catalogo", role: "owner" }));
  route("GET", "/api/shops/:slug/catalogo.pdf", "public", (c) => {
    store.shops.public(c.params.slug, c.actor ?? undefined); // 404 si la página no existe, está apagada o bloqueada
    const owner = findShopBySlug(store.engine, c.params.slug);
    if (!owner) throw new HttpError(404, "NOT_FOUND", "Esta página no existe o no está publicada");
    return publicPdf(c, `r:${owner.id}`, { id: "public:catalogo", role: "reseller", customerId: owner.id });
  });
  const descargasXlsx = (c: Ctx, actor: Actor) => { const { file, name } = businessReport(store, actor, parsePeriod(c.query.get("from"), c.query.get("to"), now()), originOf(c.req)); return sendFile(c, file, name); };
  route("GET", "/api/admin/descargas/reporte.xlsx", "staff", (c) => descargasXlsx(c, A(c)));
  route("GET", "/api/me/descargas/reporte.xlsx", "customer", (c) => { needPlan("excel")(c); return descargasXlsx(c, c.actor!); });
  route("GET", "/api/me/descargas/catalogo.pdf", "customer", (c) => { hubPaid(c); return descargasPdf(c, c.actor!); });
  route("GET", "/api/me/descargas/catalogo", "customer", (c) => { hubPaid(c); return descargasCatalogo(c, c.actor!); });
  route("GET", "/api/me/descargas/whatsapp", "customer", (c) => { hubPaid(c); return descargasWhatsapp(c, c.actor!); });
  route("GET", "/api/me/descargas/logo", "customer", (c) => { hubPaid(c); return descargasLogo(c, c.actor!); });

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
    return `${base}${kind === "reseller" ? "/hub" : "/tienda/"}#acceso=${token}`;
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
    // Lo que el bot no entendió lo responde Claude (si el agente está prendido); si falla, queda la respuesta del bot.
    if (a.unknown && agents.isOn("whatsapp")) {
      try {
        const history = (store.engine.s.chats[phone]?.messages ?? []).slice(-11, -1).map((x) => ({ from: x.direction === "in" ? "cliente" as const : "tienda" as const, text: x.text }));
        const r = await agents.whatsappReply({ storeContext: storeContext(cust?.id), customerContext: cust ? customerContext(cust.id) : undefined, history, message: m.text, customerName: cust?.name ?? m.name });
        a.replies = [r.reply];
        if (r.handoff) a.human = true;
        const who = firstName(cust?.name ?? m.name);
        office.note("whatsapp", r.handoff ? `${who} necesita hablar con vos: le dije que ya le escribís.` : `Le respondí a ${who} por WhatsApp.`, r.handoff ? "warn" : "ok");
        // Lo que pidió el agente lo arma el sistema con datos reales (códigos, link de acceso, cómo pagar…): la IA nunca los escribe.
        const KEY: Record<string, string> = { codes: "5", login_link: "4", renew: "renovar", pay_info: "3", prices: "2" };
        if (r.action !== "none" && !r.handoff) {
          const extra = botAnswer({ store, origin: cfg.publicOrigin, loginLink: (id) => (cfg.publicOrigin ? makeLoginLink(id, cfg.publicOrigin) : null) }, phone, KEY[r.action], m.name);
          a.replies.push(...extra.replies);
          if (extra.sendQr) a.sendQr = true;
        }
      } catch (e) { log(`agente de WhatsApp: ${(e as Error).message}`); }
    }
    if (a.consent !== undefined && cust) store.catalog.setWhatsappConsent({ id: `wa:${cust.id}`, role: "customer", customerId: cust.id }, cust.id, a.consent, "whatsapp");
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

  /** Bandeja de pagos de Binance que llegaron confirmados pero no se pudieron entregar (plata cobrada, pedido sin entregar). */
  type BinanceFail = { merchantTradeNo: string; txnId: string; error: string; amount: string; at: number; tries: number };
  const binanceFailed = {
    list: (): BinanceFail[] => { try { const l = JSON.parse(db.getSecret("binance_failed") ?? "[]"); return Array.isArray(l) ? l : []; } catch { return []; } },
    save(l: BinanceFail[]) { db.setSecret("binance_failed", l.length ? JSON.stringify(l.slice(-50)) : null, now()); },
    add(f: Omit<BinanceFail, "at" | "tries">) {
      const l = this.list(); const i = l.findIndex((x) => x.merchantTradeNo === f.merchantTradeNo);
      if (i >= 0) l[i] = { ...l[i], ...f, at: now(), tries: l[i].tries + 1 }; else l.push({ ...f, at: now(), tries: 1 });
      this.save(l);
    },
    resolve(mtn: string) { const l = this.list(); if (l.some((x) => x.merchantTradeNo === mtn)) this.save(l.filter((x) => x.merchantTradeNo !== mtn)); },
  };
  route("GET", "/api/admin/binance/failed", "staff", (c) => {
    if (!["owner", "admin"].includes(A(c).role)) throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin ven los pagos de Binance");
    return binanceFailed.list().map((f) => ({ ...f, orderId: Object.values(store.engine.s.orders).find((o) => o.binance?.merchantTradeNo === f.merchantTradeNo)?.id ?? null }));
  });
  route("POST", "/api/admin/binance/failed/retry", "staff", (c) => {
    if (!["owner", "admin"].includes(A(c).role)) throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin reintentan pagos de Binance");
    const mtn = String(c.body?.merchantTradeNo ?? "");
    const f = binanceFailed.list().find((x) => x.merchantTradeNo === mtn);
    if (!f) throw new HttpError(404, "NOT_FOUND", "Ese pago ya no está en la bandeja");
    const order = Object.values(store.engine.s.orders).find((o) => o.binance?.merchantTradeNo === mtn);
    if (!order) throw new HttpError(409, "INVALID_STATE", "El pago no tiene pedido en la tienda: revisalo a mano en Binance");
    const o = store.orders.confirmBinancePayment(system, order.id, { txnId: f.txnId });
    binanceFailed.resolve(mtn);
    return o;
  });
  route("POST", "/api/admin/binance/failed/dismiss", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño descarta un pago de la bandeja");
    const mtn = String(c.body?.merchantTradeNo ?? "");
    store.engine.tx(() => store.engine.audit(A(c), "binance.failed_dismiss", "order", mtn, { reason: String(c.body?.reason ?? "").slice(0, 200) }));
    binanceFailed.resolve(mtn);
    return { ok: true };
  });

  // Webhook de Binance Pay: avisa cuando un pago se completó. Se verifica la firma RSA con el certificado de Binance.
  route("POST", "/api/binance/webhook", "public", async (c) => {
    const client = binanceClient();
    if (!client || !c.raw) throw new HttpError(400, "BINANCE_OFF", "Binance Pay no está configurado");
    const hdr = { timestamp: c.req.headers["binancepay-timestamp"] as string | undefined, nonce: c.req.headers["binancepay-nonce"] as string | undefined, signature: c.req.headers["binancepay-signature"] as string | undefined };
    let certs = await client.getCertificates().catch(() => []);
    let ok = verifyBinanceWebhook(c.raw, hdr, certs);
    if (!ok) { certs = await client.getCertificates(true).catch(() => []); ok = verifyBinanceWebhook(c.raw, hdr, certs); } // el certificado pudo rotar
    if (!ok) throw new HttpError(400, "BAD_SIGNATURE", "Firma inválida");
    const ev = parseBinanceWebhook(c.body ?? {});
    send(c.res, 200, { returnCode: "SUCCESS", returnMessage: null });
    if (ev.bizStatus === "PAY_SUCCESS" && ev.merchantTradeNo && ev.transactionId) {
      void (async () => {
        try {
          const order = Object.values(store.engine.s.orders).find((o) => o.binance?.merchantTradeNo === ev.merchantTradeNo);
          if (!order) { log(`binance: pago sin pedido (merchantTradeNo ${ev.merchantTradeNo})`); binanceFailed.add({ merchantTradeNo: ev.merchantTradeNo!, txnId: ev.transactionId!, error: "Pago sin pedido en la tienda", amount: `${ev.totalFee ?? ""} ${ev.currency ?? ""}`.trim() }); return; }
          store.orders.confirmBinancePayment(system, order.id, { txnId: ev.transactionId! });
          binanceFailed.resolve(ev.merchantTradeNo!);
          log(`binance: pedido ${order.id} pagado (${ev.totalFee} ${ev.currency})`);
        } catch (e) {
          // Binance ya recibió el "SUCCESS": si acá falla (sin stock, estado raro), el pago quedaría cobrado y el pedido sin
          // entregar sin que nadie lo vea. Se guarda en una bandeja del dueño para reintentar.
          log(`binance webhook: ${(e as Error).message}`);
          binanceFailed.add({ merchantTradeNo: ev.merchantTradeNo!, txnId: ev.transactionId!, error: (e as Error).message, amount: `${ev.totalFee ?? ""} ${ev.currency ?? ""}`.trim() });
        }
      })();
    }
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
  // ── Vigilante de cuentas ──
  route("GET", "/api/admin/account-alerts", "staff", (c) => store.watch.list(A(c), { unseenOnly: c.query.get("unseen") === "1" }));
  route("POST", "/api/admin/account-alerts/:id/seen", "staff", (c) => store.watch.seen(A(c), c.params.id));

  // ── Agentes con Claude ──
  route("GET", "/api/admin/ai", "staff", (ctx) => {
    const c = agents.cfg();
    // El reporte del día (con plata del negocio) es solo del dueño.
    return { hasKey: agents.hasKey, keyShape: agents.keyShape, ...c, models: Object.entries(AI_MODELS).map(([id, m]) => ({ id, label: m.label, input: m.input, output: m.output })), daily: A(ctx).role === "owner" ? aiDaily() : null };
  });
  // Inicio del panel en UNA llamada (Premium 2.0, etapa 3): antes eran 6 pedidos encadenados (assignments, pagos por
  // revisar, finanzas, agentes, revendedores sin PIN y notificaciones). Cada parte es la misma que su endpoint suelto;
  // si una falla, va en null y el resto se muestra igual.
  route("GET", "/api/admin/inicio", "staff", (ctx) => {
    const a = A(ctx), review = a.role === "owner" || a.role === "admin";
    const t = <T,>(f: () => T): T | null => { try { return f(); } catch { return null; } };
    return {
      assignments: store.admin.assignments(a, {}),
      pendingReview: t(() => store.admin.orders(a, { status: "payment_review" as never }).length) ?? 0,
      finance: a.role === "owner" ? t(() => store.finance.report(a, 1)) : null,
      ai: review ? t(() => ({ hasKey: agents.hasKey, keyShape: agents.keyShape, ...agents.cfg(), daily: a.role === "owner" ? aiDaily() : null })) : null,
      sinPin: review ? t(() => store.shops.resellers(a).filter((r) => !db.getSecret(`loginpin:${r.id}`)).length) ?? 0 : 0,
      notifications: t(() => store.stats.notifications(a)),
    };
  });
  route("POST", "/api/admin/ai", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño configura los agentes");
    const b = c.body ?? {}, cur = agents.cfg();
    const enabled = { ...cur.enabled };
    for (const k of AGENT_KINDS) if (typeof b.enabled?.[k] === "boolean") enabled[k] = b.enabled[k];
    const model = b.model === undefined ? cur.model : String(b.model);
    if (!AI_MODELS[model]) throw new HttpError(400, "VALIDATION", "Modelo desconocido");
    const limit = b.monthlyLimitUsd === undefined ? cur.monthlyLimitUsd : Number(b.monthlyLimitUsd);
    if (!Number.isFinite(limit) || limit < 0 || limit > 1000) throw new HttpError(400, "VALIDATION", "El tope mensual va de 0 a 1000 dólares");
    aiSave({ ...cur, enabled, model, monthlyLimitUsd: Math.round(limit * 100) / 100 });
    store.engine.tx(() => store.engine.audit(A(c), "ai.config", "settings", "ai", { model, limit, on: AGENT_KINDS.filter((k) => enabled[k]).join(",") }));
    return { ok: true, ...agents.cfg() };
  });
  // Asistente del dueño: preguntas sobre el negocio (solo lee).
  const askLimiter = new RateLimiter(30, 60 * 60_000, now);
  route("POST", "/api/admin/ai/ask", "staff", async (c) => {
    if (!["owner", "admin"].includes(A(c).role)) throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin");
    const q = String(c.body?.question ?? "").trim();
    if (q.length < 3 || q.length > 600) throw new HttpError(400, "VALIDATION", "Escribí tu pregunta (hasta 600 letras)");
    if (!askLimiter.take(A(c).id)) throw new HttpError(429, "RATE_LIMIT", "Muchas preguntas seguidas: probá en un rato");
    try { return { answer: await agents.ownerAnswer(ownerSnapshot(), q) }; }
    catch (e) { if (e instanceof AiError) throw new HttpError(409, e.code, e.message); throw e; }
  });
  // Probar la oficina: corre el banco de pruebas con Claude real (con la clave del servidor), en segundo plano.
  type SelfTest = { status: "running" | "done" | "error"; model: string; startedAt: number; endedAt?: number; result?: BankResult; error?: string };
  const selfTestGet = (): SelfTest | null => { try { return JSON.parse(db.getSecret("ai_selftest") ?? "null"); } catch { return null; } };
  let selfTestRunning = false;
  route("GET", "/api/admin/ai/selftest", "staff", () => selfTestGet());
  route("POST", "/api/admin/ai/selftest", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño corre la prueba");
    if (!agents.hasKey) throw new HttpError(409, "AI_OFF", "Falta la clave de Claude en el servidor (ANTHROPIC_API_KEY)");
    if (selfTestRunning) throw new HttpError(409, "BUSY", "Ya hay una prueba corriendo");
    const model = String(c.body?.model ?? agents.cfg().model);
    if (!AI_MODELS[model]) throw new HttpError(400, "VALIDATION", "Modelo desconocido");
    const real = agents.cfg();
    if (real.spentUsd >= real.monthlyLimitUsd) throw new HttpError(409, "AI_LIMIT", "Ya se llegó al tope de gasto de este mes");
    // Agentes de prueba: todos prendidos, tope propio de 2 dólares; lo gastado se suma al mes real.
    let tcfg: AiCfg = { ...defaultAiCfg(agents.monthKey()), enabled: { receipts: true, whatsapp: true, daily: true, watch: true }, model, monthlyLimitUsd: Math.min(2, real.monthlyLimitUsd - real.spentUsd) };
    const tester = new Agents({ apiKey: cfg.anthropicApiKey, fetchImpl: cfg.anthropicFetch, now, getCfg: () => tcfg, saveCfg: (x) => { tcfg = x; } });
    const st: SelfTest = { status: "running", model, startedAt: now() };
    db.setSecret("ai_selftest", JSON.stringify(st), now());
    selfTestRunning = true;
    store.engine.tx(() => store.engine.audit(A(c), "ai.selftest", "settings", "ai", { model }));
    runBank(tester, () => tcfg, { concurrency: 4, useAiForMail: true })
      .then((result) => db.setSecret("ai_selftest", JSON.stringify({ ...st, status: "done", endedAt: now(), result }), now()))
      .catch((e) => db.setSecret("ai_selftest", JSON.stringify({ ...st, status: "error", endedAt: now(), error: (e as Error).message.slice(0, 300) }), now()))
      .finally(() => {
        selfTestRunning = false;
        const cur = agents.cfg();
        aiSave({ ...cur, spentUsd: Math.round((cur.spentUsd + tcfg.spentUsd) * 10_000) / 10_000, calls: cur.calls + tcfg.calls, lastError: tcfg.lastError ?? (tcfg.calls ? undefined : cur.lastError) });
      });
    return st;
  });
  route("POST", "/api/admin/ai/daily", "staff", async (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño pide el reporte");
    try { return await runDailyReport(true); }
    catch (e) { if (e instanceof AiError) throw new HttpError(409, e.code, e.message); throw e; }
  });

  // ── Avisos al celular (Web Push) ──
  route("GET", "/api/admin/push", "staff", (c) => {
    const me = A(c).id, subs = pushSubs(), pc = pushCfg();
    return { configured: pushOn(), error: vapidError || null, publicKey: pushOn() ? cfg.vapid!.publicKey : null,
      alerts: pc.alerts, noon: pc.noon !== false, lowStockAt: store.engine.s.settings.lowStockAt ?? 2, mine: subs.filter((x) => x.staffId === me).length, total: subs.length,
      lastAt: pc.lastAt ?? null, lastError: pc.lastError ?? null };
  });
  route("POST", "/api/admin/push/subscribe", "staff", (c) => {
    if (!pushOn()) throw new HttpError(409, "PUSH_OFF", "Los avisos al celular todavía no están configurados en el servidor");
    const sub = validSubscription(c.body?.subscription);
    if (!sub) throw new HttpError(400, "VALIDATION", "Suscripción inválida");
    const me = A(c).id;
    const others = pushSubs().filter((x) => x.endpoint !== sub.endpoint);
    const mine = others.filter((x) => x.staffId === me).sort((a, b) => a.createdAt - b.createdAt);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - 9)).map((x) => x.endpoint)); // hasta 10 celulares por usuario
    pushSubsSave([...others.filter((x) => !drop.has(x.endpoint)), { ...sub, staffId: me, label: String(c.body?.label ?? "").slice(0, 60), createdAt: now() }]);
    store.engine.tx(() => store.engine.audit(A(c), "push.subscribe", "staff", me));
    return { ok: true };
  });
  route("POST", "/api/admin/push/unsubscribe", "staff", (c) => {
    const ep = String(c.body?.endpoint ?? ""), me = A(c).id;
    pushSubsSave(pushSubs().filter((x) => !(x.endpoint === ep && x.staffId === me)));
    return { ok: true };
  });
  route("POST", "/api/admin/push/test", "staff", async (c) => {
    if (!pushOn()) throw new HttpError(409, "PUSH_OFF", "Los avisos al celular todavía no están configurados en el servidor");
    const mine = pushSubs().filter((x) => x.staffId === A(c).id);
    if (!mine.length) throw new HttpError(409, "PUSH_NONE", "Primero activá los avisos en este celular");
    return pushSend(mine, { title: "✅ Avisos activados", body: "Así te van a llegar los pagos por revisar, el stock bajo y las cuentas que vencen.", go: "notificaciones" });
  });
  route("POST", "/api/admin/push/config", "staff", (c) => {
    if (!["owner", "admin"].includes(A(c).role)) throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin cambian los avisos");
    const alerts = Array.isArray(c.body?.alerts) ? c.body.alerts.map(String).filter((k: string) => PUSH_ALERTS.includes(k)) : pushCfg().alerts;
    const low = c.body?.lowStockAt;
    if (low !== undefined && (!Number.isInteger(low) || low < 0 || low > 50)) throw new HttpError(400, "VALIDATION", "Stock bajo: un número entre 0 y 50");
    const noon = typeof c.body?.noon === "boolean" ? c.body.noon : pushCfg().noon !== false;
    pushCfgSave({ alerts, noon });
    store.engine.tx(() => {
      if (low !== undefined) store.engine.s.settings.lowStockAt = low;
      store.engine.audit(A(c), "push.config", "settings", "push", { alerts: alerts.join(","), ...(low !== undefined ? { lowStockAt: low } : {}) });
    });
    return { ok: true, alerts, noon, lowStockAt: store.engine.s.settings.lowStockAt ?? 2 };
  });
  // El service worker pide acá el texto del último aviso (con la sesión del panel).
  route("GET", "/api/admin/push/latest", "staff", () =>
    pushLatest && now() - pushLatest.at < 6 * 3_600_000 ? pushLatest : { title: "Tenés avisos en el panel", body: "Tocá para verlos.", go: "notificaciones", at: 0 });

  // ── Avisos al celular de clientes y revendedores ──
  route("GET", "/api/me/push", "customer", (c) => ({ configured: pushOn(), publicKey: pushOn() ? cfg.vapid!.publicKey : null, mine: cpushSubs().filter((x) => x.customerId === c.actor!.customerId).length }));
  route("POST", "/api/me/push/subscribe", "customer", (c) => {
    if (!pushOn()) throw new HttpError(409, "PUSH_OFF", "Los avisos al celular todavía no están prendidos en la tienda");
    const sub = validSubscription(c.body?.subscription);
    if (!sub) throw new HttpError(400, "VALIDATION", "Suscripción inválida");
    const me = c.actor!.customerId!;
    const others = cpushSubs().filter((x) => x.endpoint !== sub.endpoint);
    const mine = others.filter((x) => x.customerId === me).sort((a, b) => a.createdAt - b.createdAt);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - 4)).map((x) => x.endpoint)); // hasta 5 celulares
    cpushSubsSave([...others.filter((x) => !drop.has(x.endpoint)), { ...sub, customerId: me, createdAt: now() }]);
    return { ok: true };
  });
  route("POST", "/api/me/push/unsubscribe", "customer", (c) => {
    const ep = String(c.body?.endpoint ?? ""), me = c.actor!.customerId;
    cpushSubsSave(cpushSubs().filter((x) => !(x.endpoint === ep && x.customerId === me)));
    return { ok: true };
  });
  route("POST", "/api/me/push/test", "customer", async (c) => {
    if (!pushOn()) throw new HttpError(409, "PUSH_OFF", "Los avisos al celular todavía no están prendidos en la tienda");
    const r = await customerPush(c.actor!.customerId!, { title: "✅ Avisos activados", body: "Te vamos a avisar cuando tus clientes vencen, si te falta saldo y cuando se soluciona una falla.", url: "/hub#inicio" });
    if (!r.sent) throw new HttpError(409, "PUSH_NONE", "Primero activá los avisos en este celular");
    return r;
  });
  route("GET", "/api/me/push/latest", "customer", (c) => {
    const m = cpushLatest.get(c.actor!.customerId!);
    return m && now() - m.at < 6 * 3_600_000 ? m : { title: "Tenés avisos", body: "Tocá para verlos.", url: "/hub#inicio", at: 0 };
  });

  // ── Telegram: avisos del dueño ──
  route("GET", "/api/admin/telegram", "staff", (c) => {
    const t = tgCfg();
    return { enabled: t.enabled, chatId: t.chatId ?? "", alerts: t.alerts, hasToken: !!tgToken(), alertTypes: TG_ALERTS, lastAt: t.lastAt, lastError: t.lastError };
  });
  route("POST", "/api/admin/telegram", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño configura los avisos de Telegram");
    const b = c.body ?? {};
    const changed: string[] = [];
    if (typeof b.token === "string") {
      const tok = b.token.trim();
      if (tok && !/^\d{6,12}:[A-Za-z0-9_\-]{30,50}$/.test(tok)) throw new HttpError(400, "VALIDATION", "El token del bot no parece válido (lo da @BotFather)");
      db.setSecret("tg_token", tok || null, now()); changed.push("token");
    }
    const patch: Partial<TgCfg> = {};
    if (typeof b.chatId === "string") patch.chatId = b.chatId.trim() || undefined;
    if (Array.isArray(b.alerts)) patch.alerts = b.alerts.filter((x: unknown) => (TG_ALERTS as readonly string[]).includes(String(x))).map(String);
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (Object.keys(patch).length) tgSave(patch);
    tgLast = null; // re-sincroniza el dedupe tras un cambio
    store.engine.tx(() => store.engine.audit(A(c), "telegram.config", "settings", "telegram", { changed: [...changed, ...Object.keys(patch)].join(",") }));
    return { ok: true };
  });
  route("POST", "/api/admin/telegram/test", "staff", async (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño");
    const chatId = String(c.body?.chatId ?? "").trim() || undefined;
    try {
      await sendTelegram("✅ <b>Listo.</b> Acá vas a recibir los avisos de tu tienda.", chatId);
      return { ok: true };
    } catch (e) {
      throw new HttpError(502, "TG", (e as Error).message);
    }
  });
  // ── Cobro por país (Yappy, Tigo Money…): manual, con comprobante ──
  route("GET", "/api/me/paymethods", "customer", (c) => store.payMethods.mine(c.actor!));
  route("GET", "/api/paymethods/:id/qr", "customer", (c) => {
    const m = store.payMethods.forCustomer(c.actor!.customerId!).find((x) => x.id === c.params.id);
    return sendImage(c, m?.qrFileRef, "Este método no tiene QR");
  });
  route("GET", "/api/admin/paymethods", "staff", (c) => store.payMethods.list(A(c)).map(({ qrFileRef, ...m }) => ({ ...m, hasQr: !!qrFileRef })));
  route("GET", "/api/admin/paymethods/:id/qr", "staff", (c) => {
    const m = store.payMethods.list(A(c)).find((x) => x.id === c.params.id);
    return sendImage(c, m?.qrFileRef, "Este método no tiene QR");
  });
  route("POST", "/api/admin/paymethods", "staff", (c) => { const { qrFileRef, ...m } = store.payMethods.save(A(c), c.body ?? {}); return { ...m, hasQr: !!qrFileRef }; });
  route("POST", "/api/admin/paymethods/:id/delete", "staff", (c) => { const r = store.payMethods.remove(A(c), c.params.id); if (r.old) dropUpload(r.old); return { ok: true }; });
  route("POST", "/api/admin/paymethods/:id/qr", "staff", (c) => {
    if (c.body?.remove) { const r = store.payMethods.setQr(A(c), c.params.id, null); if (r.old) dropUpload(r.old); return { ok: true }; }
    const file = saveUpload(c.body);
    if (file.endsWith(".pdf")) { dropUpload(file); throw new HttpError(400, "VALIDATION", "El QR tiene que ser una imagen (JPG, PNG o WEBP)"); }
    try { const r = store.payMethods.setQr(A(c), c.params.id, file); if (r.old) dropUpload(r.old); return { ok: true }; }
    catch (e) { dropUpload(file); throw e; }
  }, MAX_UPLOAD_JSON);

  // USDT manual: configuración cruda (para el panel; la dirección es pública pero la mostramos solo al staff).
  route("GET", "/api/admin/usdt", "staff", () => {
    const u = store.engine.s.settings.usdt;
    return { enabled: !!u?.enabled, address: u?.address ?? "", network: u?.network ?? "", payId: u?.payId ?? "", rate: u?.rate ?? 0, rateAt: u?.rateAt ?? null, note: u?.note ?? "", bcb: bcbCfg() };
  });

  // ── Tasa del dólar del Banco Central de Bolivia (dólar flexible) ──
  // Con "automático", cada 3 h se lee la tasa oficial del BCB; si publicó una fecha nueva, pasa a ser la tasa del USDT.
  // Si el dueño la cambia a mano, queda hasta que el BCB publique la del día siguiente. Si falla, no se toca nada.
  const bcbAdmin = (c: Ctx) => { if (!["owner", "admin"].includes(A(c).role)) throw new HttpError(403, "FORBIDDEN", "Solo el dueño o un admin cambian la tasa"); };
  type BcbCfg = { auto: boolean; lastTry?: number; lastOk?: number; date?: string; rate?: number; error?: string };
  const bcbCfg = (): BcbCfg => { try { return JSON.parse(db.getSecret("bcb:rate") ?? "") as BcbCfg; } catch { return { auto: false }; } };
  const saveBcb = (x: BcbCfg) => db.setSecret("bcb:rate", JSON.stringify(x), now());
  async function checkBcbRate(force = false) {
    const c = bcbCfg();
    if (!force && (!c.auto || (c.lastTry && now() - c.lastTry < 3 * 3_600_000))) return null;
    try {
      const r = await fetchBcbRate(cfg.fetchImpl ?? fetch);
      const next: BcbCfg = { ...bcbCfg(), lastTry: now(), lastOk: now(), date: r.date, rate: r.rate };
      delete next.error;
      const u = store.engine.s.settings.usdt;
      // Solo cuando el BCB publica una fecha nueva (o la primera vez): así no pisa un cambio a mano del mismo día.
      const changed = r.date !== c.date || force;
      if (changed && u?.rate !== r.rate) {
        const sys: Actor = { id: "system:bcb", role: "owner" };
        store.catalog.updateSettings(sys, { usdt: { enabled: !!u?.enabled, address: u?.address, network: u?.network, payId: u?.payId, note: u?.note, rate: r.rate } as never });
      }
      saveBcb(next);
      return { rate: r.rate, date: r.date, applied: changed };
    } catch (e) {
      saveBcb({ ...bcbCfg(), lastTry: now(), error: (e as Error).message });
      throw e;
    }
  }
  route("POST", "/api/admin/usdt/bcb", "staff", async (c) => {
    bcbAdmin(c);
    const auto = !!c.body?.auto;
    saveBcb({ ...bcbCfg(), auto });
    if (!auto) return { bcb: bcbCfg() };
    try { await checkBcbRate(true); } catch { /* el error queda guardado y se muestra */ }
    return { bcb: bcbCfg(), rate: store.engine.s.settings.usdt?.rate ?? 0 };
  });
  route("POST", "/api/admin/usdt/bcb/now", "staff", async (c) => {
    bcbAdmin(c);
    try { await checkBcbRate(true); } catch { /* idem */ }
    return { bcb: bcbCfg(), rate: store.engine.s.settings.usdt?.rate ?? 0 };
  });

  // ── Binance Pay: configuración del dueño ──
  route("GET", "/api/admin/binance", "staff", (c) => {
    const b = binCfg();
    return { enabled: b.enabled, rate: b.rate, payId: b.payId ?? "", hasKeys: !!binKeys(), ready: binanceOn(), https: !!cfg.publicOrigin?.startsWith("https://"), webhookUrl: cfg.publicOrigin ? `${cfg.publicOrigin}/api/binance/webhook` : null, lastError: b.lastError };
  });
  route("POST", "/api/admin/binance", "staff", (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño configura Binance Pay");
    const b = c.body ?? {};
    const changed: string[] = [];
    if (typeof b.apiKey === "string") {
      const k = b.apiKey.trim();
      if (k && !/^[A-Za-z0-9]{20,128}$/.test(k)) throw new HttpError(400, "VALIDATION", "La API Key no parece válida");
      db.setSecret("binance_key", k || null, now()); changed.push("apiKey");
    }
    if (typeof b.apiSecret === "string") {
      const s = b.apiSecret.trim();
      if (s && !/^[A-Za-z0-9]{20,128}$/.test(s)) throw new HttpError(400, "VALIDATION", "La API Secret no parece válida");
      db.setSecret("binance_secret", s || null, now()); changed.push("apiSecret");
    }
    const patch: Partial<BinanceCfg> = {};
    if (b.rate != null && b.rate !== "") { const r = Number(b.rate); if (!(r > 0) || r > 1000) throw new HttpError(400, "VALIDATION", "Poné cuántos Bs vale 1 USDT (ej. 13)"); patch.rate = Math.round(r * 100) / 100; }
    if (typeof b.payId === "string") patch.payId = b.payId.trim() || undefined;
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (Object.keys(patch).length) binSave(patch);
    store.engine.tx(() => store.engine.audit(A(c), "binance.config", "settings", "binance", { changed: [...changed, ...Object.keys(patch)].join(",") }));
    return { ok: true };
  });
  route("POST", "/api/admin/binance/test", "staff", async (c) => {
    if (A(c).role !== "owner") throw new HttpError(403, "FORBIDDEN", "Solo el dueño");
    const client = binanceClient();
    if (!client) throw new HttpError(409, "BINANCE_OFF", "Cargá primero la API Key y la API Secret");
    try { const certs = await client.getCertificates(true); binSave({ lastError: undefined }); return { ok: true, certs: certs.length }; }
    catch (e) { binSave({ lastError: (e as Error).message.slice(0, 200) }); throw new HttpError(502, "BINANCE", (e as Error).message); }
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

  /* ---------- Vista previa al compartir (WhatsApp, Facebook, Telegram) ----------
     Las páginas públicas llevan título, descripción e imagen propios en el <head>, y la imagen
     se dibuja en el servidor con el nombre y los colores de cada tienda. */
  type OgInfo = { title: string; description: string; siteName: string; img: string; noSize?: boolean; icon?: string; shop?: string; card: { title: string; subtitle?: string; accent?: string; background?: string; brand?: string } };
  const oneLine = (s: unknown, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  function ogInfo(pathname: string): OgInfo | null {
    const st = store.engine.s.settings;
    const platform = st.platformName || "GaboHub";
    const slug = pathname.match(/^\/r\/([a-z0-9-]{3,30})\/?$/i)?.[1]?.toLowerCase();
    if (slug) {
      try {
        const sh = store.shops.public(slug) as { title?: string; heroText?: string; heroChip?: string; accentColor?: string; backgroundColor?: string; seoTitle?: string; seoDescription?: string; hasBanner?: boolean; hasLogo?: boolean };
        const title = oneLine(sh.seoTitle || sh.title || slug, 70);
        const description = oneLine(sh.seoDescription || sh.heroText || sh.heroChip || `Suscripciones digitales con entrega rápida. Pedí por WhatsApp a ${sh.title || slug}.`);
        // Con portada propia, la vista previa es su portada; si no, una tarjeta con su nombre en sus colores.
        // Con logo, la pestaña del navegador muestra su logo.
        const icon = sh.hasLogo ? `/api/shops/${slug}/logo` : undefined;
        const card = { title, subtitle: oneLine(sh.heroChip || "Suscripciones digitales", 60), accent: sh.accentColor, background: sh.backgroundColor };
        if (sh.hasBanner) return { title, description, siteName: title, img: `/api/shops/${slug}/banner`, noSize: true, icon, card, shop: slug };
        return { title, description, siteName: title, img: `/og/r/${slug}.png`, icon, card, shop: slug };
      } catch {
        // No existe, está bloqueada, suspendida o sin publicar: vista previa genérica, sin nada de esa página.
        return hubOg(st, platform);
      }
    }
    if (/^\/tienda(\/|$)/.test(pathname)) {
      const title = oneLine(st.seoTitle || st.storeName || "Tienda", 70);
      const description = oneLine(st.seoDescription || st.heroText || "Suscripciones digitales: pagá con QR o saldo y recibí tus accesos en tu cuenta.");
      if (st.bannerFileRef) return { title, description, siteName: oneLine(st.storeName || "Tienda", 60), img: "/api/settings/banner", noSize: true, card: { title, subtitle: "", accent: st.accentColor, background: st.backgroundColor } };
      return { title, description, siteName: oneLine(st.storeName || "Tienda", 60), img: "/og/tienda.png", card: { title, subtitle: oneLine(st.heroChip || "Suscripciones digitales", 60), accent: st.accentColor, background: st.backgroundColor } };
    }
    if (pathname === "/" || /^\/(hub|revendedores|tiendas)\/?$/.test(pathname)) return hubOg(st, platform);
    return null;
  }
  function hubOg(st: typeof store.engine.s.settings, platform: string): OgInfo {
    const title = oneLine(platform, 60);
    return { title, description: "Plataforma para revendedores de streaming: tu propia página, precios de revendedor y entrega automática.", siteName: title,
      img: "/og/hub.png", card: { title, subtitle: "Plataforma para revendedores", accent: st.accentColor, background: st.backgroundColor } };
  }
  /** Origen absoluto para las etiquetas (WhatsApp exige URLs completas). */
  function originOf(req: IncomingMessage) {
    if (cfg.publicOrigin) return cfg.publicOrigin.replace(/\/$/, "");
    const host = String(req.headers.host ?? "");
    return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${cfg.secureCookies ? "https" : "http"}://${host}` : "";
  }
  /** robots.txt y sitemap.xml para Google: la tienda, la portada y las páginas de revendedores publicadas. */
  function serveSeoFiles(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if ((req.method !== "GET" && req.method !== "HEAD") || (pathname !== "/robots.txt" && pathname !== "/sitemap.xml")) return false;
    const origin = originOf(req);
    let body: string, type: string;
    if (pathname === "/robots.txt") {
      type = "text/plain; charset=utf-8";
      body = `User-agent: *\nAllow: /\nDisallow: /panel\nDisallow: /api/\nDisallow: /codigos\nDisallow: /c/\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`;
    } else {
      type = "application/xml; charset=utf-8";
      let shops: string[] = [];
      try { shops = (store.shops.program() as { shops: { slug: string }[] }).shops.map((x) => `/r/${x.slug}`); } catch { /* sin páginas */ }
      const urls = ["/tienda/", "/hub", "/revendedores", "/tiendas", ...shops];
      body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=3600" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }
  const ogCache = new Map<string, Buffer>();
  function serveOgImage(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    const m = pathname.match(/^\/og\/(tienda|hub|r\/([a-z0-9-]{3,30}))\.png$/i);
    if (!m || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const info = ogInfo(m[2] ? `/r/${m[2].toLowerCase()}` : m[1] === "tienda" ? "/tienda/" : "/");
    if (!info || (m[2] && info.shop !== m[2].toLowerCase())) { send(res, 404, { error: "NOT_FOUND", message: "No encontrado" }); return true; }
    const key = JSON.stringify(info.card);
    let img = ogCache.get(key);
    if (!img) {
      img = ogCard(info.card);
      if (ogCache.size >= 64) ogCache.delete(ogCache.keys().next().value!);
      ogCache.set(key, img);
    }
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": img.length, "Cache-Control": "public, max-age=3600" });
    res.end(req.method === "HEAD" ? undefined : img);
    return true;
  }
  let shellHtml: { file: string; mtime: number; html: string } | null = null;
  function shellWithOg(req: IncomingMessage, file: string, pathname: string): string | null {
    const info = ogInfo(pathname);
    if (!info) return null;
    const mtime = statSync(file).mtimeMs;
    if (!shellHtml || shellHtml.file !== file || shellHtml.mtime !== mtime) shellHtml = { file, mtime, html: readFileSync(file, "utf8") };
    const origin = originOf(req);
    const tags = ogTags({ title: info.title, description: info.description, siteName: info.siteName, url: origin + pathname, image: origin + info.img, ...(info.noSize ? {} : { imageW: OG_W, imageH: OG_H }) });
    const escT = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    let html = shellHtml.html
      .replace(/<title>[^<]*<\/title>/, `<title>${escT(info.title)}</title>`)
      .replace(/<meta name="description"[^>]*>\n?/, "")
      .replace("</head>", `${tags}\n</head>`);
    if (info.icon) html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${escT(info.icon)}">`);
    return html;
  }

  /** A dónde mandar a quien entra por el dominio propio. null = servir normal. */
  function domainRedirect(rawHost: string, pathname: string, search: string): { code: number; to: string } | null {
    if (!cfg.publicOrigin?.startsWith("https://")) return null;
    let main: string;
    try { main = new URL(cfg.publicOrigin).hostname.toLowerCase(); } catch { return null; }
    if (main.endsWith(".up.railway.app") || main === "localhost") return null;
    const host = rawHost.toLowerCase().replace(/:\d+$/, "");
    if (host === `www.${main}`) return { code: 301, to: `https://${main}${pathname}${search}` };
    if (host === main && pathname === "/") return { code: 302, to: `/tienda/${search}` };
    return null;
  }

  const TEXTY = new Set([".js", ".css", ".html", ".svg", ".json", ".webmanifest", ".txt"]);
  const gzCache = new Map<string, Buffer>();
  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!cfg.staticDir || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const root = resolve(cfg.staticDir);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (file !== root && !file.startsWith(root + sep)) return false;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html"; // /panel → panel.html
    if (/^\/codigos\/[A-Za-z0-9_-]{16,64}\/?$/.test(pathname)) file = join(root, "codigos.html");
    if (/^\/c\/[A-Za-z0-9_-]{16,64}\/?$/.test(pathname)) file = join(root, "cobro.html");
    if (/^\/recuperar\/?$/.test(pathname)) file = join(root, "recuperar.html");
    if (!existsSync(file)) file = join(root, "index.html");
    if (!existsSync(file)) return false;
    if (file === join(root, "index.html")) {
      const html = shellWithOg(req, file, pathname);
      if (html !== null) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : html);
        return true;
      }
    }
    const ext = extname(file), st = statSync(file);
    // ETag: si el celular ya tiene la misma versión, responde 304 sin volver a mandar el archivo.
    // Con "no-cache" igual se revalida siempre, así cada actualización se ve al instante.
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers: Record<string, string> = {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css", ".webmanifest"].includes(ext) ? "no-cache" : "public, max-age=3600",
      ETag: etag, Vary: "Accept-Encoding",
    };
    if (String(req.headers["if-none-match"] ?? "") === etag) { res.writeHead(304, headers); res.end(); return true; }
    // Texto comprimido (gzip): shop.js baja de ~220 KB a ~60 KB en datos móviles.
    if (TEXTY.has(ext) && st.size > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
      const key = `${file}|${st.mtimeMs}`;
      let gz = gzCache.get(key);
      if (!gz) {
        gz = gzipSync(readFileSync(file), { level: 9 });
        if (gzCache.size >= 40) gzCache.delete(gzCache.keys().next().value!);
        gzCache.set(key, gz);
      }
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", "Content-Length": String(gz.length) });
      res.end(req.method === "HEAD" ? undefined : gz);
      return true;
    }
    res.writeHead(200, { ...headers, "Content-Length": String(st.size) });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
    return true;
  }

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // SAMEORIGIN: el panel muestra la tienda en una vista previa; ningún otro sitio puede incrustarla.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    // Lista blanca de lo que el navegador puede cargar. Sin scripts en línea ni de otros sitios:
    // si alguien lograra meter HTML, su <script> no corre.
    res.setHeader("Content-Security-Policy", CSP);
    // La tienda no usa cámara, micrófono ni ubicación: los apagamos para que nada incrustado los pida.
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    // HSTS solo con HTTPS de verdad (en local con http rompería el acceso).
    if (cfg.secureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const url = new URL(req.url ?? "/", "http://local");
    const fwd = cfg.trustProxy ? String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ip = fwd || (req.socket.remoteAddress ?? "?");
    try {
      if (!url.pathname.startsWith("/api/")) {
        // Dominio propio (GS_PUBLIC_ORIGIN): www → dominio principal, y la portada del dominio es la tienda.
        // GaboHub (revendedores) queda en /hub. El link de Railway sigue igual que siempre.
        const go = domainRedirect(String(req.headers.host ?? ""), url.pathname, url.search);
        if (go && (req.method === "GET" || req.method === "HEAD")) { res.writeHead(go.code, { Location: go.to, "Cache-Control": "no-cache" }); res.end(); return; }
        if (!serveSeoFiles(req, res, url.pathname) && !serveOgImage(req, res, url.pathname) && !serveStatic(req, res, url.pathname)) send(res, 404, { error: "NOT_FOUND", message: "No encontrado" });
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

  /** Vigilante: primero reglas; si no hay regla y el correo es de una plataforma, la IA (si está prendida) decide. */
  const PLATFORM_FROM = /(netflix|disney|hbo|max\.com|primevideo|amazon|spotify|youtube|google|apple|crunchyroll|paramount|star|vix|canva|chatgpt|openai|duolingo)/i;
  const watchCount = { day: "", n: 0 };
  function watchMail(m: { to: string; from: string; subject: string; body: string; at: number }) {
    const kind = store.watch.classify(m.subject, m.body);
    if (kind) { store.watch.record(system, { to: m.to, kind, subject: m.subject, from: m.from, at: m.at }); return; }
    if (!agents.isOn("watch") || !PLATFORM_FROM.test(m.from) || extractCodeLike(m.body)) return;
    const day = new Date(now()).toISOString().slice(0, 10);
    if (watchCount.day !== day) { watchCount.day = day; watchCount.n = 0; }
    if (watchCount.n++ >= 30) return; // como mucho 30 consultas por día
    agents.classifyMail({ from: m.from, subject: m.subject, body: m.body }).then((k) => {
      if (k !== "none") store.watch.record(system, { to: m.to, kind: k, subject: m.subject, from: m.from, at: m.at, source: "ai" });
    }).catch((e) => log(`vigilante (IA): ${(e as Error).message}`));
  }
  /** Los correos que traen un código de acceso no son avisos de riesgo. */
  const extractCodeLike = (body: string) => /(c[oó]digo|code)[^0-9\n]{0,40}\d{4,8}/i.test(body);

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
            // Vigilante de cuentas: correos de riesgo (cambio de clave, pago rechazado…) de cuentas cargadas.
            if (known.has(to)) watchMail({ to, from: p.fromRaw, subject: p.subject, body: p.text, at: Math.min(p.date ?? now(), now()) });
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

  // ── Avisos del dueño por Telegram (opcional) ──────────────────────────────
  // El token del bot es secreto (db secrets). La config (chat y qué avisos) vive junto a los secretos.
  const TG_ALERTS = ["payment", "reseller", "reloc", "supplier", "supplier1d", "lowstock", "overdue", "due"] as const;
  type TgCfg = { enabled: boolean; chatId?: string; alerts: string[]; lastAt?: number; lastError?: string };
  const tgBase = () => (cfg.telegramBaseUrl ?? "https://api.telegram.org").replace(/\/$/, "");
  const tgToken = () => db.getSecret("tg_token");
  const tgCfg = (): TgCfg => {
    try { const c = JSON.parse(db.getSecret("tg_cfg") ?? "") as TgCfg; return { enabled: !!c.enabled, chatId: c.chatId, alerts: Array.isArray(c.alerts) ? c.alerts : [...TG_ALERTS], lastAt: c.lastAt, lastError: c.lastError }; }
    catch { return { enabled: false, alerts: [...TG_ALERTS] }; }
  };
  const tgSave = (patch: Partial<TgCfg>) => db.setSecret("tg_cfg", JSON.stringify({ ...tgCfg(), ...patch }), now());
  const tgOn = () => { const c = tgCfg(); return c.enabled && !!tgToken() && !!c.chatId; };
  async function sendTelegram(text: string, chatId?: string): Promise<void> {
    const token = tgToken();
    const to = chatId ?? tgCfg().chatId;
    if (!token || !to) throw new HttpError(409, "TG_OFF", "Falta el token del bot o el chat de Telegram");
    const f = cfg.fetchImpl ?? fetch;
    const r = await f(`${tgBase()}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: to, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) { const b = await r.text().catch(() => ""); throw new Error(`Telegram ${r.status}: ${b.slice(0, 200)}`); }
  }
  // Dedupe: solo avisamos cuando un contador SUBE respecto de lo último avisado (no repetir cada minuto).
  let tgLast: Record<string, number> | null = null;
  async function checkTelegramAlerts(): Promise<void> {
    if (!tgOn()) { tgLast = null; return; }
    const c = tgCfg();
    const feed = store.stats.feed();
    const counts: Record<string, number> = {};
    for (const it of feed.items) counts[it.kind] = it.count;
    if (tgLast === null) { tgLast = counts; return; } // primer arranque: no spamear lo viejo
    const lines: string[] = [];
    for (const it of feed.items) {
      if (!c.alerts.includes(it.kind)) continue;
      if ((counts[it.kind] ?? 0) > (tgLast[it.kind] ?? 0)) lines.push(`${it.icon} ${it.text}`);
    }
    tgLast = counts;
    if (!lines.length) return;
    const st = store.engine.s;
    const head = `<b>${escTg(st.settings.platformName || "GaboHub")}</b> · algo necesita tu atención:`;
    try { await sendTelegram([head, ...lines].join("\n")); tgSave({ lastAt: now(), lastError: undefined }); }
    catch (e) { tgSave({ lastError: (e as Error).message.slice(0, 200) }); log(`telegram falló: ${(e as Error).message}`); }
  }
  const escTg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ── Avisos al celular (Web Push) ──────────────────────────────────────────
  // Las claves VAPID vienen por variables de entorno. Las suscripciones (una por celular) se guardan
  // junto a los secretos. El toque va sin contenido: el celular le pide el texto al panel.
  const PUSH_ALERTS = ["payment", "lowstock", "supplier1d", "reseller", "reloc"];
  type PushSub = PushSubscriptionData & { staffId: string; label?: string; createdAt: number };
  /** `noon`: resumen del mediodía de Mi secretaria (prendido salvo que el dueño lo apague). */
  type PushCfg = { alerts: string[]; noon?: boolean; lastAt?: number; lastError?: string };
  let vapidKey: KeyObject | null = null, vapidError = "";
  // Sin claves cargadas a mano: en la tienda publicada (https) las generamos una vez y quedan guardadas
  // junto a los secretos, así los avisos al celular funcionan sin configurar nada.
  if (!cfg.vapid && cfg.publicOrigin?.startsWith("https://")) {
    try {
      let k = JSON.parse(db.getSecret("vapid_auto") ?? "null") as { publicKey: string; privateKey: string } | null;
      if (!k?.publicKey || !k?.privateKey) { k = generateVapidKeys(); db.setSecret("vapid_auto", JSON.stringify(k), now()); log("avisos al celular: claves generadas"); }
      cfg.vapid = { ...k, subject: cfg.publicOrigin };
    } catch (e) { vapidError = (e as Error).message; }
  }
  if (cfg.vapid) { try { vapidKey = vapidKeyObject(cfg.vapid); } catch (e) { vapidError = (e as Error).message; log(`avisos al celular apagados: ${vapidError}`); } }
  const pushOn = () => !!vapidKey && !!cfg.vapid;
  const pushSubs = (): PushSub[] => { try { const l = JSON.parse(db.getSecret("push_subs") ?? "[]"); return Array.isArray(l) ? l : []; } catch { return []; } };
  const pushSubsSave = (l: PushSub[]) => db.setSecret("push_subs", JSON.stringify(l), now());
  const pushCfg = (): PushCfg => { try { const c = JSON.parse(db.getSecret("push_cfg") ?? ""); return { alerts: Array.isArray(c.alerts) ? c.alerts : [...PUSH_ALERTS], ...(c.noon === false ? { noon: false } : {}), lastAt: c.lastAt, lastError: c.lastError }; } catch { return { alerts: [...PUSH_ALERTS] }; } };
  const pushCfgSave = (patch: Partial<PushCfg>) => db.setSecret("push_cfg", JSON.stringify({ ...pushCfg(), ...patch }), now());
  /** Lo último que avisamos: el service worker del celular lo pide para mostrar el texto. */
  let pushLatest: { title: string; body: string; go: string; at: number } | null = null;
  async function pushSend(subs: PushSub[], msg: { title: string; body: string; go: string }) {
    pushLatest = { ...msg, at: now() };
    const f = cfg.fetchImpl ?? fetch;
    let sent = 0, failed = 0; const gone = new Set<string>(); let lastError = "";
    for (const sub of subs) {
      try { if ((await sendPush(sub, cfg.vapid!, vapidKey!, f, now())) === "gone") gone.add(sub.endpoint); else sent++; }
      catch (e) { failed++; lastError = (e as Error).message.slice(0, 200); }
    }
    if (gone.size) pushSubsSave(pushSubs().filter((x) => !gone.has(x.endpoint)));
    pushCfgSave(failed ? { lastError } : { lastAt: now(), lastError: undefined });
    return { sent, failed, removed: gone.size };
  }
  // Suscripciones de clientes y revendedores (aparte de las del equipo: nunca reciben avisos del panel).
  type CPushSub = PushSubscriptionData & { customerId: string; createdAt: number };
  const cpushSubs = (): CPushSub[] => { try { const l = JSON.parse(db.getSecret("push_csubs") ?? "[]"); return Array.isArray(l) ? l : []; } catch { return []; } };
  const cpushSubsSave = (l: CPushSub[]) => db.setSecret("push_csubs", JSON.stringify(l), now());
  const cpushLatest = new Map<string, { title: string; body: string; url: string; at: number }>();
  async function customerPush(customerId: string, msg: { title: string; body: string; url: string }) {
    const subs = cpushSubs().filter((x) => x.customerId === customerId);
    if (!pushOn() || !subs.length) return { sent: 0, failed: 0 };
    cpushLatest.set(customerId, { ...msg, at: now() });
    const f = cfg.fetchImpl ?? fetch;
    let sent = 0, failed = 0; const gone = new Set<string>();
    for (const sub of subs) {
      try { if ((await sendPush(sub, cfg.vapid!, vapidKey!, f, now())) === "gone") gone.add(sub.endpoint); else sent++; }
      catch { failed++; }
    }
    if (gone.size) cpushSubsSave(cpushSubs().filter((x) => !gone.has(x.endpoint)));
    return { sent, failed };
  }
  /** Una vez por día (desde las 9, hora de Bolivia): a cada revendedor, sus clientes que vencen mañana y si le alcanza el saldo. */
  async function checkResellerPush(): Promise<void> {
    if (!pushOn() || localHour(now(), "America/La_Paz") < 9) return;
    const day = laDay(now());
    if (db.getSecret("rpush_day") === day) return;
    db.setSecret("rpush_day", day, now());
    const subs = cpushSubs();
    const s = store.engine.s, DAYMS = 86_400_000, t = now();
    for (const cid of new Set(subs.map((x) => x.customerId))) {
      const me = s.customers[cid];
      if (!me || me.kind !== "reseller") continue;
      // «Mi día» (13/11): un solo aviso con lo de hoy (cobrar / avisar / te deben) que abre la pestaña. Si su GaboHub está
      // pausado o en un plan sin Mi día (Gratis o Vendedor), sigue el aviso de siempre de «vence mañana».
      if (!store.shops.planGate(cid, "tito")) {
        const dp = store.rtools.dayPushText({ id: `u_${cid}`, role: "reseller", customerId: cid });
        if (dp) { await customerPush(cid, { ...dp, body: withOwnSuffix(dp.body, ownSoonFor(store.engine, cid)) }).catch(() => {}); continue; }
      }
      const soon = Object.values(s.assignments).filter((a) => a.status === "active" && !a.holdOpen && s.customers[a.customerId]?.resellerId === cid
        && a.customerExpiresAt > t && a.customerExpiresAt - t <= 2 * DAYMS);
      // Perfiles que reparte de sus cuentas alquiladas (su cuaderno) que vencen en 2 días.
      const subsSoon = Object.values(s.assignments).filter((a) => a.customerId === cid && a.status === "active")
        .flatMap((a) => (a.subs ?? []).filter((x) => x.expiresAt > t && x.expiresAt - t <= 2 * DAYMS));
      // Cuentas propias (W1): van en el mismo aviso del día; si no hay otro, en uno propio.
      const own = ownSoonFor(store.engine, cid);
      if (!soon.length && subsSoon.length) {
        await customerPush(cid, { title: subsSoon.length === 1 ? "📅 1 perfil tuyo vence mañana" : `📅 ${subsSoon.length} perfiles tuyos vencen mañana`, body: withOwnSuffix(`${subsSoon.slice(0, 3).map((x) => x.name.split(" ")[0]).join(", ")}${subsSoon.length > 3 ? "…" : ""} · Avisales desde Repartir perfiles`, own), url: "/hub#clientes" }).catch(() => {});
        continue;
      }
      if (!soon.length) { const o = ownPushText(own); if (o) await customerPush(cid, { ...o, url: "/hub#clientes" }).catch(() => {}); continue; }
      const need = soon.reduce((n, a) => n + store.catalog.renewPriceFor(cid, a), 0);
      const bal = store.wallet.balance(cid);
      const names = soon.slice(0, 3).map((a) => s.customers[a.customerId]?.name.split(" ")[0]).join(", ");
      await customerPush(cid, {
        title: soon.length === 1 ? "📅 1 cliente tuyo vence mañana" : `📅 ${soon.length} clientes tuyos vencen mañana`,
        body: withOwnSuffix(`${names}${soon.length > 3 ? "…" : ""}${need > bal ? ` · ⚠️ Te falta saldo para renovarlos (tenés ${(bal / 100).toFixed(0)}, necesitás ${(need / 100).toFixed(0)})` : " · Avisales desde Mi control"}`, own),
        url: "/hub#clientes",
      }).catch(() => {});
    }
  }
  let pushLast: Record<string, number> | null = null;
  async function checkPushAlerts(): Promise<void> {
    const subs = pushSubs();
    if (!pushOn() || !subs.length) { pushLast = null; return; }
    const c = pushCfg();
    const feed = store.stats.feed();
    const counts: Record<string, number> = {};
    for (const it of feed.items) counts[it.kind] = it.count;
    if (pushLast === null) { pushLast = counts; return; } // al arrancar no avisamos lo viejo
    const news = feed.items.filter((it) => (c.alerts.includes(it.kind) || it.kind === "falla") && (counts[it.kind] ?? 0) > (pushLast![it.kind] ?? 0));
    pushLast = counts;
    if (!news.length) return;
    await pushSend(subs, { title: news.length === 1 ? `${news[0].icon} ${news[0].text}` : `${store.engine.s.settings.platformName || "GaboHub"}: ${news.length} avisos nuevos`,
      body: news.length === 1 ? "Tocá para abrir el panel." : news.map((it) => `${it.icon} ${it.text}`).join("\n"), go: news[0].go });
  }

  /**
   * «🗂️ Resumen del mediodía» (13/11/2026): una vez por día, desde las 12:00 de Bolivia, le llega al celular del dueño lo
   * que Mi secretaria tiene pendiente (en cobro, por cortar, vencidas sin anotar, por avisar, sin pagar) y abre esa
   * pantalla. Si no hay nada pendiente no molesta. Solo lee: no cambia nada ni le escribe a ningún cliente.
   */
  async function checkNoonPush(): Promise<void> {
    const h = localHour(now(), "America/La_Paz");
    if (!pushOn() || h < 12 || h >= 20 || pushCfg().noon === false) return;
    // Solo a los celulares del dueño y de admins: Mi secretaria no es de Atención (seller), y el aviso nombra a quién cobrar.
    const subs = pushSubs().filter((x) => ["owner", "admin"].includes(store.engine.s.staff[x.staffId]?.role ?? ""));
    if (!subs.length) return;
    const day = laDay(now());
    if (db.getSecret("npush_day") === day) return;
    db.setSecret("npush_day", day, now());
    const r = store.stats.secretary({ id: "system:mediodia", role: "owner" });
    const c = r.counts;
    const parts = [c.cobrar && `${c.cobrar} en cobro`, c.cortar && `${c.cortar} por cortar`, c.sinAnotar && `${c.sinAnotar} vencida${c.sinAnotar === 1 ? "" : "s"} sin anotar`, c.avisar && `${c.avisar} por avisar`, c.deben && `${c.deben} sin pagar`].filter(Boolean) as string[];
    if (!parts.length) return;
    const names = (gs: { name: string; items: { noticedAt?: number }[] }[]) => [...new Set(gs.filter((g) => g.items.some((i) => i.noticedAt === undefined)).map((g) => firstName(g.name)))];
    const who = [c.cobrar || c.cortar ? `Cobrar o cortar: ${names([...r.cobrar, ...r.cortar]).slice(0, 4).join(", ")}` : "", c.avisar ? `Avisar: ${names(r.avisar).slice(0, 5).join(", ")}` : ""].filter(Boolean);
    await pushSend(subs, { title: `🗂️ Mediodía: ${parts.join(" · ")}`, body: who.join("\n") || "Tocá para ver Mi secretaria.", go: "secretaria" });
  }

  // ── Agentes con Claude (oficina virtual) ─────────────────────────────────
  const aiCfgRaw = (): AiCfg => {
    const base = defaultAiCfg("");
    try { const c = JSON.parse(db.getSecret("ai_cfg") ?? ""); return { ...base, ...c, enabled: { ...base.enabled, ...(c.enabled ?? {}) } }; } catch { return base; }
  };
  const aiSave = (c: AiCfg) => db.setSecret("ai_cfg", JSON.stringify(c), now());
  const agents = new Agents({ apiKey: cfg.anthropicApiKey, fetchImpl: cfg.anthropicFetch, now, getCfg: aiCfgRaw, saveCfg: aiSave });
  const aiCheckOf = (orderId: string): ReceiptCheck | null => { try { return JSON.parse(db.getSecret(`ai_receipt:${orderId}`) ?? "null"); } catch { return null; } };
  /** Revisa el comprobante de un pedido con Claude y guarda la sugerencia (no aprueba nada). */
  async function reviewOrder(orderId: string): Promise<ReceiptCheck> {
    const o = store.engine.s.orders[orderId];
    if (!o?.evidence) throw new HttpError(404, "NOT_FOUND", "Ese pedido no tiene comprobante");
    const file = join(uploads, o.evidence.fileRef);
    if (!/^[a-f0-9]{32}\.(png|jpg|webp|pdf)$/.test(o.evidence.fileRef) || !existsSync(file)) throw new HttpError(404, "NOT_FOUND", "No encuentro el archivo del comprobante");
    const buf = readFileSync(file);
    const methodName = o.localPay?.name ?? ({ qr: "QR / transferencia bancaria", usdt: "USDT" } as Record<string, string>)[o.paymentMethod] ?? o.paymentMethod;
    const check = await agents.reviewReceipt({
      file: buf, mime: sniff(buf.subarray(0, 16))!.mime, methodName, declaredReference: o.evidence.declaredReference,
      // En USDT el comprobante viene en otra moneda: no se compara el monto.
      expectedTotal: o.paymentMethod === "usdt" ? null : o.total, currencySymbol: store.engine.s.settings.currencySymbol || "Bs",
    });
    db.setSecret(`ai_receipt:${orderId}`, JSON.stringify(check), now());
    const V = { parece_ok: ["✅ parece correcto", "ok"], revisar: ["👀 revisalo bien antes de aprobar", "warn"], no_coincide: ["⛔ no coincide con el pedido", "bad"] } as const;
    const [vt, tone] = V[check.verdict] ?? V.revisar;
    office.note("receipts", `Revisé el comprobante de ${firstName(store.engine.s.customers[o.customerId]?.name)}: ${vt}.`, tone);
    return check;
  }
  /** Al subir un comprobante, si el agente está prendido, lo revisa en segundo plano. */
  const autoReview = (orderId: string) => {
    if (!agents.isOn("receipts")) return;
    reviewOrder(orderId).catch((e) => log(`agente de comprobantes: ${(e as Error).message}`));
  };
  /** Lo que el agente de WhatsApp sabe de la tienda: precios para ese cliente, formas de pago, horario, preguntas frecuentes. */
  function storeContext(customerId?: string): string {
    // Cliente en la lista en dólares: sus precios van en US$.
    const st = store.engine.s.settings, sym = customerId && store.engine.s.customers[customerId] ? store.usd.currency(customerId).symbol : st.currencySymbol || "Bs";
    const money = (c: number) => `${sym} ${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
    const cat = store.catalog.publicCatalog(customerId).slice(0, 40).map((p) => `- ${p.name}: ${money(p.price)} por ${p.durationDays} días${p.available === 0 ? " (sin stock ahora)" : ""}`);
    const pm = store.payMethods.mine({ id: "bot", role: "customer", customerId });
    const pays = [pm.qr && st.qrFileRef ? "QR de banco (Bolivia)" : "", ...pm.methods.map((m) => `${m.name}${m.country ? ` (${m.country})` : ""}`), st.usdt?.enabled ? "USDT" : "", "saldo de la cuenta"].filter(Boolean);
    const bot = store.chats.botSettings();
    const faq = (st.faq ?? []).slice(0, 10).map((f) => `- ${f.q}: ${f.a}`);
    return [`Tienda: ${st.storeName}`, cfg.publicOrigin ? `Tienda online: ${cfg.publicOrigin}/tienda/` : "",
      bot.humanHours ? `Atención de personas: de ${bot.humanHours.from} a ${bot.humanHours.to} h (hora de Bolivia)` : "",
      `Productos y precios para este cliente:\n${cat.join("\n") || "- (sin productos publicados)"}`,
      `Formas de pago: ${pays.join(", ")}. Después de pagar, el cliente sube el comprobante en la tienda y una persona lo revisa en 10-30 minutos.`,
      faq.length ? `Preguntas frecuentes:\n${faq.join("\n")}` : ""].filter(Boolean).join("\n\n");
  }
  /** Lo que el agente de WhatsApp sabe de ESTE cliente (sin claves, PIN ni códigos). */
  function customerContext(customerId: string): string {
    const st = store.engine.s, c = st.customers[customerId];
    if (!c) return "";
    // Saldo en la moneda de su saldo (US$ si está en la lista en dólares).
    const sym = store.usd.currency(c.id).symbol;
    const t = now();
    const riskAcc = new Set((st.accountAlerts ?? []).filter((x) => !x.seen && ["password_changed", "email_changed", "payment_failed", "cancelled"].includes(x.kind)).map((x) => x.accountId));
    const svcs = Object.values(st.assignments).filter((a) => a.customerId === customerId && a.status === "active").map((a) => {
      const sl = st.slots[a.slotId], acc = sl ? st.accounts[sl.accountId] : undefined;
      const problem = !acc || acc.status !== "active" || sl?.status === "quarantined" || acc.supplierExpiresAt <= t || riskAcc.has(acc.id);
      const d = Math.ceil((a.customerExpiresAt - t) / 86_400_000);
      return `- ${st.products[a.productId]?.name ?? a.productId}: ${d < 0 ? `vencido hace ${-d} día(s)` : d === 0 ? "vence hoy" : `vence en ${d} día(s)`}${problem ? "; la cuenta tiene un problema (la estamos revisando)" : "; la cuenta está bien"}`;
    });
    const pend = Object.values(st.orders).filter((o) => o.customerId === customerId && (o.status === "awaiting_payment" || o.status === "payment_review"))
      .map((o) => `- pedido ${o.id}: ${o.status === "payment_review" ? "pago en revisión" : "esperando pago"}`);
    return [`Tipo: ${c.kind === "reseller" ? "revendedor" : "cliente"}`, `Saldo: ${sym} ${(store.wallet.balance(c.id) / 100).toFixed(2)}`,
      svcs.length ? `Servicios:\n${svcs.join("\n")}` : "Sin servicios activos.", pend.length ? `Pedidos abiertos:\n${pend.join("\n")}` : ""].filter(Boolean).join("\n");
  }
  /** Foto del negocio para el asistente del dueño: números y listas acotadas (solo lectura). */
  function ownerSnapshot(): string {
    const st = store.engine.s, t = now(), sym = st.settings.currencySymbol || "Bs";
    const money = (c: number) => `${sym} ${(c / 100).toFixed(2)}`;
    const fd = (x: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit" }).format(new Date(x));
    const sys = { id: "system:ai", role: "owner" } as const;
    const pname = (id: string) => st.products[id]?.name ?? id;
    const cname = (id: string) => st.customers[id]?.name ?? id;
    const monthKey = (x: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz", year: "numeric", month: "2-digit" }).format(new Date(x));
    const thisM = monthKey(t), lastM = monthKey(new Date(new Date(t).setUTCDate(0)).getTime());
    const sales: Record<string, Record<string, { u: number; r: number }>> = { [thisM]: {}, [lastM]: {} };
    for (const o of Object.values(st.orders)) {
      if (o.status !== "fulfilled" || o.kind === "topup" || o.trial) continue;
      const k = monthKey(o.updatedAt); if (!sales[k]) continue;
      for (const it of o.items) { const b = (sales[k][it.productId] ??= { u: 0, r: 0 }); b.u += it.qty; b.r += it.unitPrice * it.qty; }
    }
    const salesTxt = (k: string) => Object.entries(sales[k]).map(([id, v]) => `${pname(id)}: ${v.u} venta(s), ${money(v.r)}`).join("; ") || "sin ventas";
    const stock = store.inventory.stock();
    const products = Object.values(st.products).filter((p) => p.published).map((p) => `- ${p.name}: precio ${money(p.price)}, libres ${stock[p.id]?.available ?? 0}`);
    const act = Object.values(st.assignments).filter((a) => a.status === "active");
    const soon = act.filter((a) => a.customerExpiresAt >= t - 86_400_000 && a.customerExpiresAt <= t + 7 * 86_400_000).sort((a, b) => a.customerExpiresAt - b.customerExpiresAt).slice(0, 60)
      .map((a) => `- ${cname(a.customerId)}${st.customers[a.customerId]?.resellerId ? ` (cliente de ${cname(st.customers[a.customerId].resellerId!)})` : ""}: ${pname(a.productId)}, vence ${fd(a.customerExpiresAt)}`);
    const overdue = act.filter((a) => a.customerExpiresAt < t - 86_400_000 && a.customerExpiresAt > t - 20 * 86_400_000).slice(0, 40).map((a) => `- ${cname(a.customerId)}: ${pname(a.productId)}, venció ${fd(a.customerExpiresAt)}`);
    const resellers = Object.values(st.customers).filter((c) => c.kind === "reseller").slice(0, 50).map((c) => {
      const last = Object.values(st.orders).filter((o) => o.payerId === c.id && o.status === "fulfilled" && o.kind !== "topup").sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const clients = Object.values(st.customers).filter((x) => x.resellerId === c.id).length;
      const bal = store.wallet.balance(c.id), usdW = store.usd.isUsd(c.id);
      return `- ${c.name}: saldo ${usdW ? `US$ ${(bal / 100).toFixed(2)}` : money(bal)}, ${clients} cliente(s), última compra ${last ? fd(last.updatedAt) : "nunca"}`;
    });
    const pend = Object.values(st.orders).filter((o) => o.status === "payment_review").slice(0, 20).map((o) => `- ${o.id}: ${cname(o.customerId)}, ${money(o.total)}${o.evidence?.duplicateOf ? " (¡comprobante repetido!)" : ""}`);
    const supSoon = Object.values(st.accounts).filter((a) => a.status === "active" && a.supplierExpiresAt <= t + 7 * 86_400_000).slice(0, 30).map((a) => `- ${pname(a.productId)} ${a.email}: vence con el proveedor ${fd(a.supplierExpiresAt)}`);
    const alerts = store.watch.list(sys, { unseenOnly: true }).slice(0, 20).map((a) => `- ${a.product} ${a.email}: ${a.text} (${fd(a.at)}, ${a.clients} cliente(s) en esa cuenta)`);
    const fin = store.finance.report(sys, 2);
    const mg = store.finance.margins(sys).products.filter((p) => p.public).map((p) => `- ${p.name}: te cuesta ${p.unitCost === null ? "?" : money(p.unitCost)}, ganás ${money(p.public!.gain)} (${p.public!.pct}%)`);
    const totalClients = Object.values(st.customers).filter((c) => c.kind !== "reseller").length;
    return [`Hoy: ${new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", dateStyle: "full" }).format(new Date(t))}. Moneda: ${sym}.`,
      `Clientes: ${totalClients}. Revendedores: ${resellers.length}. Servicios activos: ${act.length}.`,
      `Ventas de este mes (${thisM}): ${salesTxt(thisM)}.`, `Ventas del mes pasado (${lastM}): ${salesTxt(lastM)}.`,
      `Finanzas: ${fin.months.map((m) => `${m.label}: entró ${money(m.ingresos)}, salió ${money(m.gastos)} (${money(m.cuentas)} en cuentas), quedó ${money(m.ganancia)}`).join(" | ")}.`,
      `Productos publicados:\n${products.join("\n") || "-"}`, `Ganancia por venta:\n${mg.join("\n") || "-"}`,
      `Vencen en los próximos 7 días (clientes):\n${soon.join("\n") || "- nadie"}`, `Vencidos sin renovar (últimos 20 días):\n${overdue.join("\n") || "- nadie"}`,
      `Revendedores:\n${resellers.join("\n") || "- ninguno"}`, `Pagos por revisar:\n${pend.join("\n") || "- ninguno"}`,
      `Cuentas que vencen con el proveedor en 7 días:\n${supSoon.join("\n") || "- ninguna"}`, `Avisos de cuentas en riesgo sin ver:\n${alerts.join("\n") || "- ninguno"}`,
    ].join("\n\n").slice(0, 40_000);
  }
  const aiDaily = (): { text: string; at: number; day: string } | null => { try { return JSON.parse(db.getSecret("ai_daily") ?? "null"); } catch { return null; } };
  // 🏢 Mi oficina: muestra lo que hacen los asistentes (office.ts). Solo lee y anota; no hace trabajo nuevo.
  const office = createOffice({ route, store, db, now, hasKey: () => agents.hasKey, aiOn: (k) => agents.isOn(k), aiDaily, pushOn: () => pushOn(),
    aiMonth: () => { const c = agents.cfg(); return { spentUsd: c.spentUsd, monthlyLimitUsd: c.monthlyLimitUsd, calls: c.calls, model: c.model, modelLabel: AI_MODELS[c.model]?.label ?? c.model }; },
    mailOn: () => Object.values(store.engine.s.mailboxes).some((b) => !!passOf(b.id)), expiryStats: () => expiry.stats(),
    forbidden: (msg) => { throw new HttpError(403, "FORBIDDEN", msg); } });
  const laDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date(t));
  /** Datos del día (los calcula el sistema; la IA solo los redacta). */
  function dailyFacts(): string {
    const st = store.engine.s, sym = st.settings.currencySymbol || "Bs";
    const money = (c: number) => `${sym} ${(c / 100).toFixed(2)}`;
    const yday = laDay(now() - 86_400_000);
    const sold = Object.values(st.orders).filter((o) => o.status === "fulfilled" && o.kind !== "topup" && !o.trial && laDay(o.updatedAt) === yday);
    const feed = store.stats.feed();
    const sys = { id: "system:ai", role: "owner" } as const;
    const fin = store.finance.report(sys, 1).current;
    const mg = store.finance.margins(sys).products.filter((p) => p.public && p.public.state !== "ok").slice(0, 5);
    // Revendedores que se enfriaron (sin comprar en 14 días) o con poco saldo; perfiles libres en cuentas que vencen pronto.
    const t0 = now();
    const cold = Object.values(st.customers).filter((c) => c.kind === "reseller").filter((c) => {
      const last = Object.values(st.orders).filter((o) => o.payerId === c.id && o.status === "fulfilled" && o.kind !== "topup").sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return last && t0 - last.updatedAt > 14 * 86_400_000;
    }).slice(0, 5).map((c) => c.name);
    const wasted = Object.values(st.accounts).filter((a) => a.status === "active" && a.supplierExpiresAt > t0 && a.supplierExpiresAt <= t0 + 5 * 86_400_000)
      .map((a) => ({ a, free: Object.values(st.slots).filter((x) => x.accountId === a.id && x.status === "available").length })).filter((x) => x.free > 0)
      .slice(0, 5).map((x) => `${st.products[x.a.productId]?.name ?? "?"} (${x.free} libre(s), la cuenta vence en ${Math.ceil((x.a.supplierExpiresAt - t0) / 86_400_000)} día(s))`);
    return [`Ventas de ayer (${yday}): ${sold.length}, por ${money(sold.reduce((s, o) => s + o.total, 0))}.`,
      `Este mes: entró ${money(fin.ingresos)}, salió ${money(fin.gastos)} (${money(fin.cuentas)} en cuentas), quedó ${money(fin.ganancia)}.`,
      feed.items.length ? `Pendientes ahora:\n${feed.items.map((i) => `- ${i.text}`).join("\n")}` : "Pendientes ahora: nada urgente.",
      mg.length ? `Productos que dejan poca ganancia:\n${mg.map((p) => `- ${p.name}: ganás ${money(p.public!.gain)} por venta (${p.public!.pct}%)`).join("\n")}` : "",
      cold.length ? `Revendedores que no compran hace más de 14 días: ${cold.join(", ")}.` : "",
      wasted.length ? `Perfiles libres que se pierden si no se venden pronto (sugerí una promo o cupón): ${wasted.join("; ")}.` : ""].filter(Boolean).join("\n");
  }
  /** Arma el reporte del día y lo manda por Telegram / aviso al celular si están prendidos. */
  async function runDailyReport(manual = false): Promise<{ text: string; at: number; day: string }> {
    const text = await agents.dailyReport(dailyFacts());
    const rep = { text, at: now(), day: laDay(now()) };
    db.setSecret("ai_daily", JSON.stringify(rep), now());
    if (tgOn()) await sendTelegram(`<b>📋 Tu reporte del día</b>\n${escTg(text)}`).catch((e) => log(`reporte por Telegram: ${(e as Error).message}`));
    const subs = pushSubs();
    if (!manual && pushOn() && subs.length) await pushSend(subs, { title: "📋 Tu reporte del día", body: text.split("\n")[0].slice(0, 120), go: "inicio" }).catch(() => {});
    return rep;
  }
  /** Una vez por día, desde las 8 de la mañana (hora de Bolivia). */
  async function checkDailyReport(): Promise<void> {
    if (!agents.isOn("daily")) return;
    const last = aiDaily();
    if (last?.day === laDay(now()) || localHour(now(), "America/La_Paz") < 8) return;
    await runDailyReport();
  }

  // ── Pagos con Binance Pay (USDT) ──────────────────────────────────────────
  // Las llaves (API Key / Secret) son secretas. La config (tasa Bs→USDT, Pay ID) vive junto a los secretos.
  type BinanceCfg = { enabled: boolean; rate: number; payId?: string; lastError?: string };
  const binCfg = (): BinanceCfg => {
    try { const c = JSON.parse(db.getSecret("binance_cfg") ?? "") as BinanceCfg; return { enabled: !!c.enabled, rate: Number(c.rate) || 0, payId: c.payId, lastError: c.lastError }; }
    catch { return { enabled: false, rate: 0 }; }
  };
  const binSave = (patch: Partial<BinanceCfg>) => db.setSecret("binance_cfg", JSON.stringify({ ...binCfg(), ...patch }), now());
  const binKeys = () => { const apiKey = db.getSecret("binance_key"); const apiSecret = db.getSecret("binance_secret"); return apiKey && apiSecret ? { apiKey, apiSecret } : null; };
  let binInstance: BinancePay | null = null; let binInstanceKey = "";
  const binanceClient = (): BinancePay | null => {
    const k = binKeys();
    if (!k) { binInstance = null; return null; }
    if (!binInstance || binInstanceKey !== k.apiKey) { binInstance = new BinancePay(k, cfg.fetchImpl ?? fetch, cfg.binanceBaseUrl); binInstanceKey = k.apiKey; }
    return binInstance;
  };
  const binanceOn = () => { const c = binCfg(); return c.enabled && c.rate > 0 && !!binKeys(); };
  /** Convierte el total en Bs (centavos) a USDT con la tasa; redondea hacia arriba para no cobrar de menos. */
  const usdtFor = (totalCents: number) => Math.max(0.01, Math.ceil((totalCents / 100) / binCfg().rate * 100) / 100);

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
      checkTelegramAlerts().catch((e) => log(`telegram falló: ${(e as Error).message}`));
      checkPushAlerts().catch((e) => log(`avisos al celular fallaron: ${(e as Error).message}`));
      checkDailyReport().catch((e) => log(`reporte del día falló: ${(e as Error).message}`));
      checkResellerPush().catch((e) => log(`avisos a revendedores fallaron: ${(e as Error).message}`));
      checkNoonPush().catch((e) => log(`resumen del mediodía falló: ${(e as Error).message}`));
      expiry.check().catch((e) => log(`avisos de vencimiento fallaron: ${(e as Error).message}`));
      checkBcbRate().then((r) => { if (r?.applied) log(`tasa del BCB: ${r.rate} (${r.date})`); }, (e) => log(`tasa del BCB falló: ${(e as Error).message}`));
    }, 60_000));
    timers.forEach((t) => t.unref());
  }

  return {
    server, store, db, runJobs, flushWhatsApp, pollMail, checkBcbRate, checkPushAlerts, checkResellerPush, checkNoonPush, checkExpiryPush: () => expiry.check(), checkDailyReport, handleInbound, watchMail,
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
