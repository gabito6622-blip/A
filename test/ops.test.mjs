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
