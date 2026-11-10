// Cupones propios del revendedor: solo si el dueño lo permite, solo en su página y sin filtrar los códigos.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const owner = { id: "u_owner", role: "owner" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "dp", name: "Disney+", kind: "profile", durationDays: 30, price: 2000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, dp: 1500 } });
  const mk = (name, phone, slug) => {
    const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
    s.shops.setupFor(owner, c.id, { slug, title: name, enabled: true });
    const a = { id: "u_" + c.id, role: "reseller", customerId: c.id };
    s.portal.setPrices(a, { nf: 4000, dp: 3000 });
    return a;
  };
  const rosa = mk("Rosa TV", "+59171111111", "rosa-tv"), juan = mk("Juan Play", "+59172222222", "juan-play");
  return { s, clock, rosa, juan };
}
const cart = [{ productId: "nf", qty: 1 }, { productId: "dp", qty: 1 }];

describe("cupones de revendedores (núcleo)", () => {
  test("sin permiso del dueño no se crean; con permiso sí", () => {
    const { s, rosa } = setup();
    assert.equal(s.shops.myCoupons(rosa).allowed, false);
    assert.throws(() => s.shops.saveCoupon(rosa, { code: "ROSA10", type: "percent", value: 10 }), err("FORBIDDEN", /no habilitó/));
    assert.throws(() => s.shops.setCouponsAllowed(rosa, true), err("FORBIDDEN"), "un revendedor no se lo habilita solo");
    s.shops.setCouponsAllowed(owner, true);
    const c = s.shops.saveCoupon(rosa, { code: "rosa10", type: "percent", value: 10 });
    assert.equal(c.code, "ROSA10");
    assert.deepEqual(s.shops.myCoupons(rosa).coupons.map((x) => x.code), ["ROSA10"]);
    assert.ok(s.engine.s.audit.some((a) => a.action === "reseller.coupon_create"));
  });

  test("el cupón calcula con SUS precios y solo vale en SU página", () => {
    const { s, rosa } = setup();
    s.shops.setCouponsAllowed(owner, true);
    s.shops.saveCoupon(rosa, { code: "ROSA10", type: "percent", value: 10 });
    const q = s.shops.quoteCoupon("rosa-tv", "rosa10", cart);
    assert.deepEqual(q, { code: "ROSA10", amount: 700, gross: 7000, discount: 0, total: 6300 });
    assert.throws(() => s.shops.quoteCoupon("juan-play", "ROSA10", cart), err("VALIDATION", /no existe/), "no sirve en otra página");
  });

  test("los códigos no salen en los datos públicos de la página", () => {
    const { s, rosa } = setup();
    s.shops.setCouponsAllowed(owner, true);
    s.shops.saveCoupon(rosa, { code: "SECRETO50", type: "percent", value: 50 });
    const pub = JSON.stringify(s.shops.public("rosa-tv"));
    assert.ok(!pub.includes("SECRETO50"));
    assert.ok(!pub.includes("coupons"));
  });

  test("vencido, pausado, compra mínima, productos y si el dueño lo apaga", () => {
    const { s, clock, rosa } = setup();
    s.shops.setCouponsAllowed(owner, true);
    s.shops.saveCoupon(rosa, { code: "VENCE", type: "fixed", value: 500, expiresAt: T0 + DAY });
    const p = s.shops.saveCoupon(rosa, { code: "PAUSA", type: "fixed", value: 500 });
    s.shops.saveCoupon(rosa, { ...p, active: false });
    s.shops.saveCoupon(rosa, { code: "MIN", type: "fixed", value: 500, minTotal: 9000 });
    s.shops.saveCoupon(rosa, { code: "DISNEY", type: "percent", value: 50, productIds: ["dp"] });
    assert.equal(s.shops.quoteCoupon("rosa-tv", "DISNEY", cart).amount, 1500, "solo sobre Disney+");
    assert.throws(() => s.shops.quoteCoupon("rosa-tv", "PAUSA", cart), err("VALIDATION"));
    assert.throws(() => s.shops.quoteCoupon("rosa-tv", "MIN", cart), err("VALIDATION", /mínima/));
    s.shops.setCouponsAllowed(owner, false);
    assert.throws(() => s.shops.quoteCoupon("rosa-tv", "DISNEY", cart), err("VALIDATION"), "apagado por el dueño, deja de valer");
    s.shops.setCouponsAllowed(owner, true);
    clock.t += 2 * DAY;
    assert.throws(() => s.shops.quoteCoupon("rosa-tv", "VENCE", cart), err("VALIDATION", /venció/));
  });

  test("se suma al Armá tu combo de su página y deja algo a pagar", () => {
    const { s, rosa } = setup();
    s.shops.setCouponsAllowed(owner, true);
    s.shops.update(rosa, { comboDiscounts: [1000, 1500, 2000] });
    s.shops.saveCoupon(rosa, { code: "TODO", type: "fixed", value: 999999 });
    const q = s.shops.quoteCoupon("rosa-tv", "TODO", cart);
    assert.equal(q.discount, 1000);
    assert.equal(q.total, 100);
  });

  test("solo productos con su precio; códigos únicos en su lista; borrar", () => {
    const { s, rosa, juan } = setup();
    s.shops.setCouponsAllowed(owner, true);
    assert.throws(() => s.shops.saveCoupon(rosa, { code: "X1X", type: "percent", value: 10, productIds: ["otro"] }), err("VALIDATION"));
    const c = s.shops.saveCoupon(rosa, { code: "HOLA", type: "percent", value: 10 });
    assert.throws(() => s.shops.saveCoupon(rosa, { code: "HOLA", type: "percent", value: 20 }), err("VALIDATION", /Ya tenés/));
    assert.equal(s.shops.saveCoupon(juan, { code: "HOLA", type: "percent", value: 20 }).code, "HOLA", "otro revendedor puede usar el mismo código");
    assert.throws(() => s.shops.deleteCoupon(juan, c.id), err("NOT_FOUND"), "no borra cupones ajenos");
    assert.deepEqual(s.shops.deleteCoupon(rosa, c.id), { ok: true });
  });
});

describe("cupones de revendedores (API)", () => {
  let dir, app, base;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-rcup-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const s = app.store;
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
    const c = s.catalog.createCustomer(owner, { name: "Rosa", phone: "+59171111111", kind: "reseller", priceGroupId: "rev" });
    s.shops.setupFor(owner, c.id, { slug: "rosa-tv", title: "Rosa", enabled: true });
    const a = { id: "u_" + c.id, role: "reseller", customerId: c.id };
    s.portal.setPrices(a, { nf: 4000 });
    s.shops.setCouponsAllowed(owner, true);
    s.shops.saveCoupon(a, { code: "ROSA10", type: "percent", value: 10 });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("presupuesto público y límite de intentos", async () => {
    const r = await post("/api/shops/rosa-tv/coupon", { code: "rosa10", items: [{ productId: "nf", qty: 1 }] });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).total, 3600);
    assert.equal((await post("/api/shops/rosa-tv/coupon", { code: "NADA", items: [{ productId: "nf", qty: 1 }] })).status, 400);
    let last = 0;
    for (let i = 0; i < 35; i++) last = (await post("/api/shops/rosa-tv/coupon", { code: "NADA" + i, items: [{ productId: "nf", qty: 1 }] })).status;
    assert.equal(last, 429, "no se pueden probar códigos sin fin");
  });
});
