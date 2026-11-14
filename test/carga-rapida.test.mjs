// Carga rápida de la tienda en el celular (equipo C4, 14/11/2026). Datos ficticios en carpetas temporales; nada real.
//  1. Imágenes: versión chica guardada (PNG en el servidor; JPG/WEBP desde el navegador), la original intacta, el QR nunca.
//  2. Caché: ETag + revalidación o «immutable» con la fecha de subida en ?v=; una imagen cambiada se ve al instante;
//     lo que depende de la sesión (/api/, vista previa, link de cobro) nunca se guarda.
//  3. Módulos: la tienda y /r/<slug> no bajan los del panel del revendedor; GaboHub sí y sigue andando.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { createApp } from "../dist/server/app.js";
import { leerPng, achicar, escribirPng, medidas, TAMANOS } from "../dist/server/imagenes.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PUBLIC = resolve("public");

/* ---------- PNG a mano (para probar todos los tipos) ---------- */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); td.copy(b, 4); b.writeUInt32BE(crc(td), 8 + d.length); return b; };
/** PNG crudo: filas ya empaquetadas (sin el byte de filtro). */
function pngCrudo(w, h, ct, depth, rows, extra = [], interlace = 0) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = ct; ihdr[12] = interlace;
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** Ícono «de fotos» (ruido + degradé) con esquinas transparentes: como los logos de 512 px de la tienda. */
function icono(lado = 512, semilla = 1) {
  const d = new Uint8Array(lado * lado * 4); let x = semilla;
  for (let i = 0; i < lado * lado; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const px = i % lado, py = Math.floor(i / lado), esquina = px < lado / 8 && py < lado / 8;
    d[i * 4] = (px * 255 / lado + (x & 63)) & 255; d[i * 4 + 1] = (py * 255 / lado + ((x >> 6) & 63)) & 255; d[i * 4 + 2] = (semilla * 70 + ((x >> 12) & 63)) & 255; d[i * 4 + 3] = esquina ? 0 : 255;
  }
  return escribirPng({ w: lado, h: lado, data: d });
}
/** Encabezados mínimos de JPG y WEBP (el servidor solo mira el tipo y las medidas: no los dibuja). */
function jpgFalso(w, h, relleno = 0) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), sof, Buffer.alloc(relleno, 7), Buffer.from([0xff, 0xd9])]);
}
function webpFalso(w, h, relleno = 0) {
  const b = Buffer.alloc(30 + relleno); b.write("RIFF", 0, "latin1"); b.writeUInt32LE(b.length - 8, 4); b.write("WEBPVP8X", 8, "latin1");
  b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
}
const ihdrDe = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

describe("imágenes livianas · leer, achicar y escribir PNG sin librerías", () => {
  test("un ícono de 512 px queda de 160 px, mucho más liviano, con su transparencia y sus colores", () => {
    const orig = icono(512);
    const img = leerPng(orig);
    assert.deepEqual([img.w, img.h], [512, 512]);
    const chica = achicar(img, 160);
    assert.deepEqual([chica.w, chica.h], [160, 160]);
    const out = escribirPng(chica);
    assert.ok(out.length < orig.length / 4, `pesa ${out.length} contra ${orig.length}`);
    const back = leerPng(out);
    assert.equal(back.data[3], 0, "la esquina sigue transparente");
    const c = (80 * 160 + 80) * 4, o = (256 * 512 + 256) * 4;
    for (const k of [0, 1, 2]) assert.ok(Math.abs(back.data[c + k] - img.data[o + k]) < 40, "el color del centro se parece");
    assert.equal(back.data[c + 3], 255);
    assert.equal(achicar(img, 600), img, "nunca agranda");
  });
  test("lee PNG de paleta con transparencia, gris de 2 bits y de 16 bits; entrelazado o dañado → null (se sirve la original)", () => {
    const pal = pngCrudo(2, 1, 3, 8, [Buffer.from([0, 1])], [chunk("PLTE", Buffer.from([255, 0, 0, 0, 0, 255])), chunk("tRNS", Buffer.from([128]))]);
    assert.deepEqual([...leerPng(pal).data], [255, 0, 0, 128, 0, 0, 255, 255]);
    const g2 = pngCrudo(4, 1, 0, 2, [Buffer.from([0b00011011])]);
    assert.deepEqual([...leerPng(g2).data].filter((_, i) => i % 4 === 0), [0, 85, 170, 255]);
    const g16 = pngCrudo(1, 1, 6, 16, [Buffer.from([0x12, 0x34, 0xab, 0xcd, 0xff, 0xff, 0x80, 0x00])]);
    assert.deepEqual([...leerPng(g16).data], [0x12, 0xab, 0xff, 0x80]);
    assert.equal(leerPng(pngCrudo(1, 1, 2, 8, [Buffer.from([1, 2, 3])], [], 1)), null);
    assert.equal(leerPng(Buffer.from("no es una imagen")), null);
    assert.equal(leerPng(icono(64).subarray(0, 60)), null);
  });
  test("medidas de PNG, JPG y WEBP leyendo solo el encabezado", () => {
    assert.deepEqual(medidas(icono(64)), { w: 64, h: 64 });
    assert.deepEqual(medidas(jpgFalso(1199, 1312)), { w: 1199, h: 1312 });
    assert.deepEqual(medidas(webpFalso(540, 405)), { w: 540, h: 405 });
    assert.equal(medidas(Buffer.from("hola")), null);
  });
});

/* ---------- servidor ---------- */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-c4-"));
  const app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const s = app.store, O = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(O, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true, category: "Streaming" });
  s.catalog.upsertProduct(O, { id: "canva", name: "Canva", kind: "invite", durationDays: 30, price: 2000, published: true, category: "Diseño" });
  s.catalog.upsertPriceGroup(O, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, canva: 1500 } });
  const req = async (method, path, { cookie, body, headers } = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* no es JSON */ }
    return { status: r.status, h: r.headers, buf, json };
  };
  const staff = (await req("POST", "/api/auth/staff/login", { body: { username: "gabriel", password: "clave-del-dueño-123" } })).h.get("set-cookie").split(";")[0];
  const login = async (c) => { const { json } = await req("POST", `/api/admin/customers/${c.id}/login-pin`, { cookie: staff, body: {} }); return (await req("POST", "/api/auth/customer/pin", { body: { phone: c.phone, pin: json.pin } })).h.get("set-cookie").split(";")[0]; };
  const tienda = (nombre, phone, slug, published) => {
    const c = s.catalog.createCustomer(O, { name: nombre, phone, kind: "reseller", priceGroupId: "revendedor" });
    s.shops.setPage(O, c.id, true);
    s.shops.setupFor(O, c.id, { slug, title: nombre, enabled: published }); // enabled = página publicada
    s.portal.setPrices({ id: "u_" + c.id, role: "reseller", customerId: c.id }, { netflix: 4000 });
    return c;
  };
  const ana = tienda("Ana Ficticia", "+59170000001", "ana-ficticia", true);
  const beto = tienda("Beto Ficticio", "+59170000002", "beto-ficticio", false);
  const cli = s.catalog.createCustomer(O, { name: "Cliente Ficticio", phone: "+59170000003" });
  const ck = { ana: await login(ana), beto: await login(beto), cli: await login(cli) };
  const subir = (path, buf, cookie = staff) => req("POST", path, { cookie, body: { contentBase64: buf.toString("base64") } });
  return { app, s, base, dir, req, staff, ck, subir, ana, beto, stop: async () => { await app.close?.(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("imágenes livianas · servidor y caché", () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t?.stop());

  test("logo del producto: se sirve de 160 px (320 si se pide), la original queda guardada igual; ETag, 304 e «immutable» con ?v=", async () => {
    const orig = icono(512, 2);
    assert.equal((await t.subir("/api/admin/products/netflix/image", orig)).status, 200);
    const ref = t.s.engine.s.products.netflix.imageFileRef;
    const cat = (await t.req("GET", "/api/catalog")).json;
    const v = cat.find((p) => p.id === "netflix").imageV;
    assert.match(v, /^[a-z0-9]+$/, "el catálogo trae la fecha de subida");
    assert.equal(cat.find((p) => p.id === "canva").imageV, undefined, "sin imagen, sin versión");
    const a = await t.req("GET", "/api/products/netflix/image");
    assert.equal(a.h.get("content-type"), "image/png");
    assert.deepEqual(ihdrDe(a.buf), { w: 160, h: 160 });
    assert.ok(a.buf.length < orig.length / 4);
    assert.equal(a.h.get("cache-control"), "no-cache", "sin versión: pregunta siempre (así un cambio se ve al instante)");
    const etag = a.h.get("etag");
    assert.ok(etag);
    const n = await t.req("GET", "/api/products/netflix/image", { headers: { "if-none-match": etag } });
    assert.equal(n.status, 304);
    assert.equal(n.buf.length, 0);
    const iv = await t.req("GET", `/api/products/netflix/image?v=${v}`);
    assert.equal(iv.h.get("cache-control"), "public, max-age=31536000, immutable");
    assert.deepEqual(ihdrDe((await t.req("GET", `/api/products/netflix/image?v=${v}&w=320`)).buf), { w: 320, h: 320 });
    assert.deepEqual(ihdrDe((await t.req("GET", "/api/products/netflix/image?w=9999")).buf), { w: 160, h: 160 }, "un tamaño raro no arma versiones nuevas");
    assert.ok(readFileSync(join(t.dir, "uploads", ref)).equals(orig), "la original sigue intacta");
    assert.ok(readdirSync(join(t.dir, "imagenes-chicas")).some((f) => f.startsWith(ref.slice(0, 32))), "la versión chica quedó guardada");
  });

  test("una imagen cambiada por el dueño se ve nueva al instante (otra ?v=, otro ETag; la dirección vieja ya no es «immutable»)", async () => {
    const v1 = (await t.req("GET", "/api/catalog")).json.find((p) => p.id === "netflix").imageV;
    const viejo = await t.req("GET", `/api/products/netflix/image?v=${v1}`);
    const oldRef = t.s.engine.s.products.netflix.imageFileRef;
    await new Promise((r) => setTimeout(r, 5));
    await t.subir("/api/admin/products/netflix/image", icono(512, 3));
    const v2 = (await t.req("GET", "/api/catalog")).json.find((p) => p.id === "netflix").imageV;
    assert.notEqual(v2, v1);
    const conVieja = await t.req("GET", `/api/products/netflix/image?v=${v1}`, { headers: { "if-none-match": viejo.h.get("etag") } });
    assert.equal(conVieja.status, 200, "el ETag viejo ya no sirve: baja la nueva");
    assert.equal(conVieja.h.get("cache-control"), "no-cache");
    assert.ok(!conVieja.buf.equals(viejo.buf));
    assert.ok(!existsSync(join(t.dir, "uploads", oldRef)), "la vieja se borró");
    assert.ok(!readdirSync(join(t.dir, "imagenes-chicas")).some((f) => f.startsWith(oldRef.slice(0, 32))), "y sus versiones chicas también");
    // Logo y portada de la tienda: la fecha va en /api/settings (antes era Date.now(): se bajaban en cada visita).
    await t.subir("/api/admin/settings/logo", icono(400, 4));
    const l1 = (await t.req("GET", "/api/settings")).json.logoV;
    assert.deepEqual(ihdrDe((await t.req("GET", `/api/settings/logo?v=${l1}`)).buf), { w: 256, h: 256 });
    await new Promise((r) => setTimeout(r, 5));
    await t.subir("/api/admin/settings/logo", icono(400, 5));
    assert.notEqual((await t.req("GET", "/api/settings")).json.logoV, l1);
  });

  test("el QR de cobro nunca se achica (tamaño completo, se puede escanear), pero tiene ETag", async () => {
    const qr = icono(1200, 6);
    await t.subir("/api/admin/settings/qr", qr);
    const r = await t.req("GET", "/api/settings/qr");
    assert.ok(r.buf.equals(qr), "el mismo archivo que se subió");
    assert.ok(r.h.get("etag"));
    assert.equal((await t.req("GET", "/api/settings/qr", { headers: { "if-none-match": r.h.get("etag") } })).status, 304);
    await t.subir("/api/me/shop/qr", qr, t.ck.ana);
    assert.ok((await t.req("GET", "/api/shops/ana-ficticia/qr")).buf.equals(qr), "el QR del revendedor tampoco");
  });

  test("lo que depende de la sesión no se guarda: /api/ con datos, vista previa de una página apagada", async () => {
    for (const p of ["/api/settings", "/api/catalog", "/api/me", "/api/shops/ana-ficticia"]) assert.equal((await t.req("GET", p, { cookie: t.ck.ana })).h.get("cache-control"), "no-store", p);
    await t.subir("/api/me/shop/logo", icono(300, 7), t.ck.beto);
    const prev = await t.req("GET", "/api/shops/beto-ficticio/logo", { cookie: t.ck.beto });
    assert.equal(prev.status, 200, "Beto ve su logo en la vista previa");
    assert.equal(prev.h.get("cache-control"), "no-store", "pero no se guarda: la página está apagada");
    assert.equal(prev.h.get("etag"), null);
    assert.equal((await t.req("GET", "/api/shops/beto-ficticio/logo", { cookie: t.ck.ana })).status, 404, "otra revendedora no la ve");
    assert.equal((await t.req("GET", "/api/shops/beto-ficticio/logo")).status, 404, "nadie de afuera tampoco");
    await t.subir("/api/me/shop/logo", icono(300, 8), t.ck.ana);
    const pub = await t.req("GET", "/api/shops/ana-ficticia/logo");
    assert.equal(pub.h.get("cache-control"), "no-cache", "publicada: cualquiera la ve igual, se puede guardar");
    assert.ok(pub.h.get("etag"));
    const sh = (await t.req("GET", "/api/shops/ana-ficticia")).json;
    assert.match(sh.logoV, /^[a-z0-9]+$/);
    assert.equal((await t.req("GET", `/api/shops/ana-ficticia/logo?v=${sh.logoV}`)).h.get("cache-control"), "public, max-age=31536000, immutable");
  });

  test("JPG/WEBP: el navegador del dueño manda la versión chica; cada revendedor solo la de SU página", async () => {
    await t.subir("/api/admin/settings/banner", jpgFalso(800, 600, 50_000));
    const pend = (await t.req("GET", "/api/admin/imagenes/pendientes", { cookie: t.staff })).json;
    assert.deepEqual(pend.find((x) => x.clave === "banner"), { clave: "banner", url: "/api/settings/banner", lados: [540], jpg: true }, "800 px: falta solo la de 540");
    assert.ok(!pend.some((x) => /qr/i.test(x.clave + x.url)), "el QR nunca está en la lista");
    const post = (body, cookie = t.staff, base = "/api/admin/imagenes") => t.req("POST", `${base}/chica`, { cookie, body });
    const b64 = (b) => b.toString("base64");
    assert.equal((await post({ clave: "banner", lado: 540, base64: b64(icono(64)) })).json.ok, false, "PNG no");
    assert.equal((await post({ clave: "banner", lado: 540, base64: b64(webpFalso(800, 600, 10)) })).json.ok, false, "más grande que lo pedido no");
    assert.equal((await post({ clave: "banner", lado: 777, base64: b64(webpFalso(500, 300, 10)) })).json.ok, false, "un tamaño que no existe no");
    assert.equal((await post({ clave: "banner", lado: 540, base64: b64(webpFalso(540, 405, 60_000)) })).json.ok, false, "si pesa más que la original no sirve");
    const chica = webpFalso(540, 405, 2000);
    assert.equal((await post({ clave: "banner", lado: 540, base64: b64(chica) })).json.ok, true);
    const r = await t.req("GET", "/api/settings/banner?w=540");
    assert.equal(r.h.get("content-type"), "image/webp");
    assert.ok(r.buf.equals(chica));
    assert.ok((await t.req("GET", "/api/settings/banner")).buf.equals(readFileSync(join(t.dir, "uploads", t.s.engine.s.settings.bannerFileRef))), "la de 1080 (más grande que la original) sigue siendo la original");
    assert.ok(!(await t.req("GET", "/api/admin/imagenes/pendientes", { cookie: t.staff })).json.some((x) => x.clave === "banner"), "ya no está pendiente");
    // Permisos: un cliente no; sin sesión no.
    assert.equal((await t.req("GET", "/api/admin/imagenes/pendientes", { cookie: t.ck.ana })).status, 403);
    assert.equal((await t.req("GET", "/api/admin/imagenes/pendientes")).status, 401);
    // Revendedores: cada uno ve y cambia solo lo de su página.
    await t.subir("/api/me/shop/banner", jpgFalso(1600, 1000, 80_000), t.ck.ana);
    await t.subir("/api/me/shop/banner", jpgFalso(1600, 1000, 80_000), t.ck.beto);
    const pa = (await t.req("GET", "/api/me/shop/imagenes/pendientes", { cookie: t.ck.ana })).json;
    assert.deepEqual(pa.map((x) => x.url), ["/api/shops/ana-ficticia/banner"]);
    assert.deepEqual(pa[0].lados, [1080, 540]);
    const pb = (await t.req("GET", "/api/me/shop/imagenes/pendientes", { cookie: t.ck.beto })).json;
    assert.ok(pb.every((x) => x.url.includes("beto-ficticio")), "Beto no ve las de Ana");
    const deBeto = webpFalso(1080, 675, 1000);
    assert.equal((await post({ clave: "banner", lado: 1080, base64: b64(deBeto) }, t.ck.beto, "/api/me/shop/imagenes")).json.ok, true);
    assert.ok(!(await t.req("GET", "/api/shops/ana-ficticia/banner")).buf.equals(deBeto), "lo de Beto no toca la portada de Ana");
    assert.deepEqual((await t.req("GET", "/api/me/shop/imagenes/pendientes", { cookie: t.ck.ana })).json[0].lados, [1080, 540], "Ana sigue con lo suyo pendiente");
    assert.deepEqual((await t.req("GET", "/api/me/shop/imagenes/pendientes", { cookie: t.ck.cli })).json, [], "un cliente sin página: nada");
    assert.equal((await post({ clave: "banner", lado: 540, base64: b64(chica) }, t.ck.cli, "/api/me/shop/imagenes")).status, 404);
    assert.deepEqual(TAMANOS.portada, [1080, 540]);
  });

  test("archivos estáticos: ETag y revalidación, brotli o gzip; el HTML avisa los módulos (sin los del panel en la tienda)", async () => {
    const a = await t.req("GET", "/shop.js", { headers: { "accept-encoding": "br, gzip" } });
    assert.equal(a.h.get("content-encoding"), "br");
    assert.equal(a.h.get("cache-control"), "no-cache");
    assert.equal((await t.req("GET", "/shop.js", { headers: { "if-none-match": a.h.get("etag") } })).status, 304);
    assert.equal((await t.req("GET", "/shop.js", { headers: { "accept-encoding": "gzip" } })).h.get("content-encoding"), "gzip");
    const tienda = (await t.req("GET", "/tienda/")).buf.toString("utf8");
    assert.match(tienda, /<link rel="modulepreload" href="\/common\.js">/);
    assert.match(tienda, /<script src="\/temprano\.js" async/);
    for (const m of ["ownstock", "cuaderno", "propias-plata", "hub-mes"]) assert.doesNotMatch(tienda, new RegExp(`/${m}\\.js`), `la tienda no avisa ${m}`);
    assert.doesNotMatch((await t.req("GET", "/r/ana-ficticia")).buf.toString("utf8"), /\/ownstock\.js/);
    assert.match((await t.req("GET", "/hub")).buf.toString("utf8"), /<link rel="modulepreload" href="\/ownstock\.js">/, "GaboHub sí los usa: se piden desde el principio");
  });
});

describe("módulos del revendedor a demanda (hub-perezoso.js)", () => {
  const read = (f) => readFileSync(join(PUBLIC, f), "utf8");
  test("cada nombre que shop.js toma de hub-perezoso.js existe en uno de los módulos reales, y shop.js no importa esos módulos directo", () => {
    const shop = read("shop.js"), lazy = read("hub-perezoso.js");
    const mods = JSON.parse(lazy.match(/MODULOS_HUB = (\[[^\]]*\])/)[1]);
    const reales = mods.map((m) => read(m.slice(1))).join("\n");
    const nombres = [...shop.matchAll(/^import \{([^}]*)\} from "\/hub-perezoso\.js"/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
    assert.ok(nombres.length > 40);
    for (const n of nombres.filter((x) => !["cargarHub", "alCargarHub"].includes(x))) {
      assert.match(lazy, new RegExp(`export const [^;]*\\b${n} = (init|espera|dibujo)\\("${n}"\\)`), `${n} tiene su puente`);
      assert.match(reales, new RegExp(`export (async )?(function|const) ${n}\\b`), `${n} existe en un módulo real`);
    }
    for (const m of mods) assert.doesNotMatch(shop, new RegExp(`from "${m.replace(/[.]/g, "\\.")}"`), `shop.js no importa ${m} directo`);
  });
});

describe("en el navegador (360 px)", { skip: !chromium && "sin Playwright" }, () => {
  let t, b;
  before(async () => {
    t = await boot();
    for (const id of ["netflix", "canva"]) await t.subir(`/api/admin/products/${id}/image`, icono(512, id.length));
    t.s.catalog.updateSettings({ id: Object.keys(t.s.engine.s.staff)[0], role: "owner" }, { layout: "ticket" });
    b = await chromium.launch();
  });
  after(async () => { await b?.close(); await t?.stop(); });
  const ctxNuevo = async (cookie) => {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true });
    if (cookie) { const [n, v] = cookie.split("="); await ctx.addCookies([{ name: n, value: v, url: t.base }]); }
    return ctx; // sin ctx.route(): apagaría la caché del navegador
  };

  test("la tienda: sin módulos del panel, el catálogo se pide una vez, y en la segunda visita las imágenes salen del celular", async () => {
    const ctx = await ctxNuevo();
    const p = await ctx.newPage();
    const pedidos = [], errores = [];
    p.on("request", (r) => pedidos.push(r.url().replace(t.base, "")));
    p.on("pageerror", (e) => errores.push(e.message));
    await p.goto(t.base + "/tienda/", { waitUntil: "networkidle" });
    await p.waitForSelector("article.tk img.plogo");
    assert.deepEqual(errores, []);
    for (const m of ["ownstock", "cuaderno", "propias-plata", "hub-mes", "sublinks", "arranque", "descargas", "cambio-cuenta"]) assert.ok(!pedidos.some((u) => u.startsWith(`/${m}.js`)), `no bajó ${m}.js`);
    assert.equal(pedidos.filter((u) => u === "/api/catalog").length, 1, "el catálogo se pidió una sola vez (temprano.js)");
    const src = await p.locator("article.tk img.plogo").first().getAttribute("src");
    assert.match(src, /^\/api\/products\/[a-z]+\/image\?v=[a-z0-9]+$/);
    // Segunda visita (otra pestaña, el mismo celular): los logos con ?v= no se vuelven a pedir.
    await p.close();
    const p2 = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p2);
    await cdp.send("Network.enable");
    let bajados = 0;
    cdp.on("Network.responseReceived", (e) => { if (e.response.url.includes("/api/products/") && !e.response.fromDiskCache && !e.response.fromMemoryCache && e.response.status === 200) bajados++; });
    await p2.goto(t.base + "/tienda/", { waitUntil: "networkidle" });
    await p2.waitForSelector("article.tk img.plogo");
    assert.equal(bajados, 0, "ningún logo se volvió a bajar");
    await ctx.close();
  });

  test("GaboHub con un revendedor sigue andando (panel completo, sin errores)", async () => {
    const ctx = await ctxNuevo(t.ck.ana);
    const p = await ctx.newPage();
    const errores = [];
    p.on("pageerror", (e) => errores.push(e.message));
    await p.goto(t.base + "/hub", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /Hola, Ana/.test(document.body.innerText));
    await p.goto(t.base + "/hub#clientes", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /Clientes/.test(document.querySelector("#sout")?.innerText || ""));
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test("el panel del dueño achica en el navegador la portada JPG y la tienda la usa", async () => {
    const ctx = await ctxNuevo(t.staff);
    const p = await ctx.newPage();
    // Una portada JPG de verdad (800×600), hecha con canvas en el navegador y subida como lo haría el dueño.
    await p.goto(t.base + "/panel", { waitUntil: "networkidle" });
    const jpg = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 600; const x = c.getContext("2d"); for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 7},80%,50%)`; x.fillRect((i * 37) % 800, (i * 53) % 600, 60, 60); } return c.toDataURL("image/jpeg", 0.95).split(",")[1]; });
    assert.equal((await t.req("POST", "/api/admin/settings/banner", { cookie: t.staff, body: { contentBase64: jpg } })).status, 200);
    await p.reload({ waitUntil: "networkidle" });
    // El panel lo hace solo, un rato después de abrir (sin frenar lo demás).
    for (let i = 0; i < 60 && (await t.req("GET", "/api/admin/imagenes/pendientes", { cookie: t.staff })).json.length; i++) await p.waitForTimeout(250);
    const r = await t.req("GET", "/api/settings/banner?w=540");
    assert.equal(r.h.get("content-type"), "image/webp");
    assert.deepEqual(medidas(r.buf), { w: 540, h: 405 });
    assert.ok(r.buf.length < Buffer.from(jpg, "base64").length);
    await ctx.close();
  });
});
