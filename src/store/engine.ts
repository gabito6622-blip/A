// Núcleo: estado, transacciones con rollback, ids, auditoría e idempotencia.
//
// Cada operación de negocio corre dentro de `tx()`: si algo falla a mitad de camino
// se restaura el estado completo (todo o nada). En este adaptador en memoria la
// atomicidad es real porque JS ejecuta cada `tx` sin interrupciones. Un adaptador
// PostgreSQL debe usar una transacción SERIALIZABLE o `SELECT ... FOR UPDATE SKIP LOCKED`
// sobre los slots para conservar la misma garantía con varios procesos.
import type { Actor, AuditEvent, Id, State } from "./types.js";
import { DomainError } from "./errors.js";

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export { DAY, MINUTE } from "./time.js";

export interface EngineOptions {
  clock?: Clock;
  /** Minutos que se reserva el stock esperando el pago (por defecto 30). */
  reservationMinutes?: number;
  /** Horas que se mantiene la reserva mientras se revisa un comprobante (por defecto 24). */
  reviewHoldHours?: number;
  /** Minutos que un código de verificación es visible para el cliente (por defecto 30). */
  codeVisibleMinutes?: number;
  initialState?: State;
  /**
   * Se llama al confirmar cada transacción externa, con el estado nuevo. Si lanza un error
   * (p. ej. el disco falló), la transacción se deshace y el error llega a quien llamó:
   * así nunca se responde "ok" por algo que no quedó guardado.
   */
  onCommit?: (state: State) => void;
}

export function emptyState(): State {
  return {
    products: {},
    priceGroups: { final: { id: "final", name: "Cliente final", prices: {} }, revendedor: { id: "revendedor", name: "Revendedor", prices: {} } },
    suppliers: {},
    accounts: {},
    slots: {},
    customers: {},
    orders: {},
    assignments: {},
    ledger: [],
    audit: [],
    outbox: [],
    mailboxes: {},
    resellerApps: {},
    codes: [],
    idempotency: {},
    staff: {},
    chats: {},
    settings: { storeName: "Gabriel Store", whatsapp: "", currency: "BOB" },
    expenses: [],
    coupons: {},
    seq: 0,
  };
}

/** Campos que nunca se escriben en auditoría. */
const SECRET_KEYS = /pass|password|secret|pin|token/i;

export class Engine {
  private _s: State;
  readonly clock: Clock;
  readonly opts: Required<Omit<EngineOptions, "clock" | "initialState" | "onCommit">>;
  private readonly onCommit?: (state: State) => void;
  private depth = 0;

  constructor(o: EngineOptions = {}) {
    // Estados guardados con versiones anteriores reciben las tablas nuevas vacías.
    this._s = o.initialState ? { ...emptyState(), ...structuredClone(o.initialState) } : emptyState();
    this.onCommit = o.onCommit;
    this.clock = o.clock ?? systemClock;
    this.opts = {
      reservationMinutes: o.reservationMinutes ?? 30,
      reviewHoldHours: o.reviewHoldHours ?? 24,
      codeVisibleMinutes: o.codeVisibleMinutes ?? 30,
    };
  }

  /** Estado actual. No guardes la referencia entre llamadas: un rollback la reemplaza. */
  get s(): State {
    return this._s;
  }

  now(): number {
    return this.clock.now();
  }

  /** Copia profunda del estado, para persistir o inspeccionar. */
  snapshot(): State {
    return structuredClone(this._s);
  }

  /**
   * Punto de restauración dentro de una transacción: si `fn` falla, se deshace SOLO lo que hizo `fn`
   * y la transacción de afuera sigue. Sirve para procesar filas de a una (importaciones).
   */
  savepoint<T>(fn: () => T): T {
    const backup = structuredClone(this._s);
    try {
      return fn();
    } catch (e) {
      this._s = backup;
      throw e;
    }
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn(); // anidada: la externa ya protege
    const backup = structuredClone(this._s);
    this.depth++;
    try {
      const out = fn();
      this.onCommit?.(this._s);
      return out;
    } catch (e) {
      this._s = backup;
      throw e;
    } finally {
      this.depth--;
    }
  }

  /** Ejecuta `fn` una sola vez por clave; repeticiones devuelven el mismo resultado. */
  idempotent<T>(key: string | undefined, fn: () => T): T {
    if (!key) return fn();
    if (key in this._s.idempotency) return structuredClone(this._s.idempotency[key]) as T;
    const out = fn();
    this._s.idempotency[key] = structuredClone(out);
    return out;
  }

  id(prefix: string): Id {
    this._s.seq += 1;
    return `${prefix}_${this._s.seq.toString().padStart(5, "0")}`;
  }

  audit(actor: Actor, action: string, entity: string, entityId: Id, data?: Record<string, unknown>): void {
    const clean = data ? Object.fromEntries(Object.entries(data).filter(([k]) => !SECRET_KEYS.test(k))) : undefined;
    const ev: AuditEvent = { id: this.id("aud"), at: this.now(), actorId: actor.id, role: actor.role, action, entity, entityId, data: clean };
    this._s.audit.push(ev);
  }

  get<K extends keyof State>(table: K, id: Id): State[K] extends Record<Id, infer V> ? V : never {
    const t = this._s[table] as unknown as Record<Id, unknown>;
    const v = t[id];
    if (!v) throw new DomainError("NOT_FOUND", `${String(table)} ${id} no existe`);
    return v as never;
  }
}
