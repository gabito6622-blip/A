// Servidor HTTP de Gabriel Store: API JSON + archivos estáticos de la tienda y el panel.
// Sin frameworks: node:http. Cada ruta declara quién puede llamarla; el núcleo vuelve a
// validar permisos (defensa en dos capas).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createStore, DomainError, normalizePhone, systemClock, type Actor, type Clock, type GabrielStore } from "../store/index.js";
import { Db } from "./db.js";
import { hashPassword, newToken, OtpStore, RateLimiter, sha256, verifyPassword } from "./security.js";
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
  /** Para pruebas: reemplaza fetch y la URL de Meta. */
  fetchImpl?: typeof fetch;
  metaBaseUrl?: string;
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
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
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
  const db = new Db(join(cfg.dataDir, "gabriel.db"));
  const store = createStore({ clock, initialState: db.loadLatest(), onCommit: (s) => db.saveState(s, clock.now()) });
  const system: Actor = { id: "system:jobs", role: "system" };

  const now = () => clock.now();
  const loginLimiter = new RateLimiter(5, 15 * 60_000, now);
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
      storeName: st.storeName, whatsapp: st.whatsapp, paymentNote: st.paymentNote ?? "", currency: st.currency, hasQr: !!st.qrFileRef,
      accentColor: st.accentColor || "#3984ff", backgroundColor: st.backgroundColor || "#090e1d", hasLogo: !!st.logoFileRef,
      heroTitle: st.heroTitle || "Todo lo digital,", heroHighlight: st.heroHighlight || "en un solo lugar.",
      heroText: st.heroText || "Suscripciones, herramientas de IA y productividad. Pagás con QR o con tu saldo, y recibís tus accesos en tu cuenta.",
      announcement: st.announcement ?? "",
    };
  });
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
      return { loggedIn: true, kind: "customer", role: c.actor.role, id: cu.id, name: cu.name, phone: cu.phone, balance: store.wallet.balance(cu.id), whatsappConsent: cu.whatsappConsent };
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

  route("GET", "/api/admin/stats", "staff", (c) => store.stats.summary(A(c), { from: Number(c.query.get("from") ?? now() - 30 * 24 * HOUR), to: Number(c.query.get("to") ?? now() + HOUR) }));
  route("GET", "/api/admin/suppliers-report", "staff", (c) => store.stats.suppliers(A(c)));
  route("GET", "/api/admin/audit", "staff", (c) => store.stats.audit(A(c), { action: c.query.get("action") ?? undefined, limit: Number(c.query.get("limit") ?? 200) }));
  route("GET", "/api/admin/stock", "staff", () => store.inventory.stock());
  route("GET", "/api/admin/outbox", "staff", (c) => store.notify.outbox(A(c)).slice(-200).reverse());

  route("GET", "/api/admin/products", "staff", () => Object.values(snap().products));
  route("POST", "/api/admin/products", "staff", (c) => store.catalog.upsertProduct(A(c), c.body));
  route("GET", "/api/admin/price-groups", "staff", () => Object.values(snap().priceGroups));
  route("POST", "/api/admin/price-groups", "staff", (c) => store.catalog.upsertPriceGroup(A(c), c.body));
  route("GET", "/api/admin/suppliers", "staff", () => Object.values(snap().suppliers));
  route("POST", "/api/admin/suppliers", "staff", (c) => store.catalog.upsertSupplier(A(c), c.body));

  route("GET", "/api/admin/accounts", "staff", (c) => store.inventory.listAccounts(A(c), { withSecrets: c.query.get("secrets") === "1" }));
  route("POST", "/api/admin/accounts", "staff", (c) => store.inventory.addAccount(A(c), c.body));
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

  route("GET", "/api/admin/orders", "staff", (c) => store.admin.orders(A(c), { status: (c.query.get("status") ?? undefined) as never, customerId: c.query.get("customerId") ?? undefined }));
  route("POST", "/api/admin/orders", "staff", (c) => store.orders.create(A(c), { customerId: c.body?.customerId, items: c.body?.items ?? [], paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey }));
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
  route("POST", "/api/admin/customers/:id", "staff", (c) => {
    const b = c.body ?? {};
    return store.catalog.updateCustomer(A(c), c.params.id, { name: b.name, phone: b.phone, email: b.email, notes: b.notes, kind: b.kind, priceGroupId: b.priceGroupId });
  });
  route("GET", "/api/admin/customers/:id/ledger", "staff", (c) => store.wallet.history(A(c), c.params.id));
  route("POST", "/api/admin/customers/:id/adjust", "staff", (c) => store.wallet.adjust(A(c), c.params.id, c.body?.amount, String(c.body?.reason ?? "")));
  route("POST", "/api/admin/customers/:id/consent", "staff", (c) => (store.catalog.setWhatsappConsent(A(c), c.params.id, !!c.body?.whatsapp), { ok: true }));
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
  route("POST", "/api/admin/assignments/:id/renew", "staff", (c) => store.orders.renew(A(c), c.params.id, { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod ?? "cash", allowBeyondSupplier: c.body?.allowBeyondSupplier, idempotencyKey: c.body?.idempotencyKey }));
  route("POST", "/api/admin/assignments/renew-many", "staff", (c) => store.orders.renewMany(A(c), c.body?.ids ?? [], { periods: c.body?.periods, paymentMethod: c.body?.paymentMethod ?? "cash", batchKey: c.body?.batchKey }));
  route("POST", "/api/admin/assignments/:id/transfer", "staff", (c) => store.orders.transfer(A(c), c.params.id, String(c.body?.toCustomerId ?? ""), String(c.body?.reason ?? "")));
  route("POST", "/api/admin/assignments/:id/replace", "staff", (c) => store.orders.replace(A(c), c.params.id, { reason: String(c.body?.reason ?? ""), oldSlot: c.body?.oldSlot, otherAccount: !!c.body?.otherAccount }));
  route("POST", "/api/admin/reminders", "staff", (c) => ({ queued: store.orders.queueExpiryReminders(A(c), Number(c.body?.withinDays ?? 3)) }));

  route("GET", "/api/admin/staff", "staff", (c) => store.admin.listStaff(A(c)));
  route("POST", "/api/admin/staff", "staff", (c) => store.admin.createStaff(A(c), { username: c.body?.username, name: c.body?.name, role: c.body?.role, passwordHash: hashOrThrow(c.body?.password) }));
  route("POST", "/api/admin/staff/:id/active", "staff", (c) => {
    const u = store.admin.setStaffActive(A(c), c.params.id, !!c.body?.active);
    if (!u.active) db.deleteSessionsOf(u.id);
    return u;
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
    const pick = ["storeName", "whatsapp", "paymentNote", "accentColor", "backgroundColor", "heroTitle", "heroHighlight", "heroText", "announcement"]
      .filter((k) => typeof b[k] === "string").reduce((o, k) => ({ ...o, [k]: b[k] }), {});
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

  route("POST", "/api/admin/mailboxes", "staff", (c) => store.codes.configureMailbox(A(c), { address: c.body?.address, host: c.body?.host, subjectAllowlist: c.body?.subjectAllowlist ?? [] }));

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
    return `${base}/#acceso=${token}`;
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
    if (!existsSync(file)) file = join(root, "index.html");
    if (!existsSync(file)) return false;
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
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
    const ip = req.socket.remoteAddress ?? "?";
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

  function runJobs() {
    const expired = store.orders.expireReservations(system);
    const reminders = store.orders.queueExpiryReminders(system, 3);
    const closed = store.orders.closeExpired(system, 2);
    db.purgeExpiredSessions(now());
    return { expired, reminders, closed };
  }
  const timers: NodeJS.Timeout[] = [];
  if (cfg.jobs !== false) {
    timers.push(setInterval(() => {
      try {
        const r = runJobs();
        if (r.expired || r.reminders || r.closed) log(`tareas: ${JSON.stringify(r)}`);
      } catch (e) {
        log(`tareas fallaron: ${(e as Error).message}`);
      }
      flushWhatsApp().then((r) => { if (r.sent || r.failed) log(`whatsapp: ${JSON.stringify(r)}`); }, (e) => log(`whatsapp falló: ${(e as Error).message}`));
    }, 60_000));
    timers.forEach((t) => t.unref());
  }

  return {
    server, store, db, runJobs, flushWhatsApp,
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
