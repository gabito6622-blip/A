// Experiencia del paciente y su familia: relaciones familiares (R2-39), etiquetas, segmentos y
// campañas manuales (R2-38), encuesta de satisfacción (NPS) y llegada con QR (R2-31).
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import type { Messenger } from "../../lib/messaging.js";
import { messagingMessenger } from "../messaging/scheduler.js";
import { familyRoutes } from "./family.js";
import { segmentRoutes } from "./segments.js";
import { surveyRoutes } from "./surveys.js";
import { checkinRoutes } from "./checkin.js";

export function experienceRoutes(route: Route, cfg: Config, messenger: Messenger = messagingMessenger(cfg)) {
  familyRoutes(route);
  segmentRoutes(route, cfg, messenger);
  surveyRoutes(route, cfg);
  checkinRoutes(route, cfg);
}
