// Dominio propio: gabostore.lat muestra la tienda, www va al dominio principal y GaboHub vive en /hub.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createApp } from "../dist/server/app.js";

const get = (port, host, path) => new Promise((ok, bad) => {
  const r = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ status: res.statusCode, location: res.headers.location, body: b })); });
  r.on("error", bad); r.end();
});

async function boot(publicOrigin) {
  const dir = mkdtempSync(join(tmpdir(), "gs-dom-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, publicOrigin, staticDir: "public" });
  const port = await app.listen(0, "127.0.0.1");
  return { port, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Dominio propio", () => {
  let s;
  before(async () => { s = await boot("https://gabostore.lat"); });
  after(() => s.stop());
  test("la portada del dominio es la tienda y GaboHub queda en /hub", async () => {
    const r = await get(s.port, "gabostore.lat", "/");
    assert.equal(r.status, 302);
    assert.equal(r.location, "/tienda/");
    const hub = await get(s.port, "gabostore.lat", "/hub");
    assert.equal(hub.status, 200);
    assert.match(hub.body, /<html/i);
    assert.equal((await get(s.port, "gabostore.lat", "/tienda/")).status, 200);
    assert.equal((await get(s.port, "gabostore.lat", "/r/alguien")).status, 200, "las páginas de revendedores siguen andando");
  });
  test("www va al dominio principal sin perder la dirección", async () => {
    const r = await get(s.port, "www.gabostore.lat", "/r/carla?x=1");
    assert.equal(r.status, 301);
    assert.equal(r.location, "https://gabostore.lat/r/carla?x=1");
  });
  test("el link de Railway sigue mostrando GaboHub en la portada", async () => {
    const r = await get(s.port, "tienda-production-8c7b.up.railway.app", "/");
    assert.equal(r.status, 200);
  });
  test("el mapa del sitio incluye /hub", async () => {
    const r = await get(s.port, "gabostore.lat", "/sitemap.xml");
    assert.match(r.body, /https:\/\/gabostore\.lat\/hub</);
  });
});

describe("Sin dominio propio (link de Railway como origen)", () => {
  test("no redirige nada", async () => {
    const s = await boot("https://tienda-production-8c7b.up.railway.app");
    try { assert.equal((await get(s.port, "tienda-production-8c7b.up.railway.app", "/")).status, 200); }
    finally { await s.stop(); }
  });
});
