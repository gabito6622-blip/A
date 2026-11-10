// Vista semanal de la agenda (B-015): columnas por día (lunes a sábado; el domingo solo si
// tiene citas o alguien atiende), bloques compactos con el color elegido e ícono de estado.
// Clic en un hueco libre agenda; clic en un bloque abre la cita; arrastrar reprograma.
// En el celular se muestra como lista día por día.
import { useMemo, useState, type MouseEvent } from "react";
import { Plus } from "lucide-react";
import { fmtTime, localDate, minutesOfDay } from "../../lib/format";
import { Empty } from "../ui";
import { StatusIcon, STATUS_TEXT } from "./StatusIcon";
import { tint } from "./colors";
import type { Geometry, useDragMove } from "./useDragMove";

export const WEEK_GEO: Geometry = { start: 7 * 60, end: 21 * 60, step: 15, px: 15 };
const ROWS = (WEEK_GEO.end - WEEK_GEO.start) / WEEK_GEO.step;
const WD_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const WD_LONG = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export interface WeekDay { date: string; weekday: number; work: { start: string; end: string }[]; blocks: { start: string; end: string; reason: string }[] }

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Reparte las citas que se superponen en carriles lado a lado. */
export function layoutLanes<T extends { s: number; e: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => { for (const x of cluster) x.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const it of sorted) {
    if (it.s >= clusterEnd) { close(); clusterEnd = -1; }
    let lane = laneEnds.findIndex((end) => end <= it.s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.e); } else laneEnds[lane] = it.e;
    const x = { ...it, lane, lanes: 1 };
    cluster.push(x);
    out.push(x);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  close();
  return out;
}

export function visibleWeekDays(days: WeekDay[], appts: any[]) {
  return days.filter((d) => d.weekday !== 7 || d.work.length > 0 || appts.some((a) => localDate(new Date(a.startsAt)) === d.date));
}

export function WeekView({ days, appts, colorOf, canBook, onBook, onOpen, drag, mobile }: {
  days: WeekDay[]; appts: any[]; colorOf: (a: any) => string; canBook: boolean;
  onBook: (date: string, time: string) => void; onOpen: (id: string) => void;
  drag: ReturnType<typeof useDragMove>; mobile: boolean;
}) {
  const shown = useMemo(() => visibleWeekDays(days, appts), [days, appts]);
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of appts) {
      if (a.status === "cancelled") continue;
      const d = localDate(new Date(a.startsAt));
      m.set(d, [...(m.get(d) ?? []), a]);
    }
    return m;
  }, [appts]);
  const today = localDate();
  const nowMin = minutesOfDay(new Date().toISOString());
  const [hover, setHover] = useState<{ date: string; min: number } | null>(null);

  if (mobile) {
    return (
      <div className="wk-list">
        {shown.map((d) => {
          const list = (byDay.get(d.date) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const open = d.work.length > 0 && d.date >= today;
          return (
            <section key={d.date} className="wk-list-day" aria-label={`${WD_LONG[d.weekday]} ${Number(d.date.slice(8))}`}>
              <div className="row-between wk-list-head">
                <h3>{WD_LONG[d.weekday]} {Number(d.date.slice(8))}{d.date === today && <span className="badge brand" style={{ marginLeft: 8 }}>Hoy</span>}</h3>
                {canBook && open && <button className="btn btn-sm" onClick={() => onBook(d.date, d.date === today ? hhmm(Math.ceil(nowMin / 15) * 15) : "09:00")}><Plus size={15} />Agendar</button>}
              </div>
              {list.length ? list.map((a) => (
                <button key={a.id} type="button" className="wk-list-item" style={{ borderLeftColor: colorOf(a) }} onClick={() => onOpen(a.id)}>
                  <span className="nowrap"><b>{fmtTime(a.startsAt)}</b></span>
                  <span className="grow-text"><b>{a.patientName}</b><span className="muted small"> · {a.typeName ?? a.procedureName ?? "Consulta"} · {a.dentistName}</span></span>
                  <StatusIcon status={a.status} size={16} />
                </button>
              )) : <p className="muted small" style={{ padding: "4px 2px 10px" }}>{d.work.length ? "Sin citas." : "Sin atención."}</p>}
            </section>
          );
        })}
      </div>
    );
  }

  if (!shown.length) return <Empty>No hay días con atención esta semana.</Empty>;
  const g = WEEK_GEO;
  const onColClick = (e: MouseEvent<HTMLDivElement>, d: WeekDay) => {
    // Un clic que llega justo después de soltar una cita no abre "Nueva cita".
    if ((e.target as HTMLElement).closest(".wk-appt") || drag.clickSuppressed()) return;
    const min = slotAt(e);
    const ok = isWorking(d, min);
    if (!canBook || !ok || isPast(d.date, min)) return;
    onBook(d.date, hhmm(min));
  };
  const slotAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return g.start + Math.max(0, Math.min(ROWS - 1, Math.floor((e.clientY - r.top) / g.px))) * g.step;
  };
  const isPast = (date: string, min: number) => date < today || (date === today && min + g.step <= nowMin);
  return (
    <div className="wk-scroll">
      <div className="wk" style={{ gridTemplateColumns: `52px repeat(${shown.length}, minmax(118px, 1fr))` }}>
        <div className="wk-corner" />
        {shown.map((d) => {
          const n = (byDay.get(d.date) ?? []).length;
          return (
            <div key={d.date} className={`wk-head ${d.date === today ? "today" : ""}`}>
              <span>{WD_SHORT[d.weekday]} <b>{Number(d.date.slice(8))}</b></span>
              <span className="muted small">{n ? `${n} cita${n === 1 ? "" : "s"}` : d.work.length ? "Libre" : "Cerrado"}</span>
            </div>
          );
        })}
        <div className="wk-times" aria-hidden="true">
          {Array.from({ length: ROWS }, (_, i) => {
            const m = g.start + i * g.step;
            return <div key={i} style={{ height: g.px }}>{m % 60 === 0 ? hhmm(m) : ""}</div>;
          })}
        </div>
        {shown.map((d) => {
          const items = layoutLanes((byDay.get(d.date) ?? []).map((a) => ({ a, s: minutesOfDay(a.startsAt), e: minutesOfDay(a.endsAt) || 24 * 60 })));
          const ghost = drag.drag?.target?.col === d.date ? drag.drag : null;
          return (
            <div key={d.date} className={`wk-col ${canBook ? "bookable" : ""}`} data-drop-col={d.date} style={{ height: ROWS * g.px }}
              onClick={(e) => onColClick(e, d)}
              onMouseMove={(e) => { const min = slotAt(e); setHover(isWorking(d, min) && !isPast(d.date, min) ? { date: d.date, min } : null); }}
              onMouseLeave={() => setHover(null)}>
              {d.work.map((w, i) => {
                const s = minutesOfDay(w.start), e = minutesOfDay(w.end) || 24 * 60;
                return <div key={i} className="wk-work" style={{ top: ((Math.max(s, g.start) - g.start) / g.step) * g.px, height: ((Math.min(e, g.end) - Math.max(s, g.start)) / g.step) * g.px }} />;
              })}
              {d.blocks.map((b, i) => {
                const s = Math.max(g.start, localDate(new Date(b.start)) < d.date ? g.start : minutesOfDay(b.start));
                const e = Math.min(g.end, localDate(new Date(b.end)) > d.date ? g.end : minutesOfDay(b.end) || g.end);
                return e > s ? <div key={`b${i}`} className="wk-block" title={`Bloqueado: ${b.reason}`} style={{ top: ((s - g.start) / g.step) * g.px, height: ((e - s) / g.step) * g.px }}><span>{b.reason}</span></div> : null;
              })}
              {canBook && hover?.date === d.date && !drag.drag && (
                <div className="wk-hover" style={{ top: ((hover.min - g.start) / g.step) * g.px, height: g.px * 2 }} aria-hidden="true">{hhmm(hover.min)}</div>
              )}
              {items.map(({ a, s, e, lane, lanes }) => {
                const color = colorOf(a);
                const h = Math.max(((e - s) / g.step) * g.px - 2, 16);
                const dragging = drag.drag?.appt.id === a.id;
                return (
                  <div key={a.id} className={`wk-appt s-${a.status} ${dragging ? "dragging" : ""}`} role="button" tabIndex={0}
                    style={{ top: ((s - g.start) / g.step) * g.px + 1, height: h, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, borderLeftColor: color, background: tint(color, a.status === "completed" ? 6 : 16) }}
                    title={`${fmtTime(a.startsAt)}–${fmtTime(a.endsAt)} · ${a.patientName} · ${a.typeName ?? a.procedureName ?? "Consulta"} · ${a.dentistName}${a.chairName ? ` · ${a.chairName}` : ""} · ${STATUS_TEXT[a.status] ?? a.status}`}
                    aria-label={`${fmtTime(a.startsAt)} ${a.patientName}, ${a.typeName ?? "sin tipo"}, ${STATUS_TEXT[a.status] ?? a.status}`}
                    {...drag.bind(a)}
                    onClick={() => !drag.clickSuppressed() && onOpen(a.id)}
                    onKeyDown={(ev) => ev.key === "Enter" && onOpen(a.id)}>
                    <span className="wk-line"><StatusIcon status={a.status} /><b>{fmtTime(a.startsAt)}</b> <span className="wk-name">{a.patientName}</span></span>
                    {h > 30 && <span className="wk-sub">{a.typeName ?? a.procedureName ?? "Consulta"}{lanes === 1 ? ` · ${a.dentistName}` : ""}</span>}
                  </div>
                );
              })}
              {ghost?.target && (
                <div className="wk-ghost" aria-hidden="true" style={{ top: ((ghost.target.startMin - g.start) / g.step) * g.px + 1, height: Math.max((ghost.durationMin / g.step) * g.px - 2, 16) }}>
                  {hhmm(ghost.target.startMin)} · {ghost.appt.patientName}
                </div>
              )}
              {d.date === today && nowMin > g.start && nowMin < g.end && <div className="now-line" style={{ top: ((nowMin - g.start) / g.step) * g.px }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isWorking(d: WeekDay, min: number) {
  return d.work.some((w) => min >= minutesOfDay(w.start) && min < (minutesOfDay(w.end) || 24 * 60));
}
