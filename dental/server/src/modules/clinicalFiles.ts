// Archivos clínicos e imágenes del paciente (B-012): radiografías, fotos, documentos escaneados.
//
// - Subida en el cuerpo binario (application/octet-stream) con los metadatos en la cabecera
//   X-File-Meta (JSON codificado con encodeURIComponent): así el texto clínico no queda en la URL
//   ni en los registros de acceso. Límite configurable (DENTAL_FILES_MAX_MB, 15 MB por defecto).
// - El tipo se decide por la FIRMA de bytes (JPEG, PNG, WebP, PDF y DICOM solo para descargar);
//   la extensión y el Content-Type del navegador se ignoran. SHA-256 guardado y anti-duplicado
//   por hash dentro del mismo paciente.
// - Los bytes van a FileStore (lib/filestore.ts) bajo una clave aleatoria; los metadatos son de
//   solo inserción. Archivar/restaurar = evento con motivo (clinical_file_events).
// - Ver o descargar exige un enlace firmado de 5 minutos + la sesión de la misma persona; cada
//   entrega queda en la auditoría. Se sirve con Content-Disposition, nosniff y una CSP "sandbox":
//   nunca como HTML. PDF y DICOM solo se descargan.
// - Miniaturas (B-081): el navegador genera una miniatura (≤ 400 px, ≤ 100 KB, WebP o JPEG) y la
//   manda en la MISMA subida, al final del cuerpo (X-File-Meta.thumbBytes indica cuántos bytes son
//   de la miniatura). Se valida por firma y dimensiones y se guarda en clinical_file_thumbs. La
//   galería usa solo miniaturas (enlace propio, sin auditoría de entrega); el original se entrega
//   y se audita únicamente al abrirlo en el visor o descargarlo.
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Config } from "../config.js";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams } from "../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import type { Client } from "../lib/db.js";
import { createFileStore, EXTENSION, imageDimensions, isImage, newStorageKey, sniffType, storeFor, type DetectedType, type FileStore } from "../lib/filestore.js";
import { clinicZone } from "./agenda.js";
import { PERMANENT_TEETH, PRIMARY_TEETH } from "./clinical.js";
import {
  canArchiveKind, canUploadKind, canViewKind, cleanOriginalName, contentUrl, downloadName, FILE_KIND_LABELS, FILE_KINDS, fmtMb, KIND_MIME,
  maxUploadBytes, MIME_LABELS, registerBinaryParser, signFileToken, THUMB_MAX_BYTES, THUMB_MAX_SIDE, THUMB_MIME, thumbUrl, tooLarge, verifyFileToken,
  viewableKinds, type FileKind, type LinkPurpose,
} from "./clinicalFiles-core.js";

const VALID_TEETH = new Set([...PERMANENT_TEETH, ...PRIMARY_TEETH]);

const zMeta = z.object({
  branchId: zId,
  kind: z.enum(FILE_KINDS, { message: "Elige el tipo de archivo" }),
  takenOn: zDate,
  teeth: z.array(z.number().int()).max(16, "Indica como máximo 16 piezas").default([]),
  description: z.string().trim().max(500, "La descripción admite hasta 500 caracteres").nullish().transform((v) => (v ? v : null)),
  fileName: z.string().max(200, "El nombre del archivo es demasiado largo (máximo 200 caracteres)").nullish(),
  /** Bytes del final del cuerpo que son la miniatura (opcional). */
  thumbBytes: z.number().int("Tamaño de miniatura inválido").min(1, "Tamaño de miniatura inválido").max(THUMB_MAX_BYTES, `La miniatura supera el límite de ${THUMB_MAX_BYTES / 1024} KB`).nullish(),
});

function parseMeta(raw: unknown) {
  if (typeof raw !== "string" || !raw) throw badRequest("Faltan los datos del archivo (cabecera X-File-Meta)");
  let obj: unknown;
  try { obj = JSON.parse(decodeURIComponent(raw)); } catch { throw badRequest("Los datos del archivo no son válidos"); }
  return zMeta.parse(obj);
}

interface FileRow {
  id: string; patient_id: string; branch_id: string; kind: FileKind; teeth: number[]; taken_on: string; description: string | null;
  original_name: string | null; mime_type: DetectedType; size_bytes: number; sha256: string; storage_key: string; storage_driver: string;
  uploaded_by_name: string; branch_name: string; created_at: Date;
  archived_at: Date | null; archived_reason: string | null; archived_by: string | null;
  thumb_key: string | null; thumb_driver: string | null; thumb_mime: string | null;
}

const FILE_SELECT = `
  SELECT f.id, f.patient_id, f.branch_id, f.kind, f.teeth, f.taken_on, f.description, f.original_name, f.mime_type, f.size_bytes, f.sha256,
         f.storage_key, f.storage_driver, f.created_at, u.full_name AS uploaded_by_name, b.name AS branch_name,
         CASE WHEN ev.kind = 'archived' THEN ev.created_at END AS archived_at,
         CASE WHEN ev.kind = 'archived' THEN ev.reason END AS archived_reason,
         CASE WHEN ev.kind = 'archived' THEN eu.full_name END AS archived_by,
         th.storage_key AS thumb_key, th.storage_driver AS thumb_driver, th.mime_type AS thumb_mime
    FROM clinical_files f
    LEFT JOIN clinical_file_thumbs th ON th.file_id = f.id
    JOIN users u ON u.id = f.uploaded_by
    JOIN branches b ON b.id = f.branch_id
    LEFT JOIN LATERAL (SELECT e.kind, e.reason, e.created_at, e.user_id FROM clinical_file_events e WHERE e.file_id = f.id ORDER BY e.seq DESC LIMIT 1) ev ON true
    LEFT JOIN users eu ON eu.id = ev.user_id`;

async function loadFile(c: Client, id: string): Promise<FileRow> {
  const f = (await c.query<FileRow>(`${FILE_SELECT} WHERE f.id = $1`, [id])).rows[0];
  if (!f) throw notFound("Archivo");
  return f;
}

export function clinicalFileRoutes(route: Route, cfg: Config, app: FastifyInstance, store: FileStore = createFileStore(cfg)) {
  const maxBytes = maxUploadBytes();
  // El cuerpo puede traer al final la miniatura: el límite del original se vuelve a revisar aparte.
  registerBinaryParser(app, maxBytes + THUMB_MAX_BYTES, maxBytes);

  const sign = (auth: AuthCtx, fileId: string, p: LinkPurpose) => signFileToken(cfg.keys.link, { f: fileId, c: auth.clinicId!, u: auth.userId, p });
  /** Cada archivo se lee con el controlador con el que se guardó (disco o S3). */
  const reader = (driver: string) => storeFor(driver, store, cfg);

  const present = (auth: AuthCtx, f: FileRow) => {
    const image = isImage(f.mime_type);
    // viewUrl se mantiene por compatibilidad de la API; la galería ya no lo usa (abre el original solo en el visor).
    const view = image ? sign(auth, f.id, "view") : null;
    const thumb = image && f.thumb_key ? sign(auth, f.id, "thumb") : null;
    return {
      id: f.id, patientId: f.patient_id, kind: f.kind, kindLabel: FILE_KIND_LABELS[f.kind], teeth: f.teeth, takenOn: f.taken_on,
      description: f.description, originalName: f.original_name, mimeType: f.mime_type, typeLabel: MIME_LABELS[f.mime_type] ?? f.mime_type,
      isImage: image, sizeBytes: f.size_bytes, sha256: f.sha256, branchId: f.branch_id, branchName: f.branch_name,
      uploadedBy: f.uploaded_by_name, createdAt: f.created_at.toISOString(),
      archived: f.archived_at ? { at: f.archived_at.toISOString(), reason: f.archived_reason, by: f.archived_by } : null,
      viewUrl: view ? contentUrl(f.id, view.token) : null, linkExpiresAt: view?.expiresAt ?? null,
      thumbUrl: thumb ? thumbUrl(f.id, thumb.token) : null,
      canArchive: canArchiveKind(auth, f.kind),
    };
  };

  route({
    method: "GET", url: "/api/patients/:id/clinical-files",
    summary: "Imágenes y archivos del paciente que el rol puede ver (recepción: solo documentos escaneados). Incluye enlaces de vista de 5 minutos",
    tags: ["archivos clínicos"], perm: "patients.read", params: zIdParams,
    query: z.object({
      kind: z.enum(FILE_KINDS).optional(),
      tooth: z.coerce.number().int().refine((t) => VALID_TEETH.has(t), "Pieza dental inválida (notación FDI)").optional(),
      status: z.enum(["active", "archived", "all"]).default("active"),
    }),
    handler: async ({ c, auth, params, query }) => {
      if (!(await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount) throw notFound("Paciente");
      const kinds = viewableKinds(auth);
      const rows = (await c.query<FileRow>(
        `${FILE_SELECT}
          WHERE f.patient_id = $1 AND f.kind = ANY($2::text[])
            AND ($3::text IS NULL OR f.kind = $3) AND ($4::smallint IS NULL OR $4 = ANY(f.teeth))
            AND ($5 = 'all' OR ($5 = 'archived') = (ev.kind IS NOT DISTINCT FROM 'archived'))
          ORDER BY f.taken_on DESC, f.created_at DESC`,
        [params.id, kinds, query.kind ?? null, query.tooth ?? null, query.status],
      )).rows;
      const archivedCount = (await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clinical_files f
          WHERE f.patient_id = $1 AND f.kind = ANY($2::text[])
            AND (SELECT e.kind FROM clinical_file_events e WHERE e.file_id = f.id ORDER BY e.seq DESC LIMIT 1) = 'archived'`,
        [params.id, kinds])).rows[0]!.n;
      return {
        items: rows.map((r) => present(auth, r)),
        archivedCount,
        kinds: FILE_KINDS.filter((k) => canViewKind(auth, k)).map((k) => ({ id: k, label: FILE_KIND_LABELS[k], canUpload: canUploadKind(auth, k), accepts: KIND_MIME[k].map((m) => MIME_LABELS[m]) })),
        maxBytes, maxLabel: fmtMb(maxBytes),
      };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/clinical-files",
    summary: "Subir una imagen o archivo (cuerpo application/octet-stream; metadatos en la cabecera X-File-Meta: branchId, kind, takenOn, teeth, description, fileName). El tipo se verifica por la firma de bytes",
    tags: ["archivos clínicos"], perm: "patients.write", params: zIdParams, limit: { max: 60, timeWindow: "1 minute" },
    handler: async ({ c, auth, params, req }) => {
      const meta = parseMeta(req.headers["x-file-meta"]);
      if (!canUploadKind(auth, meta.kind)) throw forbidden(meta.kind === "scanned_document" ? "No tienes permiso para subir archivos" : "Solo el personal clínico sube radiografías y fotos clínicas");
      requireBranch(auth, meta.branchId);
      const body = req.body;
      if (!Buffer.isBuffer(body)) throw new AppError(415, "unsupported_media_type", "Envía el archivo como application/octet-stream");
      const thumbLen = meta.thumbBytes ?? 0;
      if (thumbLen && thumbLen >= body.length) throw badRequest("Falta el archivo: el cuerpo solo trae la miniatura");
      const buf = thumbLen ? body.subarray(0, body.length - thumbLen) : body;
      const thumbBuf = thumbLen ? body.subarray(body.length - thumbLen) : null;
      if (buf.length === 0) throw badRequest("El archivo está vacío");
      if (buf.length > maxBytes) throw tooLarge(maxBytes);
      const type = sniffType(buf);
      if (!type) throw new AppError(415, "file_type_not_allowed", "Tipo de archivo no permitido. Se aceptan imágenes JPG, PNG o WebP, documentos PDF y radiografías DICOM.");
      if (!KIND_MIME[meta.kind].includes(type)) {
        throw new AppError(415, "file_type_not_allowed", `Un archivo ${MIME_LABELS[type]} no corresponde a «${FILE_KIND_LABELS[meta.kind]}». Se acepta: ${KIND_MIME[meta.kind].map((m) => MIME_LABELS[m]).join(", ")}.`);
      }
      const thumb = thumbBuf ? validateThumb(thumbBuf, type) : null;
      const teeth = [...new Set(meta.teeth)].sort((a, b) => a - b);
      const bad = teeth.filter((t) => !VALID_TEETH.has(t));
      if (bad.length) throw badRequest(`Pieza dental inválida (notación FDI): ${bad.join(", ")}`);
      const today = DateTime.now().setZone(await clinicZone(c, auth.clinicId!)).toISODate()!;
      if (meta.takenOn > today) throw badRequest("La fecha de toma no puede ser futura");
      if (!(await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount) throw notFound("Paciente");

      const sha256 = createHash("sha256").update(buf).digest("hex");
      const dup = (await c.query<{ id: string; kind: FileKind; archived: boolean }>(
        `SELECT f.id, f.kind, COALESCE((SELECT e.kind = 'archived' FROM clinical_file_events e WHERE e.file_id = f.id ORDER BY e.seq DESC LIMIT 1), false) AS archived
           FROM clinical_files f WHERE f.patient_id = $1 AND f.sha256 = $2`, [params.id, sha256])).rows[0];
      if (dup) {
        throw new AppError(409, "duplicate_file",
          dup.archived ? "Este mismo archivo ya está en la ficha del paciente, pero archivado. Restáuralo desde «Ver archivados»." : "Este mismo archivo ya está en la ficha del paciente.",
          { fileId: canViewKind(auth, dup.kind) ? dup.id : null, archived: dup.archived });
      }

      const key = newStorageKey(auth.clinicId!);
      const thumbKey = thumb ? newStorageKey(auth.clinicId!) : null;
      await store.put(key, buf);
      try {
        if (thumb) await store.put(thumbKey!, thumb.buf);
        const id = (await c.query<{ id: string }>(
          `INSERT INTO clinical_files (clinic_id, patient_id, branch_id, kind, teeth, taken_on, description, original_name, mime_type, size_bytes, sha256, storage_driver, storage_key, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [auth.clinicId, params.id, meta.branchId, meta.kind, teeth, meta.takenOn, meta.description, cleanOriginalName(meta.fileName),
            type, buf.length, sha256, store.driver, key, auth.userId],
        )).rows[0]!.id;
        if (thumb) {
          await c.query(
            `INSERT INTO clinical_file_thumbs (clinic_id, file_id, mime_type, width, height, size_bytes, sha256, storage_driver, storage_key, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [auth.clinicId, id, thumb.mime, thumb.width, thumb.height, thumb.buf.length, createHash("sha256").update(thumb.buf).digest("hex"), store.driver, thumbKey, auth.userId]);
        }
        await audit(c, auth, "clinical_file.uploaded", "clinical_file", id,
          { patientId: params.id, kind: meta.kind, mimeType: type, sizeBytes: buf.length, sha256, teeth, thumbnail: !!thumb }, meta.branchId);
        return { id, mimeType: type, sizeBytes: buf.length, sha256, thumbnail: thumb ? { mimeType: thumb.mime, width: thumb.width, height: thumb.height } : null };
      } catch (e) {
        await store.remove(key).catch(() => {});
        if (thumbKey) await store.remove(thumbKey).catch(() => {});
        if ((e as { constraint?: string }).constraint === "clinical_files_hash_uq") throw new AppError(409, "duplicate_file", "Este mismo archivo ya está en la ficha del paciente.");
        throw e;
      }
    },
  });

  route({
    method: "GET", url: "/api/clinical-files/:id/link",
    summary: "Enlace firmado de 5 minutos para ver (solo imágenes) o descargar un archivo. Solo tras validar el permiso según el tipo",
    tags: ["archivos clínicos"], perm: "patients.read", params: zIdParams,
    query: z.object({ purpose: z.enum(["view", "download"]).default("download") }),
    handler: async ({ c, auth, params, query }) => {
      const f = await loadFile(c, params.id);
      if (!canViewKind(auth, f.kind)) throw forbidden("No tienes permiso para ver este archivo");
      if (query.purpose === "view" && !isImage(f.mime_type)) throw badRequest("Este archivo solo se puede descargar");
      const s = sign(auth, f.id, query.purpose);
      return { url: contentUrl(f.id, s.token), expiresAt: s.expiresAt };
    },
  });

  route({
    method: "GET", url: "/api/clinical-files/:id/content",
    summary: "Entrega el archivo con un enlace firmado vigente (además de la sesión de la misma persona y clínica). Cada entrega queda auditada",
    tags: ["archivos clínicos"], perm: "patients.read", params: zIdParams,
    query: z.object({ t: z.string().min(1, "Falta el enlace").max(1000) }),
    handler: async ({ c, auth, params, query, reply }) => {
      const v = verifyFileToken(cfg.keys.link, query.t);
      if (!v.ok) {
        throw v.reason === "expired"
          ? new AppError(403, "link_expired", "El enlace venció (dura 5 minutos). Vuelve a abrir el archivo desde la ficha.")
          : new AppError(403, "invalid_link", "Enlace inválido");
      }
      if (v.t.f !== params.id || v.t.c !== auth.clinicId || v.t.u !== auth.userId || v.t.p === "thumb") throw new AppError(403, "invalid_link", "Enlace inválido");
      const f = await loadFile(c, params.id);
      if (!canViewKind(auth, f.kind)) throw forbidden("No tienes permiso para ver este archivo");
      const inline = v.t.p === "view" && isImage(f.mime_type);
      await audit(c, auth, inline ? "clinical_file.viewed" : "clinical_file.downloaded", "clinical_file", f.id,
        { patientId: f.patient_id, kind: f.kind, purpose: inline ? "view" : "download" }, f.branch_id);
      const { stream, size } = await reader(f.storage_driver).open(f.storage_key);
      const name = downloadName(f.kind, f.taken_on, f.id, EXTENSION[f.mime_type]);
      reply
        .header("content-type", f.mime_type)
        .header("content-length", String(size))
        .header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
        .header("cross-origin-resource-policy", "same-origin")
        .header("x-file-sha256", f.sha256);
      // Se devuelve (no se envía aquí) para que salga después del COMMIT de la auditoría.
      return stream;
    },
  });

  route({
    method: "GET", url: "/api/clinical-files/:id/thumb",
    summary: "Miniatura de la galería con un enlace firmado vigente (misma persona y clínica). No se audita: el original solo se entrega al abrirlo en el visor",
    tags: ["archivos clínicos"], perm: "patients.read", params: zIdParams,
    query: z.object({ t: z.string().min(1, "Falta el enlace").max(1000) }),
    handler: async ({ c, auth, params, query, reply }) => {
      const v = verifyFileToken(cfg.keys.link, query.t);
      if (!v.ok) {
        throw v.reason === "expired"
          ? new AppError(403, "link_expired", "El enlace venció (dura 5 minutos). Vuelve a abrir la ficha.")
          : new AppError(403, "invalid_link", "Enlace inválido");
      }
      if (v.t.f !== params.id || v.t.c !== auth.clinicId || v.t.u !== auth.userId || v.t.p !== "thumb") throw new AppError(403, "invalid_link", "Enlace inválido");
      const f = await loadFile(c, params.id);
      if (!canViewKind(auth, f.kind)) throw forbidden("No tienes permiso para ver este archivo");
      if (!f.thumb_key || !f.thumb_mime) throw notFound("Miniatura");
      const { stream, size } = await reader(f.thumb_driver!).open(f.thumb_key);
      reply
        .header("content-type", f.thumb_mime)
        .header("content-length", String(size))
        .header("content-disposition", "inline")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
        .header("cross-origin-resource-policy", "same-origin");
      return stream;
    },
  });

  // ---------------- Miniaturas de archivos antiguos (B-096) ----------------
  // Las imágenes subidas antes de v0.6 no tienen miniatura. El navegador la genera desde el original
  // (al abrirlo en el visor o en lote desde Gestión) y la sube aquí, con los mismos controles de 0023.
  route({
    method: "GET", url: "/api/clinical-files/missing-thumbs",
    summary: "Imágenes sin miniatura que el rol puede ver (para generarlas desde el navegador). Incluye enlaces de vista de 5 minutos",
    tags: ["archivos clínicos"], perm: "patients.read",
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
    handler: async ({ c, auth, query }) => {
      const kinds = viewableKinds(auth);
      const base = `FROM clinical_files f
         WHERE f.kind = ANY($1::text[]) AND f.mime_type IN ('image/jpeg','image/png','image/webp')
           AND NOT EXISTS (SELECT 1 FROM clinical_file_thumbs th WHERE th.file_id = f.id)
           AND ($2::uuid[] IS NULL OR f.branch_id = ANY($2))`;
      const params = [kinds, allowedBranches(auth)];
      const total = (await c.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params)).rows[0]!.n;
      const items = (await c.query<{ id: string }>(`SELECT f.id ${base} ORDER BY f.created_at DESC LIMIT $3`, [...params, query.limit])).rows
        .map((r) => ({ id: r.id, viewUrl: contentUrl(r.id, sign(auth, r.id, "view").token) }));
      return { total, items };
    },
  });

  route({
    method: "POST", url: "/api/clinical-files/:id/thumb",
    summary: "Agregar la miniatura de una imagen que no la tiene (cuerpo application/octet-stream; WebP, JPG o PNG de hasta 400 px y 100 KB)",
    tags: ["archivos clínicos"], perm: "patients.read", params: zIdParams, limit: { max: 120, timeWindow: "1 minute" },
    handler: async ({ c, auth, params, req }) => {
      const f = await loadFile(c, params.id);
      if (!canViewKind(auth, f.kind)) throw forbidden("No tienes permiso para ver este archivo");
      if (f.thumb_key) throw new AppError(409, "thumb_exists", "Este archivo ya tiene miniatura");
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError(415, "unsupported_media_type", "Envía la miniatura como application/octet-stream");
      const thumb = validateThumb(body, f.mime_type);
      const key = newStorageKey(auth.clinicId!);
      await store.put(key, thumb.buf);
      try {
        await c.query(
          `INSERT INTO clinical_file_thumbs (clinic_id, file_id, mime_type, width, height, size_bytes, sha256, storage_driver, storage_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [auth.clinicId, f.id, thumb.mime, thumb.width, thumb.height, thumb.buf.length, createHash("sha256").update(thumb.buf).digest("hex"), store.driver, key, auth.userId]);
      } catch (e) {
        await store.remove(key).catch(() => {});
        if ((e as { constraint?: string }).constraint === "clinical_file_thumbs_file_uq") throw new AppError(409, "thumb_exists", "Este archivo ya tiene miniatura");
        throw e;
      }
      await audit(c, auth, "clinical_file.thumb_added", "clinical_file", f.id, { mimeType: thumb.mime, width: thumb.width, height: thumb.height }, f.branch_id);
      return { thumbUrl: thumbUrl(f.id, sign(auth, f.id, "thumb").token) };
    },
  });

  const zReason = z.object({ reason: z.string().trim().min(3, "Escribe el motivo (al menos 3 caracteres)").max(500, "El motivo admite hasta 500 caracteres") });
  for (const action of ["archive", "restore"] as const) {
    route({
      method: "POST", url: `/api/clinical-files/:id/${action}`,
      summary: action === "archive"
        ? "Archivar un archivo con motivo (no se borra: sigue en la ficha como archivado y en la auditoría)"
        : "Restaurar un archivo archivado, con motivo",
      tags: ["archivos clínicos"], perm: "patients.write", params: zIdParams, body: zReason,
      handler: async ({ c, auth, params, body }) => {
        const f = await loadFile(c, params.id);
        if (!canViewKind(auth, f.kind) || !canArchiveKind(auth, f.kind)) throw forbidden("Solo el profesional puede archivar o restaurar imágenes clínicas");
        const kind = action === "archive" ? "archived" : "restored";
        try {
          await c.query("SAVEPOINT cf_event");
          await c.query("INSERT INTO clinical_file_events (clinic_id, file_id, seq, kind, reason, user_id) VALUES ($1,$2,0,$3,$4,$5)",
            [auth.clinicId, f.id, kind, body.reason, auth.userId]);
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT cf_event");
          const err = e as { code?: string; constraint?: string; message?: string };
          if (err.code === "23514" && err.message) throw conflict(err.message, "invalid_transition");
          if (err.constraint === "clinical_file_events_seq_uq") throw conflict("Otra persona acaba de cambiar este archivo. Recarga la página.", "concurrent_change");
          throw e;
        }
        await audit(c, auth, action === "archive" ? "clinical_file.archived" : "clinical_file.restored", "clinical_file", f.id,
          { patientId: f.patient_id, kind: f.kind, reason: body.reason }, f.branch_id);
        return { ok: true };
      },
    });
  }
}

/** Valida la miniatura que generó el navegador: imagen real (firma), liviana y de tamaño razonable. */
function validateThumb(b: Buffer, originalType: DetectedType): { buf: Buffer; mime: string; width: number; height: number } {
  if (!isImage(originalType)) throw badRequest(`Solo las imágenes llevan miniatura (este archivo es ${MIME_LABELS[originalType] ?? originalType})`);
  if (b.length > THUMB_MAX_BYTES) throw new AppError(413, "thumb_too_large", `La miniatura supera el límite de ${THUMB_MAX_BYTES / 1024} KB`);
  const mime = sniffType(b);
  if (!mime || !(THUMB_MIME as readonly string[]).includes(mime)) throw new AppError(415, "thumb_type_not_allowed", "La miniatura no es una imagen válida (se acepta WebP o JPG)");
  const dim = imageDimensions(b);
  if (!dim || dim.width < 1 || dim.height < 1) throw new AppError(415, "thumb_type_not_allowed", "La miniatura no es una imagen válida (no se pudo leer su tamaño)");
  if (dim.width > THUMB_MAX_SIDE || dim.height > THUMB_MAX_SIDE) {
    throw badRequest(`La miniatura mide ${dim.width}×${dim.height} px: debe medir como máximo ${THUMB_MAX_SIDE} px por lado`);
  }
  return { buf: b, mime, ...dim };
}
