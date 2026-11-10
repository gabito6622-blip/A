// Plantillas de mensajes automáticos: variables permitidas, validación antes de guardar,
// vista previa con datos ficticios y texto equivalente para registrar la plantilla en Meta.
//
// Regla de privacidad: los mensajes NUNCA llevan datos clínicos. No existe ninguna variable de
// prestación, tratamiento o diagnóstico, y una plantilla que intente usarla se rechaza.

export const VARIABLES = [
  "nombre", "clinica", "sucursal", "direccion", "fecha", "hora", "profesional", "enlace_confirmar", "enlace_portal", "telefono_sucursal",
] as const;
export type Variable = (typeof VARIABLES)[number];

export const VARIABLE_LABELS: Record<Variable, string> = {
  nombre: "Nombre de pila del paciente",
  clinica: "Nombre de la clínica",
  sucursal: "Nombre de la sucursal",
  direccion: "Dirección de la sucursal",
  fecha: "Fecha (de la cita, del control o del presupuesto)",
  hora: "Hora de la cita",
  profesional: "Nombre del profesional",
  enlace_confirmar: "Enlace para confirmar o pedir reprogramar la cita",
  enlace_portal: "Enlace al portal del paciente o a la reserva",
  telefono_sucursal: "Teléfono o WhatsApp de la sucursal",
};

/** Palabras que nunca pueden ser variables (datos clínicos). */
const CLINICAL = /^(procedimientos?|tratamientos?|diagn[oó]sticos?|prestaci[oó]n(es)?|servicios?|procedures?|treatments?|diagnosis|diagnoses|motivo|pieza|diente)$/i;

export const TRIGGERS = ["appointment_created", "appointment_reminder", "after_visit", "recall_due", "budget_unanswered"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const TRIGGER_LABELS: Record<Trigger, string> = {
  appointment_created: "Al agendar la cita (confirmación)",
  appointment_reminder: "Antes de la cita (recordatorio)",
  after_visit: "Después de la visita (cuidados o encuesta)",
  recall_due: "Control pendiente (volver a citar)",
  budget_unanswered: "Presupuesto sin respuesta",
};

/** Variables disponibles según el disparador (lo que no existe en ese contexto se rechaza al guardar la regla). */
export const TRIGGER_VARIABLES: Record<Trigger, readonly Variable[]> = {
  appointment_created: VARIABLES,
  appointment_reminder: VARIABLES,
  after_visit: ["nombre", "clinica", "sucursal", "direccion", "fecha", "hora", "profesional", "enlace_portal", "telefono_sucursal"],
  recall_due: ["nombre", "clinica", "sucursal", "direccion", "fecha", "profesional", "enlace_portal", "telefono_sucursal"],
  budget_unanswered: ["nombre", "clinica", "sucursal", "direccion", "fecha", "profesional", "enlace_portal", "telefono_sucursal"],
};

export const OPT_OUT_LINE = "Responde BAJA para no recibir más.";
export type Purpose = "reminders" | "marketing";

export interface TemplateIssue { message: string; variable?: string; index?: number }

/** Variables usadas, en orden de aparición (para los parámetros de la plantilla de Meta). */
export function usedVariables(body: string): string[] {
  return [...body.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!.trim());
}

/**
 * Valida el texto de una plantilla. Devuelve errores (bloquean el guardado) y avisos.
 *  - variable desconocida → error con la lista de variables válidas;
 *  - variable clínica (tratamiento, diagnóstico…) → error específico;
 *  - llaves sin cerrar o vacías → error.
 */
export function validateTemplate(body: string, opts: { purpose?: Purpose; trigger?: Trigger } = {}): { errors: TemplateIssue[]; warnings: string[] } {
  const errors: TemplateIssue[] = [];
  const warnings: string[] = [];
  const text = body ?? "";
  if (text.trim().length < 5) errors.push({ message: "Escribe el mensaje (al menos 5 caracteres)" });
  if (text.length > 1000) errors.push({ message: `El mensaje es muy largo (${text.length} de 1000 caracteres)` });
  // Llaves desbalanceadas
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth > 0) { errors.push({ message: "Hay una llave «{» dentro de otra variable", index: i }); break; }
      depth++;
    } else if (ch === "}") {
      if (depth === 0) { errors.push({ message: "Hay una llave «}» sin abrir", index: i }); break; }
      depth--;
    }
  }
  if (depth > 0) errors.push({ message: "Hay una llave «{» sin cerrar: escribe las variables así: {nombre}" });
  const allowed = opts.trigger ? TRIGGER_VARIABLES[opts.trigger] : VARIABLES;
  const seen = new Set<string>();
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1]!.trim();
    if (seen.has(name)) continue;
    seen.add(name);
    if (!name) { errors.push({ message: "Hay una variable vacía «{}»", index: m.index }); continue; }
    const normalized = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (CLINICAL.test(name) || CLINICAL.test(normalized)) {
      errors.push({ message: `No se permiten datos clínicos en los mensajes: quita {${name}}. Los mensajes por WhatsApp no deben revelar tratamientos ni diagnósticos.`, variable: name, index: m.index });
      continue;
    }
    if (!(VARIABLES as readonly string[]).includes(name)) {
      errors.push({ message: `La variable {${name}} no existe. Usa una de: ${VARIABLES.map((v) => `{${v}}`).join(", ")}`, variable: name, index: m.index });
      continue;
    }
    if (!(allowed as readonly string[]).includes(name)) {
      errors.push({ message: `La variable {${name}} no está disponible para «${TRIGGER_LABELS[opts.trigger!]}»`, variable: name, index: m.index });
    }
  }
  if (opts.purpose === "marketing" && !/\bBAJA\b/.test(text)) warnings.push(`Se agregará al final: «${OPT_OUT_LINE}»`);
  if (opts.purpose === "reminders" && /(promoci[oó]n|descuento|oferta|% ?off|gratis)/i.test(text)) {
    warnings.push("Parece un mensaje promocional: usa el propósito «Marketing» para que solo llegue a quien aceptó promociones.");
  }
  return { errors, warnings };
}

/** Reemplaza las variables; las que falten quedan vacías (nunca se muestra «{x}» al paciente). */
export function renderTemplate(body: string, vars: Partial<Record<Variable, string>>, purpose: Purpose): string {
  let out = body.replace(/\{([^{}]*)\}/g, (_m, k: string) => vars[k.trim() as Variable] ?? "");
  out = out.replace(/[ \t]{2,}/g, " ").trim();
  if (purpose === "marketing" && !/\bBAJA\b/.test(out)) out = `${out}\n\n${OPT_OUT_LINE}`;
  return out;
}

/** Texto para registrar la plantilla en Meta ({{1}}, {{2}}…) y la lista de parámetros en orden. */
export function metaVersion(body: string, purpose: Purpose): { text: string; params: string[] } {
  const params: string[] = [];
  let text = body.replace(/\{([^{}]*)\}/g, (_m, k: string) => { params.push(k.trim()); return `{{${params.length}}}`; });
  if (purpose === "marketing" && !/\bBAJA\b/.test(text)) text = `${text}\n\n${OPT_OUT_LINE}`;
  return { text, params };
}

/** Datos ficticios para la vista previa (nunca de un paciente real). */
export function sampleVars(clinicName: string, publicUrl: string): Record<Variable, string> {
  return {
    nombre: "Lucía", clinica: clinicName, sucursal: "Sucursal Centro (ejemplo)", direccion: "Av. Ejemplo 123",
    fecha: "jueves 12 de noviembre", hora: "10:30", profesional: "Dra. Ejemplo",
    enlace_confirmar: `${publicUrl}/c/EJEMPLO`, enlace_portal: `${publicUrl}/mi-cuenta/ejemplo`, telefono_sucursal: "+591 70000000",
  };
}
