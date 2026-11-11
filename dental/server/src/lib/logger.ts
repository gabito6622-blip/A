// Registro (logs) del servidor sin datos de pacientes ni secretos.
//
// Los logs viajan al proveedor de hosting y se conservan fuera de la base, sin RLS ni auditoría:
//  * de cada solicitud se registra el método y la ruta SIN la cadena de consulta (la búsqueda de
//    pacientes lleva nombres o CI en ?q=, y los enlaces de archivos su token en ?t=);
//  * los tokens de los enlaces públicos (confirmación, encuesta, llegada, presupuesto, verificación)
//    se reemplazan por [token], porque quien lee el log podría usarlos;
//  * de los errores de PostgreSQL no se registra `detail` ni `where` (incluyen valores de la fila,
//    p. ej. «Key (document_number)=(1234567) already exists»).
import type { FastifyServerOptions } from "fastify";

const API_TOKEN_PATH = /^(\/api\/public\/(?:confirmar|encuesta|llegada|llegada-recordatorio|budget-links|verify))\/[^/?#]+/;
const SPA_TOKEN_PATH = /^(\/(?:p\/presupuesto|c|e|llegada|verificar|restablecer))\/[^/?#]+/;

export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  const q = url.indexOf("?");
  let path = q >= 0 ? url.slice(0, q) : url;
  path = path.replace(API_TOKEN_PATH, "$1/[token]").replace(SPA_TOKEN_PATH, "$1/[token]");
  return q >= 0 ? `${path}?[omitido]` : path;
}

interface ErrLike { name?: string; message?: string; stack?: string; code?: unknown; constraint?: unknown; table?: unknown; statusCode?: unknown; routine?: unknown }

export function serializeError(err: ErrLike) {
  if (!err || typeof err !== "object") return err;
  return {
    type: err.name, message: err.message, stack: err.stack, code: err.code, statusCode: err.statusCode,
    constraint: err.constraint, table: err.table, routine: err.routine,
  };
}

export const loggerOptions: NonNullable<Exclude<FastifyServerOptions["logger"], boolean>> = {
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    req: (req: { method?: string; url?: string; ip?: string; hostname?: string }) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }),
    err: serializeError as never,
  },
};
