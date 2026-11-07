// Carga datos de EJEMPLO en una carpeta de datos nueva, para probar la tienda y el panel.
// Uso: npm run build && node scripts/seed-demo.mjs ./data-demo
//      GS_DATA_DIR=./data-demo GS_STATIC_DIR=public npm start
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../dist/server/app.js";
import { fakeQrPng } from "./png.mjs";

const dir = process.argv[2] ?? "data-demo";
if (existsSync(dir) && readdirSync(dir).length) {
  console.error(`La carpeta ${dir} ya tiene datos. Usá una carpeta vacía (los datos de ejemplo no se mezclan con datos reales).`);
  process.exit(1);
}
const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
const s = app.store;
const OWNER_PASS = "demo-gabriel-2026";
app.bootstrapOwner("gabriel", "Gabriel", OWNER_PASS);
const owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
const DAY = 864e5, now = Date.now();

const qr = randomBytes(16).toString("hex") + ".png";
writeFileSync(join(dir, "uploads", qr), fakeQrPng());
s.catalog.updateSettings(owner, { storeName: "Gabriel Store", whatsapp: "59170000000", paymentNote: "QR de ejemplo · Banco Demo · Gabriel Store", qrFileRef: qr });

const P = [
  ["gemini", "Gemini Pro", "Inteligencia artificial", "invite", 30, 2500, "#4f7cff", "IA de Google para escribir, estudiar y crear."],
  ["chatgpt", "ChatGPT Plus", "Inteligencia artificial", "full_account", 30, 4500, "#10a37f", "Modelos avanzados para trabajo y estudio."],
  ["duolingo", "Duolingo Super", "Educación", "invite", 30, 2000, "#58b302", "Idiomas sin anuncios y con vidas ilimitadas."],
  ["canva", "Canva Pro", "Productividad", "invite", 30, 2000, "#7d2ae8", "Plantillas premium y kit de marca."],
  ["netflix", "Netflix", "Streaming", "profile", 30, 3500, "#d81f26", "Un perfil privado con PIN."],
  ["combo-creador", "Combo Creador", "Combos", "combo", 30, 8000, "#d6336c", "ChatGPT Plus + Canva Pro + CapCut Pro."],
];
for (const [id, name, category, kind, durationDays, price, color, description] of P) s.catalog.upsertProduct(owner, { id, name, category, kind, durationDays, price, color, description, published: true });
s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, gemini: 1800, chatgpt: 3500 } });
s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", contact: "+591 70000001", active: true });
const acc = (productId, email, n, days) => s.inventory.addAccount(owner, { productId, supplierId: "andes", email, password: "Demo#" + Math.random().toString(36).slice(2, 8), supplierExpiresAt: now + days * DAY, cost: 3000, profiles: n === 1 ? [{ label: "Cuenta completa" }] : Array.from({ length: n }, (_, i) => ({ label: `Perfil ${i + 1}`, pin: String(1000 + i * 1111) })) });
acc("netflix", "nf01@gabostore.lat", 5, 90); acc("netflix", "nf02@gabostore.lat", 5, 60);
acc("gemini", "gm01@gabostore.lat", 5, 60); acc("chatgpt", "gpt01@gabostore.lat", 1, 45); acc("chatgpt", "gpt02@gabostore.lat", 1, 45);
acc("duolingo", "duo01@gabostore.lat", 6, 60); acc("canva", "cv01@gabostore.lat", 5, 60); acc("combo-creador", "combo01@gabostore.lat", 1, 40);

const maria = s.catalog.createCustomer(owner, { name: "María Quispe", phone: "+591 70011223", whatsappConsent: true });
const luis = s.catalog.createCustomer(owner, { name: "Luis Choque", phone: "+591 78889900" });
s.catalog.createCustomer(owner, { name: "Carla Vargas", phone: "+591 69990011", kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true });
s.wallet.adjust(owner, maria.id, 6000, "Saldo de ejemplo");
s.orders.create(owner, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
s.orders.create(owner, { customerId: luis.id, items: [{ productId: "gemini", qty: 1 }], paymentMethod: "cash" });
await app.close();
console.log(`Datos de ejemplo listos en ${dir}.\nPanel: usuario "gabriel", contraseña "${OWNER_PASS}" (cambiala en Configuración).`);
