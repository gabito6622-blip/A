// Pruebas del estudio de mercado de Gabriel Store.
// Los datos de estas pruebas son FICTICIOS y existen solo para validar la lógica:
// no son resultados del estudio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarScript, parsearCsv } from '../cargar.mjs';
import { crearGoogleFalso } from './google-falso.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

function instalarConFalso() {
  const g = crearGoogleFalso();
  const gs = cargarScript(g.globales);
  gs.instalar();
  const formId = g.propiedades.get('FORM_ID');
  const ssId = g.propiedades.get('SHEET_ID');
  return { g, gs, form: g.archivos.get(formId).objeto, ss: g.archivos.get(ssId).objeto };
}

/** Envía una respuesta ficticia completa por el mismo camino que usa Google. */
function responder(gs, form, v) {
  const base = {
    nombre: 'Ficticio', whatsapp: '', pais: 'Bolivia', ciudad: 'La Paz', contacto: 'No',
    tipo: 'Revendedor independiente', clientes: '1–20', servicios: ['Netflix'], ventas: '1–20',
    gestion: 'WhatsApp', sistema: 'Ninguno', gasto: 'Bs 0 (no pago nada)', gusta: '', molesta: '',
    tiempo: 'Menos de 30 minutos', problemas: ['Control de inventario'], funciones: ['Inventario de cuentas'],
    indispensable: '', precio_basico: 'No pagaría', precio_avanzado: 'No pagaría más que por el básico',
    modalidad: 'Suscripción mensual', prueba: 'No'
  };
  const val = { ...base, ...v };
  const items = form.getItems().filter((i) => !['PAGE_BREAK', 'SECTION_HEADER'].includes(i.getType()));
  const r = form.createResponse();
  gs.preguntasActivas().forEach((p, i) => {
    const x = val[p.id];
    if (x === '' || (Array.isArray(x) && !x.length)) return;
    r.withItemResponse(items[i].createResponse(x));
  });
  r.submit();
}

function textoDeHoja(hoja) {
  return hoja._datos.map((f) => f.join(' | ')).join('\n');
}

test('configuración: títulos únicos, opciones y rangos coherentes', () => {
  const gs = cargarScript();
  const titulos = gs.PREGUNTAS.map((p) => p.titulo);
  assert.equal(new Set(titulos).size, titulos.length, 'títulos repetidos');
  for (const p of gs.PREGUNTAS) {
    if (p.opciones) assert.equal(new Set(p.opciones).size, p.opciones.length, 'opciones repetidas en ' + p.id);
    if (gs.RANGOS[p.id]) assert.equal(gs.RANGOS[p.id].length, p.opciones.length, 'rangos de ' + p.id);
  }
  for (const f of Object.keys(gs.RELACION_FUNCION_PROBLEMA)) {
    assert.ok(gs.preguntaPorId('funciones').opciones.includes(f), f);
    for (const pr of gs.RELACION_FUNCION_PROBLEMA[f]) assert.ok(gs.preguntaPorId('problemas').opciones.includes(pr), pr);
  }
  // Los planes avanzados empiezan por encima del primer rango del básico.
  assert.ok(gs.RANGOS.precio_avanzado[1][0] > gs.RANGOS.precio_basico[1][1]);
  // 22 preguntas (20 pedidas; país/ciudad y gusta/molesta separadas) y 18 en la versión corta.
  assert.equal(gs.PREGUNTAS.length, 22);
  gs.CONFIG.VERSION_CORTA = true;
  assert.equal(gs.preguntasActivas().length, 18);
});

test('casillas: separa opciones que contienen comas y el texto de "Otro"', () => {
  const gs = cargarScript();
  const ops = gs.preguntaPorId('funciones').opciones;
  const r = gs.separarCasillas('Tienda con nombre, logo y colores propios, Bot inteligente de WhatsApp, Facturación, con IVA', ops);
  assert.deepEqual(Array.from(r.elegidas), ['Tienda con nombre, logo y colores propios', 'Bot inteligente de WhatsApp']);
  assert.equal(r.otro, 'Facturación, con IVA');
});

test('instalar(): prueba aislada pasa, se borra, y el formulario definitivo queda limpio', () => {
  const { g, form, ss } = instalarConFalso();
  assert.ok(g.registro.some((l) => l.startsWith('PRUEBA AISLADA: OK')), g.registro.join('\n'));
  const prueba = [...g.archivos.values()].filter((a) => a.nombre.startsWith('[PRUEBA]'));
  assert.equal(prueba.length, 2, 'formulario y hoja de prueba');
  assert.ok(prueba.every((a) => a.papelera), 'la copia de prueba debe ir a la papelera');
  assert.equal(form._respuestas, 0, 'el formulario definitivo no recibe respuestas de prueba');
  assert.equal(form._publicado, true);
  assert.equal(form._titulo, 'Estudio de mercado para revendedores de streaming');
  const nombres = ss.getSheets().map((h) => h.getName());
  assert.deepEqual(nombres, ['Inicio', 'Análisis', 'Informe', 'Pilotos (privado)', 'Respuestas']);
  assert.deepEqual(g.disparadores.map((t) => t.funcion).sort(), ['actualizacionDiaria', 'alEnviarRespuesta']);
  for (const k of ['ENLACE PARA RESPONDER', 'ENLACE PARA EDITAR', 'GOOGLE SHEETS', 'COMPARTIR POR WHATSAPP']) {
    assert.ok(g.registro.some((l) => l.startsWith(k)), k);
  }
  // Validaciones del formulario.
  const items = form._items;
  const wa = items.find((i) => i._titulo.startsWith('Número de WhatsApp'));
  assert.equal(wa._obligatoria, false);
  assert.ok(wa._validacion);
  const nombre = items.find((i) => i._titulo.startsWith('Nombre'));
  assert.equal(nombre._obligatoria, true);
  assert.equal(items.filter((i) => i.getType() === 'PAGE_BREAK').length, 4);
  // Volver a instalar no duplica nada.
  const antes = g.archivos.size;
  cargarScript(g.globales).instalar();
  assert.equal(g.archivos.size, antes);
});

test('carpeta nueva "Encuesta Gabriel Store" y archivos existentes intactos', () => {
  const g = crearGoogleFalso();
  // Lo que el usuario ya tenía antes: una carpeta con el mismo nombre, un formulario y una hoja.
  const suCarpeta = g.globales.DriveApp.createFolder('Encuesta Gabriel Store');
  const suForm = g.globales.FormApp.create('Mi formulario de siempre');
  suForm.addTextItem().setTitle('Pregunta mía');
  const suHoja = g.globales.SpreadsheetApp.create('Mis ventas');
  suHoja.getSheets()[0].getRange(1, 1, 1, 2).setValues([['Cliente', 'Monto']]);
  const antes = JSON.stringify([...g.archivos.entries()].map(([id, a]) => [id, a.nombre, a.papelera, a.padres]));
  const datosAntes = JSON.stringify([suForm._items.map((i) => i._titulo), suHoja.getSheets()[0]._datos]);

  const gs = cargarScript(g.globales);
  gs.instalar();
  gs.crearReporteParaCompartir();
  gs.exportarCsvAnonimo();

  // Se creó una carpeta NUEVA (distinta de la del usuario) y se avisó.
  const carpetaId = g.propiedades.get('FOLDER_ID');
  assert.notEqual(carpetaId, suCarpeta.getId());
  assert.equal(g.carpetas.get(carpetaId).nombre, 'Encuesta Gabriel Store');
  assert.ok(g.registro.some((l) => l.startsWith('Aviso: ya existe otra carpeta')));
  assert.ok(g.registro.some((l) => l.startsWith('CARPETA DE DRIVE:')));

  // Todo lo que creó el script quedó dentro de la carpeta nueva (también la copia de prueba).
  const idsUsuario = new Set(JSON.parse(antes).map((x) => x[0]));
  const creados = [...g.archivos.entries()].filter(([id]) => !idsUsuario.has(id));
  assert.equal(creados.length, 6); // prueba (form + hoja), definitivo (form + hoja), reporte y CSV
  for (const [, a] of creados) assert.deepEqual(a.padres, [carpetaId], a.nombre);

  // Los archivos del usuario no cambiaron en nada.
  const despues = JSON.stringify([...g.archivos.entries()].filter(([id]) => idsUsuario.has(id))
    .map(([id, a]) => [id, a.nombre, a.papelera, a.padres]));
  assert.equal(despues, antes);
  assert.equal(JSON.stringify([suForm._items.map((i) => i._titulo), suHoja.getSheets()[0]._datos]), datosAntes);
  assert.equal(g.carpetas.get(suCarpeta.getId()).descripcion, '');
});

test('análisis con respuestas ficticias: conteos, intención, privacidad y pilotos', () => {
  const { g, gs, form, ss } = instalarConFalso();
  responder(gs, form, {
    nombre: 'Ficticio A', whatsapp: '+591 71111111', contacto: 'Sí', clientes: '51–100', prueba: 'Sí',
    precio_basico: 'Bs 61–100', precio_avanzado: 'Bs 151–250', sistema: 'https://www.ejemplo-crm.com/panel',
    gasto: 'Bs 31–60', problemas: ['Verificación de pagos', 'Atención de WhatsApp'],
    funciones: ['Bot inteligente de WhatsApp', 'Registro y verificación de pagos', 'Tienda con nombre, logo y colores propios'],
    molesta: 'Es caro y lento, escribime al +591 71111111', indispensable: 'Alertas de vencimiento automáticas'
  });
  responder(gs, form, {
    nombre: 'Ficticio B', whatsapp: '+591 72222222', contacto: 'Sí', clientes: '51–100', prueba: 'Tal vez',
    precio_basico: 'Bs 31–60', sistema: 'Ejemplo CRM', gasto: 'Bs 31–60',
    problemas: ['Pérdida de clientes por vencimientos'], funciones: ['Alertas automáticas de renovaciones']
  });
  responder(gs, form, { nombre: 'Ficticio C', clientes: '1–20', sistema: '=IMPORTXML("http://x","//a")' });
  responder(gs, form, { nombre: '[PRUEBA] Gabriel probando', clientes: 'Más de 300' });
  gs.alEnviarRespuesta();

  const datos = ss.getSheetByName('Respuestas').getDataRange().getValues();
  const res = gs.analizar(gs.normalizarRespuestas(datos[0], datos.slice(1), {}));
  assert.equal(res.n, 3);
  assert.equal(res.excluidasPrueba, 1);
  assert.equal(res.porNivel[0], 1); // C no pagaría
  assert.equal(res.porNivel[1], 1); // B: declara pero "Tal vez"
  assert.equal(res.porNivel[2], 1); // A: calificada
  assert.equal(res.clientes.filas.find((f) => f.etiqueta === '51–100').n, 2);
  // Enlace y nombre del mismo competidor se agrupan.
  assert.equal(res.competidores.filas[0].n, 2);
  assert.equal(res.competidores.ninguno, 0);
  assert.equal(res.funciones.filas.find((f) => f.etiqueta === 'Tienda con nombre, logo y colores propios').n, 1);
  assert.equal(res.mejorSegmento.segmento, '51–100');

  const panel = textoDeHoja(ss.getSheetByName('Análisis'));
  const informe = textoDeHoja(ss.getSheetByName('Informe'));
  const pilotos = textoDeHoja(ss.getSheetByName('Pilotos (privado)'));
  for (const t of [panel, informe]) {
    assert.ok(!/7111|7222/.test(t), 'no debe haber teléfonos en Análisis ni Informe');
  }
  assert.ok(!/Ficticio/.test(panel), 'el panel no muestra nombres');
  assert.ok(/=IMPORTXML/.test(panel), 'el texto peligroso se guarda como texto, no como fórmula');
  assert.ok(/71111111/.test(pilotos) && /wa\.me\/59171111111/.test(pilotos), 'Pilotos sí tiene el contacto');
  assert.ok(!/Ficticio C/.test(pilotos), 'quien no autorizó contacto no aparece en Pilotos');
  assert.ok(ss.getSheetByName('Análisis')._graficos.length >= 10);
  assert.match(informe, /Funciones a priorizar|cinco funciones/);

  // Gabriel registra un pago real en Pilotos → pasa a "Verificada: pagó" sin perder la nota.
  const hp = ss.getSheetByName('Pilotos (privado)');
  const cab = hp._datos[0];
  const filaB = hp._datos.findIndex((f) => f[2] === 'Ficticio B');
  hp._datos[filaB][cab.indexOf('Pagó o dejó anticipo')] = 'Sí';
  hp._datos[filaB][cab.indexOf('Notas')] = 'Pagó Bs 49 por QR';
  gs.actualizarAnalisis();
  const hp2 = ss.getSheetByName('Pilotos (privado)');
  const fB = hp2._datos.find((f) => f[2] === 'Ficticio B');
  assert.equal(fB[12], 'Verificada: pagó o dejó anticipo');
  assert.equal(fB[17], 'Pagó Bs 49 por QR');
  assert.equal(hp2._datos[1][2], 'Ficticio B', 'los verificados quedan arriba');

  // Reporte para compartir: sin nombres ni teléfonos.
  const url = gs.crearReporteParaCompartir();
  const id = url.split('/d/')[1].split('/')[0];
  const compartido = g.archivos.get(id).objeto;
  assert.deepEqual(compartido.getSheets().map((h) => h.getName()), ['Análisis', 'Informe']);
  const txt = compartido.getSheets().map(textoDeHoja).join('\n');
  assert.ok(!/Ficticio|7111|7222/.test(txt), 'el reporte compartido no tiene datos personales');

  // CSV anónimo → analizador de Node da el mismo resultado.
  gs.exportarCsvAnonimo();
  const csv = [...g.archivos.values()].find((a) => a.tipo === 'archivo').contenido;
  assert.ok(!/Ficticio|7111|7222|La Paz/.test(csv), 'CSV sin nombre, teléfono ni ciudad');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'encuesta-')), 'anonimo.csv');
  fs.writeFileSync(tmp, csv);
  const json = JSON.parse(execFileSync(process.execPath, [path.join(dir, '..', 'analizar.mjs'), tmp, '--json']).toString());
  assert.equal(json.n, 3);
  assert.equal(json.porNivel[4], 1, 'el pago verificado viaja en el CSV');
  assert.equal(json.porNivel[2], 1);
  const md = execFileSync(process.execPath, [path.join(dir, '..', 'analizar.mjs'), tmp, '--anonimo']).toString();
  for (let i = 1; i <= 7; i++) assert.match(md, new RegExp('## ' + i + '\\. '), 'sección ' + i);
});

test('sin respuestas: no inventa datos', () => {
  const gs = cargarScript();
  const cab = gs.PREGUNTAS.map((p) => p.titulo);
  const res = gs.analizar(gs.normalizarRespuestas(['Marca temporal', ...cab], [], {}));
  assert.equal(res.n, 0);
  assert.equal(res.precios.basico, null);
  assert.equal(res.mejorSegmento, null);
  const md = gs.informeMarkdown(res, {});
  assert.match(md, /Todavía no hay respuestas reales/);
  assert.doesNotMatch(md, /Bs \d+\/mes/);
});

test('precios: elige el rango con mejor ingreso que supere el umbral de aceptación', () => {
  const gs = cargarScript();
  const ops = gs.preguntaPorId('precio_basico').opciones;
  const cab = ['Marca temporal', gs.preguntaPorId('nombre').titulo, gs.preguntaPorId('precio_basico').titulo];
  // 10 respuestas ficticias: 2 no pagarían, 3 en 1–30, 4 en 31–60, 1 en 61–100.
  const filas = [0, 0, 1, 1, 1, 2, 2, 2, 2, 3].map((i, k) => ['t' + k, 'F' + k, ops[i]]);
  const res = gs.analizar(gs.normalizarRespuestas(cab, filas, {}));
  // Aceptación ≥ Bs 31: 5/10 = 50% → índice 15.5 > (≥1: 80% → 0.8). Sugerido dentro de 31–60.
  assert.equal(res.precios.basico.etiqueta, 'Bs 31–60');
  assert.equal(res.precios.basico.precio, 39);
  assert.equal(gs.precioSugerido(61, 100), 69);
  assert.equal(gs.precioSugerido(151, null), 159);
});

test('el analizador CLI lee un CSV con comas, comillas y saltos de línea', () => {
  const filas = parsearCsv('a,b\n"x, y","línea 1\nlínea 2 ""citada"""\n');
  assert.deepEqual(filas, [['a', 'b'], ['x, y', 'línea 1\nlínea 2 "citada"']]);
});
