// Rutas de la migración de datos (B-006): plantillas, inspección del archivo (mapeo y vista previa),
// revisión (dryRun) e importación confirmada, historial de lotes y reporte fila por fila en Excel.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import ExcelJS from "exceljs";
import type { FastifyReply } from "fastify";
import type { Route } from "../../lib/http.js";
import { zDate, zIdParams, zOptText } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { conflict, badRequest, notFound } from "../../lib/errors.js";
import { safe, sendXlsx } from "../management/xlsx.js";
import { HANDLERS } from "./importKinds.js";
import {
  checkMapping, IMPORT_KINDS, KIND_LABELS, readSheet, rowKey, rowValues, STATUS_LABELS, suggestMapping,
  type FieldDef, type ImportKind, type RowResult,
} from "./importCore.js";

const zKind = z.object({ kind: z.enum(IMPORT_KINDS, { message: "Tipo de importación inválido" }) });
const zFile = z.string().min(1, "Elige un archivo").max(14_000_000, "El archivo es demasiado grande (máximo 10 MB)");
const zMapping = z.record(z.string().max(40), z.number().int().min(1).max(60).nullable()).default({});
const runBody = z.object({
  fileBase64: zFile,
  fileName: zOptText(200),
  mapping: zMapping,
  dryRun: z.boolean().default(true),
  /** Importar también las filas «para revisar» (fuera de horario o posible duplicado). */
  includeReview: z.boolean().default(false),
  /** Número exacto de registros que la persona confirmó crear (obligatorio al importar). */
  expectedCreate: z.number().int().min(0).optional(),
  /** Saldos: fecha de corte por defecto para las filas sin fecha. */
  cutoffDate: zDate.optional(),
});
type RunBody = z.infer<typeof runBody>;

export interface Summary {
  dryRun: boolean; total: number; create: number; duplicates: number; errors: number; review: number; reviewIncluded: number; skipped: number;
}

function summarize(dryRun: boolean, results: RowResult[]): Summary {
  const n = (s: RowResult["status"]) => results.filter((r) => r.status === s).length;
  const reviewIncluded = results.filter((r) => r.status === "review" && r.imported).length;
  return { dryRun, total: results.length, create: n("ok") + reviewIncluded, duplicates: n("duplicate"), errors: n("error"), review: n("review"), reviewIncluded, skipped: n("skipped") };
}

export async function runImport(c: Client, auth: AuthCtx, kind: ImportKind, body: RunBody) {
  const handler = HANDLERS[kind];
  const { sheet, fileSha256 } = await readSheet(body.fileBase64);
  const mapping = Object.keys(body.mapping).length ? body.mapping : suggestMapping(handler.fields, sheet.headers);
  checkMapping(handler.fields, sheet.headers, mapping);
  const branchCount = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM branches WHERE active")).rows[0]!.n;
  handler.checkMapping(mapping, branchCount);
  if (!body.dryRun) {
    if (body.expectedCreate === undefined) throw badRequest("Primero revisa el archivo y confirma cuántos registros se crearán");
    // Dos importaciones simultáneas del mismo tipo en la misma clínica se hacen una detrás de otra.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`import:${auth.clinicId}:${kind}`]);
  }
  const batchId = randomUUID();
  const opts = { dryRun: body.dryRun, includeReview: body.includeReview, cutoffDate: body.cutoffDate ?? null, batchId };
  // La revisión inserta de verdad (así las restricciones de la base validan solapes y duplicados,
  // también entre filas del mismo archivo) y al final deshace todo.
  await c.query("SAVEPOINT import_run");
  const ctx = await handler.prepare(c, auth, opts);
  const results: RowResult[] = [];
  const records: { key: string; row: number; patientId?: string; appointmentId?: string; openingBalanceId?: string; needsReview: boolean }[] = [];
  const seen = new Map<string, number>();
  for (const { row, cells } of sheet.rows) {
    const values = rowValues(handler.fields, mapping, cells);
    const key = rowKey(kind, values);
    const prev = seen.get(key);
    if (prev) { results.push({ row, status: "duplicate", message: `Fila repetida en el archivo (igual a la fila ${prev})`, values }); continue; }
    seen.set(key, row);
    const done = (await c.query<{ created_at: Date }>("SELECT created_at FROM import_records WHERE kind = $1 AND external_key = $2", [kind, key])).rows[0];
    if (done) {
      results.push({ row, status: "duplicate", message: `Ya se importó el ${done.created_at.toLocaleDateString("es-BO", { timeZone: "America/La_Paz" })} (misma fila o mismo ID externo)`, values });
      continue;
    }
    const out = await handler.row(c, auth, ctx, values, row, opts);
    const imported = !!out.created;
    results.push({ row, status: out.status, message: out.message, ref: out.ref, imported: out.status === "review" ? imported : undefined, values });
    if (out.created) records.push({ key, row, ...out.created, needsReview: !!out.created.needsReview });
  }
  const summary = summarize(body.dryRun, results);
  if (body.dryRun) {
    await c.query("ROLLBACK TO SAVEPOINT import_run");
    return { summary, results, mapping, headers: sheet.headers };
  }
  if (summary.create !== body.expectedCreate) {
    throw conflict(`El archivo o los datos cambiaron desde la revisión: ahora se crearían ${summary.create} registros y confirmaste ${body.expectedCreate}. Vuelve a revisar.`, "count_changed");
  }
  await c.query("RELEASE SAVEPOINT import_run");
  await c.query(
    `INSERT INTO import_batches (id, clinic_id, kind, file_name, file_sha256, total_rows, created_count, duplicate_count, error_count, review_count, results, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [batchId, auth.clinicId, kind, body.fileName, fileSha256, summary.total, summary.create, summary.duplicates, summary.errors, summary.review, JSON.stringify(results), auth.userId]);
  for (const r of records) {
    await c.query(
      `INSERT INTO import_records (clinic_id, batch_id, kind, external_key, source_row, patient_id, appointment_id, opening_balance_id, needs_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [auth.clinicId, batchId, kind, r.key, r.row, r.patientId ?? null, r.appointmentId ?? null, r.openingBalanceId ?? null, r.needsReview]);
  }
  await audit(c, auth, `import.${kind}`, "import_batch", batchId, { fileSha256, fileName: body.fileName, ...summary });
  return { summary, results, mapping, headers: sheet.headers, batchId };
}

// ---------------- Excel: plantillas y reportes ----------------
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F4F1" } };

export async function templateWorkbook(kind: ImportKind) {
  const h = HANDLERS[kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dentalia";
  const ws = wb.addWorksheet("Datos");
  const head = ws.addRow(h.fields.map((f) => f.label));
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = HEAD_FILL; });
  for (const ex of h.examples) ws.addRow(ex.map(safe));
  h.fields.forEach((f, i) => { ws.getColumn(i + 1).width = Math.max(14, Math.min(30, f.label.length + 6)); });
  // Las columnas de texto se guardan como texto (un CI o un N° de ficha no deben convertirse en número).
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const info = wb.addWorksheet("Instrucciones");
  info.getColumn(1).width = 28; info.getColumn(2).width = 14; info.getColumn(3).width = 100;
  info.addRow([`Plantilla de importación: ${KIND_LABELS[kind]}`]).font = { bold: true, size: 13 };
  info.addRow(["Los datos de ejemplo de la hoja «Datos» son ficticios: bórralos y pega los tuyos. La primera fila (títulos) no se cambia."]);
  info.addRow(["Si tu archivo tiene otros títulos, no importa: en la pantalla de importación eliges qué columna corresponde a cada dato."]);
  info.addRow(["Siempre se revisa primero sin guardar nada. Importar el mismo archivo dos veces no duplica registros."]);
  info.addRow([]);
  const ih = info.addRow(["Columna", "¿Obligatoria?", "Qué escribir"]);
  ih.font = { bold: true };
  ih.eachCell((cell) => { cell.fill = HEAD_FILL; });
  for (const f of h.fields) info.addRow([f.label, f.required ? "Sí" : "No", f.help].map(safe)).alignment = { wrapText: true, vertical: "top" };
  return wb;
}

export async function reportWorkbook(kind: ImportKind, fields: FieldDef[], results: RowResult[], dryRun: boolean, meta: { when: Date; fileName?: string | null }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dentalia";
  const used = fields.filter((f) => results.some((r) => r.values?.[f.key]));
  const ws = wb.addWorksheet("Reporte");
  const head = ws.addRow(["Fila", "Resultado", "Detalle", "Referencia", ...used.map((f) => f.label)]);
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = HEAD_FILL; });
  for (const r of results) {
    const label = r.status === "review" && r.imported ? "Importada para revisar" : STATUS_LABELS[r.status][dryRun ? "dry" : "real"];
    const row = ws.addRow([r.row, label, r.message ?? "", r.ref ?? "", ...used.map((f) => r.values?.[f.key] ?? "")].map(safe));
    if (r.status === "error") row.getCell(2).font = { color: { argb: "FFB42318" }, bold: true };
    if (r.status === "review") row.getCell(2).font = { color: { argb: "FFB54708" }, bold: true };
  }
  ws.getColumn(1).width = 7; ws.getColumn(2).width = 24; ws.getColumn(3).width = 60; ws.getColumn(4).width = 34;
  used.forEach((_, i) => { ws.getColumn(5 + i).width = 18; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 + used.length } };
  const s = summarize(dryRun, results);
  const sum = wb.addWorksheet("Resumen");
  sum.getColumn(1).width = 40; sum.getColumn(2).width = 16;
  sum.addRow([`${KIND_LABELS[kind]}: ${dryRun ? "revisión (no se guardó nada)" : "importación"}`]).font = { bold: true, size: 13 };
  sum.addRow(["Fecha", meta.when.toLocaleString("es-BO", { timeZone: "America/La_Paz" })]);
  if (meta.fileName) sum.addRow(["Archivo", safe(meta.fileName)]);
  sum.addRow([dryRun ? "Se crearán" : "Creados", s.create]);
  sum.addRow(["Duplicados (no se importan)", s.duplicates]);
  sum.addRow(["Con errores", s.errors]);
  sum.addRow(["Para revisar", s.review]);
  if (s.skipped) sum.addRow(["Omitidas (sin datos que registrar)", s.skipped]);
  sum.addRow(["Filas leídas", s.total]);
  return wb;
}

async function sendWb(reply: FastifyReply, wb: ExcelJS.Workbook, name: string) {
  await sendXlsx(reply, wb, name);
}

export function importRoutes(route: Route) {
  route({
    method: "GET", url: "/api/imports/:kind/fields", summary: "Columnas que admite cada importación, con su explicación", tags: ["importación"], perm: "patients.import", params: zKind,
    handler: async ({ params }) => ({ kind: params.kind, label: KIND_LABELS[params.kind], fields: HANDLERS[params.kind].fields }),
  });

  route({
    method: "GET", url: "/api/imports/:kind/template.xlsx", summary: "Plantilla Excel con ejemplos ficticios y explicación de cada columna", tags: ["importación"], perm: "patients.import",
    params: zKind, raw: true,
    handler: async ({ params, reply }) => sendWb(reply, await templateWorkbook(params.kind), `plantilla-${params.kind}`),
  });

  route({
    method: "POST", url: "/api/imports/:kind/inspect", summary: "Leer el archivo: columnas, mapeo sugerido y vista previa de las primeras filas (no guarda nada)", tags: ["importación"],
    perm: "patients.import", params: zKind, body: z.object({ fileBase64: zFile }),
    handler: async ({ params, body }) => {
      const { sheet } = await readSheet(body.fileBase64);
      const fields = HANDLERS[params.kind].fields;
      return { headers: sheet.headers, rowCount: sheet.rows.length, mapping: suggestMapping(fields, sheet.headers), preview: sheet.rows.slice(0, 5), fields };
    },
  });

  route({
    method: "POST", url: "/api/imports/:kind", summary: "Revisar (dryRun=true: valida todo y no guarda nada) o importar (dryRun=false, con el número exacto confirmado en expectedCreate)",
    tags: ["importación"], perm: "patients.import", params: zKind, body: runBody,
    handler: async ({ c, auth, params, body }) => {
      const out = await runImport(c, auth, params.kind, body);
      // Para no enviar miles de filas al navegador: el detalle completo está en el reporte Excel.
      return { ...out, results: out.results.slice(0, 2000), truncated: out.results.length > 2000 };
    },
  });

  route({
    method: "POST", url: "/api/imports/:kind/report.xlsx", summary: "Reporte fila por fila de la revisión (Excel, protegido contra fórmulas). No guarda nada.", tags: ["importación"],
    perm: "patients.import", params: zKind, body: runBody.omit({ dryRun: true, expectedCreate: true }), raw: true,
    handler: async ({ c, auth, params, body, reply }) => {
      const out = await runImport(c, auth, params.kind, { ...body, dryRun: true });
      await sendWb(reply, await reportWorkbook(params.kind, HANDLERS[params.kind].fields, out.results, true, { when: new Date(), fileName: body.fileName }), `revision-${params.kind}`);
    },
  });

  route({
    method: "GET", url: "/api/imports/batches", summary: "Importaciones realizadas (sin el detalle por fila)", tags: ["importación"], perm: "patients.import",
    handler: async ({ c }) => (await c.query(
      `SELECT b.id, b.kind, b.file_name AS "fileName", b.total_rows AS "totalRows", b.created_count AS "createdCount", b.duplicate_count AS "duplicateCount",
              b.error_count AS "errorCount", b.review_count AS "reviewCount", b.created_at AS "createdAt", u.full_name AS "createdBy"
         FROM import_batches b JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 50`)).rows
      .map((b) => ({ ...b, kindLabel: KIND_LABELS[b.kind as ImportKind] })),
  });

  route({
    method: "GET", url: "/api/imports/batches/:id/report.xlsx", summary: "Reporte fila por fila de una importación realizada (Excel)", tags: ["importación"], perm: "patients.import",
    params: zIdParams, raw: true,
    handler: async ({ c, params, reply }) => {
      const b = (await c.query<{ kind: ImportKind; results: RowResult[]; created_at: Date; file_name: string | null }>(
        "SELECT kind, results, created_at, file_name FROM import_batches WHERE id = $1", [params.id])).rows[0];
      if (!b) throw notFound("Importación");
      await sendWb(reply, await reportWorkbook(b.kind, HANDLERS[b.kind].fields, b.results, false, { when: b.created_at, fileName: b.file_name }), `importacion-${b.kind}`);
    },
  });
}
