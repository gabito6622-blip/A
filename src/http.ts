// Núcleo HTTP del SDK de VendePlay (reverse-engineered).
// Sin dependencias: usa el `fetch` global (Node >=18 / navegador).

export const DEFAULT_BASE_URL =
  "https://api.vendeplay.com/streaming-head-seller/v1";

/** Abstracción de almacenamiento de tokens (sync u async). */
export interface TokenStore {
  getAccess(): string | null | Promise<string | null>;
  setAccess(token: string | null): void | Promise<void>;
  getRefresh(): string | null | Promise<string | null>;
  setRefresh(token: string | null): void | Promise<void>;
  clear(): void | Promise<void>;
}

/** Store en memoria (default, válido en cualquier runtime). */
export class MemoryTokenStore implements TokenStore {
  private access: string | null = null;
  private refresh: string | null = null;
  getAccess() { return this.access; }
  setAccess(t: string | null) { this.access = t; }
  getRefresh() { return this.refresh; }
  setRefresh(t: string | null) { this.refresh = t; }
  clear() { this.access = null; this.refresh = null; }
}

/**
 * Store sobre localStorage (navegador). Usa por defecto la misma clave que el
 * front oficial: `auth_token` para el access token.
 */
export function localStorageTokenStore(
  accessKey = "auth_token",
  refreshKey = "refresh_token",
): TokenStore {
  const ls = (globalThis as any).localStorage as Storage | undefined;
  if (!ls) throw new Error("localStorage no disponible en este runtime");
  return {
    getAccess: () => ls.getItem(accessKey),
    setAccess: (t) => (t == null ? ls.removeItem(accessKey) : ls.setItem(accessKey, t)),
    getRefresh: () => ls.getItem(refreshKey),
    setRefresh: (t) => (t == null ? ls.removeItem(refreshKey) : ls.setItem(refreshKey, t)),
    clear: () => { ls.removeItem(accessKey); ls.removeItem(refreshKey); },
  };
}

export interface HttpOptions {
  baseUrl?: string;
  tokens?: TokenStore;
  /** fetch alternativo (p. ej. para tests o proxys). */
  fetchImpl?: typeof fetch;
  /** Se llama cuando el refresh falla y la sesión queda inválida. */
  onUnauthorized?: () => void;
  /** Headers extra aplicados a todas las requests. */
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  headers?: Record<string, string>;
  /** Adjuntar Authorization: Bearer. Default true. */
  auth?: boolean;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export class Http {
  readonly baseUrl: string;
  readonly tokens: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly onUnauthorized?: () => void;
  private readonly defaultHeaders: Record<string, string>;
  private refreshing: Promise<boolean> | null = null;

  constructor(opts: HttpOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.tokens = opts.tokens ?? new MemoryTokenStore();
    const f = opts.fetchImpl ?? (globalThis as any).fetch;
    if (!f) throw new Error("No hay `fetch` disponible; pasá fetchImpl.");
    this.fetchImpl = f.bind(globalThis);
    this.onUnauthorized = opts.onUnauthorized;
    this.defaultHeaders = opts.defaultHeaders ?? {};
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : "/" + path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const doFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...this.defaultHeaders,
        ...(opts.headers ?? {}),
      };
      let payload: BodyInit | undefined;
      if (opts.body !== undefined) {
        if (opts.body instanceof FormData || typeof opts.body === "string") {
          payload = opts.body as BodyInit;
        } else {
          headers["Content-Type"] = "application/json";
          payload = JSON.stringify(opts.body);
        }
      }
      if (opts.auth !== false) {
        const access = await this.tokens.getAccess();
        if (access) headers.Authorization = `Bearer ${access}`;
      }
      return this.fetchImpl(this.buildUrl(path, opts.query), {
        method,
        headers,
        body: payload,
        signal: opts.signal,
      });
    };

    let res = await doFetch();

    // 401 -> intentar refresh una vez y reintentar.
    if (res.status === 401 && opts.auth !== false) {
      const ok = await this.tryRefresh();
      if (ok) res = await doFetch();
    }

    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown = text;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json") && text) {
      try { data = JSON.parse(text); } catch { /* deja texto */ }
    }
    if (!res.ok) {
      if (res.status === 401) this.onUnauthorized?.();
      throw new HttpError(res.status, `${res.status} ${res.statusText} en ${res.url}`, data);
    }
    return data as T;
  }

  /** Renueva el access token vía POST /auth/refresh. Dedupe concurrente. */
  async tryRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const refresh = await this.tokens.getRefresh();
        const res = await this.fetchImpl(this.buildUrl("/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(refresh ? { refreshToken: refresh } : {}),
        });
        if (!res.ok) { await this.tokens.clear(); this.onUnauthorized?.(); return false; }
        const json: any = await res.json().catch(() => ({}));
        const d = json?.data ?? json;
        const access = d?.accessToken ?? d?.token ?? null;
        const newRefresh = d?.refreshToken ?? null;
        if (access) await this.tokens.setAccess(access);
        if (newRefresh) await this.tokens.setRefresh(newRefresh);
        return Boolean(access);
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  get<T = unknown>(path: string, query?: Record<string, unknown>, o: RequestOptions = {}) {
    return this.request<T>("GET", path, { ...o, query });
  }
  post<T = unknown>(path: string, body?: unknown, o: RequestOptions = {}) {
    return this.request<T>("POST", path, { ...o, body });
  }
  put<T = unknown>(path: string, body?: unknown, o: RequestOptions = {}) {
    return this.request<T>("PUT", path, { ...o, body });
  }
  patch<T = unknown>(path: string, body?: unknown, o: RequestOptions = {}) {
    return this.request<T>("PATCH", path, { ...o, body });
  }
  delete<T = unknown>(path: string, o: RequestOptions = {}) {
    return this.request<T>("DELETE", path, o);
  }
}
