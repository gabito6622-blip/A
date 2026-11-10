// Bioseguridad: limpieza de consultorios y trazabilidad de esterilización.
// Pensado para el personal de limpieza/apoyo y asistentes: registros rápidos, de solo inserción,
// útiles ante una inspección sanitaria ("libro de esterilización").
import { z } from "zod";
import ExcelJS from "exceljs";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import type { Client } from "../lib/db.js";
import { dayBounds } from "../lib/slots.js";
import { clinicZone } from "./agenda.js";

export const TASK_LABELS: Record<string, string> = {
  between_patients: "Limpieza entre pacientes",
  start_of_day: "Apertura (inicio del día)",
  end_of_day: "Cierre (fin del día)",
  deep_disinfection: "Desinfección profunda",
  waste_disposal: "Retiro de residuos",
  spill: "Derrame / contingencia",
};
const TASKS = Object.keys(TASK_LABELS) as [string, ...string[]];
const PROGRAM_LABELS: Record<string, string> = { "134C": "134 °C", "121C": "121 °C", flash: "Rápido (flash)", other: "Otro" };

export function biosafetyRoutes(route: Route) {
  route({
    method: "GET", url: "/api/biosafety/today", summary: "Estado del día por consultorio: limpiezas hechas y pendientes, y esterilización", tags: ["bioseguridad"], perm: "biosafety.read",
    query: z.object({ branchId: zId, date: zDate.optional() }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const date = query.date ?? new Date().toLocaleDateString("en-CA", { timeZone: zone });
      const [s, e] = dayBounds(date, zone);
      const chairs = (await c.query<{ id: string; name: string }>("SELECT id, name FROM chairs WHERE branch_id = $1 AND active ORDER BY name", [query.branchId])).rows;
      const logs = (await c.query(
        `SELECT l.id, l.chair_id AS "chairId", l.area, l.task, l.notes, l.done_at AS "doneAt", u.full_name AS "doneBy"
           FROM cleaning_logs l JOIN users u ON u.id = l.done_by
          WHERE l.branch_id = $1 AND l.done_at >= $2 AND l.done_at < $3 ORDER BY l.done_at DESC`, [query.branchId, s, e])).rows;
      // Pacientes atendidos (o en atención) por consultorio: cada uno requiere una limpieza posterior.
      const seen = (await c.query<{ chair_id: string; n: number }>(
        `SELECT chair_id, count(*)::int AS n FROM appointments
          WHERE branch_id = $1 AND chair_id IS NOT NULL AND starts_at >= $2 AND starts_at < $3 AND status IN ('completed','in_progress')
          GROUP BY chair_id`, [query.branchId, s, e])).rows;
      const perChair = chairs.map((ch) => {
        const mine = logs.filter((l) => l.chairId === ch.id);
        const between = mine.filter((l) => l.task === "between_patients").length;
        const patients = seen.find((x) => x.chair_id === ch.id)?.n ?? 0;
        return {
          chairId: ch.id, name: ch.name,
          startDone: mine.some((l) => l.task === "start_of_day"),
          endDone: mine.some((l) => l.task === "end_of_day"),
          betweenDone: between, patientsSeen: patients, betweenPending: Math.max(0, patients - between),
          lastAt: mine[0]?.doneAt ?? null, lastBy: mine[0]?.doneBy ?? null,
        };
      });
      const cycles = (await c.query(
        `SELECT cy.id, cy.cycle_number AS "cycleNumber", st.name AS sterilizer, cy.program, cy.chemical_indicator AS chemical, cy.run_at AS "runAt",
                cy.load_description AS load, br.result AS bio
           FROM sterilization_cycles cy JOIN sterilizers st ON st.id = cy.sterilizer_id LEFT JOIN sterilization_bio_results br ON br.cycle_id = cy.id
          WHERE cy.branch_id = $1 AND cy.run_at >= $2::timestamptz - interval '30 days' AND cy.run_at < $3 ORDER BY cy.run_at DESC`, [query.branchId, s, e])).rows;
      const failed = cycles.filter((cy) => cy.chemical === "fail" || cy.bio === "fail");
      return {
        date,
        chairs: perChair,
        areaLogs: logs.filter((l) => !l.chairId).map((l) => ({ ...l, taskLabel: TASK_LABELS[l.task] })),
        sterilization: {
          today: cycles.filter((cy) => +new Date(cy.runAt) >= +s).length,
          pendingBio: cycles.filter((cy) => !cy.bio).length,
          failed: failed.map((f) => ({ ...f, programLabel: PROGRAM_LABELS[f.program] })),
        },
      };
    },
  });

  route({
    method: "POST", url: "/api/biosafety/cleanings", summary: "Registrar limpieza o desinfección", tags: ["bioseguridad"], perm: "biosafety.write",
    body: z.object({ branchId: zId, chairId: zId.nullish(), area: zOptText(80), task: z.enum(TASKS), notes: zOptText(500) }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      if (!body.chairId && !body.area) throw badRequest("Indica el consultorio o el área");
      if (body.chairId) {
        const ch = (await c.query<{ branch_id: string }>("SELECT branch_id FROM chairs WHERE id = $1", [body.chairId])).rows[0];
        if (!ch || ch.branch_id !== body.branchId) throw badRequest("El consultorio no pertenece a la sucursal");
      }
      const r = await c.query<{ id: string }>(
        "INSERT INTO cleaning_logs (clinic_id, branch_id, chair_id, area, task, notes, done_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [auth.clinicId, body.branchId, body.chairId ?? null, body.area, body.task, body.notes, auth.userId]);
      await audit(c, auth, "biosafety.cleaning", "cleaning_log", r.rows[0]!.id, { task: body.task, chairId: body.chairId ?? null }, body.branchId);
      return { id: r.rows[0]!.id };
    },
  });

  // ---------------- Esterilizadores ----------------
  route({
    method: "GET", url: "/api/biosafety/sterilizers", summary: "Equipos de esterilización", tags: ["bioseguridad"], perm: "biosafety.read",
    query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) =>
      (await c.query(
        `SELECT st.id, st.name, st.active, st.branch_id AS "branchId", b.name AS "branchName",
                (SELECT max(cycle_number) FROM sterilization_cycles WHERE sterilizer_id = st.id) AS "lastCycle"
           FROM sterilizers st JOIN branches b ON b.id = st.branch_id
          WHERE ($1::uuid IS NULL OR st.branch_id = $1) AND ($2::uuid[] IS NULL OR st.branch_id = ANY($2)) ORDER BY b.code, st.name`,
        [query.branchId ?? null, allowedBranches(auth)])).rows,
  });

  route({
    method: "POST", url: "/api/biosafety/sterilizers", summary: "Registrar equipo de esterilización", tags: ["bioseguridad"], perm: "clinic.manage",
    body: z.object({ branchId: zId, name: z.string().trim().min(2).max(80) }),
    handler: async ({ c, auth, body }) => {
      const r = await c.query<{ id: string }>("INSERT INTO sterilizers (clinic_id, branch_id, name) VALUES ($1,$2,$3) RETURNING id", [auth.clinicId, body.branchId, body.name]);
      await audit(c, auth, "biosafety.sterilizer_created", "sterilizer", r.rows[0]!.id, body, body.branchId);
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "PATCH", url: "/api/biosafety/sterilizers/:id", summary: "Renombrar o desactivar equipo", tags: ["bioseguridad"], perm: "clinic.manage", params: zIdParams,
    body: z.object({ name: z.string().trim().min(2).max(80).optional(), active: z.boolean().optional() }),
    handler: async ({ c, auth, params, body }) => {
      const r = await c.query("UPDATE sterilizers SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1", [params.id, body.name ?? null, body.active ?? null]);
      if (!r.rowCount) throw notFound("Equipo");
      await audit(c, auth, "biosafety.sterilizer_updated", "sterilizer", params.id, body);
      return { ok: true };
    },
  });

  // ---------------- Ciclos ----------------
  route({
    method: "POST", url: "/api/biosafety/cycles", summary: "Registrar ciclo de esterilización (número correlativo por equipo)", tags: ["bioseguridad"], perm: "biosafety.write",
    body: z.object({
      sterilizerId: zId,
      program: z.enum(["134C", "121C", "flash", "other"]),
      temperatureC: z.number().min(50).max(200).nullish(),
      durationMin: z.number().int().min(1).max(240).nullish(),
      loadDescription: z.string().trim().min(2, "Describe la carga").max(500),
      packages: z.number().int().min(1).max(500).default(1),
      chemicalIndicator: z.enum(["pass", "fail"]),
      expiresOn: zDate.nullish(),
      notes: zOptText(500),
    }),
    handler: async ({ c, auth, body }) => {
      const st = (await c.query<{ branch_id: string; active: boolean; name: string }>("SELECT branch_id, active, name FROM sterilizers WHERE id = $1 FOR UPDATE", [body.sterilizerId])).rows[0];
      if (!st) throw notFound("Equipo");
      if (!st.active) throw conflict("El equipo está desactivado");
      requireBranch(auth, st.branch_id);
      const n = (await c.query<{ n: number }>("SELECT COALESCE(max(cycle_number), 0) + 1 AS n FROM sterilization_cycles WHERE sterilizer_id = $1", [body.sterilizerId])).rows[0]!.n;
      const r = await c.query<{ id: string }>(
        `INSERT INTO sterilization_cycles (clinic_id, branch_id, sterilizer_id, cycle_number, program, temperature_c, duration_min, load_description, packages,
            chemical_indicator, operator_id, expires_on, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [auth.clinicId, st.branch_id, body.sterilizerId, n, body.program, body.temperatureC ?? null, body.durationMin ?? null, body.loadDescription, body.packages,
          body.chemicalIndicator, auth.userId, body.expiresOn ?? null, body.notes]);
      await audit(c, auth, body.chemicalIndicator === "fail" ? "biosafety.cycle_failed" : "biosafety.cycle", "sterilization_cycle", r.rows[0]!.id,
        { cycleNumber: n, sterilizer: st.name, chemical: body.chemicalIndicator }, st.branch_id);
      return { id: r.rows[0]!.id, cycleNumber: n, alert: body.chemicalIndicator === "fail" ? "Indicador químico fallido: retira la carga y reprocésala. No uses ese material." : null };
    },
  });

  route({
    method: "POST", url: "/api/biosafety/cycles/:id/bio", summary: "Registrar resultado del indicador biológico (una vez por ciclo)", tags: ["bioseguridad"], perm: "biosafety.write", params: zIdParams,
    body: z.object({ result: z.enum(["pass", "fail"]), notes: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      const cy = (await c.query<{ branch_id: string; cycle_number: number }>("SELECT branch_id, cycle_number FROM sterilization_cycles WHERE id = $1", [params.id])).rows[0];
      if (!cy) throw notFound("Ciclo");
      requireBranch(auth, cy.branch_id);
      const ex = await c.query("SELECT 1 FROM sterilization_bio_results WHERE cycle_id = $1", [params.id]);
      if (ex.rowCount) throw conflict("El resultado biológico de este ciclo ya fue registrado");
      await c.query("INSERT INTO sterilization_bio_results (clinic_id, cycle_id, result, notes, recorded_by) VALUES ($1,$2,$3,$4,$5)", [auth.clinicId, params.id, body.result, body.notes, auth.userId]);
      await audit(c, auth, body.result === "fail" ? "biosafety.bio_failed" : "biosafety.bio", "sterilization_cycle", params.id, { cycleNumber: cy.cycle_number, result: body.result }, cy.branch_id);
      return { ok: true, alert: body.result === "fail" ? "Indicador biológico positivo: el equipo no esteriliza correctamente. Suspende su uso, avisa a administración y rastrea los pacientes atendidos con material de este ciclo." : null };
    },
  });

  const cyclesQuery = z.object({ branchId: zId.optional(), from: zDate.optional(), to: zDate.optional() });
  async function listCycles(c: Client, auth: AuthCtx, q: z.infer<typeof cyclesQuery>) {
    if (q.branchId) requireBranch(auth, q.branchId);
    const zone = await clinicZone(c, auth.clinicId!);
    const from = q.from ? dayBounds(q.from, zone)[0] : new Date(Date.now() - 30 * 86_400_000);
    const to = q.to ? dayBounds(q.to, zone)[1] : new Date(Date.now() + 86_400_000);
    return (await c.query(
      `SELECT cy.id, cy.cycle_number AS "cycleNumber", st.name AS sterilizer, b.name AS "branchName", cy.program, cy.temperature_c AS "temperatureC",
              cy.duration_min AS "durationMin", cy.load_description AS "loadDescription", cy.packages, cy.chemical_indicator AS "chemicalIndicator",
              br.result AS "bioResult", br.recorded_at AS "bioRecordedAt", cy.run_at AS "runAt", cy.expires_on AS "expiresOn", cy.notes, u.full_name AS operator
         FROM sterilization_cycles cy JOIN sterilizers st ON st.id = cy.sterilizer_id JOIN branches b ON b.id = cy.branch_id
         JOIN users u ON u.id = cy.operator_id LEFT JOIN sterilization_bio_results br ON br.cycle_id = cy.id
        WHERE cy.run_at >= $1 AND cy.run_at < $2 AND ($3::uuid IS NULL OR cy.branch_id = $3) AND ($4::uuid[] IS NULL OR cy.branch_id = ANY($4))
        ORDER BY cy.run_at DESC LIMIT 1000`,
      [from, to, q.branchId ?? null, allowedBranches(auth)])).rows.map((r) => ({ ...r, programLabel: PROGRAM_LABELS[r.program] }));
  }

  route({
    method: "GET", url: "/api/biosafety/cycles", summary: "Libro de esterilización (por defecto, últimos 30 días)", tags: ["bioseguridad"], perm: "biosafety.read",
    query: cyclesQuery,
    handler: async ({ c, auth, query }) => listCycles(c, auth, query),
  });

  route({
    method: "GET", url: "/api/biosafety/cycles.xlsx", summary: "Exportar el libro de esterilización a Excel (para inspecciones)", tags: ["bioseguridad"], perm: "biosafety.read", raw: true,
    query: cyclesQuery,
    handler: async ({ c, auth, query, reply }) => {
      const rows = await listCycles(c, auth, query);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Esterilización");
      ws.addRow(["Fecha y hora", "Sucursal", "Equipo", "Ciclo N°", "Programa", "Temp. °C", "Minutos", "Carga", "Paquetes", "Ind. químico", "Ind. biológico", "Vence", "Operador", "Notas"]).font = { bold: true };
      const R = (v: string | null) => (v === "pass" ? "Correcto" : v === "fail" ? "FALLÓ" : "Pendiente");
      for (const r of rows) {
        ws.addRow([new Date(r.runAt).toLocaleString("es-BO", { timeZone: "America/La_Paz" }), r.branchName, r.sterilizer, r.cycleNumber, r.programLabel, r.temperatureC, r.durationMin,
          r.loadDescription, r.packages, R(r.chemicalIndicator), R(r.bioResult), r.expiresOn, r.operator, r.notes]);
      }
      ws.columns.forEach((col) => (col.width = 16));
      await audit(c, auth, "report.exported", "sterilization", null, { rows: rows.length });
      reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="libro-esterilizacion.xlsx"`)
        .send(Buffer.from(await wb.xlsx.writeBuffer()));
    },
  });
}
