// Mensajes automáticos a pacientes (B-048 / B-060): plantillas, reglas, programador, enlace de
// confirmación, baja y adaptador de WhatsApp Cloud API sobre la bandeja de lib/messaging.ts.
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import type { Messenger } from "../../lib/messaging.js";
import { messagingMessenger } from "./scheduler.js";
import { messagingPublicRoutes, WEBHOOK_PATH } from "./public.js";
import { messagingStaffRoutes } from "./routes.js";

export { runSchedulerOnce, runForClinic, startMessagingScheduler } from "./scheduler.js";

export function messagingRoutes(route: Route, cfg: Config, app: FastifyInstance, messenger: Messenger = messagingMessenger(cfg)) {
  // La firma del webhook se calcula sobre el cuerpo CRUDO: se guarda solo para esa ruta.
  app.addHook("preParsing", async (req, _reply, payload) => {
    if (req.method !== "POST" || !req.url.startsWith(WEBHOOK_PATH)) return payload;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const ch of payload) {
      const b = Buffer.isBuffer(ch) ? ch : Buffer.from(ch);
      size += b.length;
      if (size > 1024 * 1024) throw Object.assign(new Error("Cuerpo demasiado grande"), { statusCode: 413 });
      chunks.push(b);
    }
    const raw = Buffer.concat(chunks);
    (req as unknown as { rawBody: Buffer }).rawBody = raw;
    const out = Readable.from([raw]) as Readable & { receivedEncodedLength?: number };
    out.receivedEncodedLength = raw.length;
    return out;
  });
  messagingPublicRoutes(route, cfg, messenger);
  messagingStaffRoutes(route, cfg, messenger);
}
