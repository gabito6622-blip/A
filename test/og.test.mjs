// Vista previa al compartir (WhatsApp, Facebook, Telegram): etiquetas Open Graph + imagen generada.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { OG_GLYPHS, ogCard, ogTags } from "../dist/server/og.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const meta = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
const pngSize = (buf) => ({ sig: buf.subarray(0, 8).toString("hex"), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

describe("vista previa al compartir (Open Graph)", () => {
  let dir, app, base;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-og-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, publicOrigin: "https://ejemplo.test" });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const st = app.store, sys = { id: "t", role: "owner" };
    st.catalog.upsertProduct(sys, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    st.catalog.upsertPriceGroup(sys, { id: "rev", name: "Rev", prices: { nf: 2500 } });
    const c = st.catalog.createCustomer(sys, { name: "Rosa", phone: "+59171111111", kind: "reseller", priceGroupId: "rev" });
    st.shops.setPage(sys, c.id, true);
    st.shops.setupFor(sys, c.id, { slug: "rosa-tv", title: "Rosa TV <b>", heroText: "Netflix y Disney al toque", accentColor: "#ff7a00", enabled: true });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("la tienda, el hub y la página del revendedor traen título, descripción e imagen propios", async () => {
    const cases = [
      ["/tienda/", "/og/tienda.png"],
      ["/", "/og/hub.png"],
      ["/r/rosa-tv", "/og/r/rosa-tv.png"],
    ];
    for (const [path, img] of cases) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.equal(meta(html, "og:image"), "https://ejemplo.test" + img, path);
      assert.equal(meta(html, "og:url"), "https://ejemplo.test" + path, path);
      assert.equal(meta(html, "og:image:width"), "1200");
      assert.equal(meta(html, "twitter:card"), "summary_large_image");
      assert.ok(meta(html, "og:title"), `${path}: sin título`);
      assert.equal((html.match(/<meta name="description"/g) ?? []).length, 1, `${path}: descripción repetida`);
      assert.ok(html.includes('<script type="module" src="/shop.js">') || html.includes("/shop.js"), "sigue siendo la tienda");
    }
    const rosa = await (await fetch(base + "/r/rosa-tv")).text();
    assert.equal(meta(rosa, "og:title"), "Rosa TV &lt;b&gt;", "el nombre va escapado");
    const hero = app.store.shops.public("rosa-tv").heroText;
    assert.ok(hero, "la página tiene texto de portada");
    assert.equal(meta(rosa, "og:description"), hero.replace(/\s+/g, " ").trim().slice(0, 200).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    assert.match(rosa, /<title>Rosa TV &lt;b&gt;<\/title>/);
  });

  test("las imágenes son PNG de 1200×630 y una página que no existe da 404", async () => {
    for (const p of ["/og/tienda.png", "/og/hub.png", "/og/r/rosa-tv.png"]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get("content-type"), "image/png");
      const s = pngSize(Buffer.from(await r.arrayBuffer()));
      assert.deepEqual(s, { sig: "89504e470d0a1a0a", w: 1200, h: 630 }, p);
    }
    assert.equal((await fetch(base + "/og/r/no-existe.png")).status, 404);
    const r = await fetch(base + "/r/no-existe");
    assert.equal(r.status, 200, "la página igual carga (muestra su propio aviso)");
    // Una página que no existe (o está apagada/bloqueada) lleva la vista previa genérica de la plataforma, nada propio.
    assert.equal(meta(await r.text(), "og:image"), "https://ejemplo.test/og/hub.png", "vista previa genérica para una tienda que no existe");
  });

  test("SEO: título y descripción para Google, robots.txt y sitemap.xml", async () => {
    app.store.catalog.updateSettings({ id: "t", role: "owner" }, { seoTitle: "Gabriel Store | Netflix y más en Bolivia", seoDescription: "Streaming en Bolivia con QR." });
    const html = await (await fetch(base + "/tienda/")).text();
    assert.match(html, /<title>Gabriel Store \| Netflix y más en Bolivia<\/title>/);
    assert.equal(meta(html, "description"), "Streaming en Bolivia con QR.");
    const robots = await (await fetch(base + "/robots.txt")).text();
    assert.match(robots, /Disallow: \/panel/);
    assert.match(robots, /Sitemap: https:\/\/ejemplo\.test\/sitemap\.xml/);
    const sm = await (await fetch(base + "/sitemap.xml")).text();
    assert.match(sm, /<loc>https:\/\/ejemplo\.test\/tienda\/<\/loc>/);
  });

  test("el panel y los términos no cambian", async () => {
    const panel = await (await fetch(base + "/panel.html")).text();
    assert.equal(meta(panel, "og:image"), undefined);
  });

  test("dibujo: cada letra es de 5×7, acentos y nombres largos no rompen", () => {
    for (const [ch, g] of Object.entries(OG_GLYPHS)) assert.equal(g.length, 35, `letra "${ch}"`);
    for (const title of ["Ñandú Streaming · Tienda de Películas", "x".repeat(200), "", "😀 emoji"]) {
      const s = pngSize(ogCard({ title, subtitle: "Pagá con QR", accent: "#123", background: "no-es-color" }));
      assert.equal(s.w, 1200);
    }
    const t = ogTags({ title: 'a"b', description: "d".repeat(500), image: "https://x/i.png", url: "https://x/", siteName: "S" });
    assert.ok(t.includes('content="a&quot;b"'));
    assert.equal(meta(t, "og:description").length, 200);
  });
});
