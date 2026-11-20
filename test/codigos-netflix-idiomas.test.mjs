// Códigos de Netflix y Disney en más idiomas, y link de códigos para clientes finales (17/11/2026). El dueño: «que salgan
// los códigos de Disney… en todos los idiomas… y los de Netflix para mis clientes finales, para sacar link para ellos».
// Datos ficticios; nada se manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { extractCode, classifyCode } from "../dist/store/codes.js";
// Links lindos (/cod/<nombre>-xxxx, 19/11/2026): se sigue el link hasta /codigos/<token>, como el navegador.
const tokenOf = async (u) => { if (u.includes("/codigos/")) return u.split("/codigos/")[1]; const r = await fetch(u, { redirect: "manual" }); return (r.headers.get("location") ?? "").split("/codigos/")[1]; };


let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("el código junto a la palabra «código» en varios idiomas", () => {
  const cases = [["Seu código de acesso é 482193", "482193"], ["Ваш код: 551203", "551203"], ["ログインコード: 778899", "778899"], ["Il tuo codice è 556644", "556644"],
    ["Ihr Code lautet 445566", "445566"], ["Votre code : 102938", "102938"], ["Twój kod to 667788", "667788"], ["Doğrulama kodunuz 334455", "334455"], ["Tu código es 123 456", "123 456"]];
  for (const [t, code] of cases) { const r = extractCode(t); assert.equal(r.code, code, t); assert.equal(r.sure, true, t); }
  assert.equal(extractCode("Top 10 de hoy: 2026 estrenos, 12345 puntos").sure, false, "un número suelto no es seguro");
  assert.equal(classifyCode("Seu acesso temporário", ""), "temporal");
  assert.equal(classifyCode("Mettre à jour votre foyer Netflix", ""), "hogar");
  assert.equal(classifyCode("Ihr Anmeldecode", ""), "login");
});

test("Netflix pasa aunque el buzón tenga asuntos viejos; promociones no; link para el cliente final", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-nfcod-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" }, system = { id: "system", role: "system" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix Premium HD 4K", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "p", email: "nfcliente@ficticio.lat", password: "Clave#1", supplierExpiresAt: Date.now() + 30 * DAY, cost: 0, profiles: [{ label: "Perfil 1" }] });
  const cli = s.catalog.createCustomer(owner, { name: "Rosa Ficticia", phone: "+59170000021", kind: "customer" });
  s.orders.create(owner, { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: "v1" });
  // Buzón con una lista de asuntos vieja que no cubre nada de esto.
  e.s.mailboxes = { mb1: { id: "mb1", address: "codigos@ficticio.lat", host: "imap.ficticio.lat", authorizedBy: owner.id, authorizedAt: Date.now(), subjectAllowlist: ["zzz-nada"], kind: "imap" } };
  const now = Date.now();
  const ing = (from, subject, body, html = "") => s.codes.ingest(system, "mb1", { to: "nfcliente@ficticio.lat", from, subject, body, html, receivedAt: now });
  assert.ok(ing("Netflix <info@account.netflix.com>", "Seu código de acesso temporário", "Seu código de acesso: 4821"), "Netflix en portugués pasa");
  assert.equal(ing("Netflix <info@mailer.netflix.com>", "Lo nuevo de esta semana", "Top 10 de hoy: 2026 estrenos, 12345 puntos"), null, "promoción con números: no");
  assert.ok(ing("Netflix <info@account.netflix.com>", "Mettre à jour votre foyer", "Confirmez", '<a href="https://www.netflix.com/account/update-primary-location?nftoken=abc">Oui</a>'), "link de hogar sin código: pasa");
  assert.ok(ing("Disney+ <disneyplus@trx.mail2.disneyplus.com>", "Il tuo codice monouso", "Il tuo codice è 556644"), "Disney sigue pasando");
  assert.equal(ing("Otro <promo@tienda.lat>", "Oferta", "Tu código de descuento 999999"), null, "otro remitente con asunto no permitido: no");

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    if (!chromium) return;
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
      await p.goto(base + "/panel.html#clientes"); await p.reload();
      const card = p.locator(`details.rcli[data-cid="${cli.id}"]`); await card.waitFor();
      await card.locator("summary").click();
      const btn = card.locator("[data-fxcode]"); await btn.waitFor();
      await btn.click();
      const box = card.locator(".fx-codebox"); await box.locator("code").waitFor();
      const url = (await box.locator("code").innerText()).trim();
      assert.match(url, /\/cod\/rosa-[a-z2-9]{4}$/, "link lindo: nombre + 4 caracteres");
      assert.match(decodeURIComponent(await box.locator("[data-fxcodewa]").getAttribute("href")), /^https:\/\/wa\.me\/59170000021\?text=Hola Rosa 👋 Este es tu link/);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      // La clienta abre el link, escribe el correo de su cuenta y ve sus códigos de Netflix.
      const token = await tokenOf(url);
      const r = await fetch(`${base}/api/code-link/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nfcliente@ficticio.lat" }) });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      const txt = JSON.stringify(j);
      assert.match(txt, /4821/); assert.match(txt, /update-primary-location/);
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
