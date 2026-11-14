// Panel: tocar la tarjeta de un producto abre su edición (14/11/2026). La revisión del súper administrador encontró
// que la tarjeta era role="button" y el panel solo escuchaba <button>: no se podía cambiar un precio. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Productos: tocar la tarjeta abre la edición y el precio nuevo se guarda", { skip: !chromium && "Playwright no está instalado", timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-prodedit-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel#productos");
    await p.locator('[data-editprod="nf"]').click();
    const f = p.locator("#prodForm");
    await f.locator("button", { hasText: "Guardar cambios" }).waitFor();
    assert.equal(await f.locator('input[name="name"]').inputValue(), "Netflix");
    await f.locator('input[name="price"]').fill("40");
    await f.locator("button", { hasText: "Guardar cambios" }).click();
    await p.waitForFunction(() => !document.querySelector("#prodForm button") || !/Guardar cambios/.test(document.querySelector("#prodForm").innerText));
    assert.equal(s.engine.s.products.nf.price, 4000, "el precio quedó en Bs 40");
    // Con el teclado (Enter) también abre.
    await p.locator('[data-editprod="nf"]').focus();
    await p.keyboard.press("Enter");
    await f.locator("button", { hasText: "Guardar cambios" }).waitFor();
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
