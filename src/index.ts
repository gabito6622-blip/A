// SDK de la API de VendePlay CRM (reverse-engineered).
// Punto de entrada: arma el cliente con auth + recursos.

import { Http, type HttpOptions, type TokenStore } from "./http.js";
import { crmResources } from "./resources/crm.js";
import { WhatsAppClient, type WhatsAppPlugin } from "./resources/whatsapp.js";
import type { Envelope, LoginCredentials, LoginData } from "./types.js";

export * from "./http.js";
export * from "./types.js";
export { WhatsAppClient, type WhatsAppPlugin } from "./resources/whatsapp.js";

export interface VendePlayOptions extends HttpOptions {}

export class VendePlayClient {
  readonly http: Http;
  private readonly opts: VendePlayOptions;

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
  readonly messageLogs: ReturnType<typeof crmResources>["messageLogs"];
  readonly metrics: ReturnType<typeof crmResources>["metrics"];
  readonly supplierSubscriptions: ReturnType<typeof crmResources>["supplierSubscriptions"];
  readonly supplierPayments: ReturnType<typeof crmResources>["supplierPayments"];


  constructor(opts: VendePlayOptions = {}) {
    this.opts = opts;
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
    this.messageLogs = crm.messageLogs;
    this.metrics = crm.metrics;
    this.supplierSubscriptions = crm.supplierSubscriptions;
    this.supplierPayments = crm.supplierPayments;
  }

  /**
   * Resuelve el plugin `self.ws` activo de la cuenta y devuelve un cliente del
   * gateway de WhatsApp (base URL + x-api-key propios). Observado:
   *   getPlugins({ name: "self.ws", status: "ACTIVE" }) -> data[0] = { url, referenceId, token }
   */
  async connectWhatsApp(): Promise<WhatsAppClient> {
    const res = await this.accounts.plugins<Envelope<WhatsAppPlugin[]>>({
      name: "self.ws",
      status: "ACTIVE",
    });
    const list = (res?.data ?? res) as WhatsAppPlugin[] | undefined;
    const plugin = Array.isArray(list) ? list[0] : undefined;
    if (!plugin?.url || !plugin?.referenceId) {
      throw new Error("No se encontró un plugin self.ws ACTIVE para la cuenta.");
    }
    return new WhatsAppClient(plugin, {
      fetchImpl: this.opts.fetchImpl,
      onUnauthorized: this.opts.onUnauthorized,
    });
  }

  get tokens(): TokenStore {
    return this.http.tokens;
  }

  // ---- Autenticación ----

  /**
   * POST /auth/login con `{ email, password }`. Respuesta confirmada:
   * `{ data: { accessToken, user } }`. Guarda el accessToken en el TokenStore;
   * devuelve `data` (accessToken + user) para que persistas el usuario si querés.
   */
  async login<User = unknown>(credentials: LoginCredentials): Promise<LoginData<User>> {
    const { accountCode, username, password, ...rest } = credentials;
    const body = {
      accountCode: /^ACC-/i.test(accountCode) ? accountCode : `ACC-${accountCode}`,
      username,
      password,
      ...rest,
    };
    const res = await this.http.post<Envelope<LoginData<User>>>("/auth/login", body, { auth: false });
    const data = (res?.data ?? res) as LoginData<User>;
    if (!data?.accessToken) {
      throw new Error("Respuesta de login sin accessToken (forma inesperada).");
    }
    await this.http.tokens.setAccess(data.accessToken);
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
