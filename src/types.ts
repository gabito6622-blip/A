// Tipos del SDK. NOTA: las formas de request/response NO fueron observadas en
// ejecución (solo rutas, verbos y auth por análisis estático). Por eso los
// cuerpos son genéricos; pasá tu propio tipo con los genéricos `<T>` donde quieras.

export type Id = string;
export type Query = Record<string, unknown>;
export type Body = Record<string, unknown>;

/** El front envuelve respuestas como `{ data: ... }` (observado en el login). */
export interface Envelope<T = unknown> {
  data?: T;
  [k: string]: unknown;
}

export interface LoginResult {
  accessToken: string;
  refreshToken?: string;
  [k: string]: unknown;
}
