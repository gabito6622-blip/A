// Tasa de costo (18/11/2026): lo que te cuesta 1 dólar con la tarjeta del banco va aparte de la tasa de USDT.
// Cambia el costo de las cuentas pagadas en dólares (y la ganancia), pero NO lo que pagan los clientes en USDT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { accountCostBs } from "../dist/store/finanzasCostos.js";

test("tasa de costo: cambia el costo de cuentas en dólares sin tocar la tasa de USDT", () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-tasacosto-"));
  try {
    const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
    s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123", rate: 11.7 } });
    assert.equal(accountCostBs(e, { cost: 0, costUsd: 900 }), 10530, "sin tasa de costo usa la de USDT (9 × 11,70)");
    s.catalog.updateSettings(owner, { usdCostRate: 12 });
    assert.equal(accountCostBs(e, { cost: 0, costUsd: 900 }), 10800, "9 × 12,00 = Bs 108");
    assert.equal(e.s.settings.usdt.rate, 11.7, "la tasa de USDT de los clientes no cambia");
    assert.throws(() => s.catalog.updateSettings(owner, { usdCostRate: -3 }));
    s.catalog.updateSettings(owner, { usdCostRate: 0 });
    assert.equal(e.s.settings.usdCostRate, undefined, "0 la borra y vuelve a la de USDT");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
