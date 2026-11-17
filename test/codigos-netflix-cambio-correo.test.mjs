// Netflix para clientes finales (18/11/2026, pedido del dueño): el cliente ve el código de hogar, de inicio de
// sesión y de acceso temporal, pero NO el de cambiar el correo. Datos ficticios; nada se manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCode } from "../dist/store/codes.js";

test("el código para cambiar el correo se clasifica aparte", () => {
  assert.equal(classifyCode("Netflix: código para cambiar tu correo electrónico", ""), "cambio_correo");
  assert.equal(classifyCode("Netflix: change your email", ""), "cambio_correo");
});

test("hogar, inicio de sesión y acceso temporal no se confunden con cambio de correo", () => {
  assert.equal(classifyCode("Netflix: actualiza tu hogar", ""), "hogar");
  assert.equal(classifyCode("Netflix: código de inicio de sesión", ""), "login");
  assert.equal(classifyCode("Netflix: código de acceso temporal", ""), "temporal");
});
