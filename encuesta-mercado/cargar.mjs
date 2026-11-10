// Carga encuesta-gabriel-store.gs en Node (en un contexto aislado) para reutilizar
// exactamente la misma lógica de análisis que corre en Google Apps Script.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_SCRIPT = path.join(dir, 'encuesta-gabriel-store.gs');

/** Ejecuta el script en un contexto nuevo. `globales` permite inyectar servicios simulados. */
export function cargarScript(globales = {}) {
  const ctx = vm.createContext({ console, ...globales });
  vm.runInContext(fs.readFileSync(RUTA_SCRIPT, 'utf8'), ctx, { filename: 'encuesta-gabriel-store.gs' });
  return ctx;
}

/** Parser CSV (RFC 4180): comillas, comas y saltos de línea dentro de celdas. */
export function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let celda = '';
  let comillas = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}
