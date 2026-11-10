// Encabezados de seguridad (CSP y compañía) + que el código del navegador respete la CSP.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;

describe("seguridad del navegador (CSP)", () => {
  let dir, app, base, dir2, app2, base2;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-csp-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {} });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    dir2 = mkdtempSync(join(tmpdir(), "gs-csp2-"));
    app2 = createApp({ dataDir: dir2, staticDir: PUBLIC, jobs: false, log: () => {}, secureCookies: true });
    base2 = `http://127.0.0.1:${await app2.listen(0, "127.0.0.1")}`;
  });
  after(async () => {
    await app?.close(); await app2?.close();
    rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true });
  });

  test("las páginas y la API mandan la CSP y los demás encabezados", async () => {
    for (const path of ["/panel.html", "/tienda/", "/", "/api/health"]) {
      const r = await fetch(base + path);
      const csp = r.headers.get("content-security-policy") ?? "";
      assert.ok(csp.includes("script-src 'self'"), `${path}: sin script-src 'self'`);
      assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), `${path}: no se permite script en línea`);
      assert.ok(csp.includes("frame-ancestors 'self'"), `${path}: sin frame-ancestors`);
      assert.ok(csp.includes("object-src 'none'"), `${path}: sin object-src 'none'`);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.ok((r.headers.get("permissions-policy") ?? "").includes("camera=()"), `${path}: sin Permissions-Policy`);
    }
  });

  test("HSTS solo con HTTPS (cookies seguras)", async () => {
    assert.equal((await fetch(base + "/")).headers.get("strict-transport-security"), null, "en http local no va HSTS");
    assert.match((await fetch(base2 + "/")).headers.get("strict-transport-security") ?? "", /max-age=\d+/);
  });

  test("ningún HTML ni JS del navegador usa script en línea ni onclick= (la CSP los bloquearía)", () => {
    const files = readdirSync(PUBLIC).filter((f) => /\.(html|js)$/.test(f));
    const bad = [];
    for (const f of files) {
      const s = readFileSync(join(PUBLIC, f), "utf8");
      if (f.endsWith(".html")) {
        // <script> sin src = script en línea
        for (const m of s.matchAll(/<script\b([^>]*)>/g)) if (!/\bsrc=/.test(m[1])) bad.push(`${f}: <script> en línea`);
      }
      for (const m of s.matchAll(/\son(click|load|error|input|change|submit|focus|blur|key\w+|mouse\w+)=["']/g)) bad.push(`${f}: atributo on${m[1]}=`);
      if (/href=["']javascript:/i.test(s)) bad.push(`${f}: enlace javascript:`);
    }
    assert.deepEqual(bad, [], "Hay código que la CSP bloquearía:\n" + bad.join("\n"));
  });
});
