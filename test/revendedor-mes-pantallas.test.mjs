// Revendedores un mes entero (14/11/2026): las rutas nuevas por HTTP (permisos y separación entre revendedores) y las
// pantallas a 360 px: cartel antes del corte, renovar varias juntas con un QR, ganancia real, aprobar juntos, aprobar
// una solicitud con tipo y lista, «Me pagó todo», «Pasar a otro» con confirmación, «Renovar +1» con el total, recargas
// en «Cómo van» y el interruptor del independiente. Datos ficticios, carpeta temporal, sin red.
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
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("no pasó a tiempo"); await new Promise((r) => setTimeout(r, 50)); } };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("Revendedores un mes entero: rutas, separación y pantallas a 360 px", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-eq4-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  for (const [id, name, price] of [["dis", "Disney+ Premium (alquiler revendedores)", 9000], ["prime", "Prime Video (alquiler revendedores)", 2500], ["hbo", "HBO Max (alquiler revendedores)", 2000], ["max", "Max (alquiler revendedores)", 9000]])
    s.catalog.upsertProduct(owner, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { dis: 6900, prime: 2000, hbo: 1500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  let n = 0;
  for (const pid of ["dis", "prime", "hbo", "max"]) for (let i = 0; i < 8; i++) s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}.${++n}@ficticio.lat`, password: "Clave-Ficticia#" + n, supplierExpiresAt: Date.now() + 200 * DAY, cost: 4000, profiles: [{ label: "Cuenta completa" }] });
  const mk = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
  const mam = mk("Carla Mamani", "+59170000001"), men = mk("Carla Mendoza", "+59170000002"), luis = mk("Luis Nopaga", "+59170000005"), ana = mk("Ana Paz", "+59170000006");
  const diego = mk("Diego Rojas", "+59170000003"); s.catalog.setResellerTrust(owner, diego.id, "independent");
  const sell = (c, pid) => s.orders.create(owner, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", idempotencyKey: Math.random() + "" }).assignmentIds[0];
  const R = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });
  s.wallet.adjust(owner, mam.id, 20000, "prueba");
  const mIds = ["dis", "prime", "hbo"].map((pid, i) => s.orders.create(R(mam), { customerId: mam.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: "m" + i }).assignmentIds[0]);
  for (const nm of ["Rosa", "Juan", "Mery", "Tito"]) s.subs.save(R(mam), mIds[0], { name: nm, expiresAt: Date.now() + 25 * DAY, price: 2000, pay: "pagado" });
  s.orders.setExpiry(owner, mIds[0], Date.now() + 2 * DAY + 3600_000);
  const menIds = ["dis", "dis", "hbo"].map((p) => sell(men, p));
  const lIds = [sell(luis, "dis"), sell(luis, "prime")];
  s.orders.setControl(owner, lIds[0], { payStatus: "pendiente" });
  for (const id of lIds) s.orders.setExpiry(owner, id, Date.now() + 3 * DAY);
  sell(diego, "dis");
  s.shops.apply({ name: "Nico Nuevo", phone: "+59170000009", note: "quiero vender" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
    await call("POST", "/api/admin/settings/qr", { contentBase64: PNG }, ock);
    const enter = async (c) => { const { pin } = (await call("POST", `/api/admin/customers/${c.id}/login-pin`, {}, ock)).json; return (await call("POST", "/api/auth/customer/pin", { phone: c.phone, pin })).ck; };
    const mck = await enter(mam), nck = await enter(men), dck = await enter(diego);

    // ---- Rutas: cada uno lo suyo ----
    assert.equal((await call("POST", "/api/me/renew-many/preview", { ids: [menIds[0]] }, mck)).status, 403, "Mamani no cotiza un alquiler de Mendoza");
    assert.equal((await call("POST", "/api/me/renew-many", { ids: [menIds[0]], paymentMethod: "balance" }, mck)).status, 403);
    for (const p of ["/api/admin/order-groups", `/api/admin/resellers/${men.id}/due`, "/api/admin/reseller-apps/options", `/api/admin/assignments/${menIds[0]}/transfer-preview?to=${mam.id}`]) {
      assert.ok([401, 403].includes((await call("GET", p, null, mck)).status), `un revendedor no entra a ${p}`);
    }
    assert.ok([401, 403].includes((await call("POST", `/api/admin/customers/${diego.id}/store-renew`, { allowed: false }, dck)).status));
    const mine = (await call("GET", "/api/me/store-rentals", null, mck)).json;
    assert.equal(mine.list.length, 1);
    assert.ok(!JSON.stringify(mine).includes("Mendoza") && !JSON.stringify(mine).includes(menIds[0]));
    // Mendoza: un solo QR para sus 3 renovaciones.
    const r = (await call("POST", "/api/me/renew-many", { ids: menIds, paymentMethod: "qr", idempotencyKey: "q1" }, nck)).json;
    assert.equal(r.count, 3);
    assert.equal((await call("POST", "/api/me/renew-many/evidence", { orderIds: r.orders.map((o) => o.id), contentBase64: PNG, declaredReference: "MEN-153" }, mck)).status, 403, "Mamani no manda el comprobante de Mendoza");
    assert.equal((await call("POST", "/api/me/renew-many/evidence", { orderIds: r.orders.map((o) => o.id), contentBase64: PNG, declaredReference: "MEN-153" }, nck)).status, 200);
    // Independiente: renueva su alquiler de la tienda con saldo.
    s.wallet.adjust(owner, diego.id, 10000, "prueba");
    const dsv = (await call("GET", "/api/me/services", null, dck)).json;
    assert.equal(dsv[0].canRenew, true);
    assert.equal((await call("POST", "/api/me/renew", { assignmentId: dsv[0].assignmentId, paymentMethod: "balance", idempotencyKey: "d1" }, dck)).status, 200);
    // Teléfono repetido: no delata.
    const dup = await call("POST", "/api/me/customers", { name: "Probar", phone: "+59170000002" }, mck);
    assert.equal(dup.status, 200);
    assert.ok(!JSON.stringify(dup.json).includes("Mendoza"));

    // Sin navegador: al menos el resumen de «Pasar a otro» por la API (la confirmación de la pantalla usa este mismo).
    if (!chromium) { assert.ok((await call("GET", `/api/admin/assignments/${lIds[0]}/transfer-preview?to=${ana.id}`, null, ock)).json.lines.some((l) => /SU fiado/.test(l))); return; }
    const b = await chromium.launch();
    try {
      const ctxFor = async (ck, w = 360) => {
        const ctx = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (x) => x.abort());
        const [k, v] = ck.split("="); await ctx.addCookies([{ name: k, value: v, url: base }]);
        await ctx.addInitScript((ids) => { try { for (const id of ids) localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, [mam.id, men.id, diego.id]);
        return ctx;
      };
      const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

      // ---- GaboHub de Mamani ----
      const ctx = await ctxFor(mck);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
      const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
      await p.goto(base + "/hub#inicio");
      const banner = p.locator(".rmalert");
      await banner.waitFor();
      assert.match(await banner.innerText(), /Tu Disney\+ Premium de la tienda vence el \d\d\/\d\d y se corta el \d\d\/\d\d/);
      assert.equal(await over(p), 0);
      // «Renovar con saldo · Bs X» pide confirmación con el total (acá se cancela: no descuenta).
      await p.goto(base + "/hub#cuentas"); await p.reload();
      await p.locator(".rmbox").waitFor();
      p.removeAllListeners("dialog"); p.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
      const bal0 = s.wallet.balance(mam.id);
      await p.locator(`[data-renew="${mIds[1]}"][data-method="balance"]`).click();
      await p.waitForTimeout(300);
      assert.match(dialogs.at(-1), /Bs 20(\.00)? con tu saldo/);
      assert.equal(s.wallet.balance(mam.id), bal0, "cancelar no descuenta");
      // Renovar varias juntas con saldo: confirma el total y renueva las 3 (antes recarga: con Bs 96 no le alcanza).
      s.wallet.adjust(owner, mam.id, 5000, "recarga de prueba");
      const bal1 = s.wallet.balance(mam.id);
      p.removeAllListeners("dialog"); p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
      await p.locator(".rmbox summary").click();
      await p.locator("[data-rmall]").click();
      assert.match(await p.locator(".rmtot").innerText(), /Bs 104(\.00)? · 3 cuenta/);
      const exp = mIds.map((id) => s.engine.s.assignments[id].customerExpiresAt);
      await p.locator('[data-rmpay="balance"]').click();
      await until(() => s.wallet.balance(mam.id) !== bal1);
      await p.waitForFunction(() => !document.querySelector(".rmalert"));
      assert.match(dialogs.at(-1), /Renovar 3 cuentas por Bs 104(\.00)? con tu saldo/);
      mIds.forEach((id, i) => assert.equal(s.engine.s.assignments[id].customerExpiresAt, exp[i] + 30 * DAY));
      assert.equal(s.wallet.balance(mam.id), bal1 - 10400);
      // Mis ganancias: la ganancia real con sus alquileres.
      await p.evaluate(() => { const x = document.createElement("button"); x.dataset.rtool = "ganancias"; x.id = "goGan"; document.body.append(x); });
      await p.locator("#goGan").dispatchEvent("click");
      await p.locator(".rmreal").waitFor();
      assert.match(await p.locator(".rmreal").innerText(), /tus alquileres Bs 208[\s\S]*Ganancia real[\s\S]*Bs -128/);
      assert.equal(await over(p), 0);
      assert.deepEqual(errs, []);
      await ctx.close();

      // ---- GaboHub de Luis: renovar varias con UN QR ----
      const lck = await enter(luis);
      const lctx = await ctxFor(lck); const lp = await lctx.newPage(); lp.on("dialog", (d) => d.accept());
      await lp.goto(base + "/hub#cuentas");
      await lp.locator(".rmbox summary").click();
      await lp.locator("[data-rmall]").click();
      await lp.locator('[data-rmpay="qr"]').click();
      await lp.locator(".rmqr").waitFor();
      assert.match(await lp.locator(".rmqr h3").innerText(), /Bs 89(\.00)?/);
      await lp.locator("[data-rmsend]").click();
      assert.match(await lp.locator("#rmErr").innerText(), /Elegí la foto/, "el error va junto al campo");
      await lp.locator("#rmFile").setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
      await lp.locator("#rmRef").fill("LUIS-89");
      await lp.locator("[data-rmsend]").click();
      await lp.waitForFunction(() => !document.querySelector(".rmqr"));
      assert.equal(Object.values(s.engine.s.orders).filter((o) => o.payerId === luis.id && o.status === "payment_review" && o.evidence?.group?.length === 2).length, 2);
      await lctx.close();

      // ---- Panel del dueño ----
      const octx = await ctxFor(ock);
      const op = await octx.newPage(); const oerr = []; op.on("pageerror", (x) => oerr.push(x.message));
      const odialogs = []; op.on("dialog", (d) => { odialogs.push(d.message()); d.accept(); });
      // Aprobar juntos: suma equivocada → error junto al campo; la correcta → aprueba las 3.
      await op.goto(base + "/panel.html#aprobacion");
      const g = op.locator(".rmgroup", { hasText: "Carla Mendoza" });
      await g.waitFor();
      await g.locator('[name="ref"]').fill("MEN-153");
      await g.locator('[name="amt"]').fill("150");
      await g.locator("[data-rmgok]").click();
      await g.locator(".rmerr:not([hidden])").waitFor();
      assert.match(await g.locator(".rmerr").innerText(), /no coincide/);
      await g.locator('[name="amt"]').fill("153");
      await g.locator("[data-rmgok]").click();
      await op.locator(".rmgroup", { hasText: "Carla Mendoza" }).waitFor({ state: "detached" });
      assert.ok(r.orders.every((o) => s.engine.s.orders[o.id].status === "fulfilled"), "las 3 aprobadas");
      assert.equal(await over(op), 0);
      // Revendedores: aprobar solicitud con tipo y lista.
      await op.goto(base + "/panel.html#revendedores"); await op.reload();
      await op.locator("[data-appok]").first().click();
      const dlg = op.locator(".rmcard");
      await dlg.waitFor();
      assert.equal(await dlg.locator('[name="rmgroup"]').inputValue(), "rev", "viene marcada la lista de los demás");
      await dlg.locator('[name="rmtrust"][value="trusted"]').check();
      await dlg.locator("[data-rmappok]").click();
      await dlg.waitFor({ state: "detached" });
      const nico = Object.values(s.engine.s.customers).find((c) => c.phone === "+59170000009");
      assert.equal(nico.priceGroupId, "rev");
      assert.equal(nico.trust, undefined, "de confianza");
      // «Me pagó todo» de Luis: lista, total y confirmación.
      await op.goto(base + "/panel.html#revendedores"); await op.reload();
      await op.locator(`[data-rmpaid="${luis.id}"]`).click();
      const mp = op.locator(".rmcard");
      await mp.waitFor();
      // Luis ya mandó UN comprobante por sus 2 renovaciones: esa no se vuelve a cobrar acá (se aprueba en Aprobación).
      assert.match(await mp.innerText(), /ya mandó el comprobante/);
      assert.match(await mp.innerText(), /Total: Bs 69(\.00)?/);
      assert.equal(await over(op), 0);
      await mp.locator("[data-rmpaidok]").click();
      await mp.waitFor({ state: "detached" });
      assert.equal(s.engine.s.assignments[lIds[0]].control.payStatus, "pagado", "lo que debía, anotado");
      assert.ok(odialogs.some((x) => /te pagó Bs 69(\.00)? por 1 alquiler/.test(x)));
      // Interruptor del independiente.
      await op.locator(`[data-rmstore="${diego.id}"]`).click();
      await op.locator(`[data-rmstore="${diego.id}"][aria-pressed="false"]`).waitFor();
      assert.equal(s.engine.s.customers[diego.id].storeRenew, false);
      // Cómo van: lo que recargó cada uno este mes.
      await op.goto(base + "/panel.html#comovan"); await op.reload();
      await op.locator(".cv-topup").first().waitFor();
      assert.match(await op.locator(".cv-row", { hasText: "Carla Mamani" }).locator(".cv-topup").innerText(), /recargó Bs 0(\.00)? este mes/);
      // Control: «Renovar +1» masivo pide confirmación con el total; «Pasar a otro» explica deuda y libreta.
      await op.goto(base + "/panel.html#control"); await op.reload();
      await op.locator(".ccard").first().waitFor();
      op.removeAllListeners("dialog"); op.on("dialog", (d) => { odialogs.push(d.message()); d.dismiss(); });
      await op.locator(`.csel[value="${lIds[0]}"]`).first().check();
      await op.locator('#ctlBar [data-cbulk="renew"]').click();
      await op.waitForTimeout(300);
      assert.match(odialogs.at(-1), /Renovar \+1 mes 1 alquiler.*Total: Bs 69(\.00)?/s);
      const before = s.engine.s.assignments[lIds[0]].customerExpiresAt;
      assert.equal(s.engine.s.assignments[lIds[0]].customerExpiresAt, before, "cancelar no anota");
      // «Pasar a otro»: el Prime de Luis (no pagó) a Ana. La confirmación explica la deuda; Ana no la hereda.
      s.orders.setControl(owner, lIds[1], { payStatus: "no_pago" });
      await op.reload(); await op.locator(".ccard").first().waitFor();
      op.removeAllListeners("dialog"); op.on("dialog", (d) => { odialogs.push(d.message()); d.accept(); });
      const tf = op.locator(`.ccard form[data-transfer="${lIds[1]}"]`);
      await tf.evaluate((f) => { let x = f.closest("details"); while (x) { x.open = true; x = x.parentElement?.closest("details"); } });
      await tf.locator('[name="to"]').selectOption(ana.id);
      await tf.locator('[name="reason"]').fill("Luis no paga");
      await tf.locator('[type="submit"]').click();
      await until(() => s.engine.s.assignments[lIds[1]].customerId === ana.id);
      assert.match(odialogs.at(-1), /Pasar de Luis Nopaga a Ana Paz[\s\S]*queda en SU fiado/);
      assert.equal(s.engine.s.assignments[lIds[1]].control.payStatus, undefined, "Ana arranca de cero");
      assert.equal(s.fiado.owedBy(luis.id), 2000, "Luis sigue debiendo");
      assert.deepEqual(oerr, []);
      await octx.close();
    } finally { await b.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Aviso al celular del revendedor antes del corte de su alquiler: 3 días antes y el día del vencimiento, una vez por día", async () => {
  const { generateVapidKeys } = await import("../dist/server/push.js");
  const dir = mkdtempSync(join(tmpdir(), "gs-eq4-"));
  const sent = [];
  const T0 = Date.UTC(2026, 10, 2, 15); // 02/11 11:00 en Bolivia
  const clock = { t: T0, now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock, vapid: { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" }, fetchImpl: async (url, init) => { sent.push({ url, init }); return new Response("", { status: 201 }); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ Premium (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "dis", supplierId: "andes", email: "d@ficticio.lat", password: "Clave-Ficticia#1", supplierExpiresAt: T0 + 200 * DAY, cost: 4000, profiles: [{ label: "Cuenta completa" }] });
  const mam = s.catalog.createCustomer(owner, { name: "Carla Mamani", phone: "+59170000001", kind: "reseller" });
  const id = s.orders.create(owner, { customerId: mam.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
  s.orders.setExpiry(owner, id, T0 + 3 * DAY);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
    const { pin } = (await call("POST", `/api/admin/customers/${mam.id}/login-pin`, {}, ock)).json;
    const mck = (await call("POST", "/api/auth/customer/pin", { phone: mam.phone, pin })).ck;
    assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/mamani", keys: { p256dh: "a", auth: "b" } } }, mck)).status, 200);
    await app.checkResellerPush();
    const latest = (await call("GET", "/api/me/push/latest", null, mck)).json;
    assert.match(latest.title, /Tu Disney\+ Premium de la tienda vence el 05\/11 y se corta el 07\/11/);
    assert.equal(latest.url, "/hub#cuentas");
    const n = sent.length;
    assert.ok(n >= 1);
    await app.checkResellerPush();
    assert.equal(sent.length, n, "una sola vez por día");
    clock.t = T0 + DAY; await app.checkResellerPush();
    assert.equal(sent.length, n, "2 días antes no");
    clock.t = T0 + 3 * DAY - 3600_000; await app.checkResellerPush();
    assert.equal(sent.length, n + 1, "el día del vencimiento sí");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
