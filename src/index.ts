// SDK de la API de VendePlay CRM (reverse-engineered).
// Punto de entrada: arma el cliente con auth + recursos.

import { Http, type HttpOptions, type TokenStore } from "./http.js";
import { crmResources } from "./resources/crm.js";
import { whatsappResources } from "./resources/whatsapp.js";
import type { Body, Envelope, LoginResult } from "./types.js";

export * from "./http.js";
export * from "./types.js";

export interface VendePlayOptions extends HttpOptions {}

export class VendePlayClient {
  readonly http: Http;

  /** Recursos del CRM core (clientes, proveedores, suscripciones, métricas…). */
  readonly accounts: ReturnType<typeof crmResources>["accounts"];
  readonly billingRules: ReturnType<typeof crmResources>["billingRules"];
  readonly billingMp: ReturnType<typeof crmResources>["billingMp"];
  readonly clients: ReturnType<typeof crmResources>["clients"];
  readonly suppliers: ReturnType<typeof crmResources>["suppliers"];
  readonly streamingAccounts: ReturnType<typeof crmResources>["streamingAccounts"];
  readonly streamingServices: ReturnType<typeof crmResources>["streamingServices"];
  readonly subscriptions: ReturnType<typeof crmResources>["subscriptions"];
  readonly combos: ReturnType<typeof crmResources>["combos"];
  readonly payments: ReturnType<typeof crmResources>["payments"];
  readonly collaborators: ReturnType<typeof crmResources>["collaborators"];
  readonly templates: ReturnType<typeof crmResources>["templates"];
  readonly contacts: ReturnType<typeof crmResources>["contacts"];
  readonly messageLogs: ReturnType<typeof crmResources>["messageLogs"];
  readonly metrics: ReturnType<typeof crmResources>["metrics"];
  readonly supplierSubscriptions: ReturnType<typeof crmResources>["supplierSubscriptions"];
  readonly supplierPayments: ReturnType<typeof crmResources>["supplierPayments"];

  /** Gateway de WhatsApp (sesiones, chats, envío de mensajes). */
  readonly whatsapp: ReturnType<typeof whatsappResources>;

  constructor(opts: VendePlayOptions = {}) {
    this.http = new Http(opts);
    const crm = crmResources(this.http);
    this.accounts = crm.accounts;
    this.billingRules = crm.billingRules;
    this.billingMp = crm.billingMp;
    this.clients = crm.clients;
    this.suppliers = crm.suppliers;
    this.streamingAccounts = crm.streamingAccounts;
    this.streamingServices = crm.streamingServices;
    this.subscriptions = crm.subscriptions;
    this.combos = crm.combos;
    this.payments = crm.payments;
    this.collaborators = crm.collaborators;
    this.templates = crm.templates;
    this.contacts = crm.contacts;
    this.messageLogs = crm.messageLogs;
    this.metrics = crm.metrics;
    this.supplierSubscriptions = crm.supplierSubscriptions;
    this.supplierPayments = crm.supplierPayments;
    this.whatsapp = whatsappResources(this.http);
  }

  get tokens(): TokenStore {
    return this.http.tokens;
  }

  // ---- Autenticación ----

  /**
   * POST /auth/login. Guarda el accessToken (y refreshToken si viene) en el
   * TokenStore configurado. Devuelve el payload de tokens.
   */
  async login(credentials: Body): Promise<LoginResult> {
    const res = await this.http.post<Envelope<LoginResult>>("/auth/login", credentials, { auth: false });
    const data = (res?.data ?? res) as LoginResult;
    if (!data?.accessToken) {
      throw new Error("Respuesta de login sin accessToken (forma inesperada).");
    }
    await this.http.tokens.setAccess(data.accessToken);
    if (data.refreshToken) await this.http.tokens.setRefresh(data.refreshToken);
    return data;
  }

  /** GET-like usuario actual. El front lo llama como POST /auth/me. */
  me<T = unknown>(): Promise<T> {
    return this.http.post<T>("/auth/me");
  }

  /** Fuerza la renovación del access token vía /auth/refresh. */
  refresh(): Promise<boolean> {
    return this.http.tryRefresh();
  }

  /** POST /auth/logout y limpieza local de tokens. */
  async logout(): Promise<void> {
    try { await this.http.post("/auth/logout"); } finally { await this.http.tokens.clear(); }
  }
}

export default VendePlayClient;
