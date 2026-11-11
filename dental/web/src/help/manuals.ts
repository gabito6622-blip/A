// Manuales por puesto (docs/manuales/*.md) servidos dentro de la app como páginas del sistema.
// Son archivos estáticos del paquete web: no leen datos de la clínica y sus capturas son de la
// clínica demo ficticia. El Markdown se carga solo al abrir un manual (no infla el paquete inicial).

export type ManualId = "recepcion" | "caja" | "odontologo" | "asistente" | "limpieza" | "contabilidad" | "gerencia" | "propietaria" | "portal-paciente";

export interface ManualInfo { id: ManualId; label: string; summary: string }

export const MANUALS: ManualInfo[] = [
  { id: "recepcion", label: "Recepción", summary: "Agenda, pacientes, sala de espera y controles." },
  { id: "caja", label: "Caja", summary: "Abrir y cerrar caja, cobrar y entregar recibos." },
  { id: "odontologo", label: "Odontólogo", summary: "Ficha, odontograma, evolución, presupuestos y recetas." },
  { id: "asistente", label: "Asistente dental", summary: "Sala de espera, materiales, limpieza y esterilización." },
  { id: "limpieza", label: "Limpieza y apoyo", summary: "Limpieza de consultorios, esterilización y tareas." },
  { id: "contabilidad", label: "Contabilidad", summary: "Verificar pagos, conciliar, gastos, honorarios y reportes." },
  { id: "gerencia", label: "Gerencia", summary: "Equipo, caja, correcciones, seguimiento y mensajes." },
  { id: "propietaria", label: "Dueña o dueño", summary: "Puesta en marcha, resultados, precios y seguridad." },
  { id: "portal-paciente", label: "Portal del paciente", summary: "Guía para pacientes, madres y padres." },
];

/** Manuales que cada rol puede abrir; el primero es «el manual de mi puesto». */
const BY_ROLE: Record<string, ManualId[]> = {
  owner: ["propietaria", "gerencia", "recepcion", "caja", "odontologo", "asistente", "limpieza", "contabilidad", "portal-paciente"],
  admin: ["gerencia", "propietaria", "recepcion", "caja", "odontologo", "asistente", "limpieza", "contabilidad", "portal-paciente"],
  receptionist: ["recepcion", "caja", "portal-paciente"],
  dentist: ["odontologo", "portal-paciente"],
  assistant: ["asistente", "limpieza"],
  accountant: ["contabilidad", "caja"],
  support: ["limpieza"],
};

export function manualsForRole(role: string | null | undefined): ManualInfo[] {
  const ids = BY_ROLE[role ?? ""] ?? ["portal-paciente"];
  return ids.map((id) => MANUALS.find((m) => m.id === id)!);
}

// Vite empaqueta los .md como texto (carga diferida) y las capturas como archivos con hash.
const sources = import.meta.glob<string>("../../../docs/manuales/*.md", { query: "?raw", import: "default" });
const images = import.meta.glob<string>("../../../docs/manuales/capturas/*.{jpg,png}", { eager: true, query: "?url", import: "default" });

export async function loadManual(id: ManualId, sheet: boolean): Promise<string | null> {
  const load = sources[`../../../docs/manuales/${sheet ? `chuleta-${id}` : id}.md`];
  return load ? load() : null;
}

export function manualImage(src: string): string | null {
  return images[`../../../docs/manuales/${src}`] ?? null;
}

/** Enlaces dentro de los manuales: «x.md» → página del manual; «chuleta-x.md» → su hoja. */
export function manualLink(href: string): string | null {
  const md = href.match(/^(chuleta-)?([a-z-]+)\.md(#[a-z0-9-]+)?$/);
  if (md) return MANUALS.some((m) => m.id === md[2]) ? `/ayuda/manual/${md[2]}${md[1] ? "/hoja" : ""}${md[3] ?? ""}` : null;
  return href;
}
