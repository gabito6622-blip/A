import type { Client } from "./db.js";
import type { AuthCtx } from "./rbac.js";

/** Registra un evento de auditoría inmutable dentro de la misma transacción. */
export async function audit(
  c: Client,
  a: Pick<AuthCtx, "userId" | "clinicId" | "ip"> | null,
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
  branchId: string | null = null,
): Promise<void> {
  await c.query(
    `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a?.clinicId ?? null, a?.userId ?? null, action, entity, entityId, branchId, JSON.stringify(data), a?.ip ?? null],
  );
}
