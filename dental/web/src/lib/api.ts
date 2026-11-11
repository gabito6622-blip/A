// Cliente de la API: cookie de sesión + cabecera CSRF en operaciones que modifican datos.
let csrf = "";
export const setCsrf = (t: string) => { csrf = t; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (method !== "GET") {
    init.headers = { "content-type": "application/json", "x-csrf-token": csrf };
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    if (res.status === 401 && e.code === "unauthenticated") window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Error de conexión", e.details);
  }
  // Aviso para quien muestra contadores (p. ej. tareas pendientes del menú): hubo una escritura.
  if (method !== "GET") window.dispatchEvent(new CustomEvent("api-write", { detail: url }));
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>("GET", url),
  post: <T = any>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T = any>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T = any>(url: string, body?: unknown) => request<T>("PATCH", url, body),
};

export const qs = (o: Record<string, string | number | undefined | null | false>) =>
  "?" + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
