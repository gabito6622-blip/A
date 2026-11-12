// Aviso de interacciones al recetar (B-075). Compara lo que se va a recetar con:
//  * la medicación actual anotada en los antecedentes (texto libre),
//  * la marca «toma anticoagulantes» y «embarazo» de los antecedentes,
//  * las otras líneas de la misma receta.
//
// Es una lista CORTA y ORIENTATIVA de interacciones frecuentes en odontología, no una base
// farmacológica: no es exhaustiva, no reemplaza el criterio del profesional ni un vademécum,
// y nunca bloquea la emisión. La clínica debe revisarla (ver DECISIONS D-58).
import { normalize } from "./text.js";

export interface DrugGroup { key: string; label: string; terms: string[] }

/** Grupos por principio activo. Los términos se comparan por palabra normalizada (sin tildes) o prefijo. */
export const DRUG_GROUPS: DrugGroup[] = [
  { key: "nsaid", label: "antiinflamatorio (AINE)", terms: ["ibuprofeno", "ketorolaco", "diclofenaco", "naproxeno", "nimesulida", "meloxicam", "piroxicam", "ketoprofeno", "dexketoprofeno", "celecoxib", "etoricoxib", "aspirina", "acetilsalicilico", "aine"] },
  { key: "anticoag", label: "anticoagulante o antiagregante", terms: ["warfarina", "acenocumarol", "rivaroxaban", "apixaban", "dabigatran", "edoxaban", "clopidogrel", "heparina", "enoxaparina", "anticoagulante", "ticagrelor"] },
  { key: "antihtn", label: "antihipertensivo (IECA, ARA II o diurético)", terms: ["enalapril", "captopril", "lisinopril", "ramipril", "losartan", "valsartan", "irbesartan", "telmisartan", "hidroclorotiazida", "furosemida", "espironolactona"] },
  { key: "methotrexate", label: "metotrexato", terms: ["metotrexato"] },
  { key: "lithium", label: "litio", terms: ["litio"] },
  { key: "metronidazole", label: "metronidazol", terms: ["metronidazol", "tinidazol"] },
  { key: "macrolide", label: "macrólido (claritromicina, eritromicina)", terms: ["claritromicina", "eritromicina"] },
  { key: "azole", label: "antimicótico azólico", terms: ["fluconazol", "ketoconazol", "itraconazol"] },
  { key: "statin", label: "estatina", terms: ["simvastatina", "atorvastatina", "lovastatina"] },
  { key: "tramadol", label: "tramadol", terms: ["tramadol"] },
  { key: "ssri", label: "antidepresivo (ISRS o similar)", terms: ["sertralina", "fluoxetina", "paroxetina", "citalopram", "escitalopram", "venlafaxina", "duloxetina", "amitriptilina"] },
  { key: "tetracycline", label: "tetraciclina", terms: ["tetraciclina", "doxiciclina", "minociclina"] },
];

interface Rule { a: string; b: string; text: string }
/** Pares de grupos con su aviso (en los dos sentidos). */
const RULES: Rule[] = [
  { a: "nsaid", b: "anticoag", text: "más riesgo de sangrado" },
  { a: "nsaid", b: "antihtn", text: "puede bajar el efecto del antihipertensivo y afectar el riñón" },
  { a: "nsaid", b: "methotrexate", text: "puede aumentar la toxicidad del metotrexato" },
  { a: "nsaid", b: "lithium", text: "puede subir el nivel de litio" },
  { a: "nsaid", b: "ssri", text: "más riesgo de sangrado digestivo" },
  { a: "metronidazole", b: "anticoag", text: "puede aumentar el efecto anticoagulante" },
  { a: "macrolide", b: "anticoag", text: "puede aumentar el efecto anticoagulante" },
  { a: "azole", b: "anticoag", text: "puede aumentar el efecto anticoagulante" },
  { a: "macrolide", b: "statin", text: "más riesgo de daño muscular" },
  { a: "azole", b: "statin", text: "más riesgo de daño muscular" },
  { a: "tramadol", b: "ssri", text: "riesgo de síndrome serotoninérgico" },
];

const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

/** Grupos a los que pertenece un texto (nombre del medicamento o lista de medicación actual). */
export function groupsOf(text: string | null | undefined): Set<string> {
  const ws = words(String(text ?? ""));
  const out = new Set<string>();
  for (const g of DRUG_GROUPS) {
    if (g.terms.some((t) => ws.some((w) => w === t || (w.length >= 6 && t.startsWith(w)) || (t.length >= 6 && w.startsWith(t))))) out.add(g.key);
  }
  return out;
}

const label = (k: string) => DRUG_GROUPS.find((g) => g.key === k)!.label;

/** Principios activos (de la lista) presentes en un texto, para avisar duplicados. */
function ingredientsOf(text: string): string[] {
  const ws = words(text);
  return DRUG_GROUPS.flatMap((g) => g.terms).filter((t) => t.length >= 6 && ws.some((w) => w === t || (w.length >= 6 && t.startsWith(w))));
}

export interface InteractionHistory { medications?: string | null; anticoagulants?: boolean | null; pregnant?: boolean | null }
export interface InteractionWarning { line: number; drug: string; with: string; text: string }

export function interactionWarnings(history: InteractionHistory | null | undefined, lines: { name: string; tags?: string[] | null }[]): InteractionWarning[] {
  const meds = String(history?.medications ?? "").trim();
  const current = groupsOf(meds);
  if (history?.anticoagulants) current.add("anticoag");
  const currentIngr = new Set(ingredientsOf(meds));
  const out: InteractionWarning[] = [];
  const seen = new Set<string>();
  const push = (w: InteractionWarning) => {
    const k = `${w.line}|${w.with}|${w.text}`;
    if (!seen.has(k)) { seen.add(k); out.push(w); }
  };
  const lineGroups = lines.map((l) => groupsOf([l.name, ...(l.tags ?? [])].join(" ")));

  lines.forEach((l, i) => {
    const gs = lineGroups[i]!;
    // Ya lo toma: mismo principio activo en la medicación actual.
    const dup = ingredientsOf(l.name).find((x) => currentIngr.has(x));
    if (dup) push({ line: i + 1, drug: l.name, with: "medicación actual", text: `el paciente ya toma ${dup}` });
    for (const r of RULES) {
      for (const [mine, other] of [[r.a, r.b], [r.b, r.a]] as const) {
        if (!gs.has(mine)) continue;
        if (current.has(other)) {
          const src = other === "anticoag" && history?.anticoagulants && !groupsOf(meds).has("anticoag") ? "antecedentes: toma anticoagulantes" : `medicación actual (${label(other)})`;
          push({ line: i + 1, drug: l.name, with: src, text: r.text });
        }
        lines.forEach((o, j) => {
          if (j !== i && lineGroups[j]!.has(other)) push({ line: i + 1, drug: l.name, with: `${o.name} en esta receta`, text: r.text });
        });
      }
    }
    // Dos AINE juntos (en la receta o con la medicación actual).
    if (gs.has("nsaid")) {
      if (current.has("nsaid") && !dup) push({ line: i + 1, drug: l.name, with: "medicación actual (otro AINE)", text: "dos antiinflamatorios juntos: más riesgo digestivo y renal" });
      lines.forEach((o, j) => {
        if (j < i && lineGroups[j]!.has("nsaid")) push({ line: i + 1, drug: l.name, with: `${o.name} en esta receta`, text: "dos antiinflamatorios juntos: más riesgo digestivo y renal" });
      });
    }
    if (history?.pregnant && (gs.has("tetracycline") || gs.has("nsaid"))) {
      push({ line: i + 1, drug: l.name, with: "antecedentes: embarazo", text: gs.has("tetracycline") ? "las tetraciclinas no se recomiendan en el embarazo" : "los AINE se evitan en el embarazo, sobre todo al final" });
    }
  });
  return out;
}
