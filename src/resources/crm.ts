import type { Http } from "../http.js";
import type { Body, Id, Query } from "../types.js";

/** Recursos del CRM core. Rutas/verbos observados estáticamente en el front. */
export function crmResources(http: Http) {
  return {
    accounts: {
      plans: <T = unknown>() => http.get<T>("/accounts/plans"),
      subscription: <T = unknown>() => http.get<T>("/accounts/subscription"),
      billingHistory: <T = unknown>(q?: Query) => http.get<T>("/accounts/billing-history", q),
      /** GET /account-plugins?name=&status= — p. ej. { name: "self.ws", status: "ACTIVE" }. */
      plugins: <T = unknown>(q?: Query) => http.get<T>("/account-plugins", q),
    },

    billingRules: {
      list: <T = unknown>(q?: Query) => http.get<T>("/billing-rules", q),
      create: <T = unknown>(b: Body) => http.post<T>("/billing-rules", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/billing-rules/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/billing-rules/${id}`, b),
      remove: <T = unknown>(id: Id) => http.delete<T>(`/billing-rules/${id}`),
      toggle: <T = unknown>(id: Id, b?: Body) => http.patch<T>(`/billing-rules/${id}/toggle`, b),
    },

    billingMp: {
      createPreference: <T = unknown>(b: Body) => http.post<T>("/billing/mp/preference", b),
      status: <T = unknown>(q?: Query) => http.get<T>("/billing/mp/status", q),
      cancel: <T = unknown>(b?: Body) => http.post<T>("/billing/mp/cancel", b),
    },

    clients: {
      list: <T = unknown>(q?: Query) => http.get<T>("/clients", q),
      create: <T = unknown>(b: Body) => http.post<T>("/clients", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/clients/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/clients/${id}`, b),
      import: <T = unknown>(b: Body | FormData) => http.post<T>("/clients/import", b),
      export: <T = unknown>(q?: Query) => http.get<T>("/clients/export", q),
    },

    suppliers: {
      list: <T = unknown>(q?: Query) => http.get<T>("/suppliers", q),
      create: <T = unknown>(b: Body) => http.post<T>("/suppliers", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/suppliers/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/suppliers/${id}`, b),
      import: <T = unknown>(b: Body | FormData) => http.post<T>("/suppliers/import", b),
      export: <T = unknown>(q?: Query) => http.get<T>("/suppliers/export", q),
      services: <T = unknown>(id: Id) => http.get<T>(`/suppliers/${id}/services`),
      addService: <T = unknown>(id: Id, b: Body) => http.post<T>(`/suppliers/${id}/services`, b),
      updateService: <T = unknown>(id: Id, serviceId: Id, b: Body) =>
        http.put<T>(`/suppliers/${id}/services/${serviceId}`, b),
      pricePlans: <T = unknown>(id: Id) => http.get<T>(`/suppliers/${id}/price-plans`),
    },

    streamingAccounts: {
      list: <T = unknown>(q?: Query) => http.get<T>("/streaming-accounts", q),
      create: <T = unknown>(b: Body) => http.post<T>("/streaming-accounts", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/streaming-accounts/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/streaming-accounts/${id}`, b),
      import: <T = unknown>(b: Body | FormData) => http.post<T>("/streaming-accounts/import", b),
      export: <T = unknown>(q?: Query) => http.get<T>("/streaming-accounts/export", q),
      registerSlot: <T = unknown>(id: Id, b: Body) =>
        http.post<T>(`/streaming-accounts/${id}/slot/register`, b),
      updateSlot: <T = unknown>(slotId: Id, b: Body) =>
        http.put<T>(`/streaming-accounts/slot/${slotId}/update`, b),
    },

    streamingServices: {
      list: <T = unknown>(q?: Query) => http.get<T>("/streaming-services", q),
      create: <T = unknown>(b: Body) => http.post<T>("/streaming-services", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/streaming-services/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/streaming-services/${id}`, b),
      createPricePlan: <T = unknown>(id: Id, b: Body) =>
        http.post<T>(`/streaming-services/${id}/price-plans`, b),
      updatePricePlan: <T = unknown>(id: Id, b: Body) =>
        http.put<T>(`/streaming-services/${id}/price-plans`, b),
      removePricePlan: <T = unknown>(id: Id) =>
        http.delete<T>(`/streaming-services/${id}/price-plans`),
    },

    subscriptions: {
      list: <T = unknown>(q?: Query) => http.get<T>("/subscriptions", q),
      create: <T = unknown>(b: Body) => http.post<T>("/subscriptions", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/subscriptions/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/subscriptions/${id}`, b),
      byClient: <T = unknown>(clientId: Id) => http.get<T>(`/subscriptions/client/${clientId}`),
      cancel: <T = unknown>(id: Id, b?: Body) => http.patch<T>(`/subscriptions/${id}/cancel`, b),
      extend: <T = unknown>(id: Id, b: Body) => http.patch<T>(`/subscriptions/${id}/extend`, b),
      transfer: <T = unknown>(id: Id, b: Body) => http.patch<T>(`/subscriptions/${id}/transfer`, b),
      changeSupplier: <T = unknown>(id: Id, b: Body) => http.patch<T>(`/subscriptions/${id}/supplier`, b),
    },

    supplierSubscriptions: <T = unknown>(q?: Query) => http.get<T>("/supplier-subscriptions", q),
    supplierPayments: <T = unknown>(q?: Query) => http.get<T>("/supplier-payments", q),

    combos: {
      list: <T = unknown>(q?: Query) => http.get<T>("/combos", q),
      create: <T = unknown>(b: Body) => http.post<T>("/combos", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/combos/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/combos/${id}`, b),
      remove: <T = unknown>(id: Id) => http.delete<T>(`/combos/${id}`),
    },

    payments: {
      list: <T = unknown>(q?: Query) => http.get<T>("/payments", q),
      create: <T = unknown>(b: Body) => http.post<T>("/payments", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/payments/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/payments/${id}`, b),
    },

    collaborators: {
      list: <T = unknown>(q?: Query) => http.get<T>("/collaborators", q),
      create: <T = unknown>(b: Body) => http.post<T>("/collaborators", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/collaborators/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/collaborators/${id}`, b),
    },

    templates: {
      list: <T = unknown>(q?: Query) => http.get<T>("/templates", q),
      create: <T = unknown>(b: Body) => http.post<T>("/templates", b),
      get: <T = unknown>(id: Id) => http.get<T>(`/templates/${id}`),
      update: <T = unknown>(id: Id, b: Body) => http.put<T>(`/templates/${id}`, b),
      remove: <T = unknown>(id: Id) => http.delete<T>(`/templates/${id}`),
      send: <T = unknown>(id: Id, b: Body) => http.post<T>(`/templates/${id}/send`, b),
    },

    // NOTA: /contacts/* NO van por la API principal: viven en el gateway de
    // WhatsApp (ver WhatsAppClient.contacts).

    messageLogs: {
      list: <T = unknown>(q?: Query) => http.get<T>("/message-logs", q),
      sendManual: <T = unknown>(b: Body) => http.post<T>("/message-logs/send-manual", b),
    },

    metrics: {
      dashboard: <T = unknown>(q?: Query) => http.get<T>("/metrics/dashboard", q),
      revenue: <T = unknown>(q?: Query) => http.get<T>("/metrics/revenue", q),
      serviceRevenue: <T = unknown>(q?: Query) => http.get<T>("/metrics/service-revenue", q),
      clientGrowth: <T = unknown>(q?: Query) => http.get<T>("/metrics/client-growth", q),
      planDistribution: <T = unknown>(q?: Query) => http.get<T>("/metrics/plan-distribution", q),
      slotOccupancy: <T = unknown>(q?: Query) => http.get<T>("/metrics/slot-occupancy", q),
      subscriptionStatus: <T = unknown>(q?: Query) => http.get<T>("/metrics/subscription-status", q),
    },
  };
}
