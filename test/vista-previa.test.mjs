// Vista previa al compartir por WhatsApp (Open Graph) por ruta, ícono de la pestaña, caché sin cruces,
// logo de la app en el link de cobro y los datos de logos para las pantallas del revendedor.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createApp } from "../dist/server/app.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const DAY = 86_400_000;
const ORIGIN = "https://gabo.ejemplo.test";
const owner = { id: "t", role: "owner" };
/** Contenido de una etiqueta <meta property|name="..." content="...">. */
const meta = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`))?.[1];
const pngSize = (buf) => ({ sig: buf.subarray(0, 8).toString("hex"), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

/** PNG chiquito de un color (logo ficticio). */
function png(rgb) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const w = 4, h = 4, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("vista previa al compartir (por ruta)", () => {
  let dir, app, base, s, rosa, beto, cobroToken;
  const EVIL = `Rosa "<TV>" & 'Co'`;
  const upload = (buf) => { const name = randomBytes(16).toString("hex") + ".png"; writeFileSync(join(dir, "uploads", name), buf); return name; };
  const reseller = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-vprev-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, publicOrigin: ORIGIN });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    mkdirSync(join(dir, "uploads"), { recursive: true });
    s.catalog.updateSettings(owner, { storeName: "Gabriel Store", platformName: "GaboHub" });
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 3000, published: true, color: "#113ccf" });
    s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
    s.catalog.setProductImage(owner, "dis", upload(png([17, 60, 207])));
    s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { dis: 2500, "dis-alq": 7000 } });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "dis-alq@x.lat", password: "Clave-Larga#9", supplierExpiresAt: Date.now() + 90 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });
    s.inventory.addAccount(owner, { productId: "dis", supplierId: "andes", email: "dis@x.lat", password: "Clave-Larga#8", supplierExpiresAt: Date.now() + 90 * DAY, cost: 900, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }] });

    const mk = (name, phone, slug, title, enabled = true) => {
      const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
      s.shops.setPage(owner, c.id, true);
      s.shops.setupFor(owner, c.id, { slug, title, enabled });
      return c;
    };
    rosa = mk("Rosa Mamani", "+59171111111", "rosa-tv", EVIL);
    s.shops.update(reseller(rosa), { heroText: "Netflix & Disney <al toque>", accentColor: "#ff7a00" });
    beto = mk("Beto Rojas", "+59172222222", "beto-tv", "Beto Streaming");
    mk("Apagada Pérez", "+59173333333", "apagada-tv", "Página Apagada Secreta", false);
    const bloq = mk("Bloqueada Pérez", "+59174444444", "bloq-tv", "Página Bloqueada Secreta");
    s.shops.setBlocked(owner, bloq.id, true);
    const susp = mk("Suspendida Pérez", "+59175555555", "susp-tv", "Página Suspendida Secreta");
    s.engine.s.customers[susp.id].shop.suspended = true; // como la deja el cobro de alquiler vencido

    // Rosa alquila una cuenta completa, reparte un perfil a "Ana Clienta" y le arma el link de cobro.
    const aid = s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    const { sub } = s.subs.save(reseller(rosa), aid, { name: "Ana Clienta", phone: "72223344", expiresAt: Date.now() + 5 * DAY, price: 4321, pay: "pendiente" });
    cobroToken = s.subs.link(reseller(rosa), aid, sub.id).token;
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  const page = async (path, headers = {}) => { const r = await fetch(base + path, { headers }); return { r, html: await r.text() }; };
  const common = (html, path) => {
    for (const k of ["og:title", "og:description", "og:image", "og:url", "og:site_name"]) assert.ok(meta(html, k), `${path}: falta ${k}`);
    assert.equal(meta(html, "og:type"), "website", path);
    assert.equal(meta(html, "twitter:card"), "summary_large_image", path);
    assert.equal(meta(html, "og:url"), ORIGIN + path, path);
    assert.ok(meta(html, "og:image").startsWith(ORIGIN + "/"), `${path}: la imagen va con URL completa`);
    assert.equal((html.match(/<meta name="description"/g) ?? []).length, 1, `${path}: una sola descripción`);
    assert.equal((html.match(/<title>/g) ?? []).length, 1, `${path}: un solo título`);
  };

  test("/tienda, /hub y /: título, descripción e imagen propios", async () => {
    const t = await page("/tienda/");
    common(t.html, "/tienda/");
    assert.equal(meta(t.html, "og:title"), "Gabriel Store");
    assert.equal(meta(t.html, "og:site_name"), "Gabriel Store");
    assert.equal(meta(t.html, "og:image"), ORIGIN + "/og/tienda.png");
    assert.match(t.html, /<title>Gabriel Store<\/title>/);
    for (const p of ["/hub", "/"]) {
      const h = await page(p);
      common(h.html, p);
      assert.equal(meta(h.html, "og:title"), "GaboHub", p);
      assert.match(meta(h.html, "og:description"), /revendedores/i, p);
      assert.equal(meta(h.html, "og:image"), ORIGIN + "/og/hub.png", p);
      assert.match(h.html, /src="\/shop\.js"/, "sigue siendo la misma app");
    }
  });

  test("/r/<slug>: los datos de su página, escapados, y su logo como ícono", async () => {
    const { r, html } = await page("/r/rosa-tv");
    assert.equal(r.status, 200);
    common(html, "/r/rosa-tv");
    const escaped = "Rosa &quot;&lt;TV&gt;&quot; &amp; 'Co'";
    assert.equal(meta(html, "og:title"), escaped);
    assert.equal(meta(html, "og:site_name"), escaped);
    assert.equal(meta(html, "og:description"), "Netflix &amp; Disney &lt;al toque&gt;");
    assert.ok(html.includes(`<title>Rosa &quot;&lt;TV&gt;&quot; &amp; 'Co'</title>`), "el <title> también va escapado");
    assert.ok(!html.includes("<TV>") && !html.includes("<al toque>"), "nada sin escapar");
    assert.equal(meta(html, "og:image"), ORIGIN + "/og/r/rosa-tv.png");
    assert.equal(meta(html, "og:image:width"), "1200");
    assert.match(html, /<link rel="icon" href="\/app-icon-192\.png">/, "sin logo: el ícono de siempre");
    assert.ok(!/Ana Clienta|4321|43\.21/.test(html), "nada de sus clientes");

    // Con logo: la pestaña muestra su logo. Con portada: la vista previa es su portada.
    s.shops.setImage(reseller(rosa), "logo", upload(png([255, 122, 0])));
    const withLogo = (await page("/r/rosa-tv")).html;
    assert.match(withLogo, /<link rel="icon" href="\/api\/shops\/rosa-tv\/logo">/);
    assert.equal((withLogo.match(/rel="icon"/g) ?? []).length, 1);
    assert.equal((await fetch(base + "/api/shops/rosa-tv/logo")).status, 200, "el logo del ícono se puede ver");
    s.shops.setImage(reseller(rosa), "banner", upload(png([1, 2, 3])));
    const withBanner = (await page("/r/rosa-tv")).html;
    assert.equal(meta(withBanner, "og:image"), ORIGIN + "/api/shops/rosa-tv/banner");
    assert.equal(meta(withBanner, "og:image:width"), undefined, "la portada no es 1200×630: sin medidas falsas");
    assert.equal((await fetch(base + "/api/shops/rosa-tv/banner")).status, 200);
  });

  test("/r/ apagada, bloqueada, suspendida o inexistente: valores genéricos, nada de esa página", async () => {
    for (const [slug, secret] of [["apagada-tv", "Apagada"], ["bloq-tv", "Bloqueada"], ["susp-tv", "Suspendida"], ["no-existe", "no-existe"]]) {
      const { r, html } = await page(`/r/${slug}`);
      assert.equal(r.status, 200, slug);
      assert.equal(meta(html, "og:title"), "GaboHub", slug);
      assert.equal(meta(html, "og:image"), ORIGIN + "/og/hub.png", slug);
      assert.ok(!html.includes(`Página ${secret} Secreta`), `${slug}: no filtra el título`);
      assert.ok(!html.includes(`/api/shops/${slug}/logo`), `${slug}: no usa su logo`);
      assert.equal((await fetch(`${base}/og/r/${slug}.png`)).status, 404, `${slug}: sin imagen propia`);
    }
  });

  test("/c/<token>: siempre genérico, sin nombres, montos ni imagen personal", async () => {
    const { r, html } = await page(`/c/${cobroToken}`);
    assert.equal(r.status, 200);
    assert.equal(meta(html, "og:title"), "Tu cuenta de cobro");
    assert.match(html, /<title>Tu cuenta de cobro<\/title>/);
    assert.equal(meta(html, "og:image"), undefined, "sin imagen");
    assert.equal(meta(html, "twitter:card"), "summary");
    assert.match(html, /<meta name="robots" content="noindex/);
    for (const bad of ["Ana", "Clienta", "Rosa", "TV", "Disney", "43.21", "43,21", "4321", "Bs", cobroToken]) assert.ok(!html.includes(bad), `no aparece "${bad}"`);
    // Un link inventado da la misma página genérica.
    const fake = await page("/c/" + "x".repeat(32));
    assert.equal(fake.html, html);
  });

  test("caché: cada /r/ recibe su propio HTML (sin ETag compartido ni 304 cruzado)", async () => {
    const plain = await fetch(base + "/una-ruta-cualquiera");
    const etag = plain.headers.get("etag");
    assert.ok(etag, "el HTML genérico sí tiene ETag");
    const a = await page("/r/rosa-tv", { "if-none-match": etag });
    const b = await page("/r/beto-tv", { "if-none-match": etag });
    for (const x of [a, b]) {
      assert.equal(x.r.status, 200, "nunca 304 con el ETag del HTML genérico");
      assert.equal(x.r.headers.get("etag"), null, "sin ETag: no se puede confundir con otra página");
      assert.equal(x.r.headers.get("cache-control"), "no-cache");
    }
    assert.equal(meta(b.html, "og:title"), "Beto Streaming");
    assert.notEqual(meta(a.html, "og:title"), meta(b.html, "og:title"));
    assert.equal(meta(b.html, "og:url"), ORIGIN + "/r/beto-tv");
    // Pedirlas de nuevo, en otro orden, da lo mismo para cada una.
    assert.equal(meta((await page("/r/beto-tv")).html, "og:title"), "Beto Streaming");
    assert.match(meta((await page("/r/rosa-tv")).html, "og:title"), /^Rosa/);
  });

  test("imágenes: por defecto PNG 1200×630; ícono y app instalable siguen andando", async () => {
    for (const p of ["/og/hub.png", "/og/tienda.png", "/og/r/beto-tv.png"]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get("content-type"), "image/png");
      assert.deepEqual(pngSize(Buffer.from(await r.arrayBuffer())), { sig: "89504e470d0a1a0a", w: 1200, h: 630 }, p);
    }
    const icon = await fetch(base + "/app-icon-192.png");
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get("content-type"), "image/png");
    const mf = await fetch(base + "/app.webmanifest");
    assert.equal(mf.status, 200);
    const m = JSON.parse(await mf.text());
    assert.ok(m.icons?.length, "el manifiesto tiene íconos");
    for (const i of m.icons) assert.equal((await fetch(base + i.src)).status, 200, i.src);
    assert.match(readFileSync(join(PUBLIC, "index.html"), "utf8"), /<link rel="icon" href="\/app-icon-192\.png">/);
  });

  test("link de cobro: logo de la app (también si el producto de alquiler no tiene imagen propia)", async () => {
    const v = await (await fetch(`${base}/api/cobro/${cobroToken}`)).json();
    assert.equal(v.hasLogo, true, "toma el logo de 'Disney+' para 'Disney+ (alquiler revendedores)'");
    const r = await fetch(`${base}/api/cobro/${cobroToken}/logo`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), readFileSync(join(dir, "uploads", s.engine.s.products.dis.imageFileRef)));
    assert.equal((await fetch(`${base}/api/cobro/${"y".repeat(32)}/logo`)).status, 404, "token inventado: nada");
    // Sin ningún logo cargado: hasLogo false y 404.
    s.catalog.setProductImage(owner, "dis", null);
    assert.equal((await (await fetch(`${base}/api/cobro/${cobroToken}`)).json()).hasLogo, false);
    assert.equal((await fetch(`${base}/api/cobro/${cobroToken}/logo`)).status, 404);
    s.catalog.setProductImage(owner, "dis", upload(png([17, 60, 207])));
  });

  test("logos en las pantallas del revendedor: id de la app en Mis ganancias y en Quién me debe, solo de sus clientes", async () => {
    const R = reseller(rosa), B = reseller(beto);
    const cli = s.catalog.createCustomer(R, { name: "Cliente De Rosa", phone: "+59176666666" });
    const cliB = s.catalog.createCustomer(B, { name: "Cliente De Beto", phone: "+59177777777" });
    s.wallet.adjust(owner, rosa.id, 10000, "carga de prueba");
    s.orders.create(R, { customerId: cli.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "balance", idempotencyKey: "vp-1" });
    s.fiado.charge(R, { customerId: cli.id, amount: 1500, note: "Disney" });
    s.fiado.charge(B, { customerId: cliB.id, amount: 900, note: "otro" });
    const earn = s.rtools.earnings(R);
    assert.deepEqual(earn.byApp.map((x) => x.productId), ["dis"]);
    const ov = s.fiado.overview(R);
    assert.deepEqual(ov.rows.map((x) => x.name), ["Cliente De Rosa"], "solo sus clientes");
    assert.deepEqual(ov.rows[0].apps, [{ productId: "dis", product: "Disney+" }]);
    assert.ok(!JSON.stringify(ov).includes("Beto"), "nada del otro revendedor");
    assert.deepEqual(s.fiado.overview(B).rows[0].apps, [], "el cliente de Beto no tiene apps activas");
    assert.throws(() => s.fiado.history(B, cli.id), "Beto no ve la libreta de un cliente de Rosa");
  });
});
