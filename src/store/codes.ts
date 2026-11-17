// Códigos de verificación por correo.
// El dueño conecta un buzón (Gmail u otro IMAP); el servidor lee los correos nuevos y los
// entrega con `ingest`. El cliente ve solo códigos dirigidos a cuentas que tiene activas,
// recibidos después de su asignación y dentro de la ventana de visibilidad.
import type { Actor, CodeMessage, Id, Mailbox } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY, MINUTE } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { canActFor } from "./catalog.js";

/** Asuntos que se leen por defecto (en minúsculas, se busca que el asunto los contenga). */
export const DEFAULT_SUBJECTS = [
  "código", "codigo", "code", "acceso", "access", "inicio de sesión", "iniciar sesión", "sign in", "sign-in", "login",
  "verific", "verify", "passcode", "hogar", "household", "temporal", "temporary", "one-time", "único", "contraseña", "password",
];

export interface MailboxInput {
  id?: Id;
  address: string;
  host: string;
  subjectAllowlist?: string[];
  senderAllowlist?: string[];
  name?: string;
  kind?: "gmail" | "imap";
  port?: number;
  user?: string;
}

export function configureMailbox(e: Engine, actor: Actor, m: MailboxInput): Mailbox {
  authorize(actor, "codes.configure");
  const address = String(m.address ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new DomainError("VALIDATION", "Correo inválido");
  const host = String(m.host ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new DomainError("VALIDATION", "Servidor de correo inválido (p. ej. imap.gmail.com)");
  const port = m.port === undefined ? undefined : Number(m.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new DomainError("VALIDATION", "Puerto inválido");
  const subjects = (m.subjectAllowlist ?? DEFAULT_SUBJECTS).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 60);
  if (!subjects.length) throw new DomainError("VALIDATION", "Definí al menos un asunto permitido");
  const name = m.name === undefined ? undefined : String(m.name).trim().slice(0, 60);
  const senders = m.senderAllowlist === undefined ? undefined : m.senderAllowlist.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 30);
  return e.tx(() => {
    const prev = m.id ? e.get("mailboxes", m.id) : undefined;
    const box: Mailbox = {
      ...(prev ?? {}),
      id: prev?.id ?? e.id("mbx"), address, host, subjectAllowlist: subjects,
      authorizedBy: actor.id, authorizedAt: e.now(),
      ...(name ? { name } : {}), ...(m.kind ? { kind: m.kind } : {}), ...(port ? { port } : {}), ...(m.user ? { user: String(m.user).trim() } : {}),
    };
    if (senders !== undefined) { if (senders.length) box.senderAllowlist = senders; else delete box.senderAllowlist; }
    // Si cambió la cuenta de correo, empezar a leer de nuevo.
    if (prev && (prev.address !== box.address || prev.host !== box.host)) { delete box.lastUid; delete box.uidValidity; }
    e.s.mailboxes[box.id] = box;
    e.audit(actor, prev ? "mailbox.update" : "mailbox.authorize", "mailbox", box.id, { address: box.address, host: box.host });
    return structuredClone(box);
  });
}

export function removeMailbox(e: Engine, actor: Actor, id: Id): void {
  authorize(actor, "codes.configure");
  e.tx(() => {
    const box = e.get("mailboxes", id);
    delete e.s.mailboxes[id];
    e.audit(actor, "mailbox.remove", "mailbox", id, { address: box.address });
  });
}

export function listMailboxes(e: Engine, actor: Actor): Mailbox[] {
  authorize(actor, "codes.configure");
  return Object.values(e.s.mailboxes).map((m) => structuredClone(m)).sort((a, b) => a.authorizedAt - b.authorizedAt);
}

/** Estado de la última lectura (lo usa el lector automático). */
export function setMailboxStatus(e: Engine, actor: Actor, id: Id, st: { lastUid?: number; uidValidity?: number; error?: string; found?: number }): void {
  authorize(actor, "codes.ingest");
  e.tx(() => {
    const box = e.s.mailboxes[id];
    if (!box) return;
    box.lastCheckAt = e.now();
    if (st.error) box.lastError = st.error.slice(0, 200);
    else { delete box.lastError; box.lastOkAt = e.now(); }
    if (st.lastUid !== undefined) box.lastUid = st.lastUid;
    if (st.uidValidity !== undefined) box.uidValidity = st.uidValidity;
    if (st.found) box.codesFound = (box.codesFound ?? 0) + st.found;
  });
}

const CODE_RE = /\b(\d{3}[ -]?\d{3}|\d{4,8})\b/;
const LINK_RE = /https:\/\/(?:www\.)?netflix\.com\/(?:account\/(?:travel|update-primary-location|set-primary-location)|ilum|verify)[^\s"'<>)]*/i;

/** Saca el código (y si hay, el enlace de la plataforma) del texto del correo. */
/** Clasifica el tipo de código de Netflix/Disney por el asunto y el texto (español e inglés). */
export function classifyCode(subject: string, text: string): string {
  const s = `${subject} ${text}`.toLowerCase();
  if (/hogar|household/.test(s)) return "hogar";
  if (/inicio de sesi[oó]n|iniciar sesi[oó]n|inicie sesi[oó]n|sign.?in|log.?in|accede a tu cuenta/.test(s)) return "login";
  if (/acceso temporal|temporary access|c[oó]digo temporal|temporary code/.test(s)) return "temporal";
  if (/verificaci[oó]n|verify|verification|one.?time|[uú]nico|passcode/.test(s)) return "verificacion";
  return "otro";
}

export function extractCode(text: string, html = ""): { code: string; link?: string } {
  const t = text.replace(/ /g, " ");
  const near = /(?:c[oó]digo|code|codice|kod|kode|pin|passcode|senha|clave temporal|mot de passe)[^0-9\n]{0,80}\n?\s*(\d{3}[ -]?\d{3}|\d{4,8})\b/i.exec(t)?.[1];
  const alone = /^\s*(\d{3}[ -]?\d{3}|\d{4,8})\s*$/m.exec(t)?.[1];
  const any = t.split("\n").map((l) => CODE_RE.exec(l)?.[1]).find((c) => c && !/^(19|20)\d{2}$/.test(c));
  const link = LINK_RE.exec(html)?.[0]?.replace(/&amp;/g, "&") ?? LINK_RE.exec(t)?.[0];
  return { code: near ?? alone ?? any ?? "", ...(link ? { link } : {}) };
}

/** Guarda un mensaje solo si el asunto está permitido y trae un código o enlace. Devuelve null si se descarta. */
export function ingest(e: Engine, actor: Actor, mailboxId: Id, msg: { to: string; subject: string; body: string; html?: string; receivedAt: number; from?: string }): CodeMessage | null {
  authorize(actor, "codes.ingest");
  const box = e.get("mailboxes", mailboxId);
  // Disney+ y MyDisney pasan siempre (17/11/2026, pedido del dueño): sus asuntos cambian seguido («passcode», «MyDisney»…)
  // y los buzones viejos guardaron una lista de asuntos que no los cubría. Igual hace falta que el correo traiga un código.
  const esDisney = /disney/i.test(msg.from ?? "");
  if (!esDisney && box.senderAllowlist?.length && !box.senderAllowlist.some((s) => (msg.from ?? "").toLowerCase().includes(s))) return null;
  const allowed = esDisney || box.subjectAllowlist.some((s) => msg.subject.toLowerCase().includes(s.toLowerCase()));
  const { code, link } = extractCode(msg.body, msg.html);
  if (!allowed || (!code && !link)) return null;
  return e.tx(() => {
    const c: CodeMessage = { id: e.id("cod"), mailboxId, to: msg.to.toLowerCase(), subject: msg.subject.slice(0, 200), code, ...(link ? { link } : {}), kind: classifyCode(msg.subject, msg.body), receivedAt: msg.receivedAt };
    // Se guardan solo los de la última semana.
    e.s.codes = e.s.codes.filter((x) => e.now() - x.receivedAt < 7 * DAY);
    e.s.codes.push(c);
    return c;
  });
}

/** Para el dueño: los últimos códigos que llegaron y a qué cuenta corresponden. */
export function recentCodes(e: Engine, actor: Actor, limit = 50) {
  authorize(actor, "codes.configure");
  const byEmail = new Map(Object.values(e.s.accounts).map((a) => [a.email.toLowerCase(), a]));
  // Correos de cuentas PROPIAS de revendedores (que no son de la tienda): esos códigos son solo de él («Solo vos ves
  // esto»), aunque por error lleguen al lector de la tienda. El dueño no los ve en su lista.
  const own = new Set<string>();
  for (const b of Object.values(e.s.ownStock ?? {})) for (const a of b.accounts) { const u = a.user.trim().toLowerCase(); if (u.includes("@") && !byEmail.has(u)) own.add(u); }
  return e.s.codes.filter((c) => !own.has(c.to)).sort((a, b) => b.receivedAt - a.receivedAt).slice(0, limit).map((c) => {
    const acc = byEmail.get(c.to);
    return { to: c.to, subject: c.subject, code: c.code, link: c.link, kind: c.kind ?? classifyCode(c.subject, ""), receivedAt: c.receivedAt, mailbox: e.s.mailboxes[c.mailboxId]?.address ?? "", product: acc ? e.s.products[acc.productId]?.name ?? "" : "", matched: !!acc };
  });
}

/** Correos de cuentas cargadas (para saber a qué cuenta va un correo reenviado). */
export function accountEmails(e: Engine): Set<string> {
  return new Set(Object.values(e.s.accounts).map((a) => a.email.toLowerCase()));
}

export function codesFor(e: Engine, actor: Actor, customerId: Id) {
  if (!canActFor(e, actor, customerId)) throw new DomainError("FORBIDDEN", "No podés ver códigos de otro cliente");
  return codesOf(e, customerId);
}

/** Crea, cambia o borra el link de códigos de un cliente/revendedor (el token lo genera el servidor). */
export function setCodeLink(e: Engine, actor: Actor, customerId: Id, token: string | null) {
  // El revendedor maneja su propio link y el de SUS clientes; el equipo de la tienda, el de cualquiera.
  const ownClient = actor.role === "reseller" && (actor.customerId === customerId || e.s.customers[customerId]?.resellerId === actor.customerId);
  if (!ownClient) authorize(actor, "customer.manage");
  if (token !== null && !/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new DomainError("VALIDATION", "Token inválido");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    if (token) c.codeLink = { token, createdAt: e.now() }; else delete c.codeLink;
    e.audit(actor, token ? "customer.code_link" : "customer.code_link_off", "customer", c.id);
    return c.codeLink ? { ...c.codeLink } : null;
  });
}

/**
 * Nombre que ven los clientes en /codigos/<token>: el título de su tienda o su nombre, SIN la etiqueta interna del dueño
 * («aneliz · Aneliz Contreras» → «Aneliz Contreras», 15/11/2026).
 */
export const publicName = (name: string) => { const m = /^[^·]{1,40}·\s*(.+)$/.exec(String(name ?? "").trim()); return (m ? m[1] : String(name ?? "")).trim(); };

/** Para la página pública /codigos/<token>: de quién es el link (el PIN lo verifica el servidor). */
export function codeLinkOwner(e: Engine, token: string): { customerId: Id; name: string } | null {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const c = Object.values(e.s.customers).find((x) => x.codeLink?.token === token);
  // Si el título de su tienda es una copia de su nombre (se arma solo al crear la página), también va sin la etiqueta.
  const t = c?.codeTitle?.trim() || (c?.shop?.title && c.shop.title.trim() !== c.name.trim() ? c.shop.title : publicName(c?.name ?? ""));
  return c ? { customerId: c.id, name: t } : null;
}

/** Título propio de la página de códigos (vacío = el de su tienda o su nombre). El revendedor el suyo; el equipo, cualquiera. */
export function setCodeTitle(e: Engine, actor: Actor, customerId: Id, title: unknown) {
  if (!(actor.role === "reseller" && actor.customerId === customerId)) authorize(actor, "customer.manage");
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (t.length > 40) throw new DomainError("VALIDATION", "El título puede tener hasta 40 letras");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    if (t) c.codeTitle = t; else delete c.codeTitle;
    e.audit(actor, "customer.code_title", "customer", c.id, { title: t });
    return { title: t };
  });
}

/** Correos de las cuentas activas que muestra el link de un cliente/revendedor (las suyas y las de sus clientes). */
export function linkAccountsOf(e: Engine, customerId: Id): { email: string; product: string }[] {
  const out = new Map<string, string>();
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active" || !(a.customerId === customerId || e.s.customers[a.customerId]?.resellerId === customerId)) continue;
    const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId];
    if (acc && !out.has(acc.email.toLowerCase())) out.set(acc.email.toLowerCase(), e.s.products[a.productId]?.name ?? "");
  }
  return [...out].map(([email, product]) => ({ email, product })).sort((x, y) => x.email.localeCompare(y.email));
}

/**
 * 🔐 PIN por cuenta (15/11/2026): quién puede ponerlo y la auditoría. El PIN (con scrypt) lo guarda el servidor afuera
 * del estado. El revendedor pone el de SUS cuentas; el dueño o un admin, el de cualquiera.
 */
export function checkAccountPin(e: Engine, actor: Actor, customerId: Id, email: string, on: boolean) {
  const own = actor.role === "reseller" && actor.customerId === customerId;
  if (!own) authorize(actor, "customer.manage");
  const em = String(email ?? "").trim().toLowerCase();
  if (!linkAccountsOf(e, customerId).some((x) => x.email === em)) throw new DomainError("VALIDATION", "Ese correo no es de una cuenta activa de este revendedor");
  e.tx(() => e.audit(actor, on ? "customer.code_pin" : "customer.code_pin_off", "customer", customerId, { email: em }));
  return em;
}

/** Códigos de las cuentas activas del cliente (y de los clientes del revendedor). Uso interno, sin permisos. */
export function codesOf(e: Engine, customerId: Id) {
  const windowMs = e.opts.codeVisibleMinutes * MINUTE;
  const mine = Object.values(e.s.assignments)
    .filter((a) => (a.customerId === customerId || e.s.customers[a.customerId]?.resellerId === customerId) && a.status === "active")
    .map((a) => ({ email: e.s.accounts[e.s.slots[a.slotId].accountId].email.toLowerCase(), since: a.startsAt }));
  return e.s.codes
    .filter((c) => e.now() - c.receivedAt <= windowMs && mine.some((m) => m.email === c.to && c.receivedAt >= m.since))
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((c) => {
      const acc = Object.values(e.s.accounts).find((a) => a.email.toLowerCase() === c.to);
      return { to: c.to, subject: c.subject, code: c.code, link: c.link, kind: c.kind ?? classifyCode(c.subject, ""), receivedAt: c.receivedAt, product: acc ? e.s.products[acc.productId]?.name ?? "" : "" };
    });
}

/**
 * 📬 Correos que faltan conectar (17/11/2026). El dueño: «decime qué correos faltan añadir en las cuentas madres».
 * Agrupa las cuentas activas por su correo madre (lo de antes del «+»; en Gmail los puntos no cuentan) y dice, para cada
 * uno, si está conectado al lector de códigos, si está con error, si le llegan códigos igual (reenvío a otro conectado)
 * o si falta. Solo lee y nunca devuelve contraseñas: la puede ver un admin y la llave del asistente. Conectar o borrar
 * un correo sigue siendo solo del dueño.
 */
export function motherOf(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  if (!domain) return "";
  const base = local.split("+")[0];
  return `${/^(gmail|googlemail)\.com$/.test(domain) ? base.replace(/\./g, "") : base}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

export function mailboxCoverage(e: Engine, actor: Actor) {
  authorize(actor, "inventory.manage");
  const now = e.now();
  const boxes = Object.values(e.s.mailboxes ?? {});
  const boxByMother = new Map<string, (typeof boxes)[number]>();
  for (const b of boxes) for (const a of [b.address, b.user ?? ""]) { const m = motherOf(a); if (m && !boxByMother.has(m)) boxByMother.set(m, b); }
  const codesTo = new Map<string, number>();
  for (const c of e.s.codes ?? []) if (now - c.receivedAt < 7 * DAY) { const m = motherOf(c.to); codesTo.set(m, Math.max(codesTo.get(m) ?? 0, c.receivedAt)); }
  const groups = new Map<string, { mother: string; accounts: number; inUse: number; products: Set<string> }>();
  const used = new Set(Object.values(e.s.slots).filter((s) => s.status === "assigned").map((s) => s.accountId));
  for (const a of Object.values(e.s.accounts)) {
    if (a.status !== "active" || !a.email.includes("@")) continue;
    const m = motherOf(a.email);
    const g = groups.get(m) ?? { mother: m, accounts: 0, inUse: 0, products: new Set<string>() };
    g.accounts++; if (used.has(a.id)) g.inUse++;
    g.products.add((e.s.products[a.productId]?.name ?? a.productId).replace(/\s*\(alquiler revendedores\)/i, ""));
    groups.set(m, g);
  }
  const rows = [...groups.values()].map((g) => {
    const box = boxByMother.get(g.mother), lastCode = codesTo.get(g.mother);
    const state = box ? (box.lastError ? "error" : "ok") : lastCode ? "forwarded" : "missing";
    return { mother: g.mother, accounts: g.accounts, inUse: g.inUse, products: [...g.products].slice(0, 4), state, ...(box?.lastError ? { error: box.lastError.slice(0, 160) } : {}), ...(lastCode ? { lastCodeAt: lastCode } : {}) };
  });
  const order = { missing: 0, error: 1, forwarded: 2, ok: 3 } as const;
  rows.sort((x, y) => order[x.state as keyof typeof order] - order[y.state as keyof typeof order] || y.inUse - x.inUse || y.accounts - x.accounts || x.mother.localeCompare(y.mother));
  return {
    rows,
    mailboxes: boxes.map((b) => ({ address: b.address, ok: !b.lastError, ...(b.lastError ? { error: b.lastError.slice(0, 160) } : {}), lastOkAt: b.lastOkAt ?? null })),
    counts: { missing: rows.filter((r) => r.state === "missing").length, error: rows.filter((r) => r.state === "error").length, forwarded: rows.filter((r) => r.state === "forwarded").length, ok: rows.filter((r) => r.state === "ok").length },
  };
}
