// Arranque del servidor de Gabriel Store.
//
// Variables de entorno:
//   PORT                 puerto (por defecto 8080)
//   GS_DATA_DIR          carpeta de datos (por defecto ./data)
//   GS_PUBLIC_ORIGIN     p. ej. https://gabostore.lat (activa cookies Secure si empieza con https)
//   GS_STATIC_DIR        carpeta con la tienda y el panel (por defecto ./public si existe)
//   GS_OWNER_USER        usuario del dueño, solo para crear el primero
//   GS_OWNER_PASSWORD    contraseña del dueño (mín. 10 caracteres), solo la primera vez
//   GS_DEV_OTP=1         SOLO desarrollo: muestra en la consola los códigos de acceso de clientes
//   GS_TRUST_PROXY=1     detrás de Render/Railway/Cloudflare: usa la IP real del cliente para los límites
//   GS_DATA_KEY          clave larga y secreta para cifrar las contraseñas de las cuentas en la base.
//                        ¡Guardala! Sin ella no se pueden leer las contraseñas ni restaurar respaldos.
//   GS_RESET_2FA=usuario si perdiste el celular: apaga la verificación en dos pasos de ese usuario al arrancar
//   GS_META_BASE_URL     SOLO pruebas: otra URL en vez de https://graph.facebook.com
//   ANTHROPIC_API_KEY    agentes con Claude (revisor de comprobantes, WhatsApp con IA, reporte del día).
//                        Se saca en console.anthropic.com. Sin ella, los agentes quedan apagados.
//   VAPID_PUBLIC_KEY     avisos al celular (Web Push): clave pública. Generalas con `npm run vapid`.
//   VAPID_PRIVATE_KEY    avisos al celular: clave privada (secreta).
//   VAPID_SUBJECT        contacto para los servicios de push: mailto:tu@correo o https://tu-dominio
//                        (si falta, se usa GS_PUBLIC_ORIGIN cuando es https). Sin claves, los avisos al celular quedan apagados.
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createApp } from "./app.js";

// Fechas, "hoy", días y meses del Dashboard y Finanzas: siempre con la hora de Bolivia.
process.env.TZ ||= "America/La_Paz";

const env = process.env;
const origin = env.GS_PUBLIC_ORIGIN;
const staticDir = env.GS_STATIC_DIR ?? (existsSync("public") ? "public" : undefined);

const vapidSubject = env.VAPID_SUBJECT || (origin?.startsWith("https://") ? origin : "");
const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && vapidSubject
  ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: vapidSubject } : null;
if ((env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY) && !vapid) console.warn("Avisos al celular: faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT.");

const app = createApp({
  dataDir: env.GS_DATA_DIR ?? "data",
  publicOrigin: origin,
  shopSubdomains: env.GS_SHOP_SUBDOMAINS === "1",
  secureCookies: !!origin?.startsWith("https://"),
  staticDir,
  metaBaseUrl: env.GS_META_BASE_URL,
  trustProxy: env.GS_TRUST_PROXY === "1",
  dataKey: env.GS_DATA_KEY || undefined,
  vapid,
  anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
  otpSender: env.GS_DEV_OTP === "1"
    ? (phone, code) => console.log(`[DEV] código para ${phone}: ${code}`)
    : undefined,
});

if (env.GS_RESET_2FA) {
  console.log(app.resetTwoFactor(env.GS_RESET_2FA) ? `Verificación en dos pasos desactivada para "${env.GS_RESET_2FA}". Borrá la variable GS_RESET_2FA.` : `GS_RESET_2FA: "${env.GS_RESET_2FA}" no tenía verificación en dos pasos.`);
}
if (env.GS_OWNER_USER && env.GS_OWNER_PASSWORD) {
  if (app.bootstrapOwner(env.GS_OWNER_USER, "Dueño", env.GS_OWNER_PASSWORD)) console.log(`Dueño "${env.GS_OWNER_USER}" creado.`);
} else if (!Object.keys(app.store.engine.s.staff).length) {
  console.warn("No hay usuarios del panel. Arrancá con GS_OWNER_USER y GS_OWNER_PASSWORD para crear el dueño.");
}

const port = await app.listen(Number(env.PORT ?? 8080));
console.log(`Gabriel Store escuchando en :${port}${staticDir ? ` (sirviendo ${staticDir})` : ""}`);

// Direcciones para abrirla desde esta PC y desde el celular (misma red WiFi).
const lan = Object.values(networkInterfaces()).flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal && !/^169\.254\./.test(n.address))
  .map((n) => n!.address);
console.log("\n  En esta PC:      http://localhost:" + port + "/panel   (tienda: http://localhost:" + port + "/)");
for (const ip of lan) console.log(`  En el celular:   http://${ip}:${port}/panel   (tienda: http://${ip}:${port}/)`);
if (lan.length) console.log("  El celular tiene que estar conectado al mismo WiFi que esta PC.");
console.log("  Para apagarla: cerrá esta ventana o apretá Ctrl+C.\n");

const stop = () => app.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
