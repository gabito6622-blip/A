// Tareas automáticas que no se frenan entre sí (revisión de 3 meses, 14/11/2026). Antes, si una tarea de `runJobs`
// fallaba (p. ej. un aviso bloqueado por una clave «2027» que aparecía en una fecha), las de después —cortar vencidos,
// el RESPALDO, los alquileres— no corrían, y nadie se enteraba. Ahora cada una va por separado; si una falla, se anota
// en la Auditoría («tarea automática falló») y se avisa al dueño, como mucho una vez por hora por tarea.

export interface TaskRunner {
  /** Corre `fn`; si falla devuelve undefined, lo anota y avisa (una vez por hora por tarea). */
  run<T>(name: string, fn: () => T): T | undefined;
  /** Tareas que fallaron en esta vuelta (se vacía con `take`). */
  take(): string[];
}

export const FAIL_NOTICE_EVERY = 3_600_000;

export function createTaskRunner(d: { now: () => number; log: (m: string) => void; onFail: (name: string, error: string) => void }): TaskRunner {
  const lastNotice = new Map<string, number>();
  let failed: string[] = [];
  return {
    run(name, fn) {
      try { return fn(); } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        failed.push(name);
        d.log(`tarea «${name}» falló: ${msg}`);
        const t = d.now(), last = lastNotice.get(name);
        if (last === undefined || t - last >= FAIL_NOTICE_EVERY) {
          lastNotice.set(name, t);
          try { d.onFail(name, msg.slice(0, 200)); } catch (e) { d.log(`aviso de tarea fallida falló: ${(e as Error).message}`); }
        }
        return undefined;
      }
    },
    take() { const f = failed; failed = []; return f; },
  };
}
