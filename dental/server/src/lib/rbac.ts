// Roles y permisos. Se validan SIEMPRE en el servidor (el frontend solo oculta botones).
import { forbidden } from "./errors.js";

export const ROLES = ["owner", "admin", "receptionist", "dentist", "assistant", "accountant", "support"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  receptionist: "Recepción",
  dentist: "Odontólogo",
  assistant: "Asistente",
  accountant: "Contabilidad",
  support: "Limpieza y apoyo",
};

export type Permission =
  | "clinic.manage" | "staff.manage" | "audit.read"
  | "patients.read" | "patients.write" | "patients.import" | "patients.export"
  | "agenda.read" | "agenda.write"
  | "clinical.read" | "clinical.write"
  | "budgets.read" | "budgets.write" | "treatments.perform"
  | "payments.read" | "payments.create" | "payments.verify" | "payments.void"
  | "reports.financial" | "reports.operational"
  | "assistant.use"
  | "biosafety.read" | "biosafety.write"
  | "inventory.read" | "inventory.write" | "inventory.manage"
  | "timeclock.punch";

const BASE: Record<Role, Permission[]> = {
  owner: [
    "clinic.manage", "staff.manage", "audit.read", "patients.read", "patients.write", "patients.import", "patients.export",
    "agenda.read", "agenda.write", "budgets.read", "budgets.write", "payments.read", "payments.create", "payments.verify",
    "payments.void", "reports.financial", "reports.operational", "assistant.use", "biosafety.read",
    "inventory.read", "inventory.write", "inventory.manage",
  ],
  admin: [
    "clinic.manage", "staff.manage", "audit.read", "patients.read", "patients.write", "patients.import", "patients.export",
    "agenda.read", "agenda.write", "budgets.read", "budgets.write", "payments.read", "payments.create", "payments.verify",
    "payments.void", "reports.financial", "reports.operational", "assistant.use", "biosafety.read", "biosafety.write",
    "inventory.read", "inventory.write", "inventory.manage",
  ],
  receptionist: [
    "patients.read", "patients.write", "agenda.read", "agenda.write", "budgets.read", "budgets.write",
    "payments.read", "payments.create", "reports.operational", "assistant.use", "inventory.read",
  ],
  dentist: [
    "patients.read", "patients.write", "agenda.read", "agenda.write", "clinical.read", "clinical.write",
    "budgets.read", "budgets.write", "treatments.perform", "assistant.use", "biosafety.read", "biosafety.write",
    "inventory.read", "inventory.write",
  ],
  assistant: ["patients.read", "patients.write", "agenda.read", "agenda.write", "clinical.read", "assistant.use", "biosafety.read", "biosafety.write", "inventory.read", "inventory.write"],
  accountant: ["patients.read", "budgets.read", "payments.read", "payments.verify", "reports.financial", "assistant.use", "inventory.read"],
  // Limpieza y apoyo: solo bioseguridad (mínimo privilegio; sin datos de pacientes).
  support: ["biosafety.read", "biosafety.write"],
};

// Propietarios/administradores que además atienden (is_professional) acceden a lo clínico.
const PROFESSIONAL_EXTRA: Permission[] = ["clinical.read", "clinical.write", "treatments.perform"];

export function permissionsFor(role: Role, isProfessional: boolean): Set<Permission> {
  const set = new Set<Permission>(BASE[role]);
  set.add("timeclock.punch"); // fichar la propia entrada/salida: todos los roles; además se exige tenerlo activado (timeclock_staff)
  if (isProfessional && (role === "owner" || role === "admin")) PROFESSIONAL_EXTRA.forEach((p) => set.add(p));
  return set;
}

export interface Membership {
  id: string;
  clinicId: string;
  role: Role;
  allBranches: boolean;
  branchIds: string[];
  isProfessional: boolean;
}

export interface AuthCtx {
  userId: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  sessionId: string;
  csrfToken: string;
  clinicId: string | null;
  membership: Membership | null;
  permissions: Set<Permission>;
  ip: string;
  /** Contraseña correcta pero falta el segundo paso (TOTP). */
  mfaPending: boolean;
  mfaEnabled: boolean;
  /** La política de la clínica exige 2 pasos para este rol y el usuario aún no lo activó. */
  mfaEnrollmentRequired: boolean;
  mustChangePassword: boolean;
}

export function can(a: AuthCtx, p: Permission): boolean {
  return a.permissions.has(p);
}

export function requirePerm(a: AuthCtx, p: Permission): void {
  if (!a.permissions.has(p)) throw forbidden();
}

export function hasAllBranches(a: AuthCtx): boolean {
  const m = a.membership;
  return !!m && (m.allBranches || m.role === "owner");
}

/** Sucursales permitidas (null = todas). */
export function allowedBranches(a: AuthCtx): string[] | null {
  if (!a.membership) return [];
  return hasAllBranches(a) ? null : a.membership.branchIds;
}

export function canAccessBranch(a: AuthCtx, branchId: string): boolean {
  const allowed = allowedBranches(a);
  return allowed === null || allowed.includes(branchId);
}

export function requireBranch(a: AuthCtx, branchId: string): void {
  if (!canAccessBranch(a, branchId)) throw forbidden("No tienes acceso a esa sucursal");
}
