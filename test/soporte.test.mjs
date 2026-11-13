// Premium 2.0 · etapa 8 "Automatización y soporte" (13/11/2026). Datos ficticios; nada se manda solo.
//  1. Fallas: cada una dice cuánto espera (`waitMs`) y se marca tarde (`late`) pasadas 24 h sin resolver; resuelta: cuánto tardó.
//  2. Respuestas guardadas y mensajes de la secretaria editables: validación, guardado y lectura por la API del panel.
//  3. Secretaria: «Débitos de tarjeta» = cuentas con autopago (la nota lo dice) que se cobran desde ayer hasta en 3 días;
//     y `templates` con los mensajes del dueño.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" }, seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const T0 = Date.UTC(2026, 10, 13, 15);
const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  const add = (email, extra = {}) => s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email, password: "Clave-Larga#1", supplierExpiresAt: T0 + 60 * DAY, cost: 2500, profiles: [1, 2, 3].map((k) => ({ label: `P${k}` })), ...extra });
  return { s, clock, add };
}

describe("etapa 8 · soporte", () => {
  test("Fallas: espera, tarde a las 24 h, y cuánto tardó al resolver", () => {
    const { s, clock, add } = setup();
    add("nf1@x.lat");
    const ana = s.catalog.createCustomer(owner, { name: "Ana", phone: "+59170000001" });
    const o = s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
    const t = s.tickets.report(as(ana), { assignmentId: o.assignmentIds[0], kind: "no_entra", note: "no entra" });
    clock.t += 2 * HOUR;
    let v = s.tickets.list(owner)[0];
    assert.deepEqual([v.waitMs, v.late], [2 * HOUR, false]);
    clock.t += 23 * HOUR;
    v = s.tickets.list(owner)[0];
    assert.deepEqual([v.waitMs, v.late], [25 * HOUR, true], "pasadas 24 h sin resolver: tarde");
    s.tickets.setStatus(owner, t.ticket?.id ?? t.id, { status: "solucionado", reply: "listo" });
    v = s.tickets.list(owner)[0];
    assert.deepEqual([v.waitMs, v.late], [25 * HOUR, false], "resuelta: cuánto tardó, ya no está tarde");
    assert.equal(s.tickets.mine(as(ana))[0].waitMs, 25 * HOUR);
  });

  test("respuestas guardadas y mensajes de la secretaria: validación y guardado", () => {
    const { s } = setup();
    assert.throws(() => s.catalog.updateSettings(owner, { ticketReplies: Array.from({ length: 11 }, () => "x") }), err("VALIDATION"), "más de 10 no");
    assert.throws(() => s.catalog.updateSettings(owner, { ticketReplies: ["ok", "   "] }), err("VALIDATION"), "vacías no");
    assert.throws(() => s.catalog.updateSettings(owner, { ticketReplies: ["x".repeat(201)] }), err("VALIDATION"), "más de 200 letras no");
    assert.throws(() => s.catalog.updateSettings(owner, { secretaryMsg: { cobrar: "x".repeat(501) } }), err("VALIDATION"));
    assert.throws(() => s.catalog.updateSettings(seller, { ticketReplies: ["hola"] }), err("FORBIDDEN"));
    s.catalog.updateSettings(owner, { ticketReplies: [" Ya lo reviso ", "Probá de nuevo"], secretaryMsg: { cobrar: "Hola {nombre}, debés {total}: {cuentas}", avisar: "", deben: "Pendiente {total}" } });
    assert.deepEqual(s.engine.s.settings.ticketReplies, ["Ya lo reviso", "Probá de nuevo"]);
    assert.deepEqual(s.engine.s.settings.secretaryMsg, { cobrar: "Hola {nombre}, debés {total}: {cuentas}", deben: "Pendiente {total}" }, "el vacío no se guarda (= texto de siempre)");
    assert.deepEqual(s.stats.secretary(owner).templates, { cobrar: "Hola {nombre}, debés {total}: {cuentas}", deben: "Pendiente {total}" });
  });

  test("secretaria: débitos de tarjeta solo con autopago y fecha cercana; no se pisan los otros conteos", () => {
    const { s, clock, add } = setup();
    add("auto1@x.lat", { supplierExpiresAt: T0 + 2 * DAY, notes: "Autopago con tarjeta terminada en 8562 · se debita el 15/11", costUsd: 900 });
    add("auto2@x.lat", { supplierExpiresAt: T0 - DAY + HOUR, notes: "DÉBITO automático", allowPastSupplierExpiry: true });
    add("auto3@x.lat", { supplierExpiresAt: T0 + 10 * DAY, notes: "se debita con tarjeta" }); // lejos: no
    add("manual@x.lat", { supplierExpiresAt: T0 + DAY, notes: "la pago en efectivo" }); // sin autopago: no
    const r = s.stats.secretary(owner);
    assert.deepEqual(r.debitos.map((d) => [d.email, d.costUsd, d.cost]), [["auto2@x.lat", null, 2500], ["auto1@x.lat", 900, 2500]], "ordenadas por fecha; ayer y pasado mañana");
    assert.equal(r.counts.debitos, 2);
    clock.t += 3 * DAY;
    assert.deepEqual(s.stats.secretary(owner).debitos.map((d) => d.email), ["auto1@x.lat"], "la que se debitó ayer sigue un día más (por si no la anotaste)");
    clock.t += DAY;
    assert.deepEqual(s.stats.secretary(owner).debitos.map((d) => d.email), [], "después sale de la lista");
  });

  test("por la API: /api/admin/settings guarda soporte y /api/admin/settings/soporte lo devuelve al panel (no al público)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-sop-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
      const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      const r = await post("/api/admin/settings", { ticketReplies: ["Ya lo reviso"], secretaryMsg: { cobrar: "Hola {nombre}: {cuentas} · {total}" } }, ck);
      assert.equal(r.status, 200);
      const sup = await (await fetch(base + "/api/admin/settings/soporte", { headers: { cookie: ck } })).json();
      assert.deepEqual(sup, { ticketReplies: ["Ya lo reviso"], secretaryMsg: { cobrar: "Hola {nombre}: {cuentas} · {total}" } });
      assert.equal((await fetch(base + "/api/admin/settings/soporte")).status, 401, "sin sesión no");
      const pub = await (await fetch(base + "/api/settings")).json();
      assert.equal(pub.ticketReplies, undefined, "la tienda pública no lo ve");
      const bad = await post("/api/admin/settings", { ticketReplies: ["x".repeat(300)] }, ck);
      assert.equal(bad.status, 400);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
