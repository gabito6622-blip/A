// Errores de dominio con mensajes en español, y traducción de errores de PostgreSQL.
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Registro") => new AppError(404, "not_found", `${what} no encontrado`);
export const forbidden = (msg = "No tienes permiso para esta acción") => new AppError(403, "forbidden", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const conflict = (msg: string, code = "conflict") => new AppError(409, code, msg);

const CONSTRAINT_MESSAGES: Record<string, [string, string]> = {
  appt_no_overlap_dentist: ["appointment_overlap_dentist", "El profesional ya tiene una cita en ese horario"],
  appt_no_overlap_chair: ["appointment_overlap_chair", "El consultorio ya está ocupado en ese horario"],
  appt_no_overlap_patient: ["appointment_overlap_patient", "El paciente ya tiene otra cita en ese horario"],
  patients_document_uq: ["duplicate_document", "Ya existe un paciente con ese documento"],
  payments_bankref_uq: ["duplicate_bank_reference", "Esa referencia bancaria ya fue registrada en otro pago"],
  charges_void_once: ["already_voided", "Ese cargo ya fue anulado"],
  users_email_uq: ["duplicate_email", "Ya existe un usuario con ese correo"],
  memberships_clinic_id_user_id_key: ["duplicate_membership", "Esa persona ya pertenece a la clínica"],
  branches_clinic_id_code_key: ["duplicate_code", "Ya existe una sucursal con ese código"],
  procedures_clinic_id_code_key: ["duplicate_code", "Ya existe una prestación con ese código"],
  chairs_branch_id_name_key: ["duplicate_name", "Ya existe un consultorio con ese nombre en la sucursal"],
  clinics_slug_key: ["duplicate_slug", "Ese identificador de clínica ya está en uso"],
};

export function fromPgError(e: unknown): AppError | null {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (!err || typeof err.code !== "string") return null;
  const mapped = err.constraint ? CONSTRAINT_MESSAGES[err.constraint] : undefined;
  if (mapped) return new AppError(409, mapped[0], mapped[1]);
  switch (err.code) {
    case "23P01": return new AppError(409, "overlap", "El horario se superpone con otro registro");
    case "23505": return new AppError(409, "duplicate", "Ya existe un registro con esos datos");
    case "23503": return new AppError(400, "invalid_reference", "Una referencia no existe o pertenece a otra clínica");
    case "23514": return new AppError(400, "invalid_value", "Algún valor no es válido");
    case "42501": return new AppError(403, "immutable", err.message ?? "Operación no permitida");
    case "22P02": return new AppError(400, "invalid_format", "Formato de dato inválido");
    default: return null;
  }
}
