// Documentación de la API (/api/docs y /api/docs/json) — B-092.
// En producción solo la ve un administrador de plataforma con sesión completa (2 pasos incluidos);
// a cualquier otra persona se le responde 404, como si la ruta no existiera (no revela que hay
// documentación ni cuántas rutas tiene la API). Fuera de producción sigue pública: la usan las
// pruebas automáticas de permisos (tests/route-guard.test.ts) y quien desarrolla.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "./db.js";
import { SESSION_COOKIE, resolveSession } from "./session.js";

export const DOCS_NOT_FOUND = { error: { code: "not_found", message: "Ruta inexistente" } };

/** Opciones extra para @fastify/swagger-ui (uiHooks) según el entorno. */
export function docsAccess(cfg: Pick<Config, "isProduction">, db: Db) {
  if (!cfg.isProduction) return {};
  return {
    uiHooks: {
      onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
        const auth = await resolveSession(db, req, req.cookies?.[SESSION_COOKIE]);
        if (!auth || auth.mfaPending || !auth.isPlatformAdmin) {
          reply.code(404).header("cache-control", "no-store").send(DOCS_NOT_FOUND);
          return reply;
        }
        reply.header("cache-control", "no-store");
      },
    },
  };
}
