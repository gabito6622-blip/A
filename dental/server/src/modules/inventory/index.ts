// Inventario por sucursal y compras (B-062 / B-047 / B-024). Ver migración 0010_inventory.sql.
import type { Route } from "../../lib/http.js";
import { consumptionReportRoutes } from "./consumptionReport.js";
import { inventoryCatalogRoutes } from "./catalog.js";
import { inventoryMovementRoutes } from "./movements.js";
import { inventoryCountRoutes } from "./counts.js";
import { inventoryPurchasingRoutes } from "./purchasing.js";

export { consumeForTreatment, materialCostForTreatment } from "./core.js";

export function inventoryRoutes(route: Route) {
  consumptionReportRoutes(route);
  inventoryCatalogRoutes(route);
  inventoryMovementRoutes(route);
  inventoryCountRoutes(route);
  inventoryPurchasingRoutes(route);
}
