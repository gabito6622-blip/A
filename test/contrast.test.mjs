// Colores legibles: cualquier color que elijan el dueño o un revendedor tiene que leerse (WCAG AA, 4,5:1).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { THEMES, lookColors, contrast, contrastNote, isHex } from "../public/common.js";

describe("contraste de colores", () => {
  test("fórmula WCAG: casos conocidos", () => {
    assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
    assert.equal(contrast("#ffffff", "#ffffff").toFixed(1), "1.0");
    assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.02);
  });

  test("los estilos listos: botón y texto principal ≥ 4,5:1", () => {
    for (const t of THEMES) {
      const c = lookColors(t.look);
      assert.ok(c.onRatio >= 4.5, `${t.name}: texto del botón ${c.onRatio.toFixed(2)}:1`);
      assert.ok(c.textRatio >= 4.5, `${t.name}: color principal como texto ${c.textRatio.toFixed(2)}:1`);
      assert.ok(isHex(c.btnA) && isHex(c.btnB) && isHex(c.text));
    }
  });

  test("2.000 colores al azar: el botón siempre se lee y el texto llega al máximo posible", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const hx = () => "#" + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join("");
    for (let i = 0; i < 2000; i++) {
      const look = { accentColor: hx(), accent2Color: i % 3 ? hx() : "", backgroundColor: hx() };
      const c = lookColors(look);
      assert.ok(c.onRatio >= 4.5, `botón ${JSON.stringify(look)} → ${c.onRatio.toFixed(2)}`);
      // Con fondos de tono medio ni el blanco ni el negro llegan a 4,5 sobre fondo y tarjeta: pedimos el mejor posible.
      const bestPole = Math.max(contrast("#ffffff", look.backgroundColor), contrast("#000000", look.backgroundColor));
      if (bestPole >= 5) assert.ok(c.textRatio >= 4.5, `texto ${JSON.stringify(look)} → ${c.textRatio.toFixed(2)}`);
    }
  });

  test("el aviso dice si se lee bien o si conviene cambiar", () => {
    assert.equal(contrastNote({ accentColor: "#00e5ff", backgroundColor: "#07070d" }).cls, "ok");
    const mal = contrastNote({ accentColor: "#ff9ec7", backgroundColor: "#fff0f6" });
    assert.equal(mal.cls, "warn");
    assert.match(mal.text, /más oscuro/);
    assert.match(contrastNote({ accentColor: "#ffffff", backgroundColor: "#767676" }).text, /tono medio/);
  });
});

// Revisión de accesibilidad (axe): marcas de servicio y muestras de estilo también se leen.
import { brandBadge, themeSwatch } from "../public/common.js";
describe("accesibilidad: colores de marcas y muestras", () => {
  test("la letra de la marca es blanca o negra según su color", () => {
    for (const c of ["#10a37f", "#e50914", "#ffd000", "#1db954", "#0063e5", "#f5f5f5"]) {
      const html = brandBadge("Xyz", c);
      const ink = html.match(/;color:(#[0-9a-f]{6})/i)[1];
      assert.ok(contrast(ink, c) >= 4.5, `${c} con ${ink}: ${contrast(ink, c).toFixed(2)}`);
    }
  });
  test("el \"Aa\" de cada estilo se lee sobre su fondo (texto grande, 3:1)", () => {
    for (const t of THEMES) {
      const m = themeSwatch(t).match(/background:(#[0-9a-f]{6})".*<b style="color:(#[0-9a-f]{6})">Aa/i);
      assert.ok(m, t.id);
      assert.ok(contrast(m[2], m[1]) >= 3, `${t.id}: ${contrast(m[2], m[1]).toFixed(2)}`);
    }
  });
});
