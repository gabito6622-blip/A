#!/usr/bin/env node
// Analiza un CSV de respuestas del estudio de mercado y genera el informe para Gabriel Store.
//
// Uso:
//   node encuesta-mercado/analizar.mjs respuestas.csv              → informe en Markdown
//   node encuesta-mercado/analizar.mjs respuestas.csv --anonimo    → sin nombres de pilotos
//   node encuesta-mercado/analizar.mjs respuestas.csv --json       → todos los cálculos en JSON
//
// Acepta el CSV anónimo de exportarCsvAnonimo() (recomendado) o la pestaña "Respuestas"
// descargada como CSV. Nunca imprime teléfonos.
import fs from 'node:fs';
import { cargarScript, parsearCsv } from './cargar.mjs';

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: node encuesta-mercado/analizar.mjs <respuestas.csv> [--anonimo] [--json] [--incluir-pruebas]');
  process.exit(1);
}
const filas = parsearCsv(fs.readFileSync(archivo, 'utf8'));
if (!filas.length) {
  console.error('El CSV está vacío.');
  process.exit(1);
}
const gs = cargarScript();
const datos = gs.normalizarRespuestas(filas[0], filas.slice(1), { incluirPruebas: args.includes('--incluir-pruebas') });
const res = gs.analizar(datos);
if (args.includes('--json')) {
  console.log(JSON.stringify(res, null, 2));
} else {
  console.log(gs.informeMarkdown(res, { anonimo: args.includes('--anonimo') }));
}
