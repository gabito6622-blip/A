// Los tres tipos de importación (B-006): pacientes, citas futuras y saldos iniciales.
// Cada fila se valida con las mismas reglas que la pantalla correspondiente:
//  * pacientes: patientBody + validatePatient + detección de duplicados (findDuplicates);
//  * citas: el motor de la agenda (assertBookable: sucursal, profesional, consultorio, bloqueos y
//    horario) y las restricciones EXCLUDE de la base (sin solapes con otras citas ni con filas
//    anteriores del mismo archivo);
//  * saldos: un saldo inicial vigente por paciente (trigger de la base).
import { DateTime } from "luxon";
import type { Client } from "../../lib/db.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { AppError, badRequest, fromPgError } from "../../lib/errors.js";
import { money, normalize } from "../../lib/text.js";
import { findDuplicates, insertPatient, patientBody, validatePatient } from "../patients.js";
import { assertBookable, clinicZone } from "../agenda.js";
import { recordAppointmentEvent } from "../appointmentEvents.js";
import { parseDate, parseDocument, parseMoney, parseTime, type FieldDef, type ImportKind, type RowStatus } from "./importCore.js";

export interface RunOpts { dryRun: boolean; includeReview: boolean; cutoffDate: string | null; batchId: string }
export interface RowOutcome {
  status: RowStatus;
  message?: string;
  ref?: string;
  created?: { patientId?: string; appointmentId?: string; openingBalanceId?: string; needsReview?: boolean };
}
export interface KindHandler {
  fields: FieldDef[];
  /** Filas de ejemplo (ficticias) para la plantilla, en el orden de fields. */
  examples: string[][];
  /** Validación adicional del mapeo (campos «uno de»). */
  checkMapping(mapping: Record<string, number | null | undefined>, branchCount: number): void;
  prepare(c: Client, auth: AuthCtx, opts: RunOpts): Promise<unknown>;
  row(c: Client, auth: AuthCtx, ctx: unknown, v: Record<string, string>, row: number, opts: RunOpts): Promise<RowOutcome>;
}

const errMsg = (e: unknown) => {
  if (e instanceof AppError) return e.message;
  const pg = fromPgError(e);
  if (pg) return pg.message;
  if (e && typeof e === "object" && "issues" in e) return ((e as { issues: { message: string }[] }).issues ?? []).map((i) => i.message).join("; ");
  return "Error inesperado en la fila";
};

/** Ejecuta fn en un SAVEPOINT: si falla, deshace solo esa fila. */
async function inSavepoint<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("SAVEPOINT import_row");
  try {
    const r = await fn();
    await c.query("RELEASE SAVEPOINT import_row");
    return r;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT import_row");
    throw e;
  }
}

const one = (mapping: Record<string, number | null | undefined>, keys: string[], what: string) => {
  if (!keys.some((k) => mapping[k] != null)) throw badRequest(`Elige la columna de ${what}`);
};

const fmtDay = (iso: string) => DateTime.fromISO(iso).toFormat("dd/MM/yyyy");

// ---------------- Búsqueda del paciente (citas y saldos) ----------------
const PATIENT_REF_FIELDS: FieldDef[] = [
  { key: "patientDoc", label: "CI del paciente", aliases: ["ci", "ci paciente", "ci del paciente", "documento", "carnet", "cedula", "numero de documento", "nro documento"],
    help: "Número de carnet del paciente, tal como está en su ficha (los puntos y el expedido «LP», «SC»… se ignoran). Usa esta columna o la de N° de ficha." },
  { key: "patientRecord", label: "N° de ficha", aliases: ["ficha", "n de ficha", "nro ficha", "numero de ficha", "n ficha", "historia clinica", "id paciente"],
    help: "Si al importar pacientes llenaste «N° de ficha anterior», escribe ese mismo número; si no, el N° de ficha que muestra Dentalia." },
];

async function findPatient(c: Client, v: Record<string, string>): Promise<{ id: string; name: string; recordNumber: number } | string> {
  const docIn = v.patientDoc ?? "", recIn = v.patientRecord ?? "";
  if (!docIn && !recIn) return "Falta el CI o el N° de ficha del paciente";
  let byDoc: { id: string; name: string; recordNumber: number } | null = null;
  if (docIn) {
    const d = parseDocument(docIn);
    const r = (await c.query<{ id: string; name: string; recordNumber: number }>(
      `SELECT id, first_name || ' ' || last_name AS name, record_number AS "recordNumber" FROM patients
        WHERE archived_at IS NULL AND upper(replace(replace(document_number, '.', ''), ' ', '')) = $1 LIMIT 3`, [d.number])).rows;
    if (r.length > 1) return `Hay ${r.length} pacientes con el documento ${d.number}: usa el N° de ficha`;
    if (r.length === 1) byDoc = r[0]!;
    else if (!recIn) return `No existe un paciente con el documento ${d.number} (impórtalo primero en «Pacientes»)`;
  }
  let byRec: { id: string; name: string; recordNumber: number } | null = null;
  if (recIn) {
    const viaImport = (await c.query<{ id: string; name: string; recordNumber: number }>(
      `SELECT p.id, p.first_name || ' ' || p.last_name AS name, p.record_number AS "recordNumber"
         FROM import_records ir JOIN patients p ON p.id = ir.patient_id
        WHERE ir.kind = 'patients' AND ir.external_key = $1 AND p.archived_at IS NULL`, [`ext:${normalize(recIn)}`])).rows[0];
    if (viaImport) byRec = viaImport;
    else if (/^\d{1,12}$/.test(recIn.trim())) {
      byRec = (await c.query<{ id: string; name: string; recordNumber: number }>(
        `SELECT id, first_name || ' ' || last_name AS name, record_number AS "recordNumber" FROM patients WHERE record_number = $1 AND archived_at IS NULL`,
        [Number(recIn.trim())])).rows[0] ?? null;
    }
    if (!byRec && !byDoc) return `No existe un paciente con la ficha ${recIn}`;
  }
  if (byDoc && byRec && byDoc.id !== byRec.id) return `El CI corresponde a la ficha ${byDoc.recordNumber} y el N° de ficha a la ficha ${byRec.recordNumber}: revisa cuál es el correcto`;
  return (byDoc ?? byRec)!;
}

// ---------------- Pacientes ----------------
const PATIENT_FIELDS: FieldDef[] = [
  { key: "firstName", label: "Nombres", aliases: ["nombre", "nombres", "primer nombre"], help: "Nombres del paciente. Obligatorio, salvo que uses la columna «Nombre completo»." },
  { key: "lastName", label: "Apellidos", aliases: ["apellido", "apellidos", "apellido paterno"], help: "Apellidos (o apellido paterno). Obligatorio, salvo que uses «Nombre completo»." },
  { key: "lastName2", label: "Apellido materno", aliases: ["apellido materno", "segundo apellido"], help: "Opcional: si tu sistema separa los apellidos, se une al anterior." },
  { key: "fullName", label: "Nombre completo", aliases: ["nombre completo", "paciente", "nombre y apellido", "nombres y apellidos"],
    help: "Solo si tu sistema tiene el nombre en una sola columna. Con «Apellidos, Nombres» se separa por la coma; sin coma, las primeras palabras son los nombres (2 de 4, 1 de 3)." },
  { key: "documentNumber", label: "CI", aliases: ["ci", "carnet", "documento", "numero de documento", "nro documento", "cedula", "cedula de identidad", "n documento"],
    help: "Número de documento. Se quitan los puntos; si trae el expedido pegado (1234567 LP) se separa solo. Vacío = «Sin documento»." },
  { key: "documentType", label: "Tipo de documento", aliases: ["tipo de documento", "tipo documento"], help: "Opcional: CI, Pasaporte, CE u Otro. Si está vacío y hay número, se toma CI." },
  { key: "documentIssued", label: "Expedido", aliases: ["exp", "expedido en", "extension"], help: "Opcional: LP, CB, SC, OR, PT, CH, TJ, BE o PD." },
  { key: "birthDate", label: "Fecha de nacimiento", aliases: ["nacimiento", "fecha nac", "f nacimiento", "fecha de nac", "fecha nacimiento"],
    help: "Formato dd/mm/aaaa (05/03/1985) o fecha de Excel. A los menores de 18 años hay que indicarles un responsable." },
  { key: "sex", label: "Sexo", aliases: ["genero", "sexo"], help: "Opcional: F, M u Otro (también Femenino/Masculino)." },
  { key: "phone", label: "Celular", aliases: ["telefono", "celular", "whatsapp", "movil", "telf", "cel", "telefono celular"], help: "Opcional. 8 dígitos (71234567) o con +591." },
  { key: "email", label: "Correo", aliases: ["email", "e-mail", "correo electronico", "mail"], help: "Opcional." },
  { key: "address", label: "Dirección", aliases: ["direccion", "domicilio"], help: "Opcional." },
  { key: "city", label: "Ciudad", aliases: ["ciudad", "localidad"], help: "Opcional." },
  { key: "occupation", label: "Ocupación", aliases: ["ocupacion", "profesion"], help: "Opcional." },
  { key: "guardianName", label: "Responsable", aliases: ["tutor", "apoderado", "nombre del responsable", "responsable"], help: "Obligatorio para menores de edad: madre, padre o tutor." },
  { key: "guardianPhone", label: "Teléfono del responsable", aliases: ["telefono responsable", "celular responsable", "telefono del tutor"], help: "Opcional." },
  { key: "referralSource", label: "¿Cómo nos conoció?", aliases: ["como nos conocio", "referido por", "fuente", "origen"], help: "Opcional." },
  { key: "notes", label: "Notas", aliases: ["notas", "observaciones", "nota", "comentarios"], help: "Notas administrativas (no clínicas: la historia clínica no se importa)." },
  { key: "externalId", label: "N° de ficha anterior", aliases: ["id externo", "ficha anterior", "n de ficha anterior", "codigo", "id", "nro ficha", "n de ficha", "numero de ficha", "ficha", "historia clinica"],
    help: "El número o código que tenía el paciente en tu sistema anterior. Evita duplicados si importas otra vez y sirve para vincular citas y saldos." },
];

function splitFullName(s: string): { first: string; last: string } {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.includes(",")) {
    const [last, first] = t.split(",", 2).map((x) => x.trim());
    return { first: first ?? "", last: last ?? "" };
  }
  const w = t.split(" ");
  if (w.length === 1) return { first: w[0]!, last: "" };
  const nFirst = w.length === 2 || w.length === 3 ? 1 : Math.floor(w.length / 2);
  return { first: w.slice(0, nFirst).join(" "), last: w.slice(nFirst).join(" ") };
}

const DOC_TYPES: Record<string, string> = { ci: "CI", carnet: "CI", "cedula de identidad": "CI", pasaporte: "PASAPORTE", passport: "PASAPORTE", ce: "CE", "carnet de extranjero": "CE", "carnet de extranjeria": "CE", otro: "OTRO", sin: "SIN", "sin documento": "SIN" };

interface PatientCtx { docs: Map<string, number>; names: Map<string, number> }

const patients: KindHandler = {
  fields: PATIENT_FIELDS,
  examples: [
    ["Lucía", "Flores", "", "", "4567890", "CI", "LP", "05/03/1985", "F", "71234567", "lucia.ejemplo@correo.bo", "Calle Ficticia 123", "La Paz", "Profesora", "", "", "Recomendación", "Prefiere turnos de tarde", "A-0001"],
    ["Mateo", "Quispe", "Mamani", "", "", "", "", "12/08/2015", "M", "", "", "", "El Alto", "", "Rosa Mamani (madre)", "72345678", "", "", "A-0002"],
    ["", "", "", "Vargas Rojas, Ana María", "8765432 SC", "", "", "1990-11-20", "F", "+59176543210", "", "", "Santa Cruz", "", "", "", "", "", "A-0003"],
  ],
  checkMapping(mapping) {
    if (mapping.fullName == null && (mapping.firstName == null || mapping.lastName == null)) {
      throw badRequest("Elige las columnas de Nombres y Apellidos, o la de Nombre completo");
    }
  },
  async prepare() { return { docs: new Map(), names: new Map() } satisfies PatientCtx; },
  async row(c, auth, rawCtx, v, rowNum, opts) {
    const ctx = rawCtx as PatientCtx;
    let first = v.firstName ?? "", last = [v.lastName, v.lastName2].filter(Boolean).join(" ");
    if ((!first || !last) && v.fullName) ({ first, last } = splitFullName(v.fullName));
    if (!first || !last) return { status: "error", message: "Faltan los nombres o los apellidos" };
    const doc = parseDocument(v.documentNumber ?? "");
    const typeIn = normalize(v.documentType);
    const documentType = typeIn ? DOC_TYPES[typeIn] : doc.number ? "CI" : "SIN";
    if (!documentType) return { status: "error", message: `Tipo de documento no reconocido: «${v.documentType}» (usa CI, Pasaporte, CE u Otro)` };
    let birthDate: string | null = null;
    if (v.birthDate) {
      birthDate = parseDate(v.birthDate);
      if (!birthDate) return { status: "error", message: `Fecha de nacimiento no válida: «${v.birthDate}» (usa dd/mm/aaaa)` };
    }
    const sx = normalize(v.sex);
    const sex = !sx ? null : /^(f|fem|femenino|mujer)$/.test(sx) ? "F" : /^(m|masc|masculino|hombre|varon)$/.test(sx) ? "M" : /^(x|otro)$/.test(sx) ? "X" : undefined;
    if (sex === undefined) return { status: "error", message: `Sexo no reconocido: «${v.sex}» (usa F, M u Otro)` };
    const parsed = patientBody.safeParse({
      firstName: first, lastName: last, documentType: documentType === "SIN" ? "SIN" : documentType, documentNumber: documentType === "SIN" ? null : doc.number,
      documentIssued: (v.documentIssued || doc.issued || "").toUpperCase().slice(0, 10) || null, birthDate, sex,
      phone: v.phone || null, email: v.email || null, address: v.address || null, city: v.city || null, occupation: v.occupation || null,
      guardianName: v.guardianName || null, guardianPhone: v.guardianPhone || null, referralSource: v.referralSource || null, notes: v.notes || null,
    });
    if (!parsed.success) return { status: "error", message: parsed.error.issues.map((i) => i.message).join("; ") };
    const p = parsed.data;
    try { validatePatient(p); } catch (e) { return { status: "error", message: errMsg(e) }; }
    // Duplicados dentro del archivo
    if (p.documentNumber) {
      const prev = ctx.docs.get(p.documentNumber);
      if (prev) return { status: "duplicate", message: `Documento repetido en el archivo (igual a la fila ${prev})` };
    }
    const nameKey = p.birthDate ? `${normalize(`${p.firstName} ${p.lastName}`)}|${p.birthDate}` : null;
    if (nameKey && ctx.names.has(nameKey)) return { status: "duplicate", message: `Mismo nombre y fecha de nacimiento que la fila ${ctx.names.get(nameKey)}` };
    if (p.documentNumber) ctx.docs.set(p.documentNumber, rowNum);
    if (nameKey) ctx.names.set(nameKey, rowNum);
    // Duplicados contra los pacientes existentes
    const dups = await findDuplicates(c, p);
    const byDoc = dups.find((d) => d.reason === "documento");
    if (byDoc) return { status: "duplicate", message: `Ya existe: ficha ${byDoc.recordNumber} (mismo documento)`, ref: `Ficha ${byDoc.recordNumber}` };
    const same = dups.find((d) => normalize(`${d.firstName} ${d.lastName}`) === normalize(`${p.firstName} ${p.lastName}`) && p.birthDate && d.birthDate && String(d.birthDate).slice(0, 10) === p.birthDate);
    if (same) return { status: "duplicate", message: `Ya existe: ficha ${same.recordNumber} (mismo nombre y fecha de nacimiento)`, ref: `Ficha ${same.recordNumber}` };
    let review: string | null = null;
    if (dups.length) {
      const d = dups[0]!;
      review = `Posible duplicado de la ficha ${d.recordNumber} (${d.firstName} ${d.lastName}, coincide por ${d.reason})`;
      if (!opts.includeReview) return { status: "review", message: review };
    }
    try {
      const res = await inSavepoint(c, () => insertPatient(c, auth, p));
      return { status: review ? "review" : "ok", message: review ?? undefined, ref: `Ficha ${res.recordNumber}`, created: { patientId: res.id, needsReview: !!review } };
    } catch (e) {
      return { status: "error", message: errMsg(e) };
    }
  },
};

// ---------------- Citas futuras ----------------
const APPT_FIELDS: FieldDef[] = [
  { key: "date", label: "Fecha", required: true, aliases: ["fecha", "dia", "fecha de la cita", "fecha cita"], help: "Día de la cita: dd/mm/aaaa o fecha de Excel. Solo se importan citas futuras." },
  { key: "time", label: "Hora", required: true, aliases: ["hora", "hora inicio", "inicio", "hora de la cita", "hora de inicio"], help: "Hora de inicio en la hora de Bolivia: 09:30, 15:00 o «3:00 p. m.»." },
  { key: "durationMin", label: "Duración (min)", aliases: ["duracion", "minutos", "duracion min", "duracion minutos"], help: "Opcional. Si está vacía se usa la de la prestación, o 30 minutos." },
  { key: "professional", label: "Profesional", required: true, aliases: ["odontologo", "odontologa", "doctor", "doctora", "dentista", "profesional", "medico", "correo del profesional"],
    help: "Nombre del odontólogo tal como está en Configuración › Personal (con o sin «Dr.»/«Dra.») o su correo de ingreso." },
  { key: "branch", label: "Sucursal", aliases: ["sucursal", "sede", "consultorio central", "local"], help: "Código (p. ej. LPZ) o nombre de la sucursal. Si la clínica tiene una sola sucursal puede quedar vacía." },
  ...PATIENT_REF_FIELDS,
  { key: "procedure", label: "Prestación", aliases: ["prestacion", "tratamiento", "servicio", "procedimiento", "codigo prestacion"], help: "Opcional: código (CON-01) o nombre exacto de la prestación del catálogo." },
  { key: "chair", label: "Consultorio", aliases: ["consultorio", "sillon", "box", "gabinete"], help: "Opcional: nombre del consultorio de esa sucursal (p. ej. «Consultorio 1»)." },
  { key: "reason", label: "Motivo", aliases: ["motivo", "nota", "notas", "observaciones", "comentario"], help: "Opcional: motivo o nota de la cita (sin datos clínicos sensibles)." },
  { key: "externalId", label: "ID externo", aliases: ["id externo", "id", "id cita", "codigo cita", "codigo"], help: "Opcional: el código de la cita en tu sistema anterior. Evita duplicados si importas otra vez." },
];

interface ApptCtx {
  zone: string;
  now: number;
  branches: { id: string; code: string; name: string }[];
  pros: { id: string; email: string; name: string; tokens: string[] }[];
  procs: { id: string; code: string; name: string; duration: number }[];
  chairs: { id: string; branchId: string; name: string }[];
}

const TITLES = /^(dr|dra|doctor|doctora|od|odont|lic|licenciado|licenciada|prof)\.?$/;
const nameTokens = (s: string) => normalize(s).replace(/[().,]/g, " ").split(" ").filter((w) => w && !TITLES.test(w));

function findPro(ctx: ApptCtx, input: string): ApptCtx["pros"][number] | string {
  const raw = input.trim();
  if (raw.includes("@")) return ctx.pros.find((p) => p.email === raw.toLowerCase()) ?? `No hay un profesional activo con el correo ${raw}`;
  const tokens = nameTokens(raw);
  if (!tokens.length) return "Falta el profesional";
  const key = tokens.join(" ");
  const exact = ctx.pros.filter((p) => p.tokens.join(" ") === key);
  if (exact.length === 1) return exact[0]!;
  const partial = ctx.pros.filter((p) => tokens.every((t) => p.tokens.includes(t)));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1 || exact.length > 1) return `«${raw}» coincide con varios profesionales (${(exact.length > 1 ? exact : partial).map((p) => p.name).join(", ")}): usa el correo`;
  return `No hay un profesional activo llamado «${raw}» (revisa Configuración › Personal: debe estar marcado «Atiende pacientes»)`;
}

const appointments: KindHandler = {
  fields: APPT_FIELDS,
  examples: [
    ["15/12/2026", "09:30", "45", "Dra. Elena Vargas", "LPZ", "4567890", "", "PRE-01", "Consultorio 1", "Limpieza semestral", "C-1001"],
    ["16/12/2026", "15:00", "", "dr.mendoza@demo.local", "La Paz Sur", "", "A-0002", "Consulta y diagnóstico", "", "Control", "C-1002"],
  ],
  checkMapping(mapping, branchCount) {
    one(mapping, ["patientDoc", "patientRecord"], "CI del paciente o N° de ficha");
    if (mapping.branch == null && branchCount > 1) throw badRequest("Elige la columna de Sucursal (la clínica tiene varias sucursales)");
  },
  async prepare(c, auth) {
    const zone = await clinicZone(c, auth.clinicId!);
    const branches = (await c.query<{ id: string; code: string; name: string }>("SELECT id, code, name FROM branches WHERE active ORDER BY code")).rows;
    const pros = (await c.query<{ id: string; email: string; name: string }>(
      `SELECT m.user_id AS id, u.email, u.full_name AS name FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.clinic_id = $1 AND m.active AND m.is_professional`, [auth.clinicId])).rows.map((p) => ({ ...p, tokens: nameTokens(p.name) }));
    const procs = (await c.query<{ id: string; code: string; name: string; duration: number }>(
      "SELECT id, code, name, duration_min AS duration FROM procedures WHERE active")).rows;
    const chairs = (await c.query<{ id: string; branchId: string; name: string }>(
      `SELECT id, branch_id AS "branchId", name FROM chairs WHERE active`)).rows;
    return { zone, now: Date.now(), branches, pros, procs, chairs } satisfies ApptCtx;
  },
  async row(c, auth, rawCtx, v, _rowNum, opts) {
    const ctx = rawCtx as ApptCtx;
    const date = parseDate(v.date ?? "");
    if (!date) return { status: "error", message: v.date ? `Fecha no válida: «${v.date}» (usa dd/mm/aaaa)` : "Falta la fecha" };
    const time = parseTime(v.time ?? "");
    if (!time) return { status: "error", message: v.time ? `Hora no válida: «${v.time}» (usa HH:MM, p. ej. 09:30)` : "Falta la hora" };
    const start = DateTime.fromISO(`${date}T${time}`, { zone: ctx.zone });
    if (!start.isValid) return { status: "error", message: "Fecha u hora inexistente" };
    if (start.toMillis() <= ctx.now) return { status: "error", message: `La cita del ${fmtDay(date)} ${time} ya pasó: solo se importan citas futuras` };
    if (start.toMillis() > ctx.now + 731 * 86_400_000) return { status: "error", message: "La cita es para dentro de más de 2 años: revisa la fecha" };
    // Sucursal
    let branch = ctx.branches.length === 1 && !v.branch ? ctx.branches[0]! : undefined;
    if (!branch) {
      if (!v.branch) return { status: "error", message: "Falta la sucursal" };
      const b = normalize(v.branch);
      branch = ctx.branches.find((x) => normalize(x.code) === b) ?? ctx.branches.find((x) => normalize(x.name) === b);
      if (!branch) return { status: "error", message: `No existe una sucursal activa «${v.branch}» (usa el código o el nombre de Configuración › Sucursales)` };
    }
    // Profesional
    const pro = findPro(ctx, v.professional ?? "");
    if (typeof pro === "string") return { status: "error", message: pro };
    // Paciente
    const patient = await findPatient(c, v);
    if (typeof patient === "string") return { status: "error", message: patient };
    // Prestación y duración
    let proc: ApptCtx["procs"][number] | undefined;
    if (v.procedure) {
      const p = normalize(v.procedure);
      proc = ctx.procs.find((x) => normalize(x.code) === p) ?? ctx.procs.find((x) => normalize(x.name) === p);
      if (!proc) return { status: "error", message: `No existe la prestación «${v.procedure}» en el catálogo` };
    }
    let duration = proc?.duration ?? 30;
    if (v.durationMin) {
      const d = Number(v.durationMin.replace(",", "."));
      if (!Number.isInteger(d) || d < 5 || d > 480) return { status: "error", message: `Duración no válida: «${v.durationMin}» (minutos enteros entre 5 y 480)` };
      duration = d;
    }
    let chairId: string | null = null;
    if (v.chair) {
      const ch = ctx.chairs.find((x) => x.branchId === branch!.id && normalize(x.name) === normalize(v.chair));
      if (!ch) return { status: "error", message: `La sucursal ${branch.name} no tiene un consultorio activo «${v.chair}»` };
      chairId = ch.id;
    }
    const startsAt = start.toJSDate();
    const endsAt = start.plus({ minutes: duration }).toJSDate();
    const base = { branchId: branch.id, dentistId: pro.id, chairId, startsAt, endsAt };
    let review: string | null = null;
    try {
      await assertBookable(c, auth, ctx.zone, { ...base, allowOutsideSchedule: false });
    } catch (e) {
      if (e instanceof AppError && e.code === "outside_schedule") {
        review = `Fuera del horario de ${pro.name} en ${branch.name} (${e.message.toLowerCase()})`;
        if (!opts.includeReview) return { status: "review", message: review };
        try { await assertBookable(c, auth, ctx.zone, { ...base, allowOutsideSchedule: true }); } catch (e2) { return { status: "error", message: errMsg(e2) }; }
      } else return { status: "error", message: errMsg(e) };
    }
    const label = `${fmtDay(date)} ${time} · ${patient.name} con ${pro.name}`;
    try {
      const id = await inSavepoint(c, async () => {
        const notes = review ? "Importada desde el sistema anterior, fuera del horario del profesional: revisar." : "Importada desde el sistema anterior.";
        const r = await c.query<{ id: string }>(
          `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, reason, notes, source, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reception',$11) RETURNING id`,
          [auth.clinicId, branch!.id, chairId, pro.id, patient.id, proc?.id ?? null, startsAt, endsAt, v.reason ? v.reason.slice(0, 200) : null, notes, auth.userId]);
        const apptId = r.rows[0]!.id;
        await recordAppointmentEvent(c, auth, { appointmentId: apptId, branchId: branch!.id, from: null, to: "scheduled", reason: "Importada" });
        return apptId;
      });
      return { status: review ? "review" : "ok", message: review ?? undefined, ref: label, created: { appointmentId: id, patientId: patient.id, needsReview: !!review } };
    } catch (e) {
      const pg = fromPgError(e);
      const msg = pg?.code?.startsWith("appointment_overlap") || pg?.code === "overlap"
        ? `${pg.message} (con una cita existente o con una fila anterior de este archivo)` : errMsg(e);
      return { status: "error", message: msg };
    }
  },
};

// ---------------- Saldos iniciales ----------------
const BALANCE_FIELDS: FieldDef[] = [
  ...PATIENT_REF_FIELDS,
  { key: "balance", label: "Saldo (Bs)", aliases: ["saldo", "saldo bs", "saldo actual", "saldo pendiente", "saldo final"],
    help: "Saldo al día del corte. Positivo = el paciente debe a la clínica; negativo = saldo a favor del paciente. Usa esta columna o «Debe» y «A favor»." },
  { key: "debt", label: "Debe (Bs)", aliases: ["debe", "deuda", "por cobrar", "debe bs", "monto adeudado"], help: "Alternativa a «Saldo»: lo que el paciente debe." },
  { key: "credit", label: "A favor (Bs)", aliases: ["a favor", "saldo a favor", "anticipo", "haber", "credito"], help: "Alternativa a «Saldo»: lo que la clínica le debe al paciente (pagos adelantados)." },
  { key: "cutoffDate", label: "Fecha de corte", aliases: ["fecha de corte", "fecha corte", "al", "fecha"], help: "Opcional: día al que corresponde el saldo. Si está vacía se usa la fecha de corte que eliges en la pantalla. No puede ser futura." },
  { key: "branch", label: "Sucursal", aliases: ["sucursal", "sede"], help: "Opcional: código o nombre de la sucursal donde se generó la deuda." },
  { key: "notes", label: "Nota", aliases: ["nota", "detalle", "observaciones", "concepto"], help: "Opcional: detalle del saldo (p. ej. «tratamiento de ortodoncia en curso»)." },
  { key: "externalId", label: "ID externo", aliases: ["id externo", "id", "codigo"], help: "Opcional: código del movimiento en tu sistema anterior." },
];

interface BalanceCtx { today: string; branches: { id: string; code: string; name: string }[]; patients: Map<string, number> }

const balances: KindHandler = {
  fields: BALANCE_FIELDS,
  examples: [
    ["4567890", "", "350,00", "", "", "31/10/2026", "LPZ", "Saldo de restauraciones", "S-01"],
    ["", "A-0003", "-120,50", "", "", "31/10/2026", "", "Adelanto para blanqueamiento", "S-02"],
    ["", "A-0002", "", "800", "100", "", "", "Ortodoncia: cuotas pendientes menos adelanto", "S-03"],
  ],
  checkMapping(mapping) {
    one(mapping, ["patientDoc", "patientRecord"], "CI del paciente o N° de ficha");
    one(mapping, ["balance", "debt", "credit"], "Saldo (o Debe / A favor)");
  },
  async prepare(c, auth, opts) {
    const zone = await clinicZone(c, auth.clinicId!);
    const today = DateTime.now().setZone(zone).toISODate()!;
    if (opts.cutoffDate && opts.cutoffDate > today) throw badRequest("La fecha de corte no puede ser futura");
    const branches = (await c.query<{ id: string; code: string; name: string }>("SELECT id, code, name FROM branches WHERE active")).rows;
    return { today, branches, patients: new Map() } satisfies BalanceCtx;
  },
  async row(c, auth, rawCtx, v, rowNum, opts) {
    const ctx = rawCtx as BalanceCtx;
    const patient = await findPatient(c, v);
    if (typeof patient === "string") return { status: "error", message: patient };
    let amount: number | null;
    if (v.balance) {
      amount = parseMoney(v.balance);
      if (amount === null) return { status: "error", message: `Saldo no válido: «${v.balance}» (usa 1500,50 o −120)` };
    } else {
      const debt = v.debt ? parseMoney(v.debt) : 0, credit = v.credit ? parseMoney(v.credit) : 0;
      if (debt === null || credit === null) return { status: "error", message: `Monto no válido: «${debt === null ? v.debt : v.credit}»` };
      if (debt < 0 || credit < 0) return { status: "error", message: "«Debe» y «A favor» se escriben en positivo" };
      amount = debt - credit;
    }
    if (amount === 0) return { status: "skipped", message: "Saldo cero: no se registra nada" };
    if (Math.abs(amount) > 1_000_000_000) return { status: "error", message: "El monto supera el máximo permitido (Bs 10 000 000)" };
    const cutoff = v.cutoffDate ? parseDate(v.cutoffDate) : opts.cutoffDate;
    if (!cutoff) return { status: "error", message: v.cutoffDate ? `Fecha de corte no válida: «${v.cutoffDate}»` : "Falta la fecha de corte (en la columna o en la pantalla)" };
    if (cutoff > ctx.today) return { status: "error", message: "La fecha de corte no puede ser futura" };
    let branchId: string | null = null;
    if (v.branch) {
      const b = normalize(v.branch);
      const br = ctx.branches.find((x) => normalize(x.code) === b) ?? ctx.branches.find((x) => normalize(x.name) === b);
      if (!br) return { status: "error", message: `No existe una sucursal activa «${v.branch}»` };
      branchId = br.id;
    }
    const prevRow = ctx.patients.get(patient.id);
    if (prevRow) return { status: "duplicate", message: `El mismo paciente ya aparece en la fila ${prevRow}: un solo saldo inicial por paciente` };
    ctx.patients.set(patient.id, rowNum);
    const existing = (await c.query<{ amount_cents: number; cutoff_date: string }>(
      `SELECT ob.amount_cents, ob.cutoff_date FROM opening_balances ob
        WHERE ob.patient_id = $1 AND ob.voids_id IS NULL AND NOT EXISTS (SELECT 1 FROM opening_balances x WHERE x.voids_id = ob.id)`, [patient.id])).rows[0];
    if (existing) return { status: "duplicate", message: `La ficha ${patient.recordNumber} ya tiene un saldo inicial de ${money(existing.amount_cents)} al ${fmtDay(existing.cutoff_date)}` };
    const ref = `Ficha ${patient.recordNumber} · ${amount > 0 ? "debe" : "a favor"} ${money(Math.abs(amount))}`;
    try {
      const id = await inSavepoint(c, async () => (await c.query<{ id: string }>(
        `INSERT INTO opening_balances (clinic_id, patient_id, branch_id, amount_cents, cutoff_date, notes, batch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [auth.clinicId, patient.id, branchId, amount, cutoff, v.notes ? v.notes.slice(0, 500) : null, opts.batchId, auth.userId])).rows[0]!.id);
      return { status: "ok", ref, created: { openingBalanceId: id, patientId: patient.id } };
    } catch (e) {
      return { status: "error", message: errMsg(e) };
    }
  },
};

export const HANDLERS: Record<ImportKind, KindHandler> = { patients, appointments, balances };
