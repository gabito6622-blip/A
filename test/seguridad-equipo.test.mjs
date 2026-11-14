// Seguridad del EQUIPO para el dueño (14/11/2026, revisión en el lugar del súper administrador): antes el dueño solo veía
// sus propios ingresos y los de los revendedores; los fallos de «Atención» o cuándo entró un admin no se veían.
// Ahora en Usuarios cada persona tiene «🔐 Seguridad» (ingresos, aparatos, intentos, 2 pasos) y «Sacarlo de todos lados».
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const ANDROID = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

test("Dueño ve la seguridad de su equipo y lo saca de todos lados; nadie más puede", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-segeq-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck, ua) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}), ...(ua ? { "user-agent": ua } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
    const lucia = (await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "admin", password: "clave-de-lucia-123" }, ock)).json;
    const pedro = (await call("POST", "/api/admin/staff", { username: "pedro", name: "Pedro", role: "seller", password: "clave-de-pedro-123" }, ock)).json;
    for (let i = 0; i < 3; i++) await call("POST", "/api/auth/staff/login", { username: "pedro", password: "mala" + i });
    const pck = (await call("POST", "/api/auth/staff/login", { username: "pedro", password: "clave-de-pedro-123" }, null, ANDROID)).ck;
    const lck = (await call("POST", "/api/auth/staff/login", { username: "lucia", password: "clave-de-lucia-123" })).ck;

    const sec = (await call("GET", `/api/admin/staff/${pedro.id}/security`, null, ock)).json;
    assert.equal(sec.log.filter((x) => x.event === "login_fail").length, 3, "se ven los 3 intentos fallidos de Pedro");
    assert.ok(sec.sessions.some((x) => x.device === "📱 Android · Chrome"));
    assert.equal(sec.twoFactor, false);
    // Ni un admin ni Atención pueden mirar ni sacar a otros del equipo.
    assert.equal((await call("GET", `/api/admin/staff/${pedro.id}/security`, null, lck)).status, 403);
    assert.equal((await call("POST", `/api/admin/staff/${lucia.id}/logout-all`, {}, pck)).status, 403);
    // El dueño saca a Pedro: queda afuera.
    assert.equal((await call("POST", `/api/admin/staff/${pedro.id}/logout-all`, {}, ock)).json.closed, 1);
    assert.equal((await call("GET", "/api/admin/my-security", null, pck)).status, 401);

    if (chromium) {
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
        const [n, v] = ock.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
        await p.goto(base + "/panel#usuarios");
        await p.locator(`[data-ssec="${lucia.id}"]`).click();
        const card = p.locator("#sseccard");
        await card.waitFor();
        assert.match(await card.innerText(), /Verificación en dos pasos: ❌ Apagada/);
        assert.match(await card.innerText(), /abierta en 1 aparato/);
        await card.locator("[data-sout]").click();
        await card.locator("text=sin sesiones abiertas").waitFor();
        assert.deepEqual(errs, []);
      } finally { await b.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
