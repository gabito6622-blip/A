// Chequeo previo a publicar (B-100): detecta lo que falta sin mostrar valores secretos.
import { afterEach, describe, expect, it } from "vitest";
import { preflight } from "../server/src/cli/preflight.js";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const hex = (n: number) => Buffer.alloc(32, n).toString("hex");

describe("preflight (B-100)", () => {
  it("sin configuración de producción marca errores claros", async () => {
    process.env = { PATH: saved.PATH, NODE_ENV: "development" } as NodeJS.ProcessEnv;
    const r = await preflight();
    const errors = r.filter((x) => x.level === "error").map((x) => x.text).join("\n");
    expect(errors).toMatch(/NODE_ENV debe ser/);
    expect(errors).toMatch(/PUBLIC_URL/);
    expect(errors).toMatch(/SMTP_URL/);
  });

  it("con todo configurado no hay errores, y nunca muestra los valores secretos", async () => {
    const secret = { mfa: hex(1), link: hex(2), pass: "frase-de-prueba-larga-123456", smtp: "smtps://usuario:CLAVE-SMTP@smtp.ejemplo.bo:465" };
    process.env = {
      ...saved, NODE_ENV: "production", PUBLIC_URL: "https://clinica.ejemplo.bo", SMTP_URL: secret.smtp,
      DENTAL_MFA_KEY: secret.mfa, DENTAL_LINK_KEY: secret.link, BACKUP_PASSPHRASE: secret.pass, ALERT_EMAILS: "alertas@ejemplo.bo", TRUST_PROXY: "1",
    };
    const r = await preflight();
    expect(r.filter((x) => x.level === "error")).toEqual([]);
    const all = JSON.stringify(r);
    for (const v of [secret.mfa, secret.link, secret.pass, "CLAVE-SMTP"]) expect(all).not.toContain(v);
  });

  it("claves iguales, frase corta, http y WhatsApp a medias son errores", async () => {
    process.env = {
      ...saved, NODE_ENV: "production", PUBLIC_URL: "http://clinica.ejemplo.bo", SMTP_URL: "smtp://x@y:25",
      DENTAL_MFA_KEY: hex(3), DENTAL_LINK_KEY: hex(3), BACKUP_PASSPHRASE: "corta", WHATSAPP_TOKEN: "x",
    };
    const errors = (await preflight()).filter((x) => x.level === "error").map((x) => x.text).join("\n");
    expect(errors).toMatch(/distintas/);
    expect(errors).toMatch(/https/);
    expect(errors).toMatch(/WhatsApp a medias/);
  });
});
