// Invitar revendedores desde Inicio: un botón arma la fila y, al abrir el WhatsApp, pasa sola al siguiente.
// Usa el navegador (Playwright) si está instalado; si no (por ejemplo en la CI), se salta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Inicio: '▶ Invitarlos ahora' arma la fila y avanza sola al abrir WhatsApp", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-invini-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    const login = async (username, password) => {
      const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      return r.headers.get("set-cookie").split(";")[0];
    };
    const ck = await login("gabriel", "clave-del-dueño-123");
    const A = (m, p, b) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
    const r1 = await A("POST", "/api/admin/customers", { name: "Rev Uno", phone: "+59177700011", kind: "reseller" });
    const r2 = await A("POST", "/api/admin/customers", { name: "Rev Dos", phone: "+59177700022", kind: "reseller" });
    const r3 = await A("POST", "/api/admin/customers", { name: "Rev Tres", phone: "+59177700033", kind: "reseller" });
    await A("POST", `/api/admin/customers/${r3.id}/login-pin`, {}); // ya tiene PIN: no entra en la fila

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const [name, value] = ck.split("=");
    await ctx.addCookies([{ name, value, url: base }]);
    await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort()); // nunca sale un WhatsApp real
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/panel.html#inicio");

    const card = page.locator(".hm-invite");
    await card.waitFor();
    assert.match(await card.innerText(), /2 revendedores todavía sin acceso/);
    await card.getByRole("button", { name: /Invitarlos ahora/ }).click();

    const step = page.locator(".invstep");
    await step.waitFor();
    assert.match(await step.innerText(), /1 de 2/);
    const first = /Rev Uno/.test(await step.innerText()) ? r1 : r2, second = first === r1 ? r2 : r1;
    await step.getByRole("button", { name: /Generar PIN/ }).click();
    const wa = step.locator("a[data-invsent]");
    await wa.waitFor();
    assert.match(await wa.getAttribute("href"), new RegExp(`wa\\.me/${first.phone.replace("+", "")}`));
    await wa.click();
    await page.waitForFunction(() => /2 de 2/.test(document.querySelector(".invstep")?.innerText ?? ""));
    assert.match(await step.innerText(), new RegExp(second.name), "pasó solo al siguiente");

    await step.getByRole("button", { name: /Anterior/ }).click();
    await page.waitForFunction(() => /1 de 2/.test(document.querySelector(".invstep")?.innerText ?? ""));
    assert.match(await step.innerText(), /Abrir WhatsApp \(PIN/, "al volver, el PIN generado sigue ahí");

    const list = (await A("GET", "/api/admin/resellers")).list;
    assert.equal(list.find((x) => x.id === first.id).hasPin, true);
    assert.equal(list.find((x) => x.id === second.id).hasPin, false, "al de la fila que no tocaste no se le genera PIN");

    // Atención (vendedor) no ve la tarjeta
    await A("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    const ck2 = await login("lucia", "clave-de-lucia-123");
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const [n2, v2] = ck2.split("=");
    await ctx2.addCookies([{ name: n2, value: v2, url: base }]);
    const p2 = await ctx2.newPage();
    await p2.goto(base + "/panel.html#inicio");
    await p2.locator(".hm-hero").waitFor();
    assert.equal(await p2.locator(".hm-invite").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
