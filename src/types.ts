// Tipos del SDK.
//
// Procedencia: el contrato de AUTENTICACIÓN está confirmado por decompilación del
// handler del front (login/logout/checkAuth). El resto de las formas de
// request/response NO fueron observadas: son genéricas. Pasá tu propio tipo con
// los genéricos `<T>` donde quieras precisión.

export type Id = string;
export type Query = Record<string, unknown>;
export type Body = Record<string, unknown>;

/** El backend envuelve respuestas como `{ data: ... }` (observado). */
export interface Envelope<T = unknown> {
  data?: T;
  [k: string]: unknown;
}

/**
 * Credenciales de login. Confirmado por DOM en vivo + bundle: el formulario envía
 * `{ accountCode, username, password }` a `POST /auth/login`, donde `accountCode`
 * va prefijado con `ACC-` (el usuario tipea solo el número, p. ej. "12345" → "ACC-12345").
 * El SDK agrega el prefijo `ACC-` automáticamente si no está presente.
 */
export interface LoginCredentials {
  /** Número de cuenta (con o sin prefijo `ACC-`). */
  accountCode: string;
  username: string;
  password: string;
  [k: string]: unknown;
}

/**
 * Contenido de `data.data` en la respuesta de `/auth/login` (confirmado):
 * `accessToken` + `user`. No se observó `refreshToken` en el login.
 */
export interface LoginData<User = unknown> {
  accessToken: string;
  user?: User;
  [k: string]: unknown;
}
