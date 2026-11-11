// Tasa del dólar del Banco Central de Bolivia: se lee de su portada (sin internet en la prueba: fetch falso),
// pasa a ser la tasa del USDT, respeta un cambio a mano hasta la próxima publicación y, si falla, no toca nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBcbRate } from "../dist/server/bcbRate.js";
import { createApp } from "../dist/server/app.js";

// Recorte con la misma estructura que la portada real del BCB (11/11/2026).
const page = (num, date) => `<html><body><section class="bcb-kpi2"><div class="bcb-kpi2-row">
  <!-- 1) Tipo de cambio oficial automático -->
  <article class="bcb-kpi2-card is-tc-oficial">
    <div class="bcb-kpi2-hd"><p class="bcb-kpi2-name">Tipo de cambio oficial</p>
      <div class="bcb-kpi2-sub">Bolivianos por dólar estadounidense</div>
      <div class="bcb-kpi2-asof"><time datetime="${date}">MIÉRCOLES 11 DE NOVIEMBRE, 2026</time></div></div>
    <div class="bcb-kpi2-body"><div class="bcb-tco-value"><div class="bcb-tco-amount">
      <!--<span class="bcb-tco-bs">Bs</span>-->
      <span class="bcb-tco-num">${num}</span></div></div></div>
  </article><article class="bcb-kpi2-card"><p>Compra de Oro</p><span class="bcb-tco-num">999,99</span></article></div></section></body></html>`;

test("lee la tasa y la fecha de la portada del Banco Central", () => {
  assert.deepEqual(parseBcbRate(page("11,71", "2026-11-11")), { rate: 11.71, date: "2026-11-11" });
  assert.deepEqual(parseBcbRate(page("6.96", "2026-01-02")), { rate: 6.96, date: "2026-01-02" });
  assert.throws(() => parseBcbRate("<html>mantenimiento</html>"), /No encontré/);
  assert.throws(() => parseBcbRate(page("", "2026-11-11")), /cambió/);
  assert.throws(() => parseBcbRate(page("117,1", "2026-11-11")), /no parece real/, "un número roto no pasa");
});

test("automático: toma la del BCB, respeta un cambio a mano hasta la próxima fecha y si falla no toca nada", async () => {
  let html = page("11,71", "2026-11-11"), fail = false, calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.equal(url, "https://www.bcb.gob.bo/");
    if (fail) throw new Error("sin conexión");
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  const dir = mkdtempSync(join(tmpdir(), "gs-bcb-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, fetchImpl });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const login = async (username, password) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];
    const ck = await login("gabriel", "clave-del-dueño-123");
    const A = (m, p, b, cookie = ck) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie }, body: b ? JSON.stringify(b) : undefined });
    const S = () => app.store.engine.s.settings.usdt;
    const setOld = () => { const c = JSON.parse(app.db.getSecret("bcb:rate")); c.lastTry = Date.now() - 4 * 3_600_000; app.db.setSecret("bcb:rate", JSON.stringify(c), Date.now()); };

    // Prender: trae la tasa al instante.
    const on = await (await A("POST", "/api/admin/usdt/bcb", { auto: true })).json();
    assert.equal(on.rate, 11.71);
    assert.equal(S().rate, 11.71);
    assert.ok(S().rateAt > 0);
    assert.deepEqual([on.bcb.auto, on.bcb.date, on.bcb.error], [true, "2026-11-11", undefined]);
    // Sin pasar 3 h no vuelve a mirar.
    assert.equal(await app.checkBcbRate(), null);
    assert.equal(calls, 1);
    // El dueño la cambia a mano el mismo día: el automático no la pisa mientras el BCB siga con la misma fecha.
    await A("POST", "/api/admin/settings", { usdt: { enabled: false, rate: 12 } });
    setOld();
    const same = await app.checkBcbRate();
    assert.equal(same.applied, false);
    assert.equal(S().rate, 12);
    // El BCB publica otra fecha: pasa a esa.
    html = page("11,80", "2026-11-12"); setOld();
    assert.equal((await app.checkBcbRate()).applied, true);
    assert.equal(S().rate, 11.8);
    // Falla la página: queda la tasa que había y se guarda el error para mostrarlo.
    fail = true; setOld();
    await assert.rejects(() => app.checkBcbRate(), /sin conexión/);
    assert.equal(S().rate, 11.8);
    const g = await (await A("GET", "/api/admin/usdt")).json();
    assert.match(g.bcb.error, /sin conexión/);
    // "Traer ahora" cuando vuelve: limpia el error.
    fail = false;
    const now = await (await A("POST", "/api/admin/usdt/bcb/now", {})).json();
    assert.equal(now.bcb.error, undefined);
    // Apagar.
    assert.equal((await (await A("POST", "/api/admin/usdt/bcb", { auto: false })).json()).bcb.auto, false);
    assert.equal(await app.checkBcbRate(), null);
    // Atención (vendedor) no puede.
    await A("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    const sk = await login("lucia", "clave-de-lucia-123");
    assert.equal((await A("POST", "/api/admin/usdt/bcb", { auto: true }, sk)).status, 403);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
