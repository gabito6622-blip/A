// Revendedor nuevo: arranca fácil y seguro, y su página /r/<slug> muestra solo su marca (revisión de 3 meses, 15/11/2026).
// Por la API (sin navegador), con datos ficticios y carpeta temporal:
// 1) un revendedor «solo panel» no puede publicar su página de ninguna forma (logo, portada/QR, PUT enabled);
// 2) aprobar guarda el permiso de página explícito y «con página» lo habilita;
// 3) primeros pasos que se tachan solos; 4) la dirección sale del nombre de su TIENDA;
// 5) el HTML inicial, el pie y el PDF de su página no dicen «Gabriel Store»; textos de fábrica neutros; sus preguntas;
// 6) el link de códigos dice las plataformas reales; 7) el link de referidos va a /revendedores en el dominio propio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { inflateSync } from "node:zlib";
import { createApp } from "../dist/server/app.js";

const DAY = 86_400_000;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64").toString("base64");
let dir, app, base, s, owner, ock;

const call = async (method, path, body, cookie) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, text, cookie: r.headers.get("set-cookie")?.split(";")[0] };
};
/** Pide la solicitud, la aprueba el dueño (con o sin página) y entra con su PIN. */
async function newReseller(name, phone, approve) {
  s.shops.apply({ name, phone }); // directo: la ruta pública tiene un límite de 3 solicitudes por hora y por IP
  const app1 = (await call("GET", "/api/admin/resellers", undefined, ock)).json.apps.find((a) => a.phone.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-8)));
  const ap = await call("POST", `/api/admin/reseller-apps/${app1.id}/approve`, approve, ock);
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const ck = (await call("POST", "/api/auth/customer/pin", { phone, pin: ap.json.pin })).cookie;
  return { id: ap.json.customerId, ck, ap: ap.json, actor: { id: "u_" + ap.json.customerId, role: "reseller", customerId: ap.json.customerId } };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "gs-r4-"));
  app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red en las pruebas"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  s = app.store; owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.updateSettings(owner, { storeName: "Gabriel Store", whatsapp: "59170000001" });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix 1 perfil", kind: "profile", durationDays: 30, price: 3500, published: true, category: "Streaming" });
  s.catalog.upsertProduct(owner, { id: "hbo", name: "Max (HBO)", kind: "profile", durationDays: 30, price: 3000, published: true, category: "Streaming" });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { nf: 2500, hbo: 2200 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor ficticio", active: true });
  for (const [pid, i] of [["nf", 1], ["hbo", 2]]) s.inventory.addAccount(owner, { productId: pid, supplierId: "prov", email: `${pid}${i}@ficticio.lat`, password: `Clave-Ficticia#${i}`, supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [1, 2, 3].map((k) => ({ label: `Perfil ${k}`, pin: String(1000 + k) })) });
  base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).cookie;
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test("solo panel: no se publica la página por ninguna de las 3 formas, y queda guardado al aprobar", async () => {
  const sol = await newReseller("Sol Panel", "+59171110101", { trust: "trusted", priceGroupId: "rev" });
  assert.equal(sol.ap.pageAllowed, false);
  assert.equal(s.engine.s.customers[sol.id].pageAllowed, false, "el permiso queda guardado explícito (antes quedaba sin definir)");
  // 1) PUT con enabled:true
  assert.equal((await call("PUT", "/api/me/shop", { title: "Sol TV", enabled: true }, sol.ck)).status, 403);
  // 2) subir logo, portada o QR (antes el logo creaba la página y la habilitaba)
  for (const kind of ["logo", "banner", "qr"]) assert.equal((await call("POST", `/api/me/shop/${kind}`, { contentBase64: PNG }, sol.ck)).status, 403, kind);
  assert.equal((await call("POST", "/api/me/shop/logo", { remove: true }, sol.ck)).status, 403, "quitar sin tener página tampoco la crea");
  // 3) y después del intento, otra vez PUT
  assert.equal((await call("PUT", "/api/me/shop", { title: "Sol TV", enabled: true }, sol.ck)).status, 403);
  assert.equal(s.engine.s.customers[sol.id].shop, undefined, "no se creó ninguna página");
  const mine = (await call("GET", "/api/me/shop", undefined, sol.ck)).json;
  assert.deepEqual([mine.pageAllowed, mine.saved], [false, false]);
  assert.equal((await call("GET", `/api/shops/${mine.slug}`)).status, 404);
  assert.equal((await call("GET", "/api/me/shop/slug?t=Sol%20TV", undefined, sol.ck)).status, 403, "sin permiso tampoco propone dirección");
  // Un revendedor viejo (sin permiso guardado y sin página) tampoco se la crea subiendo un logo.
  const viejo = s.catalog.createCustomer(owner, { name: "Viejo Rev", phone: "+59171110109", kind: "reseller", priceGroupId: "rev" });
  assert.throws(() => s.shops.setImage({ id: "u_" + viejo.id, role: "reseller", customerId: viejo.id }, "logo", "x.png"), (e) => e.code === "FORBIDDEN");
  // El dueño se la habilita después: ahí sí.
  assert.equal((await call("POST", `/api/admin/customers/${sol.id}/reseller-page`, { allowed: true }, ock)).status, 200);
  assert.equal((await call("POST", "/api/me/shop/logo", { contentBase64: PNG }, sol.ck)).status, 200);
  // Si se la quita, puede quitar su logo pero no volver a publicar.
  assert.equal((await call("POST", `/api/admin/customers/${sol.id}/reseller-page`, { allowed: false }, ock)).status, 200);
  assert.equal((await call("POST", "/api/me/shop/logo", { contentBase64: PNG }, sol.ck)).status, 403);
  assert.equal((await call("POST", "/api/me/shop/logo", { remove: true }, sol.ck)).status, 200);
  assert.equal((await call("PUT", "/api/me/shop", { enabled: true }, sol.ck)).status, 403);
  // Aprobado «con página»: puede armarla al toque. Un cliente no ve los primeros pasos de nadie.
  const ana = await newReseller("Ana Quispe", "+59171110001", { trust: "trusted", priceGroupId: "rev", page: true });
  assert.equal(ana.ap.pageAllowed, true);
  assert.equal((await call("PUT", "/api/me/shop", { title: "Ana TV" }, ana.ck)).status, 200);
  const audit = s.engine.s.audit.filter((a) => a.action === "reseller.approve").map((a) => a.meta?.page ?? a.data?.page ?? a.details?.page);
  assert.ok(audit.includes(true) && audit.includes(false), "la auditoría dice si se aprobó con página");
});

test("primeros pasos: se tachan solos (saldo, primera venta, página) y el independiente no recarga", async () => {
  const bea = await newReseller("Bea Nueva", "+59171110202", { trust: "trusted", priceGroupId: "rev" });
  let p = (await call("GET", "/api/me/primeros-pasos", undefined, bea.ck)).json;
  assert.deepEqual([p.buys, p.topup, p.sale, p.page], [true, false, false, "ask"]);
  s.wallet.adjust(owner, bea.id, 10000, "recarga ficticia");
  p = (await call("GET", "/api/me/primeros-pasos", undefined, bea.ck)).json;
  assert.deepEqual([p.topup, p.sale], [true, false]);
  const cli = s.catalog.createCustomer(bea.actor, { name: "Camila Cliente", phone: "+59176660001" });
  s.orders.create(bea.actor, { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "bea1" });
  p = (await call("GET", "/api/me/primeros-pasos", undefined, bea.ck)).json;
  assert.deepEqual([p.topup, p.sale, p.page], [true, true, "ask"]);
  await call("POST", `/api/admin/customers/${bea.id}/reseller-page`, { allowed: true }, ock);
  p = (await call("GET", "/api/me/primeros-pasos", undefined, bea.ck)).json;
  assert.equal(p.page, "build");
  assert.equal((await call("PUT", "/api/me/shop", { slug: "bea-tv", title: "Bea TV", enabled: true }, bea.ck)).status, 200);
  assert.equal((await call("GET", "/api/me/primeros-pasos", undefined, bea.ck)).json.page, "done");
  // Independiente: no le compra a la tienda, así que no hay paso de recarga; su venta es de sus cuentas propias.
  const ind = await newReseller("Carla Ruiz", "+59171110003", {});
  p = (await call("GET", "/api/me/primeros-pasos", undefined, ind.ck)).json;
  assert.deepEqual([p.independent, p.buys, p.topup, p.sale], [true, false, false, false]);
  const pr = s.own.saveProduct(ind.actor, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3 });
  const acc = s.own.saveAccount(ind.actor, { productId: pr.id ?? pr.product?.id, user: "flujo.uno", password: "Clave-1234", slots: 3 });
  s.own.assign(ind.actor, { accountId: acc.id ?? acc.account?.id, name: "Zoe", phone: "70022222", price: 3000, pay: "pagado" });
  assert.equal((await call("GET", "/api/me/primeros-pasos", undefined, ind.ck)).json.sale, true);
  // Un cliente (no revendedor) no tiene primeros pasos.
  const cliCk = (await call("POST", `/api/admin/customers/${cli.id}/login-pin`, {}, ock)).json.pin;
  const ck = (await call("POST", "/api/auth/customer/pin", { phone: "+59176660001", pin: cliCk })).cookie;
  assert.equal((await call("GET", "/api/me/primeros-pasos", undefined, ck)).status, 403);
});

test("dirección: sale del nombre de la tienda, libre y sin las reservadas", async () => {
  const dan = await newReseller("Daniela Paz", "+59171110303", { trust: "trusted", priceGroupId: "rev", page: true });
  let r = (await call("GET", "/api/me/shop/slug?t=Ana%20TV%20%C3%91and%C3%BA", undefined, dan.ck)).json;
  assert.equal(r.slug, "ana-tv-nandu");
  r = (await call("GET", "/api/me/shop/slug?t=Bea%20TV", undefined, dan.ck)).json;
  assert.deepEqual([r.slug, r.free], ["bea-tv-2", false], "bea-tv ya la usa otra revendedora: propone la siguiente");
  r = (await call("GET", "/api/me/shop/slug?t=Hub", undefined, dan.ck)).json;
  assert.equal(r.slug, "tienda-hub", "las direcciones del sistema no se proponen");
  assert.equal((await call("PUT", "/api/me/shop", { title: "Dani TV", slug: "dani-tv", enabled: true }, dan.ck)).json.slug, "dani-tv");
  assert.equal((await call("PUT", "/api/me/shop", { slug: "bea-tv" }, dan.ck)).status, 400, "la de otra no se puede tomar");
});

test("su página sin marca ajena: HTML inicial, pie, PDF, textos de fábrica neutros y sus preguntas", async () => {
  const eli = await newReseller("Elisa Mamani", "+59171110404", { trust: "trusted", priceGroupId: "rev", page: true });
  s.portal.setPrices(eli.actor, { nf: 3300, hbo: 2900 });
  assert.equal((await call("PUT", "/api/me/shop", { slug: "eli-tv", title: "Eli TV", enabled: true }, eli.ck)).status, 200);
  const html = await (await fetch(base + "/r/eli-tv")).text();
  assert.doesNotMatch(html, /Gabriel Store/, "el HTML inicial (antes del JS) no dice el nombre de la tienda");
  assert.match(html, /<span id="storeName"[^>]*>Eli TV<\/span>/);
  assert.match(html, /<span id="footName">© Eli TV<\/span>/);
  assert.match(html, /<i id="logoMark">E<\/i>/);
  // La tienda y GaboHub siguen con su nombre desde el primer cuadro.
  assert.match(await (await fetch(base + "/tienda/")).text(), /<span id="storeName"[^>]*>Gabriel Store<\/span>/);
  assert.match(await (await fetch(base + "/hub")).text(), /<span id="storeName"[^>]*>GaboHub<\/span>/);
  // Una página que no existe tampoco dice el nombre de la tienda.
  assert.doesNotMatch(await (await fetch(base + "/r/no-existe")).text(), /Gabriel Store/);
  // PDF de su página: ni en el contenido ni en sus propiedades.
  for (const path of ["/api/shops/eli-tv/catalogo.pdf"]) {
    const buf = Buffer.from(await (await fetch(base + path)).arrayBuffer());
    const raw = buf.toString("latin1");
    assert.match(raw, /\/Producer \(Eli TV\)/);
    let all = raw;
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { try { all += inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { /* imagen */ } }
    assert.doesNotMatch(all, /Gabriel/, path);
  }
  const pdfMine = Buffer.from(await (await fetch(base + "/api/me/descargas/catalogo.pdf", { headers: { cookie: eli.ck } })).arrayBuffer()).toString("latin1");
  assert.doesNotMatch(pdfMine.match(/\/Producer \([^)]*\)/)?.[0] ?? "", /Gabriel/);
  // Textos de fábrica: sin plataformas que quizás no vende ni «garantía»; los viejos guardados se muestran neutros.
  let pub = (await call("GET", "/api/shops/eli-tv")).json;
  assert.doesNotMatch(`${pub.heroText} ${pub.heroTicks} ${pub.heroChip}`, /Netflix|Spotify|Disney|Garant|inmediata/i);
  s.engine.tx(() => Object.assign(s.engine.s.customers[eli.id].shop, { heroText: "Netflix, Spotify, Disney+ y más. Pedí por WhatsApp y te lo activo al toque.", heroTicks: "Atención rápida, Garantía, Precios en Bs", heroChip: "✦ Entrega inmediata" }));
  pub = (await call("GET", "/api/shops/eli-tv")).json;
  assert.doesNotMatch(`${pub.heroText} ${pub.heroTicks} ${pub.heroChip}`, /Netflix|Spotify|Disney|Garant|inmediata/i);
  assert.match(pub.heroTicks, /Precios en Bs/);
  // Lo que escribió él no se toca.
  await call("PUT", "/api/me/shop", { heroText: "Netflix y Max al mejor precio", heroTicks: "Garantía total" }, eli.ck);
  pub = (await call("GET", "/api/shops/eli-tv")).json;
  assert.deepEqual([pub.heroText, pub.heroTicks], ["Netflix y Max al mejor precio", "Garantía total"]);
  // Sus preguntas frecuentes: las guarda, se ven en su página, se validan y vacío vuelve a las de fábrica.
  const faq = [{ q: "¿Hacen factura?", a: "No, solo recibo por WhatsApp." }, { q: "", a: "" }];
  assert.equal((await call("PUT", "/api/me/shop", { faq }, eli.ck)).status, 200);
  assert.deepEqual((await call("GET", "/api/shops/eli-tv")).json.faq, [faq[0]]);
  assert.equal((await call("PUT", "/api/me/shop", { faq: [{ q: "¿Sin respuesta?", a: "" }] }, eli.ck)).status, 400);
  assert.equal((await call("PUT", "/api/me/shop", { faq: Array.from({ length: 9 }, () => ({ q: "a", a: "b" })) }, eli.ck)).status, 400);
  assert.equal((await call("PUT", "/api/me/shop", { faq: [] }, eli.ck)).status, 200);
  assert.deepEqual((await call("GET", "/api/shops/eli-tv")).json.faq, []);
  // Nunca costos en su página.
  assert.doesNotMatch(JSON.stringify((await call("GET", "/api/shops/eli-tv")).json), /"cost"|2500|2200/);
});

test("link de códigos: dice las plataformas reales de sus cuentas, sin correos", async () => {
  const fab = s.catalog.createCustomer(owner, { name: "Fabio Choque", phone: "+59171110505" });
  for (const pid of ["nf", "hbo"]) s.orders.create(owner, { customerId: fab.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash" });
  const link = (await call("POST", `/api/admin/customers/${fab.id}/code-link`, {}, ock)).json;
  const token = link.url.split("/codigos/")[1];
  const info = (await call("GET", `/api/code-link/${token}`)).json;
  assert.deepEqual(info.platforms, ["Max", "Netflix"]);
  assert.doesNotMatch(JSON.stringify(info), /@ficticio/);
  const r = (await call("POST", `/api/code-link/${token}`, { email: "nf1@ficticio.lat" })).json;
  assert.deepEqual(r.platforms, ["Max", "Netflix"]);
  const js = await (await fetch(base + "/codigos.js")).text();
  assert.doesNotMatch(js, /Códigos de acceso de Disney\+\.|códigos de Disney\+ \/ MyDisney/, "ya no dice solo Disney+");
});

test("referidos: el link va a /revendedores y en el dominio propio esa página es la de revendedores", async () => {
  const js = await (await fetch(base + "/shop.js")).text();
  assert.match(js, /\/revendedores\?ref=\$\{encodeURIComponent\(r\.code\)\}/);
  const d2 = mkdtempSync(join(tmpdir(), "gs-r4-dom-"));
  const a2 = createApp({ dataDir: d2, staticDir: resolve("public"), jobs: false, log: () => {}, publicOrigin: "https://tienda-ficticia.test" });
  const port = await a2.listen(0, "127.0.0.1");
  const get = (path) => new Promise((ok, ko) => { const rq = request({ host: "127.0.0.1", port, path, headers: { host: "tienda-ficticia.test" } }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => ok({ status: res.statusCode, body: b })); }); rq.on("error", ko); rq.end(); });
  try {
    const home = await get("/?ref=cus_1");
    assert.match(home.body, /name="gs-mode" content="store"/, "«/» del dominio propio es la tienda de clientes");
    const rev = await get("/revendedores?ref=cus_1");
    assert.equal(rev.status, 200);
    assert.doesNotMatch(rev.body, /gs-mode" content="store"/, "/revendedores es la página para revendedores");
  } finally { await a2.close(); rmSync(d2, { recursive: true, force: true }); }
});
