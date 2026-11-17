// Herramientas de cobro del dueño en GaboHub (17/11/2026): Anotar rápido, Me pagó todo, Deshacer, link de cobro con
// comprobante que aprueba EL REVENDEDOR, separación entre revendedores y plan GaboHub. Datos ficticios, reloj fijo, nada real.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const NOW = Date.UTC(2026, 10, 17, 18);
// PNG de 1×1 (firma válida) para el comprobante.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function seed(s, clock) {
  const at = (t) => { clock.t = t; };
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, "disney-alq": 6600 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  let n = 0;
  const add = (productId, slots) => s.inventory.addAccount(owner, { productId, supplierId: "prov", email: `${productId}${++n}@x.lat`, password: "Clave#Secreta1", supplierExpiresAt: NOW + 120 * DAY, cost: 2000, profiles: Array.from({ length: slots }, (_, i) => ({ label: slots === 1 ? "Cuenta completa" : `Perfil ${i + 1}` })) });
  add("netflix", 5); add("disney-alq", 1); add("disney-alq", 1);
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" }); s.wallet.adjust(owner, c.id, 100000, "demo"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Flores", "+59171000001"), beto = mk("Beto Rojas", "+59171000002");
  const sell = (R, cid, productId, t) => { at(t); const o = s.orders.create(R.A, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "balance" }); at(NOW); return o.assignmentIds[0]; };
  // Ana: José (cliente registrado) le debe Bs 45; una cuenta Disney repartida: Lucía (Mamá) y Mario (Papá) vencidos y deben.
  const jose = s.catalog.createCustomer(ana.A, { name: "José Vargas", phone: "+59175000003", whatsappConsent: true });
  const aJ = sell(ana, jose.id, "netflix", NOW - 10 * DAY);
  s.rtools.setControl(ana.A, aJ, { price: 4500, payStatus: "pendiente" });
  const aidD = sell(ana, ana.c.id, "disney-alq", NOW - 5 * DAY);
  const mama = s.subs.save(ana.A, aidD, { label: "Mamá", name: "Lucía Rojas", phone: "+59175556677", expiresAt: NOW - 1 * DAY, price: 1500, pay: "pagado" }).sub;
  const papa = s.subs.save(ana.A, aidD, { label: "Papá", name: "Lucía Rojas", phone: "+59175556677", expiresAt: NOW - 2 * DAY, price: 1500, pay: "pagado" }).sub;
  // Beto: su propia cuenta Disney con una clienta vencida.
  const aidB = sell(beto, beto.c.id, "disney-alq", NOW - 5 * DAY);
  const bsub = s.subs.save(beto.A, aidB, { label: "P1", name: "Carla Ajena", phone: "+59175009999", expiresAt: NOW - 1 * DAY, price: 2000, pay: "pagado" }).sub;
  return { ana, beto, ids: { aJ, jose: jose.id, aidD, mama: mama.id, papa: papa.id, aidB, bsub: bsub.id } };
}

describe("hub-cobros · núcleo", () => {
  const world = () => { const clock = { t: NOW - 40 * DAY, now() { return this.t; } }; const s = createStore({ clock }); const w = seed(s, clock); clock.t = NOW; return { s, clock, ...w }; };

  test("Anotar rápido: vista previa sin guardar, aplica con un solo Deshacer que vuelve todo atrás", () => {
    const { s, ana, ids } = world();
    const before = s.rtools.day(ana.A).totals.cobrar;
    const p = s.hubCobros.quickParse(ana.A, "José pagó 45\nNadie Existe 10");
    assert.equal(p.ok, 1);
    assert.equal(p.lines[0].client, "José Vargas"); assert.equal(p.lines[0].amount, 4500);
    assert.match(p.lines[1].error, /No encontré/);
    assert.equal(s.rtools.day(ana.A).totals.cobrar, before, "la vista previa no guarda nada");
    // Lucía tiene dos perfiles: sin decir cuál, pide aclarar.
    assert.match(s.hubCobros.quickParse(ana.A, "Lucía 15").lines[0].error, /más de uno/);
    assert.equal(s.hubCobros.quickParse(ana.A, "Lucía mamá 15").lines[0].label, "Mamá");
    const r = s.hubCobros.quickApply(ana.A, "José pagó 45", { idempotencyKey: "k1" });
    assert.equal(r.count, 1); assert.ok(r.undoId);
    assert.equal(s.engine.s.assignments[ids.aJ].rcontrol.payStatus, "pagado");
    assert.equal(s.hubCobros.quickApply(ana.A, "José pagó 45", { idempotencyKey: "k1" }).undoId, r.undoId, "idempotente");
    assert.equal(s.hubCobros.undoList(ana.A).length, 1);
    s.hubCobros.undo(ana.A, r.undoId);
    assert.equal(s.engine.s.assignments[ids.aJ].rcontrol.payStatus, "pendiente", "vuelve a deber");
    assert.equal(s.rtools.day(ana.A).totals.cobrar, before);
    assert.throws(() => s.hubCobros.undo(ana.A, r.undoId), err("NOT_FOUND"), "no se deshace dos veces");
  });

  test("Tablero: Me pagó todo de una persona (2 perfiles) y Deshacer de los dos; Me pagó de a uno con Deshacer", () => {
    const { s, ana, ids } = world();
    const g = s.rtools.day(ana.A).cobrar.find((x) => x.client === "Lucía Rojas");
    assert.equal(g.items.length, 2);
    const subsBefore = JSON.stringify(s.engine.s.assignments[ids.aidD].subs);
    const r = s.hubCobros.payMany(ana.A, g.items.map((x) => x.id), { idempotencyKey: "all1" });
    assert.equal(r.count, 2); assert.equal(r.paid, 3000);
    assert.ok(!s.rtools.day(ana.A).cobrar.some((x) => x.client === "Lucía Rojas"), "ya no debe");
    s.hubCobros.undo(ana.A, r.undoId);
    assert.equal(JSON.stringify(s.engine.s.assignments[ids.aidD].subs), subsBefore, "los dos perfiles vuelven exactos");
    // De a uno: cliente registrado (antes no tenía Deshacer).
    const one = s.hubCobros.pay(ana.A, ids.aJ, {});
    assert.ok(one.undoId);
    s.hubCobros.undo(ana.A, one.undoId);
    assert.equal(s.engine.s.assignments[ids.aJ].rcontrol.payStatus, "pendiente");
  });

  test("Deshacer: pasados 30 minutos o si cambió después, no toca nada", () => {
    const { s, clock, ana, ids } = world();
    const r = s.hubCobros.pay(ana.A, ids.aJ, {});
    s.rtools.setControl(ana.A, ids.aJ, { note: "cambió" });
    assert.throws(() => s.hubCobros.undo(ana.A, r.undoId), /cambió después/);
    const r2 = s.hubCobros.pay(ana.A, `${ids.aidD}|${ids.mama}`, {});
    clock.t += 31 * 60_000;
    assert.throws(() => s.hubCobros.undo(ana.A, r2.undoId), /NOT_FOUND|30 minutos|ya no se puede/);
  });

  test("Link con comprobante → En revisión → lo aprueba el revendedor (= Me pagó); rechazar deja subir otro", () => {
    const { s, ana, ids } = world();
    s.hubCobros.setPayInfo(ana.A, { bank: "Banco Ficticio", holder: "Ana Flores", account: "000-111", note: "Mandá la foto" });
    const { token } = s.subs.link(ana.A, ids.aidD, ids.mama);
    const pv = s.hubCobros.publicPay(token);
    assert.deepEqual(pv.payInfo, { bank: "Banco Ficticio", holder: "Ana Flores", account: "000-111", note: "Mandá la foto" });
    assert.equal(pv.upload, true); assert.equal(pv.proof, null);
    const up = s.hubCobros.submitProof(token, { fileRef: "a.png", hash: "h1" });
    assert.equal(up.status, "review");
    assert.equal(s.hubCobros.publicPay(token).proof.status, "review");
    assert.throws(() => s.hubCobros.submitProof(token, { fileRef: "b.png", hash: "h2" }), /en revisión/);
    const L = s.hubCobros.proofs(ana.A);
    assert.equal(L.review.length, 1); assert.equal(L.review[0].name, "Lucía Rojas"); assert.equal(L.review[0].amount, 1500);
    assert.ok(!JSON.stringify(L).includes("a.png") && !JSON.stringify(L).includes("h1"), "sin archivo ni huella en la lista");
    // Nada se cobró solo: sigue debiendo hasta que ella aprueba.
    assert.ok(s.rtools.day(ana.A).cobrar.flatMap((g) => g.items).some((x) => x.id === `${ids.aidD}|${ids.mama}`));
    s.hubCobros.reject(ana.A, L.review[0].id, "No se ve el monto");
    assert.equal(s.hubCobros.publicPay(token).proof.reason, "No se ve el monto");
    const up2 = s.hubCobros.submitProof(token, { fileRef: "c.png", hash: "h3" });
    const ok = s.hubCobros.approve(ana.A, up2.id, {});
    assert.equal(ok.paid, 1500); assert.ok(ok.undoId);
    assert.ok(!s.rtools.day(ana.A).cobrar.flatMap((g) => g.items).some((x) => x.id === `${ids.aidD}|${ids.mama}`), "aprobado = cobrado");
    assert.throws(() => s.hubCobros.approve(ana.A, up2.id, {}), /Ya lo aprobaste/);
    assert.throws(() => s.hubCobros.submitProof(token, { fileRef: "d.png", hash: "h3" }), err("DUPLICATE_EVIDENCE"), "el mismo comprobante no entra dos veces");
  });

  test("Separación: un revendedor no ve, no aprueba ni abre comprobantes de otro; la tienda no los tiene en su cola", () => {
    const { s, ana, beto, ids } = world();
    s.hubCobros.setPayInfo(beto.A, { bank: "Banco Beto", holder: "Beto Rojas" });
    const { token } = s.subs.link(beto.A, ids.aidB, ids.bsub);
    const pv = s.hubCobros.publicPay(token);
    assert.equal(pv.payInfo.bank, "Banco Beto", "el link de Beto muestra los datos de Beto");
    assert.ok(!JSON.stringify(pv).includes("Banco Ficticio"));
    const up = s.hubCobros.submitProof(token, { fileRef: "beto.png", hash: "hb" });
    assert.equal(s.hubCobros.proofs(ana.A).review.length, 0, "Ana no ve el de Beto");
    assert.throws(() => s.hubCobros.approve(ana.A, up.id, {}), err("NOT_FOUND"));
    assert.throws(() => s.hubCobros.reject(ana.A, up.id, ""), err("NOT_FOUND"));
    assert.throws(() => s.hubCobros.proofFile(ana.A, up.id), err("NOT_FOUND"));
    assert.throws(() => s.hubCobros.pay(ana.A, `${ids.aidB}|${ids.bsub}`, {}), err("NOT_FOUND"), "ni cobrarle a un cliente de Beto");
    assert.throws(() => s.hubCobros.proofs(owner), err("FORBIDDEN"));
    const r = s.hubCobros.pay(beto.A, `${ids.aidB}|${ids.bsub}`, {});
    assert.throws(() => s.hubCobros.undo(ana.A, r.undoId), err("NOT_FOUND"), "ni deshacer lo de Beto");
    assert.equal(s.hubCobros.proofs(beto.A).review.length, 1);
    assert.ok(!Object.values(s.engine.s.orders).some((o) => JSON.stringify(o).includes("beto.png")), "no entra a Aprobar pagos de la tienda");
    assert.throws(() => s.hubCobros.publicPay("x".repeat(40)), err("NOT_FOUND"));
  });
});

describe("hub-cobros · API", () => {
  let dir, app, base, ock, ack, bck, w;
  const clock = { t: NOW - 40 * DAY, now() { return this.t; } };
  const req = async (m, p, body, ck) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const logs = [];
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-hubcobros-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: (m) => logs.push(String(m)), clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    w = seed(app.store, clock); clock.t = NOW;
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const login = async (r) => (await fetch(base + r.p, { method: "POST", headers: { "content-type": "application/json", ...(r.ck ? { cookie: r.ck } : {}) }, body: JSON.stringify(r.b) })).headers.get("set-cookie").split(";")[0];
    ock = await login({ p: "/api/auth/staff/login", b: { username: "gabriel", password: "clave-del-dueño-123" } });
    const pinOf = async (c) => (await req("POST", `/api/admin/customers/${c.id}/login-pin`, {}, ock)).json.pin;
    ack = await login({ p: "/api/auth/customer/pin", b: { phone: w.ana.c.phone, pin: await pinOf(w.ana.c) } });
    bck = await login({ p: "/api/auth/customer/pin", b: { phone: w.beto.c.phone, pin: await pinOf(w.beto.c) } });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("link público: datos de pago, subir comprobante, la revendedora lo ve y aprueba; el otro no", async () => {
    assert.equal((await req("PUT", "/api/me/cobros-hub/pay-info", { bank: "Banco Ficticio", holder: "Ana Flores" }, ack)).status, 200);
    const tok = app.store.subs.link(w.ana.A, w.ids.aidD, w.ids.mama).token;
    const pv = await req("GET", `/api/cobro/${tok}/pago`);
    assert.equal(pv.status, 200); assert.equal(pv.json.payInfo.holder, "Ana Flores");
    const files0 = readdirSync(join(dir, "uploads")).length;
    const up = await req("POST", `/api/cobro/${tok}/comprobante`, { contentBase64: PNG });
    assert.equal(up.status, 200); assert.equal(up.json.status, "review");
    assert.equal((await req("POST", `/api/cobro/${tok}/comprobante`, { contentBase64: PNG2 })).status, 409, "uno por vez");
    assert.equal(readdirSync(join(dir, "uploads")).length, files0 + 1, "el rechazado no deja archivo");
    assert.equal((await req("POST", `/api/cobro/${tok}/comprobante`, { contentBase64: "bm8gZXMgdW5hIGltYWdlbg==" })).status, 400);
    const L = await req("GET", "/api/me/cobros-hub/proofs", null, ack);
    assert.equal(L.json.review.length, 1);
    const id = L.json.review[0].id;
    assert.equal((await fetch(`${base}/api/me/cobros-hub/proofs/${id}/file`, { headers: { cookie: ack } })).status, 200);
    assert.equal((await fetch(`${base}/api/me/cobros-hub/proofs/${id}/file`, { headers: { cookie: bck } })).status, 404, "Beto no abre el de Ana");
    assert.equal((await req("GET", "/api/me/cobros-hub/proofs", null, bck)).json.review.length, 0);
    assert.equal((await req("POST", `/api/me/cobros-hub/proofs/${id}/approve`, {}, bck)).status, 404);
    assert.equal((await req("GET", "/api/me/cobros-hub/proofs", null, ock)).status, 401, "staff no entra a rutas del revendedor");
    const ok = await req("POST", `/api/me/cobros-hub/proofs/${id}/approve`, {}, ack);
    assert.equal(ok.status, 200); assert.equal(ok.json.paid, 1500);
    assert.equal((await req("GET", `/api/cobro/${tok}/pago`)).json.proof.status, "approved");
    assert.equal((await req("GET", `/api/cobro/${"z".repeat(40)}/pago`)).status, 404);
  });

  test("plan vencido: se pausan las listas (402) como Quién me debe; aprobar y deshacer siguen; el link no deja subir", async () => {
    await req("POST", "/api/admin/settings", { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0 } }, ock);
    app.store.shops.setPlan(w.ana.A, w.ana.c.id, "free");
    const r = await req("GET", "/api/me/cobros-hub/proofs", null, ack);
    assert.equal(r.status, 402);
    assert.equal((await req("GET", "/api/me/fiado", null, ack)).status, 402, "igual que Quién me debe");
    assert.equal((await req("POST", "/api/me/cobros-hub/quick/parse", { text: "José 45" }, ack)).status, 402);
    const tok = app.store.subs.link(w.ana.A, w.ids.aidD, w.ids.papa).token;
    const pv = await req("GET", `/api/cobro/${tok}/pago`);
    assert.equal(pv.status, 200); assert.equal(pv.json.upload, false);
    assert.equal((await req("POST", `/api/cobro/${tok}/comprobante`, { contentBase64: PNG2 })).status, 409);
    assert.equal((await req("PUT", "/api/me/cobros-hub/pay-info", { bank: "B" }, ack)).status, 200, "sus datos los puede editar igual");
    app.store.shops.setPlan(w.ana.A, w.ana.c.id, "full");
    await req("POST", "/api/admin/settings", { shopRent: { enabled: false, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all" } }, ock);
    assert.equal((await req("GET", "/api/me/cobros-hub/proofs", null, ack)).status, 200);
  });

  test("Me pagó todo y Deshacer por la API; el log de errores no guarda el token del link (V9)", async () => {
    const g = (await req("GET", "/api/me/dia", null, ack)).json.cobrar.find((x) => x.client === "José Vargas");
    const r = await req("POST", "/api/me/cobros-hub/pay-many", { items: g.items.map((x) => x.id), idempotencyKey: "pm1" }, ack);
    assert.equal(r.status, 200);
    assert.equal((await req("POST", `/api/me/cobros-hub/undo/${r.json.undoId}`, {}, bck)).status, 404);
    assert.equal((await req("POST", `/api/me/cobros-hub/undo/${r.json.undoId}`, {}, ack)).status, 200);
    const tok = app.store.subs.link(w.ana.A, w.ids.aidD, w.ids.papa).token;
    app.store.hubCobros.publicPay = () => { throw new Error("falla de prueba"); };
    await req("GET", `/api/cobro/${tok}/pago`);
    assert.ok(logs.some((l) => l.includes("/api/cobro/…")), "se anota el error");
    assert.ok(!logs.some((l) => l.includes(tok)), "sin el token");
  });
});
