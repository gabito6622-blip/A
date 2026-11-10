// Estilo visual de una tienda (la de Gabriel Store o la página propia de un revendedor).
// Todo se valida acá: colores #RRGGBB, letras y formas de una lista fija, textos con largo máximo.
// La tienda nunca carga una letra ni un estilo que no esté en estas listas.
import { DomainError } from "./errors.js";

/** Letras disponibles (id → nombre en Google Fonts; "system" = la del dispositivo). */
export const FONTS: Record<string, string> = {
  figtree: "Figtree", bricolage: "Bricolage Grotesque",
  inter: "Inter", poppins: "Poppins", montserrat: "Montserrat", nunito: "Nunito", dmsans: "DM Sans", outfit: "Outfit",
  bebas: "Bebas Neue", orbitron: "Orbitron", righteous: "Righteous", pacifico: "Pacifico", playfair: "Playfair Display",
  bungee: "Bungee", fredoka: "Fredoka", lobster: "Lobster", russo: "Russo One", system: "",
};
export const BG_STYLES = ["solid", "glow", "gradient", "aurora", "live", "dots", "grid"] as const;
export const CARD_STYLES = ["solid", "glass", "outline", "neon", "ticket"] as const;
export const CORNERS = ["round", "soft", "square"] as const;
/** Tipo de tienda (estructura/diseño de la portada). */
export const LAYOUTS = ["clasico", "vitrina", "catalogo", "minimal"] as const;

export interface Look {
  accentColor?: string;
  /** Segundo color de los degradados. */
  accent2Color?: string;
  backgroundColor?: string;
  bgStyle?: (typeof BG_STYLES)[number];
  cardStyle?: (typeof CARD_STYLES)[number];
  /** Letra del texto. */
  fontFamily?: string;
  /** Letra de los títulos. */
  headingFont?: string;
  corners?: (typeof CORNERS)[number];
  /** Tipo de tienda: estructura de la portada. */
  layout?: (typeof LAYOUTS)[number];
  heroTitle?: string;
  heroHighlight?: string;
  heroText?: string;
  heroChip?: string;
  heroTicks?: string;
  announcement?: string;
  footerText?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
}

export const LOOK_KEYS = ["accentColor", "accent2Color", "backgroundColor", "bgStyle", "cardStyle", "fontFamily", "headingFont", "corners", "layout",
  "heroTitle", "heroHighlight", "heroText", "heroChip", "heroTicks", "announcement", "footerText", "instagram", "tiktok", "facebook"] as const;

const TEXT_LIMITS: Partial<Record<keyof Look, number>> = { heroTitle: 40, heroHighlight: 40, heroText: 220, announcement: 140, heroChip: 40, heroTicks: 120, footerText: 120 };

/** Valida y limpia los campos de estilo que vengan en `patch` (ignora los demás). */
export function cleanLook(patch: Record<string, unknown>): Partial<Look> {
  const out: Record<string, unknown> = {};
  for (const k of LOOK_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new DomainError("VALIDATION", `Valor inválido en ${k}`);
    const t = v.trim();
    if (k === "accentColor" || k === "accent2Color" || k === "backgroundColor") {
      if (t !== "" && !/^#[0-9a-fA-F]{6}$/.test(t)) throw new DomainError("VALIDATION", "Color: formato #RRGGBB");
    } else if (k === "fontFamily" || k === "headingFont") {
      if (!(t in FONTS)) throw new DomainError("VALIDATION", "Tipo de letra inválido");
    } else if (k === "bgStyle") {
      if (!(BG_STYLES as readonly string[]).includes(t)) throw new DomainError("VALIDATION", "Estilo de fondo inválido");
    } else if (k === "cardStyle") {
      if (!(CARD_STYLES as readonly string[]).includes(t)) throw new DomainError("VALIDATION", "Estilo de tarjetas inválido");
    } else if (k === "corners") {
      if (!(CORNERS as readonly string[]).includes(t)) throw new DomainError("VALIDATION", "Forma de bordes inválida");
    } else if (k === "layout") {
      if (!(LAYOUTS as readonly string[]).includes(t)) throw new DomainError("VALIDATION", "Tipo de tienda inválido");
    } else if (k === "instagram" || k === "tiktok" || k === "facebook") {
      const u = t.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|tiktok|facebook)\.com\/@?/i, "").replace(/\/+$/, "");
      if (u && !/^[A-Za-z0-9._-]{1,60}$/.test(u)) throw new DomainError("VALIDATION", `Usuario de ${k} inválido: solo letras, números, punto o guion`);
      out[k] = u;
      continue;
    } else {
      const max = TEXT_LIMITS[k] ?? 0;
      if (t.length > max) throw new DomainError("VALIDATION", `Texto demasiado largo (máx. ${max} letras)`);
    }
    out[k] = t;
  }
  return out as Partial<Look>;
}
