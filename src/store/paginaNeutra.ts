// Página propia del revendedor sin marca ajena ni promesas que no cumple (revisión de 3 meses, 15/11/2026).
// Lo que ve el cliente del revendedor en /r/<slug> sale de acá cuando el revendedor no escribió lo suyo:
// textos de portada neutros (sin nombrar plataformas que quizás no vende ni prometer «garantía»)
// y sus preguntas frecuentes, que él puede editar.
import { DomainError } from "./errors.js";

/** Texto de portada por defecto (nuevo): no nombra plataformas ni promete nada que dependa de otro. */
export const NEUTRAL_HERO_TEXT = "Elegí lo que querés, mandame el pedido por WhatsApp y te lo activo.";
/** Ventajas por defecto (nuevo): sin «Garantía» (la decide cada revendedor). */
export const neutralTicks = (symbol: string) => `Atención por WhatsApp, Pedido fácil, Precios en ${symbol}`;

/** Los textos de fábrica de antes. Si el revendedor nunca los cambió, se muestran los neutros. */
const LEGACY_HERO_TEXT = "Netflix, Spotify, Disney+ y más. Pedí por WhatsApp y te lo activo al toque.";
const LEGACY_TICKS = /^Atención rápida, Garantía, Precios en (.+)$/;
const LEGACY_CHIP = "✦ Entrega inmediata";
export const NEUTRAL_CHIP = "✦ Pedidos por WhatsApp";

/** Cambia los textos de fábrica viejos por los neutros. No toca lo que el revendedor escribió. */
export function neutralDefaults<T extends { heroText?: string; heroTicks?: string; heroChip?: string }>(look: T, symbol: string): T {
  const out = { ...look };
  if (out.heroChip === LEGACY_CHIP) out.heroChip = NEUTRAL_CHIP;
  if (out.heroText === LEGACY_HERO_TEXT) out.heroText = NEUTRAL_HERO_TEXT;
  const m = out.heroTicks ? LEGACY_TICKS.exec(out.heroTicks) : null;
  if (m) out.heroTicks = neutralTicks(m[1] || symbol);
  return out;
}

export interface ShopFaq { q: string; a: string }

/** Preguntas frecuentes de SU página: hasta 8, cortas. Una lista vacía vuelve a las de fábrica (neutras). */
export function cleanShopFaq(list: unknown): ShopFaq[] {
  if (!Array.isArray(list) || list.length > 8) throw new DomainError("VALIDATION", "Hasta 8 preguntas");
  const out: ShopFaq[] = [];
  list.forEach((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const q = String(o.q ?? "").trim(), a = String(o.a ?? "").trim();
    if (!q && !a) return; // fila vacía: se ignora
    if (!q || q.length > 140) throw new DomainError("VALIDATION", `Pregunta ${i + 1}: escribí la pregunta (hasta 140 letras)`);
    if (!a || a.length > 400) throw new DomainError("VALIDATION", `Pregunta ${i + 1}: escribí la respuesta (hasta 400 letras)`);
    out.push({ q, a });
  });
  return out;
}
