// Dinero de terceros y conciliación (R2-32, B-021): convenios, pagador distinto, pendiente de
// facturar (SIAT futuro) y conciliación bancaria por extracto.
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import { agreementCrudRoutes } from "./routes.js";
import { payerRoutes } from "./payers.js";
import { invoicingRoutes } from "./invoicing.js";
import { reconciliationRoutes } from "./reconciliation.js";

export function agreementRoutes(route: Route, cfg: Config) {
  agreementCrudRoutes(route);
  payerRoutes(route, cfg);
  invoicingRoutes(route);
  reconciliationRoutes(route);
}
