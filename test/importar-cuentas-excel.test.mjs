// 📦 Cargar cuentas para vender desde Excel (17/11/2026). El dueño: «mañana voy a meter más cuentas… completas y con
// perfiles desde un Excel, de manera masiva». Datos ficticios; nada real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { readSheet, writeXlsx } from "../dist/server/xlsx.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const dmy = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };

test("cuentas para vender desde Excel: plantilla, vista previa, errores claros y carga", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-impstock-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  const P = (id, name, kind) => s.catalog.upsertProduct(owner, { id, name, kind, durationDays: 30, price: 3500, published: true });
  P("netflix", "Netflix Premium HD 4K", "profile"); P("disney-espn", "Disney+ con ESPN", "profile"); P("disney", "Disney+ sin ESPN", "profile");
  P("netflix-extra", "Netflix Perfil Extra Premium", "profile"); P("netflix-3m", "Netflix Premium HD 4K · 3 meses", "profile");
  P("prime", "Amazon Prime Video", "profile"); P("hbo", "HBO Max", "profile"); P("netflix-alq", "Netflix completa (alquiler revendedores)", "full_account");
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", active: true });
  s.inventory.addAccount(owner, { productId: "netflix", supplierId: "andes", email: "ya.cargada@ficticio.lat", password: "x", supplierExpiresAt: Date.now() + 30 * DAY, cost: 0, profiles: [{ label: "Perfil 1" }] });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = async (m, p, body, ck) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, r, json: r.headers.get("content-type")?.includes("json") ? await r.json() : null }; };
  try {
    const ck = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];

    // Plantilla: 3 hojas; ejemplos con SUS productos; hoja «Productos» con los nombres exactos (sin combos).
    const tpl = await call("GET", "/api/admin/import/template?type=stock", null, ck);
    assert.equal(tpl.status, 200);
    const tbuf = Buffer.from(await tpl.r.arrayBuffer());
    const rows = readSheet(tbuf);
    assert.deepEqual(rows[0], ["Producto", "Correo", "Contraseña", "Perfiles", "PIN", "Vence proveedor", "Costo", "Proveedor", "Nota"]);
    assert.ok(rows.some((r) => r[0] === "Netflix Premium HD 4K" && r[3] === "5"), JSON.stringify(rows.slice(0, 8)));
    assert.ok(rows.some((r) => r[0] === "Netflix completa (alquiler revendedores)" && r[3] === "completa"));
    // La plantilla tal cual se puede subir: sus ejemplos entran en la vista previa.
    const asIs = await call("POST", "/api/admin/import/stock", { contentBase64: tbuf.toString("base64") }, ck);
    assert.equal(asIs.status, 200, JSON.stringify(asIs.json));
    assert.equal(asIs.json.summary.errores, 0, JSON.stringify(asIs.json.rows.filter((x) => x.status === "error")));

    // Un Excel con filas buenas y malas.
    const v = dmy(Date.now() + 30 * DAY);
    const file = writeXlsx([{ name: "Cuentas", rows: [
      ["Producto", "Correo", "Contraseña", "Perfiles", "PIN", "Vence proveedor", "Costo", "Proveedor", "Nota", "Costo US$"],
      ["Netflix Premium HD 4K", "nf1@ficticio.lat", "Clave#1", 5, 1234, v, 60, "Proveedor Andes", "lote nuevo", ""],
      ["Netflix completa (alquiler revendedores)", "nfc@ficticio.lat", "Clave#2", "completa", "", v, 60, "", "", ""],
      ["HBO Max", "hbo1@ficticio.lat", "Clave#3", "Ana, Beto, Caro", "", v, "", "Proveedor Nuevo", "", ""],
      ["Disney+ con ESPN", "dis1@ficticio.lat", "Clave#4", "", "", v, 45, "", "", ""],
      ["Prime", "pv1@ficticio.lat", "Clave#5", 6, "", v, "", "", "", "3,5"],
      ["Disney", "dis2@ficticio.lat", "Clave#6", 7, "", v, 45, "", "", ""],
      ["Spotify", "sp@ficticio.lat", "Clave#7", 1, "", v, 10, "", "", ""],
      ["Netflix Premium HD 4K", "ya.cargada@ficticio.lat", "Clave#8", 5, "", v, 60, "", "", ""],
      ["Netflix Premium HD 4K", "nf1@ficticio.lat", "Clave#9", 5, "", v, 60, "", "", ""],
      ["HBO Max", "hbo2@ficticio.lat", "Clave#10", 5, "", "31/02/2027", 35, "", "", ""],
      ["HBO Max", "hbo3@ficticio.lat", "Clave#11", 5, "", "", 35, "", "", ""],
      ["HBO Max", "hbo4@ficticio.lat", "", 5, "", v, 35, "", "", ""],
      ["HBO Max", "hbo5@ficticio.lat", "Clave#12", 30, "", v, 35, "", "", ""],
    ] }]);
    const accBefore = Object.keys(e.s.accounts).length;
    const pv = await call("POST", "/api/admin/import/stock", { contentBase64: file.toString("base64") }, ck);
    assert.equal(pv.status, 200, JSON.stringify(pv.json));
    assert.equal(pv.json.dryRun, true);
    assert.equal(Object.keys(e.s.accounts).length, accBefore, "la vista previa no guarda nada");
    const byRow = Object.fromEntries(pv.json.rows.map((x) => [x.row, x]));
    assert.equal(pv.json.summary.ok, 5, JSON.stringify(pv.json.rows));
    assert.equal(byRow[2].profiles, 5); assert.equal(byRow[3].profiles, 1); assert.equal(byRow[4].profiles, 3);
    assert.equal(byRow[5].profiles, 7, "vacío = lo de siempre (Disney 7)");
    assert.equal(byRow[6].product, "Amazon Prime Video", "«Prime» encuentra el único que coincide");
    assert.match(byRow[7].error, /puede ser: .*Disney\+ con ESPN.*Disney\+ sin ESPN|puede ser: .*Disney\+ sin ESPN.*Disney\+ con ESPN/);
    assert.match(byRow[8].error, /No existe el producto «Spotify»/);
    assert.match(byRow[9].error, /ya está cargada/);
    assert.match(byRow[10].error, /ya está cargada/, "repetida dentro del mismo archivo");
    assert.match(byRow[11].error, /Fecha del proveedor inválida/);
    assert.match(byRow[12].error, /Falta «Vence proveedor»/);
    assert.match(byRow[13].error, /Falta la contraseña/);
    assert.match(byRow[14].error, /de 1 a 20/);
    assert.ok(byRow[4].warnings.some((w) => /Sin costo/.test(w)));
    assert.deepEqual(pv.json.byProduct["Netflix Premium HD 4K"], { cuentas: 1, perfiles: 5 });

    // Un vendedor (Atención) no puede.
    await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" }, ck);
    const ck2 = (await call("POST", "/api/auth/staff/login", { username: "lucia", password: "clave-de-lucia-123" })).r.headers.get("set-cookie").split(";")[0];
    assert.equal((await call("POST", "/api/admin/import/stock", { contentBase64: file.toString("base64") }, ck2)).status, 403);

    // Cargar de verdad: solo las 5 buenas; perfiles libres con sus nombres y PIN; proveedor nuevo creado.
    const go = await call("POST", "/api/admin/import/stock", { contentBase64: file.toString("base64"), dryRun: false }, ck);
    assert.equal(go.json.summary.ok, 5);
    assert.equal(Object.keys(e.s.accounts).length, accBefore + 5);
    const acc = (email) => Object.values(e.s.accounts).find((a) => a.email === email);
    const slots = (email) => Object.values(e.s.slots).filter((x) => x.accountId === acc(email).id);
    assert.deepEqual(slots("nf1@ficticio.lat").map((x) => [x.label, x.pin, x.status]), [1, 2, 3, 4, 5].map((n) => [`Perfil ${n}`, "1234", "available"]));
    assert.deepEqual(slots("nfc@ficticio.lat").map((x) => x.label), ["Cuenta completa"]);
    assert.deepEqual(slots("hbo1@ficticio.lat").map((x) => x.label), ["Ana", "Beto", "Caro"]);
    assert.equal(e.s.suppliers[acc("hbo1@ficticio.lat").supplierId].name, "Proveedor Nuevo");
    assert.equal(acc("nf1@ficticio.lat").cost, 6000); assert.equal(acc("nf1@ficticio.lat").notes, "lote nuevo");
    assert.equal(acc("pv1@ficticio.lat").costUsd, 350);
    assert.equal(dmy(acc("nf1@ficticio.lat").supplierExpiresAt), v);
    assert.ok(e.s.audit.some((x) => x.action === "import.stock" && x.data?.ok === 5));
    // Subir el mismo archivo otra vez no duplica nada.
    const again = await call("POST", "/api/admin/import/stock", { contentBase64: file.toString("base64"), dryRun: false }, ck);
    assert.equal(again.json.summary.ok, 0);

    if (chromium) {
      const shots = process.env.IS_SHOTS;
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1, acceptDownloads: true });
        const [n, val] = ck.split("="); await ctx.addCookies([{ name: n, value: val, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
        await p.goto(base + "/panel.html#excel"); await p.reload();
        const card = p.locator("#stockImport"); await card.waitFor();
        const [dl] = await Promise.all([p.waitForEvent("download"), card.getByText("Descargar plantilla de cuentas").click()]);
        assert.match(dl.suggestedFilename(), /plantilla-cuentas\.xlsx/);
        const f2 = writeXlsx([{ name: "Cuentas", rows: [["Producto", "Correo", "Contraseña", "Perfiles", "PIN", "Vence proveedor", "Costo", "Proveedor"],
          ["Netflix Premium HD 4K", "nf9@ficticio.lat", "Clave#9", 5, "", v, 60, ""], ["HBO Max", "hbo9@ficticio.lat", "Clave#9", "completa", "", v, 35, ""], ["Spotify", "x@ficticio.lat", "Clave", 1, "", v, 1, ""]] }]);
        const fp = join(dir, "mis-cuentas.xlsx"); writeFileSync(fp, f2);
        await p.locator('#importStockForm input[type="file"]').setInputFiles(fp);
        await p.locator("#importStockForm button[type=submit]").click();
        const goBtn = p.locator("[data-importstockgo]"); await goBtn.waitFor();
        assert.match(await goBtn.innerText(), /Cargar 2 cuentas \(6 perfiles\)/);
        assert.match(await card.innerText(), /1 con error[\s\S]*No existe el producto «Spotify»/);
        if (shots) await card.screenshot({ path: `${shots}/vista-previa.png` });
        assert.ok((await goBtn.boundingBox()).height >= 44);
        await goBtn.click();
        await card.getByText(/Listo: 2 cuentas con 6 perfiles libres/).waitFor();
        assert.ok(acc("nf9@ficticio.lat") && acc("hbo9@ficticio.lat"));
        // Atajo desde Inventario.
        await p.goto(base + "/panel.html#inventario"); await p.reload();
        const sc = p.locator('[data-go="excel"]').filter({ hasText: /Cargar desde Excel/ }).first();
        if (await sc.count()) { await sc.click(); await p.locator("#stockImport").waitFor(); }
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errs, []);
        await ctx.close();
      } finally { await b.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
