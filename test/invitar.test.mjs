// Invitar revendedores: el panel sabe quién tiene PIN y quién ya entró alguna vez.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

test("el dueño ve quién tiene PIN y cuándo entró por última vez", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-inv-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    const ck = lr.headers.get("set-cookie").split(";")[0];
    const A = (m, p, b) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
    const rev = await A("POST", "/api/admin/customers", { name: "Rev Uno", phone: "+59177700011", kind: "reseller" });
    let r = (await A("GET", "/api/admin/resellers")).list.find((x) => x.id === rev.id);
    assert.deepEqual([r.hasPin, r.lastLoginAt], [false, null], "recién creado: sin PIN y nunca entró");
    const { pin } = await A("POST", `/api/admin/customers/${rev.id}/login-pin`, {});
    r = (await A("GET", "/api/admin/resellers")).list.find((x) => x.id === rev.id);
    assert.equal(r.hasPin, true);
    assert.equal(r.lastLoginAt, null, "tener PIN no es haber entrado");
    const li = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "77700011", pin }) });
    assert.equal(li.status, 200);
    r = (await A("GET", "/api/admin/resellers")).list.find((x) => x.id === rev.id);
    assert.ok(r.lastLoginAt > 0, "después de entrar queda la fecha");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
