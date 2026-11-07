// Cliente IMAP mínimo (solo lectura) para traer los correos con códigos de verificación.
// Usa TLS directo (puerto 993). Comandos: LOGIN, SELECT, UID SEARCH, UID FETCH, LOGOUT.
// Nunca marca, mueve ni borra correos (BODY.PEEK).
import { connect, type ConnectionOptions, type TLSSocket } from "node:tls";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  timeoutMs?: number;
  /** Solo para pruebas (servidor con certificado propio). */
  tls?: Pick<ConnectionOptions, "ca" | "rejectUnauthorized">;
}

export interface RawMail {
  uid: number;
  raw: Buffer;
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

class ImapConn {
  private buf = Buffer.alloc(0);
  private n = 0;
  private wake: (() => void) | null = null;
  private err: Error | null = null;

  constructor(private sock: TLSSocket) {
    sock.on("data", (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.wake?.(); });
    const fail = (e: Error) => { this.err ??= e; this.wake?.(); };
    sock.on("error", fail);
    sock.on("close", () => fail(new Error("El servidor de correo cerró la conexión")));
  }

  private async waitFor<T>(check: () => T | undefined): Promise<T> {
    for (;;) {
      const r = check();
      if (r !== undefined) return r;
      if (this.err) throw this.err;
      await new Promise<void>((ok) => (this.wake = ok));
      this.wake = null;
    }
  }

  greeting(): Promise<string> {
    return this.waitFor(() => {
      const i = this.buf.indexOf("\r\n");
      if (i < 0) return undefined;
      const line = this.buf.subarray(0, i).toString("latin1");
      this.buf = this.buf.subarray(i + 2);
      return line;
    });
  }

  /** Manda un comando y devuelve todo lo recibido hasta la respuesta con su etiqueta. */
  async cmd(command: string): Promise<{ ok: boolean; status: string; data: Buffer }> {
    const tag = `G${++this.n}`;
    this.sock.write(`${tag} ${command}\r\n`);
    const end = await this.waitFor(() => tagEnd(this.buf, tag));
    const data = this.buf.subarray(0, end.lineStart);
    const status = this.buf.subarray(end.lineStart + tag.length + 1, end.end - 2).toString("utf8");
    this.buf = this.buf.subarray(end.end);
    return { ok: /^OK\b/i.test(status), status, data };
  }
}

/** Busca la línea "<tag> ..." saltando los literales {n}. */
function tagEnd(buf: Buffer, tag: string): { lineStart: number; end: number } | undefined {
  let pos = 0, lineStart = 0;
  for (;;) {
    const eol = buf.indexOf("\r\n", pos);
    if (eol < 0) return undefined;
    const lit = /\{(\d+)\}$/.exec(buf.subarray(Math.max(pos, eol - 20), eol).toString("latin1"));
    if (lit) {
      pos = eol + 2 + Number(lit[1]);
      if (pos > buf.length) return undefined;
      continue;
    }
    if (buf.subarray(lineStart, lineStart + tag.length + 1).toString("latin1") === `${tag} `) return { lineStart, end: eol + 2 };
    pos = lineStart = eol + 2;
  }
}

async function open(cfg: ImapConfig): Promise<ImapConn> {
  const sock = connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...cfg.tls });
  sock.setTimeout(cfg.timeoutMs ?? 20_000, () => sock.destroy(new Error("El servidor de correo no respondió a tiempo")));
  const c = new ImapConn(sock);
  const hello = await c.greeting();
  if (!/^\* (OK|PREAUTH)/i.test(hello)) throw new Error("El servidor de correo no aceptó la conexión");
  const login = await c.cmd(`LOGIN ${quote(cfg.user)} ${quote(cfg.pass)}`);
  if (!login.ok) {
    sock.destroy();
    throw new Error("Correo o contraseña de aplicación incorrectos" + (login.status ? ` (${login.status.replace(/^NO\s*/i, "").slice(0, 120)})` : ""));
  }
  return Object.assign(c, { sock });
}

function close(c: ImapConn) {
  const sock = (c as unknown as { sock: TLSSocket }).sock;
  c.cmd("LOGOUT").catch(() => undefined).finally(() => sock.destroy());
}

/** Prueba usuario y contraseña. Devuelve cuántos correos hay en la bandeja. */
export async function testImap(cfg: ImapConfig): Promise<{ messages: number }> {
  const c = await open(cfg);
  try {
    const sel = await c.cmd("EXAMINE INBOX");
    if (!sel.ok) throw new Error("No se pudo abrir la bandeja de entrada");
    return { messages: Number(/\* (\d+) EXISTS/i.exec(sel.data.toString("latin1"))?.[1] ?? 0) };
  } finally {
    close(c);
  }
}

/**
 * Trae los correos nuevos (UID mayor a `afterUid`). La primera vez (sin afterUid)
 * solo mira el último día. Como máximo `max` correos por vuelta.
 */
export async function fetchNew(cfg: ImapConfig, opts: { afterUid?: number; uidValidity?: number; since: number; max?: number }): Promise<{ mails: RawMail[]; uidValidity: number; lastUid: number }> {
  const c = await open(cfg);
  try {
    const sel = await c.cmd("EXAMINE INBOX");
    if (!sel.ok) throw new Error("No se pudo abrir la bandeja de entrada");
    const uidValidity = Number(/UIDVALIDITY (\d+)/i.exec(sel.data.toString("latin1"))?.[1] ?? 0);
    const fresh = !opts.afterUid || opts.uidValidity !== uidValidity;
    const d = new Date(opts.since);
    const crit = fresh ? `SINCE ${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}` : `UID ${opts.afterUid! + 1}:*`;
    const search = await c.cmd(`UID SEARCH ${crit}`);
    if (!search.ok) throw new Error("La búsqueda de correos falló");
    let uids = (/\* SEARCH([\d ]*)/i.exec(search.data.toString("latin1"))?.[1] ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
    if (!fresh) uids = uids.filter((u) => u > opts.afterUid!);
    uids = uids.sort((a, b) => a - b).slice(-(opts.max ?? 40));
    const mails: RawMail[] = [];
    for (const uid of uids) {
      const r = await c.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
      const m = /BODY\[\] \{(\d+)\}\r\n/i.exec(r.data.toString("latin1"));
      if (!r.ok || !m) continue;
      const start = m.index + m[0].length;
      mails.push({ uid, raw: r.data.subarray(start, start + Number(m[1])) });
    }
    const uidNext = Number(/UIDNEXT (\d+)/i.exec(sel.data.toString("latin1"))?.[1] ?? 0);
    const lastUid = Math.max(fresh ? 0 : opts.afterUid!, ...uids, uidNext - 1, 0);
    return { mails, uidValidity, lastUid };
  } finally {
    close(c);
  }
}
