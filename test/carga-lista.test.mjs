// «Carga por lista» del inventario (14/11/2026). La revisión del súper administrador encontró que «31/12/2026» quedaba
// como 2126, que una clave con coma se cortaba («Cla,ve#11» → «Cla») y que sin fecha la cuenta «vencía» en 100 años, todo
// sin avisar. Ahora: dd/mm/aaaa, claves con comas, fecha obligatoria y si una línea está mal no se carga ninguna.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Carga por lista: fechas dd/mm, claves con coma, todo o nada", { skip: !chromium && "Playwright no está instalado", timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-bulk-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel#carga");
    const f = p.locator("#bulkForm");
    await f.waitFor();
    if (!(await f.isVisible())) await p.locator("#bulkForm").evaluate((el) => el.closest("details")?.setAttribute("open", ""));
    const accounts = () => Object.values(s.engine.s.accounts);
    // Una línea mala (sin fecha) → no se carga NINGUNA y se dice cuál.
    await f.locator('textarea[name="rows"]').fill("uno@x.lat, Clave#1, 5, 31/12/2026\ndos@x.lat, Clave#2, 5,");
    await f.locator('button[type="submit"]').click();
    await p.locator("#bulkOut .perr").waitFor();
    assert.match(await p.locator("#bulkOut").innerText(), /No se cargó nada[\s\S]*Línea 2/);
    assert.equal(accounts().length, 0);
    // Todo bien: fecha dd/mm/aaaa, clave con coma, separado por tabulación (copiado de Excel) también.
    await f.locator('textarea[name="rows"]').fill("uno@x.lat, Cla,ve#11, 5, 31/12/2026\ndos@x.lat\tClave#2\t1\t15/01/2027");
    await f.locator('button[type="submit"]').click();
    await p.waitForFunction(() => /2 cuentas cargadas/.test(document.body.innerText));
    const uno = accounts().find((a) => a.email === "uno@x.lat"), dos = accounts().find((a) => a.email === "dos@x.lat");
    assert.equal(new Date(uno.supplierExpiresAt).getFullYear(), 2026, "31/12/2026 queda en 2026 (no 2126)");
    assert.equal(new Date(uno.supplierExpiresAt).getMonth(), 11);
    assert.equal(Object.values(s.engine.s.slots).filter((x) => x.accountId === uno.id).length, 5, "5 perfiles");
    assert.equal(new Date(dos.supplierExpiresAt).getMonth(), 0);
    // La clave con coma se guardó entera (se ve con el permiso del dueño).
    const withPw = s.inventory.listAccounts(owner, { withSecrets: true }).find((a) => a.id === uno.id);
    assert.equal(withPw.password, "Cla,ve#11");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
