// Tienda en la computadora (15/11/2026). El dueño: «en la computadora ya no se ve tan cómodo como antes» y «los combos,
// chiquitín, no se ven los loguitos». Cada tarjeta medía 351 px (entraban 3 productos por pantalla) y los logos de las
// etiquetas del combo medían 10 px. Ahora: la tira tipo boleto con el talón a la derecha (precio, «Agregar», «Ver qué
// incluye»), 2 columnas y logos más grandes. El celular no cambia. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082", "hex").toString("base64");

test("computadora: tira compacta con el talón a la derecha, 2 columnas y logos de combo grandes", { timeout: 180_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-pc-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  const P = (id, name, kind, d, price, extra = {}) => post("/api/admin/products", { id, name, kind, durationDays: d, price, published: true, category: kind === "combo" ? "Combos" : "Streaming", description: `${name}.`, ...extra }, ck);
  await P("netflix", "Netflix Premium HD 4K", "profile", 30, 4000);
  await P("netflix-3m", "Netflix Premium HD 4K · 3 meses", "profile", 90, 12000);
  await P("disney", "Disney+ sin ESPN", "profile", 30, 1700);
  await P("prime", "Amazon Prime Video", "profile", 30, 2000);
  await P("hbo", "HBO Max", "profile", 30, 1500);
  await P("combo1", "Combo Familia", "combo", 30, 4200, { comboProductIds: ["prime", "disney", "hbo"] });
  for (const id of ["netflix", "disney", "prime", "hbo"]) await post(`/api/admin/products/${id}/image`, { contentBase64: PNG }, ck);
  await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", layout: "ticket", alwaysAvailable: true }, ck);
  const b = await chromium.launch();
  try {
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/tienda/#inicio");
      await p.waitForFunction(() => document.querySelector(".tkcombo"));
      const m = await p.evaluate(() => {
        const rect = (e) => e.getBoundingClientRect();
        const tks = [...document.querySelectorAll(".tk")];
        const nf = tks.find((t) => /Netflix Premium/.test(t.querySelector("h3").textContent));
        const combo = document.querySelector(".tkcombo");
        const end = nf.querySelector(".tkend"), mid = nf.querySelector(".tkmid");
        const btn = nf.querySelector("[data-add]"), more = nf.querySelector(".ccmore");
        return {
          cols: getComputedStyle(document.querySelector(".tklist")).gridTemplateColumns.split(" ").length,
          maxH: Math.max(...tks.map((t) => rect(t).height)),
          endRight: rect(end).left >= rect(mid).right - 1,
          addBeforeMore: rect(btn).top < rect(more).top,
          btnH: Math.min(...[...nf.querySelectorAll("button, a.sbtn, .tkbtn")].filter((x) => rect(x).height > 0 && !x.classList.contains("ccdev")).map((x) => rect(x).height)),
          comboIcon: rect(combo.querySelector(".tkgrid")).width,
          comboImg: rect(combo.querySelector(".tkgrid img")).width,
          chipImg: rect(combo.querySelector(".tkapp img")).width,
          over: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      assert.equal(m.cols, 2, `${w}: 2 columnas`);
      assert.ok(m.maxH <= 260, `${w}: tarjeta de ${m.maxH} px (antes 351)`);
      assert.ok(m.endRight, `${w}: el talón (precio y Agregar) va a la derecha`);
      assert.ok(m.addBeforeMore, `${w}: «Agregar» arriba de «Ver qué incluye»`);
      assert.ok(m.btnH >= 44, `${w}: botones de ${m.btnH} px`);
      assert.ok(m.comboIcon >= 68, `${w}: cuadro del combo de ${m.comboIcon} px`);
      assert.ok(m.comboImg >= 28, `${w}: logo dentro del combo de ${m.comboImg} px (antes 20)`);
      assert.ok(m.chipImg >= 20, `${w}: logo de la etiqueta de ${m.chipImg} px (antes 10)`);
      assert.equal(m.over, false);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    // El celular no cambia: una columna y el talón abajo.
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(base + "/tienda/#inicio");
    await p.waitForFunction(() => document.querySelector(".tk"));
    const cel = await p.evaluate(() => { const t = document.querySelector(".tk"); return { cols: getComputedStyle(document.querySelector(".tklist")).gridTemplateColumns.split(" ").length, endBelow: t.querySelector(".tkend").getBoundingClientRect().top >= t.querySelector(".tkmid").getBoundingClientRect().bottom - 1 }; });
    assert.deepEqual(cel, { cols: 1, endBelow: true });
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
