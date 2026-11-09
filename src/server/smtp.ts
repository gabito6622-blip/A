// Envío de correos por SMTP (para verificación y recuperación de contraseña).
// Pensado para Gmail con contraseña de aplicación (smtp.gmail.com:465, TLS directo).
import { connect, type ConnectionOptions, type TLSSocket } from "node:tls";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  timeoutMs?: number;
  tls?: Pick<ConnectionOptions, "ca" | "rejectUnauthorized">;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
}

class Conn {
  private buf = "";
  private wake: (() => void) | null = null;
  private err: Error | null = null;
  constructor(private sock: TLSSocket) {
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => { this.buf += d; this.wake?.(); });
    const fail = (e: Error) => { this.err ??= e; this.wake?.(); };
    sock.on("error", fail);
    sock.on("close", () => fail(new Error("El servidor de correo cerró la conexión")));
  }
  /** Espera una respuesta completa (líneas que terminan con "NNN " y no "NNN-"). */
  async read(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = this.buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const text = lines.slice(0, i + 1).join("\n");
          this.buf = lines.slice(i + 1).join("\r\n");
          return { code: Number(lines[i].slice(0, 3)), text };
        }
      }
      if (this.err) throw this.err;
      await new Promise<void>((ok) => (this.wake = ok));
      this.wake = null;
    }
  }
  write(s: string) { this.sock.write(s); }
  end() { try { this.sock.end(); } catch { /* ya cerrado */ } }
}

const dot = (body: string) => body.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n..");
const encWord = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendMail(cfg: SmtpConfig, m: Mail): Promise<void> {
  if (!EMAIL.test(m.to)) throw new Error("Correo de destino inválido");
  const sock = connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...cfg.tls });
  sock.setTimeout(cfg.timeoutMs ?? 20_000, () => sock.destroy(new Error("El servidor de correo no respondió a tiempo")));
  const c = new Conn(sock);
  const expect = async (want: number, step: string) => {
    const r = await c.read();
    if (Math.floor(r.code / 100) !== Math.floor(want / 100) && r.code !== want) throw new Error(`Correo rechazado en ${step}: ${r.text.slice(0, 160)}`);
    return r;
  };
  try {
    await expect(220, "saludo");
    c.write(`EHLO gabohub\r\n`); await expect(250, "EHLO");
    c.write("AUTH LOGIN\r\n"); await expect(334, "AUTH");
    c.write(Buffer.from(cfg.user, "utf8").toString("base64") + "\r\n"); await expect(334, "usuario");
    c.write(Buffer.from(cfg.pass, "utf8").toString("base64") + "\r\n");
    await expect(235, "contraseña (¿es una contraseña de aplicación?)");
    c.write(`MAIL FROM:<${cfg.user}>\r\n`); await expect(250, "remitente");
    c.write(`RCPT TO:<${m.to}>\r\n`); await expect(250, "destinatario");
    c.write("DATA\r\n"); await expect(354, "DATA");
    const boundary = `gh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const headers = [
      `From: ${encWord(m.fromName ?? "Gabriel Store")} <${cfg.user}>`,
      `To: ${m.to}`,
      `Subject: ${encWord(m.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].join("\r\n");
    const body = [
      "", `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      Buffer.from(m.text ?? m.html.replace(/<[^>]+>/g, " "), "utf8").toString("base64"),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      Buffer.from(m.html, "utf8").toString("base64"),
      `--${boundary}--`, "",
    ].join("\r\n");
    c.write(dot(headers + "\r\n" + body) + "\r\n.\r\n");
    await expect(250, "envío");
    c.write("QUIT\r\n");
  } finally {
    c.end();
  }
}
