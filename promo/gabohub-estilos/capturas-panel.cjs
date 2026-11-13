// Capturas del panel de la revendedora de ejemplo para el «Desfile de estilos» (tienda de prueba, datos ficticios).
// Guarda cada pantalla entera (celular 390 px ×3) y en assets/recortes.js dónde está cada pedazo que sale flotando.
// Uso: node promo/gabohub-estilos/capturas-panel.cjs   (tienda de prueba en BASE, por defecto :8091)
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const B = process.env.BASE || "http://localhost:8091";
const OUT = path.join(__dirname, "assets");
fs.mkdirSync(OUT, { recursive: true });

const prep = () => {
  const fix = (s) => s.replace(/https?:\/\/localhost:\d+/g, "gabohub");
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) if (n.nodeValue.includes("localhost")) n.nodeValue = fix(n.nodeValue);
  for (const i of document.querySelectorAll("input,textarea")) if (i.value.includes("localhost")) i.value = fix(i.value);
  for (const t of document.querySelectorAll(".toast,#tour")) t.remove();
  const st = document.createElement("style"); st.textContent = ".bnav{display:none!important}"; document.head.appendChild(st);
};
// recuadro (px CSS de la página) del elemento que devuelve la función
const boxBy = (p, src) => p.evaluate((src) => {
  const e = new Function("return (" + src + ")")()();
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
}, src);
const leaf = (txt) => `[...document.querySelectorAll("#sout *")].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(txt)})`;
const has = (sel, txt) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(txt)}))`;

(async () => {
  const br = await chromium.launch();
  const mk = () => br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark", locale: "es-BO" });
  const ar = await mk();
  const r = await ar.request.post(B + "/api/auth/customer/pin", { data: { phone: "+59171234567", pin: "2468" }, headers: { origin: B } });
  if (!r.ok()) throw new Error("login " + r.status());
  const id = (await r.json()).id;
  await ar.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch {} }, id);
  const pub = await mk();
  const cuts = {};
  const open = async (ctx, url, tab) => {
    const p = await ctx.newPage();
    await p.goto(B + url); await p.waitForTimeout(1600);
    if (tab) { await p.click(`[data-rtab=${tab}]`); await p.waitForTimeout(1200); }
    await p.evaluate(prep); await p.waitForTimeout(200);
    return p;
  };
  const shot = async (p, name, h) => {
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    const H = Math.min(h, await p.evaluate(() => document.documentElement.scrollHeight));
    await p.screenshot({ path: path.join(OUT, name + ".jpg"), type: "jpeg", quality: 88, fullPage: true, clip: { x: 0, y: 0, width: 390, height: H } });
    console.log(name, H);
  };

  // Mi página: el editor
  let p = await open(ar, "/#clientes", "pagina");
  cuts.publicada = await boxBy(p, `() => ${has("#sout .sbox", "Tu página está publicada")}`);
  cuts.estilos = await boxBy(p, `() => ${has("#sout .sbox", "Elegí un estilo")}`);
  cuts.vista = await boxBy(p, `() => ${has("#sout .sbox", "Vista previa")}`);
  const chips = (t) => `() => [...document.querySelectorAll("#sout .ropts label")].find((l) => l.textContent.includes(${JSON.stringify(t)}))?.closest(".ropts")`;
  cuts.tipo = await boxBy(p, chips("Vitrina"));
  cuts.fondos = await boxBy(p, chips("Brillo arriba"));
  cuts.tarjetas = await boxBy(p, chips("Boleto de cine"));
  cuts.logo = await boxBy(p, `() => ${has("#sout .sbox", "Logo y portada")}`);
  await shot(p, "pagina", 8000); await p.close();

  // clientes y vencimientos
  p = await open(ar, "/#clientes");
  cuts.numeros = await boxBy(p, `() => ${leaf("Mi saldo")}?.parentElement?.parentElement`);
  cuts.vence = await boxBy(p, `() => [...document.querySelectorAll("#sout a")].find((a) => a.textContent.includes("Avisarle"))?.closest(".svc")`);
  cuts.avisar = await boxBy(p, `() => [...document.querySelectorAll("#sout a")].find((a) => a.textContent.includes("Avisarle"))`);
  const href = await p.evaluate(() => [...document.querySelectorAll("#sout a")].find((a) => a.textContent.includes("Avisarle"))?.href || "");
  cuts.mensaje = decodeURIComponent((href.split("text=")[1] || "").replace(/\+/g, " "));
  await shot(p, "clientes", 3000); await p.close();

  // combos y descuentos
  p = await open(ar, "/#clientes", "combos");
  cuts.descuentos = await boxBy(p, `() => ${has("#sout .sbox", "descuento por cantidad")}`);
  cuts.combos = await boxBy(p, `() => ${has("#sout .sbox", "Mis combos")}`);
  await shot(p, "combos", 2600); await p.close();

  // cupones
  p = await open(ar, "/#clientes", "cupones");
  cuts.cupones = await boxBy(p, `() => ${has("#sout .sbox", "AMIGOS10")}`);
  await shot(p, "cupones", 2000); await p.close();

  // códigos de acceso
  p = await open(ar, "/#codigos");
  cuts.codigos = await boxBy(p, `() => ${has("#sout .sbox", "Tu link de códigos")}`);
  await shot(p, "codigos", 1600); await p.close();

  // directorio de tiendas (lo que ve cualquiera)
  p = await open(pub, "/#tiendas");
  cuts.directorio = await boxBy(p, `() => ${has("#sout article, #sout .sbox, #sout a", "Visitar tienda")}`);
  await shot(p, "directorio", 1400); await p.close();

  fs.writeFileSync(path.join(OUT, "recortes.js"), "window.CUTS = " + JSON.stringify(cuts, null, 1) + ";\n");
  for (const [k, v] of Object.entries(cuts)) console.log(k, typeof v === "string" ? v : JSON.stringify(v));
  await br.close();
})();
