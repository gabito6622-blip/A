// Aviso de alergias al recetar (R2-40): compara las alergias declaradas en la última
// versión de los antecedentes médicos con el medicamento (nombre y grupos de alergia
// del catálogo: amoxicilina → penicilina, betalactámico). Es un AVISO, no un bloqueo:
// el profesional decide y debe marcar "Revisé la alergia" para emitir.
import { normalize } from "./text.js";

/** Respuestas que significan "sin alergias". */
const NONE = /^(no|ninguna?|niega( alergias?)?|sin alergias?( conocidas)?|no refiere|no conocidas?|nada|n\/?a|-+|\.+)$/;

/** Palabras que no identifican un medicamento ni un grupo. */
const STOP = new Set([
  "alergia", "alergias", "alergico", "alergica", "alergicos", "a", "al", "la", "el", "los", "las", "de", "del", "con", "por", "para", "sin", "y", "o", "e",
  "medicamento", "medicamentos", "farmaco", "farmacos", "reaccion", "reacciones", "leve", "grave", "severa", "severo", "tipo", "oral", "acido", "sodico",
  "sodica", "potasico", "potasica", "clorhidrato", "comprimidos", "capsulas", "jarabe", "mg", "ml", "gel", "crema", "colutorio", "ampolla", "suspension",
  "intolerancia", "sensibilidad", "segun", "paciente", "refiere", "presenta", "antecedente", "antecedentes", "otros", "otras",
]);

const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
/** Singular simple: "penicilinas" → "penicilina", "aines" → "aine". */
const sing = (w: string) => (w.length > 5 && w.endsWith("es") && !w.endsWith("nes") ? w.slice(0, -2) : w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

/** Términos de alergia declarados ("Penicilina, AINEs; látex" → ["Penicilina", "AINEs", "látex"]). */
export function allergyTerms(text: string | null | undefined): string[] {
  const t = String(text ?? "").trim();
  if (!t || NONE.test(normalize(t))) return [];
  return t.split(/[,;\n/]+|\s+y\s+|\s+e\s+/i).map((x) => x.trim()).filter((x) => x.length >= 3 && !NONE.test(normalize(x)));
}

export interface AllergyDrug { name: string; tags?: string[] | null }

/** Devuelve el término de alergia que coincide con el medicamento, o null. */
export function matchAllergy(allergies: string | null | undefined, drug: AllergyDrug): string | null {
  const terms = allergyTerms(allergies);
  if (!terms.length) return null;
  const hay = new Set<string>();
  for (const w of [...words(drug.name), ...(drug.tags ?? []).flatMap((t) => words(t))]) { hay.add(w); hay.add(sing(w)); }
  for (const term of terms) {
    for (const w of words(term)) {
      const s = sing(w);
      if (hay.has(w) || hay.has(s)) return term;
      // "betalact" o "penicilin" escritos a medias también avisan (prefijo de 6 letras o más).
      if (s.length >= 6 && [...hay].some((h) => h.startsWith(s))) return term;
    }
  }
  return null;
}

export interface AllergyWarning { line: number; drug: string; allergy: string }

export function allergyWarnings(allergies: string | null | undefined, lines: AllergyDrug[]): AllergyWarning[] {
  const out: AllergyWarning[] = [];
  lines.forEach((l, i) => {
    const m = matchAllergy(allergies, l);
    if (m) out.push({ line: i + 1, drug: l.name, allergy: m });
  });
  return out;
}
