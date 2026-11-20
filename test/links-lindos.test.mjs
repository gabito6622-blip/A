// 🔗 Links lindos (19/11/2026, pedido del dueño: «como en yopmail»): gabostore.lat/cod/aracely-k7q2. El nombre se lee
// fácil y los 4 caracteres secretos impiden adivinarlo; un link inventado no abre nada y los intentos se frenan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

test("links lindos: nombre + 4 caracteres, llevan al link largo, los inventados no abren", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-lindos-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  const ara = s.catalog.createCustomer(owner, { name: "ARIt · Aracely Sarabia Rojas", phone: "+59170000123" });
  e.tx(() => { ara.kind = "reseller"; });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const mk = async () => (await (await fetch(`${base}/api/admin/customers/${ara.id}/code-link`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ keepLink: true }) })).json()).url;
    const url = await mk();
    assert.match(url, /\/cod\/aracely-[a-hj-km-np-z2-9]{4}$/, "usa el nombre después de «·», sin mayúsculas ni tildes");
    assert.equal(await mk(), url, "el mismo link cada vez");
    const r = await fetch(url, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), `/codigos/${e.s.customers[ara.id].codeLink.token}`);
    assert.equal((await fetch(url.toUpperCase().replace(/^HTTP:\/\/127\.0\.0\.1/, "http://127.0.0.1"), { redirect: "manual" })).status, 302, "anda aunque lo escriban con mayúsculas");
    const bad = await fetch(`${base}/cod/aracely-zzzz`, { redirect: "manual" });
    assert.equal(bad.status, 404); assert.match(await bad.text(), /Link no encontrado/);
    for (let i = 0; i < 25; i++) await fetch(`${base}/cod/aracely-x${i}`, { redirect: "manual" });
    assert.equal((await fetch(url, { redirect: "manual" })).status, 404, "tras muchos intentos fallidos, se frena por un rato");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
