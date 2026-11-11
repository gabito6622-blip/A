// Con "solo lo de revendedores", un revendedor ve además los productos que el dueño le puso precio en SU lista
// (ej. Flujo TV en la lista en dólares de Panamá y Paraguay). La lista general "revendedor" no abre nada nuevo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../dist/store/index.js";
import { visibleTo } from "../dist/store/catalog.js";

const owner = { id: "u_owner", role: "owner" };

test("Flujo TV con precio en la lista en dólares: lo ven los de esa lista, no los de Bolivia; la tienda sigue igual", () => {
  const s = createStore();
  s.catalog.updateSettings(owner, { resellerOnlyCatalog: true, usdt: { enabled: true, payId: "123456789", rate: 11.71 } });
  s.catalog.upsertProduct(owner, { id: "disney-espn-alq", name: "Disney + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "flujo", name: "FLUJOTV", kind: "full_account", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { "disney-espn-alq": 6900, netflix: 3000 } });
  s.catalog.upsertPriceGroup(owner, { id: "usd", name: "Panamá y Paraguay (US$)", currency: "USD", prices: { "disney-espn-alq": 700, flujo: 250 } });
  const py = s.catalog.createCustomer(owner, { name: "Py", phone: "+595992946366", kind: "reseller" });
  s.catalog.updateCustomer(owner, py.id, { priceGroupId: "usd" });
  const bo = s.catalog.createCustomer(owner, { name: "Bo", phone: "+59171234567", kind: "reseller" });
  const cli = s.catalog.createCustomer(owner, { name: "Cliente", phone: "+59170000001" });
  const E = s.engine;
  const sees = (c, id) => visibleTo(E, E.s.products[id], c.id);
  assert.equal(sees(py, "flujo"), true, "Paraguay ve Flujo TV porque tiene precio en su lista");
  assert.equal(sees(py, "disney-espn-alq"), true);
  assert.equal(sees(py, "netflix"), false, "sin precio en su lista, no");
  assert.equal(sees(bo, "flujo"), false, "Bolivia: la lista general no abre productos nuevos");
  assert.equal(sees(bo, "netflix"), false, "aunque la lista general tenga un precio viejo de Netflix");
  assert.equal(sees(bo, "disney-espn-alq"), true);
  assert.equal(sees(cli, "flujo"), true, "la tienda normal sigue vendiendo Flujo TV");
});
