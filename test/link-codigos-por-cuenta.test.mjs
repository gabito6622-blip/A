// 🔗 Link de códigos POR CUENTA (18/11/2026, pedido del dueño): el cliente abre el link y ve la bandeja de ESA cuenta
// sin escribir nada. Tope de 3 códigos nuevos por día, historial para el revendedor, Pausar y Cambiar link. Un
// revendedor no puede armar links de cuentas ajenas. Datos ficticios; nada se manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
// Links lindos (/cod/<nombre>-xxxx, 19/11/2026): se sigue el link hasta /codigos/<token>, como el navegador.
const tokenOf = async (u) => { if (u.includes("/codigos/")) return u.split("/codigos/")[1]; const r = await fetch(u, { redirect: "manual" }); return (r.headers.get("location") ?? "").split("/codigos/")[1]; };


test("link por cuenta: bandeja sin escribir, tope diario, historial, pausa y cambio de link", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-acclink-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dz", name: "Disney Premium", kind: "full_account", durationDays: 30, price: 6900, published: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "P", active: true });
  for (const m of ["una@ficticio.lat", "otra@ficticio.lat"]) s.inventory.addAccount(owner, { productId: "dz", supplierId: "p", email: m, password: "Clave#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Revende", phone: "+59170000111" });
  const beto = s.catalog.createCustomer(owner, { name: "Beto Revende", phone: "+59170000222" });
  e.tx(() => { ana.kind = "reseller"; beto.kind = "reseller"; });
  s.orders.create(owner, { customerId: ana.id, items: [{ productId: "dz", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [Object.values(e.s.slots).find((x) => e.s.accounts[x.accountId].email === "una@ficticio.lat").id] });
  s.orders.create(owner, { customerId: beto.id, items: [{ productId: "dz", qty: 1 }], paymentMethod: "cash" });
  const mbx = s.codes.configureMailbox(owner, { address: "codigos@ficticio.lat", host: "imap.ficticio.lat" }).id;
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null), r }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];
    const login = async (cu) => { const { pin } = (await call("POST", `/api/admin/customers/${cu.id}/login-pin`, {}, ock)).json; return (await call("POST", "/api/auth/customer/pin", { phone: cu.phone, pin })).r.headers.get("set-cookie").split(";")[0]; };
    const ack = await login(ana), bck = await login(beto);

    // Beto no puede armar el link de la cuenta de Ana.
    assert.equal((await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat" }, bck)).status, 400);
    const list = (await call("GET", "/api/me/acc-links", null, ack)).json;
    assert.deepEqual(list.accounts.map((a) => a.email), ["una@ficticio.lat"], "Ana ve solo su cuenta");
    const made = (await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat" }, ack)).json;
    const token = (await tokenOf(made.url));
    assert.equal((await call("GET", `/api/code-link/${token}`)).json.mode, "account");
    assert.doesNotMatch(JSON.stringify((await call("GET", `/api/code-link/${token}`)).json), /Ana Revende|\+591/, "no muestra el nombre ni el teléfono del revendedor");

    const t0 = Date.now();
    const push = (to, code, at) => e.s.codes.push({ id: "c" + code, mailboxId: mbx, to, subject: "Tu código de acceso único", code, kind: "login", receivedAt: at });
    for (let i = 0; i < 4; i++) push("una@ficticio.lat", String(100000 + i), t0 + i);
    push("otra@ficticio.lat", "999999", t0);
    const v1 = (await call("POST", `/api/code-link/${token}`, {})).json;
    assert.equal(v1.codes.length, 3, "tope: 3 códigos por día");
    assert.equal(v1.held, 1);
    assert.ok(!JSON.stringify(v1).includes("999999"), "nunca ve códigos de otra cuenta");
    const v2 = (await call("POST", `/api/code-link/${token}`, {})).json;
    assert.equal(v2.codes.length, 3, "los ya vistos se siguen viendo; no suma de nuevo");
    const info = (await call("GET", "/api/me/acc-links", null, ack)).json.accounts[0];
    assert.equal(info.today, 3); assert.equal(info.over, true); assert.equal(info.log.length, 3);

    // Pausar y activar.
    await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat", paused: true }, ack);
    const pz = (await call("POST", `/api/code-link/${token}`, {})).json;
    assert.equal(pz.paused, true); assert.equal(pz.codes.length, 0);
    await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat", paused: false }, ack);
    assert.equal((await call("POST", `/api/code-link/${token}`, {})).json.codes.length, 3);

    // Cambiar link: el viejo deja de andar.
    const nuevo = (await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat", reset: true }, ack)).json.url;
    assert.notEqual(nuevo, made.url);
    assert.equal((await call("GET", `/api/code-link/${token}`)).status, 404);

    // Cuenta repartida entre varias personas: el tope sube (3 por persona).
    assert.equal((await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat", people: 9 }, ack)).status, 400);
    const p2 = (await call("POST", "/api/me/acc-links", { email: "una@ficticio.lat", people: 2 }, ack)).json;
    assert.equal(p2.people, 2); assert.equal(p2.cap, 6); assert.equal(p2.over, false);
    const tok2 = (await tokenOf(nuevo));
    const v3 = (await call("POST", `/api/code-link/${tok2}`, {})).json;
    assert.equal(v3.codes.length, 4, "con 2 personas ya entra el 4.º código"); assert.equal(v3.held, 0); assert.equal(v3.cap, 6);

    // El dueño también lo ve.
    assert.equal((await call("GET", `/api/admin/customers/${ana.id}/acc-links`, null, ock)).json.accounts[0].today, 4);
  } finally { await app.close?.(); rmSync(dir, { recursive: true, force: true }); }
});
