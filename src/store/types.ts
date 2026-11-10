// Modelo de dominio de Gabriel Store.
// Montos SIEMPRE en centavos (enteros) para evitar errores de coma flotante.

import type { Look } from "./look.js";
export type { Look } from "./look.js";

export type Cents = number;
export type Id = string;

export type Role = "owner" | "admin" | "seller" | "reseller" | "customer" | "system";

/** Quién ejecuta una operación. `customerId` es obligatorio para customer/reseller. */
export interface Actor {
  id: Id;
  role: Role;
  customerId?: Id;
}

export type ProductKind = "profile" | "full_account" | "invite" | "combo" | "iptv";

/** Datos de una línea IPTV (Flujo TV, Más TV, etc.). El secreto va en Account.password (cifrado). */
export interface IptvLine {
  /** Cómo se entrega: Xtream (usuario/clave/servidor), lista M3U, por MAC o código de activación. */
  mode: "xtream" | "m3u" | "mac" | "code";
  /** Servidor / URL del portal (Xtream) o dominio del panel. No es secreto. */
  server?: string;
  /** MAC del aparato del cliente (MAG/StbEmu), si se activa por MAC. */
  mac?: string;
  /** App recomendada para ver (IBO Player, IPTV Smarters, etc.). */
  app?: string;
  /** Cuántos dispositivos a la vez permite la línea. */
  connections?: number;
}

export interface Product {
  id: Id;
  name: string;
  kind: ProductKind;
  durationDays: number;
  /** Precio base (grupo "final"). */
  price: Cents;
  published: boolean;
  /** Para la tienda: categoría, descripción corta y color de la tarjeta. */
  category?: string;
  description?: string;
  color?: string;
  /** Logo o imagen del producto (archivo subido por el staff). */
  imageFileRef?: string;
  /** Solo lo ven, compran y renuevan los revendedores (no sale en la tienda pública). */
  resellersOnly?: boolean;
  /** Nombre y PIN por defecto de cada perfil; se precargan al cargar una cuenta de este servicio. */
  profileDefaults?: { label: string; pin?: string }[];
  /** Solo para kind "combo": las apps (ids de productos) que incluye. Sirve para detectar cuando el cliente arma el mismo combo. */
  comboProductIds?: Id[];
  /** Regla / recordatorio que aparece al vender este servicio (ej.: "Disney pide PIN", "este panel tarda"). */
  saleNote?: string;
  /** "Cómo verlo": guía que recibe el cliente al comprar (app, enlace de descarga y pasos). */
  guide?: { app?: string; link?: string; steps?: string };
}

/** Descuento "Armá tu combo" por defecto (centavos) para 2, 3 y 4 o más servicios distintos. */
export const DEFAULT_COMBO_DISCOUNTS: [Cents, Cents, Cents] = [500, 1000, 1500];

/** Configuración de la tienda que ve el cliente. */
export interface StoreSettings extends Look {
  shopRent?: ShopRent;
  /** Ganancia sugerida (%) que el asistente le propone al revendedor sobre su costo. */
  resellerMarginPct?: number;
  /** Premio (centavos) que gana un revendedor cuando traés a otro revendedor y el dueño lo aprueba. 0 lo apaga. */
  referralBonus?: Cents;
  /** Descuento de "Armá tu combo" para 2, 3 y 4+ servicios (centavos). [0,0,0] lo apaga. */
  comboDiscounts?: [Cents, Cents, Cents];
  storeName: string;
  /** WhatsApp de ventas, solo dígitos con código de país. */
  whatsapp: string;
  currency: "BOB";
  /** Símbolo que se muestra en los precios (ej.: "Bs", "US$", "₲"). Por defecto "Bs". */
  currencySymbol?: string;
  /** Archivo del QR de cobro (subido por el staff). */
  qrFileRef?: string;
  /** Texto bajo el QR: banco, titular, instrucciones. */
  paymentNote?: string;
  /** Pago en USDT manual (plan B sin API): el cliente manda a esta dirección/Pay ID y sube el comprobante. */
  usdt?: {
    enabled: boolean;
    /** Dirección de la billetera (p. ej. empieza con T en TRC20) o vacío si solo usa Pay ID. */
    address?: string;
    /** Red de la dirección (TRC20, BEP20, …). */
    network?: string;
    /** Binance Pay ID (pago interno Binance-a-Binance). */
    payId?: string;
    /** Cuántos Bs vale 1 USDT (para mostrarle al cliente cuánto mandar). */
    rate?: number;
    /** Nota/instrucciones extra para el cliente. */
    note?: string;
  };
  /** Logo de la tienda (el resto de la apariencia viene de Look). */
  logoFileRef?: string;
  /** Nombre de la plataforma de revendedores (la tienda es una más adentro). */
  platformName?: string;
  /** Si los revendedores pueden publicar su propia página. Por defecto sí. */
  resellerShops?: boolean;
  /** Mostrar precio público vs precio de revendedor en la página /revendedores. Por defecto sí. */
  resellerProgramPrices?: boolean;
  /** Opiniones reales de revendedores, cargadas por la tienda (con su permiso). */
  testimonials?: Testimonial[];
  /** Preguntas frecuentes de la tienda (editables). Vacío = se usan las de por defecto. */
  faq?: { q: string; a: string }[];
  /** Bot de WhatsApp (API oficial de Meta). Los secretos NO van acá: están en otra tabla. */
  whatsappBot?: WhatsAppBotSettings;
  /** Recordatorios automáticos de vencimiento. */
  reminders?: ReminderSettings;
  /** Avisos por WhatsApp para el dueño. */
  staffAlerts?: StaffAlertSettings;
}

export interface StaffAlertSettings {
  /** WhatsApp del dueño (con código de país). Vacío = sin avisos por WhatsApp. */
  phone: string;
  /** Avisar cuando un cliente manda un comprobante de pago o pide una recarga. */
  payments: boolean;
  /** Avisar cuando una cuenta está por vencer con el proveedor. */
  supplierExpiry: boolean;
  supplierDaysBefore: number;
}

export interface ReminderSettings {
  enabled: boolean;
  /** Cuántos días antes del vencimiento avisar (p. ej. [2] o [3, 1]). 0 = el mismo día. */
  daysBefore: number[];
  /** Solo se encolan entre estas horas (hora local de la tienda). */
  fromHour: number;
  toHour: number;
  timeZone: string;
}

/** Nombre e idioma de una plantilla aprobada en Meta. */
export interface MetaTemplateRef {
  name: string;
  lang: string;
}

export interface BotQuickReply {
  keywords: string[];
  answer: string;
}

export interface WhatsAppBotSettings {
  /** Encendido: el bot contesta y los avisos salen por la API oficial. */
  enabled: boolean;
  /** "Phone number ID" de Meta (no es el número de teléfono). */
  phoneNumberId: string;
  /** Versión de la Graph API, p. ej. "v21.0". */
  apiVersion: string;
  /** Saludo del bot. {name} y {store} se reemplazan. */
  welcome?: string;
  /** Horas que el bot se queda callado después de pedir hablar con una persona. */
  humanPauseHours: number;
  /** Respuestas propias: si el mensaje tiene alguna de las palabras, el bot contesta ese texto. */
  quickReplies?: BotQuickReply[];
  /** Horario en que atiende una persona (hora local). Fuera de ese horario el bot lo aclara. */
  humanHours?: { from: number; to: number };
  /** Plantillas aprobadas para avisos fuera de la ventana de 24 h. */
  templates: Partial<Record<TemplateId | "login_code", MetaTemplateRef>>;
}

export interface ChatMessage {
  id: Id;
  direction: "in" | "out";
  by: "cliente" | "bot" | "staff" | "sistema";
  text: string;
  at: number;
  /** Id del mensaje en WhatsApp (para estados entregado/leído). */
  waId?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  error?: string;
}

/** Conversación con un número de WhatsApp. */
export interface ChatThread {
  phone: string;
  customerId?: Id;
  name?: string;
  /** Último mensaje del cliente: abre la ventana de 24 h para responder con texto libre. */
  lastInboundAt?: number;
  needsHuman: boolean;
  /** Hasta cuándo el bot no contesta (porque lo atiende una persona). */
  botPausedUntil?: number;
  unread: number;
  messages: ChatMessage[];
}

/** Grupo de precios: sobreescribe el precio base por producto (p. ej. revendedores). */
export interface PriceGroup {
  id: Id;
  name: string;
  prices: Record<Id, Cents>;
}

export interface Supplier {
  id: Id;
  name: string;
  contact?: string;
  active: boolean;
}

/** Cuenta maestra comprada a un proveedor. Contiene uno o más perfiles (slots). */
export interface Account {
  id: Id;
  productId: Id;
  supplierId: Id;
  email: string;
  /** Secreto de acceso. En producción va cifrado (KMS); nunca en logs ni mensajes. */
  password: string;
  /** Vence con el proveedor. Las renovaciones del cliente NUNCA lo modifican. */
  supplierExpiresAt: number;
  cost: Cents;
  status: "active" | "retired";
  /** Notas internas del staff (nunca se muestran al cliente). */
  notes?: string;
  /** Datos de la línea IPTV (cuando el producto es de tipo "iptv"). El secreto va en `password`. */
  iptv?: IptvLine;
  /** Vencimiento con el proveedor para el que ya se avisó al dueño. */
  supplierAlertSentFor?: number;
  createdAt: number;
}

export type SlotStatus = "available" | "reserved" | "assigned" | "quarantined" | "retired";

/** Unidad vendible: un perfil de una cuenta (o la cuenta entera si tiene 1 slot). */
export interface Slot {
  id: Id;
  accountId: Id;
  productId: Id;
  label: string;
  pin?: string;
  status: SlotStatus;
  reservedByOrder?: Id;
  reservedUntil?: number;
}

export interface Customer {
  id: Id;
  name: string;
  phone: string;
  email?: string;
  kind: "customer" | "reseller";
  /** Revendedor dueño de este cliente (si lo creó un revendedor). */
  resellerId?: Id;
  /** Revendedor que lo trajo al programa (referido). Se registra al aprobar su solicitud. */
  referredBy?: Id;
  /** Link de códigos para compartir (/codigos/<token>), protegido con un PIN que guarda el servidor. */
  codeLink?: { token: string; createdAt: number };
  priceGroupId: Id;
  /** Consentimiento explícito para recibir WhatsApp. Sin él no se envía nada. */
  whatsappConsent: boolean;
  createdAt: number;
  /** Notas internas del staff (nunca se muestran al cliente). */
  notes?: string;
  /** Etiqueta del cliente (vip, moroso, nuevo…), solo la ve el staff. */
  tag?: string;
  /** Nota del revendedor sobre su cliente (solo la ve ese revendedor y el staff). */
  resellerNote?: string;
  /** Precios a los que el revendedor le vende a sus clientes (en centavos), para calcular su ganancia. */
  resellerPrices?: Record<Id, Cents>;
  /** Plan del revendedor: si `true`, puede tener su página propia (premium). Sin definir = según si ya tiene página. */
  pageAllowed?: boolean;
  /** Página propia del revendedor (/r/slug). */
  shop?: ResellerShop;
}

export interface Testimonial {
  name: string;
  /** Nombre de su tienda o a qué se dedica. */
  business?: string;
  text: string;
  /** 1 a 5 estrellas (opcional). */
  rating?: number;
}

/** Combo propio del revendedor: junta apps y les pone un precio fijo que él elige. */
export interface ResellerCombo {
  id: Id;
  name: string;
  /** Productos (del catálogo, que el revendedor tiene con precio) que incluye. */
  productIds: Id[];
  /** Precio del combo en centavos (lo decide el revendedor). */
  price: Cents;
  note?: string;
}

export interface ResellerShop extends Look {
  /** Dirección: /r/slug. */
  slug: string;
  enabled: boolean;
  /** Nombre que se ve en su página. */
  title: string;
  /** WhatsApp del revendedor (solo dígitos): ahí le llegan los pedidos. */
  whatsapp: string;
  logoFileRef?: string;
  /** Imagen de portada. */
  bannerFileRef?: string;
  /** Productos que muestra (vacío = todos los que tienen precio). */
  products?: Id[];
  /** Bloqueada por la tienda (contenido inapropiado, deuda, etc.). */
  blocked?: boolean;
  /** Destacada por la tienda en el directorio. */
  featured?: boolean;
  /** Alquiler: pagado hasta (ms). */
  paidUntil?: number;
  /** Apagada por falta de pago del alquiler (se prende sola al pagar). */
  suspended?: boolean;
  /** Combos propios del revendedor (con su precio). */
  combos?: ResellerCombo[];
  /** "Armá tu combo" en SU página: descuento para 2, 3 y 4+ apps sueltas (centavos). El revendedor elige los montos. */
  comboDiscounts?: [Cents, Cents, Cents];
}

export type OrderKind = "sale" | "renewal" | "topup";
export type OrderStatus =
  | "awaiting_payment"
  | "payment_review"
  | "fulfilled"
  | "rejected"
  | "expired"
  | "cancelled";
export type PaymentMethod = "qr" | "balance" | "cash" | "binance" | "usdt";

/** Datos de un pago por Binance Pay (USDT). El monto en USDT se calcula con la tasa que pone el dueño. */
export interface BinancePay {
  /** Número de operación que mandamos a Binance (lo devuelve el webhook para encontrar el pedido). */
  merchantTradeNo: string;
  /** ID de prepago que devuelve Binance al crear la orden. */
  prepayId?: string;
  /** Enlace de pago (checkout) o QR que abre la app de Binance. */
  link?: string;
  qr?: string;
  /** Monto cobrado en USDT (hasta 2 decimales) y la tasa Bs→USDT usada. */
  usdt: number;
  rate: number;
  status: "PENDING" | "PAID" | "CANCELED" | "EXPIRED";
  /** ID de transacción de Binance al pagarse (sirve de referencia y evita doble crédito). */
  txnId?: string;
}

export interface OrderItem {
  productId: Id;
  qty: number;
  unitPrice: Cents;
}

export interface PaymentEvidence {
  fileRef: string;
  declaredReference: string;
  submittedAt: number;
}

export interface Order {
  id: Id;
  kind: OrderKind;
  customerId: Id;
  /** Quién paga (el revendedor cuando vende a su cliente con su saldo). */
  payerId: Id;
  createdBy: Id;
  /** "import" = servicio que ya existía y se cargó desde Excel (no cuenta como venta). */
  channel: "store" | "panel" | "reseller" | "import";
  items: OrderItem[];
  total: Cents;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  evidence?: PaymentEvidence;
  /** Referencia bancaria confirmada por quien aprobó. */
  confirmedReference?: string;
  approvedBy?: Id;
  reservedSlotIds: Id[];
  assignmentIds: Id[];
  renewal?: { assignmentId: Id; periods: number };
  topupAmount?: Cents;
  /** "A pedido": ítems sin stock al comprar (solo revendedores, pagando con QR). Se entregan al aprobar el pago. */
  backorder?: { productId: Id; qty: number }[];
  /** Descuento "Armá tu combo" ya restado del total. */
  discount?: Cents;
  /** Pago por Binance Pay (USDT), si el pedido se cobra así. */
  binance?: BinancePay;
  /** Prueba gratis: no cuenta como venta en las estadísticas. */
  trial?: boolean;
  /** Cupón usado (copia del código por si después se borra) y cuánto descontó. */
  coupon?: { id: Id; code: string; amount: Cents };
  createdAt: number;
  updatedAt: number;
}

export type AssignmentStatus = "active" | "replaced" | "revoked";

export interface AssignmentEvent {
  at: number;
  by: Id;
  event: "assigned" | "renewed" | "replaced" | "revoked" | "access_updated" | "transferred" | "date_changed";
  slotId: Id;
  note?: string;
}

export interface Assignment {
  id: Id;
  slotId: Id;
  productId: Id;
  customerId: Id;
  orderId: Id;
  startsAt: number;
  /** Vence para el cliente. Independiente de Account.supplierExpiresAt. */
  customerExpiresAt: number;
  status: AssignmentStatus;
  history: AssignmentEvent[];
  lastReminderAt?: number;
  /** Recordatorios automáticos ya enviados: "vencimiento:días" (se reinicia al renovar). */
  remindersSent?: string[];
  /** Importado ya vencido: no se cierra solo hasta que el staff le ponga fecha. */
  holdOpen?: boolean;
  /** Datos de control (como en el Excel del dueño). */
  control?: RentalControl;
  /** Prueba gratis (línea de cortesía por horas). No cuenta como venta. */
  trial?: boolean;
}

export interface RentalControl {
  /** Precio que cobra por período (centavos). */
  price?: Cents;
  /** Lo que le cuesta (centavos). */
  cost?: Cents;
  payStatus?: "pagado" | "pendiente" | "no_pago";
  /** Fecha de inicio original (si vino de un Excel). */
  startedAt?: number;
  /** Revendedor o proveedor anotado. */
  seller?: string;
  note?: string;
}

export type LedgerType = "topup" | "purchase" | "renewal" | "refund" | "adjustment" | "shop_rent" | "referral";

/** Alquiler mensual de la página del revendedor (se cobra solo del saldo). */
export interface ShopRent {
  enabled: boolean;
  /** Precio por 30 días. */
  price: Cents;
  /** Gratis si en los últimos 30 días compró al menos esto (0 = nunca gratis). */
  freeIfSpent: Cents;
  /** Días que la página sigue publicada después de vencer sin saldo. */
  graceDays: number;
}

/** Pedido de alta de alguien que quiere ser revendedor (formulario público). */
export interface ResellerApp {
  id: Id;
  name: string;
  phone: string;
  note?: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
  customerId?: Id;
  decidedBy?: Id;
  decidedAt?: number;
  /** Revendedor que la refirió (si llegó por un link de referido). */
  ref?: Id;
}

/** Libro contable de saldo: el saldo es SIEMPRE la suma de los movimientos. */
export interface LedgerEntry {
  id: Id;
  customerId: Id;
  amount: Cents;
  type: LedgerType;
  ref: Id;
  note?: string;
  by: Id;
  at: number;
}

export interface AuditEvent {
  id: Id;
  at: number;
  actorId: Id;
  role: Role;
  action: string;
  entity: string;
  entityId: Id;
  data?: Record<string, unknown>;
}

export type TemplateId =
  | "staff_payment_review"
  | "staff_supplier_expiry"
  | "order_received"
  | "order_confirmed"
  | "payment_rejected"
  | "topup_approved"
  | "renewal_confirmed"
  | "expiry_reminder"
  | "replacement_done"
  | "access_updated"
  | "access_transferred";

export interface OutboxMessage {
  id: Id;
  /** "staff" cuando es un aviso para el dueño (no para un cliente). */
  customerId: Id;
  to: string;
  template: TemplateId;
  params: Record<string, string>;
  text: string;
  status: "queued" | "skipped_no_consent" | "sent" | "sent_manually" | "failed";
  error?: string;
  /** Id del mensaje en WhatsApp, cuando salió por la API oficial. */
  waId?: string;
  attempts?: number;
  createdAt: number;
}

/** Buzón de correo autorizado por el dueño para leer códigos de verificación. */
export interface Mailbox {
  id: Id;
  address: string;
  host: string;
  authorizedBy: Id;
  authorizedAt: number;
  subjectAllowlist: string[];
  /** Si tiene algo, solo se leen correos cuyo remitente (nombre o dirección) contiene alguna de estas palabras. */
  senderAllowlist?: string[];
  /** Conexión IMAP (la contraseña de aplicación se guarda aparte, cifrada, fuera del estado). */
  name?: string;
  kind?: "gmail" | "imap";
  port?: number;
  user?: string;
  /** Lectura automática. */
  uidValidity?: number;
  lastUid?: number;
  lastCheckAt?: number;
  lastOkAt?: number;
  lastError?: string;
  codesFound?: number;
}

export interface CodeMessage {
  id: Id;
  mailboxId: Id;
  /** Destinatario: el email de la cuenta de la plataforma. */
  to: string;
  subject: string;
  code: string;
  /** Enlace de la plataforma (p. ej. Netflix "Obtener código" o actualizar hogar). */
  link?: string;
  /** Tipo de código: "login" (inicio de sesión), "hogar" (actualizar hogar), "temporal" (acceso temporal), "verificacion", "otro". */
  kind?: string;
  receivedAt: number;
}

/** Usuario del panel (dueño, admin o vendedor). La contraseña se guarda como hash scrypt. */
export interface StaffUser {
  id: Id;
  username: string;
  name: string;
  role: "owner" | "admin" | "seller";
  passwordHash: string;
  active: boolean;
  createdAt: number;
}

export interface State {
  products: Record<Id, Product>;
  priceGroups: Record<Id, PriceGroup>;
  suppliers: Record<Id, Supplier>;
  accounts: Record<Id, Account>;
  slots: Record<Id, Slot>;
  customers: Record<Id, Customer>;
  orders: Record<Id, Order>;
  assignments: Record<Id, Assignment>;
  ledger: LedgerEntry[];
  audit: AuditEvent[];
  outbox: OutboxMessage[];
  mailboxes: Record<Id, Mailbox>;
  resellerApps: Record<Id, ResellerApp>;
  codes: CodeMessage[];
  idempotency: Record<string, unknown>;
  staff: Record<Id, StaffUser>;
  chats: Record<string, ChatThread>;
  settings: StoreSettings;
  /** Gastos manuales del dueño (para Finanzas: lo que salió). */
  expenses: Expense[];
  /** Cupones de descuento. */
  coupons: Record<Id, Coupon>;
  seq: number;
}

/** Gasto manual que carga el dueño (proveedor, internet, etc.). */
export interface Expense {
  id: Id;
  amount: Cents;
  note: string;
  at: number;
}

/** Cupón de descuento. `value`: porcentaje (1–90) o monto fijo en centavos. */
export interface Coupon {
  id: Id;
  code: string;
  type: "percent" | "fixed";
  value: number;
  expiresAt?: number;
  /** Usos en total (sin límite si falta). */
  maxUses?: number;
  /** Usos por cliente (sin límite si falta). */
  perCustomer?: number;
  /** Compra mínima, en centavos. */
  minTotal?: Cents;
  /** Si se llena, el descuento solo cuenta sobre estos productos. */
  productIds?: Id[];
  /** Los revendedores también lo pueden usar (si no, es solo para clientes). */
  resellers: boolean;
  active: boolean;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
