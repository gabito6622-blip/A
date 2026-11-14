// Cuentas caídas sin sorpresas (revisión de 3 meses simulados, 14/11/2026). Ninguna cuenta caída, vencida o mal cargada
// deja a un cliente sin servicio sin que el dueño se entere, y nunca se vende un perfil muerto. Datos ficticios,
// carpeta temporal, nada externo (sin fetch real: no hay WhatsApp ni avisos al celular configurados).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { queue } from "../dist/store/notify.js";

const DAY = 864e5, T0 = Date.UTC(2026, 11, 30, 15, 0); // 30/12/2026, 11:00 en Bolivia

function mk() {
  const clock = { t: T0, now() { return this.t; } };
  const dir = mkdtempSync(join(tmpdir(), "gs-eq3-"));
  const logs = [];
  const app = createApp({ dataDir: dir, jobs: false, log: (m) => logs.push(m), clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, E = s.engine, O = { id: Object.keys(E.s.staff)[0], role: "owner" };
  for (const [id, name, kind] of [["nf", "Netflix", "profile"], ["nfc", "Netflix completa", "full_account"], ["iptv", "IPTV", "iptv"]]) s.catalog.upsertProduct(O, { id, name, kind, durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(O, { id: "ana", name: "Prov Ana", active: true });
  s.catalog.upsertSupplier(O, { id: "beto", name: "Prov Beto", active: true });
  let n = 0;
  const add = (email, days, k = 5, pid = "nf", extra = {}) => s.inventory.addAccount(O, { productId: pid, supplierId: "ana", email, password: "Clave-Larga#1", supplierExpiresAt: T0 + days * DAY, cost: 3000, profiles: Array.from({ length: k }, (_, i) => ({ label: `Perfil ${i + 1}` })), ...extra }).account;
  const cust = (name, kind) => s.catalog.createCustomer(O, { name, phone: `+5917100${String(n++).padStart(4, "0")}`, whatsappConsent: true, ...(kind ? { kind } : {}) });
  const slots = (acc) => Object.values(E.s.slots).filter((x) => x.accountId === acc.id).sort((a, b) => a.label.localeCompare(b.label));
  const sell = (c, acc, i, exp, pid = "nf") => { const o = s.orders.create(O, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slots(acc)[i].id] }); if (exp !== undefined) s.orders.setExpiry(O, o.assignmentIds[0], T0 + exp * DAY); return o.assignmentIds[0]; };
  const accOf = (aid) => E.s.accounts[E.s.slots[E.s.assignments[aid].slotId].accountId];
  const saleTo = (c, pid = "nf") => accOf(s.orders.create(O, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash" }).assignmentIds[0]);
  return { clock, app, s, E, O, logs, add, cust, slots, sell, accOf, saleTo, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("1 · una clave corta en un texto no frena nada; cada tarea automática va por separado", () => {
  test("la clave «2027» de una línea IPTV de otro no bloquea el aviso «vence el 01/01/2027»", async () => {
    const t = mk();
    try {
      t.add("linea-1", 30, 1, "iptv", { password: "2027" });
      const acc = t.add("a@f.lat", 60, 2);
      const a1 = t.sell(t.cust("Vence 01/01"), acc, 0, 2);
      const a2 = t.sell(t.cust("Vencido hace 5 días"), acc, 1, -5);
      const r = t.app.runJobs();
      assert.equal(r.failed, undefined, `ninguna tarea falló (${t.logs.join(" | ")})`);
      assert.equal(t.E.s.assignments[a2].status, "revoked", "el vencido se cortó");
      assert.ok(t.E.s.outbox.some((m) => m.template === "expiry_reminder" && /01\/01\/2027/.test(m.text)), "el aviso salió con la fecha");
      assert.equal(t.E.s.assignments[a1].status, "active");
    } finally { await t.close(); }
  });

  test("la defensa sigue: la clave larga de la cuenta del MISMO cliente no puede ir en su mensaje; la de otro no lo frena", async () => {
    const t = mk();
    try {
      const acc = t.add("b@f.lat", 60, 2);
      const ana = t.cust("Ana"); t.sell(ana, acc, 0, 10);
      const beto = t.cust("Beto");
      const params = { name: "Clave-Larga#1", product: "Netflix", date: "01/01" };
      assert.throws(() => t.E.tx(() => queue(t.E, ana.id, "expiry_reminder", params)), (e) => e.code === "SENSITIVE_DATA");
      assert.doesNotThrow(() => t.E.tx(() => queue(t.E, beto.id, "expiry_reminder", params)), "Beto no está en esa cuenta");
    } finally { await t.close(); }
  });

  test("si una tarea falla, las demás y el respaldo siguen; el dueño se entera una vez por hora (Auditoría)", async () => {
    const t = mk();
    try {
      const acc = t.add("c@f.lat", 60, 1);
      const vencido = t.sell(t.cust("Vencido"), acc, 0, -5);
      const orig = t.s.orders.autoReminders;
      t.s.orders.autoReminders = () => { throw new Error("se rompió a propósito"); };
      const r = t.app.runJobs();
      assert.deepEqual(r.failed, ["recordatorios"]);
      assert.equal(t.E.s.assignments[vencido].status, "revoked", "cortar vencidos corrió igual");
      assert.equal(r.closed, 1);
      assert.ok(r.backup, "el respaldo corrió igual");
      const fails = () => t.E.s.audit.filter((x) => x.action === "jobs.failed");
      assert.equal(fails().length, 1);
      assert.equal(fails()[0].entityId, "recordatorios");
      assert.match(fails()[0].data.error, /se rompió a propósito/);
      t.clock.t += 10 * 60_000; t.app.runJobs();
      assert.equal(fails().length, 1, "no repite el aviso dentro de la hora");
      t.clock.t += 61 * 60_000; t.app.runJobs();
      assert.equal(fails().length, 2, "pasada la hora, avisa de nuevo");
      t.s.orders.autoReminders = orig;
      assert.equal(t.app.runJobs().failed, undefined);
    } finally { await t.close(); }
  });
});

describe("2 · cuenta caída: se marca aunque no se pueda mover a todos", () => {
  test("sin lugar: queda caída, los clientes van a Reubicar y Notificaciones en rojo, en palabras simples", async () => {
    const t = mk();
    try {
      const caida = t.add("caida@f.lat", 40, 3);
      const ids = [0, 1, 2].map((i) => t.sell(t.cust(`Cli ${i}`), caida, i, 20));
      t.s.orders.updateStaffAlerts(t.O, { phone: "+59170000001" });
      const r = t.s.caidas.down(t.O, caida.id, "el proveedor la retiró");
      assert.equal(r.retired, false);
      assert.equal(r.left, 3);
      assert.ok(r.results.every((x) => !x.ok && /No hay perfiles libres de Netflix/.test(x.error) && !/Sin stock suficiente/.test(x.error)), JSON.stringify(r.results));
      const acc = t.E.s.accounts[caida.id];
      assert.ok(acc.fallen, "quedó marcada caída");
      assert.equal(acc.status, "active");
      const q = t.s.orders.relocationQueue(t.O);
      assert.deepEqual(q.map((x) => x.assignmentId).sort(), [...ids].sort(), "los 3 en Reubicar");
      assert.ok(q.every((x) => x.reason === "cuenta caída" && x.suggest === null && /cargá una cuenta/.test(x.warn)));
      const n = t.s.stats.notifications(t.O).items;
      assert.equal(n.find((x) => x.kind === "reloc")?.sev, "bad");
      const miss = n.find((x) => x.kind === "missing");
      assert.equal(miss?.text, "Faltan 3 perfiles de Netflix: cargá una cuenta");
      assert.equal(miss.sev, "bad");
      // Riesgo rojo con el motivo.
      const l = t.s.inventory.listAccounts(t.O).find((x) => x.id === caida.id);
      assert.equal(l.risk.level, "bad"); assert.match(l.risk.reasons[0], /cuenta caída: 3 clientes adentro/);
      assert.equal(l.sellBlock, "caída");
      // No pide renovación al proveedor, ni en Notificaciones ni por WhatsApp al dueño.
      t.clock.t = T0 + 39 * DAY;
      assert.ok(!t.s.stats.notifications(t.O).items.some((x) => x.kind === "supplier" || x.kind === "supplier1d"));
      t.app.runJobs();
      assert.ok(!t.E.s.outbox.some((m) => m.template === "staff_supplier_expiry"), "no pidió renovar la caída");
    } finally { await t.close(); }
  });

  test("«⚠️ Se cayó, todavía no la muevo» solo marca: nunca se vende, no ofrece liberar, perfiles libres a cuarentena", async () => {
    const t = mk();
    try {
      const caida = t.add("solo-marca@f.lat", 40, 3);
      const aid = t.sell(t.cust("Dentro"), caida, 0, 20);
      const r = t.s.caidas.markFallen(t.O, caida.id, "se cayó");
      assert.equal(r.clients, 1); assert.equal(r.parked, 2);
      assert.equal(t.E.s.assignments[aid].status, "active", "no movió a nadie");
      assert.deepEqual(t.slots(caida).map((x) => x.status), ["assigned", "quarantined", "quarantined"]);
      assert.equal(t.s.inventory.stock().nf?.available ?? 0, 0, "no queda nada a la venta");
      assert.throws(() => t.s.orders.create(t.O, { customerId: t.cust("Nuevo").id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }), (e) => e.code === "OUT_OF_STOCK");
      const q = t.slots(caida)[1];
      assert.throws(() => t.s.inventory.setSlotStatus(t.O, q.id, "available", "liberar"), /marcada como caída/);
      // Volvió a funcionar: sale la marca; los apartados se liberan a mano.
      t.s.caidas.unmarkFallen(t.O, caida.id);
      t.s.inventory.setSlotStatus(t.O, q.id, "available", "cambié la clave");
      assert.equal(t.s.inventory.stock().nf.available, 1);
    } finally { await t.close(); }
  });

  test("con lugar para algunos: mueve a esos (a una cuenta que alcanza su fecha) y deja a los demás en Reubicar", async () => {
    const t = mk();
    try {
      const caida = t.add("parcial@f.lat", 40, 4), corta = t.add("corta@f.lat", 10, 1), larga = t.add("larga@f.lat", 50, 1);
      const ids = [0, 1, 2, 3].map((i) => t.sell(t.cust(`P ${i}`), caida, i, 25 + i));
      const r = t.s.caidas.down(t.O, caida.id, "caída");
      assert.equal(r.moved, 2); assert.equal(r.left, 2); assert.equal(r.retired, false);
      const first = t.accOf(ids[0]);
      assert.equal(first.id, larga.id, "el primero (vence 24/01) va a la que alcanza su fecha, no a la que vence el 09/01");
      const moved = r.results.filter((x) => x.ok).map((x) => x.assignmentId);
      for (const id of moved) assert.equal(t.E.s.assignments[id].status, "active");
      assert.ok(t.slots(caida).filter((x) => x.status === "quarantined").length === 2, "los perfiles que se vaciaron quedan apartados, no libres");
      assert.ok(!t.slots(caida).some((x) => x.status === "available"));
      assert.equal(t.s.orders.relocationQueue(t.O).length, 2);
    } finally { await t.close(); }
  });

  test("todos movidos: se retira; una caída sin clientes también; Atención no puede marcar", async () => {
    const t = mk();
    try {
      const caida = t.add("toda@f.lat", 40, 2); t.add("destino@f.lat", 60, 3);
      [0, 1].forEach((i) => t.sell(t.cust(`T ${i}`), caida, i, 20));
      const r = t.s.caidas.down(t.O, caida.id, "caída");
      assert.equal(r.retired, true); assert.equal(r.moved, 2);
      assert.equal(t.E.s.accounts[caida.id].status, "retired");
      assert.ok(t.slots(caida).every((x) => x.status === "retired"));
      const seller = { id: "stf_x", role: "seller" };
      const otra = t.add("otra@f.lat", 40, 1);
      assert.throws(() => t.s.caidas.markFallen(seller, otra.id, "x"), (e) => e.code === "FORBIDDEN");
      assert.throws(() => t.s.caidas.setNoSell(seller, otra.id, true), (e) => e.code === "FORBIDDEN");
      assert.throws(() => t.s.caidas.relocate(seller, "asg_x", {}), (e) => e.code === "FORBIDDEN");
    } finally { await t.close(); }
  });
});

describe("3 · después de «Mover todos»: ¿la cuenta vieja murió? → retirarla", () => {
  test("retirar deja de vender y de pedir renovación; con clientes adentro no se puede", async () => {
    const t = mk();
    try {
      const vieja = t.add("vieja@f.lat", 3, 2), nueva = t.add("nueva@f.lat", 40, 3);
      [0, 1].forEach((i) => t.sell(t.cust(`M ${i}`), vieja, i, 20));
      assert.throws(() => t.s.caidas.retire(t.O, vieja.id), /Todavía tiene 2 clientes/);
      t.s.orders.moveAll(t.O, vieja.id, { toAccountId: nueva.id, reason: "caída" });
      t.s.caidas.retire(t.O, vieja.id, "murió");
      assert.equal(t.E.s.accounts[vieja.id].status, "retired");
      assert.ok(t.slots(vieja).every((x) => x.status === "retired"), "sus apartados no se pueden liberar para vender");
      t.s.orders.updateStaffAlerts(t.O, { phone: "+59170000001" });
      t.clock.t = T0 + 2 * DAY; t.app.runJobs();
      assert.ok(!t.E.s.outbox.some((m) => m.template === "staff_supplier_expiry" && m.text.includes("vieja@")), "no pide renovar la retirada");
    } finally { await t.close(); }
  });
});

describe("4 · nota «CAÍDA» / «NO VENDER» o «🚫 No vender más»: fuera de la venta, sin tocar a sus clientes", () => {
  test("ninguna de las dos se vende; sus clientes siguen; no se mueve gente a una «no vender»", async () => {
    const t = mk();
    try {
      const nota = t.add("marcada@f.lat", 40, 3), off = t.add("off@f.lat", 40, 3);
      const dentro = t.sell(t.cust("Dentro"), off, 0, 20);
      t.s.inventory.updateAccount(t.O, nota.id, { notes: "CAÍDA - NO VENDER" });
      t.s.caidas.setNoSell(t.O, off.id, true);
      assert.equal(t.s.inventory.stock().nf?.available ?? 0, 0);
      assert.throws(() => t.saleTo(t.cust("Caro")), (e) => e.code === "OUT_OF_STOCK");
      assert.equal(t.E.s.assignments[dentro].status, "active");
      assert.equal(t.accOf(dentro).id, off.id, "su cliente sigue donde estaba");
      assert.equal(t.s.orders.relocationQueue(t.O).length, 0, "no es una cuenta caída: nadie para reubicar");
      const otra = t.add("otra@f.lat", 40, 1); const x = t.sell(t.cust("X"), otra, 0, 20);
      assert.throws(() => t.s.orders.moveAll(t.O, otra.id, { toAccountId: off.id, reason: "x" }), /No vender/);
      assert.throws(() => t.s.orders.replace(t.O, x, { reason: "x", toSlotId: t.slots(nota)[0].id }), /No vender/);
      t.s.caidas.setNoSell(t.O, off.id, false);
      assert.equal(t.saleTo(t.cust("Dani")).id, off.id, "vuelve a venderse");
    } finally { await t.close(); }
  });
});

describe("5 · elegir una cuenta que alcance la fecha del cliente", () => {
  test("venta: la que alcanza (de esas, la que vence antes); si ninguna alcanza, la que más dura", async () => {
    const t = mk();
    try {
      const corta = t.add("corta@f.lat", 5, 1), media = t.add("media@f.lat", 35, 1), larga = t.add("larga@f.lat", 60, 1);
      assert.equal(t.saleTo(t.cust("A")).id, media.id, "30 días: la de 35 alcanza y es la más justa");
      assert.equal(t.saleTo(t.cust("B")).id, larga.id);
      assert.equal(t.saleTo(t.cust("C")).id, corta.id, "solo queda la corta");
      const t2 = mk();
      try {
        const x = t2.add("x@f.lat", 5, 1), y = t2.add("y@f.lat", 20, 1);
        assert.equal(t2.saleTo(t2.cust("D")).id, y.id, "ninguna alcanza: la que más dura");
        assert.ok(x);
      } finally { await t2.close(); }
    } finally { await t.close(); }
  });

  test("Reubicar: sugiere una que alcanza, «Mover» va EXACTAMENTE a la que muestra, no promete dos veces el mismo lugar", async () => {
    const t = mk();
    try {
      const caida = t.add("rcaida@f.lat", 40, 3); t.add("rcorta@f.lat", 10, 1); const larga = t.add("rlarga@f.lat", 50, 1);
      const a = t.sell(t.cust("Larga"), caida, 0, 25), b = t.sell(t.cust("Corta"), caida, 1, 8);
      t.s.caidas.markFallen(t.O, caida.id, "caída");
      const q = t.s.orders.relocationQueue(t.O);
      const qa = q.find((x) => x.assignmentId === a), qb = q.find((x) => x.assignmentId === b);
      assert.equal(qb.suggest.email, "rcorta@f.lat", "al que vence el 07/01 le alcanza la corta");
      assert.equal(qa.suggest.email, "rlarga@f.lat", "al que vence el 24/01, la larga");
      assert.equal(qa.suggest.covers, true);
      const r = t.s.caidas.relocate(t.O, a, { toAccountId: qa.suggest.accountId });
      assert.equal(r.toAccountId, larga.id);
      assert.equal(t.accOf(a).id, larga.id, "fue a la que mostraba");
      assert.equal(t.slots(caida)[0].status, "quarantined", "su perfil viejo queda apartado (la cuenta caída sigue)");
      // Sin cupo: dos clientes y un solo lugar → el segundo dice que falta.
      const t2 = mk();
      try {
        const c2 = t2.add("c2@f.lat", 40, 2); t2.add("uno@f.lat", 50, 1);
        [0, 1].forEach((i) => t2.sell(t2.cust(`U ${i}`), c2, i, 20));
        t2.s.caidas.markFallen(t2.O, c2.id, "caída");
        const q2 = t2.s.orders.relocationQueue(t2.O);
        assert.equal(q2.filter((x) => x.suggest).length, 1);
        assert.equal(q2.filter((x) => !x.suggest).length, 1);
      } finally { await t2.close(); }
      // Ninguna alcanza: lo dice.
      const t3 = mk();
      try {
        const c3 = t3.add("c3@f.lat", 40, 1); t3.add("cortita@f.lat", 6, 1);
        const z = t3.sell(t3.cust("Lejos"), c3, 0, 30);
        t3.s.caidas.markFallen(t3.O, c3.id, "caída");
        const qz = t3.s.orders.relocationQueue(t3.O).find((x) => x.assignmentId === z);
        assert.equal(qz.suggest.covers, false);
        assert.match(qz.warn, /Ninguna cuenta sana de Netflix dura hasta el/);
      } finally { await t3.close(); }
    } finally { await t.close(); }
  });

  test("la ruta de Reubicar usa la cuenta que manda el panel", async () => {
    const t = mk();
    try {
      const caida = t.add("hcaida@f.lat", 40, 1); const a1 = t.add("h1@f.lat", 45, 1), a2 = t.add("h2@f.lat", 55, 1);
      const aid = t.sell(t.cust("H"), caida, 0, 25);
      t.s.caidas.markFallen(t.O, caida.id, "caída");
      const base = `http://127.0.0.1:${await t.app.listen(0, "127.0.0.1")}`;
      const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
      const res = await fetch(`${base}/api/admin/assignments/${aid}/relocate`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ toAccountId: a2.id }) });
      assert.equal(res.status, 200);
      assert.equal(t.accOf(aid).id, a2.id, "a la elegida (h2), aunque h1 era la más justa");
      assert.ok(a1);
    } finally { await t.close(); }
  });
});

describe("7 · los datos nuevos dicen «Cambiamos tu cuenta», no «¡Gracias por tu compra!»", () => {
  test("delivery con cambio", async () => {
    const t = mk();
    try {
      const acc = t.add("d@f.lat", 40, 1); const aid = t.sell(t.cust("Delia Rojas"), acc, 0, 20);
      const m = t.s.admin.delivery(t.O, aid, { change: true }).message;
      assert.match(m, /Cambiamos tu cuenta de \*Netflix\*, estos son tus datos nuevos/);
      assert.ok(!/Gracias por tu compra/.test(m));
      assert.match(t.s.admin.delivery(t.O, aid).message, /Gracias por tu compra/, "la entrega normal sigue igual");
    } finally { await t.close(); }
  });
});

describe("8 · revendedor: «Cambió la cuenta: avisá a tus N clientes» (solo lo suyo)", () => {
  test("ve a SUS clientes; otro revendedor no ve nada ni puede marcarlo; «Ya les avisé» lo saca", async () => {
    const t = mk();
    try {
      const vieja = t.add("rev-vieja@f.lat", 40, 1, "nfc"), nueva = t.add("rev-nueva@f.lat", 60, 1, "nfc");
      const rosa = t.cust("Rosa Revende", "reseller"), lalo = t.cust("Lalo Revende", "reseller");
      const RO = { id: "u_" + rosa.id, role: "reseller", customerId: rosa.id }, LA = { id: "u_" + lalo.id, role: "reseller", customerId: lalo.id };
      const aid = t.sell(rosa, vieja, 0, 20, "nfc");
      t.s.subs.save(RO, aid, { name: "Camila Rojas", phone: "+59171112233", label: "Perfil 1", expiresAt: T0 + 10 * DAY });
      t.s.subs.save(RO, aid, { name: "Diego Mamani", phone: "+59171112244", label: "Perfil 2", expiresAt: T0 + 12 * DAY });
      assert.deepEqual(t.s.caidas.changes(RO), [], "sin cambios, sin cartel");
      t.clock.t += DAY;
      t.s.orders.moveAll(t.O, vieja.id, { toAccountId: nueva.id, reason: "caída" });
      const ch = t.s.caidas.changes(RO);
      assert.equal(ch.length, 1);
      assert.equal(ch[0].kind, "moved"); assert.equal(ch[0].email, "rev-nueva@f.lat");
      assert.deepEqual(ch[0].clients.map((c) => c.name), ["Camila Rojas", "Diego Mamani"]);
      const txt = JSON.stringify(ch);
      assert.ok(!/Clave-Larga|cost|price|3000/.test(txt), "ni claves ni costos ni precios");
      assert.deepEqual(t.s.caidas.changes(LA), [], "Lalo no ve lo de Rosa");
      assert.throws(() => t.s.caidas.changeSeen(LA, aid), (e) => e.code === "NOT_FOUND");
      t.s.caidas.changeSeen(RO, aid);
      assert.deepEqual(t.s.caidas.changes(RO), []);
      // Se cae la nueva → vuelve el cartel, ahora «se cayó».
      t.clock.t += DAY;
      t.s.caidas.markFallen(t.O, nueva.id, "se cayó");
      assert.equal(t.s.caidas.changes(RO)[0].kind, "fallen");
      assert.throws(() => t.s.caidas.changes(t.O), (e) => e.code === "FORBIDDEN");
    } finally { await t.close(); }
  });
});

describe("9 · «💳 Pagar varias» del mismo proveedor", () => {
  test("anota todas juntas con la regla de siempre; otro proveedor o Atención: no", async () => {
    const t = mk();
    try {
      const a = t.add("p1@f.lat", 3, 1), b = t.add("p2@f.lat", 5, 1);
      const c = t.s.inventory.addAccount(t.O, { productId: "nf", supplierId: "beto", email: "p3@f.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 5 * DAY, cost: 2000, profiles: [{ label: "P" }] }).account;
      const before = t.E.s.expenses.length;
      assert.throws(() => t.s.caidas.payMany(t.O, { items: [{ accountId: a.id, amount: 3000 }, { accountId: c.id, amount: 2000 }], months: 1 }), /mismo proveedor/);
      assert.equal(t.E.s.expenses.length, before, "nada anotado");
      assert.throws(() => t.s.caidas.payMany({ id: "s", role: "seller" }, { items: [{ accountId: a.id, amount: 3000 }], months: 1 }), (e) => e.code === "FORBIDDEN");
      const r = t.s.caidas.payMany(t.O, { items: [{ accountId: a.id, amount: 3000 }, { accountId: b.id, amount: 3100 }], months: 1 });
      assert.equal(r.paid, 2); assert.equal(r.total, 6100);
      assert.equal(t.E.s.expenses.length, before + 2);
      assert.ok(t.E.s.accounts[a.id].supplierExpiresAt > T0 + 28 * DAY, "corrió un mes");
      assert.equal(t.E.s.accounts[b.id].cost, 3100);
      // Uno inválido: no se anota ninguno.
      assert.throws(() => t.s.caidas.payMany(t.O, { items: [{ accountId: a.id, amount: 3000 }, { accountId: b.id, amount: 0 }], months: 1 }));
      assert.equal(t.E.s.expenses.length, before + 2, "todo o nada");
    } finally { await t.close(); }
  });
});

describe("10 · Cortes: el corte sugerido no pasa la fecha del proveedor", () => {
  test("todos vencen después del proveedor → corte = día del proveedor y lo avisa", async () => {
    const t = mk();
    try {
      const acc = t.add("cortes@f.lat", 10, 3);
      [0, 1, 2].forEach((i) => t.sell(t.cust(`K ${i}`), acc, i, i === 2 ? 8 : 20));
      const x = t.s.inventario.cuts(t.O).find((c) => c.accountId === acc.id);
      assert.ok(x.suggestedCut <= acc.supplierExpiresAt, "no pasa la del proveedor");
      assert.equal(x.cappedBySupplier, true);
      assert.equal(x.aligned, false);
      t.s.caidas.markFallen(t.O, acc.id, "caída");
      assert.ok(!t.s.inventario.cuts(t.O).some((c) => c.accountId === acc.id), "una caída no se ordena: se mueve");
    } finally { await t.close(); }
  });
});

describe("11 · un perfil devuelto en una cuenta caída va a cuarentena, nunca a «Libre»", () => {
  test("liberar, devolver la plata y una prueba gratis que vence", async () => {
    const t = mk();
    try {
      const acc = t.add("dev@f.lat", 40, 3);
      const a1 = t.sell(t.cust("L1"), acc, 0, 20), a2 = t.sell(t.cust("L2"), acc, 1, 20);
      const trial = t.s.orders.createTrial(t.O, { customerId: t.cust("Prueba").id, productId: "nf", hours: 2, preferredSlotId: t.slots(acc)[2].id });
      t.s.caidas.markFallen(t.O, acc.id, "caída");
      t.s.orders.releaseSlot(t.O, t.E.s.assignments[a1].slotId, "se fue");
      t.s.orders.refundAssignment(t.O, a2, { amount: 0, reason: "devolución" });
      t.clock.t += 3 * 3600e3; t.s.orders.closeExpired({ id: "system:jobs", role: "system" }, 2);
      assert.equal(t.E.s.assignments[trial.assignment.id].status, "revoked");
      assert.deepEqual(t.slots(acc).map((x) => x.status), ["quarantined", "quarantined", "quarantined"]);
      // En una cuenta sana, liberar sigue dejándolo libre.
      const sana = t.add("sana@f.lat", 40, 1); const a3 = t.sell(t.cust("L3"), sana, 0, 20);
      t.s.orders.releaseSlot(t.O, t.E.s.assignments[a3].slotId, "se fue");
      assert.equal(t.slots(sana)[0].status, "available");
    } finally { await t.close(); }
  });
});
