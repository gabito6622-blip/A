// Demo de GaboHub como SaaS (Optimización 1, 13/11/2026). SOLO DATOS FICTICIOS, en una carpeta vacía.
// Uso: node scripts/seed-gabohub-demo.mjs ./data-gabohub-demo
//      GS_DATA_DIR=./data-gabohub-demo GS_STATIC_DIR=public PORT=8090 npm start
// Crea la tienda con catálogo y stock, la suscripción de GaboHub con prueba de 15 días y dos planes
// (Negocio Bs 49 / US$ 5, Vendedor Bs 28 / US$ 3; el Gratis no se cobra) PRENDIDA SOLO EN ESTA DEMO, y tres revendedores en tres
// momentos distintos: Ana (en prueba gratis), Beto (plan Vendedor, pagando) y Carla (plan Negocio, con página propia).
// No manda invitaciones ni mensajes: los PIN y links se generan desde el panel cuando el dueño quiera.
import { existsSync, readdirSync } from "node:fs";
import { createApp } from "../dist/server/app.js";

const dir = process.argv[2] ?? "data-gabohub-demo";
if (existsSync(dir) && readdirSync(dir).length) { console.error(`La carpeta ${dir} ya tiene datos. Usá una vacía.`); process.exit(1); }

const DAY = 864e5;
const clock = { t: Date.now() - 40 * DAY, now() { return this.t; } };
const at = (t) => { clock.t = t; };
const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
const s = app.store;
app.bootstrapOwner("gabriel", "Gabriel", "demo-gabriel-2026");
const owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
const system = { id: "system:demo", role: "system" };

// ---- Catálogo, lista de revendedor y stock ----
const P = [
  ["netflix", "Netflix Premium", "Streaming", "profile", 4000, "#e50914"], ["disney", "Disney+", "Streaming", "profile", 3500, "#113ccf"],
  ["max", "HBO Max", "Streaming", "profile", 3000, "#9b5cf6"], ["prime", "Prime Video", "Streaming", "profile", 2500, "#00a8e1"],
  ["spotify", "Spotify Premium", "Música", "invite", 2000, "#1db954"],
];
for (const [id, name, category, kind, price, color] of P) s.catalog.upsertProduct(owner, { id, name, category, kind, durationDays: 30, price, color, published: true });
s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 3000, disney: 2500, max: 2100, prime: 1700, spotify: 1300 } });
s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "Afuera (US$)", currency: "USD", prices: { netflix: 450, disney: 380, max: 320, prime: 260, spotify: 200 } });
s.catalog.updateSettings(owner, { storeName: "Gabriel Store", platformName: "GaboHub", whatsapp: "59170000000", paymentNote: "Banco Demo · QR de ejemplo", usdt: { enabled: true, payId: "123456789", rate: 10 } });
s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", active: true });
let em = 0;
const acc = (productId, n) => s.inventory.addAccount(owner, { productId, supplierId: "andes", email: `${productId}${String(++em).padStart(2, "0")}@proveedor.lat`, password: "Prov#Demo" + em, supplierExpiresAt: clock.now() + 200 * DAY, cost: 1000 * n, profiles: Array.from({ length: n }, (_, i) => ({ label: n === 1 ? "Cuenta completa" : `Perfil ${i + 1}` })) });
for (let i = 0; i < 6; i++) { acc("netflix", 5); acc("disney", 6); acc("max", 6); acc("prime", 6); acc("spotify", 6); }

// ---- Suscripción GaboHub (PRENDIDA SOLO EN LA DEMO): prueba 15 días, Negocio Bs 49 / US$ 5, Vendedor Bs 28 / US$ 3 ----
s.catalog.updateSettings(owner, { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", priceUsd: 500, trialDays: 15, sellerPrice: 2800, sellerPriceUsd: 300 } });

// ---- Tres revendedores ----
const mk = (name, phone, group) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: group, whatsappConsent: true }); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
const sell = (R, cid, productId) => s.orders.create(R.A, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "balance" });
const client = (R, name, phone) => s.catalog.createCustomer(R.A, { name, phone, whatsappConsent: true });

// Carla: hace 40 días, plan Negocio, página propia, clientes y ventas; pagó dos meses de suscripción.
const carla = mk("Carla Quispe", "+59171000001", "revendedor");
s.shops.setPage(owner, carla.c.id, true);
s.shops.setupFor(owner, carla.c.id, { slug: "carla-streaming", title: "Carla Streaming", enabled: true });
s.shops.update(carla.A, { accentColor: "#fcc42d", accent2Color: "#ffd95a", backgroundColor: "#070b16", bgStyle: "glow", cardStyle: "glass", headingFont: "outfit", fontFamily: "inter", corners: "round", heroTitle: "Tus plataformas,", heroHighlight: "al mejor precio ✨", heroText: "Netflix, Disney+, HBO Max y más. Pedí por WhatsApp y te lo activo al toque.", storeHours: "Todos los días de 8:00 a 22:00" });
s.portal.setPrices(carla.A, { netflix: 4500, disney: 3800, max: 3500, prime: 3000, spotify: 2500 });
s.wallet.adjust(owner, carla.c.id, 60000, "Recarga de saldo (demo)");
const cc = ["Marisel Rojas", "Ruthy Mamani", "José Antonio Vargas", "Juan Francisco Soto", "Daniela Pérez", "Kevin Flores"].map((n, i) => client(carla, n, `+5917550010${i}`));
cc.forEach((c, i) => { at(Date.now() - (38 - i * 5) * DAY); sell(carla, c.id, ["netflix", "disney", "max", "netflix", "prime", "spotify"][i]); });
at(Date.now() - 36 * DAY); s.shops.chargeRents(system); // arranca la prueba de Carla
at(Date.now() - 20 * DAY); s.shops.chargeRents(system); // termina la prueba: paga Bs 49
at(Date.now() - 2 * DAY); s.orders.renew(carla.A, s.engine.s.orders[Object.keys(s.engine.s.orders)[0]]?.assignmentIds?.[0] ?? Object.values(s.engine.s.assignments)[0].id, { paymentMethod: "balance" });

// Beto: hace 25 días, eligió el plan Vendedor (su vidriera, sin Mi día / Mi control / Quién me debe / Ganancias / Excel).
const beto = mk("Beto Mamani", "+59171000002", "revendedor");
s.wallet.adjust(owner, beto.c.id, 20000, "Recarga de saldo (demo)");
at(Date.now() - 25 * DAY); s.shops.chargeRents(system); // Beto entra en prueba
s.shops.setPlan(beto.A, beto.c.id, "seller");
const bc = ["Lucía Villca", "Marco Zurita", "Aneliz Contreras"].map((n, i) => client(beto, n, `+5917550020${i}`));
bc.forEach((c, i) => { at(Date.now() - (24 - i * 6) * DAY); sell(beto, c.id, ["netflix", "disney", "prime"][i]); });
at(Date.now() - 9 * DAY); s.shops.chargeRents(system); // termina su prueba: paga Bs 28 (Vendedor)

// Ana: hace 3 días, está en los 15 días de prueba gratis, con sus dos primeros clientes.
const ana = mk("Ana Flores", "+59171000003", "revendedor");
s.wallet.adjust(owner, ana.c.id, 10000, "Recarga de saldo (demo)");
at(Date.now() - 3 * DAY); s.shops.chargeRents(system); // Ana entra en prueba
const ac = ["Camila Rojas", "Diego Mamani"].map((n, i) => client(ana, n, `+5917550030${i}`));
ac.forEach((c, i) => { at(Date.now() - (2 - i) * DAY); sell(ana, c.id, ["netflix", "spotify"][i]); });

// Paula (US$): revendedora de afuera, en prueba, para ver los planes en dólares.
const paula = mk("Paula Afuera", "+50760000001", "lp-usd");
at(Date.now() - 1 * DAY); s.shops.chargeRents(system);

at(Date.now());
const info = (R) => { const r = s.shops.mine(R.A).rent; return `${R.c.name}: plan ${r.plan}${r.trial ? " · EN PRUEBA" : ""} · pagado hasta ${new Date(r.paidUntil).toLocaleDateString("es-BO")} · saldo ${(s.wallet.balance(R.c.id) / 100).toFixed(2)}`; };
console.log("Demo de GaboHub lista en", dir);
for (const R of [carla, beto, ana, paula]) console.log(" -", info(R));
console.log(" - Entrá al panel con gabriel / demo-gabriel-2026 → Revendedores → Ajustes (planes) y Revendedores (plan por persona).");
console.log(" - Página pública de Carla: /r/carla-streaming · GaboHub: /hub (entrar con el link de acceso de cada revendedor desde el panel).");
await app.close();
