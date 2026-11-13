// Viste la tienda de prueba del «Desfile de estilos»: los LOGOS REALES de cada producto (copiados de la tienda real con
// traer-catalogo.sh), el logo y la portada de la revendedora de ejemplo y un QR que dice EJEMPLO.
// Uso: con la tienda de prueba corriendo → BASE=http://localhost:8091 node promo/gabohub-estilos/vestir.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const B = process.env.BASE || "http://localhost:8091";
const LOGOS = path.join(__dirname, "catalogo-real/logos"), OTROS = path.join(__dirname, "../gabohub/vestir");
const b64 = (f) => ({ contentBase64: fs.readFileSync(f).toString("base64") });
(async () => {
  const br = await chromium.launch();
  const post = async (ctx, url, data) => { const r = await ctx.request.post(B + url, { data, headers: { origin: B } }); if (!r.ok()) throw new Error(url + " " + r.status() + " " + (await r.text())); return r.json(); };
  const owner = await br.newContext();
  await post(owner, "/api/auth/staff/login", { username: "gabriel", password: "demo-gabriel-2026" });
  for (const f of fs.readdirSync(LOGOS)) await post(owner, `/api/admin/products/${path.basename(f, ".png")}/image`, b64(path.join(LOGOS, f)));
  await post(owner, "/api/admin/settings/qr", b64(path.join(OTROS, "qr-ejemplo.png")));
  const ar = (await (await owner.request.get(B + "/api/admin/customers?q=Ariana")).json()).find((c) => c.kind === "reseller");
  await post(owner, `/api/admin/customers/${ar.id}/login-pin`, { pin: "2468" });
  const arc = await br.newContext();
  await post(arc, "/api/auth/customer/pin", { phone: "+59171234567", pin: "2468" });
  await post(arc, "/api/me/shop/logo", b64(path.join(OTROS, "ariana-logo.png")));
  await post(arc, "/api/me/shop/banner", b64(path.join(OTROS, "ariana-portada.png")));
  console.log("tienda vestida con", fs.readdirSync(LOGOS).length, "logos reales · revendedora", ar.id);
  await br.close();
})();
