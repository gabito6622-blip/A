// Contador de tareas pendientes junto a «Tareas» en el menú lateral y en «Más» del celular (B-084).
//
// Un solo estado compartido para todas las instancias (menú lateral, «Más», punto del botón «Más»):
//  * se consulta al navegar, como mucho una vez cada 30 s (las instancias comparten el freno);
//  * al salir de «Tareas» o tras crear o cambiar una tarea se actualiza enseguida (una consulta a la
//    vez: si llega otra escritura mientras tanto, se repite una sola vez al terminar);
//  * al volver a la ventana, con el mismo freno de 30 s.
// Rojo si alguna está vencida. Sin tareas no se muestra nada. Al cambiar de persona o de clínica
// (cerrar sesión y entrar con otra cuenta) el contador se vacía y se vuelve a consultar.
import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import "./task-count.css";

interface Count { total: number; overdue: number }
const THROTTLE_MS = 30_000;
let state: Count = { total: 0, overdue: 0 };
let lastFetch = 0;
let inflight = false;
let again = false;
let lastPath: string | null = null;
/** Persona y clínica a las que corresponde `state`. */
let owner: string | null = null;
const listeners = new Set<() => void>();

function refresh(force = false) {
  if (!force && Date.now() - lastFetch < THROTTLE_MS) return;
  if (inflight) { if (force) again = true; return; }
  lastFetch = Date.now();
  inflight = true;
  const forOwner = owner;
  api.get<Count>("/api/tasks/pending-count")
    .then((c) => { if (forOwner === owner) { state = { total: c.total, overdue: c.overdue }; listeners.forEach((l) => l()); } })
    .catch(() => { /* sin conexión o sin sesión: se conserva el último valor */ })
    .finally(() => {
      inflight = false;
      if (again) { again = false; refresh(true); }
    });
}

const onWrite = (e: Event) => {
  const url = String((e as CustomEvent<string>).detail ?? "");
  if (url.startsWith("/api/tasks") || url.startsWith("/api/calls")) setTimeout(() => refresh(true), 0);
};
const onFocus = () => refresh(false);

function subscribe(l: () => void) {
  if (!listeners.size) {
    window.addEventListener("api-write", onWrite);
    window.addEventListener("focus", onFocus);
  }
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (!listeners.size) {
      window.removeEventListener("api-write", onWrite);
      window.removeEventListener("focus", onFocus);
    }
  };
}

export function useTaskCount(): Count {
  const count = useSyncExternalStore(subscribe, () => state);
  const { pathname } = useLocation();
  const { me } = useAuth();
  const who = `${me?.user.id ?? ""}:${me?.clinic?.id ?? ""}`;
  useEffect(() => {
    if (owner !== who) {
      owner = who; lastPath = pathname; lastFetch = 0;
      state = { total: 0, overdue: 0 };
      listeners.forEach((l) => l());
      refresh(true);
      return;
    }
    if (lastPath === pathname) { refresh(false); return; }
    const leftTasks = !!lastPath?.startsWith("/tareas") && !pathname.startsWith("/tareas");
    lastPath = pathname;
    refresh(leftTasks || lastFetch === 0);
  }, [pathname, who]);
  return count;
}

const label = (c: Count) => `${c.total} ${c.total === 1 ? "pendiente" : "pendientes"}${c.overdue ? `, ${c.overdue} ${c.overdue === 1 ? "vencida" : "vencidas"}` : ""}`;

/** Número junto a «Tareas» (rojo si hay vencidas). */
export function TaskCount() {
  const c = useTaskCount();
  if (!c.total) return null;
  return (
    <>
      <span className={`nav-count${c.overdue ? " overdue" : ""}`} aria-hidden="true" title={label(c)} data-testid="task-count">{c.total > 99 ? "99+" : c.total}</span>
      <span className="sr-only">: {label(c)}</span>
    </>
  );
}

/** Punto sobre el botón «Más» del celular cuando «Tareas» quedó adentro y hay pendientes. */
export function TaskDot() {
  const c = useTaskCount();
  if (!c.total) return null;
  return <><span className={`nav-dot${c.overdue ? " overdue" : ""}`} aria-hidden="true" /><span className="sr-only">(tareas: {label(c)})</span></>;
}
