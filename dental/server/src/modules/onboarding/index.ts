// Puesta en marcha de una clínica nueva: primeros pasos (calculados desde los datos), migración de
// datos desde el sistema anterior (B-006) y saldos iniciales. Una sola línea en app.ts.
import type { Route } from "../../lib/http.js";
import { checklistRoutes } from "./checklist.js";
import { importRoutes } from "./imports.js";
import { openingBalanceRoutes } from "./openingBalances.js";

export function onboardingRoutes(route: Route) {
  checklistRoutes(route);
  importRoutes(route);
  openingBalanceRoutes(route);
}
