// Reserva online y portal del paciente (B-046) + bandeja de mensajes salientes (WA-01).
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import { createMessenger, type Messenger } from "../../lib/messaging.js";
import { portalAdminRoutes } from "./admin.js";
import { portalPublicRoutes } from "./public.js";

export function portalRoutes(route: Route, cfg: Config, messenger: Messenger = createMessenger(cfg)) {
  portalPublicRoutes(route, cfg, messenger);
  portalAdminRoutes(route, cfg, messenger);
}
