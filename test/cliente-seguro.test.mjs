// Cliente final más seguro (14/11/2026), de la revisión en su lugar:
// - en Mis cuentas la contraseña de la cuenta sale tapada hasta tocar «Ver» (antes se leía apenas se abría);
// - «Olvidé mi contraseña» responde lo mismo exista o no el correo (antes un error delataba que la cuenta existía).
// Datos ficticios en carpeta temporal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Cliente: contraseña tapada con «Ver» y «Olvidé mi contraseña» sin delatar correos", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-clseg-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Secreta#9", supplierExpiresAt: Date.now() + 90 * 86_400_000, cost: 1000, profiles: [{ label: "P1" }] });
  const rosa = s.catalog.createCustomer(owner, { name: "Rosa Prueba", phone: "+59170000123" });
  s.engine.tx(() => { rosa.email = "rosa@prueba.lat"; });
  s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    // Sin correo de la tienda conectado: igual responde «ok», exista o no la cuenta.
    const a = await post("/api/auth/customer/forgot", { email: "rosa@prueba.lat" });
    const b = await post("/api/auth/customer/forgot", { email: "nadie@prueba.lat" });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.deepEqual(await a.json(), await b.json());

    if (chromium) {
      const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      const { pin } = await (await post(`/api/admin/customers/${rosa.id}/login-pin`, {}, ock)).json();
      const ck = (await post("/api/auth/customer/pin", { phone: rosa.phone, pin })).headers.get("set-cookie").split(";")[0];
      const br = await chromium.launch();
      try {
        const ctx = await br.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
        await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/tienda/#cuentas");
        await p.locator(".svc").first().waitFor();
        const svc = p.locator(".svc").first();
        if (await svc.locator("details.credbox").count()) await svc.locator("details.credbox summary").click();
        assert.doesNotMatch(await svc.innerText(), /Clave-Secreta#9/, "tapada al abrir");
        await svc.locator('[data-pwshow]').click();
        assert.match(await svc.innerText(), /Clave-Secreta#9/, "se ve al tocar «Ver»");
        await svc.locator('[data-pwshow]').click();
        assert.doesNotMatch(await svc.innerText(), /Clave-Secreta#9/, "y se vuelve a tapar");
        // «Seguridad de mi cuenta» también está para el cliente de la tienda.
        await p.locator('#sout [data-s="seguridad"]').click();
        await p.getByRole("heading", { name: /Seguridad de mi cuenta/ }).waitFor();
        assert.deepEqual(errs, []);
      } finally { await br.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
