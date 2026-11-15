// Catálogo claro (revisión «en el lugar de ~30 clientes», 14/11/2026): que cualquier cliente entienda QUÉ compra, si
// HAY o es A PEDIDO, cuánto dura y ahorra, y confíe en la tienda. Datos ficticios; nunca sale un WhatsApp ni un pago real
// (wa.me se corta en el navegador y el código por WhatsApp va a un otpSender falso).
//  1. «A pedido» igual en la tarjeta, la ficha y el carrito (el invitado lo ve antes de pagar).
//  2. «Qué recibís» en cada tarjeta, «Para quién» del panel solo si existe, «Ver qué incluye» y «Agregar» en la ficha.
//  3. Mensual / 3 meses con «ahorrás» solo si hay ahorro real; botones de 44 px o más.
//  4. Buscador que perdona errores y tildes; link directo /tienda/#p=netflix.
//  5. Un solo comparador de combos.
//  6. 320 px, letra grande y zoom 150–200 %: sin desborde ni nombres cortados letra por letra.
//  7. Entrar: «Soy nuevo» y «Olvidé mi PIN» grandes; casilla de avisos sin marcar con «Nada de publicidad».
//  8. Confianza: línea de arriba, franja y 3 pasos en «ticket», opiniones solo si hay, /tiendas sin vacías ni de prueba.
//  9. Errores con tildes y Términos §07 al día.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });

describe("catálogo claro · núcleo", () => {
  test("«Para quién / cuántas pantallas»: lo escribe el dueño, se valida y la tienda lo muestra solo si existe", () => {
    const s = createStore();
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 4000, published: true, forWhom: "  Para 1 persona ·  1 pantalla a la vez " });
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 1700, published: true });
    const cat = s.catalog.publicCatalog();
    assert.equal(cat.find((p) => p.id === "nf").forWhom, "Para 1 persona · 1 pantalla a la vez");
    assert.equal("forWhom" in cat.find((p) => p.id === "dis"), false, "sin dato no se inventa nada");
    // Editar otro campo sin mandarlo lo conserva; mandarlo vacío lo borra.
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 4200, published: true });
    assert.equal(s.engine.s.products.nf.forWhom, "Para 1 persona · 1 pantalla a la vez");
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 4200, published: true, forWhom: "" });
    assert.equal(s.engine.s.products.nf.forWhom, undefined);
    assert.throws(() => s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 4200, published: true, forWhom: "x".repeat(81) }), err("VALIDATION"));
    assert.throws(() => s.catalog.upsertProduct({ id: "u_v", role: "seller" }, { id: "nf", name: "N", kind: "profile", durationDays: 30, price: 1, published: true, forWhom: "x" }), err("FORBIDDEN"), "un vendedor no edita productos");
  });

  test("/tiendas no lista páginas sin productos ni las que dicen «prueba» o «demo»; la página sigue abriendo por su link", () => {
    const s = createStore();
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 4000, published: true });
    const mk = (name, slug, withPrice) => {
      const c = s.catalog.createCustomer(owner, { name, phone: `+5917${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`, kind: "reseller" });
      s.shops.setPage(owner, c.id, true);
      if (withPrice) s.portal.setPrices(as(c), { nf: 4500 });
      s.shops.setupFor(owner, c.id, { slug, title: name, enabled: true });
      return c;
    };
    mk("Rosa TV", "rosa-tv", true);
    mk("Vacía Streaming", "vacia-st", false);
    mk("Tienda de prueba", "tienda-x", true);
    mk("Beto Streaming", "beto-demo", true);
    assert.deepEqual(s.shops.program().shops.map((x) => x.slug), ["rosa-tv"]);
    assert.equal(s.shops.program().stats.shops, 1);
    assert.equal(s.shops.public("beto-demo").products.length, 1, "la página de demo existe; solo no se lista");
  });
});

describe("catálogo claro · servidor y textos", () => {
  let dir, app, base;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-c2-txt-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("los errores de entrar llevan tildes y ñ", async () => {
    let r = await post("/api/auth/customer/login-email", { email: "nadie@x.lat", password: "una-clave-larga" });
    assert.equal((await r.json()).message, "Correo o contraseña incorrectos");
    r = await post("/api/auth/customer/register", { name: "Ana", email: "no-es-correo", password: "una-clave-larga" });
    assert.equal((await r.json()).message, "Correo inválido");
    r = await post("/api/auth/customer/register", { name: "Ana", email: "ana@x.lat", password: "corta" });
    assert.equal((await r.json()).message, "La contraseña necesita al menos 8 caracteres");
    r = await post("/api/auth/customer/reset", { token: "no-existe", password: "una-clave-larga" });
    assert.equal((await r.json()).message, "El enlace venció o ya se usó. Pedí uno nuevo.");
    const src = readFileSync(resolve("src/server/app.ts"), "utf8");
    for (const sin of ["contrasena incorrect", "Correo invalido", "Proba en", "vencio o ya se uso", "todavia no conecto"]) assert.ok(!src.includes(sin), `queda «${sin}» sin tilde`);
  });

  test("Términos §07 dice cómo se entra hoy (número + PIN) y §08 conserva su base legal, aclarando que no es sobre la compra", () => {
    const t = readFileSync(resolve("public/terminos.html"), "utf8");
    const s07 = t.slice(t.indexOf('id="cuenta"'), t.indexOf('id="software"'));
    assert.match(s07, /número de WhatsApp y tu PIN de 4 números/);
    assert.match(s07, /Soy nuevo.*Olvidé mi PIN/);
    const s08 = t.slice(t.indexOf('id="software"'), t.indexOf('id="contacto"'));
    assert.match(s08, /no de tu compra/);
    for (const ley of ["Ley N.º 1322", "363 bis", "363 ter"]) assert.ok(s08.includes(ley));
  });
});

describe("catálogo claro · navegador", () => {
  let dir, app, base, ownerCk;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const P = (id, name, kind, d, price, category, description, extra = {}) => post("/api/admin/products", { id, name, kind, durationDays: d, price, published: true, category, description, ...extra }, ownerCk);
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-c2-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, otpSender: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ownerCk = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await P("netflix", "Netflix Premium HD 4K", "profile", 30, 4000, "Streaming", "Series y películas en HD.", { forWhom: "Para 1 persona · 1 pantalla a la vez" });
    await P("netflix-3m", "Netflix Premium HD 4K · 3 meses", "profile", 90, 11000, "Streaming", "3 meses de una vez.");
    await P("disney", "Disney+ sin ESPN", "profile", 30, 1700, "Streaming", "Marvel, Pixar y más.");
    await P("disney-3m", "Disney+ sin ESPN · 3 meses", "profile", 90, 5100, "Streaming", "3 meses de Disney+.");
    await P("crunchyroll", "Crunchyroll", "profile", 30, 2000, "Streaming", "Anime.");
    await P("spotify", "Spotify Premium", "full_account", 30, 3300, "Música", "Música sin anuncios.");
    await P("duo", "Dúo Netflix + Disney+", "combo", 30, 5000, "Combos", "Netflix + Disney+ · Ahorrás Bs 7.", { comboProductIds: ["netflix", "disney"] });
    await P("trio", "Trío Netflix + Disney+ + Crunchyroll", "combo", 30, 6500, "Combos", "Netflix + Disney+ + Crunchyroll · Ahorrás Bs 12.", { comboProductIds: ["netflix", "disney", "crunchyroll"] });
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, ownerCk);
    await post("/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [1, 2, 3].map((i) => ({ label: `Perfil ${i}` })) }, ownerCk);
    await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", paymentNote: "Banco Demo", layout: "ticket", alwaysAvailable: true, storeHours: "Atención 8:00 a 22:00 (hora de Bolivia)" }, ownerCk);
    await post("/api/admin/settings/qr", { contentBase64: PNG }, ownerCk);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  const open = async (b, { w = 360, zoom = 1, hash = "#inicio" } = {}) => {
    const ctx = await b.newContext({ viewport: { width: Math.round(w / zoom), height: Math.round(780 / zoom) }, deviceScaleFactor: zoom, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/tienda/" + hash);
    await p.waitForFunction(() => !document.querySelector("#sout .skeleton") && document.querySelector(".tk"));
    return { ctx, p, errs };
  };
  const measure = (p, sel = "body") => p.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== "hidden"; };
    return {
      over: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...root.querySelectorAll("button, a.sbtn, .tkbtn")].filter((x) => vis(x) && !x.closest(".cupx") && x.getBoundingClientRect().height < 44).map((x) => (x.textContent || x.getAttribute("aria-label") || "?").trim().slice(0, 30)),
      tiny: [...root.querySelectorAll("*")].filter((x) => vis(x) && !x.closest(".pt, .tkgrid, .skeleton") && [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.textContent.trim().slice(0, 30)),
      // Un nombre «cortado letra por letra»: ocupa más renglones que palabras tiene.
      broken: [...root.querySelectorAll(".tk h3, .pc h3, .ccficha h2")].filter(vis).filter((h) => { const lh = parseFloat(getComputedStyle(h).lineHeight) || 20; return Math.round(h.getBoundingClientRect().height / lh) > h.textContent.trim().split(/\s+/).length; }).map((h) => h.textContent.trim()),
      // Algo que se sale por la derecha (sin contar las categorías, que se deslizan a propósito).
      wide: [...root.querySelectorAll("*")].filter((x) => vis(x) && !x.closest(".tkcats") && x.getBoundingClientRect().right > innerWidth + 1).map((x) => x.className || x.tagName).slice(0, 5),
    };
  }, sel);
  const row = (p, name) => p.locator(".tk", { has: p.locator(`h3:text-is("${name}")`) });

  test("1–3. tarjeta y ficha dicen lo mismo (hay / a pedido), qué recibís, para quién, Mensual / 3 meses con ahorro real", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const { ctx, p, errs } = await open(b);
      const nf = row(p, "Netflix Premium HD 4K"), dis = row(p, "Disney+ sin ESPN");
      assert.match(await nf.innerText(), /1 perfil asignado · 1 mes/, "los perfiles se cargan «Perfil 1, 2…»: no se promete el nombre (15/11)");
      assert.match(await nf.innerText(), /Para 1 persona · 1 pantalla a la vez/, "el dato del panel se ve");
      assert.match(await nf.innerText(), /Hay: entrega al instante/);
      assert.doesNotMatch(await dis.innerText(), /Para 1 persona/, "sin dato no se inventa");
      assert.match(await dis.innerText(), /A pedido: te confirmamos antes de que pagues/);
      assert.match(await row(p, "Spotify Premium").innerText(), /Acceso con correo y contraseña · 1 mes/);
      assert.match(await row(p, "Trío Netflix + Disney+ + Crunchyroll").innerText(), /3 plataformas en un solo pago · 1 mes/);
      // Duración: dos botones visibles; «ahorrás» solo con ahorro real (Netflix 3 × 40 − 110 = 10; Disney 3 × 17 = 51, sin ahorro).
      const opts = nf.locator(".ccopt");
      assert.deepEqual((await opts.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()), ["Mensual Bs 40", "3 meses Bs 110 ahorrás Bs 10"]);
      assert.deepEqual((await dis.locator(".ccopt").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()), ["Mensual Bs 17", "3 meses Bs 51"]);
      for (const h of await p.locator(".ccopt").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `selector de duración de ${h} px`);
      await opts.nth(1).click();
      await p.waitForFunction(() => [...document.querySelectorAll(".tk")].some((t) => /Netflix Premium HD 4K/.test(t.querySelector("h3")?.textContent) && /Bs 110/.test(t.querySelector(".tkend b")?.textContent)));
      assert.equal(await row(p, "Netflix Premium HD 4K").locator('.ccopt[aria-pressed="true"]').innerText().then((t) => t.includes("3 meses")), true);
      // «Ver qué incluye» (no solo el logo) → ficha con la MISMA etiqueta, qué es un perfil y «Agregar al carrito».
      await dis.locator(".ccmore").click();
      const f = p.locator(".ccficha");
      await f.waitFor();
      const ft = (await f.innerText()).replace(/\s+/g, " ");
      assert.match(ft, /A pedido: te confirmamos antes de que pagues/);
      assert.match(ft, /En la entrega te decimos cuál es tu perfil de Disney\+ \(por ejemplo «Perfil 3»\): entrá siempre a ese\. La web no le cambia el nombre\./);
      assert.doesNotMatch(ft, /con tu nombre/);
      assert.match(ft, /Dura 1 mes \(del mismo día al mismo día\)/, "«1 mes» ya no son «30 días» (mesModo.ts)");
      assert.match(ft, /Consultar disponibilidad/);
      assert.equal(await f.locator('[data-add="disney"]').innerText(), "Agregar al carrito");
      const m = await measure(p, "#modal");
      assert.deepEqual([m.small, m.tiny, m.over], [[], [], false], "ficha a 360 px");
      await f.locator('[data-add="disney"]').click();
      await p.waitForFunction(() => Number(document.querySelector("#cartN")?.textContent) === 1);
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });

  test("1. el invitado ve «A pedido» en el carrito y en el pago antes de pagar (con lo que hay, no)", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const { ctx, p, errs } = await open(b);
      await row(p, "Netflix Premium HD 4K").locator("[data-add]").click();
      await p.locator('.bnav [data-cart]').click();
      await p.locator("#drawer:not([hidden]) .line").first().waitFor();
      assert.equal(await p.locator("#drawer .cwait").count(), 0, "lo que hay en stock no lleva aviso");
      await p.locator("#drawer [data-close]").first().click();
      await row(p, "Disney+ sin ESPN").locator("[data-add]").click();
      await p.locator('.bnav [data-cart]').click();
      // 15/11: lo a pedido va en su sección, con «Consultar disponibilidad», y no entra al cobro.
      const notice = p.locator("#drawer .cwait");
      await notice.waitFor();
      assert.match(await notice.innerText(), /A pedido · consultá antes de pagar[\s\S]*Disney\+ sin ESPN[\s\S]*No se cobra todavía/);
      assert.doesNotMatch(await notice.innerText(), /Netflix/);
      assert.match(await p.locator("#drawer").innerText(), /Total a pagar ahora\s*Bs 40/);
      assert.equal((await p.locator('#drawer [data-step="2"]').innerText()).trim(), "Pagar solo lo disponible (Bs 40)");
      assert.ok(await p.evaluate(() => { const n = document.querySelector("#drawer .cwait"), b = document.querySelector('#drawer [data-step="2"]'); return !!(n.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }), "el aviso va antes del botón de pagar");
      await p.locator('#drawer [data-step="2"]').click();
      await p.locator("#drawer .cwaitnote").waitFor();
      assert.match(await p.locator("#drawer .cwaitnote").innerText(), /Disney\+ sin ESPN queda en tu carrito: no se cobra ahora/);
      assert.ok(await p.evaluate(() => { const n = document.querySelector("#drawer .cwaitnote"), q = document.querySelector("#drawer .qrg"); return !q || !!(n.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING); }), "el aviso va antes del QR");
      const m = await measure(p, "#drawer");
      assert.deepEqual([m.over, m.small, m.tiny], [false, [], []]);
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });

  test("4–5. buscador que perdona errores, link directo a la ficha y un solo comparador de combos", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const { ctx, p, errs } = await open(b);
      const names = () => p.locator(".tk h3").allInnerTexts();
      for (const [q, want] of [["netflx", "Netflix Premium HD 4K"], ["disnei", "Disney+ sin ESPN"], ["crunchy", "Crunchyroll"], ["SPOTIFI", "Spotify Premium"], ["dúo", "Dúo Netflix + Disney+"]]) {
        await p.locator("#q").fill(q);
        await p.waitForFunction((w) => [...document.querySelectorAll(".tk h3")].some((h) => h.textContent === w), want);
        assert.ok((await names()).includes(want), `«${q}» encuentra ${want}`);
      }
      await p.locator("#q").fill("disnei");
      await p.waitForFunction(() => !document.querySelector('.tk h3') || [...document.querySelectorAll(".tk h3")].every((h) => /Disney/.test(h.textContent)));
      assert.ok(!(await names()).includes("Spotify Premium"), "no trae cualquier cosa");
      await p.locator("#q").fill("zzzzqqq");
      await p.locator(".ccnone").waitFor();
      assert.match(await p.locator(".ccnone").innerText(), /No encontramos “zzzzqqq”/);
      await p.locator("#q").fill("");
      await p.waitForFunction(() => document.querySelectorAll(".tk").length > 3);
      // Un solo comparador: el asesor por presupuesto queda adentro (antes eran dos bloques casi iguales).
      assert.equal(await p.locator(".cmp").count(), 1);
      assert.equal(await p.locator('.cbanner[data-s="asesor"]').count(), 0);
      assert.equal(await p.locator('.cmp [data-s="asesor"]').count(), 1);
      for (const h of await p.locator(".cmpsel select").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44);
      await ctx.close();
      // Link para Instagram / TikTok: abre la ficha directo, y por nombre también.
      for (const hash of ["#p=netflix", "#p=Crunchyroll"]) {
        const o = await open(b, { hash });
        await o.p.locator(".ccficha").waitFor();
        assert.match(await o.p.locator("#ccfT").innerText(), hash === "#p=netflix" ? /Netflix Premium HD 4K/ : /Crunchyroll/);
        assert.equal(await o.p.evaluate(() => location.hash), "#inicio", "la dirección vuelve a la tienda");
        assert.match(await o.p.locator(".ccshare").getAttribute("data-copy"), /\/tienda\/#p=/);
        assert.deepEqual(o.errs, []);
        await o.ctx.close();
      }
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  });

  test("6. celular viejo (320 px), letra grande (150 %) y zoom 200 %: sin desborde, nombres enteros, botones de 44 px", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
    const b = await chromium.launch();
    try {
      for (const v of [{ w: 320, zoom: 1 }, { w: 360, zoom: 1.5 }, { w: 360, zoom: 2 }]) {
        const tag = `${v.w} px × ${v.zoom}`;
        const { ctx, p, errs } = await open(b, v);
        let m = await measure(p);
        assert.equal(m.over, false, `${tag}: portada sin desborde`);
        assert.deepEqual(m.broken, [], `${tag}: nombres cortados`);
        assert.deepEqual(m.wide, [], `${tag}: nada se sale por la derecha`);
        assert.deepEqual(m.small, [], `${tag}: botones de 44 px`);
        assert.deepEqual(m.tiny, [], `${tag}: letra ≥ 12 px`);
        // Precio y «Agregar» van DEBAJO del nombre (no al costado apretándolo).
        const below = await row(p, "Netflix Premium HD 4K").evaluate((t) => t.querySelector(".tkend").getBoundingClientRect().top >= t.querySelector("h3").getBoundingClientRect().bottom);
        assert.ok(below, `${tag}: precio y botón debajo del nombre`);
        // El logo no tapa el título.
        const overlap = await p.evaluate(() => [...document.querySelectorAll(".tk")].some((t) => { const a = t.querySelector(".tklogo").getBoundingClientRect(), h = t.querySelector("h3").getBoundingClientRect(); return a.right > h.left + 1 && a.bottom > h.top + 1 && a.top < h.bottom - 1 && a.left < h.right - 1; }));
        assert.equal(overlap, false, `${tag}: el logo tapa el título`);
        await row(p, "Netflix Premium HD 4K").locator(".ccmore").click();
        await p.locator(".ccficha").waitFor();
        m = await measure(p, "#modal");
        assert.deepEqual([m.over, m.broken, m.small], [false, [], []], `${tag}: ficha`);
        await p.locator('.ccficha [data-add]').click();
        await p.locator('.bnav [data-cart]').click();
        await p.locator('#drawer [data-step="2"]').click();
        await p.locator("#drawer .total").first().waitFor();
        m = await measure(p, "#drawer");
        assert.equal(m.over, false, `${tag}: pago sin desborde`);
        assert.deepEqual(m.wide, [], `${tag}: el panel de pago nunca más ancho que la pantalla`);
        const total = await p.locator("#drawer .total").last().evaluate((x) => { const r = x.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= 0; });
        assert.ok(total, `${tag}: el total entero a la vista`);
        assert.deepEqual(errs, [], tag);
        await ctx.close();
      }
    } finally { await b.close(); }
  });

  test("7. entrar: ícono de persona arriba, «Soy nuevo» y «Olvidé mi PIN» grandes; casilla de avisos sin marcar", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const { ctx, p, errs } = await open(b);
      const acc = p.locator(".shead #accBtn");
      assert.ok(await acc.isVisible(), "ícono de persona arriba en el celular");
      const ab = await acc.boundingBox();
      assert.ok(ab.height >= 44 && ab.width >= 44);
      await acc.click();
      await p.locator('#login[data-step="pin"]').waitFor();
      for (const t of ["Soy nuevo: crear cuenta", "Olvidé mi PIN"]) {
        const btn = p.locator("#login button", { hasText: t });
        const bb = await btn.boundingBox();
        assert.ok(bb.height >= 44, `«${t}» de 44 px`);
        assert.ok(bb.x >= 12 && bb.x + bb.width <= 360 - 12, `«${t}» no pegado al borde`);
      }
      await p.locator("#login button", { hasText: "Olvidé mi PIN" }).click();
      await p.locator('#login[data-step="phone"]').waitFor();
      assert.match(await p.locator("#modal").innerText(), /Olvidaste tu PIN/);
      await p.locator("#modal [data-close]").click();
      await acc.click();
      await p.locator("#login button", { hasText: "Soy nuevo" }).click();
      await p.locator('#login[data-step="phone"]').waitFor();
      assert.match(await p.locator("#modal").innerText(), /Crear tu cuenta/);
      await p.locator('#login [name="phone"]').fill("+591 71234567");
      await p.locator('#login [type="submit"]').click();
      await p.locator('#login[data-step="name"]').waitFor();
      const box = p.locator('#login [name="consent"]');
      assert.equal(await box.isChecked(), false, "la casilla de avisos NO viene marcada");
      const lab = (await p.locator("#login .ccconsent").innerText()).replace(/\s+/g, " ");
      assert.match(lab, /Solo para tu pedido\. Nada de publicidad\./);
      assert.equal(await p.locator('#login .ccconsent a[href="/privacidad"]').count(), 1);
      const m = await measure(p, "#modal");
      assert.deepEqual([m.over, m.tiny], [false, []]);
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });

  test("8. confianza en «ticket»: línea de arriba con el horario, franja de ventajas, 3 pasos y opiniones solo si hay", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      let { ctx, p, errs } = await open(b);
      const top = (await p.locator(".cctrust").innerText()).replace(/\s+/g, " ").trim();
      assert.equal(top, "Tienda boliviana · atendemos de 8:00 a 22:00 · garantía de reposición · Términos");
      assert.equal(await p.locator('.cctrust a[href="/terminos"]').count(), 1);
      assert.equal(await p.locator("#sout .trustband").count(), 1, "franja de ventajas");
      assert.match(await p.locator("#sout .ccsteps").innerText(), /Paso 1[\s\S]*Paso 2[\s\S]*Paso 3/);
      assert.doesNotMatch(await p.locator("#sout").innerText(), /Lo que dicen nuestros clientes/, "sin opiniones cargadas no se muestra nada");
      assert.deepEqual(errs, []);
      await ctx.close();
      await post("/api/admin/testimonials", { items: [{ name: "Cliente Ficticio", text: "Me lo activaron rápido.", rating: 5 }] }, ownerCk);
      ({ ctx, p, errs } = await open(b));
      assert.match(await p.locator("#sout").innerText(), /Lo que dicen nuestros clientes[\s\S]*Me lo activaron rápido/);
      await ctx.close();
      await post("/api/admin/testimonials", { items: [] }, ownerCk);
    } finally { await b.close(); }
  });

  test("panel: «Para quién / cuántas pantallas» en el editor de producto y se guarda", () => {
    const src = readFileSync(resolve("public/panel.js"), "utf8");
    assert.match(src, /name="forWhom" maxlength="80"/);
    assert.match(src, /body\.forWhom = f\.forWhom\?\.value\?\.trim\(\) \?\? ""/);
  });
});
