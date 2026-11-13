// Centro de exportaciones (13/11/2026). Datos ficticios; nada real.
//  1. Catálogo de WhatsApp: la tienda con su marca y precios públicos; el revendedor con SU nombre, SUS precios, SUS combos y SU link.
//  2. Solo publicados y con precio; nunca costos, claves, clientes ni ids internos. Filtro por categorías.
//  3. Aislamiento: un revendedor no ve precios ni productos de otro; sin sesión 401; GaboHub pausado → 402; plan Básico sí puede.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";
let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const has = (bin) => existsSync(`/usr/bin/${bin}`);
// openpyxl no está en la CI de GitHub: ahí se revisa el .xlsx con el lector propio y el texto crudo (el ZIP va sin comprimir).
const hasOpenpyxl = (() => { if (process.env.GS_TEST_NO_PY) return false; try { execFileSync("python3", ["-I", "-c", "import openpyxl"], { stdio: "ignore" }); return true; } catch { return false; } })();
const pdfText = (file) => execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
const pdfPages = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }))?.[1]);

const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" };
const NOW = Date.UTC(2026, 10, 13, 18);

describe("centro de exportaciones · catálogo de WhatsApp", () => {
  let dir, app, base, ock, ana, beto, ckA, ckB;
  const clock = { t: NOW, now() { return this.t; } };
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const login = async (c) => { const { pin } = await (await post(`/api/admin/customers/${c.id}/login-pin`, {}, ock)).json(); return (await post("/api/auth/customer/pin", { phone: c.phone, pin })).headers.get("set-cookie").split(";")[0]; };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-export-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store;
    s.catalog.updateSettings(owner, { storeName: "Gabriel Store", whatsapp: "59170000000", comboDiscounts: [500, 1000, 1500], announcement: "Promo de noviembre", storeHours: "De 8 a 22" });
    s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix Premium", category: "Streaming", kind: "profile", durationDays: 30, price: 4000, published: true, description: "4K · 1 perfil" });
    s.catalog.upsertProduct(owner, { id: "disney", name: "Disney+", category: "Streaming", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertProduct(owner, { id: "spotify", name: "Spotify Premium", category: "Música", kind: "invite", durationDays: 30, price: 2000, published: true });
    s.catalog.upsertProduct(owner, { id: "oculto", name: "Producto Oculto", category: "Streaming", kind: "profile", durationDays: 30, price: 9900, published: false });
    s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney+ (alquiler revendedores)", category: "Streaming", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
    s.catalog.upsertProduct(owner, { id: "duo", name: "Dúo Netflix + Disney", category: "Streaming", kind: "combo", durationDays: 30, price: 7000, published: true, comboProductIds: ["netflix", "disney"] });
    s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 3000, disney: 2500, spotify: 1300, "disney-alq": 6600 } });
    s.coupons.save(owner, { code: "NOV10", type: "percent", value: 10, resellers: false, active: true, expiresAt: NOW + 10 * DAY });
    const mk = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" });
    ana = mk("Ana Flores", "+59171000001"); beto = mk("Beto Mamani", "+59171000002");
    const AA = { id: "u_" + ana.id, role: "reseller", customerId: ana.id };
    s.shops.setPage(owner, ana.id, true);
    s.shops.setupFor(owner, ana.id, { slug: "ana-tv", title: "Ana TV", whatsapp: "59171000001", enabled: true });
    s.portal.setPrices(AA, { netflix: 4500, disney: 3800, spotify: 2500 });
    s.shops.update(AA, { accentColor: "#e11d48", storeHours: "Lunes a sábado", combos: [{ name: "Pack Familia", productIds: ["netflix", "disney"], price: 7500, note: "Para toda la casa" }], comboDiscounts: [300, 600, 900] });
    s.portal.setPrices({ id: "u_" + beto.id, role: "reseller", customerId: beto.id }, { netflix: 4200 });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    ckA = await login(ana); ckB = await login(beto);
    // Logo de Netflix: un PNG rojo de 64×64 (RGBA) armado acá, para que el catálogo lo incruste.
    const { deflateSync } = await import("node:zlib");
    const W = 64, raw = Buffer.alloc(W * (1 + W * 4)); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const o = y * (1 + W * 4) + 1 + x * 4; raw[o] = 229; raw[o + 1] = 9; raw[o + 2] = 20; raw[o + 3] = 255; }
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    assert.equal((await post("/api/admin/products/netflix/image", { contentBase64: png.toString("base64") }, ock)).status, 200);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("la tienda: marca, precios públicos, combo con sus partes, promos (combo y cupón), sin ocultos ni «solo revendedores»", async () => {
    const d = (await get("/api/admin/descargas/catalogo", ock)).json;
    assert.equal(d.owner, true);
    assert.equal(d.categories[1].items.find((i) => i.name === "Netflix Premium").hasImage, true); assert.ok(!JSON.stringify(d).includes("imageRef"), "el archivo del logo no viaja en el JSON"); assert.equal(d.business.name, "Gabriel Store"); assert.equal(d.business.whatsapp, "59170000000"); assert.match(d.business.url, /\/tienda\/$/);
    assert.deepEqual(d.categories.map((c) => c.name), ["Promos y combos", "Streaming", "Música"]);
    assert.equal(d.categories[0].items[0].savings, 500, "Dúo a Bs 70 contra 40 + 35 sueltos: ahorra Bs 5");
    const names = d.categories.flatMap((c) => c.items.map((i) => i.name));
    assert.ok(!names.includes("Producto Oculto") && !names.some((n) => n.includes("alquiler")), "sin ocultos ni productos de revendedores");
    assert.deepEqual(d.categories[0].items[0].items, ["Netflix Premium", "Disney+"]);
    assert.equal(d.categories[1].items.find((i) => i.name === "Netflix Premium").price, 4000, "precio público, no el de revendedor");
    assert.deepEqual(d.promos, ["Armá tu combo · 2 apps: Bs 5 menos · 3 apps: Bs 10 menos · 4 o más: Bs 15 menos", "Cupón NOV10: 10 % de descuento hasta el 23/11/2026"]);
    const w = (await get("/api/admin/descargas/whatsapp", ock)).json;
    assert.match(w.text, /^🛒 \*GABRIEL STORE\*\nCatálogo · 13\/11\/2026\n📣 Promo de noviembre/);
    assert.match(w.text, /• Netflix Premium — \*Bs 40\*\n   1 mes · 4K · 1 perfil/);
    assert.match(w.text, /wa\.me\/59170000000/); assert.match(w.text, /🕒 De 8 a 22/); assert.match(w.text, /Precios en Bs\. Pueden cambiar sin aviso\./);
    assert.deepEqual(w.categories.map((c) => c.name), ["Promos y combos", "Streaming", "Música"]);
    assert.match(w.text, /Dúo Netflix \+ Disney — \*Bs 70\* \(ahorrás Bs 5\)/);
    // Filtro por categoría.
    const w2 = (await get("/api/admin/descargas/whatsapp?cats=M%C3%BAsica", ock)).json;
    assert.deepEqual(w2.categories.map((c) => c.name), ["Música"]); assert.ok(!w2.text.includes("Netflix"));
    const txt = JSON.stringify(d) + w.text;
    for (const x of ["3000", "2500", "cost", "Clave", "@", "cus_", "asg_"]) assert.ok(!txt.includes(x), `se filtró ${x}`);
  });

  test("el revendedor: su nombre, su WhatsApp, SUS precios, su combo, sus promos y su link; nada de la tienda ni de otro revendedor", async () => {
    const d = (await get("/api/me/descargas/catalogo", ckA)).json;
    assert.equal(d.owner, false); assert.equal(d.business.name, "Ana TV"); assert.equal(d.business.whatsapp, "59171000001"); assert.match(d.business.url, /\/r\/ana-tv$/); assert.equal(d.business.accent, "#e11d48");
    const flat = d.categories.flatMap((c) => c.items);
    assert.equal(flat.find((i) => i.name === "Netflix Premium").price, 4500, "su precio de venta, no el costo ni el público");
    assert.equal(flat.find((i) => i.name === "Pack Familia").price, 7500); assert.deepEqual(flat.find((i) => i.name === "Pack Familia").items, ["Netflix Premium", "Disney+"]);
    assert.equal(flat.find((i) => i.name === "Pack Familia").savings, 800, "sus precios: 45 + 38 = 83 contra 75");
    assert.ok(!flat.some((i) => i.name.includes("Dúo")), "el combo de la tienda no es suyo");
    assert.ok(!flat.some((i) => i.name.includes("alquiler")), "lo que le compra a la tienda no se vende en su catálogo");
    assert.deepEqual(d.promos, ["Armá tu combo · 2 apps: Bs 3 menos · 3 apps: Bs 6 menos · 4 o más: Bs 9 menos"], "sus descuentos, no los de la tienda; el cupón NOV10 es de la tienda");
    const w = (await get("/api/me/descargas/whatsapp", ckA)).json;
    assert.match(w.text, /^🛒 \*ANA TV\*/); assert.match(w.text, /Pack Familia — \*Bs 75\* \(ahorrás Bs 8\)\n   incluye Netflix Premium \+ Disney\+ · Para toda la casa/); assert.match(w.text, /wa\.me\/59171000001/); assert.match(w.text, /🕒 Lunes a sábado/);
    const txt = JSON.stringify(d) + w.text;
    for (const x of ["Gabriel Store", "59170000000", "NOV10", "Beto", "4200", "cus_", "cost", "profit"]) assert.ok(!txt.includes(x), `se filtró ${x}`);
    assert.ok(!flat.some((i) => i.price === 3000 || i.price === 2500 && i.name === "Disney+"), "ningún precio es el costo de revendedor");
    // Beto: solo Netflix (lo único con precio), su nombre, sin página publicada → sin link.
    const b = (await get("/api/me/descargas/catalogo", ckB)).json;
    assert.equal(b.business.name, "Beto Mamani"); assert.equal(b.business.url, undefined);
    assert.deepEqual(b.categories.flatMap((c) => c.items.map((i) => [i.name, i.price])), [["Netflix Premium", 4200]]);
  });

  test("permisos: sin sesión 401; GaboHub pausado → 402; plan Básico sí exporta su catálogo", async () => {
    assert.equal((await get("/api/me/descargas/catalogo")).status, 401);
    assert.equal((await get("/api/admin/descargas/catalogo")).status, 401);
    await post("/api/admin/settings", { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0, basicPrice: 2500 } }, ock);
    app.store.shops.setPlan({ id: "u_" + ana.id, role: "reseller", customerId: ana.id }, ana.id, "basic");
    assert.equal((await get("/api/me/descargas/catalogo", ckA)).status, 200, "el catálogo no es del plan Completo");
    app.store.engine.tx(() => { app.store.engine.s.customers[ana.id].shop.suspended = true; });
    const r = await get("/api/me/descargas/whatsapp", ckA);
    assert.equal(r.status, 402); assert.equal(r.json.error, "HUB_UNPAID");
    app.store.engine.tx(() => { app.store.engine.s.customers[ana.id].shop.suspended = false; });
    await post("/api/admin/settings", { shopRent: { enabled: false, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all" } }, ock);
  });

  test("catálogo PDF: premium (portada + productos) y clásico (1 página grande); cada uno con su marca; sin correos; sin sesión 401", { skip: !has("pdfinfo") && "sin poppler" }, async () => {
    const bin = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, type: r.headers.get("content-type"), name: r.headers.get("content-disposition"), buf: Buffer.from(await r.arrayBuffer()) }; };
    assert.equal((await bin("/api/admin/descargas/catalogo.pdf")).status, 401);
    const prem = await bin("/api/admin/descargas/catalogo.pdf?design=premium", ock);
    assert.equal(prem.status, 200); assert.equal(prem.type, "application/pdf"); assert.match(prem.name, /catalogo-gabriel-store-premium-\d{4}-\d{2}-\d{2}\.pdf/);
    const f1 = join(dir, "prem.pdf"); writeFileSync(f1, prem.buf);
    assert.equal(pdfPages(f1), 2, "portada + productos");
    // Los logos de las apps van incrustados: Netflix tiene imagen y el Dúo la reutiliza para su parte Netflix.
    if (has("pdfimages")) { const imgs = execFileSync("pdfimages", ["-list", "-f", "2", "-l", "2", f1], { encoding: "utf8" }).split("\n").filter((l) => /^\s*2\s+\d+\s+image/.test(l)); assert.ok(imgs.length >= 1, `logos en la página de productos: ${imgs.length}`); }
    const t1 = pdfText(f1);
    for (const x of ["Gabriel Store", "CATÁLOGO DE SUSCRIPCIONES", "Netflix Premium", "Bs 40", "Dúo Netflix + Disney", "Bs 70", "Ahorrás Bs 5", "ahorrás hasta Bs 5", "NOV10", "+591 70000000", "Promo de noviembre", "pueden cambiar"]) assert.ok(t1.includes(x), `falta ${x} en el premium`);
    // Público: el cliente lo baja desde la tienda sin sesión; la página del revendedor también; una página inexistente 404; se guarda en memoria.
    const pub = await bin("/api/catalogo.pdf");
    assert.equal(pub.status, 200); assert.equal(pub.type, "application/pdf"); assert.match(pub.name, /catalogo-gabriel-store-\d{4}-\d{2}-\d{2}\.pdf/);
    const f4 = join(dir, "pub.pdf"); writeFileSync(f4, pub.buf); assert.ok(pdfText(f4).includes("Netflix Premium") && pdfText(f4).includes("Bs 40"));
    const pub2 = await bin("/api/catalogo.pdf"); assert.ok(pub2.buf.equals(pub.buf), "la segunda descarga sale de la memoria, idéntica");
    const pubAna = await bin("/api/shops/ana-tv/catalogo.pdf");
    assert.equal(pubAna.status, 200); assert.match(pubAna.name, /catalogo-ana-tv-/); const f5 = join(dir, "puba.pdf"); writeFileSync(f5, pubAna.buf); const t5 = pdfText(f5); assert.ok(t5.includes("Ana TV") && t5.includes("Pack Familia") && !t5.includes("Gabriel Store"));
    assert.equal((await bin("/api/shops/no-existe/catalogo.pdf")).status, 404);
    for (const x of ["Producto Oculto", "alquiler", "@", "3000"]) assert.ok(!t1.includes(x), `se filtró ${x}`);
    const cla = await bin("/api/admin/descargas/catalogo.pdf?design=clasico&cats=M%C3%BAsica", ock);
    const f2 = join(dir, "cla.pdf"); writeFileSync(f2, cla.buf);
    assert.equal(pdfPages(f2), 1);
    const t2 = pdfText(f2); assert.ok(t2.includes("Spotify Premium") && t2.includes("Bs 20") && !t2.includes("Netflix"), "solo la categoría elegida");
    // Revendedora: su nombre, sus precios y su combo; nada de la tienda.
    const ra = await bin("/api/me/descargas/catalogo.pdf?design=premium", ckA);
    assert.equal(ra.status, 200); assert.match(ra.name, /catalogo-ana-tv-premium/);
    const f3 = join(dir, "ana.pdf"); writeFileSync(f3, ra.buf);
    const t3 = pdfText(f3);
    for (const x of ["Ana TV", "Bs 45", "Pack Familia", "Bs 75", "+591 71000001"]) assert.ok(t3.includes(x), `falta ${x} en el de Ana`);
    for (const x of ["Gabriel Store", "70000000", "NOV10", "Dúo", "Beto", "3000", "2500"]) assert.ok(!t3.includes(x), `se filtró ${x} en el de Ana`);
  });

  test("Excel del negocio: 7 hojas con gráficos, filtros y fórmulas; cifras iguales al sistema; el revendedor solo lo suyo; plan Básico 402; sin sesión 401", async () => {
    const s = app.store;
    // Movimiento real de plata para que el reporte tenga qué sumar: Ana vende a una clienta registrada y la tienda vende directo.
    s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
    s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: "secreto-nf@x.lat", password: "Clave#Secreta1", supplierExpiresAt: NOW + 120 * DAY, cost: 2000, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }] });
    s.wallet.adjust(owner, ana.id, 50000, "demo");
    const AA = { id: "u_" + ana.id, role: "reseller", customerId: ana.id };
    const lucia = s.catalog.createCustomer(AA, { name: "Lucía Benítez", phone: "+59175000011", whatsappConsent: true });
    const oA = s.orders.create(AA, { customerId: lucia.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    s.rtools.setControl(AA, oA.assignmentIds[0], { price: 4500, payStatus: "pendiente" });
    const dir1 = s.catalog.createCustomer(owner, { name: "Directo Pérez", phone: "+59175000022" });
    s.orders.create(owner, { customerId: dir1.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const bin = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, name: r.headers.get("content-disposition"), buf: Buffer.from(await r.arrayBuffer()), json: null }; };
    assert.equal((await bin("/api/admin/descargas/reporte.xlsx")).status, 401);
    assert.equal((await fetch(base + "/api/admin/descargas/reporte.xlsx?from=2026-11-30&to=2026-11-01", { headers: { cookie: ock } })).status, 400, "período al revés");
    const q = "?from=2026-11-01&to=2026-11-30";
    const st = await bin("/api/admin/descargas/reporte.xlsx" + q, ock); assert.equal(st.status, 200); assert.match(st.name, /reporte-gabriel-store-2026-11\.xlsx/);
    const an = await bin("/api/me/descargas/reporte.xlsx" + q, ckA); assert.equal(an.status, 200); assert.match(an.name, /reporte-ana-tv-2026-11\.xlsx/);
    const fS = join(dir, "tienda.xlsx"), fA = join(dir, "ana.xlsx"); writeFileSync(fS, st.buf); writeFileSync(fA, an.buf);
    const { incomeEvents } = await import("../dist/store/income.js");
    const ev = incomeEvents(s.engine).filter((x) => x.at >= Date.UTC(2026, 10, 1, 4));
    // Siempre (con o sin openpyxl): el ZIP va sin comprimir, así que el XML de las hojas se puede buscar como texto.
    const rawS = st.buf.toString("utf8"), rawA = an.buf.toString("utf8");
    for (const sh of ["Portada", "Resumen", "Ventas", "Por producto", "Cobros y deudas", "Vencimientos", "Clientes"]) { assert.ok(rawS.includes(`name="${sh}"`), `hoja ${sh} en la tienda`); assert.ok(rawA.includes(`name="${sh}"`), `hoja ${sh} en Ana`); }
    assert.ok(rawS.includes("Ingresos del período") && rawS.includes("SUM(Ventas!F5:F") && rawS.includes("<c:barChart>") && rawS.includes("<c:pieChart>") && rawS.includes("<autoFilter "), "KPI con fórmula, gráficos y filtro en el de la tienda");
    assert.ok(!rawS.includes("secreto-nf@x.lat") && !rawS.includes("Clave#"), "sin correos ni claves de cuentas");
    assert.ok(rawA.includes("Lucía Benítez") && rawA.includes("Vendiste"), "Ana ve su venta");
    for (const x of ["Directo Pérez", "Beto", "Gabriel Store", "secreto-nf"]) assert.ok(!rawA.includes(x), `Ana ve ${x}`);
    const { readSheet } = await import("../dist/server/xlsx.js");
    const portada = readSheet(st.buf); assert.equal(portada[0][0], "Gabriel Store"); assert.ok(portada.some((r) => r[0] === "Ventas" && r[1] === String(ev.filter((x) => x.kind === "sale").length)), "la portada cuenta las ventas del período");
    if (hasOpenpyxl) {
    const py = `
import openpyxl, json, sys
out = {}
for key, f in [("tienda", sys.argv[1]), ("ana", sys.argv[2])]:
    wb = openpyxl.load_workbook(f)
    v = wb["Ventas"]; rows = [[c.value for c in r] for r in v.iter_rows(min_row=5, max_row=v.max_row)]
    out[key] = { "sheets": wb.sheetnames, "charts": {ws.title: len(ws._charts) for ws in wb.worksheets}, "filters": {ws.title: ws.auto_filter.ref for ws in wb.worksheets},
      "kpi1": [wb["Portada"].cell(6,1).value, wb["Portada"].cell(6,2).value], "ventasTotal": rows[-1], "ventas": rows[:-1], "text": " ".join(str(c.value) for ws in wb.worksheets for r in ws.iter_rows() for c in r if c.value is not None) }
print(json.dumps(out, default=str))`;
    const out = JSON.parse(execFileSync("python3", ["-I", "-c", py, fS, fA], { encoding: "utf8" }));
    assert.deepEqual(out.tienda.sheets, ["Portada", "Resumen", "Ventas", "Por producto", "Cobros y deudas", "Vencimientos", "Clientes"]);
    assert.equal(out.tienda.charts.Resumen, 1); assert.equal(out.tienda.charts["Por producto"], 2); assert.match(out.tienda.filters.Ventas, /^A4:H\d+$/);
    assert.deepEqual(out.tienda.kpi1, ["Ingresos del período", "=SUM(Ventas!F5:F6)"], "la portada suma la hoja Ventas con una fórmula");
    // Cifras = sistema: los ingresos de noviembre según income.ts.
    assert.equal(out.tienda.ventas.length, ev.length, "una fila por ingreso");
    assert.equal(out.tienda.ventas.reduce((t, r) => t + r[5], 0), ev.reduce((t, x) => t + x.amount, 0) / 100, "la suma de la columna Monto = ingresos del sistema");
    assert.match(out.tienda.ventasTotal[5], /^=SUM\(F5:F\d+\)$/);
    assert.ok(out.tienda.text.includes("Ana TV") || out.tienda.text.includes("Ana Flores"), "la tienda ve a sus revendedores");
    assert.ok(!out.tienda.text.includes("secreto-nf@x.lat") && !out.tienda.text.includes("Clave#"), "sin correos ni claves de cuentas");
    // Ana: solo lo suyo.
    assert.deepEqual(out.ana.sheets, out.tienda.sheets);
    assert.equal(out.ana.ventas.length, 1); assert.equal(out.ana.ventas[0][1], "Lucía Benítez"); assert.equal(out.ana.ventas[0][4], 45, "vendió a su precio"); assert.equal(out.ana.ventas[0][5], 30, "le pagó a la tienda su costo de revendedor");
    for (const x of ["Directo Pérez", "Beto", "Gabriel Store", "secreto-nf", "2000"]) assert.ok(!out.ana.text.includes(x), `Ana ve ${x}`);
    }
    // Plan Básico: el Excel es del plan Completo (como Mi control).
    await post("/api/admin/settings", { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0, basicPrice: 2500 } }, ock);
    s.shops.setPlan(AA, ana.id, "basic");
    assert.equal((await fetch(base + "/api/me/descargas/reporte.xlsx" + q, { headers: { cookie: ckA } })).status, 402);
    s.shops.setPlan(AA, ana.id, "full");
    await post("/api/admin/settings", { shopRent: { enabled: false, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all" } }, ock);
  });

  test("navegador a 360 px: «Mis descargas» en GaboHub con vista previa, diseños, categorías y copiar", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
      await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* */ } }, ana.id);
      const [n, v] = ckA.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/hub#inicio"); await p.locator(".htiles").waitFor();
      await p.locator('.bnav [data-s="mas"]').click(); await p.locator('[data-rtool="descargas"]').click();
      await p.waitForSelector(".dl-prev", { timeout: 20_000 });
      const txt = (await p.locator("#sout").innerText()).replace(/\s+/g, " ");
      assert.match(txt, /Mis descargas/); assert.match(txt, /Ana TV/); assert.match(txt, /Pack Familia/); assert.match(txt, /Bs 75/);
      assert.ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 360, "sin scroll horizontal");
      assert.equal(await p.locator('a[href*="/api/me/descargas/catalogo.pdf?design=premium"]').count(), 1);
      await p.locator('[data-dldesign="clasico"]').click(); await p.waitForSelector('a[href*="design=clasico"]');
      assert.equal(await p.locator('a[href*="/api/me/descargas/reporte.xlsx?from="]').count(), 1);
      await p.locator('[data-dlcopy="*"]').click();
      await p.waitForFunction(() => /copiado/i.test(document.body.innerText), null, { timeout: 10_000 });
      const clip = await p.evaluate(() => navigator.clipboard.readText());
      assert.match(clip, /^🛒 \*ANA TV\*/); assert.ok(!clip.includes("Gabriel Store"));
      // Sacar una categoría: la vista previa y el texto la dejan de incluir.
      await p.locator('[data-dlcat="Música"]').uncheck(); await p.waitForTimeout(600);
      assert.ok(!(await p.locator(".dl-prev").innerText()).includes("Spotify"));
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  });
});
