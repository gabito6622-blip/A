// «Viste» la tienda de prueba del video: íconos propios para cada producto, logo y portada de la tienda,
// logo y portada de la revendedora y un QR de pago DE EJEMPLO. Todo diseñado acá (sin logos de las marcas).
// Uso: con la tienda local corriendo (ver README) → node promo/gabohub/vestir-tienda.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const B = process.env.BASE || "http://localhost:8090";
const PHONE = "+59171234567", PIN = "2468";

// Pictogramas propios (trazo blanco, grilla de 24).
const ICONS = {
  film: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/><path d="M10.6 9.9v4.2l3.4-2.1z" fill="#fff"/>',
  wand: '<path d="M4 20 14 10"/><path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9z" fill="#fff"/><path d="M9 4l.5 1.2L10.7 6l-1.2.5L9 7.7l-.5-1.2L7.3 6l1.2-.5z" fill="#fff"/><path d="M19 13l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill="#fff"/>',
  clapper: '<path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10 4.4 5.2 19.6 3l1 4.4"/><path d="M8.2 4.4 9.6 9M13.6 3.6 15 8.2"/>',
  tv: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M8 2.5l4 3.5 4-3.5"/><path d="M10.4 10v5l4.1-2.5z" fill="#fff"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/>',
  star: '<path d="M12 2.8l2.6 5.9 6.4.6-4.9 4.2 1.5 6.3L12 16.5l-5.6 3.3 1.5-6.3L3 9.3l6.4-.6z"/>',
  chat: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M12 6.8l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="#fff"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.3" fill="#fff"/><circle cx="10" cy="7" r="1.3" fill="#fff"/><circle cx="14.6" cy="7" r="1.3" fill="#fff"/>',
};
const PRODUCTS = {
  netflix: ["film", "#e50914"], disney: ["wand", "#1f4fe0"], max: ["clapper", "#8b5cf6"], prime: ["tv", "#00a8e1"],
  spotify: ["music", "#1db954"], youtube: ["play", "#ff3b30"], crunchy: ["star", "#f47521"], chatgpt: ["chat", "#10a37f"], canva: ["palette", "#7d2ae8"],
};
const COMBOS = { "combo-cine": ["netflix", "disney", "max"], "combo-full": ["netflix", "spotify", "chatgpt"] };

const tile = (icon, color, size) => `<div style="width:${size}px;height:${size}px;border-radius:${size * .27}px;position:relative;overflow:hidden;
  background:radial-gradient(circle at 28% 22%, color-mix(in srgb, ${color} 55%, #fff) 0%, ${color} 46%, color-mix(in srgb, ${color} 70%, #000) 100%);
  box-shadow:inset 0 0 0 ${size * .012}px rgba(255,255,255,.28), inset 0 -${size * .05}px ${size * .12}px rgba(0,0,0,.25)">
  <i style="position:absolute;left:-20%;top:-55%;width:140%;height:95%;border-radius:50%;background:linear-gradient(rgba(255,255,255,.32),rgba(255,255,255,0))"></i>
  <svg viewBox="0 0 24 24" style="position:absolute;left:22%;top:22%;width:56%;height:56%" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg></div>`;

const html = (body, w, h, bg = "transparent") => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box} html,body{width:${w}px;height:${h}px;background:${bg};overflow:hidden;font-family:"Inter Display","Inter",sans-serif}
  </style></head><body>${body}</body></html>`;

const PAGES = {
  ...Object.fromEntries(Object.entries(PRODUCTS).map(([id, [ic, col]]) => [`p-${id}`, [html(`<div style="padding:32px">${tile(ic, col, 448)}</div>`, 512, 512), 512, 512]])),
  ...Object.fromEntries(Object.entries(COMBOS).map(([id, parts]) => [`p-${id}`, [html(`<div style="position:relative;width:1000px;height:480px">${parts.map((p, i) =>
    `<div style="position:absolute;left:${70 + i * 270}px;top:${i === 1 ? 30 : 70}px;transform:rotate(${(i - 1) * 8}deg);filter:drop-shadow(0 18px 30px rgba(0,0,0,.45));z-index:${i === 1 ? 2 : 1}">${tile(PRODUCTS[p][0], PRODUCTS[p][1], i === 1 ? 400 : 350)}</div>`).join("")}</div>`, 1000, 480), 1000, 480]])),
  "tienda-logo": [html(`<div style="padding:24px"><div style="width:464px;height:464px;border-radius:126px;display:grid;place-items:center;background:linear-gradient(140deg,#5b9bff,#2563eb 55%,#4f46e5);box-shadow:inset 0 0 0 6px rgba(255,255,255,.18)">
    <b style="font-size:300px;font-weight:900;color:#fff;letter-spacing:-.04em;margin-top:-20px">G</b></div></div>`, 512, 512), 512, 512],
  "tienda-portada": [html(`<div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 20%,#3b6dff 0,transparent 45%),radial-gradient(circle at 10% 90%,#7c3aed 0,transparent 40%),linear-gradient(135deg,#0a1230,#101a44)"></div>
    <div style="position:absolute;left:110px;top:190px;color:#fff"><div style="font-size:120px;font-weight:900;letter-spacing:-.04em">Gabriel Store</div>
    <div style="font-size:48px;font-weight:600;opacity:.85;margin-top:10px">Streaming, música e IA · entrega al instante</div></div>`, 1600, 600, "#0a1230"), 1600, 600],
  "ariana-logo": [html(`<div style="padding:24px"><div style="width:464px;height:464px;border-radius:50%;display:grid;place-items:center;position:relative;background:conic-gradient(from 210deg,#ff2e88,#a855f7,#00d4ff,#ff2e88);">
    <div style="position:absolute;inset:22px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#2a1640,#0b0b16 70%)"></div>
    <b style="position:relative;font-size:250px;font-weight:900;letter-spacing:-.06em;background:linear-gradient(135deg,#ff5fa8,#7cc8ff);-webkit-background-clip:text;color:transparent;margin-top:-10px">A</b>
    <svg viewBox="0 0 24 24" style="position:absolute;right:84px;top:80px;width:80px" fill="#fff"><path d="M12 2l2 6.5L20.5 10 14 12l-2 6.5L10 12 3.5 10 10 8.5z"/></svg></div></div>`, 512, 512), 512, 512],
  // La portada se recorta a los costados en el celular: el texto va centrado y angosto.
  "ariana-portada": [html(`<div style="position:absolute;inset:0;background:radial-gradient(circle at 78% 30%,rgba(0,212,255,.55) 0,transparent 38%),radial-gradient(circle at 22% 75%,rgba(255,46,136,.6) 0,transparent 40%),#0b0b16"></div>
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 2px,transparent 2px 80px)"></div>
    <div style="position:absolute;left:0;right:0;top:175px;text-align:center;color:#fff"><div style="font-size:112px;font-weight:900;letter-spacing:-.045em;line-height:1">Ariana <span style="background:linear-gradient(90deg,#ff2e88,#00d4ff);-webkit-background-clip:text;color:transparent">Streaming</span></div>
    <div style="font-size:46px;font-weight:600;opacity:.85;margin-top:22px">Series, películas y música · al toque</div></div>`, 1600, 600, "#0b0b16"), 1600, 600],
};

(async () => {
  const out = path.join(__dirname, "vestir");
  fs.mkdirSync(out, { recursive: true });
  const br = await chromium.launch();
  const pg = await br.newPage({ deviceScaleFactor: 1 });
  for (const [name, [content, w, h]] of Object.entries(PAGES)) {
    await pg.setViewportSize({ width: w, height: h });
    await pg.setContent(content);
    await pg.evaluate(() => document.fonts.ready);
    await pg.screenshot({ path: path.join(out, name + ".png"), omitBackground: true });
  }
  const b64 = (name) => ({ contentBase64: fs.readFileSync(path.join(out, name + ".png")).toString("base64") });
  const post = async (ctx, url, data) => { const r = await ctx.request.post(B + url, { data, headers: { origin: B } }); if (!r.ok()) throw new Error(url + " " + r.status() + " " + (await r.text())); return r.json(); };

  const owner = await br.newContext();
  await post(owner, "/api/auth/staff/login", { username: "gabriel", password: "demo-gabriel-2026" });
  for (const id of [...Object.keys(PRODUCTS), ...Object.keys(COMBOS)]) await post(owner, `/api/admin/products/${id}/image`, b64("p-" + id));
  await post(owner, "/api/admin/settings/logo", b64("tienda-logo"));
  await post(owner, "/api/admin/settings/banner", b64("tienda-portada"));
  await post(owner, "/api/admin/settings/qr", b64("qr-ejemplo"));
  const ar = (await (await owner.request.get(B + "/api/admin/customers?q=" + encodeURIComponent("Ariana"))).json()).find((c) => c.kind === "reseller");
  await post(owner, `/api/admin/customers/${ar.id}/login-pin`, { pin: PIN });

  const arc = await br.newContext();
  await post(arc, "/api/auth/customer/pin", { phone: PHONE, pin: PIN });
  await post(arc, "/api/me/shop/logo", b64("ariana-logo"));
  await post(arc, "/api/me/shop/banner", b64("ariana-portada"));
  console.log("tienda vestida · revendedora", ar.id);
  await br.close();
})();
