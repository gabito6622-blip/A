// Pruebas del lector/escritor de Excel y CSV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { writeXlsx, readSheet, normHeader } from "../dist/server/xlsx.js";
import { phoneWithCountry } from "../dist/server/exports.js";

test("ida y vuelta de un .xlsx con acentos, números y textos peligrosos", () => {
  const buf = writeXlsx([{ name: "Clientes", rows: [["Nombre", "Tel", "Saldo"], ["María Ñandú", "+591 70011223", 60.5], ["=CMD()", "<x>&", null]] }]);
  assert.deepEqual(readSheet(buf), [["Nombre", "Tel", "Saldo"], ["María Ñandú", "+591 70011223", "60.5"], ["=CMD()", "<x>&"]]);
  assert.ok(buf.toString("latin1").includes('t="inlineStr"'), "los textos van como texto, no como fórmula");
  assert.ok(!buf.toString("latin1").includes("<f>"), "no se escriben fórmulas");
});

test("CSV con punto y coma, comillas, BOM y filas vacías", () => {
  const rows = readSheet(Buffer.from('﻿Nombre;Teléfono\n"Pérez; Ana";70011223\r\n;;\nLuis;"7888""9900"\n'));
  assert.deepEqual(rows, [["Nombre", "Teléfono"], ["Pérez; Ana", "70011223"], ["Luis", '7888"9900']]);
  assert.deepEqual(readSheet(Buffer.from("a,b\n1,2\n")), [["a", "b"], ["1", "2"]]);
});

test("un archivo que no es Excel ni texto da un error claro", () => {
  const bad = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
  assert.throws(() => readSheet(bad), /Excel/);
});

test("un ZIP 'bomba' se corta por tamaño", () => {
  // Una hoja que se descomprime a 30 MB.
  const huge = deflateRawSync(Buffer.alloc(30 * 1024 * 1024, 0x20));
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(huge.length, 18); lh.writeUInt32LE(30 * 1024 * 1024, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(huge.length, 20); ch.writeUInt32LE(30 * 1024 * 1024, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 42);
  const cd = Buffer.concat([ch, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + huge.length, 16);
  assert.throws(() => readSheet(Buffer.concat([lh, name, huge, cd, end])), /demasiado grande/);
});

test("encabezados y teléfonos se normalizan", () => {
  assert.equal(normHeader("  Teléfono / WhatsApp "), "telefono whatsapp");
  assert.equal(phoneWithCountry("70011223"), "+59170011223");
  assert.equal(phoneWithCountry("591 70011223"), "+59170011223");
  assert.equal(phoneWithCountry("+54 9 11 5555 0101"), "+5491155550101");
});
