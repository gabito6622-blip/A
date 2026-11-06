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

/** Credenciales de login. Campos confirmados: email + password. */
export interface LoginCredentials {
  email: string;
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
