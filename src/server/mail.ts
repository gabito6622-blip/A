// Lector de correos (MIME) para sacar asunto, destinatarios, texto y enlaces.
// Soporta multipart, base64, quoted-printable, encabezados =?utf-8?...?= y HTML.

export interface ParsedMail {
  subject: string;
  /** Direcciones del encabezado (To, Delivered-To, X-Original-To, X-Forwarded-To, Cc), en minúsculas. */
  recipients: string[];
  from: string;
  /** Encabezado From completo (nombre + dirección), en minúsculas. */
  fromRaw: string;
  date?: number;
  text: string;
  html: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function decodeBytes(bytes: Buffer, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset.toLowerCase().replace(/^(us-ascii|ascii)$/, "utf-8")).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function qp(s: string): Buffer {
  const t = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** =?utf-8?B?...?= y =?iso-8859-1?Q?...?= */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, cs: string, enc: string, txt: string) =>
    decodeBytes(enc.toLowerCase() === "b" ? Buffer.from(txt, "base64") : qp(txt.replace(/_/g, " ")), cs));
}

function splitHead(raw: string): { headers: Map<string, string[]>; body: string } {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
  const headers = new Map<string, string[]>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const k = line.indexOf(":");
    if (k <= 0) continue;
    const name = line.slice(0, k).trim().toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), line.slice(k + 1).trim()]);
  }
  return { headers, body };
}

const param = (v: string, name: string) => new RegExp(`${name}\\*?=\\s*"?([^";]+)"?`, "i").exec(v)?.[1];

function walk(raw: string, out: { text: string[]; html: string[] }, depth = 0): void {
  if (depth > 6) return;
  const { headers, body } = splitHead(raw);
  const ct = headers.get("content-type")?.[0] ?? "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  if (type.startsWith("multipart/")) {
    const b = param(ct, "boundary");
    if (!b) return;
    const parts = body.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const p of parts) if (p.trim()) walk(p, out, depth + 1);
    return;
  }
  if (type === "message/rfc822") return walk(body, out, depth + 1);
  if (type !== "text/plain" && type !== "text/html") return;
  const enc = (headers.get("content-transfer-encoding")?.[0] ?? "").toLowerCase();
  const bytes = enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? qp(body) : Buffer.from(body, "latin1");
  const txt = decodeBytes(bytes, param(ct, "charset") ?? "utf-8");
  (type === "text/html" ? out.html : out.text).push(txt);
}

const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ" };
export function htmlToText(h: string): string {
  return h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m)
    .replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function parseMail(rawBuf: Buffer): ParsedMail {
  // latin1 conserva los bytes; cada parte se decodifica con su propio charset.
  const raw = rawBuf.toString("latin1");
  const { headers } = splitHead(raw);
  const h = (n: string) => (headers.get(n) ?? []).map((v) => decodeBytes(Buffer.from(v, "latin1")));
  const out = { text: [] as string[], html: [] as string[] };
  walk(raw, out);
  const recipients = [...new Set(["to", "delivered-to", "x-original-to", "x-forwarded-to", "envelope-to", "cc"].flatMap((n) => h(n).join(" ").match(EMAIL_RE) ?? []).map((x) => x.toLowerCase()))];
  const date = Date.parse(h("date")[0] ?? "");
  const html = out.html.join("\n");
  return {
    subject: decodeWords(h("subject")[0] ?? ""),
    from: (h("from")[0] ?? "").match(EMAIL_RE)?.[0]?.toLowerCase() ?? "",
    fromRaw: decodeWords(h("from")[0] ?? "").toLowerCase(),
    recipients,
    date: Number.isFinite(date) ? date : undefined,
    html,
    text: out.text.join("\n").trim() || htmlToText(html),
  };
}

/** Todas las direcciones de correo que aparecen en un texto (para correos reenviados a mano). */
export const emailsIn = (s: string) => [...new Set((s.match(EMAIL_RE) ?? []).map((x) => x.toLowerCase()))];

/** Arma un correo con un adjunto (para guardar respaldos en el buzón). */
export function buildMail(m: { from: string; to: string; subject: string; text: string; attachment: { name: string; data: Buffer; type: string }; date: number }): Buffer {
  const b = `gh-${m.date.toString(36)}-${Math.random().toString(36).slice(2)}`;
  const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const b64 = m.attachment.data.toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from([
    `From: ${m.from}`, `To: ${m.to}`, `Subject: ${enc(m.subject)}`, `Date: ${new Date(m.date).toUTCString()}`,
    `Message-ID: <${b}@gabohub>`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    Buffer.from(m.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${b}`, `Content-Type: ${m.attachment.type}; name="${m.attachment.name}"`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${m.attachment.name}"`, "", b64, `--${b}--`, "",
  ].join("\r\n"), "utf8");
}
