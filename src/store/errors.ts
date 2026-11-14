export type ErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "OUT_OF_STOCK"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_STATE"
  | "ALREADY_PROCESSED"
  | "SUPPLIER_EXPIRY_EXCEEDED"
  | "NO_CONSENT"
  | "DUPLICATE_EVIDENCE"
  | "SENSITIVE_DATA"
  /** Ya hay un cobro anotado en este período: hace falta confirmar que es otro mes (cobrarBien.ts). */
  | "DOUBLE_CHARGE"
  /** Ya hay una renovación de ese servicio esperando pago o en revisión (renovarSinTrabas.ts): no se crea otra. */
  | "PENDING_RENEWAL";

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
