// Periodontograma: modelo, validación, índices, comparación y orden de sondaje.
//
// Módulo PURO (sin dependencias ni E/S). Lo usan el servidor (validación, índices congelados
// al cerrar, comparación) y la interfaz (cálculo en vivo del borrador), así el número que ve
// el profesional en el borrador es exactamente el que queda al cerrar.
//
// Convención de signo de la recesión (visible en la interfaz):
//   rec > 0  → el margen gingival está APICAL al límite amelocementario (LAC): raíz expuesta.
//   rec < 0  → el margen gingival está CORONAL al LAC (encía agrandada / seudobolsa).
//   NIC (CAL) = sondaje + recesión. En implantes no se calcula NIC (no hay LAC).

export const SITES = ["MB", "B", "DB", "ML", "L", "DL"] as const;
export type Site = (typeof SITES)[number];
export type Face = "B" | "L";
export const FACE_SITES: Record<Face, Site[]> = { B: ["MB", "B", "DB"], L: ["ML", "L", "DL"] };

export const PERMANENT_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const PRIMARY_TEETH = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
/** Pieza permanente que ocupa el lugar de cada temporal. */
export const PRIMARY_SUCCESSOR: Record<number, number> = Object.fromEntries(
  PRIMARY_TEETH.map((p) => [p, (Math.floor(p / 10) - 4) * 10 + (p % 10)]),
);
/** Posiciones en pantalla (vista del profesional): arcada superior 18→28 e inferior 48→38. */
export const UPPER_POSITIONS = PERMANENT_TEETH.slice(0, 16);
export const LOWER_POSITIONS = PERMANENT_TEETH.slice(16);

export const PD_MIN = 0, PD_MAX = 15;
export const REC_MIN = -5, REC_MAX = 15;
export const MOBILITY_MAX = 3, FURCATION_MAX = 3;

export const PROGNOSIS = ["good", "fair", "poor", "questionable", "hopeless"] as const;
export type Prognosis = (typeof PROGNOSIS)[number];
export const PROGNOSIS_LABEL: Record<Prognosis, string> = {
  good: "Bueno", fair: "Regular", poor: "Malo", questionable: "Cuestionable", hopeless: "Sin esperanza",
};
export const FURCATION_LABEL = ["0", "I", "II", "III"] as const;

export interface SiteData { pd?: number | null; rec?: number | null; bop?: boolean; sup?: boolean; pl?: boolean }
export interface ToothData {
  missing?: boolean;
  implant?: boolean;
  mobility?: number | null;
  prognosis?: Prognosis | null;
  furcation?: Record<string, number | null>;
  sites?: Partial<Record<Site, SiteData>>;
}
export interface PerioData { v: 1; primary: number[]; teeth: Record<string, ToothData> }

export const emptyPerio = (): PerioData => ({ v: 1, primary: [], teeth: {} });

export const quadrant = (tooth: number) => {
  const q = Math.floor(tooth / 10);
  return q > 4 ? q - 4 : q;
};
export const isUpper = (tooth: number) => [1, 2].includes(quadrant(tooth));
export const isPrimary = (tooth: number) => tooth >= 51;

/** Entradas de furca según la pieza (las demás piezas no tienen furca). */
export function furcationEntrances(tooth: number): string[] {
  const unit = tooth % 10;
  const up = isUpper(tooth);
  if (isPrimary(tooth)) return unit >= 4 ? (up ? ["B", "MP", "DP"] : ["B", "L"]) : [];
  if (unit >= 6) return up ? ["B", "MP", "DP"] : ["B", "L"];
  if (unit === 4 && up) return ["M", "D"];
  return [];
}
export const FURCATION_ENTRANCE_LABEL: Record<string, string> = { B: "V", L: "L", MP: "MP", DP: "DP", M: "M", D: "D" };

/** Etiqueta del sitio en español: V = vestibular; P (superior) o L (inferior) del lado interno. */
export function siteLabel(tooth: number, site: Site): string {
  const inner = isUpper(tooth) ? "P" : "L";
  return { MB: "MV", B: "V", DB: "DV", ML: `M${inner}`, L: inner, DL: `D${inner}` }[site];
}
export const faceLabel = (tooth: number, face: Face) => (face === "B" ? "vestibular" : isUpper(tooth) ? "palatino" : "lingual");

/** Pieza que ocupa una posición, considerando los temporales presentes. */
export function toothAt(position: number, primary: number[]): number {
  const p = (primary ?? []).find((x) => PRIMARY_SUCCESSOR[x] === position);
  return p ?? position;
}
export const chartTeeth = (data: Pick<PerioData, "primary">) => PERMANENT_TEETH.map((p) => toothAt(p, data.primary ?? []));

/** Sitios de una cara en orden de pantalla (izquierda → derecha). Cuadrantes 1 y 4 a la izquierda: lo distal va primero. */
export function screenSites(tooth: number, face: Face): Site[] {
  const s = FACE_SITES[face];
  return [1, 4].includes(quadrant(tooth)) ? [...s].reverse() : s;
}

// ---------------------------------------------------------------- Validación
export interface Issue { path: string; message: string }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const VALID_TEETH = new Set([...PERMANENT_TEETH, ...PRIMARY_TEETH]);
const TOOTH_KEYS = new Set(["missing", "implant", "mobility", "prognosis", "furcation", "sites"]);
const SITE_KEYS = new Set(["pd", "rec", "bop", "sup", "pl"]);

export function siteHasData(s: SiteData | undefined): boolean {
  return !!s && (s.pd != null || s.rec != null || !!s.bop || !!s.sup || !!s.pl);
}
export function toothHasMeasurements(t: ToothData | undefined): boolean {
  if (!t) return false;
  if (t.mobility != null || t.prognosis != null) return true;
  if (t.furcation && Object.values(t.furcation).some((v) => v != null)) return true;
  return SITES.some((s) => siteHasData(t.sites?.[s]));
}

/**
 * Valida un periodontograma. Nunca corrige ni recorta valores: devuelve la lista de problemas
 * con un mensaje claro (pieza, sitio, rango y valor recibido).
 * forClose=true agrega las reglas para poder cerrar (al menos un sitio medido; sin marcas en sitios sin sondaje).
 */
export function validatePerio(input: unknown, opts: { forClose?: boolean } = {}): Issue[] {
  const out: Issue[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  if (!isObj(input)) return [{ path: "data", message: "El periodontograma debe ser un objeto" }];
  if (input.v !== 1) add("data.v", "Versión de formato no soportada (se espera 1)");
  const primary = input.primary ?? [];
  if (!Array.isArray(primary)) add("data.primary", "La lista de piezas temporales no es válida");
  const prim: number[] = Array.isArray(primary) ? primary : [];
  const seen = new Set<number>();
  for (const p of prim) {
    if (!isInt(p) || !PRIMARY_TEETH.includes(p)) { add("data.primary", `Pieza temporal inválida: ${JSON.stringify(p)}`); continue; }
    const succ = PRIMARY_SUCCESSOR[p]!;
    if (seen.has(succ)) add("data.primary", `Hay dos piezas temporales en la posición del ${succ}`);
    seen.add(succ);
  }
  if (!isObj(input.teeth)) { add("data.teeth", "Faltan los datos por pieza"); return out; }
  for (const [key, raw] of Object.entries(input.teeth)) {
    const tooth = Number(key);
    const at = `Diente ${key}`;
    if (!/^\d{2}$/.test(key) || !VALID_TEETH.has(tooth)) { add(`teeth.${key}`, `Pieza inválida (notación FDI): ${key}`); continue; }
    if (!isObj(raw)) { add(`teeth.${key}`, `${at}: datos inválidos`); continue; }
    const t = raw as Record<string, unknown>;
    for (const k of Object.keys(t)) if (!TOOTH_KEYS.has(k)) add(`teeth.${key}.${k}`, `${at}: campo desconocido «${k}»`);
    if (isPrimary(tooth) && !prim.includes(tooth) && toothHasMeasurements(t as ToothData)) {
      add(`teeth.${key}`, `${at}: es temporal pero no está marcado como presente en la dentición temporal`);
    }
    if (!isPrimary(tooth) && prim.some((p) => PRIMARY_SUCCESSOR[p] === tooth) && (toothHasMeasurements(t as ToothData) || t.missing || t.implant)) {
      add(`teeth.${key}`, `${at}: su lugar lo ocupa el temporal ${prim.find((p) => PRIMARY_SUCCESSOR[p] === tooth)}; registra los datos en esa pieza`);
    }
    for (const b of ["missing", "implant"] as const) {
      if (t[b] !== undefined && typeof t[b] !== "boolean") add(`teeth.${key}.${b}`, `${at}: «${b === "missing" ? "ausente" : "implante"}» debe ser sí o no`);
    }
    if (t.missing === true && t.implant === true) add(`teeth.${key}`, `${at}: no puede estar ausente y ser implante a la vez`);
    if (t.implant === true && isPrimary(tooth)) add(`teeth.${key}.implant`, `${at}: una pieza temporal no puede ser implante`);
    if (t.mobility != null && (!isInt(t.mobility) || t.mobility < 0 || t.mobility > MOBILITY_MAX)) {
      add(`teeth.${key}.mobility`, `${at}: la movilidad va de 0 a ${MOBILITY_MAX} (recibido ${JSON.stringify(t.mobility)})`);
    }
    if (t.prognosis != null && !PROGNOSIS.includes(t.prognosis as Prognosis)) add(`teeth.${key}.prognosis`, `${at}: pronóstico desconocido (${JSON.stringify(t.prognosis)})`);
    if (t.furcation !== undefined) {
      if (!isObj(t.furcation)) add(`teeth.${key}.furcation`, `${at}: furca inválida`);
      else {
        const allowed = furcationEntrances(tooth);
        for (const [e, v] of Object.entries(t.furcation)) {
          if (!allowed.includes(e)) { add(`teeth.${key}.furcation.${e}`, `${at}: no tiene entrada de furca «${e}»${allowed.length ? ` (entradas: ${allowed.join(", ")})` : ""}`); continue; }
          if (v != null && (!isInt(v) || v < 0 || v > FURCATION_MAX)) add(`teeth.${key}.furcation.${e}`, `${at}, furca ${FURCATION_ENTRANCE_LABEL[e]}: el grado va de 0 a III (recibido ${JSON.stringify(v)})`);
          if (v != null && t.implant === true) add(`teeth.${key}.furcation.${e}`, `${at}: un implante no tiene furca`);
        }
      }
    }
    if (t.sites !== undefined) {
      if (!isObj(t.sites)) add(`teeth.${key}.sites`, `${at}: sitios inválidos`);
      else for (const [s, sv] of Object.entries(t.sites)) {
        if (!(SITES as readonly string[]).includes(s)) { add(`teeth.${key}.sites.${s}`, `${at}: sitio desconocido «${s}» (válidos: ${SITES.join(", ")})`); continue; }
        const lbl = `${at} ${siteLabel(tooth, s as Site)}`;
        if (!isObj(sv)) { add(`teeth.${key}.sites.${s}`, `${lbl}: datos inválidos`); continue; }
        for (const k of Object.keys(sv)) if (!SITE_KEYS.has(k)) add(`teeth.${key}.sites.${s}.${k}`, `${lbl}: campo desconocido «${k}»`);
        if (sv.pd != null) {
          if (!isInt(sv.pd)) add(`teeth.${key}.sites.${s}.pd`, `${lbl}: el sondaje debe ser un número entero de mm (recibido ${JSON.stringify(sv.pd)})`);
          else if (sv.pd < PD_MIN || sv.pd > PD_MAX) add(`teeth.${key}.sites.${s}.pd`, `${lbl}: el sondaje va de ${PD_MIN} a ${PD_MAX} mm (recibido ${sv.pd})`);
        }
        if (sv.rec != null) {
          if (!isInt(sv.rec)) add(`teeth.${key}.sites.${s}.rec`, `${lbl}: la recesión debe ser un número entero de mm (recibido ${JSON.stringify(sv.rec)})`);
          else if (sv.rec < REC_MIN || sv.rec > REC_MAX) add(`teeth.${key}.sites.${s}.rec`, `${lbl}: la recesión va de ${REC_MIN} a +${REC_MAX} mm (recibido ${sv.rec})`);
        }
        for (const b of ["bop", "sup", "pl"] as const) if (sv[b] !== undefined && typeof sv[b] !== "boolean") add(`teeth.${key}.sites.${s}.${b}`, `${lbl}: «${b}» debe ser sí o no`);
        if (opts.forClose && sv.pd == null && (sv.bop === true || sv.sup === true || sv.pl === true)) {
          add(`teeth.${key}.sites.${s}`, `${lbl}: tiene sangrado, supuración o placa pero no tiene sondaje. Registra el sondaje o quita la marca.`);
        }
      }
    }
    if (t.missing === true && toothHasMeasurements(t as ToothData)) {
      add(`teeth.${key}`, `${at}: está marcado como ausente y tiene mediciones. Bórralas o quita «ausente».`);
    }
  }
  if (opts.forClose && out.length === 0 && computeIndices(input as unknown as PerioData).sitesMeasured === 0) {
    add("data", "No hay ningún sitio con sondaje: no se puede cerrar una exploración vacía");
  }
  return out;
}

// ---------------------------------------------------------------- Índices
export interface Ratio { count: number; denom: number; pct: number | null }
export interface Mean { value: number | null; denom: number }
export interface Indices {
  teethPositions: number;
  teethPresent: number;
  teethMeasured: number;
  sitesPossible: number;      // sitios de dientes presentes (6 por diente)
  sitesMeasured: number;      // sitios con sondaje en dientes presentes: denominador de los %
  bleeding: Ratio;
  plaque: Ratio;
  suppuration: Ratio;
  meanPd: Mean;
  meanCal: Mean;              // solo sitios con sondaje y recesión, sin implantes
  pd4: { sites: number; teeth: number };
  pd6: { sites: number; teeth: number };
  /** Marcas de sangrado/supuración/placa en sitios sin sondaje: no cuentan en los porcentajes. */
  ignoredMarks: number;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const ratio = (count: number, denom: number): Ratio => ({ count, denom, pct: denom ? round((count / denom) * 100, 1) : null });

/** Índices calculados SOLO sobre los sitios medidos de los dientes presentes (nunca sobre 192 fijos). */
export function computeIndices(data: PerioData): Indices {
  const positions = chartTeeth(data);
  let teethPresent = 0, teethMeasured = 0, sitesMeasured = 0, bop = 0, pl = 0, sup = 0, pdSum = 0, calSum = 0, calN = 0, ignored = 0;
  let s4 = 0, s6 = 0, t4 = 0, t6 = 0;
  for (const tooth of positions) {
    const t = data.teeth[String(tooth)];
    if (t?.missing) continue;
    teethPresent++;
    let measuredHere = false, has4 = false, has6 = false;
    for (const s of SITES) {
      const sd = t?.sites?.[s];
      if (!sd) continue;
      if (sd.pd == null) { if (sd.bop || sd.sup || sd.pl) ignored++; continue; }
      measuredHere = true;
      sitesMeasured++;
      pdSum += sd.pd;
      if (sd.bop) bop++;
      if (sd.pl) pl++;
      if (sd.sup) sup++;
      if (sd.rec != null && !t?.implant) { calSum += sd.pd + sd.rec; calN++; }
      if (sd.pd >= 4) { s4++; has4 = true; }
      if (sd.pd >= 6) { s6++; has6 = true; }
    }
    if (measuredHere) teethMeasured++;
    if (has4) t4++;
    if (has6) t6++;
  }
  return {
    teethPositions: positions.length,
    teethPresent,
    teethMeasured,
    sitesPossible: teethPresent * 6,
    sitesMeasured,
    bleeding: ratio(bop, sitesMeasured),
    plaque: ratio(pl, sitesMeasured),
    suppuration: ratio(sup, sitesMeasured),
    meanPd: { value: sitesMeasured ? round(pdSum / sitesMeasured, 2) : null, denom: sitesMeasured },
    meanCal: { value: calN ? round(calSum / calN, 2) : null, denom: calN },
    pd4: { sites: s4, teeth: t4 },
    pd6: { sites: s6, teeth: t6 },
    ignoredMarks: ignored,
  };
}

/** NIC de un sitio (null si falta sondaje o recesión, o si es implante). */
export function siteCal(t: ToothData | undefined, s: Site): number | null {
  const sd = t?.sites?.[s];
  if (!sd || sd.pd == null || sd.rec == null || t?.implant) return null;
  return sd.pd + sd.rec;
}

// ---------------------------------------------------------------- Comparación
export type SiteChange = "improved" | "worse" | "unchanged" | "not_comparable";
export interface SiteComparison {
  tooth: number; site: Site; pdA: number | null; pdB: number | null; delta: number | null;
  calA: number | null; calB: number | null; bopA: boolean; bopB: boolean; status: SiteChange;
}
export interface Comparison {
  threshold: number;
  sites: SiteComparison[];
  counts: Record<SiteChange, number>;
  indicesA: Indices; indicesB: Indices;
  deltas: { bleedingPct: number | null; plaquePct: number | null; meanPd: number | null; meanCal: number | null; pd4Sites: number; pd6Sites: number; pd4Teeth: number; pd6Teeth: number };
}

const diff = (a: number | null, b: number | null, d = 2) => (a == null || b == null ? null : round(b - a, d));

/**
 * Compara dos exploraciones (a = anterior, b = posterior) sitio por sitio.
 * Mejoró: el sondaje bajó al menos `threshold` mm; empeoró: subió al menos `threshold` mm.
 * Con umbral 2 (por defecto), un cambio de 1 mm se considera dentro del error de medición.
 */
export function compareExams(a: PerioData, b: PerioData, threshold = 2): Comparison {
  const ta = chartTeeth(a), tb = chartTeeth(b);
  const sites: SiteComparison[] = [];
  const counts: Record<SiteChange, number> = { improved: 0, worse: 0, unchanged: 0, not_comparable: 0 };
  ta.forEach((toothA, i) => {
    const toothB = tb[i]!;
    const xa = a.teeth[String(toothA)], xb = b.teeth[String(toothB)];
    for (const s of SITES) {
      const pa = xa?.missing ? null : xa?.sites?.[s]?.pd ?? null;
      const pb = xb?.missing ? null : xb?.sites?.[s]?.pd ?? null;
      const comparable = toothA === toothB && pa != null && pb != null;
      const delta = comparable ? pb! - pa! : null;
      const status: SiteChange = delta == null ? "not_comparable" : delta <= -threshold ? "improved" : delta >= threshold ? "worse" : "unchanged";
      counts[status]++;
      sites.push({
        tooth: toothB, site: s, pdA: pa, pdB: pb, delta,
        calA: xa?.missing ? null : siteCal(xa, s), calB: xb?.missing ? null : siteCal(xb, s),
        bopA: !!xa?.sites?.[s]?.bop, bopB: !!xb?.sites?.[s]?.bop, status,
      });
    }
  });
  const ia = computeIndices(a), ib = computeIndices(b);
  return {
    threshold, sites, counts, indicesA: ia, indicesB: ib,
    deltas: {
      bleedingPct: diff(ia.bleeding.pct, ib.bleeding.pct, 1),
      plaquePct: diff(ia.plaque.pct, ib.plaque.pct, 1),
      meanPd: diff(ia.meanPd.value, ib.meanPd.value),
      meanCal: diff(ia.meanCal.value, ib.meanCal.value),
      pd4Sites: ib.pd4.sites - ia.pd4.sites, pd6Sites: ib.pd6.sites - ia.pd6.sites,
      pd4Teeth: ib.pd4.teeth - ia.pd4.teeth, pd6Teeth: ib.pd6.teeth - ia.pd6.teeth,
    },
  };
}

// ---------------------------------------------------------------- Orden de sondaje
export type OrderPreset = "standard" | "quadrant" | "buccal_first";
interface Leg { teeth: number[]; face: Face; label: string }

const Q = { 1: [18, 17, 16, 15, 14, 13, 12, 11], 2: [21, 22, 23, 24, 25, 26, 27, 28], 3: [31, 32, 33, 34, 35, 36, 37, 38], 4: [41, 42, 43, 44, 45, 46, 47, 48] } as const;
const rev = (a: readonly number[]) => [...a].reverse();

function legs(preset: OrderPreset): Leg[] {
  const up = [...Q[1], ...Q[2]];                 // 18 → 28
  const low = [...rev(Q[4]), ...Q[3]];           // 48 → 38
  switch (preset) {
    case "quadrant": return [
      { teeth: [...Q[1]], face: "B", label: "18→11 vestibular" }, { teeth: rev(Q[1]), face: "L", label: "11→18 palatino" },
      { teeth: rev(Q[2]), face: "B", label: "28→21 vestibular" }, { teeth: [...Q[2]], face: "L", label: "21→28 palatino" },
      { teeth: rev(Q[3]), face: "B", label: "38→31 vestibular" }, { teeth: [...Q[3]], face: "L", label: "31→38 lingual" },
      { teeth: rev(Q[4]), face: "B", label: "48→41 vestibular" }, { teeth: [...Q[4]], face: "L", label: "41→48 lingual" },
    ];
    case "buccal_first": return [
      { teeth: up, face: "B", label: "18→28 vestibular" }, { teeth: rev(low), face: "B", label: "38→48 vestibular" },
      { teeth: rev(up), face: "L", label: "28→18 palatino" }, { teeth: low, face: "L", label: "48→38 lingual" },
    ];
    default: return [
      { teeth: up, face: "B", label: "18→28 vestibular" }, { teeth: rev(up), face: "L", label: "28→18 palatino" },
      { teeth: low, face: "L", label: "48→38 lingual" }, { teeth: rev(low), face: "B", label: "38→48 vestibular" },
    ];
  }
}

export const ORDER_PRESETS: { id: OrderPreset; label: string }[] = [
  { id: "standard", label: "Estándar (en Z)" },
  { id: "quadrant", label: "Por cuadrante" },
  { id: "buccal_first", label: "Primero todo vestibular" },
];
export const orderDescription = (preset: OrderPreset) => legs(preset).map((l) => l.label);

/**
 * Secuencia completa de sitios a sondear. Dentro de cada diente los sitios siguen la dirección
 * del recorrido (al ir de 18 a 11 por vestibular: DV, V, MV). Las posiciones se traducen a las
 * piezas temporales presentes. No omite ausentes: eso lo decide quien recorre (según los datos actuales).
 */
export function probingSequence(preset: OrderPreset, primary: number[] = []): { tooth: number; site: Site }[] {
  const out: { tooth: number; site: Site }[] = [];
  for (const leg of legs(preset)) {
    const forward = leg.teeth.length < 2 || UPPER_POSITIONS.concat(LOWER_POSITIONS).indexOf(leg.teeth[1]!) > UPPER_POSITIONS.concat(LOWER_POSITIONS).indexOf(leg.teeth[0]!);
    for (const pos of leg.teeth) {
      const tooth = toothAt(pos, primary);
      const scr = screenSites(pos, leg.face);
      for (const s of forward ? scr : [...scr].reverse()) out.push({ tooth, site: s });
    }
  }
  return out;
}
