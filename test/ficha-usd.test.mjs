// Ficha del revendedor en dólares: "Mandarle su lista" y sus montos van en US$ (lo que te paga), nunca en Bs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

test("la ficha de un revendedor en dólares trae sus montos en US$; uno de Bolivia sigue en Bs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-ficha-usd-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
    await A("POST", "/api/admin/settings", { usdt: { enabled: true, payId: "123456789", rate: 11.71 } });
    await A("POST", "/api/admin/products", { id: "disney-espn-alq", name: "Disney + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
    await A("POST", "/api/admin/suppliers", { id: "prov", name: "Prov", active: true });
    for (const n of [1, 2]) await A("POST", "/api/admin/accounts", { productId: "disney-espn-alq", supplierId: "prov", email: `d${n}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
    await A("POST", "/api/admin/price-groups", { id: "usd", name: "Panamá y Paraguay (US$)", currency: "USD", prices: { "disney-espn-alq": 700 } });
    const py = await A("POST", "/api/admin/customers", { name: "Py Rev", phone: "+595992946366", kind: "reseller" });
    const bo = await A("POST", "/api/admin/customers", { name: "Bo Rev", phone: "+59171234567", kind: "reseller" });
    await A("POST", `/api/admin/customers/${py.id}`, { priceGroupId: "usd" });
    await A("POST", `/api/admin/customers/${py.id}/bulk-assign`, { text: "d1@x.lat" });
    await A("POST", `/api/admin/customers/${bo.id}/bulk-assign`, { text: "d2@x.lat" });
    const fp = await A("GET", `/api/admin/resellers/${py.id}/sheet`);
    assert.equal(fp.currency, "USD");
    assert.equal(fp.rows.length, 1);
    assert.equal(fp.rows[0].price, 700, "US$ 7, no Bs 81,97");
    const fb = await A("GET", `/api/admin/resellers/${bo.id}/sheet`);
    assert.equal(fb.currency, "BOB");
    assert.equal(fb.rows[0].price, 6900, "Bolivia sigue en Bs");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
