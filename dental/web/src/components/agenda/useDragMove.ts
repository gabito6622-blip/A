// Arrastrar y soltar para reprogramar citas, con eventos de puntero:
//  * ratón: se activa al mover más de 5 px (un clic simple sigue abriendo la cita);
//  * táctil/lápiz: se activa con una pulsación larga (450 ms); si el dedo se mueve antes,
//    se deja desplazar la página normalmente.
// Las columnas de destino llevan data-drop-col="<clave>" y la grilla usa la misma geometría
// (inicio, paso y alto por paso) en todas las columnas. Escape cancela.
import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";

export interface DropTarget { col: string; startMin: number }
export interface DragState { appt: any; durationMin: number; target: DropTarget | null }
export interface Geometry { start: number; end: number; step: number; px: number }

const LONG_PRESS_MS = 450;

export function useDragMove(geo: Geometry, opts: { enabled: boolean; onDrop: (appt: any, t: DropTarget) => void }) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const st = useRef<{
    appt: any; x: number; y: number; grab: number; active: boolean; type: string; timer: number | null; durationMin: number; target: DropTarget | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const geoRef = useRef(geo);
  geoRef.current = geo;

  const targetAt = (x: number, y: number, s: NonNullable<typeof st.current>): DropTarget | null => {
    const el = document.elementsFromPoint(x, y).find((e) => (e as HTMLElement).dataset?.dropCol) as HTMLElement | undefined;
    if (!el) return null;
    const g = geoRef.current;
    const rect = el.getBoundingClientRect();
    const top = y - s.grab - rect.top;
    let startMin = g.start + Math.round(top / g.px) * g.step;
    startMin = Math.max(g.start, Math.min(g.end - Math.ceil(s.durationMin / g.step) * g.step, startMin));
    // Desplaza la grilla si el puntero se acerca al borde.
    const scroller = el.closest(".agenda, .wk-scroll") as HTMLElement | null;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (y < r.top + 36) scroller.scrollTop -= 12;
      else if (y > r.bottom - 36) scroller.scrollTop += 12;
    }
    return { col: el.dataset.dropCol!, startMin };
  };

  const end = useCallback(() => {
    const s = st.current;
    if (s?.timer) window.clearTimeout(s.timer);
    st.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = st.current;
      if (!s) return;
      const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!s.active) {
        if (s.type === "mouse") {
          if (dist > 5) { s.active = true; }
          else return;
        } else {
          if (dist > 10) end(); // el dedo se movió antes de la pulsación larga: es un desplazamiento
          return;
        }
      }
      s.target = targetAt(e.clientX, e.clientY, s);
      setDrag({ appt: s.appt, durationMin: s.durationMin, target: s.target });
    };
    const up = () => {
      const s = st.current;
      if (!s) return;
      if (s.active) {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 50);
        if (s.target) optsRef.current.onDrop(s.appt, s.target);
      }
      end();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && st.current?.active) end(); };
    // Mientras se arrastra con el dedo, la página no se desplaza.
    const touchMove = (e: TouchEvent) => { if (st.current?.active) e.preventDefault(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", key);
    document.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", key);
      document.removeEventListener("touchmove", touchMove);
    };
  }, [end]);

  /** Propiedades para el bloque de una cita. */
  const bind = (appt: any) => {
    const movable = optsRef.current.enabled && ["scheduled", "confirmed"].includes(appt.status);
    return {
      "data-movable": movable ? "true" : undefined,
      onPointerDown: (e: RPointerEvent<HTMLElement>) => {
        if (!movable || e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const durationMin = Math.round((Date.parse(appt.endsAt) - Date.parse(appt.startsAt)) / 60_000);
        const s = { appt, x: e.clientX, y: e.clientY, grab: e.clientY - rect.top, active: false, type: e.pointerType, timer: null as number | null, durationMin, target: null as DropTarget | null };
        if (e.pointerType !== "mouse") {
          s.timer = window.setTimeout(() => {
            if (st.current !== s) return;
            s.active = true;
            try { navigator.vibrate?.(15); } catch { /* sin vibración */ }
            s.target = targetAt(s.x, s.y, s);
            setDrag({ appt, durationMin, target: s.target });
          }, LONG_PRESS_MS);
        }
        st.current = s;
      },
      onContextMenu: (e: RMouseEvent) => { if (st.current) e.preventDefault(); },
    };
  };

  /** true si el clic viene justo después de soltar (no debe abrir la cita). */
  const clickSuppressed = () => suppressClick.current;
  return { drag, bind, clickSuppressed, cancel: end };
}
