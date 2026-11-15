// ¿Para cuántos dispositivos? (15/11/2026). El dueño: «ChatGPT pusiste cuenta completa, es 1 dispositivo. Casi todo lo
// de la tienda es un dispositivo. Si quisieran más, tendría que haber un botón que diga quiero para dos pantallas».
//  1. La tarjeta ya no dice «Cuenta completa»: dice «Acceso con correo y contraseña» y «Para 1 dispositivo».
//  2. «¿Para 2 o más?» abre la ficha con 1 / 2 / 3 dispositivos y el total (precio × dispositivos).
//  3. «Agregar 2 al carrito» suma 2 unidades; el carrito dice «para 2 dispositivos». No pasa de lo que hay.
//  4. Lo que el dueño cargó en «Para quién» manda; las invitaciones no dicen dispositivos.
//  5. 360 px y zoom 200 %: botones de 44 px, sin desborde.
// Datos ficticios; WhatsApp cortado en el navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("tarjeta «Para 1 dispositivo» y ficha para elegir 2 o 3 dispositivos", { timeout: 180_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-disp-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, otpSender: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  const P = (id, name, kind, price, extra = {}) => post("/api/admin/products", { id, name, kind, durationDays: 30, price, published: true, category: "Streaming", description: `${name}.`, ...extra }, ck);
  await P("chatgpt", "ChatGPT Premium", "full_account", 4000);
  await P("netflix", "Netflix Premium HD 4K", "profile", 4000);
  await P("tv", "Tele en familia", "profile", 3000, { forWhom: "Para 2 pantallas a la vez" });
  await P("canva", "Canva EduPro", "invite", 500);
  await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, ck);
  for (const [pid, n] of [["chatgpt", 1], ["netflix", 2], ["chatgpt", 1]]) await post("/api/admin/accounts", { productId: pid, supplierId: "andes", email: `${pid}${Math.random().toString(36).slice(2, 7)}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 0, profiles: Array.from({ length: n }, (_, i) => ({ label: n > 1 ? `Perfil ${i + 1}` : "Cuenta completa" })) }, ck);
  await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", layout: "ticket" }, ck);

  const b = await chromium.launch();
  try {
    for (const zoom of [1, 2]) {
      const ctx = await b.newContext({ viewport: { width: Math.round(360 / zoom), height: Math.round(780 / zoom) }, deviceScaleFactor: zoom, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/tienda/#inicio");
      await p.waitForFunction(() => !document.querySelector("#sout .skeleton") && document.querySelector(".tk"));
      const row = (name) => p.locator(".tk", { has: p.locator(`h3:text-is("${name}")`) });

      // 1 y 4: textos de la tarjeta.
      const gpt = await row("ChatGPT Premium").innerText();
      assert.doesNotMatch(gpt, /Cuenta completa/, "ya no dice «Cuenta completa»");
      assert.match(gpt, /Acceso con correo y contraseña · 1 mes/);
      assert.match(gpt, /Para 1 dispositivo · ¿Para 2 o más\?/);
      assert.match(await row("Tele en familia").innerText(), /Para 2 pantallas a la vez/, "lo del panel manda");
      assert.doesNotMatch(await row("Tele en familia").innerText(), /Para 1 dispositivo/);
      assert.doesNotMatch(await row("Canva EduPro").innerText(), /dispositivo/, "la invitación va a tu correo");

      // 2: la línea abre la ficha con 1 / 2 / 3.
      await row("Netflix Premium HD 4K").locator(".ccdev").click();
      const f = p.locator(".ccficha");
      await f.waitFor();
      const opts = f.locator("[data-devn]");
      assert.deepEqual((await opts.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()), ["1 dispositivo Bs 40", "2 dispositivos Bs 80", "3 dispositivos Bs 120"]);
      assert.equal(await opts.nth(2).isDisabled(), true, "solo hay 2 perfiles: el 3 no se puede elegir");
      assert.match(await f.innerText(), /Cada dispositivo es 1 perfil asignado más \(Bs 40 c\/u\)\. Ahora hay 2\./);
      await opts.nth(1).click();
      await p.waitForFunction(() => document.querySelector('.ccficha [data-devn="2"]')?.getAttribute("aria-pressed") === "true");
      assert.match(await f.locator(".price").innerText(), /Bs 80[\s\S]*2 dispositivos/);
      // 5: tamaños dentro de la ficha.
      const small = await f.locator("button, a.sbtn").evaluateAll((l) => l.filter((x) => x.getBoundingClientRect().height > 0 && x.getBoundingClientRect().height < 44).map((x) => x.textContent.trim().slice(0, 30)));
      assert.deepEqual(small, [], `botones chicos con zoom ${zoom}`);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `desborde con zoom ${zoom}`);

      // 3: agrega 2 y el carrito lo dice.
      await f.getByRole("button", { name: /para 2 dispositivos al carrito/ }).click();
      const cart = await p.evaluate(() => JSON.parse(localStorage.getItem("gs-cart-store") || "[]"));
      const line = (Array.isArray(cart) ? cart : cart.items ?? []).find((l) => l.productId === "netflix");
      assert.equal(line?.qty, 2, "2 unidades en el carrito");
      await p.locator(".shead [data-cart]").first().click();
      await p.waitForFunction(() => /para 2 dispositivos/.test(document.querySelector("#drawer")?.innerText ?? ""));
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
