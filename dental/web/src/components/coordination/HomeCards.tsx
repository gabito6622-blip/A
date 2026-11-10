// Tarjetas proactivas del Inicio (R2-44) y "Tus tareas".
// Las tarjetas solo proponen: "Agendar" abre el diálogo de la cita ya prellenado y la persona
// confirma. Nunca se agenda solo y nunca se propone cancelar a nadie.
import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ClipboardList, FlaskConical, History, ListTodo } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api, qs } from "../../lib/api";
import { Empty, useToast } from "../ui";
import { NewAppointmentDialog, type NewApptPrefill } from "../../pages/Agenda";
import { NewTaskDialog, TaskDetailDialog, TaskItem, type Task } from "./Tasks";
import "./coordination.css";

const ICON: Record<string, typeof History> = { overdue_tasks: ListTodo, unclosed: History, lab_ready: FlaskConical, freed_slot: CalendarClock };

interface Booking { branchId: string; prefill: NewApptPrefill; waitlistId: string | null }

/** onlyTasks: para limpieza (su Inicio es Bioseguridad) muestra solo sus tareas, y nada si no tiene. */
export function HomeCards({ onlyTasks }: { onlyTasks?: boolean }) {
  const { can, branchId } = useAuth();
  const toast = useToast();
  const data = useApi<{ cards: any[]; myTasks: { items: Task[]; total: number; overdue: number } }>(can("tasks.use") ? `/api/home/cards${qs({ branchId })}` : null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const d = data.data;
  if (!d) return null;
  const cards = d.cards.filter((c) => c.kind !== "overdue_tasks" || c.id === "team_overdue_tasks" || !onlyTasks);
  if (onlyTasks && !d.myTasks.total) return null;
  const book = (slot: any, cand: any) => setBooking({
    branchId: slot.branchId, waitlistId: cand.source === "waitlist" ? cand.id : null,
    prefill: {
      date: slot.date, time: slot.time, dentistId: slot.dentistId, durationMin: Math.min(slot.durationMin, cand.durationMin) || slot.durationMin,
      procedureId: cand.procedureId ?? null, patient: { id: cand.patientId, name: cand.patientName },
      recall: cand.source === "recall" ? { id: cand.id, reason: cand.reason ?? "Control" } : null,
    },
  });
  return (
    <>
      {!onlyTasks && cards.length > 0 && (
        <section aria-labelledby="co-cards-title" className="stack-sm">
          <h2 id="co-cards-title" className="sr-only">Avisos para hoy</h2>
          <div className="co-cards">
            {cards.map((c) => {
              const Icon = ICON[c.kind] ?? ClipboardList;
              if (c.kind === "freed_slot") return (
                <article key={c.id} className="co-card slot" aria-label={c.title}>
                  <div className="co-card-title"><Icon size={18} aria-hidden /><span>{c.title}</span></div>
                  <span className="muted small">{c.detail}</span>
                  {c.slot.candidates.length > 0 && (
                    <ul className="co-cands">
                      {c.slot.candidates.map((x: any) => (
                        <li key={`${x.source}-${x.id}`}>
                          <span><b>{x.patientName}</b> <span className="muted small">· {x.sourceLabel}{x.reason ? ` · ${x.reason}` : ""} · {x.durationMin} min</span></span>
                          {can("agenda.write") && <button className="btn" onClick={() => book(c.slot, x)}>Agendar a las {c.slot.time}…</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <span className="muted small">«Agendar» abre la cita para que la revises y confirmes; no se agenda sola.</span>
                </article>
              );
              return (
                <article key={c.id} className="co-card" aria-label={c.title}>
                  <div className="co-card-title"><Icon size={18} aria-hidden /><span>{c.title}</span></div>
                  {c.detail && <span className="muted small">{c.detail}</span>}
                  {c.link && <Link className="btn" style={{ alignSelf: "flex-start" }} to={c.link}>Revisar</Link>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="co-mytasks-title">
        <div className="card-head">
          <h2 id="co-mytasks-title">Tus tareas</h2>
          <div className="row" style={{ gap: 8 }}>
            {d.myTasks.overdue > 0 && <span className="badge danger">{d.myTasks.overdue} vencida{d.myTasks.overdue === 1 ? "" : "s"}</span>}
            <button className="btn btn-sm co-tap" onClick={() => setCreating(true)}>Nueva tarea</button>
            <Link to="/tareas" className="btn btn-sm co-tap">Ver todas</Link>
          </div>
        </div>
        {d.myTasks.items.length ? (
          <div className="co-list">
            {d.myTasks.items.map((t) => <TaskItem key={t.id} t={t} onOpen={setOpenId} onChanged={data.reload} showBranch={!branchId} />)}
            {d.myTasks.total > d.myTasks.items.length && <Link to="/tareas" className="muted small">y {d.myTasks.total - d.myTasks.items.length} más…</Link>}
          </div>
        ) : <Empty>No tienes tareas pendientes.</Empty>}
      </section>

      {openId && <TaskDetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={data.reload} />}
      {creating && <NewTaskDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); data.reload(); }} />}
      {booking && (
        <NewAppointmentDialog branchId={booking.branchId} prefill={booking.prefill} onClose={() => setBooking(null)}
          onSaved={async () => {
            const w = booking.waitlistId;
            setBooking(null);
            // La persona ya confirmó la cita: se saca al paciente de la lista de espera.
            if (w) await api.post(`/api/waitlist/${w}/status`, { status: "booked" }).catch(() => toast("La cita quedó agendada; revisa la lista de espera", true));
            data.reload();
          }} />
      )}
    </>
  );
}
