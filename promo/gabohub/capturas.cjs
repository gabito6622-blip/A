// Saca las capturas del video de GaboHub (celular 390 px, x3) desde una copia LOCAL con datos ficticios.
// 1) node promo/gabohub/seed-video.mjs <carpeta>     (revendedora de prueba «Ariana Streaming», sin azar)
// 2) GS_DATA_DIR=<carpeta> PORT=8090 node dist/server/main.js
// 3) node promo/gabohub/vestir-tienda.cjs           (logos, portadas, QR de ejemplo e íconos de productos)
// 4) node promo/gabohub/capturas.cjs                → promo/gabohub/assets/
// Por cada escena guarda: <id>-top.jpg (barra de arriba), <id>-body.jpg (contenido) y <id>-nav.png (barra de abajo);
// o <id>-full.jpg si la pantalla no tiene esas barras. Reemplaza "http://localhost:8090" por "gabohub" en lo que se ve.
const { chromium } = require("playwright");
const path = require("path");
const B = process.env.BASE || "http://localhost:8090";
const OUT = path.join(__dirname, "assets");
const PHONE = process.env.AR_PHONE || "+59171234567", PIN = "2468";

// id, contexto (ar = revendedora, pub = visitante), dirección, pestaña, desde qué texto arranca, alto en px css
const SHOTS = [
  ["precios", "ar", "/#precios", null, null, 1800],
  ["cuentas", "ar", "/#cuentas", null, null, 1600],
  ["panel", "ar", "/#clientes", null, null, 1600],
  ["vencen", "ar", "/#clientes", null, "Por vencer", 1700],
  ["tienda", "pub", "/r/ariana-streaming", null, null, 3400, true],
  ["combos", "ar", "/#clientes", "combos", null, 1800],
  ["referidos", "ar", "/#inicio", null, "Referí y ganá", 1200],
];

const clean = () => {
  const fix = (s) => s.replace(/https?:\/\/localhost:8090/g, "gabohub");
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) if (n.nodeValue.includes("localhost")) n.nodeValue = fix(n.nodeValue);
  for (const i of document.querySelectorAll("input,textarea")) if (i.value.includes("localhost")) i.value = fix(i.value);
  for (const t of document.querySelectorAll(".toast,#tour")) t.remove();
  // Control: la tienda tiene que estar completa (seed-video + vestir-tienda). Si algo quedó a medio armar, se avisa.
  const bad = [...document.querySelectorAll("#sout *")].filter((n) => n.children.length === 0 && /Agotado|A pedido|todavía no cargó|\(demo\)|proveedor\.lat/.test(n.textContent));
  return bad.map((n) => n.textContent.trim().slice(0, 60));
};

(async () => {
  const br = await chromium.launch();
  const mk = () => br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark", locale: "es-BO" });
  const owner = await mk();
  const login = await owner.request.post(B + "/api/auth/staff/login", { data: { username: "gabriel", password: "demo-gabriel-2026" }, headers: { origin: B } });
  if (!login.ok()) throw new Error("login dueño: " + login.status());
  const arId = (await (await owner.request.get(B + "/api/admin/customers?q=Ariana")).json()).find((c) => c.kind === "reseller").id;
  await owner.request.post(B + `/api/admin/customers/${arId}/login-pin`, { data: { pin: PIN }, headers: { origin: B } });
  const ar = await mk();
  const r = await ar.request.post(B + "/api/auth/customer/pin", { data: { phone: PHONE, pin: PIN }, headers: { origin: B } });
  if (!r.ok()) throw new Error("login revendedora: " + r.status());
  await ar.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch {} }, arId);
  const ctx = { ar, pub: await mk() };

  for (const [id, who, url, tab, from, h, full] of SHOTS) {
    const page = await ctx[who].newPage();
    await page.goto(B + url);
    await page.waitForTimeout(1500);
    if (tab) { await page.click(`[data-rtab=${tab}]`); await page.waitForTimeout(1200); }
    const bad = await page.evaluate(clean);
    if (bad.length) console.warn(`OJO, ${id} se ve a medio armar:`, bad);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    if (full) {
      await page.addStyleTag({ content: ".bnav{display:none!important}" });
      await page.screenshot({ path: `${OUT}/${id}-full.jpg`, type: "jpeg", quality: 88, fullPage: true, clip: { x: 0, y: 0, width: 390, height: h } });
      await page.close();
      continue;
    }
    // barras de arriba y abajo (de la pantalla tal cual)
    const hh = await page.evaluate(() => Math.ceil(document.querySelector(".shead").getBoundingClientRect().bottom));
    const nh = await page.evaluate(() => Math.ceil(document.querySelector(".bnav").getBoundingClientRect().height));
    await page.screenshot({ path: `${OUT}/${id}-top.jpg`, type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: 390, height: hh } });
    await page.screenshot({ path: `${OUT}/${id}-nav.png`, clip: { x: 0, y: 844 - nh, width: 390, height: nh } });
    // contenido: sin las barras fijas, desde el texto pedido
    await page.addStyleTag({ content: ".shead{visibility:hidden}.bnav{display:none!important}" });
    let y = hh;
    if (from) y = await page.evaluate((txt) => {
      const hs = [...document.querySelectorAll("#sout h2,#sout h3,#sout b,#sout strong")].filter((e) => e.textContent.includes(txt));
      if (!hs.length) throw new Error("no encuentro " + txt);
      const box = hs[0].closest(".sbox,.card,section,.rcard") || hs[0];
      return Math.max(0, Math.floor(box.getBoundingClientRect().top + window.scrollY) - 14);
    }, from);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const hgt = Math.min(h, docH - y);
    await page.screenshot({ path: `${OUT}/${id}-body.jpg`, type: "jpeg", quality: 88, fullPage: true, clip: { x: 0, y, width: 390, height: hgt } });
    console.log(id, "top", hh, "nav", nh, "desde", y, "alto", hgt);
    await page.close();
  }
  await br.close();
})();
