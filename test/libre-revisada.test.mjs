// ✅ «La revisé: está libre» (20/11/2026). El dueño no confía en las cuentas «libres» sin revisar (puede que alguien las
// tenga). Botón por cuenta; las confirmadas salen primero en «Disponibles» con la fecha; al venderla, el ✅ se va solo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PASS = "clave-del-dueño-123";

test("cuenta libre revisada: botón, fecha, primero en Disponibles y se borra al vender", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-librerev-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dza", name: "Disney Premium + ESPN", kind: "full_account", durationDays: 30, price: 7000, published: true });
  const ids = ["aaa@ficticio.lat", "zzz@ficticio.lat"].map((m) => s.inventory.addAccount(owner, { productId: "dza", email: m, password: "Clave#1", supplierExpiresAt: Date.now() + 60 * 864e5, cost: 0, profiles: [{ label: "Cuenta completa" }] }).account.id);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
    await p.goto(base + "/panel#cuentas");
    await p.locator('[data-freecheck]').first().waitFor();
    assert.equal(await p.locator('[data-freecheck][data-ok="1"]').count(), 2, "las dos sin confirmar");
    await p.locator(`.acard:has-text("zzz@ficticio.lat") [data-freecheck]`).click();
    await p.waitForFunction(() => /Revisada libre el \d\d\/\d\d\/\d{4}/.test(document.body.innerText));
    assert.ok(e.s.accounts[ids[1]].freeCheckedAt);
    await p.locator('[data-tab="accf:libres"]').click(); await p.waitForTimeout(400);
    assert.match(await p.locator(".acard").first().innerText(), /zzz@ficticio\.lat/, "la confirmada primero");
    const c = s.catalog.createCustomer(owner, { name: "Cli", phone: "+59170000123" });
    const slot = Object.values(e.s.slots).find((x) => x.accountId === ids[1]).id;
    s.orders.create(owner, { customerId: c.id, items: [{ productId: "dza", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot] });
    assert.equal(e.s.accounts[ids[1]].freeCheckedAt, undefined, "al venderla, el ✅ se va");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
