// Pulido del panel del dueño: los números cuadran entre pantallas.
// Dashboard, Control, Inicio y la Ficha del revendedor usan lo que de verdad te pagan
// (precio acordado ?? lista del revendedor ?? precio del producto); Finanzas estima el costo
// de las cuentas que no anotaste; Proveedores compara ingreso y costo del mismo período.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const T0 = Date.UTC(2026, 10, 11, 16, 0, 0); // 11/11/2026 12:00 en Bolivia
const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;

/** Tienda con: Netflix 35 (revendedor 25), Gemini 25 (revendedor 18), combo 50; Ari revendedora con 2 clientes. */
function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "gemini", name: "Gemini", kind: "invite", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "duo", name: "Combo Netflix + Gemini", kind: "combo", durationDays: 30, price: 5000, published: true, comboProductIds: ["netflix", "gemini"] });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, gemini: 1800, duo: 4000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.catalog.upsertSupplier(owner, { id: "sur", name: "Sur", active: true });
  const nf = s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 60 * DAY, cost: 4000, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }, { label: "P4" }] });
  const gm = s.inventory.addAccount(admin, { productId: "gemini", supplierId: "sur", email: "gm1@x.lat", password: "Clave-Larga#2", supplierExpiresAt: T0 + 60 * DAY, cost: 3000, profiles: [{ label: "G1" }, { label: "G2" }, { label: "G3" }] });
  const ari = s.catalog.createCustomer(admin, { name: "Ariana Flores", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
  const asAri = { id: "r_ari", role: "reseller", customerId: ari.id };
  const noe = s.catalog.createCustomer(asAri, { name: "Noelia Quispe", phone: "+59170000001" });
  const jhon = s.catalog.createCustomer(asAri, { name: "Jhon Vargas", phone: "+59170000002" });
  const carla = s.catalog.createCustomer(admin, { name: "Carla Final", phone: "+59170011223" });
  s.wallet.adjust(owner, ari.id, 50000, "Recarga de prueba");
  return { s, clock, nf, gm, ari, asAri, noe, jhon, carla };
}

/** Ventas: Ari compra Netflix para Noelia y el combo para Jhon (con su saldo), y Gabriel le vende Netflix a Carla en efectivo. */
function withSales() {
  const x = setup();
  const { s, asAri, noe, jhon, carla } = x;
  const o1 = s.orders.create(asAri, { customerId: noe.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
  const o2 = s.orders.create(asAri, { customerId: jhon.id, items: [{ productId: "duo", qty: 1 }], paymentMethod: "balance" });
  const o3 = s.orders.create(admin, { customerId: carla.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
  return { ...x, o1, o2, o3 };
}

describe("Pulido panel · lo que vas a cobrar usa el precio de quien paga", () => {
  test("Control (listAssignments) devuelve effectivePrice, el revendedor y su teléfono", () => {
    const { s, ari, noe, carla } = withSales();
    const list = s.admin.assignments(owner);
    const byCust = (id) => list.filter((a) => a.customerId === id);
    const noeNf = byCust(noe.id)[0];
    assert.equal(noeNf.effectivePrice, 2500, "la clienta de Ari: paga Ari a precio de revendedor");
    assert.equal(noeNf.productPrice, 3500, "el precio público sigue disponible");
    assert.equal(noeNf.resellerId, ari.id);
    assert.equal(noeNf.resellerName, "Ariana Flores");
    assert.equal(noeNf.resellerPhone, "+59171234567");
    const carlaNf = byCust(carla.id)[0];
    assert.equal(carlaNf.effectivePrice, 3500, "cliente propio: precio del producto");
    assert.equal(carlaNf.resellerId, null);
  });

  test("Dashboard (ingreso mensual, por revendedor y atajos) cuadra con la Ficha y con Control", () => {
    const { s, ari } = withSales();
    const d = s.stats.dashboard(owner, 30);
    const list = s.admin.assignments(owner);
    const total = list.reduce((t, a) => t + a.effectivePrice, 0);
    // Netflix Noelia 25 + combo de Jhon (Netflix 25 + Gemini 18) + Netflix Carla 35 = 103
    assert.equal(total, 2500 + 2500 + 1800 + 3500);
    assert.equal(d.kpi.monthlyRecurring, total, "Dashboard = suma de Control");
    const fichaAri = list.filter((a) => a.resellerId === ari.id).reduce((t, a) => t + a.effectivePrice, 0);
    const rowAri = d.resellers.find((r) => r.id === ari.id);
    assert.equal(rowAri.monthly, fichaAri, "fila de Ari en el Dashboard = total de su Ficha");
    assert.equal(rowAri.monthly, 6800);
    const upSum = d.upcoming.reduce((t, x) => t + x.amount, 0);
    assert.equal(upSum, 0, "nada vence en 14 días todavía");
  });

  test("un precio acordado en Control manda sobre la lista", () => {
    const { s, noe } = withSales();
    const a = s.admin.assignments(owner).find((x) => x.customerId === noe.id);
    s.orders.setControl(owner, a.id, { price: 2000 });
    const b = s.admin.assignments(owner).find((x) => x.id === a.id);
    assert.equal(b.effectivePrice, 2000);
    assert.equal(s.stats.dashboard(owner, 30).kpi.monthlyRecurring, 2000 + 2500 + 1800 + 3500);
  });

  test("Atención (seller) recibe effectivePrice pero no el costo ni las notas de la cuenta", () => {
    const { s } = withSales();
    const a = s.admin.assignments(seller)[0];
    assert.ok(Number.isInteger(a.effectivePrice));
    assert.equal(a.accountCost, undefined);
    assert.equal(a.accountNotes, undefined);
    assert.equal(a.estCost, undefined);
    const o = s.admin.assignments(owner).find((x) => x.product === "Netflix");
    assert.equal(o.estCost, 1000, "dueño: costo estimado del perfil = 40 / 4 perfiles");
  });

  test("Ficha del revendedor por HTTP = fila del Dashboard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-ppanel-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
      const st = app.store, sys = { id: "t", role: "owner" };
      st.catalog.upsertProduct(sys, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
      st.catalog.upsertPriceGroup(sys, { id: "revendedor", name: "Revendedor", prices: { nf: 2500 } });
      st.catalog.upsertSupplier(sys, { id: "andes", name: "Andes", active: true });
      st.inventory.addAccount(sys, { productId: "nf", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 4000, profiles: [{ label: "P1" }, { label: "P2" }] });
      const ari = st.catalog.createCustomer(sys, { name: "Ariana", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
      const cli = st.catalog.createCustomer({ id: "r", role: "reseller", customerId: ari.id }, { name: "Clienta", phone: "+59170000001" });
      st.wallet.adjust(sys, ari.id, 10000, "x");
      st.orders.create({ id: "r", role: "reseller", customerId: ari.id }, { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance" });
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
      const cookie = r.headers.get("set-cookie").split(";")[0];
      const get = async (p) => (await fetch(base + p, { headers: { cookie } })).json();
      const sheet = await get(`/api/admin/resellers/${ari.id}/sheet`);
      const dash = await get("/api/admin/dashboard?days=30");
      const fichaTotal = sheet.rows.reduce((t, x) => t + x.price, 0);
      assert.equal(fichaTotal, 2500);
      assert.equal(dash.resellers.find((x) => x.id === ari.id).monthly, fichaTotal);
      assert.equal(dash.kpi.monthlyRecurring, fichaTotal);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("Pulido panel · Finanzas estima el costo de cuentas sin anotar", () => {
  test("Te quedó (estimado) = Entró − Salió − Cuentas (estimado); anotar el pago lo saca del estimado", () => {
    const { s, nf, gm } = withSales();
    const r = s.finance.report(owner, 6);
    const c = r.current;
    assert.equal(c.ingresos, 2500 + 4000 + 3500, "entró: ventas del mes");
    assert.equal(c.cuentasEstimado, 4000 + 3000, "las 2 cuentas vivas, sin anotar");
    assert.equal(c.sinAnotar, 2);
    assert.equal(c.gananciaEstimada, c.ingresos - c.gastos - c.cuentasEstimado);
    assert.equal(c.ganancia, c.ingresos - c.gastos, "la ganancia real (solo gastos anotados) no cambia");
    // Anoto lo que pagué por la cuenta de Netflix: deja de estimarse y pasa a "Salió".
    s.finance.recordAccountCost(owner, (nf.account ?? nf).id);
    const c2 = s.finance.report(owner, 6).current;
    assert.equal(c2.gastos, 4000);
    assert.equal(c2.cuentasEstimado, 3000);
    assert.equal(c2.sinAnotar, 1);
    assert.equal(c2.gananciaEstimada, c.gananciaEstimada, "no se cuenta dos veces");
    assert.ok(gm);
  });
});

describe("Pulido panel · Proveedores: mismo período", () => {
  test("ingreso de los proveedores (30 días, con combos y renovaciones) = ingresos del Dashboard", () => {
    const { s, clock, noe } = withSales();
    clock.t += 5 * DAY;
    const a = s.admin.assignments(owner).find((x) => x.customerId === noe.id);
    const ren = s.orders.renew(owner, a.id, { periods: 1, paymentMethod: "cash" });
    assert.equal(ren.order.status, "fulfilled");
    const rep = s.stats.suppliers(owner);
    const total = rep.reduce((t, x) => t + x.revenue, 0);
    const d = s.stats.dashboard(owner, 30);
    assert.equal(total, d.kpi.revenue, "la suma de los proveedores = ingresos de 30 días");
    const andes = rep.find((x) => x.supplierId === "andes"), sur = rep.find((x) => x.supplierId === "sur");
    assert.ok(sur.revenue > 0, "el combo también suma al proveedor de Gemini");
    assert.equal(andes.cost, 4000, "costo de un mes (mismo período)");
    assert.equal(andes.margin, andes.revenue - andes.cost);
    assert.equal(andes.periodDays, 30);
    // Pasados 40 días esas ventas ya no cuentan en el período.
    clock.t += 40 * DAY;
    assert.equal(s.stats.suppliers(owner).reduce((t, x) => t + x.revenue, 0), 0);
  });
});

describe("Pulido panel · 'Vencen en 7 días' igual en todas las pantallas", () => {
  test("los ya vencidos no cuentan como 'vencen en 7 días'", () => {
    const { s, clock, ari } = withSales();
    const list = s.admin.assignments(owner);
    s.orders.setExpiry(owner, list[0].id, T0 - 2 * DAY, "prueba");
    s.orders.setExpiry(owner, list[1].id, T0 + 3 * DAY, "prueba");
    const d = s.stats.dashboard(owner, 30);
    const sum = s.stats.summary(owner, { from: T0 - 30 * DAY, to: T0 + DAY });
    assert.equal(d.kpi.overdue, 1);
    assert.equal(d.kpi.due7, 1);
    assert.equal(sum.expiringIn7Days, 1, "/api/admin/stats usa el mismo criterio");
    const rowAri = d.resellers.find((r) => r.id === ari.id);
    const ariDue = s.admin.assignments(owner).filter((a) => a.resellerId === ari.id && a.customerExpiresAt >= T0 && a.customerExpiresAt - T0 <= 7 * DAY).length;
    assert.equal(rowAri.due7, ariDue);
    assert.ok(clock);
  });

  test("el gráfico por día usa la fecha de Bolivia (una venta a las 21:00 queda en ese día)", () => {
    const { s, clock, carla } = setup();
    clock.t = Date.UTC(2026, 10, 12, 1, 0, 0); // 11/11 21:00 en Bolivia = 12/11 01:00 UTC
    s.orders.create(admin, { customerId: carla.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const d = s.stats.dashboard(owner, 7);
    const local = new Date(clock.t);
    const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    assert.equal(d.series.at(-1).day, key);
    assert.equal(d.series.at(-1).sales, 3500);
    const sum = s.stats.summary(owner, { from: clock.t - DAY, to: clock.t + 1 });
    assert.equal(sum.byDay[key], 3500);
  });
});

describe("Pulido panel · avisos de precio de revendedor y revendedores dormidos", () => {
  test("producto sin precio de revendedor y producto con pérdida aparecen en Notificaciones", () => {
    const { s } = setup();
    s.catalog.upsertProduct(owner, { id: "chatgpt", name: "ChatGPT Plus", kind: "invite", durationDays: 30, price: 5000, published: true });
    s.inventory.addAccount(admin, { productId: "chatgpt", supplierId: "andes", email: "gpt@x.lat", password: "Clave-Larga#9", supplierExpiresAt: T0 + 60 * DAY, cost: 3500, profiles: [{ label: "C1" }] });
    let n = s.stats.notifications(owner).items;
    const sin = n.find((x) => x.kind === "resellerPrice");
    assert.ok(sin, "avisa que ChatGPT no tiene precio de revendedor");
    assert.match(sin.text, /ChatGPT Plus.*precio público/);
    // Le pongo un precio de revendedor menor al costo: avisa que perdés.
    s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, gemini: 1800, duo: 4000, chatgpt: 3000 } });
    n = s.stats.notifications(owner).items;
    assert.equal(n.find((x) => x.kind === "resellerPrice"), undefined);
    const loss = n.find((x) => x.kind === "resellerLoss");
    assert.ok(loss);
    assert.match(loss.text, /Perdés plata con ChatGPT Plus \(revendedor\)/);
  });

  test("revendedor sin comprar hace más de 14 días aparece como dormido", () => {
    const { s, clock, ari } = withSales();
    assert.equal(s.stats.notifications(owner).items.find((x) => x.kind === "resellerSleep"), undefined, "Ari compró recién");
    clock.t += 16 * DAY;
    const z = s.stats.notifications(owner).items.find((x) => x.kind === "resellerSleep");
    assert.ok(z);
    assert.match(z.text, /Ariana Flores no te compra/);
    const ov = s.shops.resellers(owner).find((r) => r.id === ari.id);
    assert.equal(ov.spent30, 2500 + 4000, "lo que compró en 30 días");
    assert.ok(ov.lastOrderAt <= clock.t - 16 * DAY);
  });

  test("Atención (seller) ve sus avisos sin error, pero no los de plata del dueño", () => {
    const { s, clock } = withSales();
    clock.t += 16 * DAY;
    const own = s.stats.notifications(owner).items.map((x) => x.kind);
    assert.ok(own.includes("resellerSleep"));
    const mine = s.stats.notifications(seller).items.map((x) => x.kind);
    assert.ok(mine.every((k) => ["falla", "payment", "overdue", "due", "reloc"].includes(k)), mine.join(","));
    assert.throws(() => s.stats.notifications({ id: "c", role: "customer", customerId: "x" }), err("FORBIDDEN"));
  });
});
