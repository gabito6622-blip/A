// Genera las claves para los avisos al celular (Web Push). Uso: npm run vapid
// Copiá las dos líneas a las variables de entorno del servidor. La privada es secreta.
import { generateVapidKeys } from "../dist/server/push.js";
const k = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log("VAPID_SUBJECT=mailto:tu-correo@ejemplo.com   (o https://tu-dominio)");
