// Premium 2.0 · etapa 4 "Inventario inteligente" (12/11/2026). Datos ficticios; reloj controlado.
//  1. Correos de cuentas: se guardan normalizados; la misma cuenta dos veces para la misma plataforma no entra;
//     la misma dirección en otra plataforma sí; un dominio mal escrito («gmaik.com») avisa pero no frena.
//  2. Semáforo de riesgo por cuenta: verde / amarillo / rojo con los motivos, y viaja en la lista de cuentas.
//  3. «Cortes»: cuentas por perfiles con clientes que vencen en fechas distintas; fecha sugerida y días de diferencia.
//  4. «Cambié la clave»: nueva clave, fecha, auditoría y aviso a los clientes; la secretaria deja de pedirla 7 días.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { normEmail, emailTypo, riskOf } from "../dist/store/inventario.js";
import { boDayStart } from "../dist/store/time.js";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" }, admin = { id: "u_admin", role: "admin" }, seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const T0 = Date.UTC(2026, 10, 12, 18, 0, 0); // 12/11 14:00 Bolivia

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "hbo", name: "HBO perfil", kind: "profile", durationDays: 30, price: 1500, published: true });
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  const add = (productId, email, extra = {}) => s.inventory.addAccount(owner, { productId, supplierId: "andes", email, password: "Clave-Larga#1", supplierExpiresAt: T0 + 90 * DAY, cost: 2500, profiles: [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })), ...extra });
  const cust = (name, phone) => s.catalog.createCustomer(owner, { name, phone });
  const sell = (c, productId, t = clock.t) => { clock.t = t; return s.orders.create(owner, { customerId: c.id, items: [{ productId, qty: 1 }], paymentMethod: "cash" }); };
  return { s, clock, add, cust, sell };
}

describe("etapa 4 · correos de cuentas", () => {
  test("normalizados, sin dobles por plataforma, con aviso de dominio mal escrito", () => {
    const { s, add } = setup();
    assert.equal(normEmail("  Gabito6617+Mer1@Gmail.com "), "gabito6617+mer1@gmail.com");
    assert.equal(emailTypo("netgb.117@gmaik.com"), "netgb.117@gmail.com");
    assert.equal(emailTypo("netgb.117@gmail.com"), null);
    const a = add("nf", "  NetGB.117@GMAIL.com ");
    assert.equal(a.account.email, "netgb.117@gmail.com", "se guarda normalizado");
    assert.equal(a.warning, undefined);
    assert.throws(() => add("nf", "netgb.117@gmail.com"), err("VALIDATION"), "la misma cuenta de Netflix dos veces: no");
    assert.throws(() => add("nf", "NETGB.117@gmail.com "), err("VALIDATION"), "ni con mayúsculas o espacios");
    const h = add("hbo", "netgb.117@gmail.com");
    assert.equal(h.account.productId, "hbo", "la misma dirección en otra plataforma es otra cuenta");
    const typo = add("nf", "n.2025jg@gmaik.com");
    assert.match(typo.warning, /n\.2025jg@gmail\.com/, "dominio raro: se carga, pero avisa");
    // Editar el correo hacia uno que ya existe en la misma plataforma: tampoco.
    const b = add("nf", "otra@gmail.com");
    assert.throws(() => s.inventory.updateAccount(owner, b.account.id, { email: "NetGB.117@gmail.com" }), err("VALIDATION"));
    // Una cuenta retirada libera el correo.
    s.inventory.retireAccount?.(owner, a.account.id) ?? (s.engine.s.accounts[a.account.id].status = "retired");
    assert.ok(add("nf", "netgb.117@gmail.com").account.id, "retirada la vieja, se puede cargar de nuevo");
    const list = s.inventory.listAccounts(owner);
    assert.ok(list.every((x) => x.risk && ["ok", "warn", "bad"].includes(x.risk.level)), "la lista trae el semáforo");
  });
});

describe("etapa 4 · semáforo de riesgo", () => {
  test("verde, amarillo y rojo con motivos", () => {
    const { s, clock, add, cust, sell } = setup();
    const E = () => s.engine.s; // el estado se reemplaza en cada transacción: leerlo fresco
    const ok = add("nf", "ok@x.lat");
    assert.deepEqual(riskOf(s.engine, E().accounts[ok.account.id]), { level: "ok", reasons: [] });
    const ana = cust("Ana", "+59170000001");
    sell(ana, "nf"); // la única cuenta que existe: el perfil sale de ok@x.lat
    assert.equal(riskOf(s.engine, E().accounts[ok.account.id]).level, "ok", "con un cliente y todo en orden sigue verde");
    // Clave pendiente → amarillo.
    const pend = add("nf", "pend@x.lat", { password: undefined, passwordPending: true });
    assert.equal(riskOf(s.engine, E().accounts[pend.account.id]).level, "warn");
    assert.match(riskOf(s.engine, E().accounts[pend.account.id]).reasons.join(), /clave pendiente/);
    // Proveedor en 5 días → amarillo; en 1 día con clientes → rojo; vencida con clientes → rojo.
    const soon = add("nf", "soon@x.lat", { supplierExpiresAt: T0 + 5 * DAY });
    assert.equal(riskOf(s.engine, E().accounts[soon.account.id]).level, "warn");
    E().accounts[ok.account.id].supplierExpiresAt = T0 + 1 * DAY;
    const r = riskOf(s.engine, E().accounts[ok.account.id]);
    assert.equal(r.level, "bad"); assert.match(r.reasons[0], /vence con el proveedor en 1 día/);
    E().accounts[ok.account.id].supplierExpiresAt = T0 - DAY;
    assert.match(riskOf(s.engine, E().accounts[ok.account.id]).reasons[0], /venció con el proveedor y tiene 1 cliente/);
    E().accounts[ok.account.id].supplierExpiresAt = T0 + 90 * DAY;
    // Nota «POR CORTAR» → rojo; «SEGUIMIENTO» → amarillo; perfiles apartados → amarillo.
    s.inventory.updateAccount(owner, ok.account.id, { notes: "✂️ POR CORTAR" });
    assert.equal(riskOf(s.engine, E().accounts[ok.account.id]).level, "bad");
    s.inventory.updateAccount(owner, ok.account.id, { notes: "🔍 SEGUIMIENTO: revisar si hay que cambiar la clave" });
    assert.equal(riskOf(s.engine, E().accounts[ok.account.id]).level, "warn");
    s.inventory.updateAccount(owner, ok.account.id, { notes: "" });
    const slotFree = ok.slots.find((x) => E().slots[x.id].status === "available");
    s.inventory.setSlotStatus(owner, slotFree.id, "quarantined", "prueba");
    assert.match(riskOf(s.engine, E().accounts[ok.account.id]).reasons.join(), /1 perfil apartado/);
    s.inventory.setSlotStatus(owner, slotFree.id, "available", "prueba");
    // Aviso grave de la plataforma sin ver → rojo; visto → verde otra vez.
    const al = s.watch.record(owner, { to: "ok@x.lat", kind: "password_changed", subject: "Tu contraseña cambió", at: clock.t });
    assert.equal(riskOf(s.engine, E().accounts[ok.account.id]).level, "bad");
    s.watch.seen(owner, al.id);
    assert.equal(riskOf(s.engine, E().accounts[ok.account.id]).level, "ok");
    // Clave sin cambiar hace más de 90 días (con clientes) → amarillo.
    E().accounts[ok.account.id].passwordChangedAt = T0 - 91 * DAY;
    assert.match(riskOf(s.engine, E().accounts[ok.account.id]).reasons.join(), /90 días/);
  });
});

describe("etapa 4 · cortes y cambio de clave", () => {
  test("Cortes: fecha sugerida = la que más se repite; días de más o de menos por perfil; solo cuentas por perfiles", () => {
    const { s, clock, add, cust, sell } = setup();
    const nf = add("nf", "nf1@x.lat");
    const [a, b, c] = [cust("Ana", "+59170000001"), cust("Beto", "+59170000002"), cust("Carla", "+59170000003")];
    const o1 = sell(a, "nf", T0 - 20 * DAY), o2 = sell(b, "nf", T0 - 20 * DAY), o3 = sell(c, "nf", T0 - 10 * DAY);
    clock.t = T0;
    // Disney (cuenta completa) con cliente: no entra en Cortes.
    add("dis", "dis@x.lat", { profiles: [{ label: "Cuenta completa" }] });
    sell(cust("Rev", "+59170000009"), "dis");
    const rep = s.inventario.cuts(owner);
    assert.equal(rep.length, 1, "solo la cuenta por perfiles con clientes");
    const x = rep[0];
    assert.equal(x.email, "nf1@x.lat");
    assert.equal(x.suggestedCut, boDayStart(T0 + 10 * DAY), "dos vencen el 22/11: esa es la fecha sugerida");
    assert.equal(x.spreadDays, 10); assert.equal(x.aligned, false); assert.equal(x.clients, 3); assert.equal(x.free, 2);
    const diff = Object.fromEntries(x.profiles.filter((p) => p.customer).map((p) => [p.customer, p.diffDays]));
    assert.deepEqual(diff, { Ana: 0, Beto: 0, Carla: 10 });
    assert.ok(!JSON.stringify(x).includes("Clave-Larga"), "no viaja ninguna clave");
    // Alinear a Carla al corte: la cuenta queda alineada.
    s.orders.setExpiry(owner, o3.assignmentIds[0], T0 + 10 * DAY);
    assert.equal(s.inventario.cuts(owner)[0].aligned, true);
    assert.throws(() => s.inventario.cuts(seller), err("FORBIDDEN"), "Atención no ve Cortes");
    assert.ok([o1, o2].every((o) => o.assignmentIds.length === 1));
  });

  test("Cambié la clave: guarda clave y fecha, audita, avisa a los clientes; la secretaria la deja de pedir 7 días", () => {
    const { s, clock, add, cust, sell } = setup();
    const E = () => s.engine.s; // el estado se reemplaza en cada transacción: leerlo fresco
    const nf = add("nf", "nf1@x.lat", { notes: "🔍 SEGUIMIENTO: cambiar la clave" });
    sell(cust("Ana", "+59170000001"), "nf"); sell(cust("Beto", "+59170000002"), "nf");
    clock.t = T0;
    assert.deepEqual(s.stats.secretary(owner).claves.map((k) => [k.email, k.clients, k.passwordChangedAt]), [["nf1@x.lat", 2, null]]);
    assert.throws(() => s.inventario.rotatePassword(owner, nf.account.id, "abc"), err("VALIDATION"), "muy corta");
    assert.throws(() => s.inventario.rotatePassword(owner, nf.account.id, "Clave-Larga#1"), err("VALIDATION"), "es la misma");
    assert.throws(() => s.inventario.rotatePassword(seller, nf.account.id, "Nueva-Clave#2"), err("FORBIDDEN"));
    const out0 = E().outbox.length;
    const r = s.inventario.rotatePassword(admin, nf.account.id, "Nueva-Clave#2");
    assert.deepEqual([r.notified, r.passwordChangedAt], [2, T0]);
    assert.equal(E().accounts[nf.account.id].password, "Nueva-Clave#2");
    assert.equal(E().outbox.length - out0, 2, "un aviso por cliente (en la cola; no sale nada real)");
    assert.equal(E().audit.filter((a) => a.action === "account.password_rotated").length, 1);
    assert.ok(!JSON.stringify(E().audit.at(-1)).includes("Nueva-Clave"), "la auditoría no guarda la clave");
    assert.deepEqual(s.stats.secretary(owner).claves, [], "recién cambiada: la secretaria no la pide");
    clock.t = T0 + 8 * DAY;
    assert.equal(s.stats.secretary(owner).claves.length, 1, "a los 8 días vuelve a pedirla mientras la nota siga");
    assert.equal(s.stats.secretary(owner).counts.claves, 1);
  });
});

describe("etapa 4 · por la API", () => {
  let dir, app, base, owner;
  const call = async (m, p, body, ck) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-inv-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    await call("POST", "/api/admin/products", { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("cargar con dominio raro avisa; repetida da 400; /api/admin/cortes y cambio de clave funcionan", async () => {
    const a = await call("POST", "/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "N.2025jg@gmaik.com", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2500, profiles: [{ label: "P1" }, { label: "P2" }] }, owner);
    assert.equal(a.status, 200); assert.equal(a.json.account.email, "n.2025jg@gmaik.com"); assert.match(a.json.warning, /gmail\.com/);
    const dup = await call("POST", "/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "n.2025jg@gmaik.com ", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2500, profiles: [{ label: "P1" }] }, owner);
    assert.equal(dup.status, 400); assert.match(dup.json.message, /ya está cargada/);
    const ana = (await call("POST", "/api/admin/customers", { name: "Ana", phone: "+59170000001" }, owner)).json;
    await call("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }, owner);
    const cuts = await call("GET", "/api/admin/cortes", undefined, owner);
    assert.equal(cuts.status, 200); assert.equal(cuts.json.length, 1); assert.equal(cuts.json[0].clients, 1);
    const rot = await call("POST", `/api/admin/accounts/${a.json.account.id}/password`, { password: "Nueva-Clave#2" }, owner);
    assert.equal(rot.status, 200); assert.equal(rot.json.notified, 1);
    const list = (await call("GET", "/api/admin/accounts", undefined, owner)).json;
    assert.equal(list[0].password, "••••••", "la lista sigue sin mostrar la clave");
    assert.equal(list[0].passwordChangedAt, rot.json.passwordChangedAt);
    assert.equal((await call("GET", "/api/admin/cortes")).status, 401);
  });
});
