// Definición de rutas: validación con zod, autenticación, permisos, CSRF y transacción
// con contexto de clínica en un solo lugar, para que ningún endpoint lo olvide.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db, Client } from "./db.js";
import { withTenant } from "./db.js";
import { AppError, forbidden } from "./errors.js";
import type { AuthCtx, Permission } from "./rbac.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthCtx | null;
  }
}

type Access =
  | "public"       // sin sesión (login, salud)
  | "session"      // sesión válida, sin requerir clínica activa
  | "clinic"       // sesión + clínica activa con membresía vigente (por defecto)
  | "platform";    // superadministrador SaaS

export interface Ctx<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  auth: AuthCtx;
  req: FastifyRequest;
  reply: FastifyReply;
  /** Conexión dentro de una transacción con app.clinic_id/app.user_id fijados (RLS activo). */
  c: Client;
  /** Acceso al pool (solo para rutas noTx, que abren sus propias transacciones cortas). */
  db: Db;
}

export interface RouteDef<BS extends z.ZodType, QS extends z.ZodType, PS extends z.ZodType> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  summary: string;
  tags: string[];
  access?: Access;
  perm?: Permission;
  body?: BS;
  query?: QS;
  params?: PS;
  /** Límite de solicitudes específico de la ruta. */
  limit?: { max: number; timeWindow: string };
  /** Respuesta binaria/archivo: el handler escribe en reply. */
  raw?: boolean;
  /** No abrir transacción (p. ej. llamadas largas a servicios externos). c no estará disponible. */
  noTx?: boolean;
  handler: (ctx: Ctx<z.infer<BS>, z.infer<QS>, z.infer<PS>>) => Promise<unknown>;
}

const toSchema = (s: z.ZodType | undefined) => {
  if (!s) return undefined;
  try {
    return z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "any", io: "input" }) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function makeRouter(app: FastifyInstance, db: Db) {
  return function route<
    BS extends z.ZodType = z.ZodUnknown,
    QS extends z.ZodType = z.ZodUnknown,
    PS extends z.ZodType = z.ZodUnknown,
  >(def: RouteDef<BS, QS, PS>): void {
    const access = def.access ?? "clinic";
    app.route({
      method: def.method,
      url: def.url,
      ...(def.limit ? { config: { rateLimit: def.limit } } : {}),
      schema: Object.fromEntries(
        Object.entries({
          summary: def.summary,
          tags: def.tags,
          body: toSchema(def.body),
          querystring: toSchema(def.query),
          params: toSchema(def.params),
          security: access === "public" ? undefined : [{ sessionCookie: [] }],
        }).filter(([, v]) => v !== undefined),
      ),
      handler: async (req, reply) => {
        const auth = req.auth;
        if (access !== "public") {
          if (!auth) throw new AppError(401, "unauthenticated", "Inicia sesión para continuar");
          if (MUTATING.has(def.method) && req.headers["x-csrf-token"] !== auth.csrfToken) {
            throw new AppError(403, "csrf", "Token de seguridad inválido. Recarga la página.");
          }
          if (access === "clinic" && (!auth.clinicId || !auth.membership)) {
            throw new AppError(409, "no_clinic", "Selecciona una clínica");
          }
          if (access === "platform" && !auth.isPlatformAdmin) throw forbidden();
          if (def.perm && !auth.permissions.has(def.perm)) throw forbidden();
        }
        const body = def.body ? def.body.parse(req.body ?? {}) : req.body;
        const query = def.query ? def.query.parse(req.query ?? {}) : req.query;
        const params = def.params ? def.params.parse(req.params ?? {}) : req.params;
        const pool = access === "platform" ? db.adminPool : db.appPool;
        const mk = (c: Client | null) => ({ body, query, params, auth: auth as AuthCtx, req, reply, c, db }) as Ctx<z.infer<BS>, z.infer<QS>, z.infer<PS>>;
        const result = def.noTx
          ? await def.handler(mk(null))
          : await withTenant(
              pool,
              { clinicId: access === "platform" ? null : auth?.clinicId ?? null, userId: auth?.userId ?? null },
              (c) => def.handler(mk(c)),
            );
        if (def.raw) return reply;
        if (result === undefined) return reply.code(204).send();
        return result;
      },
    });
  };
}

export type Route = ReturnType<typeof makeRouter>;

// Esquemas reutilizables
export const zId = z.uuid({ message: "Identificador inválido" });
export const zIdParams = z.object({ id: zId });
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");
export const zMoney = z.number().int("Monto en centavos (entero)").min(0).max(10_000_000_00);
export const zText = (max = 500) => z.string().trim().max(max);
export const zOptText = (max = 500) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
