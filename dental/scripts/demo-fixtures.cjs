// Graba las respuestas GET de la API de la clínica FICTICIA para la demo navegable (página de Claude).
// Requiere un servidor con la semilla demo (p. ej. `E2E_PORT=3260 npx tsx e2e/server.ts` sobre una base temporal).
//   node scripts/demo-fixtures.cjs http://127.0.0.1:3260 web/dist-demo/demo-fixtures.json
// Solo lectura: recorre pantallas y pestañas, nunca guarda nada. Quita el token CSRF de lo grabado.
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://127.0.0.1:3260";
const OUT = process.argv[3] ?? "web/dist-demo/demo-fixtures.json";
const PW = "Demo2026dental";
const ACCOUNTS = ["propietaria@demo.local", "dr.mendoza@demo.local", "recepcion.lpz@demo.local"];
const ROUTES = ["/", "/agenda", "/sala-espera", "/controles", "/tareas", "/pacientes", "/presupuestos", "/respuestas", "/experiencia",
  "/convenios", "/caja", "/conciliacion", "/honorarios", "/laboratorio", "/bioseguridad", "/inventario", "/reportes", "/gestion",
  "/mensajes", "/actividad", "/configuracion", "/cuenta", "/ayuda"];

(async () => {
  const browser = await chromium.launch();
  const out = { accounts: {}, responses: {} };
  for (const email of ACCOUNTS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const rec = (out.responses[email] = {});
    page.on("response", async (r) => {
      try {
        const u = new URL(r.url());
        if (!u.pathname.startsWith("/api/") || r.request().method() !== "GET" || r.status() !== 200) return;
        if (!String(r.headers()["content-type"] ?? "").includes("json")) return;
        const body = await r.json();
        const key = u.pathname + u.search;
        if (key === "/api/auth/me") { out.accounts[email] = { me: { ...body, csrfToken: "demo" } }; return; }
        rec[key] = body;
      } catch { /* respuesta sin cuerpo */ }
    });
    await page.goto(BASE + "/");
    await page.fill("#email", email);
    await page.fill("#pw", PW);
    await page.click('button:has-text("Ingresar")');
    await page.locator("main").first().waitFor();
    const visit = async (route) => {
      await page.goto(BASE + route);
      await page.waitForTimeout(900);
      const tabs = page.getByRole("tab");
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        const t = tabs.nth(i);
        if (await t.isVisible().catch(() => false)) { await t.click().catch(() => {}); await page.waitForTimeout(500); }
      }
    };
    for (const r of ROUTES) await visit(r);
    // Fichas de algunos pacientes, con todas sus pestañas
    const list = Object.entries(rec).find(([k]) => k.startsWith("/api/patients?"))?.[1];
    const rows = Array.isArray(list) ? list : list?.items ?? list?.rows ?? list?.patients ?? [];
    for (const p of rows.slice(0, 12)) await visit(`/pacientes/${p.id}`);
    console.log(`${email}: ${Object.keys(rec).length} respuestas`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Guardado ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
