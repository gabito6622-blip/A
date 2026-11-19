// ⭐ Mis atajos (19/11/2026): el dueño marca con una estrella las pantallas que usa todos los días y quedan primero
// en el menú; se acuerda en ese navegador. Ninguna pantalla se quita. Datos ficticios; 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PASS = "clave-del-dueño-123";

test("Menú: atajos arriba, se agregan y quitan con la estrella y se recuerdan", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-atajos-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
    await p.goto(base + "/panel#inicio");
    await p.waitForSelector("#menu .favbox");
    const favs = () => p.evaluate(() => [...document.querySelectorAll("#menu .favbox [data-go]")].map((x) => x.dataset.go));
    assert.deepEqual(await favs(), ["inicio", "vender", "control", "secretaria", "clientes"], "atajos de entrada");
    await p.evaluate(() => document.getElementById("app").classList.add("open"));
    await p.locator('#menu details[data-area="a-finanzas"] summary').click();
    await p.locator('#menu details[data-area="a-finanzas"] [data-fav="fiado"]').click();
    assert.ok((await favs()).includes("fiado"), "se agregó Fiado");
    await p.locator('#menu .favbox [data-fav="control"]').click();
    assert.ok(!(await favs()).includes("control"), "se quitó Control");
    assert.equal(await p.locator('#menu details [data-go="control"]').count(), 1, "Control sigue en su área");
    assert.ok((await p.locator('#menu .favb').first().boundingBox()).width >= 44);
    await p.reload(); await p.waitForSelector("#menu .favbox");
    assert.ok((await favs()).includes("fiado") && !(await favs()).includes("control"), "se acuerda al volver");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
