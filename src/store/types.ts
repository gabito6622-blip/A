// Modelo de dominio de Gabriel Store.
// Montos SIEMPRE en centavos (enteros) para evitar errores de coma flotante.

export type Cents = number;
export type Id = string;

export type Role = "owner" | "admin" | "seller" | "reseller" | "customer" | "system";

/** Quién ejecuta una operación. `customerId` es obligatorio para customer/reseller. */
export interface Actor {
  id: Id;
  role: Role;
  customerId?: Id;
}

export type ProductKind = "profile" | "full_account" | "invite" | "combo";

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
}

/** Configuración de la tienda que ve el cliente. */
export interface StoreSettings {
  storeName: string;
  /** WhatsApp de ventas, solo dígitos con código de país. */
  whatsapp: string;
  currency: "BOB";
  /** Archivo del QR de cobro (subido por el staff). */
  qrFileRef?: string;
  /** Texto bajo el QR: banco, titular, instrucciones. */
  paymentNote?: string;
  /** Apariencia de la tienda. */
  accentColor?: string;
  backgroundColor?: string;
  logoFileRef?: string;
  heroTitle?: string;
  heroHighlight?: string;
  heroText?: string;
  /** Aviso corto arriba de todo (promos, horarios). Vacío = no se muestra. */
  announcement?: string;
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
  priceGroupId: Id;
  /** Consentimiento explícito para recibir WhatsApp. Sin él no se envía nada. */
  whatsappConsent: boolean;
  createdAt: number;
  /** Notas internas del staff (nunca se muestran al cliente). */
  notes?: string;
}

export type OrderKind = "sale" | "renewal" | "topup";
export type OrderStatus =
  | "awaiting_payment"
  | "payment_review"
  | "fulfilled"
  | "rejected"
  | "expired"
  | "cancelled";
export type PaymentMethod = "qr" | "balance" | "cash";

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
  createdAt: number;
  updatedAt: number;
}

export type AssignmentStatus = "active" | "replaced" | "revoked";

export interface AssignmentEvent {
  at: number;
  by: Id;
  event: "assigned" | "renewed" | "replaced" | "revoked" | "access_updated" | "transferred";
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
}

export type LedgerType = "topup" | "purchase" | "renewal" | "refund" | "adjustment";

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
  customerId: Id;
  to: string;
  template: TemplateId;
  params: Record<string, string>;
  text: string;
  status: "queued" | "skipped_no_consent" | "sent" | "sent_manually" | "failed";
  error?: string;
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
}

export interface CodeMessage {
  id: Id;
  mailboxId: Id;
  /** Destinatario: el email de la cuenta de la plataforma. */
  to: string;
  subject: string;
  code: string;
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
  codes: CodeMessage[];
  idempotency: Record<string, unknown>;
  staff: Record<Id, StaffUser>;
  settings: StoreSettings;
  seq: number;
}
