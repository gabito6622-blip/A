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

export const parseBs = (s: string) => Math.round(parseFloat(s.replace(/\./g, "").replace(",", ".")) * 100);
export const toBsInput = (cents: number) => (cents / 100).toFixed(2);
