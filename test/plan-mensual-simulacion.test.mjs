// Simulación de 3 meses con el reloj del servidor (createApp({ clock })), día por día a las 10:00 de Bolivia, con los
// trabajos de todos los días (recordatorios, corte de vencidos) y los avisos al celular (push falso, fetchImpl):
//  - Familia Rojas: compra el «Combo Familia» (Netflix + Disney+ + Spotify, Bs 60 en vez de Bs 85), arma su plan y cada
//    mes toca «Pagar este mes» el día del vencimiento.
//  - Familia Vargas: arma su combo en «Armá tu combo» (−Bs 10). El mes 1 paga junta con UN QR (el dueño aprueba juntos);
//    el mes 2 se olvida y paga un día tarde; el mes 3 se olvida del todo y se corta.
//  - Familia Choque: compró en días distintos y pide «un solo día de pago»: paga solo los días que faltan, después Bs 85.
// Se verifica: total pagado = lo prometido, 0 días regalados, 0 cobros de más, avisos 3 días antes, 1 día antes y el día.
// Imprime los números (los usa el informe). Datos ficticios, carpeta temporal, sin red.
// Corre dos veces (mesModo.ts, 14/11/2026): con «30 días» (los números de siempre, sin tocar) y con «del mismo día al
// mismo día del mes siguiente» (lo que eligió el dueño): 01/12 → 01/01 → 01/02 → 01/03 → 01/04 (días 31, 62, 90, 121).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";
import { daysUntil } from "../dist/store/expiryAlerts.js";
import { addPeriods } from "../dist/store/time.js";

const D = 86_400_000;
const T0 = Date.UTC(2026, 11, 1, 14, 0); // 01/12/2026, 10:00 en Bolivia
const owner = { id: "u_owner", role: "owner" };
const asC = (c) => ({ id: "u_" + c.id, role: "customer", customerId: c.id });
const FCM = "https://fcm.googleapis.com/fcm/send/";
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const LIST = { nf: 3500, dp: 3000, sp: 2000 };

for (const mode of ["days", "calendar"]) test(`3 meses (${mode === "days" ? "30 días" : "mismo día del mes siguiente"}): familia con combo y plan, familia que se olvida y familia que empareja fechas`, { timeout: 120_000 }, async () => {
  // Vencimientos de lo que se compró el día 0: con «30 días», 30/60/90/120; con meses de calendario, 31/62/90/121.
  const due = [1, 2, 3, 4].map((n) => Math.round((addPeriods(T0, 30, n, mode) - T0) / D));
  const next = (t) => addPeriods(t, 30, 1, mode);
  const clock = { t: T0, now() { return this.t; } };
  const pushes = []; // { ep, day }
  let day = 0;
  const dir = mkdtempSync(join(tmpdir(), "gs-c3-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock, vapid: { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" },
    fetchImpl: async (url) => { pushes.push({ ep: String(url), day }); return new Response("", { status: 201 }); } });
  try {
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const s = app.store, e = s.engine;
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const [id, name] of [["nf", "Netflix"], ["dp", "Disney+"], ["sp", "Spotify"]]) {
      s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price: LIST[id], published: true });
      s.inventory.addAccount(owner, { productId: id, supplierId: "andes", email: `${id}@ficticio.lat`, password: "Clave-Ficticia#1", supplierExpiresAt: T0 + 400 * D, cost: 1000, profiles: [1, 2, 3, 4, 5].map((n) => ({ label: `P${n}` })) });
    }
    s.catalog.upsertProduct(owner, { id: "familia", name: "Combo Familia", kind: "combo", durationDays: 30, price: 6000, published: true, comboProductIds: ["nf", "dp", "sp"] });
    s.catalog.updateSettings(owner, { comboDiscounts: [500, 1000, 1500], monthMode: mode });
    const fam = {};
    for (const [k, name, phone] of [["rojas", "Familia Rojas", "+59170000301"], ["vargas", "Familia Vargas", "+59170000302"], ["choque", "Familia Choque", "+59170000303"]]) {
      fam[k] = s.catalog.createCustomer(owner, { name, phone });
      s.wallet.adjust(owner, fam[k].id, 100_000, "saldo de prueba");
    }
    // Avisos al celular activados (cada familia en su celular).
    const ownerCk = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    for (const k of Object.keys(fam)) {
      await fetch(base + `/api/admin/customers/${fam[k].id}/login-pin`, { method: "POST", headers: { "content-type": "application/json", cookie: ownerCk }, body: JSON.stringify({ pin: "2468" }) });
      const ck = (await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: fam[k].phone, pin: "2468" }) })).headers.get("set-cookie").split(";")[0];
      const r = await fetch(base + "/api/me/push/subscribe", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ subscription: { endpoint: FCM + k, keys: KEYS } }) });
      assert.equal(r.status, 200);
    }
    pushes.length = 0;
    const services = (k) => Object.values(e.s.assignments).filter((a) => a.customerId === fam[k].id);
    const active = (k) => services(k).filter((a) => a.status === "active");
    const buy = (k, items, key) => s.orders.create(asC(fam[k]), { customerId: fam[k].id, items, paymentMethod: "balance", idempotencyKey: key });
    const dues = { rojas: [], vargas: [], choque: [] };
    const log = [];

    for (day = 0; day <= 125; day++) {
      clock.t = T0 + day * D;
      app.runJobs();
      await app.checkExpiryPush();
      // --- Rojas: combo + plan; paga el día que vence ---
      if (day === 0) { buy("rojas", [{ productId: "familia", qty: 1 }], "r0"); s.plan.set(asC(fam.rojas), { on: true, ids: active("rojas").map((a) => a.id) }); }
      const rv = s.plan.view(asC(fam.rojas));
      if (rv.plan && daysUntil(rv.plan.nextAt, clock.t) === 0 && dues.rojas.length < 3) {
        dues.rojas.push(day);
        const r = s.plan.renewAll(asC(fam.rojas), { ids: rv.plan.ids, align: true, paymentMethod: "balance", idempotencyKey: `r${day}` });
        log.push(`día ${day}: Rojas paga su plan ${r.total / 100} Bs`);
      }
      // --- Vargas: «Armá tu combo» ---
      if (day === 0) buy("vargas", [{ productId: "nf", qty: 1 }, { productId: "dp", qty: 1 }, { productId: "sp", qty: 1 }], "v0");
      if (day === due[0] - 1) { // un día antes, con UN QR
        const ids = active("vargas").map((a) => a.id);
        const r = s.plan.renewAll(asC(fam.vargas), { ids, paymentMethod: "qr", idempotencyKey: `v${day}` });
        s.rmes.evidenceMany(asC(fam.vargas), r.orders.map((o) => o.id), { fileRef: "comprobante-ficticio.png", declaredReference: "VAR-0001" });
        s.rmes.approveGroup(owner, { orderIds: r.orders.map((o) => o.id), confirmedReference: "VAR-0001", amount: r.total });
        dues.vargas.push(day); log.push(`día ${day}: Vargas paga con un QR ${r.total / 100} Bs`);
      }
      if (day === due[1]) { // se olvidó del aviso: paga el mismo día que vence (con 1 día de gracia, al día siguiente ya se cortó)
        const r = s.plan.renewAll(asC(fam.vargas), { ids: active("vargas").map((a) => a.id), paymentMethod: "balance", idempotencyKey: `v${day}` });
        dues.vargas.push(day); log.push(`día ${day}: Vargas paga tarde ${r.total / 100} Bs`);
      }
      // --- Choque: compra en días distintos y empareja ---
      if (day === 0) buy("choque", [{ productId: "nf", qty: 1 }], "c0");
      if (day === 10) buy("choque", [{ productId: "dp", qty: 1 }], "c10");
      if (day === 20) buy("choque", [{ productId: "sp", qty: 1 }], "c20");
      if (day === 27) {
        const ids = active("choque").map((a) => a.id);
        const pv = s.plan.preview(asC(fam.choque), { ids, align: true });
        log.push(`día 27: Choque ve antes de confirmar: ${pv.rows.map((r) => `${r.product} ${r.days} días Bs ${(r.price / 100).toFixed(2)}`).join(" · ")}`);
        const r = s.plan.renewAll(asC(fam.choque), { ids, align: true, plan: true, paymentMethod: "balance", idempotencyKey: "c27" });
        dues.choque.push(day); log.push(`día 27: Choque empareja y paga ${r.total / 100} Bs`);
      }
      const cv = s.plan.view(asC(fam.choque));
      if (day > 27 && cv.plan && daysUntil(cv.plan.nextAt, clock.t) === 0 && dues.choque.length < 3) {
        dues.choque.push(day);
        const r = s.plan.renewAll(asC(fam.choque), { ids: cv.plan.ids, align: true, paymentMethod: "balance", idempotencyKey: `c${day}` });
        log.push(`día ${day}: Choque paga su plan ${r.total / 100} Bs`);
      }
    }

    // ---------- Plata: total pagado = lo prometido ----------
    const paid = (k) => Object.values(e.s.orders).filter((o) => (o.payerId ?? o.customerId) === fam[k].id && o.status === "fulfilled" && o.kind !== "topup").reduce((t, o) => t + o.total, 0);
    // Choque empareja el día 27 hasta un mes después de Netflix: Disney+ (comprado el día 10) y Spotify (día 20) pagan
    // solo los días que faltan, al precio por día de SU mes, hacia abajo. «30 días»: 20/30 y 10/30 → Bs 20 y Bs 6,66.
    // Meses de calendario: del 11/01 y el 21/01 al 01/02 son 21 y 11 días de un mes de 31 → Bs 20,32 y Bs 7,09.
    const parts = mode === "days" ? 2000 + 666 : 2032 + 709;
    const promised = { rojas: 4 * 6000, vargas: 3 * (8500 - 1000), choque: 3500 + 3000 + 2000 + (3500 + parts) + 2 * 8500 };
    const spent = (k) => 100_000 - s.wallet.balance(fam[k].id);
    for (const k of Object.keys(fam)) assert.equal(paid(k), promised[k], `${k}: pagó lo prometido`);
    assert.equal(spent("rojas"), promised.rojas, "el saldo se explica por sus compras");
    assert.equal(spent("vargas"), promised.vargas - 7500, "Vargas pagó un mes con QR");
    assert.equal(spent("choque"), promised.choque);

    // ---------- Días: lo que se dio = lo que se pagó; cobro = precio × días / días de su período (al centavo) ----------
    let gifted = 0, over = 0, maxCentDiff = 0;
    for (const k of Object.keys(fam)) for (const a of services(k)) {
      const sale = e.s.orders[a.orderId];
      const renewals = Object.values(e.s.orders).filter((o) => o.kind === "renewal" && o.status === "fulfilled" && o.renewal.assignmentId === a.id).sort((x, y) => x.createdAt - y.createdAt);
      let prev = next(a.startsAt), paidDays = (prev - a.startsAt) / D;
      assert.ok(sale && sale.status === "fulfilled");
      for (const o of renewals) {
        assert.equal(o.renewal.prevExpiresAt, prev, `${k}: la renovación arranca donde terminó lo pagado (sin huecos ni días gratis)`);
        const to = o.renewal.until ?? next(prev);
        const days = (to - prev) / D, full = (next(prev) - prev) / D; // full: días de SU período (30, o 28 a 31)
        // Lo exacto: (lista − su parte del descuento del combo) × días / días del período. Con días proporcionales el
        // descuento del pedido ya viene proporcional, así que su parte del período entero es descuento × período / días.
        const share = o.renewal.until ? ((o.discount ?? 0) * full) / days : o.discount ?? 0;
        const ex = ((LIST[a.productId] - share) * days) / full;
        maxCentDiff = Math.max(maxCentDiff, Math.abs(o.total - ex));
        if (o.total > ex + 1e-6) over++; // ni un centavo por encima de lo exacto
        paidDays += days; prev = to;
      }
      const given = (a.customerExpiresAt - a.startsAt) / D;
      gifted += given - paidDays;
    }
    assert.equal(gifted, 0, "0 días regalados");
    assert.equal(over, 0, "0 cobros de más");
    assert.ok(maxCentDiff < 1, `redondeo al centavo (diferencia máx. ${maxCentDiff})`);

    // ---------- Fechas ----------
    const ro = services("rojas"); // el día 122 (fin de la simulación) ya pasó su último vencimiento
    assert.equal(new Set(ro.map((a) => a.customerExpiresAt)).size, 1);
    assert.equal(ro[0].customerExpiresAt, T0 + due[3] * D, `Rojas: 4 meses pagados, ${due[3]} días`);
    assert.equal(active("vargas").length, 0, "Vargas se olvidó el mes 3: se cortó");
    assert.ok(services("vargas").every((a) => a.customerExpiresAt === T0 + due[2] * D), `Vargas: pagó hasta el día ${due[2]} (el pago tarde no le regaló días)`);
    const ch = services("choque");
    assert.ok(ch.every((a) => a.customerExpiresAt === T0 + due[3] * D), "Choque: los tres el mismo día");

    // ---------- Avisos al celular: 3 días antes, 1 día antes y el día ----------
    const daysOf = (k) => [...new Set(pushes.filter((p) => p.ep === FCM + k).map((p) => p.day))].sort((a, b) => a - b);
    const want = (dueDays, paidBefore = []) => dueDays.flatMap((d) => [d - 3, d - 1, ...(paidBefore.includes(d) ? [] : [d])]);
    for (const d of want(due)) assert.ok(daysOf("rojas").includes(d), `Rojas recibió aviso el día ${d}`);
    for (const d of [due[0] - 3, due[0] - 1, ...want([due[1], due[2]])]) assert.ok(daysOf("vargas").includes(d), `Vargas recibió aviso el día ${d}`);
    for (const d of want([due[1], due[2], due[3]])) assert.ok(daysOf("choque").includes(d), `Choque recibió aviso el día ${d}`);
    // WhatsApp (si el bot lo manda): el recordatorio de siempre queda preparado 2 días antes.
    const wa = (k) => e.s.outbox.filter((m) => m.customerId === fam[k].id && m.template === "expiry_reminder").length;

    console.log(["", `SIMULACIÓN 3 MESES (C3) · ${mode === "days" ? "30 días" : "mismo día del mes siguiente"}`, ...log,
      `Pagado: Rojas Bs ${paid("rojas") / 100} (prometido ${promised.rojas / 100}) · Vargas Bs ${paid("vargas") / 100} (prometido ${promised.vargas / 100}) · Choque Bs ${paid("choque") / 100} (prometido ${promised.choque / 100})`,
      `Días regalados: ${gifted} · cobros de más: ${over} · redondeo máx.: ${maxCentDiff.toFixed(2)} centavos`,
      `Avisos al celular (días): Rojas ${daysOf("rojas").join(",")} · Vargas ${daysOf("vargas").join(",")} · Choque ${daysOf("choque").join(",")}`,
      `Recordatorios de WhatsApp preparados: Rojas ${wa("rojas")} · Vargas ${wa("vargas")} · Choque ${wa("choque")}`].join("\n"));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
