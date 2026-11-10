// Citas recurrentes (R2-30) en el diálogo de nueva cita: regla de repetición, revisión de cada
// fecha con su disponibilidad y, para las que chocan, el hueco libre más cercano u omitirla.
import { CircleCheck, Repeat, TriangleAlert } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDate, fmtDateLong, fmtTime } from "../../lib/format";
import { Field } from "../ui";

export interface RepeatRule { frequency: "weekly" | "monthly"; interval: number; endMode: "count" | "until"; count: number; until: string }
export const defaultRule = (date: string): RepeatRule => ({
  frequency: "monthly", interval: 1, endMode: "count", count: 12,
  until: `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`,
});

export type Choice = "keep" | "suggest" | "skip";
export interface SeriesPreview { durationMin: number; occurrences: any[]; summary: { total: number; free: number; conflicts: number } }

export function ruleErrors(r: RepeatRule): string | null {
  const max = r.frequency === "weekly" ? 26 : 12;
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > max) return `El intervalo debe ser de 1 a ${max} ${r.frequency === "weekly" ? "semanas" : "meses"}`;
  if (r.endMode === "count" && (!Number.isInteger(r.count) || r.count < 2 || r.count > 52)) return "Indica de 2 a 52 citas";
  if (r.endMode === "until" && !r.until) return "Indica hasta qué fecha se repite";
  return null;
}

const ruleBody = (r: RepeatRule) => ({ frequency: r.frequency, interval: r.interval, ...(r.endMode === "count" ? { count: r.count } : { until: r.until }) });

export const previewSeries = (base: Record<string, unknown>, r: RepeatRule) => api.post<SeriesPreview>("/api/appointment-series/preview", { ...base, ...ruleBody(r) });

export const initialChoices = (p: SeriesPreview): Choice[] => p.occurrences.map((o) => (o.ok ? "keep" : "skip"));

export function chosenStarts(p: SeriesPreview, choices: Choice[]) {
  return p.occurrences.flatMap((o, i) => (choices[i] === "keep" ? [o.startsAt] : choices[i] === "suggest" && o.suggestion ? [o.suggestion.startsAt] : []));
}

export const saveSeries = (base: Record<string, unknown>, r: RepeatRule, p: SeriesPreview, choices: Choice[], idempotencyKey: string) =>
  api.post<{ seriesId: string; created: any[]; skipped: any[] }>("/api/appointment-series", {
    ...base, ...ruleBody(r), occurrences: chosenStarts(p, choices).map((startsAt) => ({ startsAt })), idempotencyKey,
  });

export function RepeatFields({ value, onChange }: { value: RepeatRule; onChange: (r: RepeatRule) => void }) {
  const err = ruleErrors(value);
  return (
    <div className="repeat-box span-2 stack-sm">
      <div className="form-grid">
        <Field label="Repetir cada">
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input className="input" type="number" min={1} max={value.frequency === "weekly" ? 26 : 12} style={{ width: 80 }} aria-label="Cada cuántas"
              value={value.interval} onChange={(e) => onChange({ ...value, interval: Number(e.target.value) })} />
            <select className="input" aria-label="Unidad" value={value.frequency} onChange={(e) => onChange({ ...value, frequency: e.target.value as RepeatRule["frequency"] })}>
              <option value="weekly">{value.interval === 1 ? "semana" : "semanas"}</option>
              <option value="monthly">{value.interval === 1 ? "mes" : "meses"}</option>
            </select>
          </div>
        </Field>
        <Field label="Termina" group>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <select className="input" aria-label="Cómo termina" style={{ width: 150 }} value={value.endMode} onChange={(e) => onChange({ ...value, endMode: e.target.value as RepeatRule["endMode"] })}>
              <option value="count">Después de</option><option value="until">El día</option>
            </select>
            {value.endMode === "count"
              ? <input className="input" type="number" min={2} max={52} aria-label="Cantidad de citas" style={{ width: 90 }} value={value.count} onChange={(e) => onChange({ ...value, count: Number(e.target.value) })} />
              : <input className="input" type="date" aria-label="Fecha final" value={value.until} onChange={(e) => onChange({ ...value, until: e.target.value })} />}
            {value.endMode === "count" && <span className="muted">citas</span>}
          </div>
        </Field>
      </div>
      {err ? <div className="alert danger small" role="alert">{err}</div> : <span className="hint muted small">Máximo 52 citas. Antes de guardar verás cada fecha con su disponibilidad.</span>}
    </div>
  );
}

export function SeriesReview({ preview, choices, onChoice }: { preview: SeriesPreview; choices: Choice[]; onChoice: (i: number, c: Choice) => void }) {
  const n = chosenStarts(preview, choices).length;
  return (
    <div className="stack-sm" aria-label="Revisión de la serie">
      <div className={`alert ${preview.summary.conflicts ? "warn" : "ok"} small`}>
        <Repeat size={15} style={{ verticalAlign: "-3px" }} /> {preview.summary.total} fechas: {preview.summary.free} libres
        {preview.summary.conflicts ? `, ${preview.summary.conflicts} con conflicto. Elige el horario sugerido u omítela.` : "."} Se agendarán <b>{n}</b>.
      </div>
      <ol className="series-list">
        {preview.occurrences.map((o, i) => (
          <li key={o.index} className={o.ok ? "ok" : "conflict"} aria-label={`Cita ${o.index}`}>
            <span className="series-when">
              {o.ok ? <CircleCheck size={16} color="var(--ok)" aria-label="Libre" role="img" /> : <TriangleAlert size={16} color="var(--warn)" aria-label="Con conflicto" role="img" />}
              <span><b>{fmtDateLong(o.startsAt)}</b> · {fmtTime(o.startsAt)}</span>
            </span>
            {o.ok ? <span className="muted small">Libre</span> : (
              <span className="stack-sm series-fix">
                <span className="small" style={{ color: "var(--warn)" }}>{o.conflict.message}</span>
                <span className="row" style={{ gap: 6 }}>
                  {o.suggestion && (
                    <button type="button" className={`btn btn-sm ${choices[i] === "suggest" ? "btn-primary" : ""}`} aria-pressed={choices[i] === "suggest"} onClick={() => onChoice(i, "suggest")}>
                      Usar {fmtDate(o.suggestion.startsAt) !== fmtDate(o.startsAt) ? `${fmtDate(o.suggestion.startsAt)} ` : ""}{fmtTime(o.suggestion.startsAt)}
                    </button>
                  )}
                  {!o.suggestion && o.conflict.code !== "past" && <span className="muted small">Sin hueco libre cerca (±7 días).</span>}
                  <button type="button" className={`btn btn-sm ${choices[i] === "skip" ? "btn-primary" : ""}`} aria-pressed={choices[i] === "skip"} onClick={() => onChoice(i, "skip")}>Omitir</button>
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
