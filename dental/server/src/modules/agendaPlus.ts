// Registro de las rutas de productividad de la agenda y de la línea de tiempo del paciente
// (tipos de cita, vista semanal, citas recurrentes, historial). Una sola línea en app.ts.
import type { Route } from "../lib/http.js";
import { appointmentTypeRoutes } from "./appointmentTypes.js";
import { appointmentSeriesRoutes } from "./agendaSeries.js";
import { agendaViewRoutes } from "./agendaViews.js";
import { patientTimelineRoutes } from "./patientTimeline.js";

export function agendaPlusRoutes(route: Route) {
  appointmentTypeRoutes(route);
  appointmentSeriesRoutes(route);
  agendaViewRoutes(route);
  patientTimelineRoutes(route);
}
