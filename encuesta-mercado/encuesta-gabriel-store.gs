/**
 * ============================================================================
 *  GABRIEL STORE — Estudio de mercado para revendedores de streaming
 *  Google Apps Script (motor V8). Un solo archivo: pegalo completo en un
 *  proyecto nuevo de https://script.google.com y ejecutá la función instalar().
 *
 *  Qué hace instalar():
 *    1. Construye una COPIA DE PRUEBA del formulario y de la hoja, envía una
 *       respuesta de prueba, comprueba que llegue a la hoja y que el análisis
 *       la cuente, y después ENVÍA A LA PAPELERA esa copia. El formulario
 *       definitivo nunca recibe respuestas de prueba.
 *    2. Si la prueba pasó, crea el formulario definitivo y su Google Sheets.
 *    3. Prepara las pestañas Inicio, Análisis (panel con gráficos), Informe
 *       y Pilotos (privado).
 *    4. Instala disparadores para actualizar el análisis con cada respuesta
 *       nueva y una vez por día.
 *    5. Escribe en el Registro de ejecución los enlaces reales.
 *
 *  Funciones que podés ejecutar a mano desde el editor:
 *    instalar()                    → crea todo (solo la primera vez).
 *    probarEnEntornoAislado()      → repite la prueba aislada cuando quieras.
 *    actualizarAnalisis()          → recalcula Análisis, Informe y Pilotos.
 *    crearReporteParaCompartir()   → copia del panel SIN datos personales.
 *    exportarCsvAnonimo()          → CSV sin nombres ni teléfonos, para
 *                                    analizarlo con Claude (ver ANALISIS.md).
 *    mostrarEnlaces()              → vuelve a escribir los enlaces en el registro.
 *
 *  Este archivo también se carga en Node (encuesta-mercado/analizar.mjs y las
 *  pruebas automáticas): las secciones 1 y 2 no usan servicios de Google.
 * ============================================================================
 */

// ============================================================================
// 1. CONFIGURACIÓN Y PREGUNTAS (fuente única de verdad)
// ============================================================================

var CONFIG = {
  TITULO: 'Estudio de mercado para revendedores de streaming',
  DESCRIPCION:
    'Queremos conocer qué herramientas utilizás para administrar tu negocio, qué dificultades ' +
    'enfrentás y qué soluciones podrían ayudarte. Duración aproximada: 5 a 7 minutos. ' +
    'Investigación realizada por Gabriel Store.',
  CONFIRMACION:
    '¡Gracias por tu tiempo! Tus respuestas nos ayudan a construir una herramienta pensada ' +
    'para revendedores. Si autorizaste el contacto, te escribiremos por WhatsApp solo para ' +
    'coordinar una demostración o entrevista.',
  // true = versión corta: 18 preguntas en vez de 22 (quita ventas, gusta, tiempo y modalidad). Ver README.md.
  VERSION_CORTA: false,
  // Toda respuesta cuyo nombre empiece con esto se excluye del análisis.
  MARCA_PRUEBA: '[PRUEBA]',
  ZONA_HORARIA: 'America/La_Paz',
  COLOR_PRINCIPAL: '#19223B', // azul marino
  COLOR_ACENTO: '#FFCC33', // amarillo dorado
  COLOR_FONDO: '#FFFFFF',
  COLOR_SUAVE: '#EEF0F5',
  HOJA_RESPUESTAS: 'Respuestas',
  HOJA_INICIO: 'Inicio',
  HOJA_ANALISIS: 'Análisis',
  HOJA_INFORME: 'Informe',
  HOJA_PILOTOS: 'Pilotos (privado)',
  // Umbrales de la recomendación de precios (fracción de encuestados que acepta ese precio).
  UMBRAL_ACEPTACION_BASICO: 0.5,
  UMBRAL_ACEPTACION_AUTOMATIZADO: 0.3,
  // Cantidad mínima de respuestas en un segmento para sacar conclusiones de ese segmento.
  MINIMO_POR_SEGMENTO: 5
};

var SECCIONES = [
  {
    id: 1,
    titulo: 'Identificación',
    descripcion:
      'Usamos estos datos solo para este estudio y, si lo autorizás, para invitarte a una ' +
      'demostración o entrevista. No los compartimos con terceros ni los publicamos en reportes. ' +
      'Nunca te vamos a pedir contraseñas, correos de acceso a cuentas ni datos de tus clientes: ' +
      'por favor no los escribas en ninguna respuesta.'
  },
  { id: 2, titulo: 'Perfil del revendedor', descripcion: 'Contanos cómo es tu negocio hoy.' },
  {
    id: 3,
    titulo: 'Herramientas que usás hoy',
    descripcion: 'Queremos entender cómo administrás el negocio actualmente.'
  },
  {
    id: 4,
    titulo: 'Necesidades',
    descripcion: 'Qué te complica el día a día y qué te ayudaría más.'
  },
  {
    id: 5,
    titulo: 'Precios',
    descripcion:
      'Montos mensuales en bolivianos (Bs). Si vendés fuera de Bolivia, elegí el equivalente ' +
      'aproximado en tu moneda. No hay respuestas correctas: elegí lo que realmente pagarías.'
  }
];

/**
 * tipo: texto | parrafo | opcion (una sola) | casillas (varias)
 * corta: false → no aparece en la versión corta.
 * El título es también el encabezado de la columna en la hoja: si lo cambiás
 * en el formulario, cambialo también acá.
 */
var PREGUNTAS = [
  // ---- Sección 1
  {
    id: 'nombre', seccion: 1, tipo: 'texto', obligatoria: true, maxLargo: 80,
    titulo: 'Nombre, apodo o nombre comercial',
    ayuda: 'Como querés que te llamemos. Puede ser el nombre de tu tienda.'
  },
  {
    id: 'whatsapp', seccion: 1, tipo: 'texto', obligatoria: false, validacion: 'whatsapp',
    titulo: 'Número de WhatsApp con código de país',
    ayuda: 'Opcional. Ejemplo: +591 71234567. Solo te escribiremos si lo autorizás más abajo.'
  },
  {
    id: 'pais', seccion: 1, tipo: 'opcion', obligatoria: true, otro: true,
    titulo: 'País donde comercializás',
    opciones: ['Bolivia', 'Perú', 'Argentina', 'Chile', 'Paraguay', 'Ecuador', 'Colombia', 'México']
  },
  {
    id: 'ciudad', seccion: 1, tipo: 'texto', obligatoria: true, maxLargo: 60,
    titulo: 'Ciudad donde comercializás',
    ayuda: 'Si vendés en varias, escribí la principal.'
  },
  {
    id: 'contacto', seccion: 1, tipo: 'opcion', obligatoria: true,
    titulo: '¿Nos autorizás a contactarte por WhatsApp para una demostración o entrevista?',
    ayuda: 'Es voluntario. Si respondés "No", no te vamos a escribir.',
    opciones: ['Sí', 'No']
  },
  // ---- Sección 2
  {
    id: 'tipo', seccion: 2, tipo: 'opcion', obligatoria: true,
    titulo: '¿Qué tipo de vendedor sos?',
    opciones: [
      'Revendedor independiente',
      'Revendedor con tienda propia',
      'Proveedor mayorista',
      'Distribuidor con otros revendedores'
    ]
  },
  {
    id: 'clientes', seccion: 2, tipo: 'opcion', obligatoria: true,
    titulo: '¿Cuántos clientes activos administrás?',
    opciones: ['1–20', '21–50', '51–100', '101–300', 'Más de 300']
  },
  {
    id: 'servicios', seccion: 2, tipo: 'casillas', obligatoria: true, otro: true,
    titulo: '¿Qué servicios comercializás?',
    ayuda: 'Podés elegir varios.',
    opciones: [
      'Netflix', 'Disney+', 'Prime Video', 'HBO Max', 'Spotify / YouTube',
      'Herramientas de inteligencia artificial'
    ]
  },
  {
    id: 'ventas', seccion: 2, tipo: 'opcion', obligatoria: true, corta: false,
    titulo: '¿Cuántas ventas o renovaciones gestionás por mes?',
    opciones: ['1–20', '21–50', '51–100', '101–300', '301–1.000', 'Más de 1.000']
  },
  // ---- Sección 3
  {
    id: 'gestion', seccion: 3, tipo: 'opcion', obligatoria: true,
    titulo: '¿Cómo administrás actualmente tu negocio?',
    ayuda: 'Elegí la opción principal.',
    opciones: ['Cuaderno', 'Excel', 'WhatsApp', 'Plataforma especializada', 'Combinación de herramientas']
  },
  {
    id: 'sistema', seccion: 3, tipo: 'texto', obligatoria: true, maxLargo: 150,
    titulo: '¿Qué sistema o aplicación usás actualmente?',
    ayuda: 'Escribí el nombre o el enlace. Si no usás ninguno, escribí "Ninguno".'
  },
  {
    id: 'gasto', seccion: 3, tipo: 'opcion', obligatoria: true,
    titulo: '¿Cuánto pagás por mes por ese sistema?',
    opciones: [
      'Bs 0 (no pago nada)', 'Bs 1–30', 'Bs 31–60', 'Bs 61–100', 'Bs 101–200',
      'Más de Bs 200', 'No sé / prefiero no decir'
    ]
  },
  {
    id: 'gusta', seccion: 3, tipo: 'parrafo', obligatoria: false, corta: false,
    titulo: '¿Qué es lo que más te gusta de tu sistema actual?',
    ayuda: 'Opcional. No incluyas contraseñas ni datos de tus clientes.'
  },
  {
    id: 'molesta', seccion: 3, tipo: 'parrafo', obligatoria: false,
    titulo: '¿Qué es lo que más te molesta de tu sistema actual?',
    ayuda: 'Opcional. No incluyas contraseñas ni datos de tus clientes.'
  },
  {
    id: 'tiempo', seccion: 3, tipo: 'opcion', obligatoria: true, corta: false,
    titulo: '¿Cuánto tiempo dedicás por día a gestionar cuentas, pagos, mensajes y renovaciones?',
    opciones: ['Menos de 30 minutos', '30 minutos a 1 hora', '1 a 2 horas', '2 a 4 horas', 'Más de 4 horas']
  },
  // ---- Sección 4
  {
    id: 'problemas', seccion: 4, tipo: 'casillas', obligatoria: true, otro: true, maxElegir: 3,
    titulo: '¿Cuáles son tus tres mayores problemas actuales?',
    ayuda: 'Elegí hasta 3.',
    opciones: [
      'Control de inventario',
      'Pérdida de clientes por vencimientos',
      'Administración de perfiles',
      'Consulta y entrega de códigos',
      'Verificación de pagos',
      'Atención de WhatsApp',
      'Control de ganancias',
      'Administración de revendedores',
      'Falta de una tienda online'
    ]
  },
  {
    id: 'funciones', seccion: 4, tipo: 'casillas', obligatoria: true, otro: true, maxElegir: 3,
    titulo: '¿Qué funciones valorarías más en una nueva plataforma?',
    ayuda: 'Elegí como máximo 3.',
    opciones: [
      'Inventario de cuentas',
      'Alertas automáticas de renovaciones',
      'Tienda con nombre, logo y colores propios',
      'Bot inteligente de WhatsApp',
      'Consulta de códigos para cuentas autorizadas',
      'Registro y verificación de pagos',
      'Entrega automática de productos',
      'Gestión de revendedores',
      'Reportes financieros',
      'Dominio personalizado'
    ]
  },
  {
    id: 'indispensable', seccion: 4, tipo: 'parrafo', obligatoria: false,
    titulo: '¿Qué función sería indispensable para que cambiaras de sistema?',
    ayuda: 'Opcional, pero es la pregunta que más nos ayuda.'
  },
  // ---- Sección 5
  {
    id: 'precio_basico', seccion: 5, tipo: 'opcion', obligatoria: true,
    titulo: '¿Cuánto pagarías por mes por un sistema básico con clientes, inventario, renovaciones y tienda online?',
    opciones: ['No pagaría', 'Bs 1–30', 'Bs 31–60', 'Bs 61–100', 'Bs 101–150', 'Más de Bs 150']
  },
  {
    id: 'precio_avanzado', seccion: 5, tipo: 'opcion', obligatoria: true,
    titulo: '¿Cuánto pagarías por mes por un sistema avanzado que además automatice la atención de WhatsApp, los pagos y las tareas operativas?',
    opciones: [
      'No pagaría más que por el básico', 'Bs 61–100', 'Bs 101–150', 'Bs 151–250',
      'Bs 251–400', 'Más de Bs 400'
    ]
  },
  {
    id: 'modalidad', seccion: 5, tipo: 'opcion', obligatoria: true, corta: false,
    titulo: '¿Cómo preferís pagar?',
    opciones: ['Suscripción mensual', 'Suscripción anual con descuento', 'Pago único', 'Todavía no sé']
  },
  {
    id: 'prueba', seccion: 5, tipo: 'opcion', obligatoria: true,
    titulo: '¿Te interesaría participar en una prueba gratuita de 7 días y evaluar la contratación después?',
    opciones: ['Sí', 'Tal vez', 'No']
  }
];

/** Rangos en Bs, alineados con las opciones (null = sin dato / no aplica; max null = sin tope). */
var RANGOS = {
  gasto: [[0, 0], [1, 30], [31, 60], [61, 100], [101, 200], [201, null], null],
  precio_basico: [[0, 0], [1, 30], [31, 60], [61, 100], [101, 150], [151, null]],
  precio_avanzado: [[0, 0], [61, 100], [101, 150], [151, 250], [251, 400], [401, null]]
};

/** Qué problema (pregunta 14) resuelve cada función (pregunta 15). */
var RELACION_FUNCION_PROBLEMA = {
  'Inventario de cuentas': ['Control de inventario', 'Administración de perfiles'],
  'Alertas automáticas de renovaciones': ['Pérdida de clientes por vencimientos'],
  'Tienda con nombre, logo y colores propios': ['Falta de una tienda online'],
  'Bot inteligente de WhatsApp': ['Atención de WhatsApp'],
  'Consulta de códigos para cuentas autorizadas': ['Consulta y entrega de códigos'],
  'Registro y verificación de pagos': ['Verificación de pagos'],
  'Entrega automática de productos': ['Consulta y entrega de códigos'],
  'Gestión de revendedores': ['Administración de revendedores'],
  'Reportes financieros': ['Control de ganancias'],
  'Dominio personalizado': ['Falta de una tienda online']
};

/** Temas para clasificar respuestas abiertas (búsqueda de palabras, sin acentos). */
var TEMAS_TEXTO = [
  { tema: 'Precio / costo', claves: ['caro', 'precio', 'costoso', 'cobran', 'barato', 'cuesta'] },
  { tema: 'Facilidad de uso', claves: ['complicad', 'dificil', 'confus', 'enredad', 'facil', 'sencill', 'intuitiv'] },
  { tema: 'Velocidad y estabilidad', claves: ['lento', 'se cae', 'falla', 'error', 'bug', 'caida', 'se traba', 'demora'] },
  { tema: 'Soporte y atención', claves: ['soporte', 'no responden', 'atencion al cliente', 'ayuda'] },
  { tema: 'WhatsApp y mensajes', claves: ['whatsapp', 'wsp', 'wpp', 'mensaje', 'bot', 'chat'] },
  { tema: 'Renovaciones y vencimientos', claves: ['vence', 'vencimiento', 'renov', 'recordatorio', 'aviso', 'alerta'] },
  { tema: 'Pagos y comprobantes', claves: ['pago', 'comprobante', 'qr', 'transferencia', 'deposito', 'yape', 'tigo'] },
  { tema: 'Códigos de acceso', claves: ['codigo', 'verificacion', 'hogar'] },
  { tema: 'Uso en celular', claves: ['celular', 'movil', 'telefono', 'app'] },
  { tema: 'Tienda y marca propia', claves: ['tienda', 'catalogo', 'logo', 'marca', 'pagina', 'web', 'dominio'] },
  { tema: 'Revendedores', claves: ['revendedor', 'distribuidor', 'subdistribuidor', 'mayorista'] },
  { tema: 'Inventario y perfiles', claves: ['inventario', 'stock', 'perfil', 'pantalla', 'cuentas'] },
  { tema: 'Ganancias y reportes', claves: ['reporte', 'ganancia', 'utilidad', 'contabilidad', 'caja', 'finanza'] },
  { tema: 'Automatización', claves: ['automat', 'automatico', 'solo', 'manual'] }
];

/** Palabras que significan "no uso ningún sistema". */
var SIN_SISTEMA = ['ninguno', 'ninguna', 'no', 'nada', 'no uso', 'no tengo', 'n/a', 'na', '-', 'ningun'];

/** Columnas de seguimiento manual en la pestaña Pilotos (las llena Gabriel). */
var COLUMNAS_PILOTO = ['Contactado', 'Demo realizada', 'Prueba iniciada', 'Pagó o dejó anticipo', 'Notas'];

function preguntasActivas() {
  return PREGUNTAS.filter(function (p) {
    return !(CONFIG.VERSION_CORTA && p.corta === false);
  });
}

function preguntaPorId(id) {
  for (var i = 0; i < PREGUNTAS.length; i++) if (PREGUNTAS[i].id === id) return PREGUNTAS[i];
  return null;
}

// ============================================================================
// 2. ANÁLISIS (lógica pura: sin servicios de Google; se prueba en Node)
// ============================================================================

function sinAcentos_(t) {
  return String(t == null ? '' : t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function texto_(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Separa la celda de una pregunta de casillas ("A, B, Otro texto") usando la
 * lista de opciones conocidas, porque algunas opciones contienen comas.
 */
function separarCasillas(valor, opciones) {
  var resto = ', ' + texto_(valor) + ', ';
  var elegidas = {};
  var ordenadas = opciones.slice().sort(function (a, b) { return b.length - a.length; });
  ordenadas.forEach(function (op) {
    var token = ', ' + op + ', ';
    if (resto.indexOf(token) >= 0) {
      elegidas[op] = true;
      resto = resto.replace(token, ', ');
    }
  });
  var otro = resto.replace(/^[,\s]+|[,\s]+$/g, '');
  return {
    elegidas: opciones.filter(function (op) { return elegidas[op]; }),
    otro: otro
  };
}

/** Índice de la opción elegida, o -1 si es "Otro"/vacío. */
function indiceOpcion_(pregunta, valor) {
  var v = texto_(valor);
  if (!v || !pregunta || !pregunta.opciones) return -1;
  return pregunta.opciones.indexOf(v);
}

/**
 * Convierte encabezados + filas (de la hoja o de un CSV) en registros.
 * opciones.incluirPruebas: true para contar también las respuestas [PRUEBA].
 * opciones.pilotos: mapa clave → {contactado, demo, prueba, pago} (de la pestaña Pilotos).
 */
function normalizarRespuestas(encabezados, filas, opciones) {
  opciones = opciones || {};
  var pilotos = opciones.pilotos || {};
  var cab = encabezados.map(function (h) { return texto_(h); });
  var columna = {};
  PREGUNTAS.forEach(function (p) {
    var i = cab.indexOf(p.titulo);
    if (i >= 0) columna[p.id] = i;
  });
  // Columnas extra del CSV anónimo (exportarCsvAnonimo).
  var extra = {
    id: cab.indexOf('ID'),
    fecha: cab.indexOf('Fecha'),
    dejoWhatsapp: cab.indexOf('Dejó WhatsApp'),
    contactado: cab.indexOf('Contactado'),
    demo: cab.indexOf('Demo realizada'),
    prueba: cab.indexOf('Prueba iniciada'),
    pago: cab.indexOf('Pagó o dejó anticipo')
  };
  var faltantes = preguntasActivas()
    .filter(function (p) {
      if (p.id === 'nombre' && extra.id >= 0) return false;
      if (p.id === 'whatsapp' && extra.dejoWhatsapp >= 0) return false;
      if (p.id === 'ciudad' && extra.id >= 0) return false;
      return columna[p.id] === undefined;
    })
    .map(function (p) { return p.titulo; });

  var registros = [];
  var excluidasPrueba = 0;
  var ultima = null;
  filas.forEach(function (fila, idx) {
    var vacia = fila.every(function (c) { return texto_(c) === ''; });
    if (vacia) return;
    var valores = {};
    Object.keys(columna).forEach(function (id) { valores[id] = texto_(fila[columna[id]]); });
    if (extra.id >= 0) valores.nombre = texto_(fila[extra.id]);
    var nombre = valores.nombre || '';
    if (nombre.indexOf(CONFIG.MARCA_PRUEBA) === 0 && !opciones.incluirPruebas) {
      excluidasPrueba++;
      return;
    }
    var marca = extra.id >= 0 && extra.fecha >= 0 ? fila[extra.fecha] : fila[0];
    var clave = extra.id >= 0 ? texto_(fila[extra.id]) : claveRegistro(marca, nombre);
    var piloto = pilotos[clave] || {};
    var leer = function (i) { return i >= 0 ? texto_(fila[i]) : ''; };
    var casillas = {};
    PREGUNTAS.forEach(function (p) {
      if (p.tipo === 'casillas') casillas[p.id] = separarCasillas(valores[p.id] || '', p.opciones);
    });
    var reg = {
      fila: idx + 2,
      marca: marca,
      clave: clave,
      valores: valores,
      casillas: casillas,
      tieneWhatsapp: extra.dejoWhatsapp >= 0
        ? leer(extra.dejoWhatsapp) === 'Sí'
        : soloDigitos_(valores.whatsapp).length >= 7,
      piloto: {
        contactado: piloto.contactado || leer(extra.contactado),
        demo: piloto.demo || leer(extra.demo),
        prueba: piloto.prueba || leer(extra.prueba),
        pago: piloto.pago || leer(extra.pago)
      }
    };
    reg.intencion = nivelIntencion(reg);
    registros.push(reg);
    var fecha = esFecha_(marca) ? marca : null;
    if (fecha && (!ultima || fecha > ultima)) ultima = fecha;
  });
  return { registros: registros, excluidasPrueba: excluidasPrueba, faltantes: faltantes, ultima: ultima };
}

function esFecha_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function claveRegistro(marca, nombre) {
  var m = esFecha_(marca) ? marca.toISOString() : texto_(marca);
  return m + '|' + texto_(nombre);
}

function soloDigitos_(t) {
  return texto_(t).replace(/\D/g, '');
}

/** Límite inferior en Bs de la respuesta a una pregunta con rangos (null si no aplica). */
function minimoBs(reg, id) {
  var i = indiceOpcion_(preguntaPorId(id), reg.valores[id]);
  if (i < 0 || !RANGOS[id][i]) return null;
  return RANGOS[id][i][0];
}

/**
 * Niveles de intención:
 *  0 Sin intención de pago      — "No pagaría" en básico y avanzado.
 *  1 Declarada                  — dice que pagaría algo (solo palabras).
 *  2 Calificada                 — declarada + quiere la prueba (Sí) + autoriza contacto + dejó WhatsApp.
 *  3 Verificada: demo o prueba  — ASISTIÓ a una demo o INICIÓ la prueba (lo marca Gabriel en Pilotos).
 *  4 Verificada: pagó           — pagó o dejó anticipo (lo marca Gabriel en Pilotos).
 * Los niveles 3 y 4 solo existen si alguien los registró a mano después de un hecho real.
 */
var NIVELES = [
  'Sin intención de pago',
  'Declarada (solo dice que pagaría)',
  'Calificada (pidió prueba y dejó contacto)',
  'Verificada: hizo demo o prueba',
  'Verificada: pagó o dejó anticipo'
];

function esSi_(v) {
  return sinAcentos_(v) === 'si';
}

function nivelIntencion(reg) {
  var autorizo = esSi_(reg.valores.contacto);
  if (autorizo && esSi_(reg.piloto.pago)) return 4;
  if (autorizo && (esSi_(reg.piloto.demo) || esSi_(reg.piloto.prueba))) return 3;
  var b = minimoBs(reg, 'precio_basico');
  var a = minimoBs(reg, 'precio_avanzado');
  var declarada = (b != null && b > 0) || (a != null && a > 0);
  if (!declarada) return 0;
  if (esSi_(reg.valores.prueba) && autorizo && reg.tieneWhatsapp) return 2;
  return 1;
}

/** Cuenta respuestas de una pregunta de opción única. */
function contarOpcion(registros, id) {
  var p = preguntaPorId(id);
  var cuentas = p.opciones.map(function () { return 0; });
  var otros = {};
  var respondieron = 0;
  registros.forEach(function (r) {
    var v = r.valores[id];
    if (!v) return;
    respondieron++;
    var i = p.opciones.indexOf(v);
    if (i >= 0) cuentas[i]++;
    else otros[v] = (otros[v] || 0) + 1;
  });
  var filas = p.opciones.map(function (op, i) { return { etiqueta: op, n: cuentas[i], pct: 0 }; });
  var nOtros = Object.keys(otros).reduce(function (s, k) { return s + otros[k]; }, 0);
  if (p.otro || nOtros) filas.push({ etiqueta: 'Otro', n: nOtros, pct: 0 });
  filas.forEach(function (f) { f.pct = respondieron ? f.n / respondieron : 0; });
  return { filas: filas, respondieron: respondieron, otros: otros };
}

/** Cuenta una pregunta de casillas. % = sobre quienes respondieron la pregunta. */
function contarCasillas(registros, id, ordenar) {
  var p = preguntaPorId(id);
  var cuentas = {};
  p.opciones.forEach(function (op) { cuentas[op] = 0; });
  var otrosTextos = [];
  var respondieron = 0;
  registros.forEach(function (r) {
    var c = r.casillas[id];
    if (!c || (!c.elegidas.length && !c.otro)) return;
    respondieron++;
    c.elegidas.forEach(function (op) { cuentas[op]++; });
    if (c.otro) otrosTextos.push(c.otro);
  });
  var filas = p.opciones.map(function (op) { return { etiqueta: op, n: cuentas[op], pct: 0 }; });
  if (p.otro) filas.push({ etiqueta: 'Otro', n: otrosTextos.length, pct: 0 });
  filas.forEach(function (f) { f.pct = respondieron ? f.n / respondieron : 0; });
  if (ordenar) filas.sort(function (a, b) { return b.n - a.n; });
  return { filas: filas, respondieron: respondieron, otros: otrosTextos };
}

/** Agrupa los sistemas/competidores mencionados (normaliza mayúsculas, acentos y enlaces). */
function competidores(registros) {
  var grupos = {};
  var ninguno = 0;
  registros.forEach(function (r) {
    var crudo = texto_(r.valores.sistema);
    if (!crudo) return;
    var k = sinAcentos_(crudo)
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[\/?#].*$/, '')
      .replace(/\.(com|net|app|io|co|bo|pe|ar|mx|cl|org)(\.[a-z]{2})?$/, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!k || SIN_SISTEMA.indexOf(k) >= 0) { ninguno++; return; }
    if (!grupos[k]) grupos[k] = { etiqueta: crudo, n: 0, gastos: {} };
    grupos[k].n++;
    var g = r.valores.gasto || 'Sin dato';
    grupos[k].gastos[g] = (grupos[k].gastos[g] || 0) + 1;
  });
  var filas = Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    var gastoTipico = Object.keys(g.gastos).sort(function (a, b) { return g.gastos[b] - g.gastos[a]; })[0];
    return { etiqueta: g.etiqueta, n: g.n, gastoTipico: gastoTipico };
  });
  filas.sort(function (a, b) { return b.n - a.n || a.etiqueta.localeCompare(b.etiqueta); });
  return { filas: filas, ninguno: ninguno };
}

/** Tabla cruzada segmento (clientes activos) × opción de una pregunta de precio. */
function cruzarPorSegmento(registros, id) {
  var seg = preguntaPorId('clientes').opciones;
  var p = preguntaPorId(id);
  return seg.map(function (s) {
    var delSeg = registros.filter(function (r) { return r.valores.clientes === s; });
    var fila = { segmento: s, n: delSeg.length, cuentas: [] };
    fila.cuentas = p.opciones.map(function (op) {
      return delSeg.filter(function (r) { return r.valores[id] === op; }).length;
    });
    fila.mediana = medianaEtiqueta_(delSeg, id);
    return fila;
  });
}

/** Etiqueta de la respuesta mediana (por orden de opciones) en una pregunta de rangos. */
function medianaEtiqueta_(registros, id) {
  var p = preguntaPorId(id);
  var idx = registros
    .map(function (r) { return p.opciones.indexOf(r.valores[id]); })
    .filter(function (i) { return i >= 0 && RANGOS[id][i]; })
    .sort(function (a, b) { return a - b; });
  if (!idx.length) return '—';
  return p.opciones[idx[Math.floor((idx.length - 1) / 2)]];
}

/**
 * Aceptación por precio: para cada rango, qué fracción de la población
 * pagaría AL MENOS el límite inferior de ese rango (criterio conservador).
 */
function aceptacionPorPrecio(registros, id) {
  var p = preguntaPorId(id);
  var montos = registros
    .map(function (r) { return minimoBs(r, id); })
    .filter(function (m) { return m != null; });
  var total = montos.length;
  var filas = [];
  for (var i = 1; i < p.opciones.length; i++) {
    var rango = RANGOS[id][i];
    if (!rango) continue;
    var acepta = montos.filter(function (m) { return m >= rango[0]; }).length;
    filas.push({
      etiqueta: p.opciones[i],
      min: rango[0],
      max: rango[1],
      acepta: acepta,
      pct: total ? acepta / total : 0,
      indiceIngreso: total ? rango[0] * acepta / total : 0
    });
  }
  return { filas: filas, total: total };
}

/** Precio redondeado "terminado en 9" dentro del rango. */
function precioSugerido(min, max) {
  if (max == null) return Math.max(min, Math.round(min / 10) * 10 + 9);
  var p = Math.round((min + (max - min) * 0.25) / 10) * 10 - 1;
  return Math.max(min, Math.min(max, p));
}

/** Elige el rango que maximiza precio × aceptación con aceptación ≥ umbral. */
function elegirPrecio_(acept, umbral) {
  var candidatos = acept.filas.filter(function (f) { return f.pct >= umbral; });
  if (!candidatos.length) return null;
  candidatos.sort(function (a, b) { return b.indiceIngreso - a.indiceIngreso || b.min - a.min; });
  var f = candidatos[0];
  return { etiqueta: f.etiqueta, pct: f.pct, precio: precioSugerido(f.min, f.max), acepta: f.acepta };
}

function confianza(n) {
  if (n === 0) return 'Sin datos todavía';
  if (n < 15) return 'Muy baja: solo sirve para explorar ideas';
  if (n < 30) return 'Baja: tendencias preliminares';
  if (n < 100) return 'Media: orientativa';
  return 'Aceptable para orientar decisiones (la muestra igual no es aleatoria)';
}

function margenError(n) {
  return n > 0 ? 1.96 * Math.sqrt(0.25 / n) : null;
}

/** Quita teléfonos, correos y enlaces de un texto libre antes de citarlo. */
function limpiarCita(t, max) {
  var s = texto_(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
    .replace(/https?:\/\/\S+/g, '[enlace]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[número]')
    .replace(/\s+/g, ' ');
  max = max || 200;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Evita que un texto escrito por un encuestado se interprete como fórmula
 * (por ejemplo "=IMPORTXML(...)") al copiarlo a otra pestaña.
 */
function celdaSegura(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function clasificarTemas(textos) {
  var cuentas = {};
  TEMAS_TEXTO.forEach(function (t) { cuentas[t.tema] = 0; });
  textos.forEach(function (tx) {
    var s = ' ' + sinAcentos_(tx) + ' ';
    TEMAS_TEXTO.forEach(function (t) {
      if (t.claves.some(function (k) { return s.indexOf(k) >= 0; })) cuentas[t.tema]++;
    });
  });
  return TEMAS_TEXTO.map(function (t) { return { tema: t.tema, n: cuentas[t.tema] }; })
    .filter(function (x) { return x.n > 0; })
    .sort(function (a, b) { return b.n - a.n; });
}

/** Calcula todo el análisis a partir de los registros normalizados. */
function analizar(datos) {
  var regs = datos.registros;
  var n = regs.length;
  var porNivel = NIVELES.map(function () { return 0; });
  regs.forEach(function (r) { porNivel[r.intencion]++; });

  var problemas = contarCasillas(regs, 'problemas', true);
  var funciones = contarCasillas(regs, 'funciones', true);

  // Prioridad = 2 × % que elige la función + 1 × % que reporta el problema que resuelve.
  var pctProblema = {};
  problemas.filas.forEach(function (f) { pctProblema[f.etiqueta] = f.pct; });
  var prioridad = funciones.filas
    .filter(function (f) { return f.etiqueta !== 'Otro'; })
    .map(function (f) {
      var rel = RELACION_FUNCION_PROBLEMA[f.etiqueta] || [];
      var pp = rel.reduce(function (m, pr) { return Math.max(m, pctProblema[pr] || 0); }, 0);
      var calif = regs.filter(function (r) { return r.intencion >= 2; });
      var enCalif = calif.filter(function (r) {
        return r.casillas.funciones && r.casillas.funciones.elegidas.indexOf(f.etiqueta) >= 0;
      }).length;
      return {
        funcion: f.etiqueta,
        pctFuncion: f.pct,
        pctProblema: pp,
        pctEnCalificados: calif.length ? enCalif / calif.length : 0,
        puntaje: 2 * f.pct + pp,
        etapa: ''
      };
    })
    .sort(function (a, b) {
      return b.puntaje - a.puntaje || b.pctEnCalificados - a.pctEnCalificados || b.pctFuncion - a.pctFuncion;
    });
  // Prioridad: las 5 de mayor puntaje que tengan al menos un voto o un problema asociado.
  var enPrioridad = 0;
  prioridad.forEach(function (p) {
    p.etapa = p.puntaje > 0 && enPrioridad < 5 ? 'Prioridad' : '2.ª etapa';
    if (p.etapa === 'Prioridad') enPrioridad++;
  });

  var aceptBasico = aceptacionPorPrecio(regs, 'precio_basico');
  var pagadores = regs.filter(function (r) { var m = minimoBs(r, 'precio_basico'); return m != null && m > 0; });
  var aceptAuto = aceptacionPorPrecio(pagadores, 'precio_avanzado');
  var basico = elegirPrecio_(aceptBasico, CONFIG.UMBRAL_ACEPTACION_BASICO);
  var automatizado = elegirPrecio_(aceptAuto, CONFIG.UMBRAL_ACEPTACION_AUTOMATIZADO);
  var profesional = null;
  if (basico && automatizado && automatizado.precio > basico.precio) {
    var medio = Math.sqrt(basico.precio * automatizado.precio);
    profesional = { precio: Math.round(medio / 10) * 10 - 1 };
  }

  // Segmentos por cantidad de clientes activos.
  var segmentos = preguntaPorId('clientes').opciones.map(function (s) {
    var d = regs.filter(function (r) { return r.valores.clientes === s; });
    var calif = d.filter(function (r) { return r.intencion >= 2; });
    var sumaBasico = calif.reduce(function (t, r) { return t + (minimoBs(r, 'precio_basico') || 0); }, 0);
    return {
      segmento: s,
      n: d.length,
      declarada: d.filter(function (r) { return r.intencion >= 1; }).length,
      calificada: calif.length,
      verificada: d.filter(function (r) { return r.intencion >= 3; }).length,
      pagaron: d.filter(function (r) { return r.intencion === 4; }).length,
      medianaBasico: medianaEtiqueta_(d, 'precio_basico'),
      medianaAvanzado: medianaEtiqueta_(d, 'precio_avanzado'),
      // Ingreso mensual mínimo declarado por los calificados del segmento (Bs).
      potencialBs: sumaBasico
    };
  });
  var mejorSegmento = segmentos.slice().sort(function (a, b) {
    return b.verificada - a.verificada || b.potencialBs - a.potencialBs || b.calificada - a.calificada || b.n - a.n;
  })[0];
  if (mejorSegmento && mejorSegmento.n === 0) mejorSegmento = null;

  var textosMolesta = regs.map(function (r) { return r.valores.molesta; }).filter(Boolean);
  var textosGusta = regs.map(function (r) { return r.valores.gusta; }).filter(Boolean);
  var textosIndisp = regs.map(function (r) { return r.valores.indispensable; }).filter(Boolean);

  // Candidatos a piloto: autorizaron contacto, dicen que pagarían y quieren (o tal vez quieren) probar,
  // o ya tienen un hecho verificado registrado.
  var pilotos = regs
    .filter(function (r) {
      if (!esSi_(r.valores.contacto)) return false;
      if (r.intencion >= 3) return true;
      return r.intencion >= 1 && (esSi_(r.valores.prueba) || r.valores.prueba === 'Tal vez');
    })
    .sort(function (a, b) { return b.intencion - a.intencion; });

  return {
    n: n,
    excluidasPrueba: datos.excluidasPrueba,
    faltantes: datos.faltantes,
    ultima: datos.ultima,
    confianza: confianza(n),
    margen: margenError(n),
    porNivel: porNivel,
    tipo: contarOpcion(regs, 'tipo'),
    clientes: contarOpcion(regs, 'clientes'),
    servicios: contarCasillas(regs, 'servicios', true),
    ventas: contarOpcion(regs, 'ventas'),
    pais: contarOpcion(regs, 'pais'),
    gestion: contarOpcion(regs, 'gestion'),
    competidores: competidores(regs),
    gasto: contarOpcion(regs, 'gasto'),
    tiempo: contarOpcion(regs, 'tiempo'),
    problemas: problemas,
    funciones: funciones,
    prioridad: prioridad,
    pagoBasicoSeg: cruzarPorSegmento(regs, 'precio_basico'),
    pagoAvanzadoSeg: cruzarPorSegmento(regs, 'precio_avanzado'),
    aceptBasico: aceptBasico,
    aceptAuto: aceptAuto,
    precios: { basico: basico, profesional: profesional, automatizado: automatizado },
    modalidad: contarOpcion(regs, 'modalidad'),
    prueba: contarOpcion(regs, 'prueba'),
    segmentos: segmentos,
    mejorSegmento: mejorSegmento,
    temasMolesta: clasificarTemas(textosMolesta),
    temasGusta: clasificarTemas(textosGusta),
    temasIndispensable: clasificarTemas(textosIndisp),
    citasMolesta: textosMolesta.slice(0, 8).map(function (t) { return limpiarCita(t); }),
    citasIndispensable: textosIndisp.slice(0, 8).map(function (t) { return limpiarCita(t); }),
    otrasFunciones: funciones.otros.map(function (t) { return limpiarCita(t, 120); }),
    pilotos: pilotos.map(function (r, i) {
      return {
        nombre: r.valores.nombre || 'R' + ('00' + (i + 1)).slice(-3),
        segmento: r.valores.clientes || '—',
        tipo: r.valores.tipo || '—',
        nivel: NIVELES[r.intencion],
        nivelNum: r.intencion,
        prueba: r.valores.prueba || '—',
        pagaria: r.valores.precio_basico || '—'
      };
    })
  };
}

function pct_(x) {
  return Math.round((x || 0) * 100) + '%';
}

/**
 * Informe para Gabriel Store en Markdown (también se escribe en la pestaña Informe).
 * opts.anonimo: true → no muestra nombres de pilotos (para compartir).
 */
function informeMarkdown(res, opts) {
  opts = opts || {};
  var L = [];
  var n = res.n;
  L.push('# Informe automático — Estudio de mercado Gabriel Store');
  L.push('');
  L.push('**Encuestados válidos:** ' + n + (res.excluidasPrueba ? ' (se excluyeron ' + res.excluidasPrueba + ' respuestas de prueba)' : ''));
  L.push('**Confianza de las conclusiones:** ' + res.confianza +
    (res.margen ? ' · margen de error de un porcentaje: ±' + pct_(res.margen) + ' como mínimo' : ''));
  L.push('');
  L.push('> Muestra por conveniencia (personas a las que les llegó el enlace por WhatsApp), no aleatoria. ' +
    'Los resultados describen a quienes respondieron, no a todo el mercado. El margen de error real es mayor que el indicado.');
  if (res.faltantes && res.faltantes.length) {
    L.push('');
    L.push('> ⚠️ No se encontraron estas columnas en la hoja (¿se cambió el título de la pregunta?): ' + res.faltantes.join(' · '));
  }
  if (n === 0) {
    L.push('');
    L.push('Todavía no hay respuestas reales. Este informe se completa solo cuando lleguen.');
    return L.join('\n');
  }
  var poca = n < 30;
  L.push('');
  L.push('## Intención de compra: lo que dicen vs. lo que hacen');
  L.push('');
  L.push('| Nivel | Personas | % |');
  L.push('|---|---:|---:|');
  NIVELES.forEach(function (nv, i) { L.push('| ' + nv + ' | ' + res.porNivel[i] + ' | ' + pct_(res.porNivel[i] / n) + ' |'); });
  L.push('');
  L.push('"Declarada" y "Calificada" son palabras, no compras. Solo "Verificada" refleja hechos ' +
    '(demo, prueba o pago) y la registrás vos en la pestaña Pilotos.');

  L.push('');
  L.push('## 1. Las cinco funciones a priorizar');
  L.push('');
  L.push('Puntaje = 2 × % que la elige como función + % que sufre el problema que resuelve.');
  L.push('');
  var top = res.prioridad.filter(function (p) { return p.etapa === 'Prioridad'; });
  if (top.length < 5) L.push('Solo ' + top.length + ' funciones tienen votos o problemas asociados por ahora.\n');
  L.push('| # | Función | Eligen | Sufren el problema | Entre calificados | Puntaje |');
  L.push('|---:|---|---:|---:|---:|---:|');
  top.forEach(function (p, i) {
    L.push('| ' + (i + 1) + ' | ' + p.funcion + ' | ' + pct_(p.pctFuncion) + ' | ' + pct_(p.pctProblema) +
      ' | ' + pct_(p.pctEnCalificados) + ' | ' + p.puntaje.toFixed(2) + ' |');
  });
  if (res.otrasFunciones.length) L.push('\nOtras funciones sugeridas: ' + res.otrasFunciones.join(' · '));

  L.push('');
  L.push('## 2. Para una segunda etapa');
  L.push('');
  res.prioridad.filter(function (p) { return p.etapa !== 'Prioridad'; }).forEach(function (p) {
    L.push('- ' + p.funcion + ' (la eligen ' + pct_(p.pctFuncion) + ')');
  });

  L.push('');
  L.push('## 3. Precios sugeridos');
  L.push('');
  var pr = res.precios;
  L.push('| Plan | Precio sugerido | Base |');
  L.push('|---|---:|---|');
  L.push('| Básico | ' + (pr.basico ? 'Bs ' + pr.basico.precio + '/mes' : 'sin datos suficientes') + ' | ' +
    (pr.basico ? pct_(pr.basico.pct) + ' de los encuestados pagaría al menos el mínimo de "' + pr.basico.etiqueta + '"' : 'ningún rango alcanza ' + pct_(CONFIG.UMBRAL_ACEPTACION_BASICO) + ' de aceptación') + ' |');
  L.push('| Profesional | ' + (pr.profesional ? 'Bs ' + pr.profesional.precio + '/mes' : '—') +
    ' | Estimado entre Básico y Automatizado. No se midió directamente: validalo con los pilotos. |');
  L.push('| Automatizado | ' + (pr.automatizado ? 'Bs ' + pr.automatizado.precio + '/mes' : 'sin datos suficientes') + ' | ' +
    (pr.automatizado ? pct_(pr.automatizado.pct) + ' de quienes pagarían el básico pagaría al menos el mínimo de "' + pr.automatizado.etiqueta + '"' : 'ningún rango alcanza ' + pct_(CONFIG.UMBRAL_ACEPTACION_AUTOMATIZADO) + ' de aceptación') + ' |');
  L.push('');
  L.push('Aceptación del plan básico por precio (pagaría al menos el mínimo del rango):');
  L.push('');
  res.aceptBasico.filas.forEach(function (f) { L.push('- ' + f.etiqueta + ': ' + pct_(f.pct) + ' (' + f.acepta + '/' + res.aceptBasico.total + ')'); });
  L.push('');
  L.push('Gasto actual en sistemas: ' + res.gasto.filas.filter(function (f) { return f.n; })
    .map(function (f) { return f.etiqueta + ' ' + f.n; }).join(' · '));
  L.push('');
  L.push('Lo que la gente dice que pagaría suele ser más alto que lo que termina pagando. ' +
    'Confirmá el precio con pagos reales de pilotos antes de publicarlo.');

  L.push('');
  L.push('## 4. Mejor cliente por tamaño');
  L.push('');
  L.push('| Clientes activos | Encuestados | Calificados | Verificados | Mediana básico | Mediana avanzado | Potencial mínimo (Bs/mes) |');
  L.push('|---|---:|---:|---:|---|---|---:|');
  res.segmentos.forEach(function (s) {
    L.push('| ' + s.segmento + ' | ' + s.n + ' | ' + s.calificada + ' | ' + s.verificada + ' | ' + s.medianaBasico +
      ' | ' + s.medianaAvanzado + ' | ' + s.potencialBs + ' |');
  });
  L.push('');
  if (res.mejorSegmento) {
    L.push('Segmento con más potencial: **' + res.mejorSegmento.segmento + ' clientes activos**' +
      (res.mejorSegmento.n < CONFIG.MINIMO_POR_SEGMENTO ? ' — ⚠️ con menos de ' + CONFIG.MINIMO_POR_SEGMENTO + ' respuestas, no es concluyente.' : '.'));
  }

  L.push('');
  L.push('## 5. Ventajas competitivas posibles');
  L.push('');
  L.push('Sistemas mencionados: ' + (res.competidores.filas.length
    ? res.competidores.filas.slice(0, 10).map(function (c) { return c.etiqueta + ' (' + c.n + ')'; }).join(' · ')
    : 'ninguno') + ' · Sin sistema: ' + res.competidores.ninguno);
  L.push('');
  L.push('Temas de lo que más molesta: ' + (res.temasMolesta.map(function (t) { return t.tema + ' (' + t.n + ')'; }).join(' · ') || 'sin respuestas'));
  L.push('');
  L.push('Temas de lo indispensable para cambiar: ' + (res.temasIndispensable.map(function (t) { return t.tema + ' (' + t.n + ')'; }).join(' · ') || 'sin respuestas'));
  if (res.citasMolesta.length) {
    L.push('');
    L.push('Citas (sin datos personales) — qué molesta:');
    res.citasMolesta.forEach(function (c) { L.push('- "' + c + '"'); });
  }
  if (res.citasIndispensable.length) {
    L.push('');
    L.push('Citas — qué sería indispensable:');
    res.citasIndispensable.forEach(function (c) { L.push('- "' + c + '"'); });
  }
  L.push('');
  L.push('La clasificación por temas es automática (por palabras clave). Leé las respuestas completas antes de decidir.');

  L.push('');
  L.push('## 6. Candidatos a clientes piloto');
  L.push('');
  if (!res.pilotos.length) {
    L.push('Nadie autorizó contacto con intención de pago todavía.');
  } else {
    L.push('| ' + (opts.anonimo ? 'Ref.' : 'Nombre') + ' | Clientes | Tipo | Prueba 7 días | Pagaría (básico) | Nivel |');
    L.push('|---|---|---|---|---|---|');
    res.pilotos.forEach(function (p, i) {
      var nombre = opts.anonimo ? 'P' + ('0' + (i + 1)).slice(-2) : p.nombre.replace(/\|/g, '/');
      L.push('| ' + nombre + ' | ' + p.segmento + ' | ' + p.tipo + ' | ' + p.prueba + ' | ' + p.pagaria + ' | ' + p.nivel + ' |');
    });
    L.push('');
    L.push('Los teléfonos están solo en la pestaña privada "' + CONFIG.HOJA_PILOTOS + '".');
  }

  L.push('');
  L.push('## 7. Recomendación de lanzamiento');
  L.push('');
  var calif = res.porNivel[2] + res.porNivel[3] + res.porNivel[4];
  var verif = res.porNivel[3] + res.porNivel[4];
  if (poca) {
    L.push('- **Todavía no fijes precios públicos.** Con ' + n + ' respuestas la muestra es chica. Meta: al menos 30 respuestas y 5 pilotos verificados.');
  }
  if (res.mejorSegmento) L.push('- Enfocá la primera venta en revendedores con **' + res.mejorSegmento.segmento + ' clientes activos**.');
  L.push('- Contactá primero ' + (calif === 1 ? 'a la persona calificada' : 'a las ' + calif + ' personas calificadas') +
    ' (pidieron la prueba y dejaron contacto) y ofreceles la prueba de 7 días con las funciones prioritarias.');
  if (pr.basico) L.push('- Ofrecé un "precio fundador" cercano a Bs ' + pr.basico.precio + '/mes a los primeros pilotos, por tiempo limitado, a cambio de opiniones.');
  var mod = res.modalidad.filas.slice().sort(function (a, b) { return b.n - a.n; })[0];
  if (mod && mod.n) L.push('- Modalidad de pago más elegida: **' + mod.etiqueta + '** (' + pct_(mod.pct) + ').');
  L.push('- Medí la conversión real, de prueba iniciada a pago. Hoy: ' + verif + ' con demo/prueba verificada y ' + res.porNivel[4] + ' con pago.');
  L.push('- Canal: los mismos grupos y contactos de WhatsApp donde circuló la encuesta, más recomendación entre revendedores.');
  L.push('');
  L.push('Estas recomendaciones son reglas automáticas sobre los datos. Para un análisis completo, seguí ANALISIS.md.');
  return L.join('\n');
}

// ============================================================================
// 3. GOOGLE: FORMULARIO, HOJA, PRUEBA AISLADA, ANÁLISIS Y DISPARADORES
// ============================================================================

/** Paso único: prueba aislada + creación del formulario y la hoja definitivos. */
function instalar() {
  var props = PropertiesService.getScriptProperties();
  var formId = props.getProperty('FORM_ID');
  if (formId && archivoExiste_(formId)) {
    Logger.log('Ya está instalado. No se creó nada nuevo. Para ver los enlaces ejecutá mostrarEnlaces().');
    mostrarEnlaces();
    return;
  }
  Logger.log('1/4 Prueba aislada (no toca el formulario definitivo)...');
  probarEnEntornoAislado();

  Logger.log('2/4 Creando el formulario y la hoja definitivos...');
  var creado = crearFormularioYHoja_(CONFIG.TITULO, false);
  props.setProperty('FORM_ID', creado.form.getId());
  props.setProperty('SHEET_ID', creado.ss.getId());

  Logger.log('3/4 Preparando pestañas y disparadores...');
  instalarDisparadores_(creado.ss);
  actualizarAnalisis();

  Logger.log('4/4 Verificando el formulario definitivo...');
  verificarEstructura_(creado.form);
  var hoja = buscarHojaRespuestas_(SpreadsheetApp.openById(creado.ss.getId()));
  if (!hoja) throw new Error('El formulario no quedó vinculado a la hoja de respuestas.');
  if (hoja.getLastRow() > 1) throw new Error('La hoja definitiva tiene respuestas inesperadas.');
  Logger.log('Listo. Formulario definitivo con 0 respuestas.');
  mostrarEnlaces();
}

/** Escribe en el registro los enlaces reales. */
function mostrarEnlaces() {
  var e = enlaces_();
  Logger.log('ENLACE PARA RESPONDER: ' + e.responder);
  Logger.log('ENLACE CORTO:          ' + e.corto);
  Logger.log('ENLACE PARA EDITAR:    ' + e.editar);
  Logger.log('GOOGLE SHEETS:         ' + e.hoja);
  Logger.log('COMPARTIR POR WHATSAPP: ' + e.whatsapp);
  return e;
}

function enlaces_() {
  var props = PropertiesService.getScriptProperties();
  var form = FormApp.openById(props.getProperty('FORM_ID'));
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var responder = form.getPublishedUrl();
  var corto = responder;
  try { corto = form.shortenFormUrl(responder); } catch (err) { /* se usa el largo */ }
  return {
    responder: responder,
    corto: corto,
    editar: form.getEditUrl(),
    hoja: ss.getUrl(),
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(mensajeWhatsapp_(corto))
  };
}

function mensajeWhatsapp_(url) {
  return '¡Hola! Estoy haciendo un estudio para revendedores de streaming (Netflix, Disney+, Prime, HBO Max y más). ' +
    'Quiero saber qué herramientas usás y qué te complica el día a día. Son 5 a 7 minutos y no te pido contraseñas ' +
    'ni datos de tus clientes. ¿Me ayudás respondiendo? ' + url + ' ¡Gracias! — Gabriel Store';
}

/**
 * Crea un formulario + hoja vinculada temporales, envía una respuesta de prueba,
 * verifica que llegue a la hoja y que el análisis la procese, y después envía
 * ambos archivos a la papelera. Lanza un error si algo falla.
 */
function probarEnEntornoAislado() {
  var creado = crearFormularioYHoja_(CONFIG.MARCA_PRUEBA + ' ' + CONFIG.TITULO, true);
  var errores = [];
  try {
    verificarEstructura_(creado.form);
    var esperado = enviarRespuestaDePrueba_(creado.form);

    // Esperar a que la respuesta llegue a la hoja (suele tardar unos segundos).
    var hoja = null;
    for (var i = 0; i < 30; i++) {
      SpreadsheetApp.flush();
      hoja = buscarHojaRespuestas_(SpreadsheetApp.openById(creado.ss.getId()));
      if (hoja && hoja.getLastRow() >= 2) break;
      Utilities.sleep(2000);
    }
    if (!hoja || hoja.getLastRow() < 2) throw new Error('La respuesta de prueba no llegó a la hoja en 60 segundos.');

    var valores = hoja.getDataRange().getValues();
    var cab = valores[0].map(String);
    preguntasActivas().forEach(function (p) {
      var col = cab.indexOf(p.titulo);
      if (col < 0) { errores.push('Falta la columna: ' + p.titulo); return; }
      var celda = texto_(valores[1][col]);
      var esp = esperado[p.id];
      if (p.id === 'whatsapp') { celda = soloDigitos_(celda); esp = soloDigitos_(esp); }
      if (esp !== undefined && celda !== esp) errores.push('Valor distinto en "' + p.titulo + '": "' + celda + '" ≠ "' + esp + '"');
    });

    // El análisis normal debe EXCLUIR la respuesta de prueba...
    var sinPruebas = analizar(normalizarRespuestas(valores[0], valores.slice(1), {}));
    if (sinPruebas.n !== 0 || sinPruebas.excluidasPrueba !== 1) errores.push('La respuesta de prueba no se excluyó del análisis.');
    // ...y con incluirPruebas debe contarla correctamente.
    var conPruebas = analizar(normalizarRespuestas(valores[0], valores.slice(1), { incluirPruebas: true }));
    if (conPruebas.n !== 1) errores.push('El análisis no contó la respuesta de prueba (n=' + conPruebas.n + ').');
    var tienda = conPruebas.funciones.filas.filter(function (f) { return f.etiqueta === 'Tienda con nombre, logo y colores propios'; })[0];
    if (!tienda || tienda.n !== 1) errores.push('No se separó bien una opción con comas en las casillas.');
    if (conPruebas.porNivel[2] !== 1) errores.push('La intención "Calificada" no se calculó como se esperaba.');

    // Las pestañas de análisis deben poder dibujarse en la hoja de prueba.
    prepararPestanas_(creado.ss, valores, { incluirPruebas: true });
    var informe = creado.ss.getSheetByName(CONFIG.HOJA_INFORME);
    if (!informe || informe.getLastRow() < 10) errores.push('La pestaña Informe no se generó.');
    var panel = creado.ss.getSheetByName(CONFIG.HOJA_ANALISIS);
    if (!panel || panel.getCharts().length < 5) errores.push('El panel no generó los gráficos.');
    var pil = creado.ss.getSheetByName(CONFIG.HOJA_PILOTOS);
    if (!pil || pil.getLastRow() !== 2) errores.push('La pestaña Pilotos no listó a la persona de prueba.');
  } finally {
    // Limpieza: la copia de prueba va a la papelera pase lo que pase.
    try { DriveApp.getFileById(creado.form.getId()).setTrashed(true); } catch (e1) { errores.push('No se pudo borrar el formulario de prueba: ' + e1); }
    try { DriveApp.getFileById(creado.ss.getId()).setTrashed(true); } catch (e2) { errores.push('No se pudo borrar la hoja de prueba: ' + e2); }
  }
  if (errores.length) throw new Error('PRUEBA FALLIDA:\n- ' + errores.join('\n- '));
  Logger.log('PRUEBA AISLADA: OK. Formulario, hoja, análisis, panel, informe y pilotos verificados. Copia de prueba enviada a la papelera.');
  return true;
}

function archivoExiste_(id) {
  try { return !DriveApp.getFileById(id).isTrashed(); } catch (e) { return false; }
}

/** Crea el formulario con todas las preguntas y una hoja vinculada. */
function crearFormularioYHoja_(titulo, esPrueba) {
  var form = FormApp.create(titulo);
  form.setTitle(titulo)
    .setDescription(CONFIG.DESCRIPCION)
    .setConfirmationMessage(CONFIG.CONFIRMACION)
    .setProgressBar(true)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false) // true obligaría a iniciar sesión en Google y bajaría las respuestas
    .setShowLinkToRespondAgain(false)
    .setPublishingSummary(false)
    .setShuffleQuestions(false)
    .setAcceptingResponses(true);
  construirPreguntas_(form);
  publicar_(form);

  var ss = SpreadsheetApp.create((esPrueba ? CONFIG.MARCA_PRUEBA + ' ' : '') + 'Gabriel Store — Respuestas del estudio de mercado');
  ss.setSpreadsheetTimeZone(CONFIG.ZONA_HORARIA);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  // Renombrar la pestaña vinculada y borrar la hoja vacía inicial.
  var ss2 = ss;
  var hoja = null;
  for (var i = 0; i < 10 && !hoja; i++) {
    SpreadsheetApp.flush();
    ss2 = SpreadsheetApp.openById(ss.getId());
    hoja = buscarHojaRespuestas_(ss2);
    if (!hoja) Utilities.sleep(1500);
  }
  if (hoja) {
    hoja.setName(CONFIG.HOJA_RESPUESTAS);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, hoja.getLastColumn()).setBackground(CONFIG.COLOR_PRINCIPAL)
      .setFontColor(CONFIG.COLOR_FONDO).setFontWeight('bold').setWrap(true);
  }
  ss2.getSheets().forEach(function (s) {
    if (s.getFormUrl() == null && ss2.getSheets().length > 1 && s.getLastRow() === 0) ss2.deleteSheet(s);
  });
  return { form: form, ss: ss2 };
}

/** Con los cambios de Google Forms de 2025-2026 un formulario puede crearse sin publicar. */
/** @param {GoogleAppsScript.Forms.Form} form */
function publicar_(form) {
  /** @type {any} */
  var f = form;
  if (typeof f.setPublished === 'function') {
    f.setPublished(true);
  }
}

/** @param {GoogleAppsScript.Forms.Form} form */
function construirPreguntas_(form) {
  var seccionActual = 0;
  preguntasActivas().forEach(function (p) {
    if (p.seccion !== seccionActual) {
      var s = SECCIONES[p.seccion - 1];
      if (p.seccion === 1) {
        form.addSectionHeaderItem().setTitle(s.titulo).setHelpText(s.descripcion);
      } else {
        form.addPageBreakItem().setTitle(s.titulo).setHelpText(s.descripcion);
      }
      seccionActual = p.seccion;
    }
    var item;
    if (p.tipo === 'texto') {
      item = form.addTextItem();
      var tv = null;
      if (p.validacion === 'whatsapp') {
        tv = FormApp.createTextValidation()
          .setHelpText('Escribí el número con + y código de país. Ejemplo: +591 71234567')
          .requireTextMatchesPattern('^\\+[1-9][0-9 -]{6,18}$')
          .build();
      } else if (p.maxLargo) {
        tv = FormApp.createTextValidation()
          .setHelpText('Máximo ' + p.maxLargo + ' caracteres.')
          .requireTextLengthLessThanOrEqualTo(p.maxLargo)
          .build();
      }
      if (tv) item.setValidation(tv);
    } else if (p.tipo === 'parrafo') {
      item = form.addParagraphTextItem();
      item.setValidation(FormApp.createParagraphTextValidation()
        .setHelpText('Máximo 600 caracteres.')
        .requireTextLengthLessThanOrEqualTo(600)
        .build());
    } else if (p.tipo === 'opcion') {
      item = form.addMultipleChoiceItem().setChoiceValues(p.opciones);
      if (p.otro) item.showOtherOption(true);
    } else if (p.tipo === 'casillas') {
      item = form.addCheckboxItem().setChoiceValues(p.opciones);
      if (p.otro) item.showOtherOption(true);
      if (p.maxElegir) {
        item.setValidation(FormApp.createCheckboxValidation()
          .setHelpText('Elegí como máximo ' + p.maxElegir + '.')
          .requireSelectAtMost(p.maxElegir)
          .build());
      }
    } else {
      throw new Error('Tipo de pregunta desconocido: ' + p.tipo);
    }
    item.setTitle(p.titulo).setRequired(!!p.obligatoria);
    if (p.ayuda) item.setHelpText(p.ayuda);
  });
}

/** Comprueba que el formulario tenga exactamente las preguntas y opciones configuradas. */
/** @param {GoogleAppsScript.Forms.Form} form */
function verificarEstructura_(form) {
  var errores = [];
  var items = form.getItems().filter(function (it) {
    var t = it.getType();
    return t !== FormApp.ItemType.PAGE_BREAK && t !== FormApp.ItemType.SECTION_HEADER;
  });
  var esperadas = preguntasActivas();
  if (items.length !== esperadas.length) errores.push('Se esperaban ' + esperadas.length + ' preguntas y hay ' + items.length + '.');
  esperadas.forEach(function (p, i) {
    var it = items[i];
    if (!it) return;
    if (it.getTitle() !== p.titulo) errores.push('Pregunta ' + (i + 1) + ': título distinto.');
    var opciones = null;
    var obligatoria = null;
    if (p.tipo === 'opcion') {
      var mc = it.asMultipleChoiceItem();
      opciones = mc.getChoices().map(function (c) { return c.getValue(); });
      obligatoria = mc.isRequired();
    } else if (p.tipo === 'casillas') {
      var cb = it.asCheckboxItem();
      opciones = cb.getChoices().map(function (c) { return c.getValue(); });
      obligatoria = cb.isRequired();
    } else if (p.tipo === 'texto') {
      obligatoria = it.asTextItem().isRequired();
    } else if (p.tipo === 'parrafo') {
      obligatoria = it.asParagraphTextItem().isRequired();
    }
    if (opciones && opciones.join('|') !== p.opciones.join('|')) errores.push('"' + p.titulo + '": opciones distintas.');
    if (obligatoria !== !!p.obligatoria) errores.push('"' + p.titulo + '": obligatoriedad distinta.');
  });
  var secciones = form.getItems(FormApp.ItemType.PAGE_BREAK).length;
  var esperadasSecc = {};
  esperadas.forEach(function (p) { esperadasSecc[p.seccion] = true; });
  if (secciones !== Object.keys(esperadasSecc).length - 1) errores.push('Cantidad de secciones distinta: ' + secciones + '.');
  if (errores.length) throw new Error('ESTRUCTURA INCORRECTA:\n- ' + errores.join('\n- '));
  Logger.log('Estructura OK: ' + esperadas.length + ' preguntas en ' + (secciones + 1) + ' secciones.');
}

/** Respuesta completa de prueba. Devuelve lo que debería verse en cada columna. */
/** @param {GoogleAppsScript.Forms.Form} form */
function enviarRespuestaDePrueba_(form) {
  var valores = {
    nombre: CONFIG.MARCA_PRUEBA + ' Prueba automática',
    whatsapp: '+591 70000000',
    pais: 'Bolivia',
    ciudad: 'Santa Cruz',
    contacto: 'Sí',
    tipo: 'Revendedor con tienda propia',
    clientes: '51–100',
    servicios: ['Netflix', 'Disney+'],
    ventas: '51–100',
    gestion: 'Excel',
    sistema: 'Ninguno',
    gasto: 'Bs 0 (no pago nada)',
    gusta: 'Prueba automática: es gratis.',
    molesta: 'Prueba automática: todo es manual.',
    tiempo: '1 a 2 horas',
    problemas: ['Pérdida de clientes por vencimientos', 'Verificación de pagos'],
    funciones: ['Alertas automáticas de renovaciones', 'Tienda con nombre, logo y colores propios'],
    indispensable: 'Prueba automática: alertas de vencimiento.',
    precio_basico: 'Bs 31–60',
    precio_avanzado: 'Bs 101–150',
    modalidad: 'Suscripción mensual',
    prueba: 'Sí'
  };
  var activas = preguntasActivas();
  var items = form.getItems().filter(function (it) {
    var t = it.getType();
    return t !== FormApp.ItemType.PAGE_BREAK && t !== FormApp.ItemType.SECTION_HEADER;
  });
  var resp = form.createResponse();
  var esperado = {};
  activas.forEach(function (p, i) {
    var v = valores[p.id];
    var it = items[i];
    var ir;
    if (p.tipo === 'texto') ir = it.asTextItem().createResponse(/** @type {string} */ (v));
    else if (p.tipo === 'parrafo') ir = it.asParagraphTextItem().createResponse(/** @type {string} */ (v));
    else if (p.tipo === 'opcion') ir = it.asMultipleChoiceItem().createResponse(/** @type {string} */ (v));
    else ir = it.asCheckboxItem().createResponse(/** @type {string[]} */ (v));
    resp.withItemResponse(ir);
    esperado[p.id] = Array.isArray(v) ? v.join(', ') : String(v);
  });
  resp.submit();
  return esperado;
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function buscarHojaRespuestas_(ss) {
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) if (hojas[i].getFormUrl()) return hojas[i];
  return null;
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function instalarDisparadores_(ss) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'alEnviarRespuesta' || f === 'actualizacionDiaria') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('alEnviarRespuesta').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('actualizacionDiaria').timeBased().everyDays(1).atHour(7).create();
}

/** Disparador: cada respuesta nueva actualiza el análisis. */
function alEnviarRespuesta() {
  actualizarAnalisis();
}

/** Disparador diario: recoge también los cambios manuales de la pestaña Pilotos. */
function actualizacionDiaria() {
  actualizarAnalisis();
}

/** Recalcula Análisis, Informe y Pilotos del formulario definitivo. */
function actualizarAnalisis() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Otra actualización está en curso; se omite.'); return; }
  try {
    var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
    var hoja = buscarHojaRespuestas_(ss);
    if (!hoja) throw new Error('No encuentro la pestaña de respuestas vinculada al formulario.');
    var valores = hoja.getDataRange().getValues();
    prepararPestanas_(ss, valores, {});
    escribirInicio_(ss);
    ordenarPestanas_(ss);
    Logger.log('Análisis actualizado: ' + (valores.length - 1) + ' filas en Respuestas.');
  } finally {
    lock.releaseLock();
  }
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function ordenarPestanas_(ss) {
  [CONFIG.HOJA_INICIO, CONFIG.HOJA_ANALISIS, CONFIG.HOJA_INFORME, CONFIG.HOJA_PILOTOS, CONFIG.HOJA_RESPUESTAS]
    .forEach(function (nombre, i) {
      var s = ss.getSheetByName(nombre);
      if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); }
    });
  var inicio = ss.getSheetByName(CONFIG.HOJA_INICIO);
  if (inicio) ss.setActiveSheet(inicio);
}

/** Lee la pestaña Pilotos, recalcula todo y redibuja Pilotos, Análisis e Informe. */
/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss @param {any[][]} valores @param {any} opciones */
function prepararPestanas_(ss, valores, opciones) {
  var pilotosManual = leerPilotos_(ss);
  var mapa = {};
  Object.keys(pilotosManual).forEach(function (k) {
    var m = pilotosManual[k];
    mapa[k] = { contactado: m[0], demo: m[1], prueba: m[2], pago: m[3] };
  });
  var datos = normalizarRespuestas(valores[0] || [], valores.slice(1), {
    incluirPruebas: !!opciones.incluirPruebas,
    pilotos: mapa
  });
  var res = analizar(datos);
  escribirPilotos_(ss, valores, datos, pilotosManual);
  escribirPanel_(obtenerHoja_(ss, CONFIG.HOJA_ANALISIS), res);
  escribirInforme_(obtenerHoja_(ss, CONFIG.HOJA_INFORME), informeMarkdown(res, {}));
  return res;
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss @param {string} nombre */
function obtenerHoja_(ss, nombre) {
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

// ---------------------------------------------------------------- Pilotos

var CABECERA_PILOTOS = ['Clave', 'Fecha', 'Nombre', 'WhatsApp', 'Abrir chat', 'País', 'Ciudad',
  'Tipo de vendedor', 'Clientes activos', 'Pagaría (básico)', 'Pagaría (avanzado)', 'Prueba 7 días',
  'Nivel de intención'].concat(COLUMNAS_PILOTO);

/** Devuelve clave → [Contactado, Demo, Prueba, Pagó, Notas] escritos a mano. */
/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function leerPilotos_(ss) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_PILOTOS);
  var mapa = {};
  if (!hoja || hoja.getLastRow() < 2) return mapa;
  var v = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();
  var cab = v[0].map(String);
  var iClave = cab.indexOf('Clave');
  var idx = COLUMNAS_PILOTO.map(function (c) { return cab.indexOf(c); });
  for (var r = 1; r < v.length; r++) {
    var clave = texto_(v[r][iClave]);
    if (!clave) continue;
    mapa[clave] = idx.map(function (i) { return i >= 0 ? texto_(v[r][i]) : ''; });
  }
  return mapa;
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function escribirPilotos_(ss, valores, datos, manual) {
  var hoja = obtenerHoja_(ss, CONFIG.HOJA_PILOTOS);
  var filas = [];
  var usadas = {};
  datos.registros.forEach(function (r) {
    if (!esSi_(r.valores.contacto)) return; // solo quien autorizó el contacto
    var m = manual[r.clave] || ['', '', '', '', ''];
    usadas[r.clave] = true;
    var digitos = soloDigitos_(r.valores.whatsapp);
    filas.push({ nivel: r.intencion, fila: [
      r.clave, r.marca, r.valores.nombre, r.valores.whatsapp,
      digitos.length >= 7 ? 'https://wa.me/' + digitos : '',
      r.valores.pais, r.valores.ciudad, r.valores.tipo, r.valores.clientes,
      r.valores.precio_basico, r.valores.precio_avanzado, r.valores.prueba,
      NIVELES[r.intencion]
    ].concat(m) });
  });
  // Conservar seguimientos manuales de filas cuya respuesta ya no está.
  Object.keys(manual).forEach(function (k) {
    if (usadas[k]) return;
    var m = manual[k];
    if (m.join('') === '') return;
    var fila = CABECERA_PILOTOS.map(function () { return ''; });
    fila[0] = k;
    fila[2] = '(respuesta eliminada de la hoja)';
    filas.push({ nivel: -1, fila: fila.slice(0, 13).concat(m) });
  });
  filas.sort(function (a, b) { return b.nivel - a.nivel; });
  var matriz = filas.map(function (x) {
    return x.fila.map(function (c, i) { return i === 1 ? c : celdaSegura(c); });
  });

  hoja.clear();
  hoja.getRange(1, 1, 1, CABECERA_PILOTOS.length).setValues([CABECERA_PILOTOS])
    .setBackground(CONFIG.COLOR_PRINCIPAL).setFontColor(CONFIG.COLOR_FONDO).setFontWeight('bold').setWrap(true);
  hoja.getRange(1, 14, 1, COLUMNAS_PILOTO.length).setBackground(CONFIG.COLOR_ACENTO).setFontColor(CONFIG.COLOR_PRINCIPAL);
  if (matriz.length) {
    hoja.getRange(2, 4, matriz.length, 1).setNumberFormat('@');
    hoja.getRange(2, 1, matriz.length, CABECERA_PILOTOS.length).setValues(matriz);
    var siNo = SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).setAllowInvalid(false).build();
    hoja.getRange(2, 14, matriz.length, 4).setDataValidation(siNo);
    hoja.getRange(2, 2, matriz.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  }
  hoja.setFrozenRows(1);
  hoja.setFrozenColumns(3);
  hoja.hideColumns(1);
  hoja.setColumnWidth(3, 180);
  hoja.setColumnWidth(5, 190);
  hoja.setColumnWidth(13, 230);
  hoja.setColumnWidth(18, 260);
  hoja.setTabColor(CONFIG.COLOR_ACENTO);
  var nota = 'PRIVADO: contiene teléfonos. No compartas esta pestaña. Solo aparecen quienes autorizaron el contacto. ' +
    'Completá las columnas amarillas SOLO cuando el hecho ocurra de verdad (demo hecha, prueba iniciada, pago recibido).';
  hoja.getRange(1, 3).setNote(nota);
  hoja.getRange(1, 14).setNote(nota);
}

// ---------------------------------------------------------------- Panel de análisis

/** @param {GoogleAppsScript.Spreadsheet.Sheet} hoja */
function escribirPanel_(hoja, res) {
  hoja.getCharts().forEach(function (c) { hoja.removeChart(c); });
  hoja.getRange(1, 1, hoja.getMaxRows(), hoja.getMaxColumns()).breakApart();
  hoja.clear();
  hoja.setHiddenGridlines(true);
  hoja.setTabColor(CONFIG.COLOR_PRINCIPAL);
  hoja.setColumnWidth(1, 300);
  hoja.setColumnWidths(2, 7, 95);
  var w = { fila: 1, graficos: [] };

  var titulo = hoja.getRange(1, 1, 1, 8).merge();
  titulo.setValue('Gabriel Store · Panel del estudio de mercado').setFontSize(16).setFontWeight('bold')
    .setBackground(CONFIG.COLOR_PRINCIPAL).setFontColor(CONFIG.COLOR_ACENTO);
  hoja.setRowHeight(1, 36);
  hoja.getRange(2, 1, 1, 8).merge().setValue('Datos reales del formulario. Se actualiza solo con cada respuesta. ' +
    'Sin teléfonos ni nombres. Las respuestas que empiezan con ' + CONFIG.MARCA_PRUEBA + ' no se cuentan.')
    .setFontColor('#555555').setWrap(true);
  w.fila = 4;

  var n = res.n;
  bloque_(hoja, w, 'Resumen', ['Indicador', 'Valor'], [
    ['Encuestados válidos', n],
    ['Respuestas de prueba excluidas', res.excluidasPrueba],
    ['Última respuesta', res.ultima || '—'],
    ['Confianza de las conclusiones', res.confianza],
    ['Margen de error mínimo (±)', res.margen == null ? '—' : res.margen],
    ['Intención declarada (dice que pagaría)', res.porNivel[1] + res.porNivel[2] + res.porNivel[3] + res.porNivel[4]],
    ['Intención calificada (pidió prueba + contacto)', res.porNivel[2] + res.porNivel[3] + res.porNivel[4]],
    ['Verificada: demo o prueba realizada', res.porNivel[3] + res.porNivel[4]],
    ['Verificada: pagó o dejó anticipo', res.porNivel[4]],
    ['Quieren la prueba de 7 días (Sí)', valorDe_(res.prueba, 'Sí')],
    ['Tal vez probarían', valorDe_(res.prueba, 'Tal vez')]
  ], { sinGrafico: true, formatos: function (r) {
    hoja.getRange(r + 4, 2).setNumberFormat('dd/mm/yyyy hh:mm');
    hoja.getRange(r + 6, 2).setNumberFormat('0%');
  } });
  if (res.faltantes.length) {
    hoja.getRange(w.fila, 1, 1, 8).merge().setValue('⚠️ Columnas no encontradas: ' + res.faltantes.join(' · '))
      .setFontColor('#B00020').setWrap(true);
    w.fila += 2;
  }

  tablaConteo_(hoja, w, 'Clientes activos por segmento', res.clientes, 'COLUMN');
  tablaConteo_(hoja, w, 'Tipo de vendedor', res.tipo, 'BAR');
  tablaConteo_(hoja, w, 'Herramientas más utilizadas', res.gestion, 'BAR');
  var comp = res.competidores.filas.slice(0, 12).map(function (c) { return [c.etiqueta, c.n, c.gastoTipico]; });
  comp.push(['(No usa ningún sistema)', res.competidores.ninguno, '']);
  bloque_(hoja, w, 'Competidores / sistemas mencionados', ['Sistema', 'Personas', 'Gasto más común'], comp,
    { grafico: comp.length > 1 ? 'BAR' : null, columnasGrafico: 2 });
  tablaConteo_(hoja, w, 'Gasto mensual actual en sistemas', res.gasto, 'COLUMN');
  tablaConteo_(hoja, w, 'Problemas más frecuentes (% de quienes respondieron)', res.problemas, 'BAR');
  tablaConteo_(hoja, w, 'Funciones más solicitadas (% de quienes respondieron)', res.funciones, 'BAR');

  var prio = res.prioridad.map(function (p, i) {
    return [p.funcion, p.puntaje, p.pctFuncion, p.pctProblema, p.pctEnCalificados, p.etapa];
  });
  bloque_(hoja, w, 'Prioridad de funciones (2 × la eligen + sufren el problema)',
    ['Función', 'Puntaje', 'La eligen', 'Sufren el problema', 'Entre calificados', 'Etapa'], prio,
    { sinGrafico: true, formatos: function (r) {
      if (prio.length) {
        hoja.getRange(r + 2, 2, prio.length, 1).setNumberFormat('0.00');
        hoja.getRange(r + 2, 3, prio.length, 3).setNumberFormat('0%');
      }
    } });

  crucePago_(hoja, w, 'Disposición de pago — plan básico, por segmento', res.pagoBasicoSeg, 'precio_basico');
  crucePago_(hoja, w, 'Disposición de pago — plan avanzado, por segmento', res.pagoAvanzadoSeg, 'precio_avanzado');

  var acep = res.aceptBasico.filas.map(function (f) { return [f.etiqueta, f.acepta, f.pct]; });
  bloque_(hoja, w, 'Aceptación por precio — básico (pagaría al menos el mínimo del rango)',
    ['Precio', 'Personas', '% de encuestados'], acep, { grafico: 'COLUMN', columnasGrafico: 3, serieGrafico: 2,
      formatos: function (r) { if (acep.length) hoja.getRange(r + 2, 3, acep.length, 1).setNumberFormat('0%'); } });

  var seg = res.segmentos.map(function (s) {
    return [s.segmento, s.n, s.declarada, s.calificada, s.verificada, s.pagaron];
  });
  bloque_(hoja, w, 'Intención por segmento (dice vs. hace)',
    ['Clientes activos', 'Encuestados', 'Declarada', 'Calificada', 'Verificada', 'Pagaron'], seg,
    { grafico: 'COLUMN', columnasGrafico: 6, serieGrafico: 3 });

  tablaConteo_(hoja, w, 'Personas interesadas en probar el producto', res.prueba, 'PIE');
  tablaConteo_(hoja, w, 'Servicios que comercializan', res.servicios, 'BAR');
  tablaConteo_(hoja, w, 'País', res.pais, null);
  if (!CONFIG.VERSION_CORTA) {
    tablaConteo_(hoja, w, 'Ventas o renovaciones por mes', res.ventas, null);
    tablaConteo_(hoja, w, 'Tiempo diario de gestión', res.tiempo, 'COLUMN');
    tablaConteo_(hoja, w, 'Modalidad de pago preferida', res.modalidad, null);
  }
  hoja.setFrozenRows(1);
}

function valorDe_(conteo, etiqueta) {
  var f = conteo.filas.filter(function (x) { return x.etiqueta === etiqueta; })[0];
  return f ? f.n : 0;
}

/** @param {GoogleAppsScript.Spreadsheet.Sheet} hoja */
function tablaConteo_(hoja, w, titulo, conteo, tipoGrafico) {
  var filas = conteo.filas.map(function (f) { return [f.etiqueta, f.n, f.pct]; });
  bloque_(hoja, w, titulo + ' · respondieron ' + conteo.respondieron, ['Opción', 'Personas', '%'], filas, {
    grafico: tipoGrafico,
    columnasGrafico: 2,
    formatos: function (r) { if (filas.length) hoja.getRange(r + 2, 3, filas.length, 1).setNumberFormat('0%'); }
  });
}

/** @param {GoogleAppsScript.Spreadsheet.Sheet} hoja */
function crucePago_(hoja, w, titulo, cruce, id) {
  var ops = preguntaPorId(id).opciones;
  var filas = cruce.map(function (s) { return [s.segmento].concat(s.cuentas).concat([s.n, s.mediana]); });
  bloque_(hoja, w, titulo, ['Clientes activos'].concat(ops).concat(['Total', 'Mediana']), filas, {
    grafico: 'STACKED', columnasGrafico: 1 + ops.length
  });
}

/**
 * Escribe un bloque (título + cabecera + filas) y, si corresponde, un gráfico al costado.
 * Cada bloque con gráfico ocupa al menos 19 filas para que los gráficos no se superpongan.
 */
/** @param {GoogleAppsScript.Spreadsheet.Sheet} hoja */
function bloque_(hoja, w, titulo, cabecera, filas, op) {
  op = op || {};
  var r = w.fila;
  var ancho = cabecera.length;
  hoja.getRange(r, 1, 1, Math.max(ancho, 2)).merge();
  hoja.getRange(r, 1).setValue(titulo).setFontWeight('bold').setFontSize(12)
    .setFontColor(CONFIG.COLOR_PRINCIPAL);
  hoja.getRange(r + 1, 1, 1, ancho).setValues([cabecera]).setFontWeight('bold')
    .setBackground(CONFIG.COLOR_PRINCIPAL).setFontColor(CONFIG.COLOR_FONDO).setWrap(true);
  if (filas.length) {
    var datos = filas.map(function (f) {
      var c = f.slice(0, ancho).map(celdaSegura);
      while (c.length < ancho) c.push('');
      return c;
    });
    hoja.getRange(r + 2, 1, datos.length, ancho).setValues(datos);
    hoja.getRange(r + 2, 1, datos.length, ancho).setBorder(null, null, true, null, null, true, '#DDDDDD',
      SpreadsheetApp.BorderStyle.SOLID);
    if (op.formatos) op.formatos(r);
  } else {
    hoja.getRange(r + 2, 1).setValue('Sin datos todavía').setFontColor('#777777');
  }
  var alto = 2 + Math.max(filas.length, 1);
  var tipo = op.sinGrafico ? null : op.grafico;
  if (tipo && filas.length) {
    var ancla = Math.max(ancho + 2, 5);
    var b = hoja.newChart();
    if (op.serieGrafico) {
      // Graficar solo la columna de etiquetas y una columna de valores.
      b = b.addRange(hoja.getRange(r + 1, 1, filas.length + 1, 1))
        .addRange(hoja.getRange(r + 1, op.serieGrafico, filas.length + 1, 1));
    } else {
      b = b.addRange(hoja.getRange(r + 1, 1, filas.length + 1, op.columnasGrafico || 2));
    }
    b = b.setNumHeaders(1)
      .setPosition(r, ancla, 0, 0)
      .setOption('title', titulo)
      .setOption('titleTextStyle', { color: CONFIG.COLOR_PRINCIPAL, fontSize: 13, bold: true })
      .setOption('backgroundColor', CONFIG.COLOR_FONDO)
      .setOption('width', 560)
      .setOption('height', 340);
    if (tipo === 'PIE') {
      b = b.setChartType(Charts.ChartType.PIE)
        .setOption('colors', [CONFIG.COLOR_PRINCIPAL, CONFIG.COLOR_ACENTO, '#9AA3B8', '#5B6888'])
        .setOption('pieHole', 0.4);
    } else if (tipo === 'STACKED') {
      b = b.setChartType(Charts.ChartType.BAR).setOption('isStacked', true)
        .setOption('colors', ['#C9CED9', '#9AA3B8', '#5B6888', CONFIG.COLOR_PRINCIPAL, '#E0A800', CONFIG.COLOR_ACENTO])
        .setOption('legend', { position: 'top', maxLines: 3 });
    } else {
      b = b.setChartType(tipo === 'BAR' ? Charts.ChartType.BAR : Charts.ChartType.COLUMN)
        .setOption('colors', [CONFIG.COLOR_PRINCIPAL])
        .setOption('legend', { position: 'none' });
    }
    hoja.insertChart(b.build());
    alto = Math.max(alto, 19);
  }
  w.fila = r + alto + 1;
}

// ---------------------------------------------------------------- Informe e Inicio

/** @param {GoogleAppsScript.Spreadsheet.Sheet} hoja @param {string} markdown */
function escribirInforme_(hoja, markdown) {
  hoja.clear();
  hoja.setHiddenGridlines(true);
  hoja.setColumnWidth(1, 900);
  var lineas = markdown.split('\n').map(function (l) {
    return [celdaSegura(l.indexOf('- ') === 0 ? '• ' + l.slice(2) : l)];
  });
  hoja.getRange(1, 1, lineas.length, 1).setValues(lineas).setWrap(true).setVerticalAlignment('top');
  lineas.forEach(function (l, i) {
    var t = l[0];
    var celda = hoja.getRange(i + 1, 1);
    if (t.indexOf('# ') === 0) celda.setFontSize(16).setFontWeight('bold').setBackground(CONFIG.COLOR_PRINCIPAL).setFontColor(CONFIG.COLOR_ACENTO);
    else if (t.indexOf('## ') === 0) celda.setFontSize(13).setFontWeight('bold').setFontColor(CONFIG.COLOR_PRINCIPAL).setBackground(CONFIG.COLOR_SUAVE);
    else if (t.indexOf('> ') === 0) celda.setFontStyle('italic').setFontColor('#555555');
  });
  hoja.setTabColor(CONFIG.COLOR_PRINCIPAL);
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function escribirInicio_(ss) {
  var hoja = obtenerHoja_(ss, CONFIG.HOJA_INICIO);
  var e = enlaces_();
  hoja.getRange(1, 1, hoja.getMaxRows(), hoja.getMaxColumns()).breakApart();
  hoja.clear();
  hoja.setHiddenGridlines(true);
  hoja.setColumnWidth(1, 260);
  hoja.setColumnWidth(2, 700);
  var filas = [
    ['Gabriel Store · Estudio de mercado', ''],
    ['', ''],
    ['Enlace para responder (corto)', e.corto],
    ['Enlace para responder (largo)', e.responder],
    ['Enlace para editar (solo vos)', e.editar],
    ['Esta hoja', e.hoja],
    ['Compartir por WhatsApp', e.whatsapp],
    ['Mensaje sugerido', mensajeWhatsapp_(e.corto)],
    ['', ''],
    ['Cómo se actualiza', 'Automático con cada respuesta y todos los días a las 7:00. A mano: en Apps Script ejecutá actualizarAnalisis().'],
    ['Pestaña Análisis', 'Panel con tablas y gráficos. Sin teléfonos ni nombres.'],
    ['Pestaña Informe', 'Funciones prioritarias, precios, segmento, ventajas, pilotos y lanzamiento.'],
    ['Pestaña Pilotos (privado)', 'Tiene teléfonos. No la compartas. Marcá demo / prueba / pago solo cuando ocurran.'],
    ['Pestaña Respuestas', 'Datos crudos del formulario. Contiene teléfonos: no la compartas.'],
    ['Para compartir resultados', 'Ejecutá crearReporteParaCompartir(): crea otra hoja sin datos personales.'],
    ['Respuestas de prueba', 'Si probás el formulario, empezá tu nombre con ' + CONFIG.MARCA_PRUEBA + ' y se excluye solo.']
  ];
  hoja.getRange(1, 1, filas.length, 2).setValues(filas).setWrap(true).setVerticalAlignment('top');
  hoja.getRange(1, 1, 1, 2).merge().setFontSize(16).setFontWeight('bold')
    .setBackground(CONFIG.COLOR_PRINCIPAL).setFontColor(CONFIG.COLOR_ACENTO);
  hoja.getRange(3, 1, filas.length - 2, 1).setFontWeight('bold').setFontColor(CONFIG.COLOR_PRINCIPAL);
  hoja.setTabColor(CONFIG.COLOR_ACENTO);
}

// ---------------------------------------------------------------- Compartir sin datos personales

/** Crea una hoja nueva con Análisis e Informe (pilotos anónimos), sin respuestas crudas ni teléfonos. */
function crearReporteParaCompartir() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var hoja = buscarHojaRespuestas_(ss);
  var valores = hoja.getDataRange().getValues();
  var datos = normalizarRespuestas(valores[0], valores.slice(1), { pilotos: mapaPilotos_(ss) });
  var res = analizar(datos);
  var destino = SpreadsheetApp.create('Gabriel Store — Resultados del estudio (sin datos personales) ' +
    Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd'));
  escribirPanel_(obtenerHoja_(destino, CONFIG.HOJA_ANALISIS), res);
  escribirInforme_(obtenerHoja_(destino, CONFIG.HOJA_INFORME), informeMarkdown(res, { anonimo: true }));
  destino.getSheets().forEach(function (s) {
    if (s.getName() !== CONFIG.HOJA_ANALISIS && s.getName() !== CONFIG.HOJA_INFORME) destino.deleteSheet(s);
  });
  Logger.log('Reporte para compartir (sin teléfonos ni nombres): ' + destino.getUrl());
  return destino.getUrl();
}

/** @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss */
function mapaPilotos_(ss) {
  var manual = leerPilotos_(ss);
  var mapa = {};
  Object.keys(manual).forEach(function (k) {
    var m = manual[k];
    mapa[k] = { contactado: m[0], demo: m[1], prueba: m[2], pago: m[3] };
  });
  return mapa;
}

/**
 * Crea en tu Google Drive un CSV sin nombres, teléfonos ni ciudad, con el nivel
 * de seguimiento de pilotos. Es el archivo que conviene pasarle a Claude.
 */
function exportarCsvAnonimo() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var valores = buscarHojaRespuestas_(ss).getDataRange().getValues();
  var datos = normalizarRespuestas(valores[0], valores.slice(1), { pilotos: mapaPilotos_(ss) });
  var quitar = ['nombre', 'whatsapp', 'ciudad'];
  var preguntas = preguntasActivas().filter(function (p) { return quitar.indexOf(p.id) < 0; });
  var cab = ['ID', 'Fecha'].concat(preguntas.map(function (p) { return p.titulo; }))
    .concat(['Dejó WhatsApp', 'Contactado', 'Demo realizada', 'Prueba iniciada', 'Pagó o dejó anticipo']);
  var filas = datos.registros.map(function (r, i) {
    return ['R' + ('00' + (i + 1)).slice(-3),
      esFecha_(r.marca) ? Utilities.formatDate(r.marca, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd') : String(r.marca)]
      .concat(preguntas.map(function (p) { return limpiarCita(r.valores[p.id] || '', 600); }))
      .concat([r.tieneWhatsapp ? 'Sí' : 'No', r.piloto.contactado, r.piloto.demo, r.piloto.prueba, r.piloto.pago]);
  });
  var csv = [cab].concat(filas).map(function (f) {
    return f.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var archivo = DriveApp.createFile('gabriel-store-encuesta-anonima-' +
    Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd') + '.csv', csv, MimeType.CSV);
  Logger.log('CSV anónimo creado (' + filas.length + ' respuestas): ' + archivo.getUrl());
  return archivo.getUrl();
}
