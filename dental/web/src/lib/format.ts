export const TZ = "America/La_Paz";

export const bs = (cents: number | null | undefined) =>
  cents == null ? "—" : new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(cents / 100).replace("BOB", "Bs");

export const fmtDate = (iso: string | Date | null | undefined) =>
  iso ? new Intl.DateTimeFormat("es-BO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)) : "—";

export const fmtDateLong = (iso: string | Date) => {
  const s = new Intl.DateTimeFormat("es-BO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fmtTime = (iso: string | Date) =>
  new Intl.DateTimeFormat("es-BO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export const fmtDateTime = (iso: string | Date | null | undefined) => (iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : "—");

/** Fecha local (La Paz) en formato AAAA-MM-DD. */
export const localDate = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export const addDays = (isoDate: string, n: number) => {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Construye un instante ISO a partir de fecha y hora locales de La Paz (UTC-4, sin horario de verano). */
export const laPazISO = (date: string, hhmm: string) => `${date}T${hhmm}:00-04:00`;

export const minutesOfDay = (iso: string) => {
  const [h, m] = fmtTime(iso).split(":").map(Number);
  return h! * 60 + m!;
};

export const age = (birth: string | null) => {
  if (!birth) return null;
  const b = new Date(birth + "T00:00:00");
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
};

/** "1.250,50" → 125050; también acepta "60.5" o "60.50" (punto decimal con 1-2 decimales). */
export const parseBs = (s: string) => {
  const t = String(s).trim();
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d+\.\d{1,2}$/.test(t) ? t : t.replace(/\./g, "");
  return Math.round(parseFloat(norm) * 100);
};
/** Centavos → texto para un campo editable ("60,00"), que parseBs vuelve a leer igual. */
export const toBsInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Porcentaje como en el resto de la app: coma decimal y espacio antes de «%» (p. ej. «26,5 %»). */
export const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n.toLocaleString("es-BO", { maximumFractionDigits: digits })} %`;

/** Fecha sin hora («2026-11-01» → «01/11/2026»), sin pasar por la zona horaria. */
export const fmtDay = (ymd: string | null | undefined) => {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
