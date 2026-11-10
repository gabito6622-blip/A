// Envío de correos transaccionales. Nunca incluir datos clínicos en un correo.
import nodemailer from "nodemailer";
import type { Config } from "../config.js";

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(m: Mail): Promise<void>; readonly configured: boolean }

/** Buzón en memoria para pruebas automatizadas. */
export class MemoryMailer implements Mailer {
  readonly configured = true;
  sent: Mail[] = [];
  async send(m: Mail) { this.sent.push(m); }
}

export function createMailer(cfg: Config, log: (msg: string) => void = console.log): Mailer {
  if (cfg.smtpUrl) {
    const t = nodemailer.createTransport(cfg.smtpUrl);
    return { configured: true, async send(m) { await t.sendMail({ from: cfg.mailFrom, to: m.to, subject: m.subject, text: m.text }); } };
  }
  return {
    configured: false,
    async send(m) {
      // Sin SMTP: en desarrollo se muestra en la consola; en producción no se registra el contenido (contiene enlaces de un solo uso).
      if (cfg.isProduction) log(`[correo] SMTP_URL no configurado: no se envió "${m.subject}"`);
      else log(`[correo de desarrollo] Para: ${m.to}\nAsunto: ${m.subject}\n${m.text}`);
    },
  };
}
