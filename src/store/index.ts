// Gabriel Store: núcleo de dominio (inventario, ventas, saldo, portal, códigos, WhatsApp, estadísticas).
// Persistencia en memoria con transacciones; ver docs/IMPLEMENTATION_PLAN.md para el adaptador PostgreSQL.
import type { Actor, Cents, Id, State } from "./types.js";
import { Engine, type EngineOptions } from "./engine.js";
import { authorize } from "./auth.js";
import * as catalog from "./catalog.js";
import * as inventory from "./inventory.js";
import * as wallet from "./wallet.js";
import * as orders from "./orders.js";
import * as portal from "./portal.js";
import * as codes from "./codes.js";
import * as notify from "./notify.js";
import * as stats from "./stats.js";

export * from "./types.js";
export { DomainError, type ErrorCode } from "./errors.js";
export { can, authorize, type Permission } from "./auth.js";
export { Engine, emptyState, systemClock, type Clock, type EngineOptions } from "./engine.js";
export { DAY, HOUR, MINUTE } from "./time.js";
export type { WhatsAppTransport } from "./notify.js";
export { render as renderTemplate } from "./notify.js";

type Rest<F> = F extends (e: Engine, ...args: infer A) => infer R ? (...args: A) => R : never;
const bind = <F extends (e: Engine, ...a: never[]) => unknown>(e: Engine, f: F) => ((...a: unknown[]) => (f as unknown as (...x: unknown[]) => unknown)(e, ...a)) as Rest<F>;

export function createStore(opts: EngineOptions = {}) {
  const e = new Engine(opts);
  return {
    engine: e,
    /** Copia del estado para persistir. */
    snapshot: (): State => e.snapshot(),
    catalog: {
      upsertProduct: bind(e, catalog.upsertProduct),
      upsertPriceGroup: bind(e, catalog.upsertPriceGroup),
      upsertSupplier: bind(e, catalog.upsertSupplier),
      createCustomer: bind(e, catalog.createCustomer),
      setWhatsappConsent: bind(e, catalog.setWhatsappConsent),
      priceFor: bind(e, catalog.priceFor),
      publicCatalog: bind(e, catalog.publicCatalog),
    },
    inventory: {
      addAccount: bind(e, inventory.addAccount),
      addAccountsBulk: bind(e, inventory.addAccountsBulk),
      setSlotStatus: bind(e, inventory.setSlotStatus),
      listAccounts: bind(e, inventory.listAccounts),
      stock: () => inventory.stockByProduct(e),
    },
    orders: {
      create: bind(e, orders.createOrder),
      submitEvidence: bind(e, orders.submitEvidence),
      approvePayment: bind(e, orders.approvePayment),
      rejectPayment: bind(e, orders.rejectPayment),
      cancel: bind(e, orders.cancelOrder),
      expireReservations: bind(e, orders.expireReservations),
      renew: bind(e, orders.renew),
      renewMany: bind(e, orders.renewMany),
      replace: bind(e, orders.replaceAssignment),
      replaceAccount: bind(e, orders.replaceAccount),
      closeExpired: bind(e, orders.closeExpired),
      queueExpiryReminders: bind(e, orders.queueExpiryReminders),
      requestTopup: bind(e, orders.requestTopup),
    },
    wallet: {
      balance: (customerId: Id): Cents => wallet.balance(e, customerId),
      adjust: bind(e, wallet.adjust),
      history: bind(e, wallet.history),
    },
    portal: {
      services: bind(e, portal.myServices),
      orders: bind(e, portal.myOrders),
      balance: bind(e, portal.myBalance),
      customers: bind(e, portal.myCustomers),
      codes: bind(e, codes.codesFor),
    },
    codes: {
      configureMailbox: bind(e, codes.configureMailbox),
      ingest: bind(e, codes.ingest),
    },
    notify: {
      outbox: (actor: Actor) => {
        authorize(actor, "notify.flush");
        return structuredClone(e.s.outbox);
      },
      flush: bind(e, notify.flush),
    },
    stats: {
      summary: bind(e, stats.summary),
      suppliers: bind(e, stats.supplierReport),
      audit: bind(e, stats.auditLog),
    },
  };
}

export type GabrielStore = ReturnType<typeof createStore>;
