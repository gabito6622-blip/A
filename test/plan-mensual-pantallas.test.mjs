// Que el cliente de la tienda se quede (14/11/2026), en el navegador a 360 px (claro y oscuro): «Renovar mi combo»,
// «Renovar todo junto» con «un solo día de pago» y la tarjeta del plan; el cartel sin candado ni «proveedor» (solo en los
// últimos 7 días); fallas con horario y «Hablar con una persona»; «Falla reportada · Revisando»; la línea de qué hacer con
// cada código; «Olvidé mi PIN» con el número anterior; y accesibilidad (foco atrapado en Acceder, Escape, foco al título
// al cambiar de pantalla con aviso, Ver/Ocultar contraseña con su nombre). Datos ficticios, carpeta temporal, sin red.
// Con GS_SHOTS=<carpeta fuera del repo> guarda capturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SHOTS = process.env.GS_SHOTS || "";
// Con GS_AXE=<ruta a axe.min.js> (axe-core no es dependencia del proyecto) también revisa WCAG A/AA de lo nuevo.
const AXE = process.env.GS_AXE ? readFileSync(process.env.GS_AXE, "utf8") : "";
async function axeCheck(page, include) {
  if (!AXE) return;
  await page.evaluate(AXE);
  const v = await page.evaluate(async (inc) => (await window.axe.run({ include: inc.filter((x) => document.querySelector(x)).map((x) => [x]) }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations
    .map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(" | ")}`), include);
  assert.deepEqual(v, [], `axe: ${include.join(", ")}`);
}

test("códigos: la misma línea de qué hacer en las cuatro pantallas", async () => {
  const { kindHelp } = await import("../public/codigos-ayuda.js");
  assert.match(kindHelp("hogar"), /Tocá «Abrir enlace» y después «Sí, la envié yo», desde la tele o celular donde mirás/);
  assert.match(kindHelp("temporal"), /Escribí este número en la tele/);
  assert.match(kindHelp("login"), /Escribí este código donde te lo pide/);
  assert.equal(kindHelp("otro"), "");
  for (const f of ["shop.js", "codigos-solos.js", "codigos.js", "cobro-codigos.js"]) assert.match(readFileSync(resolve("public", f), "utf8"), /kindHelp\(c\.kind\)/, f);
});

test("preguntas frecuentes: la regla del PIN no cambia, pero suma «reportalo igual»", async () => {
  globalThis.document ??= undefined;
  const src = readFileSync(resolve("public/cliente-ayuda.js"), "utf8");
  assert.match(src, /Si te cambiaron el PIN, reportalo igual: te ayudamos\./);
  const { faqExtra, REPORT_WHERE } = await import("../public/cliente-ayuda.js").catch(() => ({}));
  if (!faqExtra) return; // common.js necesita el navegador: se prueba abajo en la página
  const rule = "No cambies la contraseña ni el PIN. Si se cambian, se pierde la garantía.";
  assert.equal(faqExtra(rule), `${rule} Si te cambiaron el PIN, reportalo igual: te ayudamos.`);
  assert.equal(faqExtra("¿Cómo pago? Con QR."), "¿Cómo pago? Con QR.");
  assert.match(REPORT_WHERE, /Reportá en Mis cuentas.*si es urgente, escribinos por WhatsApp/);
});

test("cliente de la tienda a 360 px: combo, renovar todo junto, plan, avisos, fallas, códigos, PIN y accesibilidad", { timeout: 240_000 }, async (t) => {
  if (!chromium) return t.skip("sin Playwright");
  const dir = mkdtempSync(join(tmpdir(), "gs-c3-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.updateSettings(owner, { storeName: "Tienda Prueba", whatsapp: "59170000000" });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  const now = Date.now();
  for (const [id, name, price] of [["nf", "Netflix", 3500], ["dp", "Disney+", 3000], ["sp", "Spotify", 2000], ["mx", "Max", 2500]]) {
    s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price, published: true });
    s.inventory.addAccount(owner, { productId: id, supplierId: "andes", email: `${id}1@ficticio.lat`, password: "Clave-Ficticia#1", supplierExpiresAt: now + 300 * DAY, cost: 1000, profiles: [1, 2, 3].map((n) => ({ label: `Perfil ${n}`, pin: "1234" })) });
  }
  // Una cuenta de Max que vence pronto con el proveedor (la tienda primero la renueva).
  s.inventory.addAccount(owner, { productId: "mx", supplierId: "andes", email: "mx2@ficticio.lat", password: "Clave-Ficticia#2", supplierExpiresAt: now + 22 * DAY, cost: 1000, profiles: [{ label: "Perfil A" }, { label: "Perfil B" }] });
  s.catalog.upsertProduct(owner, { id: "familia", name: "Combo Familia", kind: "combo", durationDays: 30, price: 6000, published: true, comboProductIds: ["nf", "dp", "sp"] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Combo", phone: "+59170000201" });
  const bea = s.catalog.createCustomer(owner, { name: "Bea Max", phone: "+59170000202" });
  s.wallet.adjust(owner, ana.id, 20000, "saldo de prueba");
  const asC = (c) => ({ id: "u_" + c.id, role: "customer", customerId: c.id });
  const famIds = s.orders.create(asC(ana), { customerId: ana.id, items: [{ productId: "familia", qty: 1 }], paymentMethod: "balance", idempotencyKey: "f1" }).assignmentIds;
  for (const id of famIds) s.orders.setExpiry(owner, id, now + 3 * DAY);
  const nfId = famIds.find((id) => s.engine.s.assignments[id].productId === "nf");
  const nfEmail = s.engine.s.accounts[s.engine.s.slots[s.engine.s.assignments[nfId].slotId].accountId].email;
  // Max de Bea: en la cuenta que vence con el proveedor; primero con 20 días, después con 5.
  const slotB = Object.values(s.engine.s.slots).find((x) => s.engine.s.accounts[x.accountId].email === "mx2@ficticio.lat");
  const maxId = s.orders.create(owner, { customerId: bea.id, items: [{ productId: "mx", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slotB.id] }).assignmentIds[0];
  s.orders.setExpiry(owner, maxId, now + 20 * DAY);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
  const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
  await call("POST", "/api/admin/settings/qr", { contentBase64: PNG }, ock);
  const enter = async (c) => { const { pin } = (await call("POST", `/api/admin/customers/${c.id}/login-pin`, {}, ock)).json; return (await call("POST", "/api/auth/customer/pin", { phone: c.phone, pin })).ck; };
  const ack = await enter(ana), bck = await enter(bea);
  // Falla de Netflix, ya en revisión. Un código de «Actualizar hogar» que llegó al correo de su Netflix.
  await call("POST", "/api/me/tickets", { assignmentId: nfId, kind: "no_entra" }, ack);
  const tk = Object.values(s.engine.s.tickets)[0];
  s.tickets.setStatus(owner, tk.id, { status: "revisando" });
  const mbx = s.codes.configureMailbox(owner, { address: "codigos.tienda@gmail.com", host: "imap.gmail.com" }).id;

  const b = await chromium.launch();
  try {
    const ctxFor = async (ck, scheme = "light", w = 360) => {
      const ctx = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, colorScheme: scheme });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (x) => x.abort());
      if (ck) { const [k, v] = ck.split("="); await ctx.addCookies([{ name: k, value: v, url: base }]); }
      return ctx;
    };
    const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
    const small = (p) => p.evaluate(() => [...document.querySelectorAll("#sout *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.textContent.trim().slice(0, 40)));
    const tiny = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => el.textContent.trim().slice(0, 40)), sel);

    // ---- Ana: combo y renovar todo junto (claro) ----
    const ctx = await ctxFor(ack);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
    const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await p.goto(base + "/tienda/#cuentas");
    await p.locator(".combostrip").waitFor();
    assert.match(await p.locator(".combostrip").innerText(), /Tu combo: Disney\+ \+ Netflix \+ Spotify[\s\S]*Renovar mi combo · Bs 60/);
    const nfCard = p.locator(".svc").filter({ has: p.locator(".who b", { hasText: /^Netflix$/ }) });
    assert.match(await nfCard.innerText(), /Falla reportada · Revisando/);
    assert.match(await nfCard.innerText(), /juntos te ahorrás Bs 25/);
    await p.locator("#rabox .ratot").waitFor();
    assert.match(await p.locator("#rabox .ratot").innerText(), /Descuento de tu combo: −Bs 25(\.00)? · Total: Bs 60/);
    assert.equal(await over(p), 0);
    assert.deepEqual(await small(p), []);
    assert.deepEqual(await tiny(p, "#rabox .sbtn, .combostrip .sbtn, .combonote .sbtn, #rabox .rmrow, #rabox .raalign"), []);
    await shot(p, "c3-cuentas-claro");
    // Un solo día de pago + guardar como plan → pagar con saldo (muestra días y total antes de confirmar).
    await p.locator("[data-raalign]").check();
    await p.locator("[data-raplan]").waitFor();
    await p.locator("[data-raplan]").check();
    await p.waitForFunction(() => /todos vencen el/.test(document.querySelector("#rabox .ratot")?.textContent ?? ""));
    assert.match(await p.locator("#rabox .ralist").innerText(), /30 días: del \d\d\/\d\d\/\d{4} al \d\d\/\d\d\/\d{4}/);
    const bal0 = s.wallet.balance(ana.id);
    await p.locator('[data-rapay="balance"]').click();
    await p.locator(".plancard").waitFor();
    assert.match(dialogs.at(-1), /Renovar con tu saldo\?[\s\S]*Total: Bs 60/);
    assert.equal(bal0 - s.wallet.balance(ana.id), 6000);
    assert.match(await p.locator(".plancard").innerText(), /Tu plan: Disney\+ \+ Netflix \+ Spotify[\s\S]*Próximo pago \d\d\/\d\d\/\d{4} · Bs 60[\s\S]*Nada se cobra solo/);
    await shot(p, "c3-plan-claro");
    await axeCheck(p, [".plancard", "#rabox", ".combostrip", ".svc"]);
    // El toque del aviso del plan abre «Pagar este mes» con el total (sin pagar todavía).
    await p.goto(base + "/tienda/?pagar=plan#cuentas");
    await p.locator("#rabox[open] .ratot").waitFor();
    assert.match(await p.locator("#rabox .ratot").innerText(), /Total: Bs 60/);
    assert.equal(new URL(p.url()).search, "", "el link no queda pegado");
    // Ver / Ocultar contraseña cambia su nombre accesible.
    const pw = nfCard.locator("[data-pwshow]");
    await pw.click();
    assert.equal(await pw.getAttribute("aria-label"), "Ocultar contraseña");
    await pw.click();
    assert.equal(await pw.getAttribute("aria-label"), "Ver contraseña");
    // Códigos: la línea de qué hacer junto al código.
    s.codes.ingest(owner, mbx, { to: nfEmail, from: "Netflix <info@account.netflix.com>", subject: "Actualizá tu hogar de Netflix", body: "Tocá el enlace https://www.netflix.com/account/update-primary-location?nftoken=abc para actualizar tu hogar", receivedAt: Date.now() });
    assert.equal((await call("GET", "/api/me/codes", null, ack)).json[0]?.kind, "hogar");
    await p.goto(base + "/tienda/#codigos");
    await p.locator(".code").first().waitFor();
    assert.match(await p.locator("#sout").innerText(), /👉 Tocá «Abrir enlace» y después «Sí, la envié yo», desde la tele o celular donde mirás\./);
    // Y en «📩 Ver códigos» de la tarjeta del servicio.
    await p.goto(base + "/tienda/#cuentas");
    await nfCard.locator("[data-svccodes]").click();
    await p.locator(".cs-svc .khelp").waitFor();
    // Fallas: horario y «Hablar con una persona».
    await p.goto(base + "/tienda/#fallas");
    await p.locator(".fhelp", { hasText: "Atendemos" }).waitFor();
    assert.match(await p.locator(".fhelp").innerText(), /Atendemos de 08:00 a 22:00\.[\s\S]*Reportá en Mis cuentas → ⚠️ Reportar falla; si es urgente, escribinos por WhatsApp\.[\s\S]*Hablar con una persona/);
    assert.match(await p.locator(".fhelp a").getAttribute("href"), /^https:\/\/wa\.me\/59170000000\?text=/);
    assert.equal(await over(p), 0);
    await shot(p, "c3-fallas-claro");
    await axeCheck(p, [".fhelp"]);
    // Al cambiar de pantalla, el foco va al título y se anuncia.
    await p.locator('.bnav [data-s="cuentas"]').click();
    await p.waitForFunction(() => document.activeElement?.matches?.("#sout h1, #sout h2"));
    await p.waitForFunction(() => /^Pantalla: /.test(document.getElementById("a11yLive")?.textContent ?? ""));
    assert.match(await p.locator("#a11yLive").textContent(), /Pantalla: Mis cuentas y pedidos/);
    assert.deepEqual(errs, []);
    await ctx.close();

    // ---- Ana en modo oscuro: sin desborde ni letra chica ----
    const dctx = await ctxFor(ack, "dark");
    const dp = await dctx.newPage(); const derrs = []; dp.on("pageerror", (x) => derrs.push(x.message));
    await dp.goto(base + "/tienda/#cuentas");
    await dp.locator(".plancard").waitFor();
    assert.equal(await over(dp), 0);
    assert.deepEqual(await small(dp), []);
    await shot(dp, "c3-plan-oscuro");
    await dp.goto(base + "/tienda/#fallas"); await dp.locator(".fhelp", { hasText: "Atendemos" }).waitFor();
    await shot(dp, "c3-fallas-oscuro");
    assert.deepEqual(derrs, []);
    await dctx.close();
    // Y a 390 px (otro celular común), oscuro: tampoco se sale nada.
    const wctx = await ctxFor(ack, "dark", 390);
    const wp = await wctx.newPage();
    await wp.goto(base + "/tienda/#cuentas");
    await wp.locator(".plancard").waitFor();
    assert.equal(await over(wp), 0);
    await wctx.close();

    // ---- Bea: Max que primero renueva la tienda; sin candado ni «proveedor» ----
    const bctx = await ctxFor(bck);
    const bp = await bctx.newPage();
    await bp.goto(base + "/tienda/#cuentas");
    const card = bp.locator(".svc").filter({ has: bp.locator(".who b", { hasText: /^Max$/ }) });
    await card.waitFor();
    assert.doesNotMatch(await card.innerText(), /Pedir renovación|proveedor|🔒/, "con 20 días no hay cartel");
    s.orders.setExpiry(owner, maxId, Date.now() + 5 * DAY);
    await bp.reload();
    await card.waitFor();
    const txt = await card.innerText();
    assert.match(txt, /Para renovar, tocá «Pedir renovación» y te avisamos cuando esté lista\. Tu cuenta sigue andando hasta el\s+\d\d\/\d\d\/\d{4}/);
    assert.doesNotMatch(txt, /proveedor|🔒/);
    assert.equal(await over(bp), 0);
    await shot(bp, "c3-aviso-sin-candado");
    await axeCheck(bp, [".svc"]);
    await bctx.close();

    // ---- Sin sesión: Acceder (foco atrapado, Escape) y «Olvidé mi PIN» con el número anterior ----
    const gctx = await ctxFor(null);
    const gp = await gctx.newPage(); const gerrs = []; gp.on("pageerror", (x) => gerrs.push(x.message));
    await gp.goto(base + "/tienda/#cuentas");
    await gp.locator("#sout [data-login]").click();
    await gp.locator("#modal [role=dialog]").waitFor();
    assert.match(await gp.locator("#modal").ariaSnapshot(), /dialog "Acceder/);
    for (let i = 0; i < 12; i++) {
      await gp.keyboard.press("Tab");
      assert.ok(await gp.evaluate(() => document.getElementById("modal").contains(document.activeElement)), `Tab ${i + 1}: el foco sigue en la ventana`);
    }
    await gp.keyboard.press("Shift+Tab");
    assert.ok(await gp.evaluate(() => document.getElementById("modal").contains(document.activeElement)));
    await gp.keyboard.press("Escape");
    await gp.waitForFunction(() => document.getElementById("modal").hidden);
    assert.equal(await gp.evaluate(() => document.activeElement?.dataset?.login), "1", "el foco vuelve al botón Acceder");
    // Olvidé mi PIN → (sin código por WhatsApp) → ayuda con el número anterior.
    await gp.locator("#sout [data-login]").click();
    await gp.locator('[data-loginwhy="forgot"]').click();
    await gp.locator("#login [name=phone]").fill("+591 70000299");
    await gp.locator('#login [type="submit"]').click();
    await gp.locator("#recWa").waitFor();
    assert.match(await gp.locator("#modal").innerText(), /Te pediremos un dato de tu compra para confirmar que sos vos/);
    await gp.locator("[name=rname]").fill("Rosa Quispe");
    await gp.locator("[name=rchanged]").check();
    await gp.locator("[name=rprev]").fill("+591 71112222");
    const href = decodeURIComponent(await gp.locator("#recWa").getAttribute("href"));
    assert.match(href, /soy Rosa Quispe\. Necesito mi PIN para entrar a Tienda Prueba\. Mi número es \+591 70000299\. Cambié de número: mi número anterior era \+591 71112222\./);
    assert.equal(await over(gp), 0);
    await shot(gp, "c3-olvide-pin");
    await axeCheck(gp, ["#modal"]);
    assert.deepEqual(gerrs, []);
    await gctx.close();
  } finally {
    await b.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
