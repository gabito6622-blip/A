// Link de cobro (/c/<token>) para los clientes de cada revendedor en "Repartir perfiles".
// Cubre: camino feliz, separación entre revendedores, que el dueño y su equipo no vean el cuaderno ni los
// tokens, lo mínimo en la respuesta pública, revocar / borrar / renovar, límite por IP y la página en el navegador.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { commercialName } from "../dist/store/subLinks.js";
import { createApp } from "../dist/server/app.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const APP_SRC = new URL("../src/server/app.ts", import.meta.url).pathname;
const owner = { id: "u_owner", role: "owner" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GONE = "Este link ya no sirve. Pedile uno nuevo a quien te vendió.";
const PUBLIC_KEYS = ["currency", "expiresAt", "hasQr", "label", "name", "pay", "price", "product", "seller", "sellerWhatsapp"];

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

/** Textos de todos los archivos de un .xlsx (zip), para buscar datos que no deberían estar. */
function unzipText(buf) {
  let out = "", i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extra, data = buf.subarray(start, start + size);
    out += (method === 8 ? inflateRawSync(data) : data).toString("utf8") + "\n";
    i = start + size;
  }
  return out;
}

describe("link de cobro (núcleo)", () => {
  test("nombre comercial: sin 'alquiler revendedores' ni aclaraciones internas", () => {
    assert.equal(commercialName("Disney+ (alquiler revendedores)"), "Disney+");
    assert.equal(commercialName("Disney Premium - Cuenta completa"), "Disney Premium");
    assert.equal(commercialName("HBO Max cuenta completa revendedores"), "HBO Max");
    assert.equal(commercialName("Prime Video [interno]"), "Prime Video");
    assert.equal(commercialName("(alquiler)"), "Tu servicio");
  });

  test("el índice se rehace solo si una transacción se deshace, y un estado cargado de la base resuelve sus links", () => {
    const T0 = Date.UTC(2026, 10, 7, 12);
    const clock = { t: T0, now() { return this.t; } };
    const s = createStore({ clock });
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 3400, published: true, resellersOnly: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "dis", supplierId: "andes", email: "d@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
    const rosa = s.catalog.createCustomer(owner, { name: "Rosa", phone: "+59171111111", kind: "reseller" });
    const aid = s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    const me = { id: "u_" + rosa.id, role: "reseller", customerId: rosa.id };
    const { sub } = s.subs.save(me, aid, { name: "Ana Pérez", expiresAt: T0 + 10 * DAY, price: 1500, pay: "pendiente" });
    const { token } = s.subs.link(me, aid, sub.id);
    assert.equal(s.subs.publicView(token).name, "Ana");
    // Una transacción que falla reemplaza el estado: el link sigue sirviendo.
    assert.throws(() => s.engine.tx(() => { s.engine.s.seq++; throw new DomainError("VALIDATION", "x"); }));
    assert.equal(s.subs.publicView(token).product, "Disney+");
    // Un link creado dentro de una transacción que se deshace no queda vivo.
    let ghost = "";
    assert.throws(() => s.engine.tx(() => { ghost = s.subs.link(me, aid, s.subs.save(me, aid, { name: "Fantasma", expiresAt: T0 + DAY }).sub.id).token; throw new DomainError("VALIDATION", "x"); }));
    assert.ok(ghost.length >= 32);
    assert.throws(() => s.subs.publicView(ghost), (e) => e instanceof DomainError && e.code === "NOT_FOUND");
    // El mismo estado cargado en otra tienda (como al reiniciar el servidor) resuelve el link.
    const s2 = createStore({ clock, initialState: s.snapshot() });
    assert.equal(s2.subs.publicView(token).label, "Perfil 1");
    // Si la tienda le pasa la cuenta a otro, el link muere (no muestra datos con el nombre de otro).
    const otro = s.catalog.createCustomer(owner, { name: "Otro Rev", phone: "+59172222299", kind: "reseller" });
    s.orders.transfer(owner, aid, otro.id, "prueba");
    assert.throws(() => s.subs.publicView(token), (e) => e instanceof DomainError && e.code === "NOT_FOUND" && e.message === GONE);
  });
});

describe("link de cobro (API)", () => {
  let dir, app, base, s, rosaId, juanId, aidRosa, aidJuan, ana, beto, juanSub, token;
  const cookies = {};
  const call = async (m, p, body, who) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const loginStaff = async (username, password) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];
  const loginCustomer = async (id, phone) => {
    await call("POST", `/api/admin/customers/${id}/login-pin`, { pin: "2468" }, "owner");
    return (await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin: "2468" }) })).headers.get("set-cookie").split(";")[0];
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-cobro-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red en las pruebas"); } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    const now = Date.now();
    s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 3400, published: true, resellersOnly: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const email of ["disney-rosa@x.lat", "disney-juan@x.lat"]) {
      s.inventory.addAccount(owner, { productId: "disney-alq", supplierId: "andes", email, password: "Clave-Secreta#77", supplierExpiresAt: now + 90 * DAY, cost: 2111, profiles: [{ label: "Cuenta completa", pin: "9753" }] });
    }
    rosaId = s.catalog.createCustomer(owner, { name: "Rosa Mamani", phone: "+59171111111", kind: "reseller" }).id;
    juanId = s.catalog.createCustomer(owner, { name: "Juan Play", phone: "+59172222222", kind: "reseller" }).id;
    s.shops.setupFor(owner, rosaId, { slug: "rosa-tv", title: "Rosa TV", whatsapp: "59171111111", enabled: false });
    aidRosa = s.orders.create(owner, { customerId: rosaId, items: [{ productId: "disney-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    aidJuan = s.orders.create(owner, { customerId: juanId, items: [{ productId: "disney-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    cookies.owner = await loginStaff("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/staff", { username: "ada", name: "Ada Admin", role: "admin", password: "clave-larga-admin-1" }, "owner");
    await call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" }, "owner");
    cookies.admin = await loginStaff("ada", "clave-larga-admin-1");
    cookies.seller = await loginStaff("seba", "clave-larga-seller-1");
    cookies.rosa = await loginCustomer(rosaId, "+59171111111");
    cookies.juan = await loginCustomer(juanId, "+59172222222");
    // Rosa sube su QR (su página sigue apagada) y anota dos perfiles; Juan anota uno suyo.
    assert.equal((await call("POST", "/api/me/shop/qr", { contentBase64: PNG.toString("base64") }, "rosa")).status, 200);
    ana = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Ana Pérez", phone: "72223344", label: "Mamá", expiresAt: now + 10 * DAY, price: 1500, pay: "pendiente" }, "rosa")).json.sub;
    beto = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Beto Secreto", phone: "73334455", label: "Tío", expiresAt: now + 20 * DAY, price: 1800 }, "rosa")).json.sub;
    juanSub = (await call("POST", `/api/me/subs/${aidJuan}`, { name: "Carla Juancito", phone: "74445566", expiresAt: now + 5 * DAY, price: 2000, pay: "no_pago" }, "juan")).json.sub;
    assert.ok(ana?.id && beto?.id && juanSub?.id);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("camino feliz: crear el link, ver la página con los datos justos y el QR del revendedor", async () => {
    const r = await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link`, {}, "rosa");
    assert.equal(r.status, 200);
    token = r.json.token;
    assert.match(token, /^[A-Za-z0-9_-]{32,}$/, "token url-safe de al menos 32 letras (192 bits)");
    assert.equal(Buffer.from(token, "base64url").length * 8 >= 128, true);
    assert.ok(r.json.url.endsWith(`/c/${token}`));
    const again = await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link`, {}, "rosa");
    assert.equal(again.json.token, token, "si ya tiene link devuelve el mismo");
    assert.equal(again.json.created, false);

    const v = await call("GET", `/api/cobro/${token}`);
    assert.equal(v.status, 200);
    assert.deepEqual(Object.keys(v.json).sort(), PUBLIC_KEYS, "solo la lista cerrada de campos");
    assert.equal(v.json.name, "Ana");
    assert.equal(v.json.label, "Mamá");
    assert.equal(v.json.product, "Disney+");
    assert.equal(v.json.price, 1500);
    assert.equal(v.json.pay, "pendiente");
    assert.equal(v.json.seller, "Rosa TV");
    assert.equal(v.json.sellerWhatsapp, "59171111111");
    assert.equal(v.json.hasQr, true);
    assert.equal(v.json.expiresAt, ana.expiresAt);
    assert.equal(v.headers.get("cache-control"), "no-store");

    // QR: por el link sí (aunque la página pública esté apagada); por la página apagada no.
    const qr = await fetch(`${base}/api/cobro/${token}/qr`);
    assert.equal(qr.status, 200);
    assert.equal(qr.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await qr.arrayBuffer()), PNG);
    assert.equal((await fetch(`${base}/api/shops/rosa-tv/qr`)).status, 404, "la página apagada no expone el QR");
    assert.equal((await fetch(`${base}/api/shops/rosa-tv`)).status, 404, "ni el resto de la página");

    // La página /c/<token>: sin indexar, sin Referer y con la CSP.
    const page = await fetch(`${base}/c/${token}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.match(html, /src="\/cobro\.js"/);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.match(await (await fetch(base + "/robots.txt")).text(), /Disallow: \/c\//);

    // El revendedor ve el token en su cuaderno (solo en ese perfil); la auditoría no guarda el token.
    const mine = (await call("GET", "/api/me/subs", null, "rosa")).json.list[0].subs;
    assert.equal(mine.find((x) => x.id === ana.id).linkToken, token);
    assert.equal(mine.find((x) => x.id === beto.id).linkToken, undefined);
    assert.equal(JSON.stringify(mine).includes('"link"'), false, "no sale quién ni cuándo lo creó");
    const ev = s.engine.s.audit.filter((a) => a.action === "reseller.sub_link");
    assert.equal(ev.length, 1);
    assert.ok(!JSON.stringify(s.engine.s.audit).includes(token), "el token no queda en la auditoría");
  });

  test("aislamiento: otro revendedor no crea ni revoca links ajenos; el link no muestra nada de más", async () => {
    for (const p of [`/api/me/subs/${aidRosa}/${ana.id}/link`, `/api/me/subs/${aidRosa}/${ana.id}/link/revoke`, `/api/me/subs/${aidRosa}/${beto.id}/link`]) {
      const r = await call("POST", p, {}, "juan");
      assert.ok([403, 404].includes(r.status), `${p}: ${r.status}`);
    }
    // Su propio alquiler con un perfil de Rosa: tampoco.
    assert.equal((await call("POST", `/api/me/subs/${aidJuan}/${ana.id}/link`, {}, "juan")).status, 404);
    // Sin sesión, o con sesión de staff, no se crean links.
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link`, {})).status, 401);
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link`, {}, "owner")).status, 401);
    // Sigue el mismo link de Rosa (Juan no lo revocó) y Beto no tiene link.
    assert.equal((await call("GET", `/api/cobro/${token}`)).status, 200);
    assert.equal(s.engine.s.assignments[aidRosa].subs.find((x) => x.id === beto.id).link, undefined);

    // La respuesta pública cruda no trae datos de la cuenta, costos, el teléfono del cliente, ni ids internos.
    const raw = (await call("GET", `/api/cobro/${token}`)).text;
    for (const bad of ["disney-rosa@x.lat", "Clave-Secreta#77", "72223344", "Pérez", "Beto", "Tío", "Juan", "Carla",
      aidRosa, aidJuan, rosaId, juanId, ana.id, beto.id, "alquiler", "revendedores", "email", "password", "pin", "cost", "phone", "customerId", "assignmentId", "slot"]) {
      assert.ok(!raw.includes(bad), `la respuesta pública no debe incluir ${bad}`);
    }
    // Números: PIN de la cuenta, costo de la cuenta, precio del producto y precio de otro perfil (como valores JSON).
    for (const n of [9753, 2111, 3400, 1800]) assert.ok(!new RegExp(`[:\\[,]"?${n}"?[,}\\]]`).test(raw), `la respuesta pública no debe incluir ${n}`);
    // Juan crea el suyo: muestra solo lo de Juan (sin página: nombre y teléfono del revendedor, sin QR).
    const tj = (await call("POST", `/api/me/subs/${aidJuan}/${juanSub.id}/link`, {}, "juan")).json.token;
    const vj = (await call("GET", `/api/cobro/${tj}`)).json;
    assert.deepEqual([vj.name, vj.seller, vj.sellerWhatsapp, vj.hasQr, vj.pay], ["Carla", "Juan Play", "59172222222", false, "no_pago"]);
    assert.equal((await fetch(`${base}/api/cobro/${tj}/qr`)).status, 404, "sin QR subido: 404");
    assert.notEqual(tj, token);
  });

  test("el dueño, el admin y el vendedor no ven el cuaderno ni los tokens en ninguna respuesta del panel", async () => {
    const src = readFileSync(APP_SRC, "utf8");
    const paths = [...src.matchAll(/route\("GET", "(\/api\/admin\/[^"]*)"/g)].map((m) => m[1]);
    const fill = (p) => p.includes(":") ? [p.replace(/:\w+/g, rosaId), p.replace(/:\w+/g, aidRosa)] : [p];
    const kinds = ["clientes", "ventas", "servicios", "cuentas", "movimientos", "todo"];
    const secrets = [token, "Ana Pérez", "72223344", "Beto Secreto", "73334455", "Carla Juancito", "linkToken", '"subs"'];
    let checked = 0;
    for (const who of ["owner", "admin", "seller"]) {
      for (const p of paths.flatMap(fill)) {
        if (/\/export\/|\/backups\//.test(p)) continue;
        const r = await call("GET", p, null, who);
        for (const x of secrets) assert.ok(!r.text.includes(x), `${who} ${p} muestra ${x}`);
        checked++;
      }
      for (const k of kinds) {
        for (const q of ["", "?secrets=1"]) {
          const r = await fetch(`${base}/api/admin/export/${k}${q}`, { headers: { cookie: cookies[who] } });
          if (r.status !== 200) continue;
          const txt = unzipText(Buffer.from(await r.arrayBuffer()));
          for (const x of secrets) assert.ok(!txt.includes(x), `${who} export ${k}${q} muestra ${x}`);
          checked++;
        }
      }
    }
    assert.ok(checked > 60, `se revisaron ${checked} respuestas`);
    // Auditoría (lo que ve el dueño): sin token ni datos del cliente.
    const audit = (await call("GET", "/api/admin/audit?limit=500", null, "owner")).text;
    assert.ok(audit.includes("reseller.sub_link"));
    for (const x of secrets) assert.ok(!audit.includes(x), `auditoría muestra ${x}`);
  });

  test("renovar conserva el link con la fecha nueva; revocar y borrar lo matan con un 404 genérico", async () => {
    const before = (await call("GET", `/api/cobro/${token}`)).json.expiresAt;
    const ren = await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/renew`, { paid: true }, "rosa");
    assert.equal(ren.status, 200);
    const after = (await call("GET", `/api/cobro/${token}`)).json;
    assert.equal(after.expiresAt, before + 30 * DAY, "mismo link, nueva fecha");
    assert.equal(after.pay, "pagado");
    // Editar el perfil tampoco lo cambia.
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}`, { id: ana.id, name: "Ana Pérez", phone: "72223344", label: "Mamá", expiresAt: after.expiresAt, price: 1500, pay: "pagado" }, "rosa")).status, 200);
    assert.equal((await call("GET", `/api/cobro/${token}`)).status, 200);

    const rv = await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link/revoke`, {}, "rosa");
    assert.deepEqual(rv.json, { ok: true, revoked: true });
    const gone = await call("GET", `/api/cobro/${token}`);
    assert.equal(gone.status, 404);
    assert.equal(gone.json.message, GONE);
    assert.equal((await fetch(`${base}/api/cobro/${token}/qr`)).status, 404);
    assert.ok(s.engine.s.audit.some((a) => a.action === "reseller.sub_link_revoke"));

    const fresh = (await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link`, {}, "rosa")).json;
    assert.equal(fresh.created, true);
    assert.notEqual(fresh.token, token, "un link nuevo es distinto");
    assert.equal((await call("GET", `/api/cobro/${token}`)).status, 404, "el viejo sigue muerto");
    assert.equal((await call("GET", `/api/cobro/${fresh.token}`)).status, 200);

    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/delete`, {}, "rosa")).status, 200);
    const del = await call("GET", `/api/cobro/${fresh.token}`);
    assert.equal(del.status, 404);
    assert.equal(del.json.message, GONE, "mismo mensaje: no dice si fue revocado o borrado");
    token = null;
  });

  test("en el navegador: la página del cliente y el botón en Repartir perfiles", { skip: !chromium && "Playwright no está instalado" }, async () => {
    const now = Date.now();
    const sub = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Lucía Rojas", phone: "75556677", label: "Mamá", expiresAt: now + 4 * DAY, price: 1500, pay: "pendiente" }, "rosa")).json.sub;
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, colorScheme });
        await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort()); // nunca sale un WhatsApp real
        const [name, value] = cookies.rosa.split("=");
        await ctx.addCookies([{ name, value, url: base }]);
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("dialog", (d) => d.accept());
        // Repartir perfiles → abrir el perfil → crear el link.
        await page.goto(base + "/hub#clientes");
        await page.getByRole("button", { name: /Lucía Rojas/ }).click();
        const create = page.getByRole("button", { name: /Crear link de cobro/ });
        const change = page.getByRole("button", { name: /Cambiar link/ });
        const box = page.locator(".sublink");
        if (colorScheme === "light") await create.click();
        else { // la segunda vez lo cambia (con confirmación) y el link nuevo reemplaza al viejo
          const old = await box.locator("code").innerText();
          await change.click();
          await page.waitForFunction((o) => { const c = document.querySelector(".sublink code"); return c && c.textContent !== o; }, old);
          assert.equal((await call("GET", `/api/cobro/${old.split("/c/")[1]}`)).status, 404, "el link viejo ya no sirve");
        }
        await box.locator("code").waitFor();
        const url = await box.locator("code").innerText();
        assert.match(url, /\/c\/[A-Za-z0-9_-]{32,}$/);
        const wa = await box.getByRole("link", { name: /Mandar por WhatsApp/ }).getAttribute("href");
        assert.match(wa, /^https:\/\/wa\.me\/59175556677\?text=/);
        assert.ok(decodeURIComponent(wa.split("text=")[1]).includes(url), "el WhatsApp lleva el link");
        const remind = await page.getByRole("link", { name: /Recordar renovación/ }).getAttribute("href");
        assert.ok(decodeURIComponent(remind).includes(url), "el recordatorio que ya existía incluye el link");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde en Repartir perfiles");

        // La página del cliente.
        const pg = await ctx.newPage();
        pg.on("pageerror", (e) => errors.push(e.message));
        await pg.goto(url);
        await pg.locator("h1").waitFor();
        assert.equal(await pg.locator("h1").innerText(), "Hola Lucía 👋");
        const text = await pg.locator("main").innerText();
        assert.match(text, /Disney\+/);
        assert.match(text, /faltan 4 días/);
        assert.match(text, /Bs 15/);
        assert.match(text, /Mantené apretado para guardar/);
        assert.ok(!/alquiler|revendedores/i.test(text));
        assert.equal(await pg.locator(".qr img").evaluate((i) => i.naturalWidth > 0), true, "se ve el QR");
        const paid = pg.getByRole("link", { name: "✅ Ya pagué, avisar a Rosa TV" });
        assert.equal(decodeURIComponent((await paid.getAttribute("href")).split("text=")[1]), "Hola, soy Lucía. Pagué Bs 15 del perfil Mamá de Disney+. Te mando el comprobante.");
        assert.match(await paid.getAttribute("href"), /^https:\/\/wa\.me\/59171111111\?/);
        const h = await paid.evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(h >= 44, `botón de ${h}px`);
        assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde a 360 px");
        assert.deepEqual(errors, []);
        await ctx.close();
      }
      // Pagado y con más de 5 días: "Estás al día", sin pedir pago.
      await call("POST", `/api/me/subs/${aidRosa}`, { id: sub.id, name: "Lucía Rojas", phone: "75556677", label: "Mamá", expiresAt: now + 20 * DAY, price: 1500, pay: "pagado" }, "rosa");
      const tk = (await call("POST", `/api/me/subs/${aidRosa}/${sub.id}/link`, {}, "rosa")).json.token;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
      const pg = await ctx.newPage();
      await pg.goto(`${base}/c/${tk}`);
      await pg.getByText(/Estás al día ✅ hasta \d\d\/\d\d/).waitFor();
      assert.equal(await pg.locator(".qr").count(), 0, "no pide pago");
      assert.equal(await pg.getByRole("link", { name: /Ya pagué/ }).count(), 0);
      // Un link que no sirve muestra el aviso genérico.
      await pg.goto(`${base}/c/${"x".repeat(40)}`);
      await pg.getByText("Este link ya no sirve").waitFor();
      await ctx.close();
    } finally { await browser.close(); }
  });

  test("límite por IP: muchos tokens inválidos seguidos terminan en 429", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await fetch(`${base}/api/cobro/${"Z".repeat(30)}${String(i).padStart(4, "0")}aa`)).status;
    assert.equal(last, 429);
    assert.equal((await fetch(`${base}/api/cobro/${"Q".repeat(40)}/qr`)).status, 429, "también la imagen");
  });
});
