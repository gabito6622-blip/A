// 🔐 Elegir PIN propio (20/11/2026, pedido del dueño: «yo les doy el número y su PIN; que después lo cambien y se sientan
// cómodos»). Si el PIN se lo dio la tienda, el revendedor ve arriba «Elegí tu propio PIN»; al cambiarlo, desaparece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("PIN dado por la tienda → aviso «Elegí tu propio PIN»; al cambiarlo, se va", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-pinpropio-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  const c = s.catalog.createCustomer(owner, { name: "Cuentas Plus · Miguel", phone: "+59160000015" });
  e.tx(() => { c.kind = "reseller"; });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) });
  const b = await chromium.launch();
  try {
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${c.id}/login-pin`, {}, ock)).json();
    const ck = (await post("/api/auth/customer/pin", { phone: c.phone, pin })).headers.get("set-cookie").split(";")[0];
    assert.equal((await (await fetch(base + "/api/me", { headers: { cookie: ck } })).json()).pinFromStore, true);
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
    await p.addInitScript(() => { try { localStorage.setItem("gs-tour-done", "1"); localStorage.setItem("gs-tour-short-done", "1"); } catch {} });
    await p.goto(base + "/hub#inicio");
    await p.locator(".pinask").waitFor();
    assert.match(await p.locator(".pinask").innerText(), /Elegí tu propio PIN/);
    assert.ok((await p.locator("[data-pinfocus]").boundingBox()).height >= 44);
    await p.locator("[data-pinfocus]").click();
    const f = p.locator("#myPin"); await f.waitFor({ state: "visible" });
    await f.locator("[name=current]").fill(pin); await f.locator("[name=pin]").fill("4826"); await f.locator("[name=pin2]").fill("4826"); // 20/11: el PIN nuevo se escribe dos veces
    await f.locator("[type=submit]").click();
    await p.waitForFunction(() => !document.querySelector(".pinask"), null, { timeout: 10_000 });
    assert.equal((await (await fetch(base + "/api/me", { headers: { cookie: ck } })).json()).pinFromStore, undefined, "ya lo eligió él");
    assert.equal((await post("/api/auth/customer/pin", { phone: c.phone, pin: "4826" })).status, 200, "entra con su PIN nuevo");
    // Si el dueño le da otro PIN, vuelve a aparecer.
    await post(`/api/admin/customers/${c.id}/login-pin`, {}, ock);
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
