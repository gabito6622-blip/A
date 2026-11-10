import { Download, Info } from "lucide-react";
import { bs, localDate } from "../../lib/format";
import "./management.css";

/** Botón de exportación a Excel (descarga directa; el servidor registra la exportación en la auditoría). */
export function ExportLink({ href, label = "Exportar a Excel", small }: { href: string; label?: string; small?: boolean }) {
  return <a className={`btn ${small ? "btn-sm" : ""} mg-export`} href={href} download><Download size={15} />{label}</a>;
}

export const thisMonth = () => localDate().slice(0, 7);
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const s = new Intl.DateTimeFormat("es-BO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function MonthPicker({ value, onChange, max }: { value: string; onChange: (m: string) => void; max?: string }) {
  return (
    <div className="mg-month" role="group" aria-label="Mes">
      <button className="btn" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Mes anterior">‹</button>
      <b aria-live="polite">{monthLabel(value)}</b>
      <button className="btn" onClick={() => onChange(shiftMonth(value, 1))} disabled={!!max && value >= max} aria-label="Mes siguiente">›</button>
    </div>
  );
}

/** Monto o «sin datos» (nunca un cero inventado). */
export function Money({ cents, signed }: { cents: number | null | undefined; signed?: boolean }) {
  if (cents == null) return <span className="mg-nodata">sin datos</span>;
  return <span className={signed ? (cents < 0 ? "mg-neg" : "") : ""}>{bs(cents)}</span>;
}

export function Variation({ pct, suffix = "%" }: { pct: number | null | undefined; suffix?: string }) {
  if (pct == null) return <span className="mg-var muted" title="Sin base de comparación">—</span>;
  const s = `${pct > 0 ? "+" : ""}${pct.toLocaleString("es-BO")} ${suffix}`;
  return <span className={`mg-var ${pct > 0 ? "mg-pos" : pct < 0 ? "mg-neg" : "muted"}`}>{s}</span>;
}

export function InfoButton({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="mg-info" aria-label={`¿De dónde sale «${label}»?`} aria-expanded={open} title={`¿De dónde sale «${label}»?`} onClick={onClick}>
      <Info size={16} />
    </button>
  );
}
