// Mini calendario del mes para saltar de fecha, con la ocupación de cada día sombreada.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApi } from "../../lib/hooks";
import { qs } from "../../lib/api";
import { localDate } from "../../lib/format";

const WD = ["L", "M", "M", "J", "V", "S", "D"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WD_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export function MiniMonth({ date, rangeDays = 1, rangeStart, branchId, dentistId, chairId, onPick }: {
  date: string; rangeDays?: number; rangeStart?: string; branchId: string; dentistId?: string; chairId?: string; onPick: (d: string) => void;
}) {
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => { setMonth(date.slice(0, 7)); }, [date]);
  const occ = useApi<{ days: { date: string; ratio: number | null; count: number }[] }>(`/api/agenda/occupancy${qs({ branchId, month, dentistId, chairId })}`);
  const byDate = new Map((occ.data?.days ?? []).map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = localDate();
  const start = rangeStart ?? date;
  const end = new Date(Date.parse(start + "T12:00:00Z") + (rangeDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  return (
    <div className="mini-month" role="group" aria-label="Calendario del mes">
      <div className="row-between" style={{ marginBottom: 6 }}>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
        <b style={{ textTransform: "capitalize" }}>{MONTHS[m - 1]} {y}</b>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
      </div>
      <div className="mm-grid">
        {WD.map((w, i) => <span key={i} className="mm-wd" aria-hidden="true">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const o = byDate.get(d);
          const pct = o?.ratio == null ? null : Math.round(o.ratio * 100);
          const inRange = d >= start && d <= end;
          const wd = WD_LONG[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7];
          return (
            <button key={d} type="button" className={`mm-day ${inRange ? "in-range" : ""} ${d === today ? "today" : ""} ${o?.ratio == null ? "closed" : ""}`}
              style={pct ? { background: `color-mix(in srgb, var(--brand) ${Math.max(8, Math.round(pct * 0.55))}%, white)` } : undefined}
              aria-label={`${wd} ${Number(d.slice(8))} de ${MONTHS[m - 1]}: ${pct == null ? "sin atención" : `${pct} % ocupado, ${o!.count} cita${o!.count === 1 ? "" : "s"}`}`}
              aria-current={d === date ? "date" : undefined}
              onClick={() => onPick(d)}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="mm-scale muted small" aria-hidden="true"><span>Libre</span><i /><span>Lleno</span></div>
    </div>
  );
}
