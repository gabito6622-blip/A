import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zId, zIdParams, zOptText } from "../lib/http.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { requireBranch } from "../lib/rbac.js";

/** Catálogo de condiciones del odontograma. surface=true: se marca por superficie. */
export const CONDITIONS: Record<string, { label: string; surface: boolean }> = {
  caries: { label: "Caries", surface: true },
  restoration: { label: "Obturación / restauración", surface: true },
  sealant: { label: "Sellante", surface: true },
  fracture: { label: "Fractura", surface: true },
  crown: { label: "Corona", surface: false },
  endodontics: { label: "Tratamiento de conducto", surface: false },
  extraction: { label: "Extracción", surface: false },
  missing: { label: "Ausente", surface: false },
  implant: { label: "Implante", surface: false },
  pontic: { label: "Póntico (puente)", surface: false },
  removable_prosthesis: { label: "Prótesis removible", surface: false },
  orthodontic_appliance: { label: "Aparato de ortodoncia", surface: false },
  root_remnant: { label: "Resto radicular", surface: false },
  mobility: { label: "Movilidad", surface: false },
  unerupted: { label: "No erupcionado", surface: false },
};

export const PERMANENT_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const PRIMARY_TEETH = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

export function clinicalRoutes(route: Route) {
  route({
    method: "GET", url: "/api/odontogram/conditions", summary: "Catálogo de condiciones y piezas (FDI)", tags: ["clínico"], perm: "clinical.read",
    handler: async () => ({ conditions: CONDITIONS, permanent: PERMANENT_TEETH, primary: PRIMARY_TEETH, surfaces: { M: "Mesial", D: "Distal", O: "Oclusal / incisal", V: "Vestibular", L: "Lingual / palatino" } }),
  });

  route({
    method: "GET", url: "/api/patients/:id/odontogram", summary: "Odontograma: estado vigente e historial completo", tags: ["clínico"], perm: "clinical.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const p = (await c.query("SELECT id FROM patients WHERE id = $1", [params.id])).rowCount;
      if (!p) throw notFound("Paciente");
      const rows = (
        await c.query(
          `SELECT e.id, e.tooth, e.surfaces, e.condition, e.state, e.notes, e.voids_entry_id AS "voidsEntryId",
                  e.budget_item_id AS "budgetItemId", e.recorded_at AS "recordedAt", u.full_name AS "recordedBy"
             FROM odontogram_entries e JOIN users u ON u.id = e.recorded_by
            WHERE e.patient_id = $1 ORDER BY e.recorded_at, e.id`,
          [params.id],
        )
      ).rows;
      const voided = new Set(rows.filter((r) => r.voidsEntryId).map((r) => r.voidsEntryId));
      const active = rows.filter((r) => !r.voidsEntryId && !voided.has(r.id));
      await audit(c, auth, "odontogram.viewed", "patient", params.id);
      return { active, history: rows.map((r) => ({ ...r, voided: voided.has(r.id) })) };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/odontogram", summary: "Registrar hallazgo o tratamiento en una pieza", tags: ["clínico"], perm: "clinical.write", params: zIdParams,
    body: z.object({
      tooth: z.number().int(),
      surfaces: z.array(z.enum(["M", "D", "O", "V", "L"])).max(5).default([]),
      condition: z.string().refine((k) => k in CONDITIONS, "Condición desconocida"),
      state: z.enum(["existing", "planned", "completed"]),
      notes: zOptText(500),
      appointmentId: zId.nullish(),
    }),
    handler: async ({ c, auth, params, body }) => {
      const def = CONDITIONS[body.condition]!;
      if (![...PERMANENT_TEETH, ...PRIMARY_TEETH].includes(body.tooth)) throw badRequest("Pieza dental inválida (notación FDI)");
      const surfaces = [...new Set(body.surfaces)];
      if (def.surface && surfaces.length === 0) throw badRequest(`"${def.label}" requiere indicar superficies`);
      const r = await c.query<{ id: string }>(
        `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, surfaces, condition, state, notes, appointment_id, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, params.id, body.tooth, def.surface ? surfaces : [], body.condition, body.state, body.notes, body.appointmentId ?? null, auth.userId],
      );
      await audit(c, auth, "odontogram.recorded", "patient", params.id, { entryId: r.rows[0]!.id, tooth: body.tooth, condition: body.condition, state: body.state });
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "POST", url: "/api/odontogram/:id/void", summary: "Anular un registro del odontograma (queda en el historial)", tags: ["clínico"], perm: "clinical.write", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Indica el motivo").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const e = (await c.query<{ patient_id: string; tooth: number; voids_entry_id: string | null }>(
        "SELECT patient_id, tooth, voids_entry_id FROM odontogram_entries WHERE id = $1", [params.id])).rows[0];
      if (!e) throw notFound("Registro");
      if (e.voids_entry_id) throw badRequest("No se puede anular una anulación");
      const already = await c.query("SELECT 1 FROM odontogram_entries WHERE voids_entry_id = $1", [params.id]);
      if (already.rowCount) throw conflict("Ese registro ya fue anulado");
      const r = await c.query<{ id: string }>(
        `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, condition, state, notes, voids_entry_id, recorded_by)
         VALUES ($1,$2,$3,'void','existing',$4,$5,$6) RETURNING id`,
        [auth.clinicId, e.patient_id, e.tooth, body.reason, params.id, auth.userId],
      );
      await audit(c, auth, "odontogram.voided", "patient", e.patient_id, { entryId: params.id, reason: body.reason });
      return { id: r.rows[0]!.id };
    },
  });

  // ---------------- Evoluciones clínicas ----------------
  route({
    method: "GET", url: "/api/patients/:id/notes", summary: "Evoluciones y notas clínicas", tags: ["clínico"], perm: "clinical.read", params: zIdParams,
    handler: async ({ c, params }) =>
      (
        await c.query(
          `SELECT n.id, n.kind, n.diagnosis, n.body, n.amends_note_id AS "amendsNoteId", n.appointment_id AS "appointmentId",
                  n.created_at AS "createdAt", u.full_name AS "authorName", m.professional_license AS "authorLicense", b.name AS "branchName",
                  EXISTS (SELECT 1 FROM clinical_notes x WHERE x.amends_note_id = n.id) AS amended
             FROM clinical_notes n JOIN users u ON u.id = n.author_id JOIN branches b ON b.id = n.branch_id
             LEFT JOIN memberships m ON m.clinic_id = n.clinic_id AND m.user_id = n.author_id
            WHERE n.patient_id = $1 ORDER BY n.created_at DESC`,
          [params.id],
        )
      ).rows,
  });

  route({
    method: "POST", url: "/api/patients/:id/notes", summary: "Registrar evolución clínica (inmutable; las correcciones se hacen con enmiendas)", tags: ["clínico"], perm: "clinical.write", params: zIdParams,
    body: z.object({
      branchId: zId,
      appointmentId: zId.nullish(),
      kind: z.enum(["evolution", "diagnosis", "prescription", "referral", "consent", "other"]).default("evolution"),
      diagnosis: zOptText(500),
      body: z.string().trim().min(3, "La nota está vacía").max(20000),
      amendsNoteId: zId.nullish(),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireBranch(auth, body.branchId);
      if (body.amendsNoteId) {
        const n = (await c.query<{ patient_id: string }>("SELECT patient_id FROM clinical_notes WHERE id = $1", [body.amendsNoteId])).rows[0];
        if (!n || n.patient_id !== params.id) throw badRequest("La nota a enmendar no pertenece a este paciente");
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO clinical_notes (clinic_id, patient_id, branch_id, appointment_id, kind, diagnosis, body, amends_note_id, author_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, params.id, body.branchId, body.appointmentId ?? null, body.kind, body.diagnosis, body.body, body.amendsNoteId ?? null, auth.userId],
      );
      await audit(c, auth, body.amendsNoteId ? "clinical_note.amended" : "clinical_note.created", "patient", params.id, { noteId: r.rows[0]!.id, kind: body.kind }, body.branchId);
      return { id: r.rows[0]!.id };
    },
  });
}
