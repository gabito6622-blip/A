// "📩 Ver mi código de acceso" en el link de cobro (/c/<token>): el cliente de un revendedor ve SOLO el
// código de su cuenta. Cubre: cuenta correcta y no otra, perfiles de la misma cuenta, vencidos, interruptor
// del revendedor y del dueño, revocado/borrado, respuesta sin datos de la cuenta, cuentas propias (solo si
// el lector lee su correo, sin cruces con la tienda ni con otro revendedor), auditoría y contador, límite
// por IP y la página en el navegador a 360 px. Los códigos se cargan con codes.ingest (lo que usa el
// lector), sin IMAP real. Reloj falso para mover el tiempo.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const owner = { id: "u_owner", role: "owner" };
const MIN = 60_000;
const GONE = "Este link ya no sirve. Pedile uno nuevo a quien te vendió.";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

describe("códigos solos en el link de cobro", () => {
  const clock = { t: Date.now(), now() { return this.t; } };
  let dir, app, base, s, mbx, rosaId, juanId, aidRosa, aidJuan, ana, beto, carla, tAna, tBeto, tCarla;
  const cookies = {};
  const call = async (m, p, body, who) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { status: r.status, json, text };
  };
  const loginStaff = async (username, password) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];
  const loginCustomer = async (id, phone) => {
    await call("POST", `/api/admin/customers/${id}/login-pin`, { pin: "2468" }, "owner");
    return (await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin: "2468" }) })).headers.get("set-cookie").split(";")[0];
  };
  /** Un código que llega al correo `to` (como lo deja el lector IMAP). */
  const mail = (to, code, minutesAgo = 0, extra = {}) => s.codes.ingest(owner, mbx, { to, from: "Netflix <info@account.netflix.com>", subject: "Tu código de inicio de sesión", body: `Hola,\nIngresá este código para iniciar sesión:\n${code}\nCuerpo secreto del correo con datos de ${to}`, receivedAt: clock.t - minutesAgo * MIN, ...extra });
  /** Pasa un rato: los límites por IP (15 min) arrancan de cero y los códigos de antes ya vencieron. */
  const later = (min = 31) => { clock.t += min * MIN; };
  const codes = (tk) => call("GET", `/api/cobro/${tk}/codes`);
  const mode = async (tk) => (await call("GET", `/api/cobro/${tk}`)).json?.codes;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-codsolos-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, clock, log: () => {}, fetchImpl: async () => { throw new Error("sin red en las pruebas"); } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    s.catalog.upsertProduct(owner, { id: "net-alq", name: "Netflix (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 4000, published: true, resellersOnly: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const email of ["net-rosa@x.lat", "net-juan@x.lat"]) {
      s.inventory.addAccount(owner, { productId: "net-alq", supplierId: "andes", email, password: "Clave-Secreta#77", supplierExpiresAt: clock.t + 90 * DAY, cost: 2500, profiles: [{ label: "Cuenta completa", pin: "9753" }] });
    }
    mbx = s.codes.configureMailbox(owner, { address: "codigos.tienda@gmail.com", host: "imap.gmail.com" }).id;
    rosaId = s.catalog.createCustomer(owner, { name: "Rosa Mamani", phone: "+59171111111", kind: "reseller" }).id;
    juanId = s.catalog.createCustomer(owner, { name: "Juan Play", phone: "+59172222222", kind: "reseller" }).id;
    aidRosa = s.orders.create(owner, { customerId: rosaId, items: [{ productId: "net-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    aidJuan = s.orders.create(owner, { customerId: juanId, items: [{ productId: "net-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    cookies.owner = await loginStaff("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/staff", { username: "ada", name: "Ada Admin", role: "admin", password: "clave-larga-admin-1" }, "owner");
    await call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" }, "owner");
    cookies.admin = await loginStaff("ada", "clave-larga-admin-1");
    cookies.seller = await loginStaff("seba", "clave-larga-seller-1");
    cookies.rosa = await loginCustomer(rosaId, "+59171111111");
    cookies.juan = await loginCustomer(juanId, "+59172222222");
    // Un código que llegó ANTES de que Ana y Beto entraran a la cuenta: no lo tienen que ver.
    mail("net-rosa@x.lat", "111111", 0);
    clock.t += MIN;
    ana = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Ana Pérez", phone: "72223344", label: "Mamá", expiresAt: clock.t + 10 * DAY, price: 1500 }, "rosa")).json.sub;
    beto = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Beto Secreto", phone: "73334455", label: "Tío", expiresAt: clock.t + 20 * DAY, price: 1800 }, "rosa")).json.sub;
    carla = (await call("POST", `/api/me/subs/${aidJuan}`, { name: "Carla Juancito", phone: "74445566", expiresAt: clock.t + 5 * DAY, price: 2000 }, "juan")).json.sub;
    tAna = (await call("POST", `/api/me/subs/${aidRosa}/${ana.id}/link`, {}, "rosa")).json.token;
    tBeto = (await call("POST", `/api/me/subs/${aidRosa}/${beto.id}/link`, {}, "rosa")).json.token;
    tCarla = (await call("POST", `/api/me/subs/${aidJuan}/${carla.id}/link`, {}, "juan")).json.token;
    assert.ok(tAna && tBeto && tCarla);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("apagado por defecto: sin el dueño y sin el revendedor no hay botón y la ruta da 404", async () => {
    later();
    clock.t += MIN; mail("net-rosa@x.lat", "222333");
    assert.equal(await mode(tAna), "off");
    assert.equal((await codes(tAna)).status, 404);
    // El revendedor lo prende, pero el dueño todavía no: sigue sin funcionar.
    assert.deepEqual((await call("POST", `/api/me/self-codes/rental/${aidRosa}`, { on: true }, "rosa")).json, { on: true });
    assert.equal(await mode(tAna), "off");
    assert.equal((await codes(tAna)).status, 404);
    const mine = (await call("GET", "/api/me/self-codes", null, "rosa")).json;
    assert.equal(mine.allowed, false, "el revendedor ve que la tienda no lo activó");
    assert.deepEqual(mine.rentals, [{ assignmentId: aidRosa, on: true }]);
    // Solo el dueño lo prende (admin y vendedor no).
    for (const who of ["admin", "seller"]) assert.equal((await call("POST", "/api/admin/self-codes", { on: true }, who)).status, 403, who);
    assert.equal((await call("POST", "/api/admin/self-codes", { on: true }, "rosa")).status, 403, "un revendedor no es del equipo");
    assert.equal((await call("POST", "/api/admin/self-codes", { on: true }, "owner")).json.allowed, true);
    assert.equal(await mode(tAna), "self");
    // Juan no lo prendió para su cuenta: su cliente no ve nada.
    assert.equal(await mode(tCarla), "off");
    assert.equal((await codes(tCarla)).status, 404);
  });

  test("ve solo los códigos de SU cuenta, recientes y de después de que entró; los perfiles de la misma cuenta ven el mismo", async () => {
    later();
    clock.t += MIN;
    mail("net-rosa@x.lat", "481 920");
    mail("net-juan@x.lat", "777888");
    mail("net-rosa@x.lat", "555666", 40); // llegó hace 40 min: vencido
    const r = await codes(tAna);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.codes.map((c) => c.code), ["481 920"]);
    assert.equal(r.json.codes[0].from, "Netflix", "nombre comercial, sin 'alquiler revendedores'");
    assert.equal(r.json.codes[0].kind, "login");
    assert.equal(r.json.now, clock.t);
    // Beto está en otro perfil de la MISMA cuenta: es el mismo correo, ve el mismo código.
    assert.deepEqual((await codes(tBeto)).json.codes.map((c) => c.code), ["481 920"]);
    // Pasados 30 minutos ya no sale.
    clock.t += 31 * MIN;
    assert.deepEqual((await codes(tAna)).json.codes, []);
    // Juan lo prende para su cuenta: Carla ve el de Juan y nunca el de Rosa.
    assert.equal((await call("POST", `/api/me/self-codes/rental/${aidJuan}`, { on: true }, "juan")).status, 200);
    clock.t += MIN; mail("net-juan@x.lat", "909090"); mail("net-rosa@x.lat", "123123");
    assert.deepEqual((await codes(tCarla)).json.codes.map((c) => c.code), ["909090"]);
    assert.deepEqual((await codes(tAna)).json.codes.map((c) => c.code), ["123123"]);
  });

  test("la respuesta cruda no trae correo, contraseña, asunto, cuerpo del correo ni ids", async () => {
    later();
    clock.t += MIN; mail("net-rosa@x.lat", "246810", 0, { html: '<a href="https://www.netflix.com/account/travel/verify?nftoken=abc">Obtener código</a>' });
    const r = await codes(tAna);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ["codes", "now"]);
    assert.deepEqual(Object.keys(r.json.codes[0]).sort(), ["at", "code", "from", "kind", "link"]);
    assert.match(r.json.codes[0].link, /^https:\/\/www\.netflix\.com\//);
    for (const bad of ["net-rosa@x.lat", "net-juan@x.lat", "@", "Clave-Secreta#77", "9753", "codigos.tienda", "Cuerpo secreto", "inicio de sesión", "info@account",
      "cod_", "mbx_", aidRosa, aidJuan, rosaId, ana.id, beto.id, tAna, "email", "password", "subject", "body", "to\"", "mailbox", "Ana", "Pérez", "72223344"]) {
      assert.ok(!r.text.includes(bad), `la respuesta no debe incluir ${bad}`);
    }
  });

  test("interruptores: el revendedor apaga → 404; otro revendedor no toca lo ajeno; el dueño apaga → 404 para todos", async () => {
    later();
    clock.t += MIN; mail("net-rosa@x.lat", "135790");
    // Juan no puede prender ni apagar la cuenta de Rosa; tampoco el staff con la ruta del revendedor.
    for (const on of [false, true]) assert.equal((await call("POST", `/api/me/self-codes/rental/${aidRosa}`, { on }, "juan")).status, 403);
    assert.equal((await call("POST", `/api/me/self-codes/rental/${aidRosa}`, { on: false }, "owner")).status, 401);
    assert.equal((await call("GET", "/api/me/self-codes", null, "owner")).status, 401);
    assert.equal((await codes(tAna)).status, 200, "sigue prendido");
    // Juan solo ve SUS cuentas y su contador.
    const j = (await call("GET", "/api/me/self-codes", null, "juan")).json;
    assert.deepEqual(j.rentals.map((r) => r.assignmentId), [aidJuan]);
    assert.ok(!JSON.stringify(j).includes(aidRosa));

    assert.equal((await call("POST", `/api/me/self-codes/rental/${aidRosa}`, { on: false }, "rosa")).json.on, false);
    assert.equal(await mode(tAna), "off");
    assert.equal((await codes(tAna)).status, 404);
    await call("POST", `/api/me/self-codes/rental/${aidRosa}`, { on: true }, "rosa");
    assert.equal((await codes(tAna)).status, 200);

    assert.equal((await call("POST", "/api/admin/self-codes", { on: false }, "owner")).json.allowed, false);
    for (const tk of [tAna, tBeto, tCarla]) {
      assert.equal(await mode(tk), "off");
      assert.equal((await codes(tk)).status, 404);
    }
    await call("POST", "/api/admin/self-codes", { on: true }, "owner");
    assert.equal((await codes(tAna)).status, 200);
  });

  test("link revocado o perfil borrado → 404 genérico; perfil vencido → 'pedile el código'", async () => {
    later();
    clock.t += MIN; mail("net-rosa@x.lat", "112233");
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${beto.id}/link/revoke`, {}, "rosa")).status, 200);
    const rv = await codes(tBeto);
    assert.equal(rv.status, 404);
    assert.equal(rv.json.message, GONE);
    tBeto = (await call("POST", `/api/me/subs/${aidRosa}/${beto.id}/link`, {}, "rosa")).json.token;
    assert.equal((await codes(tBeto)).status, 200, "el link nuevo sirve");
    // Un perfil vencido (no renovó) ya no ve códigos: que se lo pida a su vendedor.
    const vencida = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Vero Vencida", expiresAt: clock.t - DAY }, "rosa")).json.sub;
    const tv = (await call("POST", `/api/me/subs/${aidRosa}/${vencida.id}/link`, {}, "rosa")).json.token;
    assert.equal(await mode(tv), "ask");
    assert.equal((await codes(tv)).status, 404);
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${vencida.id}/delete`, {}, "rosa")).status, 200);
    const del = await codes(tv);
    assert.equal(del.status, 404);
    assert.equal(del.json.message, GONE);
    // Token inventado: mismo 404.
    assert.equal((await codes("Z".repeat(40))).status, 404);
  });

  test("auditoría con ids (sin token, correo ni código) y contador del mes sin repetir", async () => {
    later();
    const before = (await call("GET", "/api/me/self-codes", null, "rosa")).json.month;
    clock.t += MIN; mail("net-rosa@x.lat", "864200"); mail("net-rosa@x.lat", "975310");
    const n0 = s.engine.s.audit.filter((a) => a.action === "codes.self_view").length;
    await codes(tAna); await codes(tAna); await codes(tBeto);
    const ev = s.engine.s.audit.filter((a) => a.action === "codes.self_view").slice(n0);
    assert.equal(ev.length, 3, "cada consulta queda en la auditoría");
    assert.deepEqual(ev[0].data, { sub: ana.id, reseller: rosaId, found: 2, ids: ev[0].data.ids });
    assert.equal(ev[0].entity, "assignment");
    assert.equal(ev[0].entityId, aidRosa);
    assert.ok(ev[0].data.ids.every((x) => /^cod_\d+$/.test(x)));
    const all = JSON.stringify(s.engine.s.audit);
    for (const bad of [tAna, tBeto, tCarla, "864200", "975310", "net-rosa@x.lat"]) assert.ok(!all.includes(bad), `la auditoría no debe tener ${bad}`);
    // Contador: Ana vio 2 (aunque consultó 2 veces) y Beto 2 → +4.
    const mine = (await call("GET", "/api/me/self-codes", null, "rosa")).json;
    assert.equal(mine.month, before + 4);
    const j = (await call("GET", "/api/me/self-codes", null, "juan")).json;
    assert.ok(j.month < mine.month, "Juan tiene su propio contador");
    // El dueño ve el total y cuántos revendedores lo usan, sin tokens ni clientes.
    const o = await call("GET", "/api/admin/self-codes", null, "owner");
    assert.deepEqual(Object.keys(o.json).sort(), ["allowed", "month", "resellers"]);
    assert.equal(o.json.month, mine.month + j.month);
    assert.equal(o.json.resellers, 2);
    for (const bad of [tAna, "Ana", "Carla", "net-"]) assert.ok(!o.text.includes(bad));
    for (const who of ["admin", "seller"]) assert.equal((await call("GET", "/api/admin/self-codes", null, who)).status, 403);
    // El panel del dueño (auditoría) tampoco muestra tokens.
    const audit = (await call("GET", "/api/admin/audit?limit=500", null, "owner")).text;
    assert.ok(audit.includes("codes.self_view"));
    for (const bad of [tAna, tBeto, tCarla]) assert.ok(!audit.includes(bad));
  });

  test("cuentas propias: solo con correo que el lector lee, sin cruces con la tienda ni con otro revendedor", async () => {
    later();
    const R = { id: "u_" + rosaId, role: "reseller", customerId: rosaId }, J = { id: "u_" + juanId, role: "reseller", customerId: juanId };
    const p = s.own.saveProduct(R, { name: "Max propio", durationDays: 30, price: 2000, kind: "profiles", slots: 3 });
    const acc = s.own.saveAccount(R, { productId: p.id, user: "max-rosa@x.lat", password: "Propia#1" });
    const plain = s.own.saveAccount(R, { productId: p.id, user: "usuario123", password: "Propia#2" });
    const robo = s.own.saveAccount(R, { productId: p.id, user: "net-juan@x.lat", password: "Propia#3" }); // correo de una cuenta de la TIENDA (de Juan)
    const dora = s.own.assign(R, { accountId: acc.id, name: "Dora Díaz", phone: "75551234" });
    const eva = s.own.assign(R, { accountId: robo.id, name: "Eva Espía", phone: "75559876" });
    const tDora = s.own.link(R, dora.id).token, tEva = s.own.link(R, eva.id).token;
    // Sin interruptor: nada. Con interruptor pero sin códigos leídos de ese correo: "pedile el código".
    assert.equal(await mode(tDora), "off");
    assert.equal((await call("POST", `/api/me/self-codes/own/${plain.id}`, { on: true }, "rosa")).status, 400, "sin correo no aplica");
    assert.deepEqual((await call("POST", `/api/me/self-codes/own/${acc.id}`, { on: true }, "rosa")).json, { on: true, readable: false });
    assert.equal(await mode(tDora), "ask");
    assert.equal((await codes(tDora)).status, 404);
    // Llega un código a ese correo (lo reenvió a la tienda): ahora sí.
    clock.t += MIN; mail("max-rosa@x.lat", "424242");
    assert.equal(await mode(tDora), "self");
    assert.deepEqual((await codes(tDora)).json.codes.map((c) => [c.code, c.from]), [["424242", "Max propio"]]);
    assert.equal((await call("GET", "/api/me/self-codes", null, "rosa")).json.own.find((x) => x.accountId === acc.id).readable, true);
    // La cuenta con el correo de una cuenta de la tienda NUNCA se lee (no ve los códigos de Juan).
    await call("POST", `/api/me/self-codes/own/${robo.id}`, { on: true }, "rosa");
    clock.t += MIN; mail("net-juan@x.lat", "313131");
    assert.equal(await mode(tEva), "ask");
    assert.equal((await codes(tEva)).status, 404);
    // Si otro revendedor carga el mismo correo, ya no se le muestra a ninguno de los dos.
    const pj = s.own.saveProduct(J, { name: "Max de Juan", durationDays: 30, price: 2000, kind: "full" });
    s.own.saveAccount(J, { productId: pj.id, user: "MAX-rosa@x.lat", password: "Otra#1" });
    assert.equal(await mode(tDora), "ask");
    assert.equal((await codes(tDora)).status, 404);
    // Juan no toca las cuentas propias de Rosa.
    assert.equal((await call("POST", `/api/me/self-codes/own/${acc.id}`, { on: false }, "juan")).status, 404);
    // Liberar el cupo mata el link.
    s.own.release(R, eva.id);
    assert.equal((await codes(tEva)).status, 404);
  });

  test("en el navegador a 360 px: el botón muestra el código, sin desborde, claro y oscuro", { skip: !chromium && "Playwright no está instalado" }, async () => {
    later();
    clock.t += MIN; mail("net-rosa@x.lat", "558 001");
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, colorScheme });
        await ctx.route(/wa\.me|whatsapp\.com|netflix\.com/, (route) => route.abort()); // nada sale afuera
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${base}/c/${tAna}`);
        const btn = page.getByRole("button", { name: "📩 Ver mi código de acceso" });
        await btn.waitFor();
        const h = await btn.evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(h >= 44, `botón de ${h}px`);
        await btn.click();
        await page.locator(".cc-num").first().waitFor();
        assert.equal(await page.locator(".cc-num").first().innerText(), "558 001");
        const box = await page.locator(".cc").innerText();
        assert.match(box, /Netflix · recién/);
        assert.ok(!/net-rosa|Clave|@/.test(box), "nada de la cuenta");
        assert.ok(await page.getByRole("button", { name: /Buscar de nuevo/ }).isVisible());
        const fs = await page.locator(".cc small").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(fs >= 12, `texto de ${fs}px`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde a 360 px");
        assert.deepEqual(errors, []);
        await ctx.close();
      }
      // Revendedor: el interruptor en Repartir perfiles (se apaga y se vuelve a prender).
      const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true });
      const [name, value] = cookies.rosa.split("=");
      await ctx.addCookies([{ name, value, url: base }]);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/hub#clientes");
      const sw = page.getByRole("switch", { name: /Mis clientes ven su código solos/ });
      await sw.waitFor();
      assert.equal(await sw.isChecked(), true);
      await page.locator(".cs-sw").first().click();
      await page.waitForFunction(() => document.querySelector('[data-csrental]') && !document.querySelector('[data-csrental]').checked && !document.querySelector('[data-csrental]').disabled);
      assert.equal((await codes(tAna)).status, 404, "apagado desde el panel del revendedor");
      await page.locator(".cs-sw").first().click();
      await page.waitForFunction(() => document.querySelector('[data-csrental]')?.checked);
      assert.equal((await codes(tAna)).status, 200);
      assert.match(await page.locator(".cs-head").innerText(), /vieron \d+ códigos? solos este mes/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde en Repartir perfiles");
      assert.deepEqual(errors, []);
      await ctx.close();
      // Cliente con cuenta en la tienda: "📩 Ver códigos" en Mis cuentas muestra ahí mismo los de ESE servicio.
      s.catalog.upsertProduct(owner, { id: "dis-perfil", name: "Disney+ perfil", kind: "profile", durationDays: 30, price: 2500, published: true });
      s.inventory.addAccount(owner, { productId: "dis-perfil", supplierId: "andes", email: "dis-lucho@x.lat", password: "Clave-Dis#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 900, profiles: [{ label: "Perfil 1" }] });
      const lucho = s.catalog.createCustomer(owner, { name: "Lucho Vargas", phone: "+59177770000" });
      s.orders.create(owner, { customerId: lucho.id, items: [{ productId: "dis-perfil", qty: 1 }], paymentMethod: "cash" });
      cookies.lucho = await loginCustomer(lucho.id, "+59177770000");
      clock.t += MIN; mail("dis-lucho@x.lat", "370 412"); mail("net-juan@x.lat", "999000");
      for (const colorScheme of ["light", "dark"]) {
        const c1 = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, colorScheme });
        const [n1, v1] = cookies.lucho.split("=");
        await c1.addCookies([{ name: n1, value: v1, url: base }]);
        const p1 = await c1.newPage();
        const errs = [];
        p1.on("pageerror", (e) => errs.push(e.message));
        await p1.goto(base + "/tienda/#cuentas");
        const ver = p1.getByRole("button", { name: "📩 Ver códigos" });
        await ver.waitFor();
        await ver.click();
        await p1.locator(".cs-code b").first().waitFor();
        assert.deepEqual(await p1.locator(".cs-code b").allInnerTexts(), ["370 412"], "solo el de su servicio");
        assert.ok(await p1.getByRole("button", { name: "📩 Ocultar códigos" }).isVisible());
        assert.ok(await p1.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde en Mis cuentas");
        assert.deepEqual(errs, []);
        await c1.close();
      }
      // "Pedile el código a tu vendedor" cuando no aplica (perfil vencido).
      const venc = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Vale Vencida", phone: "76660000", expiresAt: clock.t - DAY }, "rosa")).json.sub;
      const tv = (await call("POST", `/api/me/subs/${aidRosa}/${venc.id}/link`, {}, "rosa")).json.token;
      const c2 = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true });
      const p2 = await c2.newPage();
      await p2.goto(`${base}/c/${tv}`);
      await p2.getByText("Pedile el código a Rosa Mamani.").waitFor();
      assert.equal(await p2.getByRole("button", { name: /Ver mi código/ }).count(), 0);
      await c2.close();
    } finally { await browser.close(); }
  });

  test("límite por IP: tokens inventados → 429, y muchas consultas de un mismo link → 429", async () => {
    later();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await codes(`${"Y".repeat(30)}${String(i).padStart(4, "0")}aa`)).status;
    assert.equal(last, 429);
    later(16);
    const st = [];
    for (let i = 0; i < 22; i++) st.push((await codes(tAna)).status);
    assert.equal(st[0], 200);
    assert.equal(st.at(-1), 429, "tope de consultas por link");
  });
});
