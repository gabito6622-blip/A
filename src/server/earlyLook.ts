/**
 * Colores desde el primer cuadro (13/11/2026). La tienda pintaba primero los colores de fábrica (azul) y recién
 * cuando llegaba /api/settings pasaba a los del dueño (dorado): un «destello azul» al entrar. Ahora el servidor
 * mete en el HTML las mismas variables que después pone `applyLook` (public/shop.js), así el primer cuadro ya
 * sale con los colores elegidos. Es la misma cuenta que `lookColors` de public/common.js (contraste WCAG).
 * Solo colores: no lleva datos privados.
 */
export interface EarlyLook {
  accentColor?: string; accent2Color?: string; backgroundColor?: string;
  bgStyle?: string; cardStyle?: string; corners?: string; layout?: string;
}

const isHex = (h?: string): h is string => /^#[0-9a-f]{6}$/i.test(h || "");
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function mixHex(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function relLum(h: string): number {
  const [r, g, b] = rgb(h).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const INK_LIGHT = "#ffffff", INK_DARK = "#0d1117";
function readableOn(bgs: string[]): string {
  const worst = (t: string) => Math.min(...bgs.map((b) => contrast(t, b)));
  return worst(INK_LIGHT) >= worst(INK_DARK) ? INK_LIGHT : INK_DARK;
}
function ensureContrast(color: string, surfaces: string[], target = 4.5): string {
  const worst = (c: string) => Math.min(...surfaces.map((s) => contrast(c, s)));
  if (worst(color) >= target) return color;
  let best: { c: string; t: number } | null = null;
  for (const toward of ["#000000", "#ffffff"]) {
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const c = mixHex(color, toward, t);
      if (worst(c) >= target) { if (!best || t < best.t) best = { c, t }; break; }
    }
  }
  if (best) return best.c;
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}

/** Variables CSS (las mismas que pone applyLook) y atributos de #shop para el primer cuadro. */
export function earlyLookVars(st: EarlyLook): { vars: Record<string, string>; light: boolean; bg: string; data: Record<string, string> } {
  const bg = isHex(st.backgroundColor) ? st.backgroundColor : "#090e1d";
  const ac = isHex(st.accentColor) ? st.accentColor : "#3984ff";
  const light = relLum(bg) > 0.45;
  const sky = isHex(st.accent2Color) ? st.accent2Color : mixHex(ac, light ? "#000000" : "#ffffff", light ? 0.18 : 0.35);
  const v: Record<string, string> = { "--s-bg": bg };
  if (light) {
    Object.assign(v, {
      "--s-card": mixHex(bg, "#ffffff", 0.75), "--s-card2": mixHex(bg, "#000000", 0.045), "--s-hover": mixHex(bg, "#000000", 0.07),
      "--s-line": mixHex(bg, "#000000", 0.13), "--s-ink": "#111827", "--s-muted": "#4b5567",
      "--s-ok": "#097a54", "--s-warn": "#8f5200", "--s-bad": "#b3163f", "--s-chip": mixHex(ac, "#000000", 0.35),
    });
  } else {
    Object.assign(v, {
      "--s-card": mixHex(bg, "#ffffff", 0.05), "--s-card2": mixHex(bg, "#ffffff", 0.09), "--s-hover": mixHex(bg, "#ffffff", 0.12),
      "--s-line": mixHex(bg, "#ffffff", 0.17), "--s-chip": mixHex(ac, "#ffffff", 0.6),
    });
  }
  v["--s-sky"] = sky;
  v["--s-blue"] = ac;
  // Igual que lookColors: texto sobre el botón y degradado ajustado hasta 4,5:1; el color principal como texto.
  const on = readableOn([ac, sky]);
  const worstOn = (a: string, b: string) => Math.min(contrast(on, a), contrast(on, b));
  let btnA = ac, btnB = sky;
  const toward = on === INK_LIGHT ? "#000000" : "#ffffff";
  for (let t = 0.04; worstOn(btnA, btnB) < 4.5 && t <= 0.8; t += 0.04) { btnA = mixHex(ac, toward, t); btnB = mixHex(sky, toward, t); }
  const card = mixHex(bg, "#ffffff", light ? 0.75 : 0.05);
  Object.assign(v, { "--s-on-blue": on, "--s-btn-a": btnA, "--s-btn-b": btnB, "--s-blue-text": ensureContrast(ac, [bg, card]) });
  const word = (x: string | undefined, d: string) => (/^[a-z0-9-]{1,20}$/.test(x || "") ? (x as string) : d);
  const data = { corners: word(st.corners, "round"), bg: word(st.bgStyle, "glow"), card: word(st.cardStyle, "solid"), layout: word(st.layout, "clasico"), light: light ? "1" : "" };
  return { vars: v, light, bg, data };
}

/** Mete los colores en el HTML de la tienda: <html style>, theme-color y los data-* de #shop. */
export function injectEarlyLook(html: string, st: EarlyLook): string {
  const { vars, light, bg, data } = earlyLookVars(st);
  const style = Object.entries(vars).map(([k, x]) => `${k}:${x}`).join(";") + `;color-scheme:${light ? "light" : "dark"}`;
  const attrs = Object.entries(data).map(([k, x]) => ` data-${k}="${x}"`).join("");
  return html
    .replace(/<html([^>]*)>/, (_m, a: string) => `<html${a} style="${style}">`)
    .replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${bg}">`)
    .replace('<div class="shop" id="shop">', `<div class="shop" id="shop"${attrs}>`);
}
