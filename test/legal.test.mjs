// Protección legal del software: términos, pie de tienda/panel y aviso en la consola.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");

test("los términos tienen la sección de propiedad intelectual con su base legal", () => {
  const t = pub("terminos.html");
  assert.match(t, /<section id="software">/);
  for (const ley of ["Ley N.º 1322", "24582", "Decisión 351", "363 bis", "363 ter"]) assert.ok(t.includes(ley), `falta: ${ley}`);
  assert.match(t, /no reemplaza el asesoramiento de un abogado/);
});

test("la tienda y el panel muestran el aviso y lo enlazan a los términos", () => {
  assert.match(pub("shop.js"), /\/terminos#software">© \$\{new Date\(\)\.getFullYear\(\)\} GaboHub · software protegido/);
  assert.match(pub("panel.html"), /class="swnote" href="\/terminos#software"/);
  const c = pub("common.js");
  assert.match(c, /export function softwareNotice/);
  assert.match(c, /no lo hagas: puede darle acceso a tu cuenta/);
  assert.match(pub("shop.js"), /softwareNotice\(\)/);
  assert.match(pub("panel.js"), /softwareNotice\(\)/);
});
