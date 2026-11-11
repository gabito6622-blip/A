// Comprobante adjunto de un gasto (B-083): imagen o PDF de la factura o el recibo.
//
//  * Reutiliza lib/filestore.ts (FileStore, clave aleatoria, escritura atómica) en una carpeta PROPIA
//    («comprobantes-gastos» dentro de DENTAL_FILES_DIR): nunca se mezcla con los archivos de pacientes.
//  * El tipo se decide por la firma de bytes (JPG, PNG, WebP o PDF), nunca por la extensión ni el
//    Content-Type del navegador. SHA-256 guardado; el mismo archivo no se adjunta dos veces al gasto.
//  * Permisos financieros: ver con reports.financial y acceso a alguna sucursal del gasto; adjuntar con
//    reports.financial y acceso a todas sus sucursales. No se adjunta a un gasto anulado.
//  * Metadatos de solo inserción. Ver o descargar exige un enlace firmado de 5 minutos atado a la persona
//    y a la clínica (clave derivada distinta de la de los archivos clínicos) y queda en la auditoría.
import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import { zIdParams } from "../../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { deriveRing } from "../../lib/keys.js";
import { EXTENSION, isImage, LocalFileStore, newStorageKey, sniffType, type DetectedType, type FileStore } from "../../lib/filestore.js";
import { cleanOriginalName, fmtMb, maxUploadBytes, MIME_LABELS, registerBinaryParser, signFileToken, tooLarge, verifyFileToken, type LinkPurpose } from "../clinicalFiles-core.js";
import { loadExpense } from "./expenses.js";

export const RECEIPT_TYPES: DetectedType[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Almacenamiento de comprobantes: subcarpeta propia, separada de las imágenes clínicas. */
export function createReceiptStore(cfg: { filesDir: string }): FileStore {
  return new LocalFileStore(join(cfg.filesDir, "comprobantes-gastos"));
}

const contentUrl = (id: string, token: string) => `/api/expense-attachments/${id}/content?t=${encodeURIComponent(token)}`;

interface AttRow { id: string; expense_id: string; original_name: string | null; mime_type: DetectedType; size_bytes: number; sha256: string; storage_key: string; created_at: Date; uploaded_by_name: string }

async function loadAttachment(c: Client, id: string): Promise<AttRow> {
  const a = (await c.query<AttRow>(
    `SELECT a.id, a.expense_id, a.original_name, a.mime_type, a.size_bytes, a.sha256, a.storage_key, a.created_at, u.full_name AS uploaded_by_name
       FROM expense_attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.id = $1`, [id])).rows[0];
  if (!a) throw notFound("Comprobante");
  return a;
}

export function expenseAttachmentRoutes(route: Route, cfg: Config, app: FastifyInstance, store: FileStore = createReceiptStore(cfg)) {
  const maxBytes = maxUploadBytes();
  registerBinaryParser(app, maxBytes);
  // Clave propia: un enlace de un archivo clínico no abre un comprobante (ni al revés).
  const secret = deriveRing(cfg.keys.link, (k) => createHmac("sha256", k).update("dentalia:expense-receipts:v1").digest());
  const sign = (auth: AuthCtx, id: string, p: LinkPurpose) => signFileToken(secret, { f: id, c: auth.clinicId!, u: auth.userId, p });

  const present = (auth: AuthCtx, a: AttRow) => {
    const image = isImage(a.mime_type);
    const view = image ? sign(auth, a.id, "view") : null;
    const dl = sign(auth, a.id, "download");
    return {
      id: a.id, expenseId: a.expense_id, originalName: a.original_name, mimeType: a.mime_type, typeLabel: MIME_LABELS[a.mime_type] ?? a.mime_type, isImage: image,
      sizeBytes: a.size_bytes, sha256: a.sha256, createdAt: a.created_at.toISOString(), uploadedBy: a.uploaded_by_name,
      viewUrl: view ? contentUrl(a.id, view.token) : null, downloadUrl: contentUrl(a.id, dl.token), linkExpiresAt: dl.expiresAt,
    };
  };

  route({
    method: "GET", url: "/api/expenses/:id/attachments", summary: "Comprobantes adjuntos de un gasto, con enlaces de 5 minutos para verlos o descargarlos", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      await loadExpense(c, auth, params.id, "read");
      const rows = (await c.query<AttRow>(
        `SELECT a.id, a.expense_id, a.original_name, a.mime_type, a.size_bytes, a.sha256, a.storage_key, a.created_at, u.full_name AS uploaded_by_name
           FROM expense_attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.expense_id = $1 ORDER BY a.created_at`, [params.id])).rows;
      return { items: rows.map((r) => present(auth, r)), maxBytes, maxLabel: fmtMb(maxBytes), accepts: RECEIPT_TYPES.map((m) => MIME_LABELS[m]) };
    },
  });

  route({
    method: "POST", url: "/api/expenses/:id/attachments",
    summary: "Adjuntar el comprobante de un gasto (cuerpo application/octet-stream; nombre en la cabecera X-File-Name codificado con encodeURIComponent). Solo JPG, PNG, WebP o PDF, verificados por la firma de bytes",
    tags: ["gestión"], perm: "reports.financial", params: zIdParams, limit: { max: 60, timeWindow: "1 minute" },
    handler: async ({ c, auth, params, req }) => {
      await c.query("SELECT id FROM expenses WHERE id = $1 FOR SHARE", [params.id]);
      const e = await loadExpense(c, auth, params.id, "write");
      if (e.state === "voided") throw conflict("No se adjuntan comprobantes a un gasto anulado", "expense_voided");
      const buf = req.body;
      if (!Buffer.isBuffer(buf)) throw new AppError(415, "unsupported_media_type", "Envía el archivo como application/octet-stream");
      if (buf.length === 0) throw badRequest("El archivo está vacío");
      if (buf.length > maxBytes) throw tooLarge(maxBytes);
      const type = sniffType(buf);
      if (!type || !RECEIPT_TYPES.includes(type)) {
        throw new AppError(415, "file_type_not_allowed", "Tipo de archivo no permitido. El comprobante debe ser una foto (JPG, PNG o WebP) o un PDF.");
      }
      let name: string | null = null;
      const raw = req.headers["x-file-name"];
      if (typeof raw === "string" && raw) {
        try { name = cleanOriginalName(decodeURIComponent(raw)); } catch { throw badRequest("El nombre del archivo no es válido"); }
        if (name && name.length > 200) throw badRequest("El nombre del archivo es demasiado largo (máximo 200 caracteres)");
      }
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if ((await c.query("SELECT 1 FROM expense_attachments WHERE expense_id = $1 AND sha256 = $2", [params.id, sha256])).rowCount) {
        throw conflict("Este mismo archivo ya está adjunto al gasto", "duplicate_file");
      }
      const key = newStorageKey(auth.clinicId!);
      await store.put(key, buf);
      try {
        const id = (await c.query<{ id: string }>(
          `INSERT INTO expense_attachments (clinic_id, expense_id, original_name, mime_type, size_bytes, sha256, storage_driver, storage_key, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [auth.clinicId, params.id, name, type, buf.length, sha256, store.driver, key, auth.userId])).rows[0]!.id;
        await audit(c, auth, "expense.attachment_added", "expense", params.id, { attachmentId: id, mimeType: type, sizeBytes: buf.length, sha256 }, e.branchId);
        return { id, mimeType: type, sizeBytes: buf.length, sha256 };
      } catch (err) {
        await store.remove(key).catch(() => {});
        if ((err as { constraint?: string }).constraint === "expense_attachments_hash_uq") throw conflict("Este mismo archivo ya está adjunto al gasto", "duplicate_file");
        throw err;
      }
    },
  });

  route({
    method: "GET", url: "/api/expense-attachments/:id/link", summary: "Enlace firmado de 5 minutos para ver (solo imágenes) o descargar un comprobante", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams, query: z.object({ purpose: z.enum(["view", "download"]).default("download") }),
    handler: async ({ c, auth, params, query }) => {
      const a = await loadAttachment(c, params.id);
      await loadExpense(c, auth, a.expense_id, "read");
      if (query.purpose === "view" && !isImage(a.mime_type)) throw badRequest("Este archivo solo se puede descargar");
      const s = sign(auth, a.id, query.purpose);
      return { url: contentUrl(a.id, s.token), expiresAt: s.expiresAt };
    },
  });

  route({
    method: "GET", url: "/api/expense-attachments/:id/content",
    summary: "Entrega el comprobante con un enlace firmado vigente (además de la sesión de la misma persona y clínica). Cada entrega queda auditada", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams, query: z.object({ t: z.string().min(1, "Falta el enlace").max(1000) }),
    handler: async ({ c, auth, params, query, reply }) => {
      const v = verifyFileToken(secret, query.t);
      if (!v.ok) {
        throw v.reason === "expired"
          ? new AppError(403, "link_expired", "El enlace venció (dura 5 minutos). Vuelve a abrir el comprobante desde Gastos.")
          : new AppError(403, "invalid_link", "Enlace inválido");
      }
      if (v.t.f !== params.id || v.t.c !== auth.clinicId || v.t.u !== auth.userId) throw new AppError(403, "invalid_link", "Enlace inválido");
      const a = await loadAttachment(c, params.id);
      const e = await loadExpense(c, auth, a.expense_id, "read");
      const inline = v.t.p === "view" && isImage(a.mime_type);
      await audit(c, auth, inline ? "expense.attachment_viewed" : "expense.attachment_downloaded", "expense", e.id, { attachmentId: a.id }, e.branchId);
      const { stream, size } = await store.open(a.storage_key);
      const name = `comprobante-${e.expenseDate}-${a.id.slice(0, 8)}.${EXTENSION[a.mime_type]}`.replace(/[^A-Za-z0-9._-]/g, "_");
      reply
        .header("content-type", a.mime_type)
        .header("content-length", String(size))
        .header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
        .header("cross-origin-resource-policy", "same-origin")
        .header("x-file-sha256", a.sha256);
      return stream; // se envía después del COMMIT de la auditoría
    },
  });
}
