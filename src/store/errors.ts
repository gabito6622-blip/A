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
  | "SENSITIVE_DATA";

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
