// Cliente de la API pública del paciente. No comparte nada con la sesión del personal:
// cookie propia (psid, solo /api/public) y cabecera X-Portal en las escrituras.
export class PortalError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
  /** Errores por campo devueltos por el servidor: { campo: mensaje }. */
  fields(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details) if (d?.path && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

async function request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, credentials: "same-origin",
      headers: method === "POST" ? { "content-type": "application/json", "x-portal": "1" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new PortalError(0, "network", "No hay conexión. Revisa tu señal e intenta de nuevo; no se perdió lo que escribiste.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new PortalError(res.status, e.code ?? "error", e.message ?? "No se pudo completar. Intenta de nuevo.", e.details);
  }
  return data as T;
}

export const papi = (slug: string) => {
  const base = `/api/public/c/${encodeURIComponent(slug)}`;
  return {
    base,
    get: <T = any>(path: string) => request<T>("GET", base + path),
    post: <T = any>(path: string, body?: unknown) => request<T>("POST", base + path, body),
  };
};

export const qs = (o: Record<string, string | number | undefined | null>) =>
  "?" + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export interface Branch { id: string; name: string; address: string | null; city: string | null; phone: string | null; mode: "instant" | "request"; whatsapp: string | null; mapUrl: string; whatsappUrl: string | null }
export interface Service { id: string; name: string; category: string; durationMin: number; priceFromCents: number | null }
export interface Session { patient: { id: string; firstName: string; lastName: string } | null; family: { id: string; firstName: string; lastName: string; isMinor: boolean; isSelf: boolean; consentReminders: boolean; consentMarketing: boolean }[]; phoneMasked: string }
export interface Info {
  clinic: { name: string; slug: string };
  rules: { leadTimeHours: number; maxDaysAhead: number; changeWindowHours: number; firstDay: string; lastDay: string; holdMinutes: number };
  instructions: string | null; cancellationPolicy: string; paymentNote: string;
  branches: Branch[]; services: Service[]; session: Session | null;
}
