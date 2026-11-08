// Operación en producción: IP real detrás de un proxy, respaldos y avisos para el dueño.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../dist/server/app.js";

const PASS = "clave-del-dueño-123";

/** Entradas de un .zip (método store) → Map nombre → Buffer. */
function unzip(buf) {
  const out = new Map();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), size = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString("utf8");
    const raw = buf.subarray(p + 30 + nlen + elen, p + 30 + nlen + elen + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : raw);
    p += 30 + nlen + elen + size;
  }
  return out;
}

async function start(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gs-ops-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, otpSender: () => {}, ...opts });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const login = async (username, password) => {
    const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie").split(";")[0];
  };
  const call = (method, path, cookie, body, headers = {}) => fetch(base + path, {
    method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { dir, app, base, login, call, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("IP real detrás de un proxy", () => {
  const askCode = (s, i, headers) => s.call("POST", "/api/auth/customer/request-code", "", { phone: `+5917000${String(i).padStart(4, "0")}`, name: "X" }, headers);

  test("sin GS_TRUST_PROXY se ignora X-Forwarded-For (no se puede falsear la IP)", async () => {
    const s = await start();
    try {
      const st = [];
      for (let i = 0; i < 11; i++) st.push((await askCode(s, i, { "x-forwarded-for": `10.0.0.${i}` })).status);
      assert.deepEqual(st.slice(0, 10), Array(10).fill(200));
      assert.equal(st[10], 429);
    } finally { await s.stop(); }
  });

  test("con trustProxy cada cliente real tiene su propio límite", async () => {
    const s = await start({ trustProxy: true });
    try {
      for (let i = 0; i < 11; i++) assert.equal((await askCode(s, i, { "x-forwarded-for": `10.0.0.${i}, 172.16.0.1` })).status, 200);
      for (let i = 11; i < 21; i++) assert.equal((await askCode(s, i, { "x-forwarded-for": "10.9.9.9" })).status, 200);
      assert.equal((await askCode(s, 21, { "x-forwarded-for": "10.9.9.9" })).status, 429);
    } finally { await s.stop(); }
  });
});

describe("respaldos", () => {
  let s, owner, seller;
  before(async () => {
    s = await start();
    owner = await s.login("gabriel", PASS);
    assert.equal((await s.call("POST", "/api/admin/staff", owner, { username: "vende", name: "Vende", role: "seller", password: "vendedor-clave-1" })).status, 200);
    seller = await s.login("vende", "vendedor-clave-1");
    writeFileSync(join(s.dir, "uploads", "qr-prueba.png"), Buffer.from("png-falso"));
  });
  after(() => s.stop());

  test("el respaldo diario se hace solo una vez por día", () => {
    const r1 = s.app.runJobs();
    assert.match(r1.backup, /^respaldo-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    assert.equal(s.app.runJobs().backup, undefined);
    assert.equal(readdirSync(join(s.dir, "backups")).filter((n) => n.endsWith(".zip")).length, 1);
  });

  test("solo el dueño lista, crea y descarga; el .zip trae la base completa y los archivos", async () => {
    assert.equal((await s.call("GET", "/api/admin/backups", seller)).status, 403);
    assert.equal((await s.call("POST", "/api/admin/backups", seller, {})).status, 403);
    assert.equal((await s.call("GET", "/api/admin/backups", "")).status, 401);
    const made = await (await s.call("POST", "/api/admin/backups", owner, {})).json();
    assert.match(made.name, /^respaldo-.*\.zip$/);
    const list = await (await s.call("GET", "/api/admin/backups", owner)).json();
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].name, made.name);

    assert.equal((await s.call("GET", `/api/admin/backups/${made.name}`, seller)).status, 403);
    assert.equal((await s.call("GET", "/api/admin/backups/..%2Fgabriel.db", owner)).status, 404);
    assert.equal((await s.call("GET", "/api/admin/backups/respaldo-2020-01-01-0000.zip", owner)).status, 404);
    const r = await s.call("GET", `/api/admin/backups/${made.name}`, owner);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/zip");
    const files = unzip(Buffer.from(await r.arrayBuffer()));
    assert.ok(files.has("LEEME.txt"));
    assert.equal(files.get("uploads/qr-prueba.png").toString(), "png-falso");

    // La base del respaldo se puede abrir y tiene el estado (con el usuario vendedor).
    const dbFile = join(s.dir, "restaurada.db");
    writeFileSync(dbFile, files.get("gabriel.db"));
    const db = new DatabaseSync(dbFile);
    const row = db.prepare("SELECT state FROM state_versions ORDER BY version DESC LIMIT 1").get();
    db.close();
    assert.ok(Object.values(JSON.parse(row.state).staff).some((u) => u.username === "vende"));

    const audit = s.app.store.engine.s.audit.map((a) => a.action);
    assert.ok(audit.includes("backup.create") && audit.includes("backup.download"));
  });
});

describe("avisos para el dueño por HTTP", () => {
  let s, owner, seller;
  before(async () => {
    s = await start();
    owner = await s.login("gabriel", PASS);
    await s.call("POST", "/api/admin/staff", owner, { username: "admin1", name: "Admin", role: "admin", password: "admin-clave-123" });
    seller = await s.login("admin1", "admin-clave-123");
  });
  after(() => s.stop());

  test("solo el dueño ve y cambia su WhatsApp de avisos", async () => {
    assert.equal((await s.call("GET", "/api/admin/alerts", seller)).status, 403);
    assert.equal((await s.call("POST", "/api/admin/alerts", seller, { phone: "+59170000000" })).status, 403);
    const r = await s.call("POST", "/api/admin/alerts", owner, { phone: "+591 7000 0000", supplierDaysBefore: 3 });
    assert.equal(r.status, 200);
    const got = await (await s.call("GET", "/api/admin/alerts", owner)).json();
    assert.deepEqual(got, { phone: "+59170000000", payments: true, supplierExpiry: true, supplierDaysBefore: 3 });
  });
});

describe("página del revendedor por HTTP", () => {
  let s, owner, rev;
  const PNG1 = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
  before(async () => {
    s = await start();
    owner = await s.login("gabriel", PASS);
    const st = s.app.store;
    const sys = { id: "t", role: "owner" };
    st.catalog.upsertProduct(sys, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    st.catalog.upsertPriceGroup(sys, { id: "rev", name: "Rev", prices: { nf: 2500 } });
    const c = st.catalog.createCustomer(sys, { name: "Rosa Rev", phone: "+59171111111", kind: "reseller", priceGroupId: "rev" });
    const link = await (await s.call("POST", `/api/admin/customers/${c.id}/login-link`, owner, {})).json();
    const r = await s.call("POST", "/api/auth/customer/link", "", { token: link.url.split("#acceso=")[1] });
    assert.equal(r.status, 200);
    rev = r.headers.get("set-cookie").split(";")[0];
  });
  after(() => s.stop());

  test("arma, publica y se ve en /r/<slug>, con logo; sin costos", async () => {
    assert.equal((await s.call("PUT", "/api/me/prices", rev, { prices: { nf: 4000 } })).status, 200);
    const up = await s.call("PUT", "/api/me/shop", rev, { slug: "rosa-tv", title: "Rosa TV", bgStyle: "aurora", cardStyle: "neon", headingFont: "orbitron" });
    assert.equal(up.status, 200);
    assert.equal((await s.call("GET", "/api/shops/rosa-tv", "")).status, 404, "apagada no se ve");
    assert.equal((await s.call("GET", "/api/shops/rosa-tv", rev)).status, 200, "el revendedor ve su vista previa");
    assert.equal((await s.call("POST", "/api/me/shop/logo", rev, { contentBase64: PNG1 })).status, 200);
    assert.equal((await s.call("PUT", "/api/me/shop", rev, { enabled: true })).status, 200);
    const pub = await (await s.call("GET", "/api/shops/rosa-tv", "")).json();
    assert.equal(pub.title, "Rosa TV");
    assert.equal(pub.hasLogo, true);
    assert.deepEqual(pub.products.map((p) => p.price), [4000]);
    assert.ok(!JSON.stringify(pub).includes("2500"));
    const logo = await s.call("GET", "/api/shops/rosa-tv/logo", "");
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.equal((await s.call("POST", "/api/me/shop/banner", rev, { contentBase64: Buffer.from("%PDF-1.4 x").toString("base64") })).status, 400, "la portada tiene que ser imagen");
  });

  test("el dueño bloquea la página", async () => {
    const list = await (await s.call("GET", "/api/admin/shops", owner)).json();
    assert.equal(list[0].slug, "rosa-tv");
    assert.equal((await s.call("POST", `/api/admin/customers/${list[0].customerId}/shop-block`, owner, { blocked: true })).status, 200);
    assert.equal((await s.call("GET", "/api/shops/rosa-tv", "")).status, 404);
    assert.equal((await s.call("GET", "/api/shops/rosa-tv/logo", "")).status, 404);
  });
});

describe("verificación en dos pasos del panel", () => {
  test("los códigos coinciden con el estándar (RFC 6238)", async () => {
    const { totpAt, verifyTotp, base32Encode } = await import("../dist/server/security.js");
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert.equal(totpAt(secret, 1), "287082", "T=59 s");
    assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), "081804");
    assert.equal(verifyTotp(secret, "287 082", 59_000), 1);
    assert.equal(verifyTotp(secret, "000000", 59_000), null);
  });

  test("activar, entrar con código, no reutilizar el código, desactivar y recuperar", async () => {
    const { totpAt } = await import("../dist/server/security.js");
    let t = Date.UTC(2026, 10, 7, 12, 0, 0);
    const s = await start({ clock: { now: () => t } });
    try {
      const owner = await s.login("gabriel", PASS);
      assert.deepEqual(await (await s.call("GET", "/api/admin/me/2fa", owner)).json(), { enabled: false });
      const setup = await (await s.call("POST", "/api/admin/me/2fa/setup", owner, {})).json();
      assert.match(setup.uri, /^otpauth:\/\/totp\//);
      const code = () => totpAt(setup.secret, Math.floor(t / 30_000));
      assert.equal((await s.call("POST", "/api/admin/me/2fa/enable", owner, { code: "000000" })).status, 400);
      assert.equal((await s.call("POST", "/api/admin/me/2fa/enable", owner, { code: code() })).status, 200);
      const login = (body) => s.call("POST", "/api/auth/staff/login", "", { username: "gabriel", password: PASS, ...body });
      let r = await login({});
      assert.equal(r.status, 401); assert.equal((await r.json()).error, "TOTP_REQUIRED");
      assert.equal((await login({ code: "111111" })).status, 401);
      t += 60_000;
      const c1 = code();
      assert.equal((await login({ code: c1 })).status, 200, "con contraseña + código entra");
      assert.equal((await login({ code: c1 })).status, 401, "el mismo código no sirve dos veces");
      assert.equal((await s.call("POST", "/api/admin/me/2fa/disable", owner, { password: "mala", code: code() })).status, 401);
      assert.equal(s.app.resetTwoFactor("gabriel"), true, "recuperación desde el servidor");
      assert.equal((await login({})).status, 200, "sin 2FA vuelve a entrar solo con contraseña");
    } finally { await s.stop(); }
  });
});

describe("contraseñas de cuentas cifradas en la base", () => {
  test("con GS_DATA_KEY no quedan legibles; sin la clave correcta no se abren; las viejas se cifran solas", async () => {
    const { Db } = await import("../dist/server/db.js");
    const { DatabaseSync } = await import("node:sqlite");
    const dir = mkdtempSync(join(tmpdir(), "gs-enc-"));
    const file = join(dir, "g.db");
    const state = { accounts: { a1: { id: "a1", email: "x@y.z", supplierId: "s", password: "Secreta#123" }, a2: { id: "a2", email: "p@q.r", supplierId: "s", password: "" } }, staff: { u: { password: "no-es-cuenta" } } };
    try {
      // 1) Sin clave (como estaba): queda legible
      let db = new Db(file);
      db.saveState(state, 1);
      db.close();
      // 2) Con clave: al arrancar cifra lo viejo y lo nuevo
      db = new Db(file, { dataKey: "clave-larga-de-prueba" });
      assert.equal(db.encryptExisting(), 1);
      db.saveState(state, 2);
      assert.equal(db.loadLatest().accounts.a1.password, "Secreta#123", "en memoria se lee normal");
      db.close();
      const raw = new DatabaseSync(file);
      const rows = raw.prepare("SELECT state FROM state_versions").all().map((r) => r.state).join("\n");
      raw.close();
      assert.ok(!rows.includes("Secreta#123"), "ninguna versión guarda la contraseña legible");
      assert.match(rows, /"password":"enc1:/);
      assert.match(rows, /"password":""/, "las vacías quedan vacías");
      assert.match(rows, /"password":"no-es-cuenta"/, "solo se cifran contraseñas de cuentas");
      // 3) Sin clave o con otra clave: no abre
      db = new Db(file);
      assert.throws(() => db.loadLatest(), /falta la clave GS_DATA_KEY/);
      db.close();
      db = new Db(file, { dataKey: "otra-clave" });
      assert.throws(() => db.loadLatest(), /no es la misma/);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("entrar con número y PIN (sin bot de WhatsApp)", () => {
  test("el dueño da un PIN, el revendedor entra con su número (con o sin +591), lo cambia, y se bloquea si prueban de más", async () => {
    const s = await start();
    try {
      const own = await s.login("gabriel", PASS);
      const c = await (await s.call("POST", "/api/admin/customers", own, { name: "Ari", phone: "+591 70001234", kind: "reseller", priceGroupId: "revendedor" })).json();
      const { pin } = await (await s.call("POST", `/api/admin/customers/${c.id}/login-pin`, own, {})).json();
      assert.match(pin, /^\d{4}$/);
      const bad = await s.call("POST", "/api/auth/customer/pin", "", { phone: "70001234", pin: pin === "0000" ? "1111" : "0000" });
      assert.equal(bad.status, 401);
      const ok = await s.call("POST", "/api/auth/customer/pin", "", { phone: "70001234", pin });
      assert.equal(ok.status, 200);
      const ck = ok.headers.get("set-cookie").split(";")[0];
      const me = await (await s.call("GET", "/api/me", ck)).json();
      assert.equal(me.name, "Ari");
      assert.equal((await s.call("POST", "/api/me/login-pin", ck, { current: "9999", pin: "4321" })).status, 401, "pide el PIN actual");
      assert.equal((await s.call("POST", "/api/me/login-pin", ck, { current: pin, pin: "4321" })).status, 200);
      assert.equal((await s.call("POST", "/api/auth/customer/pin", "", { phone: "+59170001234", pin: "4321" })).status, 200);
      for (let i = 0; i < 5; i++) await s.call("POST", "/api/auth/customer/pin", "", { phone: "+59170001234", pin: "0001" });
      assert.equal((await s.call("POST", "/api/auth/customer/pin", "", { phone: "+59170001234", pin: "4321" })).status, 429);
    } finally { await s.stop(); }
  });
});
