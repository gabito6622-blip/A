// 🔐 PIN por cuenta en el link de códigos (15/11/2026). El dueño: «que ella decida un PIN por cada cuenta… para evitar
// que sus clientes vean los códigos de otro». En el link «escribí tu correo» de un revendedor, cada correo puede pedir su
// PIN de 4 números (lo pone el revendedor en GaboHub o el dueño en la ficha). Sin el PIN no se ve el código aunque sepan
// el correo; solo se pueden proteger las cuentas de ese revendedor; los intentos están limitados. Además el título de la
// página ya no muestra la etiqueta interna del dueño («ana · Ana Revende» → «Ana Revende»). Datos ficticios.
// Con CP_SHOTS=<carpeta> guarda capturas (fuera del repositorio).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
// Links lindos (/cod/<nombre>-xxxx, 19/11/2026): se sigue el link hasta /codigos/<token>, como el navegador.
const tokenOf = async (u) => { if (u.includes("/codigos/")) return u.split("/codigos/")[1]; const r = await fetch(u, { redirect: "manual" }); return (r.headers.get("location") ?? "").split("/codigos/")[1]; };


let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("PIN por cuenta: cada correo del link puede pedir su PIN; solo las cuentas del revendedor; título sin etiqueta", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-pincuenta-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN", kind: "full_account", durationDays: 30, price: 6500, published: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  for (const em of ["ana1@ficticio.lat", "ana2@ficticio.lat", "beto1@ficticio.lat"]) s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: em, password: "Clave-Secreta#9", supplierExpiresAt: Date.now() + 200 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const ana = s.catalog.createCustomer(owner, { name: "ana · Ana Revende", phone: "+59170000011", kind: "reseller", priceGroupId: "revendedor" });
  const beto = s.catalog.createCustomer(owner, { name: "beto · Beto Revende", phone: "+59170000012", kind: "reseller", priceGroupId: "revendedor" });
  let k = 0;
  const rent = (c, slotEmail) => {
    const slot = Object.values(s.engine.s.slots).find((x) => s.engine.s.accounts[x.accountId].email === slotEmail);
    return s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++, preferredSlotIds: [slot.id] });
  };
  rent(ana, "ana1@ficticio.lat"); rent(ana, "ana2@ficticio.lat"); rent(beto, "beto1@ficticio.lat");
  // Códigos que llegaron recién (como si los leyera el Panel de códigos).
  for (const [to, code] of [["ana1@ficticio.lat", "111111"], ["ana2@ficticio.lat", "222222"], ["beto1@ficticio.lat", "333333"]]) s.engine.s.codes.push({ id: "c" + code, mailboxId: "m", to, subject: "Tu código de acceso único", code, kind: "login", receivedAt: Date.now() });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
  const call = async (ck, m, p, body) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), r }; };
  const staff = (await call(null, "POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];
  // Link de Ana (modo correo) y su sesión de revendedora.
  const link = (await call(staff, "POST", `/api/admin/customers/${ana.id}/code-link`, {})).json;
  assert.equal(link.mode, "email");
  const token = (await tokenOf(link.url));
  const pin = (await call(staff, "POST", `/api/admin/customers/${ana.id}/login-pin`, {})).json.pin;
  const anaCk = (await call(null, "POST", "/api/auth/customer/pin", { phone: ana.phone, pin })).r.headers.get("set-cookie").split(";")[0];
  const pub = (body) => call(null, "POST", `/api/code-link/${token}`, body);

  // Título sin la etiqueta interna.
  assert.equal((await call(null, "GET", `/api/code-link/${token}`)).json.name, "Ana Revende");
  // Sin PIN: alcanza con el correo (como antes).
  assert.deepEqual((await pub({ email: "ana2@ficticio.lat" })).json.codes.map((c) => c.code), ["222222"]);
  // Ana ve sus 2 cuentas (no la de Beto) y le pone PIN a una.
  const mine = (await call(anaCk, "GET", "/api/me/code-pins")).json.accounts;
  assert.deepEqual(mine.map((a) => [a.email, a.pin]), [["ana1@ficticio.lat", false], ["ana2@ficticio.lat", false]]);
  assert.equal((await call(anaCk, "POST", "/api/me/code-pins", { email: "beto1@ficticio.lat", pin: "1234" })).status, 400, "no puede ponerle PIN a una cuenta ajena");
  assert.equal((await call(anaCk, "POST", "/api/me/code-pins", { email: "ana1@ficticio.lat", pin: "12" })).status, 400, "4 números");
  const set = await call(anaCk, "POST", "/api/me/code-pins", { email: "ANA1@ficticio.lat", pin: "4321" });
  assert.equal(set.status, 200);
  assert.deepEqual(set.json.accounts.map((a) => a.pin), [true, false]);
  // El PIN no queda en el estado ni en la respuesta (se guarda con scrypt, aparte).
  assert.doesNotMatch(JSON.stringify(s.engine.s), /4321/);
  assert.doesNotMatch(JSON.stringify(set.json), /4321/);
  // Página pública: sin PIN no ve nada; con PIN mal tampoco; con el PIN, solo el código de esa cuenta.
  const sinPin = await pub({ email: "ana1@ficticio.lat" });
  assert.equal(sinPin.status, 401); assert.equal(sinPin.json.error, "PIN_NEEDED");
  assert.doesNotMatch(JSON.stringify(sinPin.json), /111111/);
  const mal = await pub({ email: "ana1@ficticio.lat", pin: "0000" });
  assert.equal(mal.status, 401); assert.equal(mal.json.error, "BAD_PIN");
  const bien = await pub({ email: "ana1@ficticio.lat", pin: "4321" });
  assert.deepEqual(bien.json.codes.map((c) => c.code), ["111111"]);
  // La otra cuenta sigue sin PIN; la de Beto no sale en el link de Ana.
  assert.deepEqual((await pub({ email: "ana2@ficticio.lat" })).json.codes.map((c) => c.code), ["222222"]);
  assert.deepEqual((await pub({ email: "beto1@ficticio.lat" })).json.codes, []);
  // El dueño lo ve en la ficha y también puede ponerlo o quitarlo; queda en la auditoría.
  assert.deepEqual((await call(staff, "GET", `/api/admin/customers/${ana.id}/code-pins`)).json.accounts.map((a) => a.pin), [true, false]);
  assert.equal((await call(staff, "POST", `/api/admin/customers/${ana.id}/code-pins`, { email: "ana2@ficticio.lat", pin: "8888" })).status, 200);
  assert.equal((await pub({ email: "ana2@ficticio.lat" })).json.error, "PIN_NEEDED");
  assert.equal((await call(staff, "POST", `/api/admin/customers/${ana.id}/code-pins`, { email: "ana2@ficticio.lat", pin: "" })).status, 200);
  assert.deepEqual((await pub({ email: "ana2@ficticio.lat" })).json.codes.map((c) => c.code), ["222222"]);
  const audits = s.engine.s.audit.filter((x) => /customer\.code_pin/.test(x.action)).map((x) => x.action);
  assert.deepEqual(audits, ["customer.code_pin", "customer.code_pin", "customer.code_pin_off"]);
  // 🏷️ Título propio de la página de códigos: lo que quiera (sin tocar el nombre de su tienda); vacío = como antes.
  const title = () => call(null, "GET", `/api/code-link/${token}`).then((r) => r.json.name);
  assert.equal((await call(anaCk, "POST", "/api/me/code-title", { title: "  Códigos   TV " })).json.title, "Códigos TV");
  assert.equal(await title(), "Códigos TV");
  assert.equal((await call(anaCk, "GET", "/api/me/code-link")).json.title, "Códigos TV");
  assert.equal((await call(anaCk, "POST", "/api/me/code-title", { title: "x".repeat(41) })).status, 400, "hasta 40 letras");
  assert.equal((await call(anaCk, "POST", "/api/me/code-title", { title: "" })).json.title, "");
  assert.equal(await title(), "Ana Revende");
  assert.equal((await call(staff, "POST", `/api/admin/customers/${ana.id}/code-title`, { title: "Soporte" })).status, 200, "el dueño también");
  assert.equal(await title(), "Soporte");
  assert.equal((await call(staff, "GET", `/api/admin/customers/${ana.id}/code-pins`)).json.title, "Soporte");
  // Probar PINs: a los 5 intentos fallidos se bloquea (ya hubo 1).
  for (let i = 0; i < 4; i++) assert.equal((await pub({ email: "ana1@ficticio.lat", pin: String(1000 + i) })).status, 401);
  assert.equal((await pub({ email: "ana1@ficticio.lat", pin: "4321" })).status, 429, "bloqueado por 15 minutos");

  // ---- Pantallas (celular) ----
  if (chromium) {
    const b = await chromium.launch();
    const shots = process.env.CP_SHOTS;
    try {
      // Beto tiene página y su título se copió de su nombre (como pasa en producción): igual sale sin la etiqueta.
      s.engine.s.customers[beto.id].shop = { ...(s.engine.s.customers[beto.id].shop ?? {}), title: beto.name };
      // Otro link (otro revendedor no bloqueado): Beto con PIN en su cuenta.
      const bl = (await tokenOf((await call(staff, "POST", `/api/admin/customers/${beto.id}/code-link`, {})).json.url));
      await call(staff, "POST", `/api/admin/customers/${beto.id}/code-pins`, { email: "beto1@ficticio.lat", pin: "5555" });
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1 });
      await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(`${base}/codigos/${bl}`);
      await p.locator("#em").waitFor();
      assert.equal((await p.locator("h1").innerText()).trim(), "📺 Beto Revende");
      await p.locator("#em").fill("beto1@ficticio.lat");
      await p.getByRole("button", { name: "Ver mi código" }).click();
      await p.locator("#pn").waitFor();
      assert.match(await p.locator("#e").innerText(), /Esta cuenta tiene PIN/);
      if (shots) await p.screenshot({ path: `${shots}/codigos-pide-pin.png` });
      await p.locator("#pn").fill("9999");
      await p.getByRole("button", { name: "Ver mi código" }).click();
      await p.waitForFunction(() => /PIN incorrecto/.test(document.querySelector("#e")?.innerText || ""));
      await p.locator("#pn").fill("5555");
      await p.getByRole("button", { name: "Ver mi código" }).click();
      await p.getByText("333333").waitFor();
      if (shots) await p.screenshot({ path: `${shots}/codigos-con-pin.png` });
      // Al volver a abrir la página (misma pestaña) no pide todo de nuevo.
      await p.reload();
      await p.getByText("333333").waitFor();
      assert.deepEqual(errs, []);
      await ctx.close();
      // GaboHub de Ana: la tarjeta «PIN por cuenta» con sus 2 cuentas.
      const hc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1 });
      const [hn, hv] = anaCk.split("="); await hc.addCookies([{ name: hn, value: hv, url: base }]);
      await hc.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const h = await hc.newPage(); const herrs = []; h.on("pageerror", (e) => herrs.push(e.message));
      await h.goto(`${base}/hub#codigos`);
      await h.locator(".accpins").waitFor();
      assert.equal(await h.locator(".accpins form[data-accpin]").count(), 2);
      await h.locator('form[data-accpin="ana2@ficticio.lat"] input[name="pin"]').fill("2468");
      await h.locator('form[data-accpin="ana2@ficticio.lat"] [type="submit"]').click();
      await h.locator(".accpins [role=status]").waitFor();
      assert.match(await h.locator(".accpins").innerText(), /ana2@ficticio\.lat[\s\S]*🔒 con PIN/);
      if (shots) await h.screenshot({ path: `${shots}/hub-pin-por-cuenta.png`, fullPage: true });
      // Su título desde GaboHub.
      await h.waitForLoadState("networkidle"); // que termine de redibujar después de guardar el PIN
      await h.locator('#codeTitle input[name="title"]').fill("Mis códigos");
      assert.equal(await h.locator('#codeTitle input[name="title"]').inputValue(), "Mis códigos");
      await h.locator('#codeTitle [type="submit"]').click();
      let nombre = "";
      for (let i = 0; i < 60 && nombre !== "Mis códigos"; i++) { nombre = (await call(null, "GET", `/api/code-link/${token}`)).json.name; if (nombre !== "Mis códigos") await new Promise((r) => setTimeout(r, 500)); }
      assert.equal(nombre, "Mis códigos");
      assert.equal(await h.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "sin desborde");
      assert.deepEqual(herrs, []);
      await hc.close();
      assert.equal((await call(null, "POST", `/api/code-link/${token}`, { email: "ana2@ficticio.lat" })).json.error, "PIN_NEEDED");
    } finally { await b.close(); }
  }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
