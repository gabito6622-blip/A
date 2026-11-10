// Periodontograma (B-042): exploraciones en borrador con guardado automático, cierre inmutable,
// enmiendas, copia desde la exploración anterior y comparación por sitio.
// Validación, índices y comparación vienen del módulo puro lib/perio.ts (el mismo que usa la interfaz).
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zId, zIdParams, zOptText } from "../lib/http.js";
import type { Client } from "../lib/db.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { requireBranch } from "../lib/rbac.js";
import {
  PERMANENT_TEETH, compareExams, computeIndices, emptyPerio, validatePerio,
  type Issue, type PerioData, type ToothData,
} from "../lib/perio.js";

const tags = ["periodontograma"];

// Estructura mínima para la documentación OpenAPI; la validación fina (rangos, piezas, sitios)
// la hace validatePerio() con mensajes por pieza y sitio, sin recortar nada.
const zPerioData = z.strictObject({
  v: z.literal(1, { message: "Versión de formato no soportada (se espera 1)" }),
  primary: z.array(z.number()).default([]),
  teeth: z.record(z.string(), z.any()),
});

const rejectIssues = (issues: Issue[], what = "El periodontograma tiene valores inválidos") => {
  if (issues.length) throw new AppError(400, "perio_invalid", `${what}: ${issues[0]!.message}${issues.length > 1 ? ` (y ${issues.length - 1} problema(s) más)` : ""}`, issues);
};

interface ExamRow {
  id: string; patient_id: string; branch_id: string; examiner_id: string; status: "draft" | "closed" | "discarded";
  origin: string; source_exam_id: string | null; amends_exam_id: string | null; data: PerioData; revision: number;
  indices: unknown; notes: string | null; close_note: string | null; created_at: Date; updated_at: Date;
  closed_at: Date | null; discarded_at: Date | null; discard_reason: string | null;
  examiner_name: string; branch_name: string; closed_by_name: string | null; amended_by: string | null; amended_by_status: string | null;
}

const EXAM_SELECT = `
  SELECT e.*, u.full_name AS examiner_name, b.name AS branch_name, cu.full_name AS closed_by_name,
         am.id AS amended_by, am.status AS amended_by_status
    FROM perio_exams e
    JOIN users u ON u.id = e.examiner_id
    JOIN branches b ON b.id = e.branch_id
    LEFT JOIN users cu ON cu.id = e.closed_by
    LEFT JOIN perio_exams am ON am.amends_exam_id = e.id AND am.status <> 'discarded'`;

async function loadExam(c: Client, id: string): Promise<ExamRow> {
  const r = (await c.query<ExamRow>(`${EXAM_SELECT} WHERE e.id = $1`, [id])).rows[0];
  if (!r) throw notFound("Exploración periodontal");
  return r;
}

function present(r: ExamRow, full = true) {
  const live = computeIndices(r.data);
  return {
    id: r.id, patientId: r.patient_id, branchId: r.branch_id, branchName: r.branch_name,
    examinerId: r.examiner_id, examinerName: r.examiner_name, status: r.status, origin: r.origin,
    sourceExamId: r.source_exam_id, amendsExamId: r.amends_exam_id,
    amendedBy: r.amended_by ? { id: r.amended_by, status: r.amended_by_status } : null,
    revision: r.revision, notes: r.notes, closeNote: r.close_note,
    createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, closedByName: r.closed_by_name,
    discardedAt: r.discarded_at, discardReason: r.discard_reason,
    // Cerrada: los índices congelados al cerrar. Borrador: el mismo cálculo en vivo.
    indices: r.status === "closed" && r.indices ? r.indices : live,
    ...(full ? { data: r.data, closeIssues: r.status === "draft" ? validatePerio(r.data, { forClose: true }) : [] } : {}),
  };
}

async function requirePatient(c: Client, id: string) {
  if (!(await c.query("SELECT 1 FROM patients WHERE id = $1", [id])).rowCount) throw notFound("Paciente");
}

/** Ausentes e implantes vigentes según el odontograma (PE-02: se toman de allí y se pueden cambiar). */
async function fromOdontogram(c: Client, patientId: string): Promise<{ data: PerioData; teeth: number[] }> {
  const rows = (await c.query<{ tooth: number; condition: string }>(
    `SELECT e.tooth, e.condition FROM odontogram_entries e
      WHERE e.patient_id = $1 AND e.voids_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM odontogram_entries v WHERE v.voids_entry_id = e.id)
        AND ((e.condition = 'missing' AND e.state IN ('existing','completed'))
          OR (e.condition = 'extraction' AND e.state = 'completed')
          OR (e.condition = 'implant' AND e.state IN ('existing','completed')))
      ORDER BY e.recorded_at, e.id`, [patientId])).rows;
  const data = emptyPerio();
  for (const r of rows) {
    if (!PERMANENT_TEETH.includes(r.tooth)) continue;
    const t = (data.teeth[String(r.tooth)] ??= {});
    if (r.condition === "implant") { t.implant = true; delete t.missing; } else { t.missing = true; delete t.implant; }
  }
  return { data, teeth: Object.keys(data.teeth).map(Number) };
}

/** PE-07: de la exploración anterior se copian ausentes, implantes, movilidad y la dentición temporal; nunca sondajes. */
export function copyFromPrevious(prev: PerioData): PerioData {
  const out: PerioData = { v: 1, primary: [...(prev.primary ?? [])], teeth: {} };
  for (const [k, t] of Object.entries(prev.teeth)) {
    const n: ToothData = {};
    if (t.missing) n.missing = true;
    if (t.implant) n.implant = true;
    if (t.mobility != null && !t.missing) n.mobility = t.mobility;
    if (Object.keys(n).length) out.teeth[k] = n;
  }
  return out;
}

export function perioRoutes(route: Route) {
  route({
    method: "GET", url: "/api/patients/:id/perio-exams", summary: "Exploraciones periodontales del paciente (con índices y denominadores)", tags,
    perm: "clinical.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      await requirePatient(c, params.id);
      const rows = (await c.query<ExamRow>(`${EXAM_SELECT} WHERE e.patient_id = $1 ORDER BY e.created_at DESC`, [params.id])).rows;
      await audit(c, auth, "perio.list_viewed", "patient", params.id, { count: rows.length });
      return rows.map((r) => present(r, false));
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/perio-exams",
    summary: "Iniciar exploración: en blanco (ausentes e implantes del odontograma), desde la anterior (copia ausentes, implantes y movilidad, nunca sondajes) o como enmienda de una cerrada",
    tags, perm: "clinical.write", params: zIdParams,
    body: z.object({
      branchId: zId,
      mode: z.enum(["blank", "previous", "amendment"]).default("blank"),
      sourceExamId: zId.nullish(),
      notes: zOptText(2000),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireBranch(auth, body.branchId);
      await requirePatient(c, params.id);
      const draft = (await c.query<{ id: string }>("SELECT id FROM perio_exams WHERE patient_id = $1 AND status = 'draft'", [params.id])).rows[0];
      if (draft) throw new AppError(409, "perio_draft_exists", "Este paciente ya tiene una exploración en borrador. Ciérrala o descártala antes de iniciar otra.", { examId: draft.id });
      let data: PerioData;
      let source: string | null = null;
      let prefilled: number[] = [];
      if (body.mode === "blank") {
        ({ data, teeth: prefilled } = await fromOdontogram(c, params.id));
      } else if (body.mode === "previous") {
        const prev = (await c.query<{ id: string; data: PerioData }>(
          "SELECT id, data FROM perio_exams WHERE patient_id = $1 AND status = 'closed' ORDER BY closed_at DESC LIMIT 1", [params.id])).rows[0];
        if (!prev) throw badRequest("Este paciente no tiene una exploración cerrada anterior. Inicia una en blanco.");
        data = copyFromPrevious(prev.data);
        source = prev.id;
      } else {
        if (!body.sourceExamId) throw badRequest("Indica la exploración que quieres corregir");
        const src = (await c.query<{ id: string; patient_id: string; status: string; data: PerioData }>(
          "SELECT id, patient_id, status, data FROM perio_exams WHERE id = $1", [body.sourceExamId])).rows[0];
        if (!src || src.patient_id !== params.id) throw notFound("Exploración a corregir");
        if (src.status !== "closed") throw badRequest("Solo se corrige (enmienda) una exploración cerrada; un borrador se edita directamente");
        if ((await c.query("SELECT 1 FROM perio_exams WHERE amends_exam_id = $1 AND status <> 'discarded'", [src.id])).rowCount) {
          throw conflict("Esa exploración ya tiene una enmienda. Para corregir de nuevo, enmienda la enmienda.", "perio_already_amended");
        }
        data = src.data;
        source = src.id;
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO perio_exams (clinic_id, patient_id, branch_id, examiner_id, origin, source_exam_id, amends_exam_id, data, notes, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4) RETURNING id`,
        [auth.clinicId, params.id, body.branchId, auth.userId, body.mode, source, body.mode === "amendment" ? source : null, JSON.stringify(data), body.notes],
      );
      const id = r.rows[0]!.id;
      await audit(c, auth, body.mode === "amendment" ? "perio.amendment_started" : "perio.started", "perio_exam", id,
        { patientId: params.id, mode: body.mode, sourceExamId: source, prefilledFromOdontogram: prefilled }, body.branchId);
      return { ...present(await loadExam(c, id)), prefilledFromOdontogram: prefilled };
    },
  });

  route({
    method: "GET", url: "/api/perio-exams/compare", summary: "Comparar dos exploraciones por sitio (mejoró / empeoró / sin cambio) y diferencias de índices", tags,
    perm: "clinical.read",
    query: z.object({ a: zId, b: zId, threshold: z.coerce.number().int().min(1, "El umbral mínimo es 1 mm").max(3, "El umbral máximo es 3 mm").default(2) }),
    handler: async ({ c, auth, query }) => {
      if (query.a === query.b) throw badRequest("Elige dos exploraciones distintas");
      const ea = await loadExam(c, query.a), eb = await loadExam(c, query.b);
      if (ea.patient_id !== eb.patient_id) throw badRequest("Las dos exploraciones deben ser del mismo paciente");
      if (ea.status === "discarded" || eb.status === "discarded") throw badRequest("No se comparan exploraciones descartadas");
      // a = la más antigua, b = la más reciente (el signo de las diferencias siempre es "después − antes").
      const [older, newer] = ea.created_at <= eb.created_at ? [ea, eb] : [eb, ea];
      await audit(c, auth, "perio.compared", "patient", ea.patient_id, { a: older.id, b: newer.id, threshold: query.threshold });
      return { a: present(older, false), b: present(newer, false), comparison: compareExams(older.data, newer.data, query.threshold) };
    },
  });

  route({
    method: "GET", url: "/api/perio-exams/:id", summary: "Ver una exploración periodontal (datos, índices y lo que falta para cerrar)", tags,
    perm: "clinical.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const r = await loadExam(c, params.id);
      await audit(c, auth, "perio.viewed", "perio_exam", r.id, { patientId: r.patient_id, status: r.status });
      return present(r);
    },
  });

  route({
    method: "PUT", url: "/api/perio-exams/:id", summary: "Guardado automático del borrador (rechaza valores fuera de rango; nunca los recorta)", tags,
    perm: "clinical.write", params: zIdParams,
    body: z.object({ revision: z.number().int().min(0), data: zPerioData, notes: zOptText(2000).optional() }),
    handler: async ({ c, auth, params, body }) => {
      const cur = await loadExam(c, params.id);
      requireBranch(auth, cur.branch_id);
      if (cur.status !== "draft") throw conflict(cur.status === "closed" ? "La exploración ya está cerrada: no se modifica. Para corregirla crea una enmienda." : "La exploración fue descartada", "perio_not_draft");
      rejectIssues(validatePerio(body.data));
      const notes = body.notes === undefined ? cur.notes : body.notes;
      const u = await c.query<{ revision: number; updated_at: Date }>(
        `UPDATE perio_exams SET data = $2, notes = $3, revision = revision + 1, updated_at = now(), updated_by = $4
          WHERE id = $1 AND revision = $5 AND status = 'draft' RETURNING revision, updated_at`,
        [params.id, JSON.stringify(body.data), notes, auth.userId, body.revision],
      );
      if (!u.rowCount) throw conflict("Este borrador se guardó desde otra pantalla o dispositivo. Recarga para ver la última versión antes de seguir.", "perio_revision_conflict");
      const ix = computeIndices(body.data as PerioData);
      await audit(c, auth, "perio.saved", "perio_exam", params.id, { revision: u.rows[0]!.revision, sitesMeasured: ix.sitesMeasured }, cur.branch_id);
      return { revision: u.rows[0]!.revision, updatedAt: u.rows[0]!.updated_at, indices: ix };
    },
  });

  route({
    method: "POST", url: "/api/perio-exams/:id/close",
    summary: "Cerrar la exploración: guarda los últimos cambios y la congela en la misma transacción; si algo es inválido no se cierra", tags,
    perm: "clinical.write", params: zIdParams,
    body: z.object({ revision: z.number().int().min(0), data: zPerioData.optional(), note: zOptText(1000) }),
    handler: async ({ c, auth, params, body }) => {
      const cur = await loadExam(c, params.id);
      requireBranch(auth, cur.branch_id);
      if (cur.status !== "draft") throw conflict(cur.status === "closed" ? "La exploración ya estaba cerrada" : "La exploración fue descartada", "perio_not_draft");
      if (cur.revision !== body.revision) throw conflict("Hay cambios guardados desde otra pantalla o dispositivo. Recarga antes de cerrar.", "perio_revision_conflict");
      const data = (body.data ?? cur.data) as PerioData;
      if (body.data) rejectIssues(validatePerio(body.data));
      rejectIssues(validatePerio(data, { forClose: true }), "No se puede cerrar");
      const indices = computeIndices(data);
      const u = await c.query(
        `UPDATE perio_exams SET data = $2, indices = $3, status = 'closed', close_note = $4, closed_at = now(), closed_by = $5,
                revision = revision + 1, updated_at = now(), updated_by = $5
          WHERE id = $1 AND revision = $6 AND status = 'draft'`,
        [params.id, JSON.stringify(data), JSON.stringify(indices), body.note, auth.userId, body.revision],
      );
      if (!u.rowCount) throw conflict("La exploración cambió mientras se cerraba. Recarga e intenta de nuevo.", "perio_revision_conflict");
      await audit(c, auth, "perio.closed", "perio_exam", params.id, {
        patientId: cur.patient_id, amendsExamId: cur.amends_exam_id, sitesMeasured: indices.sitesMeasured,
        bleedingPct: indices.bleeding.pct, meanPd: indices.meanPd.value,
      }, cur.branch_id);
      return present(await loadExam(c, params.id));
    },
  });

  route({
    method: "POST", url: "/api/perio-exams/:id/discard", summary: "Descartar un borrador (queda en el historial como descartado; nunca se borra)", tags,
    perm: "clinical.write", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Indica el motivo (3 caracteres o más)").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const cur = await loadExam(c, params.id);
      requireBranch(auth, cur.branch_id);
      if (cur.status !== "draft") throw conflict("Solo se descarta un borrador. Una exploración cerrada se corrige con una enmienda.", "perio_not_draft");
      await c.query(
        "UPDATE perio_exams SET status = 'discarded', discarded_at = now(), discarded_by = $2, discard_reason = $3, updated_at = now(), updated_by = $2 WHERE id = $1 AND status = 'draft'",
        [params.id, auth.userId, body.reason],
      );
      await audit(c, auth, "perio.discarded", "perio_exam", params.id, { patientId: cur.patient_id, reason: body.reason }, cur.branch_id);
      return present(await loadExam(c, params.id));
    },
  });
}

// ---------------------------------------------------------------- Datos demo (ficticios)
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Crea una paciente ficticia con dos exploraciones cerradas (hace 7 meses y hace 1 mes) para la demo. */
export async function seedPerioDemo(q: Q, clinicId: string, branchId: string, dentistId: string): Promise<void> {
  const next = (await q("UPDATE counters SET value = value + 1 WHERE clinic_id = $1 AND name = 'patient' RETURNING value", [clinicId])).rows[0].value;
  const patient = (await q(
    `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, birth_date, sex, city, consent_reminders, search_text, preferred_branch_id)
     VALUES ($1,$2,'Rosa','Perio Demostración','SIN','1968-03-14','F','La Paz', false, $3, $4) RETURNING id`,
    [clinicId, next, `rosa perio demostracion ${next}`, branchId])).rows[0].id;
  // Pseudoaleatorio determinista
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const build = (worse: number): PerioData => {
    const d: PerioData = { v: 1, primary: [], teeth: { "18": { missing: true }, "28": { missing: true }, "38": { missing: true }, "46": { implant: true } } };
    for (const tooth of PERMANENT_TEETH) {
      const t = (d.teeth[String(tooth)] ??= {});
      if (t.missing) continue;
      const molar = tooth % 10 >= 6;
      t.mobility = molar && rnd() < 0.3 * worse ? 1 : 0;
      t.sites = {};
      for (const s of ["MB", "B", "DB", "ML", "L", "DL"] as const) {
        const base = molar ? 3 : 2;
        const pd = Math.min(15, base + Math.floor(rnd() * (2 + 2 * worse)));
        t.sites[s] = { pd, rec: tooth === 46 ? null : Math.floor(rnd() * 2), bop: rnd() < 0.15 + 0.25 * worse, pl: rnd() < 0.2 + 0.3 * worse };
      }
      if (tooth === 16 || tooth === 36) t.furcation = { B: worse > 0.5 ? 2 : 1 };
    }
    return d;
  };
  for (const [monthsAgo, worse] of [[7, 1], [1, 0.3]] as const) {
    const data = build(worse);
    await q(
      `INSERT INTO perio_exams (clinic_id, patient_id, branch_id, examiner_id, status, origin, data, indices, revision,
                                created_at, updated_at, updated_by, closed_at, closed_by, close_note)
       VALUES ($1,$2,$3,$4,'closed','blank',$5,$6,1, now() - make_interval(months => $7), now() - make_interval(months => $7), $4,
               now() - make_interval(months => $7) + interval '40 minutes', $4, 'Exploración de demostración (datos ficticios)')`,
      [clinicId, patient, branchId, dentistId, JSON.stringify(data), JSON.stringify(computeIndices(data)), monthsAgo],
    );
  }
}
