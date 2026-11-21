// Auditoría de seguridad (20/11/2026). Cada prueba reproduce un problema real que se encontró y queda arreglado:
//  1. PIN de 4 números: los frenos iban por «cómo se escribió el número», no por persona. Con «71000001», «59171000001»,
//     «971000001»… (todas la misma cuenta) se podían probar los 10.000 PINs sin que nada frenara.
//  2. PIN: tope por IP sumando todos los números (para que no prueben «1234» en cada cliente).
//  3. Usuario del equipo: « gabriel» y «gabriel» tenían frenos separados.
//  4. Código por WhatsApp: se mandaba al número escrito (que podía ser de otra persona con los mismos 8 últimos números).
//  5. Link de cobro con «Ver mi código»: mostraba también el código para CAMBIAR EL CORREO de la cuenta.
//  6. Atención (seller) cambiaba el correo de un revendedor y con «Olvidé mi contraseña» entraba a su cuenta.
//  7. Atención (seller) creaba un cliente final con la lista de precios de revendedor.
// Datos ficticios en carpetas temporales; nada real (sin red, sin WhatsApp, sin correos).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

const owner = { id: "u_owner", role: "owner" };
const DAY = 864e5, MIN = 60_000;

async function boot(extra = {}) {
  const clock = { t: Date.UTC(2026, 10, 20, 15), now() { return this.t; } };
  const dir = mkdtempSync(join(tmpdir(), "gs-audsec-"));
  const app = createApp({ dataDir: dir, jobs: false, clock, log: () => {}, fetchImpl: async () => { throw new Error("sin red en las pruebas"); }, ...extra });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = async (method, path, body, ck) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* no es JSON */ }
    return { status: r.status, json, ck: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
  return { app, clock, call, ock, s: app.store, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("auditoría · ingreso con número y PIN", () => {
  let w, ana, pin;
  before(async () => {
    w = await boot();
    ana = w.s.catalog.createCustomer(owner, { name: "Ana Flores", phone: "+59171000001", kind: "reseller" });
    pin = (await w.call("POST", `/api/admin/customers/${ana.id}/login-pin`, {}, w.ock)).json.pin;
  });
  after(() => w.stop());

  test("cambiar la forma de escribir el número NO esquiva el freno: a los 5 fallos queda frenada la persona", async () => {
    const forms = ["+59171000001", "59171000001", "71000001", "071000001", "971000001", "5971000001", "0071000001", "1171000001"];
    // Todas las formas son la misma cuenta (así entra la gente): primero lo comprobamos con el PIN correcto.
    const wrong = pin === "0000" ? "0001" : "0000";
    const st = [];
    for (const phone of forms) st.push((await w.call("POST", "/api/auth/customer/pin", { phone, pin: wrong })).status);
    assert.deepEqual(st.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.ok(st.slice(5).every((x) => x === 429), `después de 5 fallos, frenado con cualquier forma: ${st}`);
    // Ni siquiera el PIN correcto entra mientras está frenada (si no, se seguiría probando).
    const ok = await w.call("POST", "/api/auth/customer/pin", { phone: "71000001", pin });
    assert.equal(ok.status, 429);
    assert.equal(ok.ck, "", "no abre sesión");
  });

  test("la tienda le da un PIN nuevo → se levanta el freno y entra al toque", async () => {
    const nuevo = (await w.call("POST", `/api/admin/customers/${ana.id}/login-pin`, { pin: "5827" }, w.ock)).json.pin;
    assert.equal(nuevo, "5827");
    // El freno corto por IP sigue 15 min: otra IP no la tenemos en la prueba, así que pasamos el reloj.
    w.clock.t += 16 * MIN;
    const r = await w.call("POST", "/api/auth/customer/pin", { phone: "+591 7100 0001", pin: "5827" });
    assert.equal(r.status, 200);
    assert.ok(r.ck.startsWith("gs_session="));
  });

  test("probar un PIN en muchos clientes desde la misma IP se frena a los 40 fallos", async () => {
    w.clock.t += 16 * MIN;
    for (let i = 0; i < 45; i++) w.s.catalog.createCustomer(owner, { name: `Cliente ${i}`, phone: `+5917300${String(i).padStart(4, "0")}` });
    const st = [];
    for (let i = 0; i < 45; i++) st.push((await w.call("POST", "/api/auth/customer/pin", { phone: `+5917300${String(i).padStart(4, "0")}`, pin: "1234" })).status);
    assert.equal(st.filter((x) => x === 401).length, 40, `${st}`);
    assert.ok(st.slice(40).every((x) => x === 429));
  });
});

describe("auditoría · ingreso del equipo", () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.stop());

  test("« gabriel», «gabriel » y «GABRIEL» comparten el freno de intentos", async () => {
    const st = [];
    for (let i = 0; i < 8; i++) st.push((await w.call("POST", "/api/auth/staff/login", { username: `${" ".repeat(i)}${i % 2 ? "GABRIEL" : "gabriel"}${" ".repeat(i % 3)}`, password: `mala-${i}` })).status);
    assert.deepEqual(st.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.ok(st.slice(5).every((x) => x === 429), `${st}`);
  });
});

describe("auditoría · código por WhatsApp", () => {
  let w; const sent = [];
  before(async () => { w = await boot({ otpSender: (phone, code) => { sent.push({ phone, code }); } }); });
  after(() => w.stop());

  test("el código va al número guardado de la cuenta, no al que escribieron", async () => {
    w.s.catalog.createCustomer(owner, { name: "Rosa", phone: "+59171234567" });
    // «54971234567» termina igual: el sistema lo toma como la cuenta de Rosa. El código no puede ir a ese otro número.
    const r = await w.call("POST", "/api/auth/customer/request-code", { phone: "54971234567" });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].phone, "+59171234567");
    // Rosa escribe su número de cualquier forma: el código le llega igual y entra.
    const r2 = await w.call("POST", "/api/auth/customer/request-code", { phone: "71234567" });
    assert.equal(r2.status, 200);
    assert.equal(sent[1].phone, "+59171234567");
    assert.equal((await w.call("POST", "/api/auth/customer/verify", { phone: "71234567", code: sent[1].code })).status, 200);
    // Un número nuevo (registro) sí recibe el código en el número que escribió.
    await w.call("POST", "/api/auth/customer/request-code", { phone: "+59176543210", name: "Nuevo" });
    assert.equal(sent[2].phone, "+59176543210");
  });
});

describe("auditoría · «Ver mi código» en el link de cobro", () => {
  let w, rosa, rck, token, mbx;
  before(async () => {
    w = await boot();
    const s = w.s;
    s.catalog.upsertProduct(owner, { id: "net-alq", name: "Netflix (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 4000, published: true, resellersOnly: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "net-alq", supplierId: "andes", email: "net-rosa@x.lat", password: "Clave-Secreta#77", supplierExpiresAt: w.clock.t + 90 * DAY, cost: 2500, profiles: [{ label: "Cuenta completa" }] });
    mbx = s.codes.configureMailbox(owner, { address: "codigos.tienda@gmail.com", host: "imap.gmail.com" }).id;
    rosa = s.catalog.createCustomer(owner, { name: "Rosa Mamani", phone: "+59171111111", kind: "reseller" });
    const aid = s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "net-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    await w.call("POST", `/api/admin/customers/${rosa.id}/login-pin`, { pin: "2468" }, w.ock);
    rck = (await w.call("POST", "/api/auth/customer/pin", { phone: "+59171111111", pin: "2468" })).ck;
    w.clock.t += MIN;
    const sub = (await w.call("POST", `/api/me/subs/${aid}`, { name: "Ana Pérez", phone: "72223344", label: "Mamá", expiresAt: w.clock.t + 10 * DAY, price: 1500 }, rck)).json.sub;
    token = (await w.call("POST", `/api/me/subs/${aid}/${sub.id}/link`, {}, rck)).json.token;
    assert.equal((await w.call("POST", "/api/admin/self-codes", { on: true }, w.ock)).status, 200);
    assert.equal((await w.call("POST", `/api/me/self-codes/rental/${aid}`, { on: true }, rck)).status, 200);
    w.clock.t += MIN;
  });
  after(() => w.stop());

  test("ve el código de inicio de sesión, pero NUNCA el de cambio de correo", async () => {
    const from = "Netflix <info@account.netflix.com>";
    w.s.codes.ingest(owner, mbx, { to: "net-rosa@x.lat", from, subject: "Tu código de inicio de sesión", body: "Ingresá este código para iniciar sesión:\n482913", receivedAt: w.clock.t });
    const cc = w.s.codes.ingest(owner, mbx, { to: "net-rosa@x.lat", from, subject: "Netflix: código para cambiar tu correo electrónico", body: "Tu código para cambiar el correo:\n775511", receivedAt: w.clock.t });
    assert.equal(cc?.kind, "cambio_correo", "el lector lo guarda (el dueño lo ve en su panel)");
    const r = await w.call("GET", `/api/cobro/${token}/codes`);
    assert.equal(r.status, 200);
    const got = r.json.codes.map((c) => c.code);
    assert.ok(got.includes("482913"), "el de inicio de sesión sí");
    assert.ok(!got.includes("775511"), "el de cambio de correo no");
    assert.ok(r.json.codes.every((c) => c.kind !== "cambio_correo"));
  });
});

describe("auditoría · Atención (seller) no se adueña de cuentas con plata", () => {
  let w, sck, rev, rico, pobre;
  before(async () => {
    w = await boot();
    rev = w.s.catalog.createCustomer(owner, { name: "Rev Uno", phone: "+59171000021", kind: "reseller", email: "rev@x.lat" });
    rico = w.s.catalog.createCustomer(owner, { name: "Cliente Con Saldo", phone: "+59171000022" });
    w.s.wallet.adjust(owner, rico.id, 5000, "saldo de prueba");
    pobre = w.s.catalog.createCustomer(owner, { name: "Cliente Sin Saldo", phone: "+59171000023" });
    await w.call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" }, w.ock);
    sck = (await w.call("POST", "/api/auth/staff/login", { username: "seba", password: "clave-larga-seller-1" })).ck;
  });
  after(() => w.stop());

  test("no cambia el correo ni el número de un revendedor o de un cliente con saldo (con eso pedía «Olvidé mi contraseña»)", async () => {
    for (const [id, body] of [[rev.id, { email: "seba@x.lat" }], [rev.id, { phone: "+59179999999" }], [rico.id, { email: "seba@x.lat" }], [rico.id, { phone: "+59179999998" }]]) {
      const r = await w.call("POST", `/api/admin/customers/${id}`, body, sck);
      assert.equal(r.status, 403, JSON.stringify(body));
    }
    assert.equal(w.s.engine.s.customers[rev.id].email, "rev@x.lat");
    assert.equal(w.s.engine.s.customers[rico.id].phone, "+59171000022");
    // Guardar la ficha con los mismos datos (como hace el panel) y cambiar el nombre o la nota sí puede.
    const same = await w.call("POST", `/api/admin/customers/${rev.id}`, { name: "Rev Uno Bis", phone: "+59171000021", email: "rev@x.lat", notes: "llamar" }, sck);
    assert.equal(same.status, 200);
    assert.equal(same.json.name, "Rev Uno Bis");
    // Un cliente sin saldo: Atención lo atiende como siempre.
    assert.equal((await w.call("POST", `/api/admin/customers/${pobre.id}`, { email: "nuevo@x.lat", phone: "+59179999997" }, sck)).status, 200);
    // El dueño sí.
    assert.equal((await w.call("POST", `/api/admin/customers/${rev.id}`, { email: "rev2@x.lat" }, w.ock)).status, 200);
  });
});

describe("auditoría · Atención no elige precios de revendedor al crear un cliente", () => {
  let w, sck;
  before(async () => {
    w = await boot();
    w.s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: {} });
    await w.call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" }, w.ock);
    sck = (await w.call("POST", "/api/auth/staff/login", { username: "seba", password: "clave-larga-seller-1" })).ck;
  });
  after(() => w.stop());

  test("con lista de revendedor → 403; sin lista (lo que manda el panel) → se crea con precio normal", async () => {
    assert.equal((await w.call("POST", "/api/admin/customers", { name: "Amigo", phone: "+59171000031", priceGroupId: "revendedor" }, sck)).status, 403);
    const ok = await w.call("POST", "/api/admin/customers", { name: "Amigo", phone: "+59171000031" }, sck);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.priceGroupId, "final");
    assert.equal((await w.call("POST", "/api/admin/customers", { name: "Otro", phone: "+59171000032", priceGroupId: "revendedor" }, w.ock)).status, 200, "el dueño sí");
  });
});
