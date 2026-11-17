// 📬 Correos que faltan conectar (17/11/2026). El dueño: «decime qué correos faltan añadir en las cuentas madres» para
// que lleguen los códigos. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { motherOf } from "../dist/store/codes.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("correo madre: lo de antes del + y, en Gmail, sin puntos", () => {
  assert.equal(motherOf("NetGB117+Liz@gmail.com"), "netgb117@gmail.com");
  assert.equal(motherOf("net.scz.106+nu1@gmail.com"), "netscz106@gmail.com");
  assert.equal(motherOf("ana.b+x@googlemail.com"), "anab@gmail.com");
  assert.equal(motherOf("jg.prim+2@ves.ink"), "jg.prim@ves.ink", "fuera de Gmail los puntos cuentan");
  assert.equal(motherOf("usuario-iptv"), "");
});

test("📬 correos que faltan conectar: conectado, con error, por reenvío y faltante; sin contraseñas", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-madre-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 7000, published: true });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix Premium HD 4K", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  const add = (email, pid = "dis") => s.inventory.addAccount(owner, { productId: pid, supplierId: "p", email, password: "Clave#1", supplierExpiresAt: Date.now() + 30 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] }).account.id;
  add("netgb117+liz@ficticio-gmail.test".replace("ficticio-gmail.test", "gmail.com")); add("netgb117+efp@gmail.com");
  add("net.scz.106+1@gmail.com"); add("netscz106+nu1@gmail.com", "nf"); add("netscz106+nu2@gmail.com");
  add("opajg12+x@gmail.com");
  add("gabito6626+a@gmail.com");
  const cli = s.catalog.createCustomer(owner, { name: "Cliente Ficticio", phone: "+59170000009", kind: "customer" });
  s.orders.create(owner, { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: "v1" });
  e.s.mailboxes = {
    mb1: { id: "mb1", address: "netgb117@gmail.com", host: "imap.gmail.com", authorizedBy: owner.id, authorizedAt: Date.now(), subjectAllowlist: ["código"], kind: "gmail", lastOkAt: Date.now() },
    mb2: { id: "mb2", address: "gabito6626@gmail.com", host: "imap.gmail.com", authorizedBy: owner.id, authorizedAt: Date.now(), subjectAllowlist: ["código"], kind: "gmail", lastError: "Contraseña de aplicación incorrecta" },
  };
  e.s.codes = [{ id: "cod1", mailboxId: "mb1", to: "opajg12+x@gmail.com", subject: "Tu código", code: "123456", kind: "login", receivedAt: Date.now() - DAY }];
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, text: await r.text() }; };
  const login = async (u, pw) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) })).headers.get("set-cookie").split(";")[0];
  try {
    const ck = await login("gabriel", "clave-del-dueño-123");
    const r = await call("/api/admin/mailboxes/coverage", ck);
    assert.equal(r.status, 200, r.text);
    assert.doesNotMatch(r.text, /password|Clave#1|appPassword/i, "nunca contraseñas");
    const c = JSON.parse(r.text);
    const by = Object.fromEntries(c.rows.map((x) => [x.mother, x]));
    assert.equal(by["netscz106@gmail.com"].state, "missing"); assert.equal(by["netscz106@gmail.com"].accounts, 3, "con y sin puntos, mismo madre");
    assert.equal(by["netscz106@gmail.com"].inUse, 1);
    assert.equal(by["gabito6626@gmail.com"].state, "error"); assert.match(by["gabito6626@gmail.com"].error, /incorrecta/);
    assert.equal(by["opajg12@gmail.com"].state, "forwarded");
    assert.equal(by["netgb117@gmail.com"].state, "ok"); assert.equal(by["netgb117@gmail.com"].accounts, 2);
    assert.deepEqual(c.counts, { missing: 1, error: 1, forwarded: 1, ok: 1 });
    assert.equal(c.rows[0].mother, "netscz106@gmail.com", "primero lo que falta");
    // Admin sí; Atención no.
    await fetch(base + "/api/admin/staff", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ username: "adm", name: "Admin", role: "admin", password: "clave-del-admin-123" }) });
    await fetch(base + "/api/admin/staff", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" }) });
    const cka = await login("adm", "clave-del-admin-123"), cks = await login("lucia", "clave-de-lucia-123");
    assert.equal((await call("/api/admin/mailboxes/coverage", cka)).status, 200);
    assert.equal((await call("/api/admin/mailboxes/coverage", cks)).status, 403);
    assert.equal((await call("/api/admin/mailboxes", cka)).status, 403, "la lista de buzones con su configuración sigue siendo del dueño");

    if (chromium) {
      const shots = process.env.CM_SHOTS;
      const b = await chromium.launch();
      try {
        for (const [who, cookie] of [["dueño", ck], ["admin", cka]]) {
          const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1 });
          const [n, v] = cookie.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
          const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
          await p.goto(base + "/panel.html#codigos"); await p.reload();
          const card = p.locator("#covCard"); await card.waitFor();
          const t = await card.innerText();
          assert.match(t, /1 falta conectar[\s\S]*netscz106@gmail\.com[\s\S]*3 cuentas · 1 en uso[\s\S]*Falta conectar/);
          assert.match(t, /gabito6626@gmail\.com[\s\S]*Conectado con error/);
          assert.doesNotMatch(await card.locator(".covlist").innerText(), /netgb117@gmail\.com/, "de entrada solo lo que falta");
          if (shots && who === "dueño") await card.screenshot({ path: `${shots}/correos-madre.png` });
          await card.locator("[data-covall]").click();
          await p.locator("#covCard").getByText("netgb117@gmail.com").waitFor();
          assert.match(await p.locator("#covCard").innerText(), /opajg12@gmail\.com[\s\S]*Llegan por reenvío/);
          assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          assert.deepEqual(errs, []);
          await ctx.close();
        }
      } finally { await b.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
