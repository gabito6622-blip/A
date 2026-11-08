// Gabriel Store: núcleo de dominio (inventario, ventas, saldo, portal, códigos, WhatsApp, estadísticas).
// Estado en memoria con transacciones; `onCommit` lo guarda (el servidor usa SQLite: src/server/db.ts).
import type { Actor, Cents, Id, State } from "./types.js";
import { Engine, type EngineOptions } from "./engine.js";
import { authorize } from "./auth.js";
import * as catalog from "./catalog.js";
import * as inventory from "./inventory.js";
import * as wallet from "./wallet.js";
import * as orders from "./orders.js";
import * as portal from "./portal.js";
import * as rshop from "./resellerShop.js";
import * as codes from "./codes.js";
import * as notify from "./notify.js";
import * as stats from "./stats.js";
import * as admin from "./admin.js";
import * as importer from "./importer.js";
import * as chats from "./chats.js";

export * from "./types.js";
export { DomainError, type ErrorCode } from "./errors.js";
export { can, authorize, type Permission } from "./auth.js";
export { Engine, emptyState, systemClock, type Clock, type EngineOptions } from "./engine.js";
export { DAY, HOUR, MINUTE } from "./time.js";
export type { WhatsAppTransport } from "./notify.js";
export type { PublicStaff } from "./admin.js";
export type { ServiceRow, ServiceResult } from "./importer.js";
export { render as renderTemplate } from "./notify.js";
export { normalizePhone } from "./catalog.js";
export { TEMPLATES, templateParamOrder, metaTemplateBody } from "./notify.js";
export { WINDOW_MS } from "./chats.js";

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
      updateCustomer: bind(e, catalog.updateCustomer),
      setWhatsappConsent: bind(e, catalog.setWhatsappConsent),
      priceFor: bind(e, catalog.priceFor),
      publicCatalog: bind(e, catalog.publicCatalog),
      updateSettings: bind(e, catalog.updateSettings),
      setProductImage: bind(e, catalog.setProductImage),
      setCustomersKind: bind(e, catalog.setCustomersKind),
      findCustomerByPhone: bind(e, catalog.findCustomerByPhone),
      selfRegister: bind(e, catalog.selfRegister),
      registerWithEmail: bind(e, catalog.registerWithEmail),
      canActFor: bind(e, catalog.canActFor),
    },
    inventory: {
      addAccount: bind(e, inventory.addAccount),
      addAccountsBulk: bind(e, inventory.addAccountsBulk),
      setSlotStatus: bind(e, inventory.setSlotStatus),
      updateAccount: bind(e, inventory.updateAccount),
      updateSlot: bind(e, inventory.updateSlot),
      addSlot: bind(e, inventory.addSlot),
      importServices: bind(e, importer.importServices),
      listAccounts: bind(e, inventory.listAccounts),
      stock: () => inventory.stockByProduct(e),
    },
    orders: {
      create: bind(e, orders.createOrder),
      comboDiscount: bind(e, orders.comboDiscount),
      submitEvidence: bind(e, orders.submitEvidence),
      approvePayment: bind(e, orders.approvePayment),
      rejectPayment: bind(e, orders.rejectPayment),
      cancel: bind(e, orders.cancelOrder),
      expireReservations: bind(e, orders.expireReservations),
      renew: bind(e, orders.renew),
      renewMany: bind(e, orders.renewMany),
      replace: bind(e, orders.replaceAssignment),
      replaceAccount: bind(e, orders.replaceAccount),
      transfer: bind(e, orders.transferAssignment),
      releaseSlot: bind(e, orders.releaseSlot),
      closeExpired: bind(e, orders.closeExpired),
      queueExpiryReminders: bind(e, orders.queueExpiryReminders),
      autoReminders: bind(e, orders.autoReminders),
      setExpiry: bind(e, orders.setCustomerExpiry),
      setControl: bind(e, orders.setRentalControl),
      reminderSettings: () => orders.reminderSettings(e),
      updateReminderSettings: bind(e, orders.updateReminderSettings),
      supplierExpiryAlerts: bind(e, orders.supplierExpiryAlerts),
      staffAlerts: () => notify.staffAlertSettings(e),
      updateStaffAlerts: bind(e, orders.updateStaffAlerts),
      requestTopup: bind(e, orders.requestTopup),
    },
    wallet: {
      balance: (customerId: Id): Cents => wallet.balance(e, customerId),
      adjust: bind(e, wallet.adjust),
      history: bind(e, wallet.history),
    },
    shops: {
      mine: bind(e, rshop.myShop),
      update: bind(e, rshop.updateMyShop),
      setImage: bind(e, rshop.setMyShopImage),
      setBlocked: bind(e, rshop.setShopBlocked),
      list: bind(e, rshop.listShops),
      setupFor: bind(e, rshop.setupShopFor),
      chargeRents: bind(e, rshop.chargeShopRents),
      payRent: bind(e, rshop.payMyShopRent),
      apply: (input: { name: unknown; phone: unknown; note?: unknown }) => rshop.applyReseller(e, input),
      apps: bind(e, rshop.listApps),
      approve: bind(e, rshop.approveApp),
      reject: bind(e, rshop.rejectApp),
      resellers: bind(e, rshop.resellersOverview),
      program: () => rshop.programInfo(e),
      setFeatured: bind(e, rshop.setShopFeatured),
      setTestimonials: bind(e, rshop.setTestimonials),
      public: (slug: string, viewer?: Actor) => rshop.publicShop(e, slug, viewer),
      image: (slug: string, kind: "logo" | "banner", viewer?: Actor) => rshop.shopImage(e, slug, kind, viewer),
    },
    portal: {
      services: bind(e, portal.myServices),
      orders: bind(e, portal.myOrders),
      balance: bind(e, portal.myBalance),
      customers: bind(e, portal.myCustomers),
      updateClient: bind(e, portal.updateMyClient),
      setPrices: bind(e, portal.setMyPrices),
      priceList: bind(e, portal.myPriceList),
      codes: bind(e, codes.codesFor),
    },
    codes: {
      configureMailbox: bind(e, codes.configureMailbox),
      ingest: bind(e, codes.ingest),
      remove: bind(e, codes.removeMailbox),
      list: bind(e, codes.listMailboxes),
      setStatus: bind(e, codes.setMailboxStatus),
      recent: bind(e, codes.recentCodes),
      accountEmails: () => codes.accountEmails(e),
      setLink: bind(e, codes.setCodeLink),
      linkOwner: (token: string) => codes.codeLinkOwner(e, token),
      of: (customerId: string) => codes.codesOf(e, customerId),
    },
    notify: {
      outbox: (actor: Actor) => {
        authorize(actor, "notify.flush");
        return structuredClone(e.s.outbox);
      },
      flush: bind(e, notify.flush),
      markSentManually: bind(e, notify.markSentManually),
      markSendResult: bind(e, notify.markSendResult),
    },
    chats: {
      recordInbound: bind(e, chats.recordInbound),
      recordOutbound: bind(e, chats.recordOutbound),
      recordStatus: bind(e, chats.recordStatus),
      requestHuman: bind(e, chats.requestHuman),
      botPaused: bind(e, chats.botPaused),
      inWindow: bind(e, chats.inWindow),
      list: bind(e, chats.listChats),
      get: bind(e, chats.getChat),
      setHumanMode: bind(e, chats.setHumanMode),
      botSettings: () => chats.botSettings(e),
      updateBotSettings: bind(e, chats.updateBotSettings),
    },
    admin: {
      bootstrapOwner: bind(e, admin.bootstrapOwner),
      createStaff: bind(e, admin.createStaff),
      setStaffActive: bind(e, admin.setStaffActive),
      setStaffPassword: bind(e, admin.setStaffPassword),
      findStaffForLogin: bind(e, admin.findStaffForLogin),
      listStaff: bind(e, admin.listStaff),
      orders: bind(e, admin.listOrders),
      customers: bind(e, admin.listCustomers),
      assignments: bind(e, admin.listAssignments),
      delivery: bind(e, admin.deliveryInfo),
      evidence: bind(e, admin.getOrderEvidence),
    },
    stats: {
      summary: bind(e, stats.summary),
      dashboard: bind(e, stats.dashboard),
      suppliers: bind(e, stats.supplierReport),
      audit: bind(e, stats.auditLog),
    },
  };
}

export type GabrielStore = ReturnType<typeof createStore>;
export { localHour, reminderSettings } from "./orders.js";
export { FONTS, BG_STYLES, CARD_STYLES } from "./look.js";
