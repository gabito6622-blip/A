// Respuestas del bot sin red: se llama a botAnswer con una tienda en memoria y un reloj fijo.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DAY, DomainError } from "../dist/store/index.js";
import { botAnswer } from "../dist/server/bot.js";

const T0 = Date.UTC(2026, 10, 7, 16, 0, 0); // 12:00 en Bolivia
const owner = { id: "u_owner", role: "owner" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "sp", name: "Spotify Premium", kind: "invite", durationDays: 30, price: 2000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedor", prices: { nf: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "p1", name: "Prov", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "p1", email: "a@x.com", password: "Clave-Secreta-1", supplierExpiresAt: T0 + 90 * DAY, cost: 100, profiles: [{ label: "P1", pin: "1234" }, { label: "P2" }, { label: "P3" }] });
  const reseller = s.catalog.createCustomer(owner, { name: "Rosa Revende", phone: "+59171111111", kind: "reseller", priceGroupId: "rev", whatsappConsent: true });
  const client = s.catalog.createCustomer({ id: "web", role: "reseller", customerId: reseller.id }, { name: "Pedro Cliente", phone: "+59172222222" });
  s.wallet.adjust(owner, reseller.id, 10000, "carga inicial");
  const asR = { id: "web:r", role: "reseller", customerId: reseller.id };
  s.orders.create(asR, { customerId: client.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance" });
  const ctx = { store: s, origin: "https://gabostore.lat", loginLink: (id) => `https://gabostore.lat/#acceso=tok-${id}` };
  const ask = (phone, text) => botAnswer(ctx, phone, text).replies.join("\n");
  return { s, clock, reseller, client, ask, ctx };
}

describe("bot: respuestas", () => {
  test("hola muestra el menú; gracias no repite el menú; texto raro dice que no entendió", () => {
    const { ask } = setup();
    assert.match(ask("+59170000000", "Hola!"), /Respondé con un número/);
    assert.doesNotMatch(ask("+59170000000", "muchas gracias"), /Respondé con un número/);
    assert.match(ask("+59170000000", "asdf qwer"), /No te entendí/);
  });

  test("detecta el producto por nombre y muestra precio y stock (de revendedor si corresponde)", () => {
    const { ask } = setup();
    const a = ask("+59170000000", "Cuánto está el Netflix?");
    assert.match(a, /Netflix perfil\*: Bs 35 \/ 30 días · quedan 2/);
    assert.doesNotMatch(a, /Spotify/);
    assert.match(ask("+59170000000", "spotify"), /Spotify Premium\*: Bs 20 .*agotado/);
    assert.match(ask("+59171111111", "netflix"), /Bs 25[\s\S]*precio de revendedor/);
  });

  test("respuestas propias del dueño tienen prioridad; se validan", () => {
    const { s, ask } = setup();
    s.chats.updateBotSettings(owner, { quickReplies: [{ keywords: ["horario", "a que hora"], answer: "Atendemos de 9 a 21, {name}." }] });
    assert.equal(ask("+59171111111", "¿A qué hora atienden?"), "Atendemos de 9 a 21, Rosa.");
    assert.equal(ask("+59170000000", "horario"), "Atendemos de 9 a 21, .");
    assert.throws(() => s.chats.updateBotSettings(owner, { quickReplies: [{ keywords: ["1"], answer: "x" }] }), err("VALIDATION"));
    assert.throws(() => s.chats.updateBotSettings(owner, { quickReplies: [{ keywords: ["x"], answer: "" }] }), err("VALIDATION"));
    assert.throws(() => s.chats.updateBotSettings({ id: "a", role: "admin" }, { quickReplies: [] }), err("FORBIDDEN"));
  });

  test("la configuración solo acepta campos conocidos", () => {
    const { s } = setup();
    const r = s.chats.updateBotSettings(owner, { welcome: "Hola", evil: "x", templates: undefined });
    assert.equal(r.welcome, "Hola");
    assert.equal("evil" in r, false);
  });

  test("pedidos: el cliente ve el estado de los suyos; un desconocido no", () => {
    const { ask } = setup();
    assert.match(ask("+59171111111", "7"), /Compra #\S+ · Bs 25 · ✅ entregado/);
    assert.match(ask("+59170000000", "mis pedidos"), /Todavía no tengo compras/);
  });

  test("revendedor: opción 8 con sus clientes por vencer; un cliente común no la tiene", () => {
    const { ask, clock } = setup();
    assert.match(ask("+59171111111", "menu"), /8️⃣ Mis clientes por vencer/);
    assert.doesNotMatch(ask("+59172222222", "menu"), /8️⃣/);
    assert.match(ask("+59171111111", "8"), /Ninguno de tus 1 cliente/);
    clock.t += 25 * DAY;
    const a = ask("+59171111111", "8");
    assert.match(a, /Pedro Cliente: Netflix perfil · vence en 5 día/);
    assert.match(a, /#acceso=tok-/);
    assert.doesNotMatch(a, /Clave-Secreta|1234/);
    assert.match(ask("+59172222222", "8"), /Respondé con un número/, "el cliente común recibe el menú");
  });

  test("hablar con una persona fuera de horario lo aclara", () => {
    const { s, ask, clock } = setup();
    s.chats.updateBotSettings(owner, { humanHours: { from: 9, to: 18 } });
    assert.doesNotMatch(ask("+59170000000", "0"), /fuera del horario/);
    clock.t = Date.UTC(2026, 10, 8, 2, 0, 0); // 22:00 en Bolivia
    assert.match(ask("+59170000000", "0"), /fuera del horario de atención \(de 9:00 a 18:00\)/);
    assert.throws(() => s.chats.updateBotSettings(owner, { humanHours: { from: 18, to: 9 } }), err("VALIDATION"));
    s.chats.updateBotSettings(owner, { humanHours: null });
    assert.doesNotMatch(ask("+59170000000", "0"), /fuera del horario/);
  });
});
