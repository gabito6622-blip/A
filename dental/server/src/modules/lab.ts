// Laboratorio protésico (B-063, R2-34): catálogo de laboratorios, órdenes de trabajo con estados
// e historial inmutable, alertas (atrasadas, recibidas sin cita de colocación), pista en la agenda
// y ficha del paciente. Los pagos al laboratorio están en labPayables.ts.
//
// Permisos (reutilizados):
//  * leer órdenes: clinical.read o budgets.read;
//  * crear/editar órdenes y cambiar su estado: clinical.write o budgets.write;
//  * catálogo de laboratorios: clinic.manage;
//  * pagos al laboratorio: payments.verify o clinic.manage (labPayables.ts).
// Como `route()` declara un solo permiso, las rutas usan "patients.read" como puerta mínima
// (todos los roles con acceso a órdenes lo tienen) y verifican la combinación exacta en el handler.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { nextCounter } from "../lib/db.js";
import { allowedBranches, canAccessBranch, requireBranch, type AuthCtx, type Permission } from "../lib/rbac.js";
import { clinicZone } from "./agenda.js";
import { labPayableRoutes } from "./labPayables.js";

export const WORK_TYPES = ["crown", "bridge", "removable", "splint", "veneer", "inlay", "model", "other"] as const;
export const WORK_LABELS: Record<string, string> = {
  crown: "Corona", bridge: "Puente", removable: "Prótesis removible", splint: "Placa", veneer: "Carilla", inlay: "Incrustación", model: "Modelo", other: "Otro",
};
export const LAB_STATUSES = ["draft", "sent", "in_process", "received", "adjustment", "delivered", "cancelled"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
export const LAB_STATUS_LABELS: Record<LabStatus, string> = {
  draft: "Borrador", sent: "Enviado", in_process: "En proceso", received: "Recibido", adjustment: "En ajuste (reenviado)", delivered: "Entregado", cancelled: "Cancelado",
};
/** Transiciones permitidas (la base de datos aplica las mismas con un trigger). */
export const LAB_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["in_process", "received", "cancelled"],
  in_process: ["received", "cancelled"],
  received: ["adjustment", "delivered"],
  adjustment: ["received"],
  delivered: [],
  cancelled: [],
};
export const VITA_SHADES = ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4"] as const;
const PENDING_AT_LAB: LabStatus[] = ["sent", "in_process", "adjustment"];

export function isValidFdi(t: number) {
  const q = Math.floor(t / 10), n = t % 10;
  return Number.isInteger(t) && ((q >= 1 && q <= 4 && n >= 1 && n <= 8) || (q >= 5 && q <= 8 && n >= 1 && n <= 5));
}

/** "corona 11, 21" — etiqueta corta del trabajo (sin datos del paciente). */
export function orderLabel(workType: string, teeth: number[], detail?: string | null) {
  const base = workType === "other" && detail ? detail : (WORK_LABELS[workType] ?? workType).toLowerCase();
  return teeth.length ? `${base} ${teeth.join(", ")}` : base;
}

/** "María José Mamani Quispe" → "M. J. M. Q." (minimización en la orden impresa para el laboratorio). */
export function initials(first: string, last: string) {
  return `${first} ${last}`.split(/\s+/).filter(Boolean).map((w) => `${w[0]!.toUpperCase()}.`).join(" ");
}

export function requireAny(auth: AuthCtx, perms: Permission[], msg?: string) {
  if (!perms.some((p) => auth.permissions.has(p))) throw forbidden(msg);
}
export const LAB_READ: Permission[] = ["clinical.read", "budgets.read"];
export const LAB_WRITE: Permission[] = ["clinical.write", "budgets.write"];
export const LAB_PAY: Permission[] = ["payments.verify", "clinic.manage"];

export async function todayIn(c: Client, clinicId: string) {
  return DateTime.now().setZone(await clinicZone(c, clinicId)).toISODate()!;
}

// Fecha en que el trabajo quedó listo por última vez (tras un ajuste, la del nuevo ingreso).
const READY_AT = `(SELECT max(e.created_at) FROM lab_order_events e WHERE e.order_id = o.id AND e.to_status = 'received')`;
const NO_PLACEMENT = `NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = o.patient_id AND a.status NOT IN ('cancelled','no_show')
  AND a.starts_at >= COALESCE(${READY_AT}, o.received_on::timestamptz))`;
const PAID = `COALESCE((SELECT sum(x.amount_cents) FROM lab_payment_allocations x WHERE x.order_id = o.id
  AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = x.payment_id)), 0)`;

// B-111: lo que el laboratorio cobró de más por reenvíos (movimientos aparte, solo inserción).
const EXTRA = `COALESCE((SELECT sum(e.amount_cents) FROM lab_order_extra_costs e WHERE e.order_id = o.id), 0)`;

const ORDER_COLS = `o.id, o.number, o.status, o.work_type AS "workType", o.work_detail AS "workDetail", o.teeth, o.material, o.shade, o.shade_note AS "shadeNote",
  o.impression, o.instructions, o.attachment_url AS "attachmentUrl", o.sent_on AS "sentOn", o.promised_on AS "promisedOn", o.received_on AS "receivedOn",
  o.delivered_on AS "deliveredOn", o.cost_cents AS "costCents", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
  o.lab_id AS "labId", l.name AS "labName", o.patient_id AS "patientId", p.first_name AS "patientFirstName", p.last_name AS "patientLastName",
  p.record_number AS "recordNumber", o.dentist_id AS "dentistId", u.full_name AS "dentistName", o.branch_id AS "branchId", b.name AS "branchName",
  o.budget_item_id AS "budgetItemId", bi.description AS "budgetItemDescription", bu.number AS "budgetNumber",
  ${PAID} AS "paidCents", ${EXTRA} AS "extraCostCents",
  (o.status = ANY('{sent,in_process,adjustment}') AND o.promised_on < $1::date) AS overdue,
  (o.status = 'received' AND ${NO_PLACEMENT}) AS "readyNoAppointment"`;
const ORDER_FROM = `FROM lab_orders o JOIN labs l ON l.id = o.lab_id JOIN patients p ON p.id = o.patient_id JOIN users u ON u.id = o.dentist_id
  JOIN branches b ON b.id = o.branch_id LEFT JOIN budget_items bi ON bi.id = o.budget_item_id LEFT JOIN budgets bu ON bu.id = bi.budget_id`;

function present(r: Record<string, any>): Record<string, any> {
  const teeth = (r.teeth ?? []).map(Number);
  return {
    ...r, teeth, label: orderLabel(r.workType, teeth, r.workDetail), workLabel: WORK_LABELS[r.workType], statusLabel: LAB_STATUS_LABELS[r.status as LabStatus],
    patientName: `${r.patientFirstName} ${r.patientLastName}`, patientInitials: initials(r.patientFirstName, r.patientLastName),
    extraCostCents: Number(r.extraCostCents ?? 0),
    totalCostCents: r.costCents != null ? Number(r.costCents) + Number(r.extraCostCents ?? 0) : null,
    outstandingCents: r.costCents != null && ["received", "adjustment", "delivered"].includes(r.status) ? Number(r.costCents) + Number(r.extraCostCents ?? 0) - Number(r.paidCents) : null,
    patientFirstName: undefined, patientLastName: undefined,
  };
}

async function loadOrder(c: Client, auth: AuthCtx, id: string, lock = false) {
  const o = (await c.query<{ id: string; status: LabStatus; branch_id: string; patient_id: string; lab_id: string; cost_cents: number | null; sent_on: string | null;
    promised_on: string | null; received_on: string | null; number: number }>(
    `SELECT id, status, branch_id, patient_id, lab_id, cost_cents, sent_on, promised_on, received_on, number FROM lab_orders WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0];
  if (!o || !canAccessBranch(auth, o.branch_id)) throw notFound("Orden de laboratorio");
  return o;
}

const zTeeth = z.array(z.number().int()).max(32, "Máximo 32 piezas").transform((t, ctx) => {
  const bad = t.filter((x) => !isValidFdi(x));
  if (bad.length) ctx.addIssue({ code: "custom", message: `Pieza(s) inválida(s) en notación FDI: ${bad.join(", ")}` });
  return [...new Set(t)].sort((a, b) => a - b);
});
const orderFields = {
  labId: zId,
  dentistId: zId,
  branchId: zId,
  budgetItemId: zId.nullish().transform((v) => v ?? null),
  workType: z.enum(WORK_TYPES, { message: "Elige el tipo de trabajo" }),
  workDetail: zOptText(200),
  teeth: zTeeth.optional(),
  material: zOptText(120),
  shade: z.enum(VITA_SHADES, { message: "Color fuera de la guía Vita clásica" }).nullish().transform((v) => v ?? null),
  shadeNote: zOptText(120),
  impression: z.enum(["physical", "digital"]).nullish().transform((v) => v ?? null),
  instructions: zOptText(2000),
  attachmentUrl: zOptText(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "El adjunto debe ser un enlace que empiece con http:// o https://"),
  promisedOn: zDate.nullish().transform((v) => v ?? null),
  costCents: z.number().int("Costo en centavos (entero)").min(0, "El costo no puede ser negativo").max(100000000, "Costo demasiado alto").nullish().transform((v) => v ?? null),
};

async function validateRefs(c: Client, auth: AuthCtx, b: { labId?: string; dentistId?: string; branchId?: string; budgetItemId?: string | null; workType?: string; workDetail?: string | null }, patientId: string, currentLabId?: string) {
  if (b.branchId) requireBranch(auth, b.branchId);
  if (b.labId && b.labId !== currentLabId) {
    const l = (await c.query<{ active: boolean }>("SELECT active FROM labs WHERE id = $1", [b.labId])).rows[0];
    if (!l) throw badRequest("El laboratorio no existe", { field: "labId" });
    if (!l.active) throw badRequest("El laboratorio está desactivado", { field: "labId" });
  }
  if (b.dentistId) {
    const m = (await c.query("SELECT 1 FROM memberships WHERE user_id = $1 AND clinic_id = $2 AND is_professional AND active", [b.dentistId, auth.clinicId])).rowCount;
    if (!m) throw badRequest("Elige un profesional activo de la clínica", { field: "dentistId" });
  }
  if (b.budgetItemId) {
    const it = (await c.query<{ patient_id: string; status: string }>(
      "SELECT bu.patient_id, bi.status FROM budget_items bi JOIN budgets bu ON bu.id = bi.budget_id WHERE bi.id = $1", [b.budgetItemId])).rows[0];
    if (!it || it.patient_id !== patientId) throw badRequest("El tratamiento del presupuesto no es de este paciente", { field: "budgetItemId" });
    if (it.status === "cancelled") throw badRequest("Ese tratamiento del presupuesto está cancelado", { field: "budgetItemId" });
  }
  if (b.workType === "other" && !b.workDetail) throw badRequest("Describe el trabajo cuando el tipo es «Otro»", { field: "workDetail" });
}

export function labRoutes(route: Route) {
  // ---------------- Laboratorios (catálogo de la clínica) ----------------
  route({
    method: "GET", url: "/api/lab/labs", summary: "Laboratorios de la clínica (lectura: órdenes o pagos al laboratorio)", tags: ["laboratorio"], perm: "patients.read",
    query: z.object({ all: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, auth, query }) => {
      requireAny(auth, [...LAB_READ, ...LAB_PAY]);
      return (await c.query(
        `SELECT id, name, contact_name AS "contactName", phone, whatsapp, email, address, notes, price_list AS "priceList", active,
                (SELECT count(*)::int FROM lab_orders o WHERE o.lab_id = labs.id AND o.status = ANY('{sent,in_process,adjustment}')) AS "openOrders"
           FROM labs WHERE ($1::boolean OR active) ORDER BY active DESC, name`, [query.all === "1"])).rows;
    },
  });

  const zPriceList = z.partialRecord(z.enum(WORK_TYPES), z.number().int().min(0).max(100000000));
  const labBody = z.object({
    name: z.string().trim().min(2, "Nombre de al menos 2 caracteres").max(120),
    contactName: zOptText(120), phone: zOptText(30), whatsapp: zOptText(30), email: zOptText(160), address: zOptText(300), notes: zOptText(1000),
    priceList: zPriceList.optional(),
  });
  route({
    method: "POST", url: "/api/lab/labs", summary: "Registrar un laboratorio", tags: ["laboratorio"], perm: "clinic.manage", body: labBody.extend({ priceList: zPriceList.default({}) }),
    handler: async ({ c, auth, body }) => {
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO labs (clinic_id, name, contact_name, phone, whatsapp, email, address, notes, price_list) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [auth.clinicId, body.name, body.contactName, body.phone, body.whatsapp, body.email, body.address, body.notes, JSON.stringify(body.priceList)]);
        await audit(c, auth, "lab.created", "lab", r.rows[0]!.id, { name: body.name });
        return { id: r.rows[0]!.id };
      } catch (e) {
        if ((e as { constraint?: string }).constraint === "labs_clinic_id_name_key") throw conflict("Ya existe un laboratorio con ese nombre", "duplicate_name");
        throw e;
      }
    },
  });
  route({
    method: "PATCH", url: "/api/lab/labs/:id", summary: "Editar o desactivar un laboratorio", tags: ["laboratorio"], perm: "clinic.manage", params: zIdParams,
    body: labBody.partial().extend({ active: z.boolean().optional() }),
    handler: async ({ c, auth, params, body }) => {
      const cur = (await c.query("SELECT 1 FROM labs WHERE id = $1 FOR UPDATE", [params.id])).rowCount;
      if (!cur) throw notFound("Laboratorio");
      const cols: Record<string, unknown> = {
        name: body.name, contact_name: body.contactName, phone: body.phone, whatsapp: body.whatsapp, email: body.email, address: body.address, notes: body.notes,
        price_list: body.priceList === undefined ? undefined : JSON.stringify(body.priceList), active: body.active,
      };
      const sets = Object.entries(cols).filter(([, v]) => v !== undefined);
      if (!sets.length) return { ok: true };
      try {
        await c.query(`UPDATE labs SET ${sets.map(([k], i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [params.id, ...sets.map(([, v]) => v)]);
      } catch (e) {
        if ((e as { constraint?: string }).constraint === "labs_clinic_id_name_key") throw conflict("Ya existe un laboratorio con ese nombre", "duplicate_name");
        throw e;
      }
      await audit(c, auth, "lab.updated", "lab", params.id, body);
      return { ok: true };
    },
  });

  // ---------------- Órdenes ----------------
  route({
    method: "GET", url: "/api/lab/orders", summary: "Órdenes de laboratorio (filtros: estado, laboratorio, sucursal, paciente, atrasadas, recibidas sin cita)", tags: ["laboratorio"], perm: "patients.read",
    query: z.object({
      status: z.enum([...LAB_STATUSES, "open"]).optional(), labId: zId.optional(), branchId: zId.optional(), patientId: zId.optional(),
      overdue: z.enum(["1", "0"]).optional(), readyNoAppointment: z.enum(["1", "0"]).optional(),
    }),
    handler: async ({ c, auth, query }) => {
      requireAny(auth, LAB_READ);
      if (query.branchId) requireBranch(auth, query.branchId);
      const today = await todayIn(c, auth.clinicId!);
      const rows = (await c.query(
        `SELECT ${ORDER_COLS} ${ORDER_FROM}
          WHERE ($2::uuid[] IS NULL OR o.branch_id = ANY($2)) AND ($3::text IS NULL OR o.status = $3 OR ($3 = 'open' AND o.status NOT IN ('delivered','cancelled')))
            AND ($4::uuid IS NULL OR o.lab_id = $4) AND ($5::uuid IS NULL OR o.branch_id = $5) AND ($6::uuid IS NULL OR o.patient_id = $6)
            AND (NOT $7 OR (o.status = ANY('{sent,in_process,adjustment}') AND o.promised_on < $1::date))
            AND (NOT $8 OR (o.status = 'received' AND ${NO_PLACEMENT}))
          ORDER BY (o.status IN ('delivered','cancelled')), o.promised_on NULLS LAST, o.number DESC LIMIT 500`,
        [today, allowedBranches(auth), query.status ?? null, query.labId ?? null, query.branchId ?? null, query.patientId ?? null,
          query.overdue === "1", query.readyNoAppointment === "1"])).rows;
      return rows.map(present);
    },
  });

  route({
    method: "GET", url: "/api/lab/alerts", summary: "Alertas de laboratorio: órdenes atrasadas y trabajos recibidos sin cita de colocación", tags: ["laboratorio"], perm: "patients.read",
    query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      requireAny(auth, LAB_READ);
      if (query.branchId) requireBranch(auth, query.branchId);
      const today = await todayIn(c, auth.clinicId!);
      const rows = (await c.query(
        `SELECT ${ORDER_COLS} ${ORDER_FROM}
          WHERE ($2::uuid[] IS NULL OR o.branch_id = ANY($2)) AND ($3::uuid IS NULL OR o.branch_id = $3)
            AND ((o.status = ANY('{sent,in_process,adjustment}') AND o.promised_on < $1::date) OR (o.status = 'received' AND ${NO_PLACEMENT}))
          ORDER BY o.promised_on NULLS LAST, o.number`, [today, allowedBranches(auth), query.branchId ?? null])).rows.map(present);
      return { today, overdue: rows.filter((r) => r.overdue), readyNoAppointment: rows.filter((r) => r.readyNoAppointment) };
    },
  });

  route({
    method: "GET", url: "/api/lab/orders/:id", summary: "Detalle de una orden con su historial de estados y pagos", tags: ["laboratorio"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      requireAny(auth, LAB_READ);
      await loadOrder(c, auth, params.id);
      const today = await todayIn(c, auth.clinicId!);
      const r = (await c.query(`SELECT ${ORDER_COLS}, l.phone AS "labPhone", l.whatsapp AS "labWhatsapp", l.contact_name AS "labContact", l.price_list AS "labPriceList",
          m.professional_license AS "dentistLicense", b.address AS "branchAddress", b.phone AS "branchPhone"
        ${ORDER_FROM} JOIN memberships m ON m.clinic_id = o.clinic_id AND m.user_id = o.dentist_id WHERE o.id = $2`, [today, params.id])).rows[0];
      const events = (await c.query(
        `SELECT e.id, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.reason, e.created_at AS "createdAt", u.full_name AS "byName"
           FROM lab_order_events e JOIN users u ON u.id = e.created_by WHERE e.order_id = $1 ORDER BY e.created_at, e.id`, [params.id])).rows
        .map((e) => ({ ...e, toLabel: LAB_STATUS_LABELS[e.toStatus as LabStatus], fromLabel: e.fromStatus ? LAB_STATUS_LABELS[e.fromStatus as LabStatus] : null }));
      const payments = auth.permissions.has("payments.verify") || auth.permissions.has("clinic.manage") || auth.permissions.has("payments.read")
        ? (await c.query(
          `SELECT a.amount_cents AS "amountCents", p.paid_on AS "paidOn", p.method, p.reference,
                  (SELECT v.reason FROM lab_payment_voids v WHERE v.payment_id = p.id) AS "voidReason" FROM lab_payment_allocations a JOIN lab_payments p ON p.id = a.payment_id
            WHERE a.order_id = $1 ORDER BY p.paid_on, p.created_at`, [params.id])).rows
        : [];
      const extraCosts = (await c.query(
        `SELECT e.id, e.amount_cents AS "amountCents", e.charged_on AS "chargedOn", e.reason, e.created_at AS "createdAt", u.full_name AS "byName"
           FROM lab_order_extra_costs e JOIN users u ON u.id = e.created_by WHERE e.order_id = $1 ORDER BY e.created_at`, [params.id])).rows;
      const can = LAB_WRITE.some((p) => auth.permissions.has(p));
      return { ...present(r), events, payments, extraCosts, canWrite: can, transitions: can ? LAB_TRANSITIONS[r.status as LabStatus] : [], canEdit: can && !["delivered", "cancelled"].includes(r.status) };
    },
  });

  route({
    method: "POST", url: "/api/lab/orders", summary: "Crear una orden de laboratorio (queda en borrador; puede enviarse en el mismo paso)", tags: ["laboratorio"], perm: "patients.read",
    body: z.object({ patientId: zId, ...orderFields, teeth: zTeeth.default([]), send: z.boolean().default(false), sentOn: zDate.nullish() }),
    handler: async ({ c, auth, body }) => {
      requireAny(auth, LAB_WRITE);
      const pt = (await c.query<{ archived_at: Date | null }>("SELECT archived_at FROM patients WHERE id = $1", [body.patientId])).rows[0];
      if (!pt) throw notFound("Paciente");
      await validateRefs(c, auth, body, body.patientId);
      const today = await todayIn(c, auth.clinicId!);
      const sentOn = body.send ? body.sentOn ?? today : null;
      if (sentOn && sentOn > today) throw badRequest("La fecha de envío no puede ser futura", { field: "sentOn" });
      if (body.promisedOn && sentOn && body.promisedOn < sentOn) throw badRequest("La fecha prometida debe ser igual o posterior al envío", { field: "promisedOn" });
      const number = await nextCounter(c, auth.clinicId!, "lab_order");
      const r = await c.query<{ id: string }>(
        `INSERT INTO lab_orders (clinic_id, number, lab_id, patient_id, budget_item_id, dentist_id, branch_id, work_type, work_detail, teeth, material, shade, shade_note,
                                 impression, instructions, attachment_url, promised_on, cost_cents, status, sent_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
        [auth.clinicId, number, body.labId, body.patientId, body.budgetItemId, body.dentistId, body.branchId, body.workType, body.workDetail, body.teeth, body.material,
          body.shade, body.shadeNote, body.impression, body.instructions, body.attachmentUrl, body.promisedOn, body.costCents, sentOn ? "sent" : "draft", sentOn, auth.userId]);
      const id = r.rows[0]!.id;
      await c.query("INSERT INTO lab_order_events (clinic_id, order_id, from_status, to_status, created_by) VALUES ($1,$2,NULL,'draft',$3)", [auth.clinicId, id, auth.userId]);
      if (sentOn) await c.query("INSERT INTO lab_order_events (clinic_id, order_id, from_status, to_status, created_by) VALUES ($1,$2,'draft','sent',$3)", [auth.clinicId, id, auth.userId]);
      await audit(c, auth, "lab_order.created", "lab_order", id, { number, labId: body.labId, workType: body.workType, teeth: body.teeth, sent: !!sentOn, costCents: body.costCents }, body.branchId);
      return { id, number };
    },
  });

  route({
    method: "PATCH", url: "/api/lab/orders/:id", summary: "Editar una orden abierta (el costo solo hasta la recepción del trabajo)", tags: ["laboratorio"], perm: "patients.read", params: zIdParams,
    body: z.object(orderFields).partial(),
    handler: async ({ c, auth, params, body }) => {
      requireAny(auth, LAB_WRITE);
      const o = await loadOrder(c, auth, params.id, true);
      requireBranch(auth, o.branch_id);
      if (o.status === "delivered" || o.status === "cancelled") throw conflict("La orden está cerrada (entregada o cancelada) y no se modifica", "lab_order_closed");
      if (body.costCents !== undefined && body.costCents !== o.cost_cents && ["received", "adjustment"].includes(o.status)) {
        throw conflict("El costo quedó fijo al recibir el trabajo", "lab_cost_locked");
      }
      if (body.labId !== undefined && body.labId !== o.lab_id && o.received_on) throw conflict("El laboratorio no se cambia después de recibir el trabajo", "lab_locked");
      const cur = (await c.query<{ work_type: string; work_detail: string | null }>("SELECT work_type, work_detail FROM lab_orders WHERE id = $1", [params.id])).rows[0]!;
      await validateRefs(c, auth, { ...body, workType: body.workType ?? cur.work_type, workDetail: body.workDetail !== undefined ? body.workDetail : cur.work_detail }, o.patient_id, o.lab_id);
      const promised = body.promisedOn !== undefined ? body.promisedOn : o.promised_on;
      if (promised && o.sent_on && promised < o.sent_on) throw badRequest("La fecha prometida debe ser igual o posterior al envío", { field: "promisedOn" });
      const map: Record<string, string> = {
        labId: "lab_id", dentistId: "dentist_id", branchId: "branch_id", budgetItemId: "budget_item_id", workType: "work_type", workDetail: "work_detail", teeth: "teeth",
        material: "material", shade: "shade", shadeNote: "shade_note", impression: "impression", instructions: "instructions", attachmentUrl: "attachment_url",
        promisedOn: "promised_on", costCents: "cost_cents",
      };
      const sets = Object.entries(body).filter(([k, v]) => v !== undefined && map[k]);
      if (!sets.length) return { ok: true };
      await c.query(`UPDATE lab_orders SET ${sets.map(([k], i) => `${map[k]} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [params.id, ...sets.map(([, v]) => v)]);
      await audit(c, auth, "lab_order.updated", "lab_order", params.id, { number: o.number, changes: Object.fromEntries(sets) }, body.branchId ?? o.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/lab/orders/:id/transition", summary: "Cambiar el estado de una orden (enviar, en proceso, recibir, ajuste con motivo, entregar, cancelar con motivo)", tags: ["laboratorio"], perm: "patients.read",
    params: zIdParams,
    body: z.object({
      to: z.enum(LAB_STATUSES),
      reason: zOptText(500),
      date: zDate.nullish().transform((v) => v ?? null),
      costCents: z.number().int().min(0).max(100000000).nullish().transform((v) => v ?? null),
      promisedOn: zDate.nullish().transform((v) => v ?? null),
      // B-111: al recibir un trabajo reenviado, lo que el laboratorio cobra de más (0 o vacío si no cobra).
      extraCostCents: z.number().int().min(0).max(100000000).nullish().transform((v) => v ?? null),
      extraCostReason: zOptText(300),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireAny(auth, LAB_WRITE);
      const o = await loadOrder(c, auth, params.id, true);
      requireBranch(auth, o.branch_id);
      if (!LAB_TRANSITIONS[o.status].includes(body.to)) {
        throw conflict(`No se puede pasar de «${LAB_STATUS_LABELS[o.status]}» a «${LAB_STATUS_LABELS[body.to]}»`, "invalid_transition");
      }
      if ((body.to === "adjustment" || body.to === "cancelled") && (!body.reason || body.reason.length < 3)) {
        throw badRequest(body.to === "adjustment" ? "Indica el motivo del ajuste o reenvío" : "Indica el motivo de la cancelación", { field: "reason" });
      }
      const today = await todayIn(c, auth.clinicId!);
      const date = body.date ?? today;
      if (date > today) throw badRequest("La fecha no puede ser futura", { field: "date" });
      const set: Record<string, unknown> = { status: body.to };
      if (body.to === "sent") {
        set.sent_on = date;
        const promised = body.promisedOn ?? o.promised_on;
        if (promised && promised < date) throw badRequest("La fecha prometida debe ser igual o posterior al envío", { field: "promisedOn" });
        if (body.promisedOn) set.promised_on = body.promisedOn;
      }
      if (body.to === "received") {
        const cost = o.received_on ? o.cost_cents : body.costCents ?? o.cost_cents;
        if (cost == null) throw badRequest("Registra el costo del trabajo al recibirlo (queda fijo desde la recepción)", { field: "costCents" });
        if (o.received_on && body.costCents != null && body.costCents !== o.cost_cents) throw conflict("El costo quedó fijo en la primera recepción", "lab_cost_locked");
        if (!o.received_on) {
          if (o.sent_on && date < o.sent_on) throw badRequest("La fecha de recepción no puede ser anterior al envío", { field: "date" });
          set.received_on = date;
          set.cost_cents = cost;
        }
      }
      const extra = body.to === "received" && o.status === "adjustment" && body.extraCostCents ? body.extraCostCents : 0;
      if (body.extraCostCents && !extra) throw badRequest("El costo adicional se registra al recibir un trabajo que volvió del ajuste", { field: "extraCostCents" });
      if (body.to === "adjustment" && body.promisedOn) {
        if (body.promisedOn < today) throw badRequest("La nueva fecha prometida no puede estar en el pasado", { field: "promisedOn" });
        set.promised_on = body.promisedOn;
      }
      if (body.to === "delivered") {
        if (o.received_on && date < o.received_on) throw badRequest("La entrega no puede ser anterior a la recepción", { field: "date" });
        set.delivered_on = date;
      }
      const entries = Object.entries(set);
      await c.query(`UPDATE lab_orders SET ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [params.id, ...entries.map(([, v]) => v)]);
      await c.query("INSERT INTO lab_order_events (clinic_id, order_id, from_status, to_status, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
        [auth.clinicId, params.id, o.status, body.to, body.reason, auth.userId]);
      if (extra) {
        await c.query("INSERT INTO lab_order_extra_costs (clinic_id, order_id, amount_cents, charged_on, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
          [auth.clinicId, params.id, extra, date, body.extraCostReason ?? body.reason ?? "Reenvío o repetición del trabajo", auth.userId]);
      }
      await audit(c, auth, "lab_order.status", "lab_order", params.id, { number: o.number, from: o.status, to: body.to, reason: body.reason, date, costCents: set.cost_cents ?? undefined, extraCostCents: extra || undefined }, o.branch_id);
      return { ok: true, status: body.to };
    },
  });

  // B-111: costo adicional fuera de la recepción (lo cobró después) o corrección con monto negativo.
  route({
    method: "POST", url: "/api/lab/orders/:id/extra-costs", summary: "Registrar un costo adicional del laboratorio (reenvío o repetición) o corregirlo con un monto negativo, con motivo", tags: ["laboratorio"], perm: "patients.read",
    params: zIdParams,
    body: z.object({
      amountCents: z.number().int().refine((v) => v !== 0, "El monto no puede ser cero").refine((v) => Math.abs(v) <= 100000000, "Monto fuera de rango"),
      date: zDate.nullish().transform((v) => v ?? null),
      reason: z.string().trim().min(3, "Escribe el motivo (al menos 3 caracteres)").max(300),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireAny(auth, LAB_WRITE);
      const o = await loadOrder(c, auth, params.id, true);
      requireBranch(auth, o.branch_id);
      if (!["received", "adjustment", "delivered"].includes(o.status)) throw conflict("Solo se registra un costo adicional en órdenes ya recibidas", "not_received");
      const today = await todayIn(c, auth.clinicId!);
      const date = body.date ?? today;
      if (date > today) throw badRequest("La fecha no puede ser futura", { field: "date" });
      if (o.received_on && date < o.received_on) throw badRequest("La fecha no puede ser anterior a la recepción", { field: "date" });
      try {
        await c.query("INSERT INTO lab_order_extra_costs (clinic_id, order_id, amount_cents, charged_on, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
          [auth.clinicId, params.id, body.amountCents, date, body.reason, auth.userId]);
      } catch (e) {
        const msg = (e as { code?: string; message?: string }).code === "23514" ? (e as Error).message : null;
        if (msg) throw conflict(msg, "invalid_extra_cost");
        throw e;
      }
      await audit(c, auth, "lab_order.extra_cost", "lab_order", params.id, { number: o.number, amountCents: body.amountCents, date, reason: body.reason }, o.branch_id);
      return { ok: true };
    },
  });

  // ---------------- Paciente: tratamientos vinculables y pista para la agenda ----------------
  route({
    method: "GET", url: "/api/lab/patients/:id/budget-items", summary: "Tratamientos de presupuestos del paciente que se pueden vincular a una orden", tags: ["laboratorio"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      requireAny(auth, LAB_READ);
      return (await c.query(
        `SELECT bi.id, bi.description, bi.tooth, bi.status, bu.number AS "budgetNumber", pr.category, bu.dentist_id AS "dentistId", bu.branch_id AS "branchId"
           FROM budget_items bi JOIN budgets bu ON bu.id = bi.budget_id JOIN procedures pr ON pr.id = bi.procedure_id
          WHERE bu.patient_id = $1 AND bi.status <> 'cancelled' AND bu.status IN ('draft','presented','accepted','completed')
          ORDER BY bu.number DESC, bi.position`, [params.id])).rows;
    },
  });

  route({
    method: "GET", url: "/api/lab/patients/:id/hints", summary: "Trabajos de laboratorio listos o pendientes del paciente (pista al agendar la colocación)", tags: ["laboratorio"], perm: "patients.read",
    params: zIdParams, query: z.object({ date: zDate.optional() }),
    handler: async ({ c, auth, params, query }) => {
      requireAny(auth, LAB_READ);
      const rows = (await c.query<{ id: string; status: LabStatus; work_type: string; work_detail: string | null; teeth: number[]; promised_on: string | null; lab: string }>(
        `SELECT o.id, o.status, o.work_type, o.work_detail, o.teeth, o.promised_on, l.name AS lab FROM lab_orders o JOIN labs l ON l.id = o.lab_id
          WHERE o.patient_id = $1 AND o.status IN ('sent','in_process','received','adjustment') AND ($2::uuid[] IS NULL OR o.branch_id = ANY($2))
          ORDER BY o.number`, [params.id, allowedBranches(auth)])).rows;
      const lbl = (r: (typeof rows)[number]) => orderLabel(r.work_type, r.teeth.map(Number), r.work_detail);
      return {
        ready: rows.filter((r) => r.status === "received").map((r) => ({ id: r.id, label: lbl(r) })),
        pending: rows.filter((r) => PENDING_AT_LAB.includes(r.status)).map((r) => ({
          id: r.id, label: lbl(r), promisedOn: r.promised_on, lab: r.lab,
          // La cita de colocación no debería ser antes de la fecha prometida (R2-34).
          beforePromised: !!query.date && (!r.promised_on || query.date < r.promised_on),
        })),
      };
    },
  });

  labPayableRoutes(route);
}
