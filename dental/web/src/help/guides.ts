// Guías cortas por rol, en español sencillo. Los nombres de botones, pestañas y pantallas son los
// de la interfaz real (entre «comillas»). Si cambia un texto de la interfaz, actualízalo aquí.
// No se describen funciones que no existen.

export type HelpRole = "reception" | "dentist" | "assistant" | "accountant" | "support" | "owner";

export const HELP_ROLES: { id: HelpRole; label: string }[] = [
  { id: "reception", label: "Recepción" },
  { id: "dentist", label: "Odontólogo" },
  { id: "assistant", label: "Asistente" },
  { id: "accountant", label: "Contabilidad" },
  { id: "support", label: "Limpieza y apoyo" },
  { id: "owner", label: "Propietario y gerencia" },
];

/** Rol de la membresía → guía que se abre primero. */
export function helpRoleFor(role: string | undefined | null): HelpRole {
  switch (role) {
    case "receptionist": return "reception";
    case "dentist": return "dentist";
    case "assistant": return "assistant";
    case "accountant": return "accountant";
    case "support": return "support";
    default: return "owner"; // propietario y administración
  }
}

export interface HelpStep { text: string; to?: string; link?: string }
export interface Guide {
  id: string;
  title: string;
  roles: HelpRole[];
  /** Pantallas donde el botón «?» abre esta guía (prefijo de la ruta; "/" = solo el Inicio). */
  screens: string[];
  summary: string;
  steps: HelpStep[];
  tip?: string;
}

export const GUIDES: Guide[] = [
  // ---------------- Recepción ----------------
  {
    id: "agendar", title: "Agendar una cita", roles: ["reception", "dentist", "assistant", "owner"], screens: ["/agenda"],
    summary: "Desde la Agenda, con el paciente buscado por nombre, CI, celular o N° de ficha.",
    steps: [
      { text: "Abre la Agenda y elige la sucursal y el día (botones «Hoy», ‹ y ›, o la fecha).", to: "/agenda", link: "Ir a la Agenda" },
      { text: "Pulsa «Nueva cita». En «Paciente» escribe el nombre, CI, celular o N° de ficha; si es nuevo, usa «Paciente nuevo»." },
      { text: "Elige «Profesional», «Tipo de cita» o «Prestación» (precargan la duración), «Fecha» y «Hora»." },
      { text: "Pulsa «Agendar». Si el horario ya está ocupado o fuera del horario del profesional, el sistema lo avisa y no guarda." },
      { text: "¿No sabes cuándo hay lugar? Usa «Buscar horario»: muestra los próximos huecos libres de varios días." },
    ],
    tip: "Para cambiar una cita, ábrela y usa «Reprogramar»; para anularla, «Cancelar cita» con el motivo.",
  },
  {
    id: "recibir", title: "Recibir al paciente (sala de espera)", roles: ["reception", "assistant"], screens: ["/sala-espera", "/agenda"],
    summary: "Marca la llegada para que el profesional sepa que el paciente ya está.",
    steps: [
      { text: "Abre «Sala de espera».", to: "/sala-espera", link: "Ir a la Sala de espera" },
      { text: "En la columna «Por llegar», pulsa «Llegó» cuando el paciente se presenta (o «No asistió» si no vino)." },
      { text: "El paciente pasa a «En sala de espera»; cuando entra al consultorio, «Pasar a atención»." },
      { text: "Al terminar, «Atendido». Usa «Actualizar» si otra persona movió citas." },
    ],
  },
  {
    id: "paciente-nuevo", title: "Registrar un paciente nuevo", roles: ["reception", "assistant", "dentist"], screens: ["/pacientes"],
    summary: "Antes de crear, el sistema busca si ya existe (mismo CI, celular o nombre parecido).",
    steps: [
      { text: "Abre «Pacientes» y pulsa «Nuevo paciente».", to: "/pacientes", link: "Ir a Pacientes" },
      { text: "Completa «Nombres», «Apellidos» y el documento (o elige «Sin documento»). A los menores hay que ponerles un responsable." },
      { text: "Marca los consentimientos de recordatorios o promociones solo si el paciente los aceptó." },
      { text: "Pulsa «Guardar». Si aparece «Ya hay pacientes parecidos», revisa la ficha antes de usar «Es otra persona: registrar igual»." },
    ],
  },
  {
    id: "cobrar", title: "Cobrar (efectivo, QR o transferencia)", roles: ["reception", "owner"], screens: ["/pacientes/", "/caja"],
    summary: "El efectivo queda confirmado al recibirlo; el QR, la transferencia y la tarjeta quedan «Por verificar» hasta que otra persona lo vea en el banco.",
    steps: [
      { text: "Busca al paciente en «Pacientes» y abre su ficha.", to: "/pacientes", link: "Ir a Pacientes" },
      { text: "Entra a la pestaña «Cuenta y pagos» y pulsa «Registrar pago»." },
      { text: "Escribe el «Monto (Bs)» y el «Medio de pago». Para «QR bancario» o «Transferencia» copia el «N° de operación / referencia» del comprobante." },
      { text: "Pulsa «Registrar». Puedes descargar el «Recibo» en PDF cuando el pago está confirmado." },
    ],
    tip: "Una captura del QR no prueba que el dinero llegó: por eso el pago queda «Por verificar». La misma referencia no se puede registrar dos veces.",
  },
  {
    id: "cerrar-caja", title: "Abrir y cerrar mi caja", roles: ["reception", "owner"], screens: ["/caja"],
    summary: "Cuadra el efectivo de tu turno con un arqueo; el cierre queda guardado y no se modifica.",
    steps: [
      { text: "Abre «Caja». En «Mi caja» escribe el «Fondo inicial (Bs)» (el cambio con el que empiezas) y pulsa «Abrir caja».", to: "/caja", link: "Ir a Caja" },
      { text: "Durante el día, los cobros en efectivo se suman solos. Si sacas o pones dinero, usa «Ingreso o egreso»." },
      { text: "Al final, pulsa «Cerrar caja (arqueo)» y escribe la cantidad de billetes y monedas de cada valor que contaste." },
      { text: "Si hay diferencia, escribe el motivo (es obligatorio) y pulsa «Cerrar caja». Se abre el reporte para imprimir." },
    ],
  },
  {
    id: "recordatorios", title: "Enviar recordatorios por WhatsApp", roles: ["reception"], screens: ["/agenda"],
    summary: "Solo a pacientes que aceptaron recibirlos; el mensaje no lleva datos clínicos.",
    steps: [
      { text: "En la Agenda pulsa «Recordatorios».", to: "/agenda", link: "Ir a la Agenda" },
      { text: "Elige el día en «Citas del día» y pulsa «Enviar» en cada paciente: se abre WhatsApp con el mensaje listo para mandar." },
    ],
    tip: "Si la clínica activó los mensajes automáticos, algunos avisos salen solos; fuera de producción solo se simulan.",
  },
  {
    id: "controles", title: "Llamar a los pacientes que deben volver (controles)", roles: ["reception", "assistant"], screens: ["/controles"],
    summary: "Lista mensual de pacientes que necesitan un control, con los intentos de contacto.",
    steps: [
      { text: "Abre «Controles»; la pestaña «Por contactar (pendientes y a revisar)» muestra a quién llamar.", to: "/controles", link: "Ir a Controles" },
      { text: "Después de llamar, pulsa «Registrar intento» con el resultado." },
      { text: "Si acepta, pulsa «Agendar»: la cita queda vinculada al control." },
    ],
  },
  {
    id: "tareas", title: "Tareas del equipo", roles: ["reception", "dentist", "assistant", "accountant", "support", "owner"], screens: ["/tareas"],
    summary: "Pendientes internos asignados a una persona o a un rol.",
    steps: [
      { text: "Abre «Tareas». En «Mis tareas» ves lo tuyo; en «Tablero», lo de la sucursal.", to: "/tareas", link: "Ir a Tareas" },
      { text: "Pulsa «Tomar» para que el equipo sepa que lo haces tú, y «Marcar hecha» al terminar." },
      { text: "Para pedir algo a otra persona, «Nueva tarea»." },
    ],
  },

  // ---------------- Odontólogo ----------------
  {
    id: "mi-dia", title: "Ver mis pacientes del día", roles: ["dentist"], screens: ["/"],
    summary: "En el Inicio aparecen tus citas de hoy con las alertas médicas.",
    steps: [
      { text: "En el Inicio, la tarjeta «Mis pacientes de hoy» muestra hora, paciente, prestación y alertas (alergias, anticoagulantes…).", to: "/", link: "Ir al Inicio" },
      { text: "Pulsa el nombre del paciente para abrir su ficha." },
    ],
  },
  {
    id: "evolucion", title: "Atender y registrar la evolución", roles: ["dentist"], screens: ["/pacientes/", "/sala-espera"],
    summary: "La evolución se firma y no se edita: las correcciones se hacen con una enmienda.",
    steps: [
      { text: "Abre la ficha del paciente (desde el Inicio, la Agenda o «Pacientes»).", to: "/pacientes", link: "Ir a Pacientes" },
      { text: "En la pestaña «Odontograma» marca los hallazgos; en «Historia clínica» revisa los «Antecedentes médicos» (con «Actualizar» si cambiaron)." },
      { text: "En «Historia clínica», bajo «Nueva evolución», elige el «Tipo», escribe el «Detalle» (y el diagnóstico si corresponde) y pulsa «Firmar y guardar»." },
      { text: "Si te equivocaste, usa «Enmendar» en la nota: la original se conserva." },
      { text: "En la Sala de espera o en la cita, marca «Atendido» al terminar.", to: "/sala-espera", link: "Ir a la Sala de espera" },
    ],
  },
  {
    id: "tratamiento-realizado", title: "Registrar un tratamiento realizado", roles: ["dentist"], screens: ["/pacientes/", "/presupuestos"],
    summary: "Al marcarlo realizado se genera el cargo en la cuenta del paciente y se actualiza el odontograma.",
    steps: [
      { text: "En la ficha, pestaña «Presupuestos», abre el presupuesto aceptado.", to: "/pacientes", link: "Ir a Pacientes" },
      { text: "En la línea del tratamiento pulsa «Realizado» (o «Sesión realizada» si es por sesiones)." },
      { text: "Si el paciente aún no aceptó, primero «Marcar como presentado» y luego «Paciente aceptó»." },
    ],
  },
  {
    id: "receta", title: "Emitir una receta", roles: ["dentist"], screens: ["/pacientes/"],
    summary: "La receta se congela con su PDF y su código de verificación al emitirla.",
    steps: [
      { text: "En la ficha del paciente abre la pestaña «Documentos».", to: "/pacientes", link: "Ir a Pacientes" },
      { text: "Pulsa «Nueva receta» y elige la «Sucursal (membrete)»." },
      { text: "Para cada medicamento completa «Medicamento y presentación», «Dosis», «Frecuencia» y «Duración»; usa «Agregar medicamento» para otro." },
      { text: "Pulsa «Emitir receta» y confirma con «Emitir». Descarga el «PDF» para imprimirlo o enviarlo." },
    ],
    tip: "Si el paciente tiene una alergia registrada que coincide, el sistema avisa antes de emitir. Para corregir una receta: «Anular» con motivo y «Reemitir corregido».",
  },

  // ---------------- Asistente ----------------
  {
    id: "consumo", title: "Registrar materiales usados", roles: ["assistant", "dentist"], screens: ["/inventario"],
    summary: "Descuenta del stock de la sucursal lo que se usó.",
    steps: [
      { text: "Abre «Inventario» con la sucursal correcta.", to: "/inventario", link: "Ir a Inventario" },
      { text: "Pulsa «Consumir», elige el insumo y la cantidad, y pulsa «Registrar consumo»." },
    ],
    tip: "Los tratamientos con consumo estándar descuentan solos al marcarse realizados.",
  },

  // ---------------- Limpieza y apoyo ----------------
  {
    id: "limpieza", title: "Registrar la limpieza de un consultorio", roles: ["support", "assistant"], screens: ["/bioseguridad"],
    summary: "Un toque por tarea: queda la hora y quién la hizo.",
    steps: [
      { text: "Abre «Bioseguridad» (para limpieza y apoyo es la pantalla de inicio).", to: "/bioseguridad", link: "Ir a Bioseguridad" },
      { text: "En la pestaña «Limpieza», en el consultorio que limpiaste, pulsa «Entre pacientes», «Apertura», «Cierre» o «Desinf. profunda»." },
      { text: "Para pasillos, baños o sala de espera usa «Áreas comunes»: elige el «Área» y la tarea (por ejemplo «Retiro de residuos»)." },
    ],
  },
  {
    id: "esterilizacion", title: "Registrar un ciclo de esterilización", roles: ["support", "assistant", "dentist"], screens: ["/bioseguridad"],
    summary: "Libro de esterilización con indicador químico y biológico.",
    steps: [
      { text: "En «Bioseguridad» abre la pestaña «Esterilización».", to: "/bioseguridad", link: "Ir a Bioseguridad" },
      { text: "Pulsa «Registrar ciclo» y completa «Equipo», «Programa», «Temperatura alcanzada (°C)», «Duración (min)» y la «Carga»." },
      { text: "En «Indicador químico» marca «Viró correctamente» o «No viró (falló)» y pulsa «Guardar ciclo»." },
      { text: "Cuando tengas el resultado del indicador biológico, pulsa «Registrar» en ese ciclo y elige «Negativo (sin crecimiento)» o «Positivo (crecimiento)»." },
    ],
    tip: "Si un indicador falla, el sistema lo muestra en rojo arriba de la pantalla: avisa a gerencia y no uses esa carga.",
  },
  {
    id: "fichar", title: "Marcar mi entrada y salida", roles: ["support", "reception", "assistant", "dentist", "accountant"], screens: ["/", "/bioseguridad"],
    summary: "Solo aparece si gerencia activó el fichaje para ti.",
    steps: [
      { text: "En el Inicio (o en Bioseguridad, para limpieza y apoyo) busca la tarjeta «Mi asistencia».", to: "/", link: "Ir al Inicio" },
      { text: "Al llegar pulsa «Marcar entrada» (si trabajas en varias sucursales, elige la «Sucursal»); al irte, «Marcar salida»." },
    ],
    tip: "Se guarda la hora del sistema, sin tu ubicación. Si te equivocas, pide a gerencia que lo corrija.",
  },

  // ---------------- Contabilidad ----------------
  {
    id: "verificar", title: "Verificar pagos con QR o transferencia", roles: ["accountant", "owner"], screens: ["/caja", "/conciliacion"],
    summary: "Confirma solo lo que viste en el extracto o en la banca por internet. Quien registró el pago no puede verificarlo.",
    steps: [
      { text: "Abre «Caja»: la tarjeta «Pagos por verificar en el banco» lista lo pendiente.", to: "/caja", link: "Ir a Caja" },
      { text: "Busca la referencia en el banco. Si está, pulsa «Confirmar»; si no llegó, «Rechazar»." },
      { text: "Con muchos pagos, usa «Conciliación»: en «Subir extracto» carga el archivo del banco y el sistema sugiere a qué pago corresponde cada movimiento.", to: "/conciliacion", link: "Ir a Conciliación" },
      { text: "En «Por conciliar», revisa cada sugerencia y confírmala, o «Descartar» si no corresponde." },
    ],
  },
  {
    id: "reportes", title: "Sacar reportes y exportar a Excel", roles: ["accountant", "owner"], screens: ["/reportes"],
    summary: "Cobrado, producción, cuentas por cobrar y más, por fechas.",
    steps: [
      { text: "Abre «Reportes» y elige «Desde» y «Hasta».", to: "/reportes", link: "Ir a Reportes" },
      { text: "Descarga lo que necesites: «Pagos (Excel)», «Panel por sucursal (Excel)», «Producción por profesional (Excel)» o «Cuentas por cobrar (Excel)»." },
    ],
    tip: "Las cuentas por cobrar incluyen los saldos iniciales importados del sistema anterior.",
  },
  {
    id: "gastos", title: "Registrar un gasto", roles: ["accountant", "owner"], screens: ["/gestion"],
    summary: "Los gastos confirmados entran en la rentabilidad por sucursal.",
    steps: [
      { text: "Abre «Gestión» y la pestaña «Gastos».", to: "/gestion?tab=gastos", link: "Ir a Gastos" },
      { text: "Pulsa «Registrar gasto», completa los datos y vuelve a pulsar «Registrar gasto»." },
    ],
  },
  {
    id: "honorarios", title: "Liquidar honorarios", roles: ["accountant", "owner"], screens: ["/honorarios"],
    summary: "Liquidación por profesional y período; al cerrarla ya no cambia.",
    steps: [
      { text: "Abre «Honorarios», pestaña «Liquidaciones».", to: "/honorarios", link: "Ir a Honorarios" },
      { text: "Pulsa «Preparar borradores del período», revisa cada uno y pulsa «Cerrar liquidación»." },
    ],
  },

  // ---------------- Propietario y gerencia ----------------
  {
    id: "primeros-pasos", title: "Poner en marcha la clínica", roles: ["owner"], screens: ["/", "/configuracion"],
    summary: "La lista «Primeros pasos» del Inicio se marca sola a medida que cargas los datos.",
    steps: [
      { text: "En el Inicio, revisa «Primeros pasos»: cada paso dice qué falta y tiene un botón a la pantalla exacta.", to: "/", link: "Ir al Inicio" },
      { text: "Completa los datos de la clínica, sucursales y consultorios, personal, horarios, prestaciones, tipos de cita y consentimientos.", to: "/configuracion?tab=clinic", link: "Ir a Configuración" },
      { text: "Activa la verificación en dos pasos en «Mi cuenta» (botón «Activar»).", to: "/cuenta", link: "Ir a Mi cuenta" },
      { text: "Cuando todo esté listo, usa «Ocultar del Inicio»." },
    ],
  },
  {
    id: "importar", title: "Traer los datos del sistema anterior", roles: ["owner"], screens: ["/importar"],
    summary: "Pacientes, citas futuras y saldos desde Excel, siempre revisando antes de guardar.",
    steps: [
      { text: "Abre «Importar datos» y elige qué traer: primero «Pacientes», luego «Citas futuras» y «Saldos iniciales».", to: "/importar", link: "Ir a Importar datos" },
      { text: "Si tu sistema exporta a Excel, usa ese archivo; si no, «Descargar plantilla» y copia tus datos en ella." },
      { text: "Elige el archivo y revisa qué columna corresponde a cada dato." },
      { text: "Pulsa «Revisar»: verás cuántos se crearán, cuántos están duplicados y qué filas tienen errores. «Descargar reporte (Excel)» te da el detalle fila por fila." },
      { text: "Corrige lo necesario y pulsa «Importar»; confirma el número exacto. Importar dos veces el mismo archivo no duplica." },
    ],
    tip: "La historia clínica, los odontogramas y las radiografías no se importan.",
  },
  {
    id: "personal", title: "Invitar al personal", roles: ["owner"], screens: ["/configuracion"],
    summary: "Cada persona entra con su correo y su rol; nunca compartan una misma cuenta.",
    steps: [
      { text: "En «Configuración», pestaña «Personal», pulsa «Agregar persona».", to: "/configuracion?tab=staff", link: "Ir a Personal" },
      { text: "Escribe «Nombre completo» y «Correo», elige el «Rol» y las «Sucursales». Para odontólogos marca «Atiende pacientes»." },
      { text: "Pulsa «Guardar»: aparece una contraseña temporal que se muestra una sola vez. Entrégala en persona." },
      { text: "Carga su horario en la pestaña «Horarios»: «Agregar turno» y «Guardar horario».", to: "/configuracion?tab=schedules", link: "Ir a Horarios" },
    ],
  },
  {
    id: "seguridad", title: "Exigir verificación en dos pasos", roles: ["owner"], screens: ["/configuracion", "/cuenta"],
    summary: "Solo el propietario define qué roles deben usarla.",
    steps: [
      { text: "En «Configuración», pestaña «Seguridad», marca los roles (o «Marcar recomendados»).", to: "/configuracion?tab=security", link: "Ir a Seguridad" },
      { text: "Pulsa «Guardar política». Esas personas deberán activarla en su próximo ingreso." },
    ],
  },
  {
    id: "seguimiento", title: "Ver cómo va la clínica", roles: ["owner"], screens: ["/", "/reportes", "/gestion"],
    summary: "Cobrado, producción, ocupación y rentabilidad por sucursal.",
    steps: [
      { text: "El Inicio muestra el mes por sucursal; «Rango libre» compara otro período con el anterior.", to: "/", link: "Ir al Inicio" },
      { text: "«Gestión» › «Rentabilidad» muestra ingresos, costos y gastos por sucursal y sillón.", to: "/gestion", link: "Ir a Gestión" },
      { text: "«Actividad» muestra quién hizo qué y cuándo.", to: "/actividad", link: "Ir a Actividad" },
    ],
  },
  {
    id: "saldo-inicial", title: "Corregir un saldo inicial importado", roles: ["owner", "accountant"], screens: ["/pacientes/"],
    summary: "El saldo inicial no se edita: se anula con motivo y, si hace falta, se importa de nuevo.",
    steps: [
      { text: "Abre la ficha del paciente, pestaña «Cuenta y pagos».", to: "/pacientes", link: "Ir a Pacientes" },
      { text: "En «Saldo inicial (sistema anterior)» pulsa «Anular», escribe el motivo y confirma." },
      { text: "Para cargar el monto correcto, vuelve a importarlo en «Importar datos» › «Saldos iniciales» con otro «ID externo».", to: "/importar?tipo=balances", link: "Ir a Saldos iniciales" },
    ],
  },
];

/** Normaliza para buscar sin tildes ni mayúsculas. */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function searchGuides(q: string): Guide[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return GUIDES.filter((g) => {
    const text = norm([g.title, g.summary, g.tip ?? "", ...g.steps.map((s) => s.text)].join(" "));
    return words.every((w) => text.includes(w));
  });
}

/** Guías de la pantalla actual: primero las del rol de la persona. */
export function guidesForPath(path: string, role: HelpRole): Guide[] {
  const matches = GUIDES.filter((g) => g.screens.some((s) => (s === "/" ? path === "/" : s.endsWith("/") ? path.startsWith(s) : path === s || path.startsWith(`${s}/`))));
  const mine = matches.filter((g) => g.roles.includes(role));
  return mine.length ? mine : matches;
}
