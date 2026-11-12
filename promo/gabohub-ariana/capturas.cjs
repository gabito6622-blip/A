// Capturas de «La historia de Ariana» (GaboHub) desde la tienda LOCAL de prueba (datos ficticios).
// Antes: seed-video.mjs + vestir-tienda.cjs de promo/gabohub y la tienda corriendo en el puerto 8090.
// Guarda en assets/: cada pantalla entera (celular 390 px ×3) y en recortes.js dónde está cada pedazo que «sale
// flotando» en el video (px CSS de la captura), más el mensaje real de «Avisarle».
// Uso: node promo/gabohub-ariana/capturas.cjs
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const B = process.env.BASE || "http://localhost:8090";
const OUT = path.join(__dirname, "assets");
fs.mkdirSync(OUT, { recursive: true });
const PHONE = "+59171234567", PIN = "2468";

const clean = () => {
  const fix = (s) => s.replace(/https?:\/\/localhost:8090/g, "gabohub");
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) if (n.nodeValue.includes("localhost")) n.nodeValue = fix(n.nodeValue);
  for (const i of document.querySelectorAll("input,textarea")) if (i.value.includes("localhost")) i.value = fix(i.value);
  for (const t of document.querySelectorAll(".toast,#tour")) t.remove();
};
// el recuadro más chico (de los selectores dados) que contiene el texto
const boxOf = (p, text, sel) => p.evaluate(([text, sel]) => {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.textContent.includes(text) && e.getBoundingClientRect().width > 40);
  if (!els.length) return null;
  els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
  const r = els[0].getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
}, [text, sel]);

// el recuadro de un elemento elegido con una función (la primera coincidencia en la página)
const boxBy = (p, fnSrc) => p.evaluate((src) => {
  const e = new Function("return (" + src + ")")()();
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
}, fnSrc);

(async () => {
  const br = await chromium.launch();
  const mk = () => br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark", locale: "es-BO" });
  const owner = await mk();
  await owner.request.post(B + "/api/auth/staff/login", { data: { username: "gabriel", password: "demo-gabriel-2026" }, headers: { origin: B } });
  const arId = (await (await owner.request.get(B + "/api/admin/customers?q=Ariana")).json()).find((c) => c.kind === "reseller").id;
  await owner.request.post(B + `/api/admin/customers/${arId}/login-pin`, { data: { pin: PIN }, headers: { origin: B } });
  const ar = await mk();
  const r = await ar.request.post(B + "/api/auth/customer/pin", { data: { phone: PHONE, pin: PIN }, headers: { origin: B } });
  if (!r.ok()) throw new Error("login revendedora " + r.status());
  await ar.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch {} }, arId);
  const pub = await mk();

  const cuts = {};
  const shot = async (p, name, h) => {
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    const H = Math.min(h, await p.evaluate(() => document.documentElement.scrollHeight));
    await p.screenshot({ path: path.join(OUT, name + ".jpg"), type: "jpeg", quality: 88, fullPage: true, clip: { x: 0, y: 0, width: 390, height: H } });
    console.log(name, H);
  };
  const go = async (ctx, url, tab) => {
    const p = await ctx.newPage();
    await p.goto(B + url); await p.waitForTimeout(1600);
    if (tab) { await p.click(`[data-rtab=${tab}]`); await p.waitForTimeout(1200); }
    // antes de medir: limpiar y sacar la barra de abajo (fija); así los recortes coinciden con la captura
    await p.evaluate(clean);
    await p.addStyleTag({ content: ".bnav{display:none!important}" });
    await p.waitForTimeout(200);
    return p;
  };

  // la tienda de Ariana (lo que ven sus clientes)
  let p = await go(pub, "/r/ariana-streaming");
  cuts.tiendaBanner = await boxBy(p, `() => document.querySelector('img[src*="banner"]') || [...document.querySelectorAll("#sout *")].find((e) => getComputedStyle(e).backgroundImage.includes("banner"))`);
  cuts.tiendaHero = await boxBy(p, `() => document.querySelector("#sout h1, #sout h2")?.closest("section, .hero, div")`);
  cuts.tiendaCombo = await boxOf(p, "Dúo Series", "article");
  await shot(p, "tienda", 2600); await p.close();

  // precios de revendedor
  p = await go(ar, "/#precios");
  cuts.precioNetflix = await boxOf(p, "Netflix", "article");
  await shot(p, "precios", 3000); await p.close();

  // mis cuentas: los números y una cuenta con sus datos
  p = await go(ar, "/#cuentas");
  cuts.cuentasNumeros = await boxBy(p, `() => [...document.querySelectorAll("#sout *")].find((e) => e.children.length === 0 && e.textContent.trim() === "Mis cuentas")?.parentElement?.parentElement`);
  cuts.cuentaPrimera = await boxBy(p, `() => document.querySelector("#sout .svc")`);
  await shot(p, "cuentas", 2200); await p.close();

  // panel: saldo y clientes; y lo que vence, con «Avisarle»
  p = await go(ar, "/#clientes");
  cuts.panelSaldo = await boxOf(p, "Mi saldo", "div");
  cuts.vence = await boxBy(p, `() => [...document.querySelectorAll("#sout a")].find((a) => a.textContent.includes("Avisarle"))?.closest(".svc")`);
  cuts.venceAvisar = await boxBy(p, `() => [...document.querySelectorAll("#sout a")].find((a) => a.textContent.includes("Avisarle"))`);
  cuts.panelNumeros = await boxBy(p, `() => [...document.querySelectorAll("#sout *")].find((e) => e.children.length === 0 && e.textContent.trim() === "Mi saldo")?.parentElement?.parentElement`);
  const href = await p.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.includes("Avisarle"))?.href || "");
  cuts.mensaje = decodeURIComponent((href.split("text=")[1] || "").replace(/\+/g, " "));
  await shot(p, "panel", 3200); await p.close();

  // mis combos y precios
  p = await go(ar, "/#clientes", "combos");
  cuts.misCombos = await boxOf(p, "Mis combos", ".sbox");
  await shot(p, "combos", 2600); await p.close();

  // referidos
  p = await go(ar, "/#inicio");
  cuts.referidos = await boxOf(p, "Referí y ganá", ".sbox");
  cuts.referidosNumeros = await boxBy(p, `() => [...document.querySelectorAll("#sout *")].find((e) => e.children.length === 0 && e.textContent.trim() === "referidos")?.parentElement?.parentElement`);
  await shot(p, "inicio", 2600); await p.close();

  fs.writeFileSync(path.join(OUT, "recortes.js"), "window.CUTS = " + JSON.stringify(cuts, null, 1) + ";\n");
  console.log(JSON.stringify(cuts, null, 1));
  await br.close();
})();
