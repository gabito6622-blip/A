// Vista del dueño y del gerente: gastos, fichaje, rentabilidad, panel comparativo y exportaciones.
import type { Route } from "../../lib/http.js";
import { expenseRoutes } from "./expenses.js";
import { timeclockRoutes } from "./timeclock.js";
import { profitabilityRoutes } from "./profitability.js";
import { compareRoutes } from "./compare.js";
import { exportRoutes } from "./exports.js";

export function managementRoutes(route: Route) {
  expenseRoutes(route);
  timeclockRoutes(route);
  profitabilityRoutes(route);
  compareRoutes(route);
  exportRoutes(route);
}
