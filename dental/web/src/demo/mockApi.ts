// Modo demo (solo en `vite build --mode demo`): la interfaz real de Dentalia sin servidor.
// Reemplaza window.fetch para /api/* y responde con datos GRABADOS de la clínica ficticia
// («Sonrisa Andina», semilla de server/src/cli/seed.ts). Nada se guarda: cualquier escritura
// responde con un aviso. Los datos los genera scripts/demo-fixtures.cjs y viajan junto a la página.

type Fixtures = { accounts: Record<string, { me: unknown }>; responses: Record<string, Record<string, unknown>> };

export const DEMO_PASSWORD = "Demo2026dental";
const READ_ONLY = "Esta es una demo con datos inventados: no se guardan cambios.";

let fx: Fixtures | null = null;
let current: string | null = null; // correo de la cuenta demo activa

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } });

function lookup(url: string): unknown | undefined {
  if (!fx || !current) return undefined;
  const mine = fx.responses[current] ?? {};
  const others = Object.entries(fx.responses).filter(([k]) => k !== current).map(([, v]) => v);
  for (const table of [mine, ...others]) if (url in table) return table[url];
  // Otra fecha u otro filtro que no se grabó: se muestra lo grabado para esa misma pantalla.
  const path = url.split("?")[0]!;
  for (const table of [mine, ...others]) {
    const k = Object.keys(table).find((x) => x.split("?")[0] === path);
    if (k) return table[k];
  }
  return undefined;
}

export async function installDemoApi(fixturesUrl: string) {
  fx = await (await fetch(fixturesUrl)).json();
  try { current = sessionStorage.getItem("demo.account"); } catch { current = null; }
  if (current && !fx!.accounts[current]) current = null;
  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, location.href);
    const idx = u.pathname.indexOf("/api/");
    if (idx < 0) return real(input as RequestInfo, init);
    const url = u.pathname.slice(idx) + u.search;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url === "/api/auth/login" && method === "POST") {
      const b = JSON.parse(String(init?.body ?? "{}"));
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!fx!.accounts[email] || b.password !== DEMO_PASSWORD) return err(401, "invalid_credentials", "Correo o contraseña incorrectos. Usa una de las cuentas demo que se muestran abajo.");
      current = email;
      try { sessionStorage.setItem("demo.account", email); } catch { /* sin almacenamiento */ }
      return json(200, { ok: true });
    }
    if (url === "/api/auth/logout") {
      current = null;
      try { sessionStorage.removeItem("demo.account"); } catch { /* sin almacenamiento */ }
      return json(200, { ok: true });
    }
    if (url.startsWith("/api/auth/me")) {
      return current ? json(200, fx!.accounts[current]!.me) : err(401, "unauthenticated", "Inicia sesión");
    }
    if (!current) return err(401, "unauthenticated", "Inicia sesión");
    if (method !== "GET") return err(409, "demo_read_only", READ_ONLY);
    const data = lookup(url);
    if (data === undefined) return err(404, "demo_not_recorded", "Esta vista no tiene datos en la demo.");
    return json(200, data);
  };
}

export const DEMO_ACCOUNTS = [
  { email: "propietaria@demo.local", label: "Propietaria (gestión y reportes)" },
  { email: "dr.mendoza@demo.local", label: "Odontólogo (fichas, odontograma, recetas)" },
  { email: "recepcion.lpz@demo.local", label: "Recepción (agenda y caja)" },
];
