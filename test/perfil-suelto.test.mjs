// Perfil suelto comprado a otra persona (pedido del dueño, 16/11/2026): «➕ Compré un perfil», venderlo, «⚠️ Se cayó» con
// sus tres salidas, «Le pagué a Juan» y el resumen por vendedor del mes. Datos ficticios, carpeta temporal, nada externo.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5, T0 = Date.UTC(2026, 7, 3, 15, 0); // 03/08/2026, 11:00 en Bolivia

function mk() {
  const clock = { t: T0, now() { return this.t; } };
  const dir = mkdtempSync(join(tmpdir(), "gs-solo-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, E = s.engine, O = { id: Object.keys(E.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(O, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(O, { id: "dis", name: "Disney", kind: "profile", durationDays: 30, price: 2000, published: true });
  let n = 0;
  const cust = (name) => s.catalog.createCustomer(O, { name, phone: `+5917200${String(n++).padStart(4, "0")}`, whatsappConsent: true });
  const sellTo = (c, slotId, pid = "nf") => s.orders.create(O, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", ...(slotId ? { preferredSlotIds: [slotId] } : {}) }).assignmentIds[0];
  const buy = (x = {}) => s.perfiles.buy(O, { productId: "nf", supplierName: "Juan", amount: 1500, email: "juan.nf@ficticio.lat", password: "Clave-Juan#1", label: "Perfil 3", pin: "1234", ...x });
  return { clock, app, s, E, O, cust, sellTo, buy, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("➕ Compré un perfil", () => {
  test("un toque: alta rápida de «Juan», gasto con fecha y categoría «perfil suelto», perfil libre para vender", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const sup = t.E.s.suppliers[r.supplierId];
      assert.equal(sup.name, "Juan");
      const slot = t.E.s.slots[r.slotId];
      assert.equal(slot.status, "available");
      assert.equal(slot.loose.cost, 1500);
      assert.equal(slot.pin, "1234");
      const acc = t.E.s.accounts[r.accountId];
      assert.equal(acc.loose, true);
      assert.equal(acc.supplierId, sup.id);
      const exp = t.E.s.expenses.find((x) => x.id === r.expenseId);
      assert.equal(exp.category, "perfil");
      assert.equal(exp.amount, 1500);
      assert.equal(exp.slotId, slot.id);
      assert.equal(exp.looseKind, "compra");
      assert.match(r.text, /libre para vender/);
      // «Juan» y «juán» son el mismo vendedor: no se da de alta dos veces.
      const r2 = t.buy({ supplierName: "juán", email: "otro@ficticio.lat", label: "Perfil 1" });
      assert.equal(r2.supplierId, r.supplierId);
      assert.equal(Object.values(t.E.s.suppliers).filter((x) => /juan/i.test(x.name)).length, 1);
    } finally { await t.close(); }
  });

  test("un segundo perfil de la MISMA cuenta se agrega a esa cuenta (antes: «Esa cuenta ya está cargada»)", async () => {
    const t = mk();
    try {
      const a = t.buy();
      const b = t.buy({ label: "Perfil 4", pin: "" });
      assert.equal(b.accountId, a.accountId);
      assert.equal(b.added, true);
      assert.equal(b.profiles, 2);
      assert.equal(t.E.s.accounts[a.accountId].cost, 3000, "el costo de la cuenta es la suma de sus perfiles");
      assert.throws(() => t.buy({ label: "perfil 4" }), /ya tiene un perfil «Perfil 4»/);
      // Una cuenta entera de un proveedor no se mezcla con perfiles sueltos.
      t.s.inventory.addAccount(t.O, { productId: "nf", email: "entera@ficticio.lat", password: "x-clave-1", supplierExpiresAt: T0 + 30 * DAY, cost: 9000, profiles: [{ label: "P1" }] });
      assert.throws(() => t.buy({ email: "entera@ficticio.lat" }), /cuenta entera/);
    } finally { await t.close(); }
  });

  test("pagado en US$ con tasa; fecha del pago anotada tarde; validaciones en palabras simples", async () => {
    const t = mk();
    try {
      const r = t.buy({ currency: "USD", amount: 250, rate: 9.9, date: "2026-08-01", until: "2026-08-31" });
      const exp = t.E.s.expenses.find((x) => x.id === r.expenseId);
      assert.equal(exp.usd, 250); assert.equal(exp.rate, 9.9); assert.equal(exp.amount, 2475);
      assert.equal(new Date(exp.at - 4 * 3600e3).getUTCDate(), 1, "el gasto queda el día que pagó, no el que lo anotó");
      assert.equal(t.E.s.slots[r.slotId].loose.cost, 2475);
      assert.throws(() => t.buy({ amount: 0, email: "z@f.lat" }), /cuánto pagaste/);
      assert.throws(() => t.buy({ supplierName: "", email: "z@f.lat" }), /a quién se lo compraste/);
      assert.throws(() => t.buy({ until: "2026-07-01", email: "z@f.lat" }), /ya pasó/);
    } finally { await t.close(); }
  });

  test("permisos: un vendedor del panel o un revendedor no pueden cargar perfiles comprados", async () => {
    const t = mk();
    try {
      assert.throws(() => t.s.perfiles.buy({ id: "x", role: "seller" }, { productId: "nf", supplierName: "Juan", amount: 1500, email: "a@f.lat", password: "x" }), (e) => e.code === "FORBIDDEN");
      const r = t.s.catalog.createCustomer(t.O, { name: "Rev", phone: "+59171111111", kind: "reseller" });
      assert.throws(() => t.s.perfiles.buy({ id: "y", role: "reseller", customerId: r.id }, { productId: "nf", supplierName: "Juan", amount: 1500, email: "a@f.lat", password: "x" }), (e) => e.code === "FORBIDDEN");
    } finally { await t.close(); }
  });
});

describe("vender y la ficha del perfil", () => {
  test("se vende como siempre y la ficha dice «Te costó Bs 15 · lo vendiste a Bs 25 · ganás Bs 10»", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const aid = t.sellTo(t.cust("Ana"), r.slotId);
      assert.equal(t.E.s.assignments[aid].slotId, r.slotId);
      const card = t.s.perfiles.card(t.O, r.slotId);
      assert.equal(card.text, "Te costó Bs 15 · lo vendiste a Bs 25 · ganás Bs 10");
      const listed = t.s.inventory.listAccounts(t.O).find((a) => a.id === r.accountId).slots[0];
      assert.equal(listed.loose.text, card.text);
      // Un perfil que ya venció con Juan no se vende.
      const r2 = t.buy({ email: "corto@f.lat", until: "2026-08-10" });
      t.clock.t = T0 + 10 * DAY;
      assert.throws(() => t.sellTo(t.cust("Beto"), r2.slotId), /Sin stock|stock/i);
    } finally { await t.close(); }
  });
});

describe("⚠️ Se cayó: tres salidas, el cliente nunca queda sin servicio sin aviso, el perfil muerto nunca vuelve a «Libre»", () => {
  test("«Me lo repuso» con otra cuenta: el cliente pasa al perfil nuevo, se le prepara el aviso y el viejo queda retirado", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const aid = t.sellTo(t.cust("Ana"), r.slotId);
      const before = t.E.s.outbox.length;
      const d = t.s.perfiles.down(t.O, r.slotId, { outcome: "repuso", email: "juan.nuevo@ficticio.lat", password: "Nueva#Clave1", label: "Perfil 2" });
      assert.deepEqual(d.moved, [aid]);
      const a = t.E.s.assignments[aid];
      assert.equal(a.slotId, d.newSlotId);
      assert.equal(t.E.s.slots[r.slotId].status, "retired");
      assert.equal(t.E.s.slots[d.newSlotId].loose.prev, r.slotId);
      assert.ok(t.E.s.outbox.slice(before).some((m) => m.template === "replacement_done" && m.customerId === a.customerId));
      assert.equal(t.E.s.accounts[r.accountId].status, "retired", "la cuenta vieja sin perfiles vivos se retira sola");
      // No se vuelve a estimar el costo: el pago de la compra cubre al repuesto.
      assert.equal(t.s.finance.suppliersMonth(t.O, "2026-08").totals.estimado, 0);
    } finally { await t.close(); }
  });

  test("«Me lo repuso» en el mismo perfil (clave nueva): se arregla en el lugar y el cliente recibe «datos actualizados»", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const aid = t.sellTo(t.cust("Ana"), r.slotId);
      const d = t.s.perfiles.down(t.O, r.slotId, { outcome: "repuso", password: "Otra#Clave2" });
      assert.equal(d.inPlace, true);
      assert.equal(t.E.s.accounts[r.accountId].password, "Otra#Clave2");
      assert.equal(t.E.s.slots[r.slotId].status, "assigned");
      assert.equal(t.E.s.slots[r.slotId].loose.falls.length, 1);
      assert.ok(t.E.s.outbox.some((m) => m.template === "access_updated" && m.customerId === t.E.s.assignments[aid].customerId));
    } finally { await t.close(); }
  });

  test("«Me devolvió Bs 10»: queda la devolución (resta de gastos), el cliente pasa a otro perfil libre de Netflix", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const libre = t.buy({ email: "rosa@f.lat", supplierName: "Rosa", label: "P1" });
      const aid = t.sellTo(t.cust("Ana"), r.slotId);
      const d = t.s.perfiles.down(t.O, r.slotId, { outcome: "devolvio", amount: 1000 });
      assert.equal(d.refund, 1000);
      const ref = t.E.s.expenses.find((x) => x.refund);
      assert.equal(ref.amount, 1000); assert.equal(ref.category, "perfil"); assert.equal(ref.slotId, r.slotId);
      assert.equal(t.E.s.assignments[aid].slotId, libre.slotId);
      assert.equal(t.E.s.slots[r.slotId].status, "retired");
    } finally { await t.close(); }
  });

  test("«Lo perdí» sin otro perfil libre: el cliente queda en Reubicar («perfil caído») y no se puede renovar ahí", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const aid = t.sellTo(t.cust("Ana"), r.slotId);
      const d = t.s.perfiles.down(t.O, r.slotId, { outcome: "perdi" });
      assert.match(d.stuck, /No hay perfiles libres de Netflix/);
      const rows = t.s.orders.relocationQueue(t.O);
      assert.equal(rows.length, 1); assert.equal(rows[0].reason, "perfil caído");
      assert.throws(() => t.s.orders.renew(t.O, aid, { paymentMethod: "cash" }), /se cayó: pasalo a otro perfil en Reubicar/);
      // Cargás otro y lo movés desde Reubicar: el muerto queda retirado, nunca «Libre».
      const nuevo = t.buy({ email: "rosa@f.lat", supplierName: "Rosa", label: "P1" });
      t.s.caidas.relocate(t.O, aid, {});
      assert.equal(t.E.s.assignments[aid].slotId, nuevo.slotId);
      assert.equal(t.E.s.slots[r.slotId].status, "retired");
      assert.equal(t.s.inventory.stock().nf?.available ?? 0, 0);
    } finally { await t.close(); }
  });

  test("devolverle al cliente en vez de moverlo; un perfil ya dado de baja no se puede volver a tocar", async () => {
    const t = mk();
    try {
      const r = t.buy();
      const aid = t.sellTo(t.cust("Ana"), r.slotId);
      t.clock.t = T0 + 15 * DAY;
      const d = t.s.perfiles.down(t.O, r.slotId, { outcome: "perdi", client: "devolver", clientCash: true });
      assert.ok(d.refundedClient > 0 && d.refundedClient < 2500, `devolución proporcional (${d.refundedClient})`);
      assert.equal(t.E.s.assignments[aid].status, "revoked");
      assert.equal(t.E.s.slots[r.slotId].status, "retired");
      assert.throws(() => t.s.perfiles.down(t.O, r.slotId, { outcome: "perdi" }), /ya está dado de baja/);
      assert.throws(() => t.s.perfiles.pay(t.O, r.slotId, {}), /ya se dio de baja/);
    } finally { await t.close(); }
  });
});

describe("«Le pagué a Juan» y el resumen del mes", () => {
  test("renovar con el monto sugerido corre la fecha 30 días; pagar dos veces el mismo mes pregunta", async () => {
    const t = mk();
    try {
      const r = t.buy({ until: "2026-09-02" });
      const until0 = t.E.s.slots[r.slotId].loose.until;
      t.clock.t = T0 + 29 * DAY;
      const p = t.s.perfiles.pay(t.O, r.slotId, {});
      assert.equal(p.amount, 1500);
      assert.equal(t.E.s.slots[r.slotId].loose.until, until0 + 30 * DAY);
      assert.match(p.text, /le pagaste Bs 15 a Juan/);
      assert.throws(() => t.s.perfiles.pay(t.O, r.slotId, {}), (e) => e.code === "DOUBLE_CHARGE" && /¿Es otro mes\?/.test(e.message));
      t.s.perfiles.pay(t.O, r.slotId, { confirmOther: true, amount: 1600 });
      assert.equal(t.E.s.slots[r.slotId].loose.cost, 1600);
    } finally { await t.close(); }
  });

  test("Proveedores por mes: compré, vendí, gané, caídas y devolvió por vendedor; la suma sigue igual a Finanzas", async () => {
    const t = mk();
    try {
      const a = t.buy();
      const b = t.buy({ email: "juan2@f.lat", label: "P1" });
      t.sellTo(t.cust("Ana"), a.slotId);
      t.sellTo(t.cust("Beto"), b.slotId);
      t.clock.t = T0 + 5 * DAY;
      t.s.perfiles.down(t.O, b.slotId, { outcome: "devolvio", amount: 1000, client: "devolver", clientAmount: 2000 });
      const pm = t.s.finance.suppliersMonth(t.O, "2026-08");
      const row = pm.rows.find((x) => x.name === "Juan");
      // Lo que entró es neto: a Beto se le devolvieron Bs 20.
      assert.deepEqual(row.perfiles, { compre: 2, compreBs: 3000, renoveBs: 0, vendi: 2, vendiBs: 3000, caidas: 1, devolvio: 1000, gane: 1000 });
      // Finanzas: lo que entró menos lo que salió da lo mismo que la suma de proveedores.
      assert.equal(pm.totals.ingresos, 5000 - 2000);
      assert.equal(pm.totals.estimado, 0, "los perfiles pagados no se vuelven a estimar");
    } finally { await t.close(); }
  });
});
