// ✍️ Anotar rápido, ↩️ Deshacer un cobro, 🧹 Ordenar mis datos e Inicio con 3 botones (16/11/2026).
// El dueño anotaba los pagos escribiéndole a Claude («netgb117+liz · Oby pagó 69 · vence 15 dic»); se confundió una
// vez entre Robin y Dani, y deshacer un cobro a mano dejó un cobro de más. Datos ficticios. RD_SHOTS=<carpeta> capturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const ddmm = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", timeZone: "America/La_Paz" });

test("anotar rápido, deshacer, ordenar mis datos e inicio simple", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-rapido-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  const emails = ["obyacc+liz@ficticio.lat", "obyacc+c16@ficticio.lat", "robin+pg19@ficticio.lat", "dani+efp@ficticio.lat", "libre+1@ficticio.lat", "mal+tm3@gmai.com"];
  for (const em of emails) s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: em, password: "Clave-Larga#1", supplierExpiresAt: em.startsWith("libre") ? Date.now() + 36500 * DAY : Date.now() + 300 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  // Cuentas cargadas sin clave (como las que vinieron del Excel).
  for (const acc of Object.values(e.s.accounts)) if (/^(libre|mal)\+/.test(acc.email)) acc.password = "";
  const rev = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" });
  const oby = rev("oby · Ovidio Nina", "+59170000001"), robin = rev("robin sardan · Robin Sardán", "+59170000002"), dani = rev("Dani strem · Daniel Quispe", "+59170000003");
  let k = 0;
  const rent = (c, email, days, price) => {
    const slot = Object.values(e.s.slots).find((x) => e.s.accounts[x.accountId].email === email);
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++, preferredSlotIds: [slot.id] });
    const id = o.assignmentIds[0]; s.orders.setExpiry(owner, id, Date.now() + days * DAY); s.orders.setControl(owner, id, { price, payStatus: "pagado" }); return id;
  };
  const liz = rent(oby, "obyacc+liz@ficticio.lat", -1, 6900), c16 = rent(oby, "obyacc+c16@ficticio.lat", 1, 6900);
  const pg19 = rent(robin, "robin+pg19@ficticio.lat", 0, 7000), efp = rent(dani, "dani+efp@ficticio.lat", -1, 6900);
  const A = (id) => e.s.assignments[id];
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (ck, m, p, body) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), r }; };
    const staff = (await call(null, "POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];
    const P = (p, b) => call(staff, "POST", p, b);

    // ---- ✍️ Anotar rápido: entiende el texto como lo escribe el dueño ----
    const target = A(liz).customerExpiresAt + 31 * DAY;
    const texto = `obyacc+liz\nOby pagó 69bs\nVence ${ddmm(target)}`;
    const pv = (await P("/api/admin/quick/parse", { text: texto })).json;
    assert.equal(pv.actions.length, 1);
    const x = pv.actions[0];
    assert.equal(x.email, "obyacc+liz@ficticio.lat", "sin el @ también la encuentra");
    assert.match(x.who, /Ovidio/);
    assert.deepEqual([x.amount, x.amountFromText, x.toFromText, ddmm(x.to)], [6900, true, true, ddmm(target)]);
    assert.deepEqual(x.warnings, []);
    assert.equal(A(liz).customerExpiresAt < target - 20 * DAY, true, "la vista previa no cambia nada");
    // El nombre no coincide (le pasó con Robin y Dani): avisa.
    const mix = (await P("/api/admin/quick/parse", { text: "dani+efp@ficticio.lat Robin pagó 69 vence 15 dic" })).json.actions[0];
    assert.ok(mix.warnings.some((w) => /nombra a «Robin Sardán», pero esta cuenta es de Dani strem/.test(w)), JSON.stringify(mix.warnings));
    // «No pagó»: no anota nada. Correo que no existe: lo dice.
    assert.match((await P("/api/admin/quick/parse", { text: "obyacc+c16@ficticio.lat esa no pagó no la renueves" })).json.notice, /no se anota nada/);
    assert.deepEqual((await P("/api/admin/quick/parse", { text: "nadie@ficticio.lat 69" })).json.unknown, ["nadie@ficticio.lat"]);
    assert.equal((await P("/api/admin/quick/parse", { text: "pagó 69" })).status, 400);
    // Confirmar: se anota con «Me pagó» y queda la fecha que escribió.
    const antesLiz = JSON.stringify(A(liz));
    const ap = (await P("/api/admin/quick/apply", { text: texto, key: "k1" })).json;
    assert.equal(ap.done.length, 1, JSON.stringify(ap));
    assert.equal(ddmm(A(liz).customerExpiresAt), ddmm(target));
    assert.equal(A(liz).control.paidLog.length, 1 + JSON.parse(antesLiz).control.paidLog?.length || 1);
    // ---- ↩️ Deshacer: vuelve exactamente a como estaba ----
    const lista = (await call(staff, "GET", "/api/admin/undo-pay")).json;
    assert.equal(lista[0].assignmentId, liz);
    assert.match(lista[0].label, /Ovidio Nina · obyacc\+liz@ficticio\.lat · Bs 69 · hasta \d{2}\/\d{2}\/\d{4}/);
    const un = await P(`/api/admin/assignments/${liz}/undo-pay`, {});
    assert.equal(un.status, 200, JSON.stringify(un.json));
    assert.equal(JSON.stringify(A(liz)), antesLiz, "idéntico a antes del cobro");
    assert.equal((await P(`/api/admin/assignments/${liz}/undo-pay`, {})).status, 404, "una sola vez");
    assert.ok(e.s.audit.some((a) => a.action === "payment.undo" && a.entityId === liz));
    // «Renovar» en efectivo (crea un pedido): deshacer cancela el pedido (no se borra) y saca el aviso pendiente.
    const antesPg = JSON.stringify(A(pg19)), outboxAntes = e.s.outbox.length;
    const rn = (await P(`/api/admin/assignments/${pg19}/renew`, { paymentMethod: "cash", idempotencyKey: "rn1" })).json;
    assert.equal(rn.order.status, "fulfilled");
    assert.ok(e.s.outbox.length > outboxAntes, "se anotó el aviso «renovamos»");
    assert.equal((await P(`/api/admin/assignments/${pg19}/undo-pay`, {})).status, 200);
    assert.equal(JSON.stringify(A(pg19)), antesPg);
    assert.equal(e.s.orders[rn.order.id].status, "cancelled");
    assert.ok(e.s.orders[rn.order.id].undone, "queda marcado como deshecho");
    assert.equal(e.s.outbox.length, outboxAntes, "el aviso que no salió se saca");
    // Si el alquiler cambió después del cobro, no se deshace (se corrige a mano).
    assert.equal((await P(`/api/admin/assignments/${c16}/pay`, { periods: 1, idempotencyKey: "p2" })).status, 200);
    s.orders.setExpiry(owner, c16, A(c16).customerExpiresAt + DAY);
    const ch = await P(`/api/admin/assignments/${c16}/undo-pay`, {});
    assert.equal(ch.status, 400); assert.match(ch.json.message, /cambió después/);

    // ---- 🧹 Ordenar mis datos ----
    const libreSlot = Object.values(e.s.slots).find((x) => e.s.accounts[x.accountId].email === "libre+1@ficticio.lat");
    s.inventory.setSlotStatus(owner, libreSlot.id, "quarantined", "no pagó");
    const o1 = (await call(staff, "GET", "/api/admin/ordenar")).json;
    assert.deepEqual(o1.apartadas.map((a) => a.email), ["libre+1@ficticio.lat"]);
    assert.deepEqual(o1.sinClave.map((a) => a.email), ["mal+tm3@gmai.com"]);
    assert.ok(o1.sinFecha.some((a) => a.email === "libre+1@ficticio.lat"));
    assert.deepEqual(o1.correos.map((a) => [a.email, a.suggestion]), [["mal+tm3@gmai.com", "mal+tm3@gmail.com"]]);
    assert.equal(o1.gmail.total, 0);
    assert.doesNotMatch(JSON.stringify(o1), /Clave-Larga/);

    // ---- Pantallas (celular) ----
    if (chromium) {
      const shots = process.env.RD_SHOTS;
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
        const [n, v] = staff.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
        p.on("dialog", (d) => d.accept());
        await p.goto(base + "/panel.html#inicio");
        await p.locator(".qbig").waitFor();
        assert.deepEqual((await p.locator(".qbtn b").allInnerTexts()), ["Cobrar hoy", "Mis hojas", "Ordenar datos"]);
        for (const h of await p.locator(".qbtn").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44);
        // Anotar rápido desde Inicio.
        await p.locator("#qrText").fill(`dani+efp@ficticio.lat\nRobin pagó 69bs`);
        await p.getByRole("button", { name: /Ver qué se anota/ }).click();
        await p.locator("#qrPrev .qact").waitFor();
        assert.match(await p.locator("#qrPrev").innerText(), /Daniel Quispe[\s\S]*Bs 69[\s\S]*nombra a «Robin Sardán»/);
        if (shots) await p.screenshot({ path: `${shots}/anotar-rapido.png` });
        const efpAntes = JSON.stringify(A(efp));
        await p.locator("[data-qapply]").click();
        await p.locator("#qUndoBar").waitFor();
        assert.notEqual(JSON.stringify(A(efp)), efpAntes);
        if (shots) await p.screenshot({ path: `${shots}/deshacer-barra.png` });
        await p.locator("#qUndoBar [data-qundo]").click();
        await p.waitForFunction(() => /Deshecho/.test(document.body.innerText));
        assert.equal(JSON.stringify(A(efp)), efpAntes, "deshecho desde la pantalla");
        // Ordenar mis datos: corregir el correo mal escrito.
        await p.locator('[data-qgo="ordenar"]').click();
        await p.locator("#ord-apart").waitFor();
        await p.locator("#ord-mail summary").click();
        if (shots) await p.screenshot({ path: `${shots}/ordenar.png`, fullPage: true });
        await p.locator('#ord-mail form [type="submit"]').click();
        await p.waitForFunction(() => /Correo corregido/.test(document.body.innerText));
        assert.ok(Object.values(e.s.accounts).some((a) => a.email === "mal+tm3@gmail.com"));
        // Guardar la clave y liberar la apartada.
        await p.locator("#ord-apart form input[name=pw]").fill("Nueva-Clave#2");
        await p.locator("#ord-apart form [type=submit]").click();
        await p.waitForFunction(() => /Clave guardada y cuenta libre/.test(document.body.innerText));
        assert.equal(e.s.slots[libreSlot.id].status, "available");
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errs, []);
        await ctx.close();
      } finally { await b.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
