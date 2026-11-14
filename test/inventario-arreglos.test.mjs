// Arreglos de INVENTARIO (14/11/2026), pedidos por el dueño después de revisar sus cuentas desde el celular:
//  1. «Vence con el proveedor» y «Costo» a la vista y obligatorios en la carga rápida (30 días ya puestos); el
//     servidor ya no inventa 100 años si una cuenta nueva llega sin fecha; las cuentas viejas sin fecha siguen igual;
//  2. «Editar» muestra solo la contraseña de ESA cuenta y se vuelve a tapar al salir;
//  3. la tarjeta de la cuenta muestra su costo (y por perfil);
//  4. «Mover todos a otra cuenta» dice cuándo vence con el proveedor cada cuenta destino;
//  5. los desplegables de la tarjeta miden 44 px o más.
// Datos ficticios, carpetas temporales (gs-equipoC-), sin nada real.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const OWNER = { id: "u_owner", role: "owner" };

describe("inventario: arreglos del dueño", () => {
  let dir, app, base, owner, seller, accA, accB, accC;
  const login = async (u, p) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) })).headers.get("set-cookie").split(";")[0];
  const call = async (path, ck = owner, method = "GET", body) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j }; };
  const P5 = [1, 2, 3, 4, 5].map((k) => ({ label: `Perfil ${k}` }));

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-equipoC-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = await login("gabriel", "clave-del-dueño-123");
    await call("/api/admin/staff", owner, "POST", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    seller = await login("lucia", "clave-de-lucia-123");
    await call("/api/admin/products", owner, "POST", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await call("/api/admin/suppliers", owner, "POST", { id: "andes", name: "Andes", active: true });
    accA = (await call("/api/admin/accounts", owner, "POST", { productId: "netflix", supplierId: "andes", email: "cuenta.a@ejemplo.lat", password: "Secreta-A#11", supplierExpiresAt: Date.now() + 20 * DAY, cost: 4000, profiles: P5.map((p, i) => ({ ...p, pin: i === 0 ? "1111" : undefined })) })).json.account;
    accB = (await call("/api/admin/accounts", owner, "POST", { productId: "netflix", supplierId: "andes", email: "cuenta.b@ejemplo.lat", password: "Secreta-B#22", supplierExpiresAt: Date.now() + 45 * DAY, cost: 3500, profiles: P5 })).json.account;
    accC = (await call("/api/admin/accounts", owner, "POST", { productId: "netflix", email: "propia.c@ejemplo.lat", password: "Secreta-C#33", supplierExpiresAt: Date.now() + 10 * DAY, cost: 0, profiles: P5 })).json.account;
    // Una cuenta vieja «sin fecha» (las que se cargaban antes quedaban a 100 años): se simula como el flujo «propias».
    await call(`/api/admin/accounts/${accC.id}`, owner, "POST", { supplierExpiresAt: Date.now() + 36500 * DAY });
    // Clientes en la cuenta A (para «Mover todos»).
    const cli = (await call("/api/admin/customers", owner, "POST", { name: "Ana Prueba", phone: "+59170000011" })).json;
    // Elegidos a mano en A (desde el 14/11 la venta automática elige una cuenta que alcance los 30 días del cliente, y A dura 20).
    const enA = Object.values(app.store.engine.s.slots).filter((x) => x.accountId === accA.id).map((x) => x.id).slice(0, 2);
    app.store.orders.create(OWNER, { customerId: cli.id, items: [{ productId: "netflix", qty: 2 }], paymentMethod: "cash", preferredSlotIds: enA });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("1 · una cuenta nueva sin «Vence con el proveedor» es un error claro (no 100 años); con fecha entra", async () => {
    const body = { productId: "netflix", supplierId: "andes", email: "nueva@ejemplo.lat", password: "Clave#1", cost: 3000, profiles: P5 };
    for (const exp of [undefined, null, 0, "x"]) {
      const r = await call("/api/admin/accounts", owner, "POST", { ...body, supplierExpiresAt: exp });
      assert.equal(r.status, 400, `sin fecha (${exp}) no entra`);
      assert.match(r.json.error?.message ?? r.json.message ?? JSON.stringify(r.json), /vence la cuenta con el proveedor/);
    }
    assert.ok(!app.store.engine.s.accounts[Object.keys(app.store.engine.s.accounts).find((id) => app.store.engine.s.accounts[id].email === "nueva@ejemplo.lat")], "no quedó cargada");
    const bulk = await call("/api/admin/accounts/bulk", owner, "POST", { rows: [{ ...body, email: "lista@ejemplo.lat" }] });
    assert.equal(bulk.json[0].ok, false); assert.match(bulk.json[0].error, /vence la cuenta con el proveedor/);
    const ok = await call("/api/admin/accounts", owner, "POST", { ...body, supplierExpiresAt: Date.now() + 30 * DAY });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.account.supplierExpiresAt < Date.now() + 31 * DAY, "la fecha que se mandó, no 100 años");
    assert.equal((await call("/api/admin/accounts", owner, "POST", { ...body, email: "sin-costo@ejemplo.lat", cost: undefined, supplierExpiresAt: Date.now() + 30 * DAY })).status, 400, "el costo también es obligatorio");
  });

  test("1 · las cuentas viejas sin fecha siguen igual: se editan, se listan y se venden", async () => {
    const r = await call(`/api/admin/accounts/${accC.id}`, owner, "POST", { notes: "autopago" });
    assert.equal(r.status, 200);
    const c = (await call("/api/admin/accounts")).json.find((a) => a.id === accC.id);
    assert.ok(c.supplierExpiresAt > Date.now() + 365 * DAY, "su fecha lejana no se tocó");
    assert.equal(c.notes, "autopago");
    assert.ok(app.store.inventory.stock().netflix.available >= 5, "sus perfiles siguen a la venta");
  });

  test("2 · «Editar» lee la contraseña y los PIN de UNA cuenta; queda en la auditoría; la lista sigue tapada", async () => {
    const r = await call(`/api/admin/accounts/${accA.id}/secret`);
    assert.equal(r.status, 200);
    assert.equal(r.json.password, "Secreta-A#11");
    const slotsA = Object.values(app.store.engine.s.slots).filter((s) => s.accountId === accA.id).map((s) => s.id).sort();
    assert.deepEqual(Object.keys(r.json.pins).sort(), slotsA, "solo los PIN de esa cuenta");
    assert.ok(Object.values(r.json.pins).includes("1111"));
    assert.ok(!JSON.stringify(r.json).includes("Secreta-B#22"), "nada de las otras cuentas");
    const aud = app.store.engine.s.audit.filter((x) => x.action === "secrets.view").at(-1);
    assert.equal(aud.entityId, accA.id, "la auditoría dice qué cuenta");
    const list = (await call("/api/admin/accounts")).json;
    assert.ok(list.every((a) => a.password === "••••••" || a.password === "(pendiente)"), "la lista sigue tapada");
    assert.equal((await call(`/api/admin/accounts/${accA.id}/secret`, seller)).status, 403, "Atención no ve claves");
    assert.equal((await call(`/api/admin/accounts/${accA.id}/secret`, null)).status, 401);
    assert.equal((await call(`/api/admin/accounts/no-existe/secret`)).status, 404);
  });

  test("3 · la lista trae el costo para la tarjeta (solo dueño/admin)", async () => {
    const a = (await call("/api/admin/accounts")).json.find((x) => x.id === accA.id);
    assert.equal(a.cost, 4000);
    assert.equal((await call("/api/admin/accounts", seller)).status, 403, "Atención no ve cuentas ni costos");
  });

  test("pantallas a 360 px: carga rápida, tarjeta con costo, Editar tapa al salir, Mover todos con fecha y desplegables de 44 px", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        const open = async (v) => { await p.goto(base + "/panel.html#" + v); await p.reload(); };
        await p.goto(base + "/panel.html#carga");
        await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
        await p.waitForSelector("#quickForm");
        // 1) Carga rápida: fecha y costo a la vista, obligatorios, con 30 días ya puestos.
        const q = await p.evaluate(() => {
          const f = document.querySelector("#quickForm");
          const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && !el.closest("details:not([open])");
          const d = new Date(Date.now() + 30 * 864e5);
          return { expVis: vis(f.exp), costVis: vis(f.cost), expReq: f.exp.required, costReq: f.cost.required, exp: f.exp.value,
            want: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
            opcional: [...f.querySelectorAll("summary")].map((s) => s.textContent).join(" "),
            over: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        assert.deepEqual([q.expVis, q.costVis, q.expReq, q.costReq, q.exp, q.over], [true, true, true, true, q.want, false], `${scheme}: carga rápida`);
        assert.ok(!/opcional/i.test(q.opcional), "ya no está escondido en «opcional»");
        // Sin costo: el navegador no deja mandar (campo obligatorio) y no se carga nada.
        const n0 = Object.keys(app.store.engine.s.accounts).length;
        await p.fill("#quickForm input[name=email]", `rapida-${scheme}@ejemplo.lat`); await p.fill("#quickForm input[name=password]", "Clave#Rapida1");
        await p.fill("#quickForm input[name=cost]", "");
        await p.click("#quickForm button[type=submit]");
        await p.waitForTimeout(300);
        assert.equal(Object.keys(app.store.engine.s.accounts).length, n0, "sin costo no se carga");
        assert.equal(await p.evaluate(() => document.querySelector("#quickForm input[name=cost]").validity.valueMissing), true);
        await p.fill("#quickForm input[name=cost]", "35");
        await p.click("#quickForm button[type=submit]");
        await p.waitForFunction((n) => true, n0);
        await p.waitForTimeout(800);
        const nueva = Object.values(app.store.engine.s.accounts).find((a) => a.email === `rapida-${scheme}@ejemplo.lat`);
        assert.ok(nueva, `${scheme}: se cargó`);
        assert.equal(nueva.cost, 3500);
        assert.ok(Math.abs(nueva.supplierExpiresAt - (Date.now() + 30 * DAY)) < 2 * DAY, "con los 30 días por defecto");

        // 3) y 5) Cuentas: costo en la tarjeta, todo tapado, desplegables de 44 px.
        await open("cuentas");
        await p.waitForSelector(".acard");
        await p.evaluate(() => { for (const d of document.querySelectorAll("details.pgrp")) d.open = true; });
        const c = await p.evaluate(() => ({
          text: document.body.innerText,
          costA: [...document.querySelectorAll(".acard")].find((x) => x.textContent.includes("cuenta.a@ejemplo.lat"))?.querySelector(".acost")?.textContent ?? "",
          sums: [...document.querySelectorAll(".acard details.more > summary")].map((s) => s.getBoundingClientRect().height).filter((h) => h > 0),
          over: document.documentElement.scrollWidth > innerWidth + 1,
        }));
        assert.match(c.costA, /Bs 40 por mes · Bs 8 por perfil/, `${scheme}: costo y costo por perfil a la vista`);
        assert.ok(!/Secreta-[ABC]#/.test(c.text), "ninguna contraseña a la vista");
        assert.ok(c.sums.length >= 2 && c.sums.every((h) => h >= 44), `${scheme}: desplegables ≥ 44 px (${c.sums})`);
        assert.equal(c.over, false, `${scheme}: sin desborde`);
        // 4) Mover todos: cada destino dice cuándo vence con el proveedor.
        const opts = await p.evaluate(() => [...document.querySelectorAll("form[data-moveall] select[name=to] option")].map((o) => o.textContent).filter((t) => t.includes("@")));
        assert.ok(opts.length >= 1, "hay cuentas destino");
        assert.ok(opts.some((t) => /cuenta\.b@ejemplo\.lat · 5 libres · vence \d{2}\/\d{2}\/\d{4}/.test(t)), `${scheme}: fecha del proveedor (${opts})`);
        assert.ok(opts.some((t) => /propia\.c@ejemplo\.lat .* sin fecha del proveedor/.test(t)), "la vieja sin fecha lo dice");
        // 2) Editar A: solo su contraseña; Cancelar la vuelve a tapar.
        await p.evaluate((id) => document.querySelector(`[data-editaccopen="${id}"]`).click(), accA.id);
        await p.waitForSelector(".editsecret");
        const e1 = await p.evaluate(() => document.body.innerText);
        assert.ok(e1.includes("Secreta-A#11"), "se ve la de A");
        assert.ok(!/Secreta-[BC]#/.test(e1), "no se destapan las otras");
        assert.equal((e1.match(/Secreta-A#11/g) ?? []).length, 1, "solo una vez (en Editar), no en las tarjetas");
        assert.equal(await p.inputValue(`form[data-editacc] input[name^="pin-"] >> nth=0`), "1111", "trae el PIN de esa cuenta");
        await p.click('form[data-editacc] [data-editaccopen=""]');
        await p.waitForFunction(() => !document.querySelector(".editsecret"));
        assert.ok(!/Secreta-[ABC]#/.test(await p.evaluate(() => document.body.innerText)), "al salir de Editar se tapa");
        // Volver a abrir Editar e irse a otra pantalla: al volver, tapada.
        await p.evaluate((id) => document.querySelector(`[data-editaccopen="${id}"]`).click(), accA.id);
        await p.waitForSelector(".editsecret");
        await p.evaluate(() => document.querySelector('[data-go="carga"]')?.click());
        await p.waitForSelector("#quickForm");
        await p.evaluate(() => document.querySelector('[data-go="cuentas"]')?.click());
        await p.waitForSelector(".acard");
        assert.ok(!/Secreta-[ABC]#/.test(await p.evaluate(() => document.body.innerText)), "al volver a Cuentas sigue tapada");
        assert.deepEqual(errs, [], `${scheme}: sin errores de consola`);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
