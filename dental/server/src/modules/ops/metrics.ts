// Métricas en memoria por PATRÓN de ruta («GET /api/patients/:id», nunca la URL con identificadores):
// cantidad, errores 5xx, solicitudes lentas y p50/p95 aproximados por intervalos, en ventanas de una
// hora durante 24 h. Son por instancia y se pierden al reiniciar (el panel lo dice).
// Las solicitudes de más de OPS_SLOW_MS se informan al log con el patrón, el estado y la duración:
// sin URL, consulta, identificadores ni usuario.

/** Límites superiores de los intervalos de duración (ms). */
export const LATENCY_BOUNDS = [5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10_000, 30_000, Infinity];
const HOUR = 3600_000;
const MINUTE = 60_000;

interface Bucket { count: number; e5xx: number; slow: number; hist: Uint32Array }
const newBucket = (): Bucket => ({ count: 0, e5xx: 0, slow: 0, hist: new Uint32Array(LATENCY_BOUNDS.length) });

export interface RouteSummary { route: string; count: number; errors5xx: number; slow: number; p50Ms: number; p95Ms: number }
export interface SlowEntry { route: string; statusCode: number; ms: number }

/** Etiqueta segura de la ruta: patrón registrado en Fastify (sin valores) o un grupo genérico. */
export function routeLabel(method: string, pattern: string | undefined, url: string): string {
  if (pattern && pattern.startsWith("/api/")) return `${method} ${pattern}`;
  if (url.startsWith("/api/")) return `${method} (ruta inexistente)`;
  return `${method} (interfaz)`;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  if (!total) return 0;
  const target = Math.ceil(total * p);
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i]!;
    if (acc >= target) return LATENCY_BOUNDS[i] === Infinity ? LATENCY_BOUNDS[i - 1]! : LATENCY_BOUNDS[i]!;
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 2]!;
}

export class OpsMetrics {
  readonly startedAt: Date;
  slowMs: number;
  /** Destino de las solicitudes lentas (en la app: req.log.warn). */
  onSlow: (e: SlowEntry) => void = () => {};
  private readonly routes = new Map<string, Map<number, Bucket>>();
  private readonly minutes = new Map<number, { count: number; e5xx: number; routes: Map<string, number> }>();

  constructor(opts: { slowMs?: number; now?: Date } = {}) {
    this.slowMs = opts.slowMs ?? 1000;
    this.startedAt = opts.now ?? new Date();
  }

  record(route: string, statusCode: number, ms: number, now = Date.now()) {
    const hour = Math.floor(now / HOUR);
    let byHour = this.routes.get(route);
    if (!byHour) { byHour = new Map(); this.routes.set(route, byHour); }
    let b = byHour.get(hour);
    if (!b) {
      b = newBucket();
      byHour.set(hour, b);
      for (const h of byHour.keys()) if (h < hour - 24) byHour.delete(h);
    }
    const is5xx = statusCode >= 500;
    const slow = ms > this.slowMs;
    b.count++;
    if (is5xx) b.e5xx++;
    if (slow) b.slow++;
    let i = LATENCY_BOUNDS.findIndex((x) => ms <= x);
    if (i < 0) i = LATENCY_BOUNDS.length - 1;
    b.hist[i]!++;

    const minute = Math.floor(now / MINUTE);
    let m = this.minutes.get(minute);
    if (!m) {
      m = { count: 0, e5xx: 0, routes: new Map() };
      this.minutes.set(minute, m);
      for (const k of this.minutes.keys()) if (k < minute - 24 * 60) this.minutes.delete(k);
    }
    m.count++;
    if (is5xx) { m.e5xx++; m.routes.set(route, (m.routes.get(route) ?? 0) + 1); }
    if (slow) this.onSlow({ route, statusCode, ms: Math.round(ms) });
  }

  /** Resumen por ruta de las últimas `hours` horas. */
  summary(now = Date.now(), hours = 24): RouteSummary[] {
    const from = Math.floor(now / HOUR) - hours + 1;
    const out: RouteSummary[] = [];
    for (const [route, byHour] of this.routes) {
      const hist = new Uint32Array(LATENCY_BOUNDS.length);
      let count = 0, e5xx = 0, slow = 0;
      for (const [h, b] of byHour) {
        if (h < from) continue;
        count += b.count; e5xx += b.e5xx; slow += b.slow;
        for (let i = 0; i < hist.length; i++) hist[i]! += b.hist[i]!;
      }
      if (count) out.push({ route, count, errors5xx: e5xx, slow, p50Ms: percentile(hist, count, 0.5), p95Ms: percentile(hist, count, 0.95) });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  /** Errores 5xx en los últimos `minutes` minutos (para la alerta de pico) y rutas más afectadas. */
  errors5xx(minutes: number, now = Date.now()): { total: number; requests: number; top: { route: string; count: number }[] } {
    const from = Math.floor(now / MINUTE) - minutes + 1;
    let total = 0, requests = 0;
    const by = new Map<string, number>();
    for (const [k, m] of this.minutes) {
      if (k < from) continue;
      total += m.e5xx; requests += m.count;
      for (const [r, n] of m.routes) by.set(r, (by.get(r) ?? 0) + n);
    }
    return { total, requests, top: [...by].map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count).slice(0, 5) };
  }
}
