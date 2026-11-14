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
import * as finance from "./finance.js";
import * as gastos from "./gastos.js";
import * as plata from "./plata.js";
import * as proveedoresMes from "./proveedoresMes.js";
import * as inventario from "./inventario.js";
import * as cobro from "./cobro.js";
import * as cobrarBien from "./cobrarBien.js";
import * as cambioPlataforma from "./cambioPlataforma.js";
import * as fiado from "./fiado.js";
import * as rtools from "./resellerTools.js";
import * as rday from "./resellerDay.js";
import * as rback from "./resellerBack.js";
import * as clientLinks from "./clientLinks.js";
import * as subs from "./subRentals.js";
import * as subLinks from "./subLinks.js";
import * as tickets from "./tickets.js";
import * as importer from "./importer.js";
import * as chats from "./chats.js";
import * as coupons from "./coupons.js";
import * as payMethods from "./payMethods.js";
import * as watch from "./watch.js";
import * as winback from "./winback.js";
import * as country from "./country.js";
import * as ownStock from "./ownStock.js";
import * as usd from "./usd.js";
import * as secretary from "./secretary.js";
import * as dia from "./dia.js";
import * as diaCobro from "./diaCobro.js";
import * as bulkAssign from "./bulkAssign.js";

export * from "./types.js";
export { DomainError, type ErrorCode } from "./errors.js";
export { can, authorize, type Permission } from "./auth.js";
export { Engine, emptyState, systemClock, type Clock, type EngineOptions } from "./engine.js";
export { DAY, HOUR, MINUTE } from "./time.js";
export type { WhatsAppTransport } from "./notify.js";
export type { PublicStaff } from "./admin.js";
export type { ServiceRow, ServiceResult } from "./importer.js";
export { render as renderTemplate } from "./notify.js";
export { normalizePhone, phoneWithCountry, samePhone } from "./catalog.js";
export { COUNTRIES, money, convertFromStore, type ResellerLocale } from "./country.js";
export type { OwnStockBook, OwnProduct, OwnAccount, OwnSale } from "./ownStock.js";
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
      deleteSupplier: bind(e, inventory.deleteSupplier),
      createCustomer: bind(e, catalog.createCustomer),
      setResellerTrust: bind(e, catalog.setResellerTrust),
      updateCustomer: bind(e, catalog.updateCustomer),
      setWhatsappConsent: bind(e, catalog.setWhatsappConsent),
      setOwnEmail: bind(e, catalog.setOwnEmail),
      priceFor: bind(e, catalog.priceFor),
      publicCatalog: bind(e, catalog.publicCatalog),
      updateSettings: bind(e, catalog.updateSettings),
      setProductImage: bind(e, catalog.setProductImage),
      setCustomersKind: bind(e, catalog.setCustomersKind),
      findCustomerByPhone: bind(e, catalog.findCustomerByPhone),
      selfRegister: bind(e, catalog.selfRegister),
      registerWithEmail: bind(e, catalog.registerWithEmail),
      canActFor: bind(e, catalog.canActFor),
      renewPriceFor: bind(e, catalog.renewPriceFor),
    },
    /** Lista en dólares (usd.ts): moneda de compra/saldo de un cliente y conversión con la tasa. */
    usd: {
      currency: (customerId: Id) => usd.currencyView(e, e.s.customers[customerId]),
      isUsd: (customerId: Id) => usd.isUsd(e, customerId),
      rate: () => usd.rateNow(e),
      toBs: (usdCents: Cents, rate: number) => usd.usdToBs(usdCents, rate),
    },
    /** «Me pagó» desde Mi secretaria (optimización 1): vista previa y guardado reutilizando el Control. */
    cobro: {
      preview: bind(e, cobro.payPreview),
      apply: bind(e, cobro.payApply),
    },
    /** Día a día (14/11): números del día, reactivar lo cortado por vencido y «Renovar proveedor y anotar». */
    dia: {
      numbers: bind(e, dia.todayNumbers),
      reactivable: bind(e, diaCobro.reactivableList),
      reactivatePreview: bind(e, diaCobro.reactivatePreview),
      reactivate: bind(e, diaCobro.reactivate),
      payWithSupplier: bind(e, diaCobro.payWithSupplier),
      /** Revisión de 3 meses (14/11): «Me pagó lo que debía» (sin correr la fecha) y «🔀 Cambiar de plataforma». */
      payDebt: bind(e, cobrarBien.payDebt),
      switchPreview: bind(e, cambioPlataforma.switchPreview),
      switchPlatform: bind(e, cambioPlataforma.switchPlatform),
    },
    /** Inventario inteligente (etapa 4): cortes, cambio de clave guiado. */
    inventario: {
      cuts: bind(e, inventario.cutsReport),
      rotatePassword: bind(e, inventario.rotatePassword),
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
      accountSecret: bind(e, inventory.accountSecret),
      stock: () => inventory.stockByProduct(e),
    },
    orders: {
      create: bind(e, orders.createOrder),
      quote: bind(e, orders.quoteOrder),
      createTrial: bind(e, orders.createTrial),
      comboDiscount: bind(e, orders.comboDiscount),
      submitEvidence: bind(e, orders.submitEvidence),
      approvePayment: bind(e, orders.approvePayment),
      attachBinance: bind(e, orders.attachBinance),
      confirmBinancePayment: bind(e, orders.confirmBinancePayment),
      rejectPayment: bind(e, orders.rejectPayment),
      cancel: bind(e, orders.cancelOrder),
      expireReservations: bind(e, orders.expireReservations),
      renew: bind(e, orders.renew),
      renewMany: bind(e, orders.renewMany),
      replace: bind(e, orders.replaceAssignment),
      replaceAccount: bind(e, orders.replaceAccount),
      moveAll: bind(e, orders.moveAccountClients),
      relocationQueue: bind(e, orders.relocationQueue),
      transfer: bind(e, orders.transferAssignment),
      releaseSlot: bind(e, orders.releaseSlot),
      refundAssignment: bind(e, orders.refundAssignment),
      markTest: bind(e, orders.markSaleAsTest),
      closeExpired: bind(e, orders.closeExpired),
      queueExpiryReminders: bind(e, orders.queueExpiryReminders),
      autoReminders: bind(e, orders.autoReminders),
      setExpiry: bind(e, orders.setCustomerExpiry),
      setControl: bind(e, orders.setRentalControl),
      markNoticed: bind(e, orders.markNoticed),
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
      myCoupons: bind(e, rshop.myCoupons),
      saveCoupon: bind(e, rshop.saveMyCoupon),
      deleteCoupon: bind(e, rshop.deleteMyCoupon),
      quoteCoupon: (slug: string, code: unknown, items: unknown) => rshop.quoteShopCoupon(e, slug, code, items),
      setCouponsAllowed: bind(e, rshop.setResellerCoupons),
      setImage: bind(e, rshop.setMyShopImage),
      setBlocked: bind(e, rshop.setShopBlocked),
      setPage: bind(e, rshop.setResellerPage),
      pageAllowedFor: (customerId: string) => rshop.pageAllowed(e, e.s.customers[customerId]),
      list: bind(e, rshop.listShops),
      setupFor: bind(e, rshop.setupShopFor),
      chargeRents: bind(e, rshop.chargeShopRents),
      payRent: bind(e, rshop.payMyShopRent),
      /** Suscripción GaboHub sin pagar: Mi control, Quién me debe y Mis ganancias quedan pausadas (ver resellerShop). */
      hubLocked: (customerId: string) => rshop.hubLocked(e, customerId),
      planGate: (customerId: Id, feature: rshop.HubFeature) => rshop.planGate(e, customerId, feature),
      planNames: rshop.PLAN_NAMES,
      hubLockReason: (customerId: string) => rshop.hubLockReason(e, customerId),
      setPlan: bind(e, rshop.setHubPlan),
      apply: (input: { name: unknown; phone: unknown; note?: unknown; ref?: unknown }) => rshop.applyReseller(e, input),
      apps: bind(e, rshop.listApps),
      approve: bind(e, rshop.approveApp),
      reject: bind(e, rshop.rejectApp),
      resellers: bind(e, rshop.resellersOverview),
      program: () => rshop.programInfo(e),
      referrals: bind(e, rshop.myReferrals),
      setFeatured: bind(e, rshop.setShopFeatured),
      setTestimonials: bind(e, rshop.setTestimonials),
      setFaq: bind(e, rshop.setFaq),
      public: (slug: string, viewer?: Actor) => rshop.publicShop(e, slug, viewer),
      image: (slug: string, kind: "logo" | "banner" | "qr", viewer?: Actor) => rshop.shopImage(e, slug, kind, viewer),
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
      notifications: bind(e, stats.notifications),
      secretary: bind(e, secretary.secretaryReport),
      feed: () => stats.notificationItems(e),
    },
    watch: {
      classify: watch.classifyRisk,
      record: bind(e, watch.recordAlert),
      list: bind(e, watch.listAlerts),
      seen: bind(e, watch.markAlertSeen),
    },
    payMethods: {
      list: bind(e, payMethods.listPayMethods),
      save: bind(e, payMethods.savePayMethod),
      remove: bind(e, payMethods.deletePayMethod),
      setQr: bind(e, payMethods.setPayMethodQr),
      mine: bind(e, payMethods.myPayMethods),
      forCustomer: (customerId: Id) => payMethods.methodsFor(e, customerId),
    },
    coupons: {
      list: bind(e, coupons.listCoupons),
      save: bind(e, coupons.saveCoupon),
      remove: bind(e, coupons.deleteCoupon),
    },
    finance: {
      report: bind(e, finance.report),
      monthClose: bind(e, finance.monthClose),
      addExpense: bind(e, finance.addExpense),
      removeExpense: bind(e, finance.removeExpense),
      payRenewal: bind(e, finance.payAccountRenewal),
      recordAccountCost: bind(e, finance.recordAccountCost),
      margins: bind(e, finance.productMargins),
      setMinMargin: bind(e, finance.setMinMargin),
      // La plata como la maneja un humano (gastos.ts, plata.ts, proveedoresMes.ts).
      addExpenseFull: bind(e, gastos.addExpenseFull),
      updateExpense: bind(e, gastos.updateExpense),
      addRefund: bind(e, gastos.addRefund),
      monthExpenses: bind(e, gastos.monthExpenses),
      listFixed: bind(e, gastos.listFixed),
      upsertFixed: bind(e, gastos.upsertFixed),
      removeFixed: bind(e, gastos.removeFixed),
      payFixed: bind(e, gastos.payFixed),
      amendOrder: bind(e, plata.amendOrderTotal),
      saleToFix: bind(e, plata.saleToFix),
      suppliersMonth: bind(e, proveedoresMes.supplierMonth),
    },
    fiado: {
      overview: bind(e, fiado.overview),
      history: bind(e, fiado.history),
      charge: bind(e, fiado.addCharge),
      pay: bind(e, fiado.addPayment),
      remove: bind(e, fiado.removeEntry),
      fromControl: bind(e, fiado.chargeUnpaidRentals),
      owedBy: (customerId: string) => fiado.owedBy(e, customerId),
    },
    tickets: {
      report: bind(e, tickets.report),
      mine: bind(e, tickets.mine),
      list: bind(e, tickets.list),
      setStatus: bind(e, tickets.setStatus),
      kinds: tickets.TICKET_KINDS,
    },
    subs: {
      list: bind(e, subs.listMine),
      save: bind(e, subs.saveSub),
      renew: bind(e, subs.renewSub),
      remove: bind(e, subs.removeSub),
      summary: bind(e, subs.rentalSummary),
      link: bind(e, subLinks.subLink),
      revokeLink: bind(e, subLinks.revokeSubLink),
      publicView: (token: unknown) => subLinks.publicView(e, token),
      publicQr: (token: unknown) => subLinks.publicQr(e, token),
      publicLogo: (token: unknown) => subLinks.publicLogo(e, token),
    },
    winback: {
      list: bind(e, winback.list),
      mark: bind(e, winback.mark),
    },
    /** País y moneda del revendedor (country.ts). */
    locale: {
      mine: bind(e, country.myLocale),
      setMine: bind(e, country.setMyLocale),
      setFor: bind(e, country.setLocaleFor),
      of: (customerId: Id) => country.localeView(e, e.get("customers", customerId)),
    },
    /** "Mis cuentas propias" del revendedor (ownStock.ts). */
    own: {
      view: bind(e, ownStock.view),
      saveProduct: bind(e, ownStock.saveProduct),
      deleteProduct: bind(e, ownStock.deleteProduct),
      setLogo: bind(e, ownStock.setProductLogo),
      logo: bind(e, ownStock.productLogo),
      preview: bind(e, ownStock.previewAccounts),
      addBulk: bind(e, ownStock.addAccountsBulk),
      saveAccount: bind(e, ownStock.saveAccount),
      deleteAccount: bind(e, ownStock.deleteAccount),
      assign: bind(e, ownStock.assign),
      updateSale: bind(e, ownStock.updateSale),
      renew: bind(e, ownStock.renew),
      release: bind(e, ownStock.release),
      link: bind(e, ownStock.link),
      revokeLink: bind(e, ownStock.revokeLink),
      counts: (customerId: Id) => ownStock.ownCounts(e, customerId),
    },
    /** "📋 Cargar sus cuentas": anotar en lote lo ya vendido a un revendedor, sin cobrar (bulkAssign.ts). */
    bulk: {
      preview: bind(e, bulkAssign.preview),
      apply: bind(e, bulkAssign.apply),
    },
    rtools: {
      control: bind(e, rtools.myControl),
      setControl: bind(e, rtools.setMyControl),
      earnings: bind(e, rtools.myEarnings),
      /** «Mi día» (13/11): la secretaria del revendedor con sus clientes y perfiles repartidos; «Me pagó» de un toque. */
      /** Link de cobro para sus clientes registrados (clientLinks.ts); la página pública es la misma /c/<token>. */
      clientLink: bind(e, clientLinks.clientLink),
      revokeClientLink: bind(e, clientLinks.revokeClientLink),
      day: bind(e, rday.myDay),
      dayPushText: bind(e, rday.dayPushText),
      dayPreview: bind(e, rday.dayPreview),
      dayPay: bind(e, rday.dayPay),
      /** «Que vuelvan» (13/11): sus clientes vencidos sin renovar, con «Ya le escribí». */
      winback: bind(e, rback.myWinback),
      markBack: bind(e, rback.markBack),
    },
  };
}

export type GabrielStore = ReturnType<typeof createStore>;
export { localHour, reminderSettings } from "./orders.js";
export { FONTS, BG_STYLES, CARD_STYLES } from "./look.js";
