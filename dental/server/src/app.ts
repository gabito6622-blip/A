import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./lib/db.js";
import { makeRouter } from "./lib/http.js";
import { AppError, fromPgError } from "./lib/errors.js";
import { SESSION_COOKIE, resolveSession } from "./lib/session.js";
import { authRoutes } from "./modules/auth.js";
import { clinicRoutes } from "./modules/clinic.js";
import { patientRoutes } from "./modules/patients.js";
import { agendaRoutes } from "./modules/agenda.js";
import { clinicalRoutes } from "./modules/clinical.js";
import { billingRoutes } from "./modules/billing.js";
import { reportRoutes } from "./modules/reports.js";
import { platformRoutes } from "./modules/platform.js";
import { assistantRoutes } from "./modules/assistant.js";
import { consentRoutes } from "./modules/consents.js";
import { biosafetyRoutes } from "./modules/biosafety.js";
import { myDayRoutes } from "./modules/myday.js";
import { recallRoutes } from "./modules/recalls.js";
import { visitQualityRoutes } from "./modules/visitQuality.js";
import { perioRoutes } from "./modules/perio.js";
import { cashSessionRoutes } from "./modules/cashSessions.js";
import { feeRoutes } from "./modules/fees.js";
import { budgetV2Routes } from "./modules/budgets-v2.js";
import { portalRoutes } from "./modules/portal/index.js";
import { labRoutes } from "./modules/lab.js";
import { agendaPlusRoutes } from "./modules/agendaPlus.js";
import { createMailer, type Mailer } from "./lib/mailer.js";

export async function buildApp(cfg: Config, db: Db, opts: { logger?: boolean; mailer?: Mailer } = {}): Promise<FastifyInstance> {
  const mailer = opts.mailer ?? createMailer(cfg);
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: cfg.trustProxy,
    bodyLimit: 15 * 1024 * 1024,
    // Validación con zod en cada ruta; el esquema JSON solo documenta (OpenAPI).
    ajv: { customOptions: { strict: false } },
  });
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: cfg.disableRateLimit ? 100000 : 600,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/api/health",
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "API Plataforma Odontológica", version: "0.1.0", description: "API multiempresa. Autenticación por cookie de sesión HttpOnly + cabecera X-CSRF-Token en operaciones que modifican datos." },
      components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: SESSION_COOKIE } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs", staticCSP: false });

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/") || req.url === "/api/health" || req.url.startsWith("/api/docs")) return;
    req.auth = await resolveSession(db, req, req.cookies[SESSION_COOKIE]);
  });
  // Las respuestas de la API nunca se guardan en cachés (datos sensibles).
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/") && !req.url.startsWith("/api/docs")) reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((err, req, reply) => {
    let e: AppError | null = null;
    if (err instanceof AppError) e = err;
    else if (err instanceof ZodError) {
      const first = err.issues[0];
      e = new AppError(400, "validation", first ? `${first.path.join(".") || "datos"}: ${first.message}` : "Datos inválidos", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    } else if ((err as { statusCode?: number }).statusCode === 429) {
      e = new AppError(429, "rate_limited", "Demasiadas solicitudes. Espera un momento.");
    } else if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      e = new AppError((err as { statusCode: number }).statusCode, "bad_request", (err as Error).message);
    } else e = fromPgError(err);
    if (!e) {
      req.log.error({ err }, "error no controlado");
      e = new AppError(500, "internal", "Ocurrió un error inesperado. Ya quedó registrado.");
    }
    reply.code(e.status).send({ error: { code: e.code, message: e.message, details: e.details } });
  });

  app.get("/api/health", { schema: { hide: true } }, async () => {
    await db.appPool.query("SELECT 1");
    return { ok: true };
  });

  const route = makeRouter(app, db);
  authRoutes(route, cfg, mailer);
  clinicRoutes(route);
  patientRoutes(route);
  agendaRoutes(route);
  clinicalRoutes(route);
  billingRoutes(route);
  reportRoutes(route);
  platformRoutes(route, cfg);
  assistantRoutes(route);
  consentRoutes(route);
  biosafetyRoutes(route);
  myDayRoutes(route);
  recallRoutes(route);
  visitQualityRoutes(route);
  perioRoutes(route);
  cashSessionRoutes(route);
  feeRoutes(route);
  budgetV2Routes(route, cfg);
  portalRoutes(route, cfg);
  labRoutes(route);
  agendaPlusRoutes(route);

  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    await app.register(fastifyStatic, { root: resolve(cfg.staticDir), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "not_found", message: "Ruta inexistente" } });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
