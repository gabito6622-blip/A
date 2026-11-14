// R2 (14/11/2026) en pantalla a 360 px y por HTTP: el revendedor se entera siempre de lo que le pasa a sus cuentas
// (cambio de clave: cartel en Inicio y Mis cuentas con «Copiar clave nueva» y el mensaje con la clave nueva, más el aviso
// al celular), «📩 Pedir renovación» propio que el dueño resuelve en Mi secretaria, el QR en el mismo lugar del cartel
// sin tarjetas repetidas, «¿lo cancelo y pago con saldo?», la falla resuelta con los datos nuevos y la sesión que se
// renueva con el uso (y el aviso sin culpar a «la tienda» al independiente). Datos ficticios, carpeta temporal, sin red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error("no pasó a tiempo"); await new Promise((r) => setTimeout(r, 50)); } };

test("R2: avisos de cambios, «Pedir renovación», QR en el mismo lugar, no pagar dos veces y la falla con datos nuevos (360 px)", { timeout: 240_000 }, async () => {
  const { generateVapidKeys } = await import("../dist/server/push.js");
  const dir = mkdtempSync(join(tmpdir(), "gs-r2-"));
  const sent = [];
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, vapid: { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" }, fetchImpl: async (url, init) => { sent.push({ url, init }); return new Response("", { status: 201 }); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  for (const [id, name, price] of [["dis", "Disney+ Premium (alquiler revendedores)", 9000], ["prime", "Prime Video (alquiler revendedores)", 2500], ["hbo", "HBO Max (alquiler revendedores)", 2000]])
    s.catalog.upsertProduct(owner, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "net", name: "Netflix 1 perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { dis: 6900, prime: 2000, hbo: 1500, net: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  let n = 0;
  for (const pid of ["dis", "prime", "hbo"]) for (let i = 0; i < 3; i++) s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}.${++n}@ficticio.lat`, password: "Clave-Ficticia#" + n, supplierExpiresAt: Date.now() + 200 * DAY, cost: 4000, profiles: [{ label: "Cuenta completa" }] });
  for (let i = 1; i <= 2; i++) s.inventory.addAccount(owner, { productId: "net", supplierId: "andes", email: `net.${i}@ficticio.lat`, password: "Clave-Net#" + i, supplierExpiresAt: Date.now() + 200 * DAY, cost: 1000, profiles: [1, 2].map((k) => ({ label: `Perfil ${k}`, pin: `20${i}${k}` })) });
  const marta = s.catalog.createCustomer(owner, { name: "Marta Choque", phone: "+59170100001", kind: "reseller", priceGroupId: "rev" });
  const beto = s.catalog.createCustomer(owner, { name: "Beto Mamani", phone: "+59170100002", kind: "reseller", priceGroupId: "rev" });
  const diego = s.catalog.createCustomer(owner, { name: "Diego Rojas", phone: "+59170100003", kind: "reseller", priceGroupId: "rev" });
  s.catalog.setResellerTrust(owner, diego.id, "independent");
  const M = { id: "u_" + marta.id, role: "reseller", customerId: marta.id };
  s.wallet.adjust(owner, marta.id, 30000, "prueba");
  const buy = (pid) => s.orders.create(M, { customerId: marta.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: "m-" + pid }).assignmentIds[0];
  const dis = buy("dis"), prime = buy("prime"), hbo = buy("hbo");
  s.wallet.adjust(owner, marta.id, -s.wallet.balance(marta.id), "deja el saldo en 0"); // va a pagar con QR
  const accOf = (aid) => s.engine.s.accounts[s.engine.s.slots[s.engine.s.assignments[aid].slotId].accountId];
  for (const [nm, ph, lb] of [["Nina Vela", "+59172200001", "Perfil 1"], ["Óscar Vela", "+59172200002", "Perfil 2"]]) s.subs.save(M, prime, { name: nm, phone: ph, label: lb, expiresAt: Date.now() + 20 * DAY, price: 1500, pay: "pagado" });
  // Disney vence en 2 días (renovable); HBO vence en 2 días pero el proveedor vence antes de lo que pediría renovar.
  s.orders.setExpiry(owner, dis, Date.now() + 2 * DAY);
  s.orders.setExpiry(owner, hbo, Date.now() + 2 * DAY);
  s.inventory.updateAccount(owner, accOf(hbo).id, { supplierExpiresAt: Date.now() + 10 * DAY });
  // Rosa: clienta registrada de Marta con un Netflix (para la falla resuelta con otra cuenta).
  const rosa = s.catalog.createCustomer(M, { name: "Rosa Quispe", phone: "+59171200001" });
  s.wallet.adjust(owner, marta.id, 2500, "para el Netflix de Rosa");
  const net = s.orders.create(M, { customerId: rosa.id, items: [{ productId: "net", qty: 1 }], paymentMethod: "balance", idempotencyKey: "rosa" }).assignmentIds[0];
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
    await call("POST", "/api/admin/settings/qr", { contentBase64: PNG }, ock);
    const enter = async (c) => { const { pin } = (await call("POST", `/api/admin/customers/${c.id}/login-pin`, {}, ock)).json; return (await call("POST", "/api/auth/customer/pin", { phone: c.phone, pin })).ck; };
    const mck = await enter(marta), bck = await enter(beto);
    assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/marta", keys: { p256dh: "a", auth: "b" } } }, mck)).status, 200);
    assert.equal(await app.checkAccountChangePush(), 0, "sin cambios no avisa");

    // ---- 1 · La tienda cambia la clave del Prime de Marta (Cuentas → «Cambié la clave») ----
    assert.equal((await call("POST", `/api/admin/accounts/${accOf(prime).id}/password`, { password: "Clave-Nueva#77" }, ock)).status, 200);
    assert.equal(await app.checkAccountChangePush(), 1, "aviso al celular");
    assert.equal(await app.checkAccountChangePush(), 0, "una sola vez por cambio");
    const latest = (await call("GET", "/api/me/push/latest", null, mck)).json;
    assert.match(latest.title, /Cambió la clave de tu Prime Video: avisá a tus 2 clientes/);
    const chg = (await call("GET", "/api/me/account-changes", null, mck)).json;
    assert.ok(!JSON.stringify(chg).includes("Clave-Nueva"), "el aviso por la API no lleva la clave");
    assert.deepEqual((await call("GET", "/api/me/account-changes", null, bck)).json, [], "Beto no ve lo de Marta");
    assert.equal((await call("POST", `/api/me/account-changes/${prime}/seen`, {}, bck)).status, 404);
    // Separación en los pedidos de renovación.
    assert.equal((await call("POST", "/api/me/renew-requests", { assignmentId: hbo }, bck)).status, 403, "Beto no pide por Marta");
    assert.ok([401, 403].includes((await call("GET", "/api/admin/renew-requests", null, mck)).status));

    if (!chromium) return;
    const b = await chromium.launch();
    try {
      const ctxFor = async (ck, extra) => {
        const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (x) => x.abort());
        if (ck) { const [k, v] = ck.split("="); await ctx.addCookies([{ name: k, value: v, url: base }]); }
        await ctx.addInitScript(([ids, ex]) => { try { for (const id of ids) localStorage.setItem("gs-guide-" + id, "1"); if (ex) localStorage.setItem("gs-hub-who", ex); } catch { /* sin almacenamiento */ } }, [[marta.id, beto.id, diego.id], extra ?? null]);
        return ctx;
      };
      const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const small = (p, sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 44).map((x) => x.textContent.trim()), sel);

      const ctx = await ctxFor(mck);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
      const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
      await p.goto(base + "/hub#inicio");
      // Cartel de cambio de clave en INICIO, con «Copiar clave nueva» y el mensaje con la clave nueva.
      const box = p.locator(".accchg", { hasText: "Prime Video" });
      await box.waitFor();
      assert.match(await box.innerText(), /Cambió la clave de tu Prime Video: avisá a tus 2 clientes/);
      assert.equal(await box.locator("[data-copy]").getAttribute("data-copy"), "Clave-Nueva#77");
      assert.match(await box.locator("[data-copy]").innerText(), /Copiar clave nueva/);
      const wa = decodeURIComponent(await box.locator("a", { hasText: "Avisar" }).first().getAttribute("href"));
      assert.match(wa, /Contraseña: Clave-Nueva#77/);
      assert.match(wa, /Correo: prime\.\d+@ficticio\.lat/);
      assert.match(wa, /Tu perfil: Perfil 1/);
      assert.equal(await over(p), 0);
      assert.deepEqual(await small(p, ".accchg .sbtn, .rmalert .sbtn"), []);
      // También en «Mis cuentas».
      await p.goto(base + "/hub#cuentas"); await p.reload();
      await p.locator(".accchg", { hasText: "Prime Video" }).waitFor();

      // ---- 5 · El cartel dice cuál queda afuera y por qué; «📩 Pedir renovación» es un pedido propio ----
      await p.goto(base + "/hub#inicio"); await p.reload();
      const alert = p.locator(".rmalert");
      await alert.waitFor();
      const at = await alert.innerText();
      assert.match(at, /HBO Max[^\n]*queda afuera: para renovarla, la tienda primero renueva con su proveedor/);
      assert.match(at, /Renovar · Bs 69/);
      assert.match(at, /Queda afuera: HBO Max/);
      await alert.locator("[data-rrqask]").click();
      await until(() => Object.values(s.engine.s.renewRequests ?? {}).length === 1);
      assert.match(dialogs.at(-1), /Pedir la renovación de HBO Max \(Bs 15(\.00)?\)/);
      assert.equal(Object.values(s.engine.s.tickets ?? {}).length, 0, "no es una falla «No me deja entrar»");
      await p.waitForFunction(() => /pediste la renovación/.test(document.querySelector(".rmalert")?.innerText ?? ""));

      // ---- 4 · Renovar con QR desde el cartel de Inicio: el QR y «Enviar comprobante» aparecen ahí mismo ----
      await alert.locator("[data-rmalert]").click(); // saldo 0 → QR
      await p.locator("#rmqr #rmFile").waitFor();
      assert.equal(await p.evaluate(() => location.hash), "#inicio", "sigue en Inicio");
      assert.match(await p.locator("#rmqr").innerText(), /Disney\+ Premium[\s\S]*dis\.\d+@ficticio\.lat/);
      assert.equal(await over(p), 0);
      await p.screenshot({ path: join(dir, "r2-inicio-qr.png"), fullPage: true });
      // Tocar de nuevo «Renovar» no crea otra renovación.
      const qrOrders = () => Object.values(s.engine.s.orders).filter((o) => o.kind === "renewal" && o.renewal.assignmentId === dis && o.status === "awaiting_payment").length;
      assert.equal(qrOrders(), 1);
      assert.equal((await call("POST", "/api/me/renew", { assignmentId: dis, paymentMethod: "qr" }, mck)).status, 409);
      assert.equal(qrOrders(), 1);
      // En Mis cuentas: la tarjeta suelta del pedido no se repite debajo del cuadro del QR.
      await p.goto(base + "/hub#cuentas"); await p.reload();
      await p.locator("#rmqr").waitFor();
      assert.equal(await p.locator('form[data-evidence]').count(), 0, "sin tarjetas sueltas con otro QR");
      // ¿Lo cancelo y pago con saldo? → sí: una sola renovación cobrada.
      s.wallet.adjust(owner, marta.id, 10000, "recarga de prueba");
      const exp0 = s.engine.s.assignments[dis].customerExpiresAt, bal0 = s.wallet.balance(marta.id);
      await p.reload();
      await p.locator(`[data-renew="${dis}"][data-method="balance"]`).click();
      await until(() => s.engine.s.assignments[dis].customerExpiresAt > exp0);
      assert.ok(dialogs.some((d) => /Ya tenés un pedido por QR esperando pago para tu Disney\+ Premium[\s\S]*¿Lo cancelo y pagás con saldo\?/.test(d)));
      assert.equal(s.wallet.balance(marta.id), bal0 - 6900);
      assert.equal(qrOrders(), 0);
      assert.equal(s.engine.s.assignments[dis].customerExpiresAt, exp0 + 30 * DAY);

      // ---- 6 · Falla de Rosa resuelta cambiándole la cuenta: «Avisar a mi cliente» lleva los datos nuevos ----
      const tk = (await call("POST", "/api/me/tickets", { assignmentId: net, kind: "no_entra" }, mck)).json;
      assert.ok(tk.id, JSON.stringify(tk));
      s.orders.replace(owner, net, { reason: "no entra", otherAccount: true });
      s.tickets.setStatus(owner, tk.id, { status: "solucionado", reply: "Te cambiamos a otra cuenta" });
      await p.goto(base + "/hub#fallas"); await p.reload();
      const av = p.locator("a", { hasText: "Avisar a mi cliente" });
      await av.waitFor();
      const msg = decodeURIComponent(await av.getAttribute("href"));
      assert.match(msg, new RegExp(`Correo: ${accOf(net).email.replace(/\./g, "\\.")}`));
      assert.match(msg, /Contraseña: Clave-Net#\d/);
      assert.match(msg, /Perfil: Perfil \d/);
      assert.match(msg, /PIN: 20\d\d/);
      assert.deepEqual(errs, []);
      await ctx.close();

      // ---- Mi secretaria: el pedido con el monto y «Renovar proveedor y anotar» ----
      s.wallet.adjust(owner, marta.id, 2000, "recarga de prueba");
      const octx = await b.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
      const [k, v] = ock.split("="); await octx.addCookies([{ name: k, value: v, url: base }]);
      const op = await octx.newPage(); const oerr = []; op.on("pageerror", (x) => oerr.push(x.message));
      op.on("dialog", (d) => d.accept());
      await op.goto(base + "/panel#secretaria");
      const sec = op.locator("#sec-pedidos");
      await sec.waitFor();
      assert.match(await sec.innerText(), /Marta Choque[\s\S]*HBO Max[\s\S]*Bs 15/);
      const hboExp = s.engine.s.assignments[hbo].customerExpiresAt, supExp = accOf(hbo).supplierExpiresAt, mbal = s.wallet.balance(marta.id);
      await sec.locator("[data-rrqok]").click();
      await until(() => s.engine.s.assignments[hbo].customerExpiresAt > hboExp);
      assert.ok(accOf(hbo).supplierExpiresAt > supExp, "renovó con el proveedor");
      assert.equal(s.wallet.balance(marta.id), mbal - 1500, "cobró de su saldo");
      assert.equal(await op.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      assert.deepEqual(oerr, []);
      await octx.close();

      // ---- 7 · Sesión cerrada del independiente: no culpa a «la tienda» ----
      const ictx = await ctxFor(null, JSON.stringify({ name: "Diego", phone: diego.phone, indep: true }));
      const ip = await ictx.newPage();
      await ip.goto(base + "/hub#inicio");
      const modal = ip.locator("#modal");
      await modal.waitFor();
      const mt = await modal.innerText();
      assert.match(mt, /Diego, tu sesión se cerró/);
      assert.match(mt, /soporte de GaboHub/);
      assert.ok(!/la tienda/.test(mt), "no culpa a «la tienda»");
      assert.equal(await ip.locator('#modal input[name="phone"]').inputValue(), diego.phone);
      await ictx.close();
    } finally { await b.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("R2: la sesión de GaboHub se renueva con el uso (no se cierra a los 30 días si entra seguido)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-r2-"));
  const clock = { t: Date.UTC(2026, 10, 2, 15), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock, fetchImpl: async () => { throw new Error("sin red"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const ana = s.catalog.createCustomer(owner, { name: "Ana Diaria", phone: "+59170100009", kind: "reseller" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).cookie.split(";")[0];
    const { pin } = (await call("POST", `/api/admin/customers/${ana.id}/login-pin`, {}, ock)).json;
    const ck = (await call("POST", "/api/auth/customer/pin", { phone: ana.phone, pin })).cookie.split(";")[0];
    // Entra todos los días durante 45 días: nunca se le cierra, y la cookie se renueva (Max-Age de 30 días).
    let renewed = 0;
    for (let d = 1; d <= 45; d++) {
      clock.t += DAY;
      const r = await call("GET", "/api/me", null, ck);
      assert.equal(r.json.loggedIn, true, `día ${d}`);
      if (r.cookie) { assert.match(r.cookie, /Max-Age=2592000/); assert.match(r.cookie, /HttpOnly/); renewed++; }
    }
    assert.ok(renewed >= 40, `la cookie se renovó ${renewed} veces`);
    // Si no entra en 31 días, se cierra (como antes).
    clock.t += 31 * DAY;
    assert.equal((await call("GET", "/api/me", null, ck)).json.loggedIn, false);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
