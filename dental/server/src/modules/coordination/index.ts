// Coordinación del equipo de la clínica: tareas internas, registro de llamadas, diario de actividad
// y tarjetas proactivas del Inicio (R2-36, R2-37, R2-42, R2-44; B-019 y B-065). Una sola línea en app.ts.
import type { Route } from "../../lib/http.js";
import { taskRoutes } from "./tasks.js";
import { callRoutes } from "./calls.js";
import { activityRoutes } from "./activity.js";
import { homeRoutes } from "./home.js";
import { taskCountRoutes } from "./taskCount.js";

export function coordinationRoutes(route: Route) {
  taskCountRoutes(route);
  taskRoutes(route);
  callRoutes(route);
  activityRoutes(route);
  homeRoutes(route);
}
