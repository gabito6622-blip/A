// Dominio propio: gabostore.lat muestra la tienda (sin salto), www va al dominio principal y GaboHub vive en /hub.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

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
    // Sin salto: la portada responde la tienda directo (antes era un 302 a /tienda/ y podía asomar otra página).
    const r = await get(s.port, "gabostore.lat", "/");
    assert.equal(r.status, 200);
    assert.equal(r.location, undefined);
    assert.match(r.body, /<meta name="gs-mode" content="store">/);
    assert.doesNotMatch((await get(s.port, "gabostore.lat", "/hub")).body, /gs-mode/, "GaboHub no se marca como tienda");
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

test("en el celular, gabostore.lat abre la tienda al toque, sin pasar por GaboHub", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const s = await boot("https://gabostore.lat");
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP gabostore.lat 127.0.0.1"] });
  try {
    const page = await b.newPage({ viewport: { width: 360, height: 740 } });
    const navs = []; page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs.push(new URL(f.url()).pathname); });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://gabostore.lat:${s.port}/`);
    await page.locator("#sout").getByText(/Cargando/).waitFor({ state: "detached", timeout: 15_000 });
    assert.deepEqual([...new Set(navs)], ["/"], "una sola página, sin redirecciones");
    assert.equal(await page.evaluate(() => document.querySelector('meta[name="gs-mode"]')?.content), "store");
    assert.equal(await page.locator(".bnav").isVisible(), true, "la barra de abajo de la tienda");
    assert.match(await page.locator("body").innerText(), /¿Sos revendedor\?/, "es la tienda (el link a GaboHub solo sale en la tienda), no la portada de GaboHub");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await s.stop(); }
});

describe("Direcciones con mayúsculas (14/11/2026)", () => {
  let s;
  before(async () => { s = await boot("https://gabostore.lat"); });
  after(() => s.stop());
  test("gabostore.lat/PANEL lleva al panel (antes mostraba la portada de GaboHub)", async () => {
    for (const [from, to] of [["/PANEL", "/panel"], ["/Panel", "/panel"], ["/HUB", "/hub"], ["/Tienda/", "/tienda/"], ["/R/MauMau", "/r/maumau"], ["/Codigos?x=1", "/codigos?x=1"]]) {
      const r = await get(s.port, "gabostore.lat", from);
      assert.equal(r.status, 301, from);
      assert.equal(r.location, to, from);
    }
    const p = await get(s.port, "gabostore.lat", "/panel");
    assert.equal(p.status, 200);
    assert.match(p.body, /<title>Panel/);
  });
  test("no toca lo que distingue mayúsculas: API, archivos y links de cobro", async () => {
    assert.notEqual((await get(s.port, "gabostore.lat", "/c/AbC123xyz")).status, 301);
    assert.notEqual((await get(s.port, "gabostore.lat", "/Shop.js")).status, 301);
    assert.notEqual((await get(s.port, "gabostore.lat", "/api/Settings")).status, 301);
  });
  test("el link de códigos conserva su token con mayúsculas (antes se rompían 2 de cada 3)", async () => {
    // El token distingue mayúsculas: pasarlo a minúsculas lo invalidaba («Link no válido»).
    for (const tok of ["AbcDEFghiJKL123xyzQWE45", "abc_DEF", "UAIHsgqsw1RME0cjd6fsjshe"]) {
      const r = await get(s.port, "gabostore.lat", `/codigos/${tok}`);
      assert.notEqual(r.status, 301, tok);
    }
    // Solo la palabra fija pasa a minúsculas; el token queda igual.
    const r = await get(s.port, "gabostore.lat", "/Codigos/AbC_12");
    assert.equal(r.status, 301);
    assert.equal(r.location, "/codigos/AbC_12");
  });
});
