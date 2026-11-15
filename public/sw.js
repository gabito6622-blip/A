// Avisos al celular (panel y panel de clientes/revendedores). El servidor manda un "toque" sin contenido; acá pedimos el texto
// al panel (con la sesión del usuario) y mostramos la notificación. No guarda nada en caché.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener("push", (ev) => {
  ev.waitUntil((async () => {
    // El mismo celular puede ser del panel (dueño/equipo) o de un cliente/revendedor: pedimos los dos y mostramos el más nuevo.
    const get = async (u) => { try { const r = await fetch(u, { credentials: "same-origin", cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; } };
    // Avisos de vencimiento por link de cobro (/c/<token>): sin sesión, se piden con el endpoint de este celular.
    const link = async () => { try {
      const sub = await self.registration.pushManager.getSubscription();
      if (!sub) return null;
      const r = await fetch("/api/cobro-push/latest", { method: "POST", credentials: "omit", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      return r.ok ? await r.json() : null;
    } catch { return null; } };
    const [adm, me, tk] = await Promise.all([get("/api/admin/push/latest"), get("/api/me/push/latest"), link()]);
    let m = { title: "Tenés avisos", body: "Tocá para verlos.", url: "/" , at: 0 };
    if (adm) m = { title: adm.title, body: adm.body, url: `/panel.html#${encodeURIComponent(adm.go || "notificaciones")}`, at: adm.at || 0 };
    if (me && (me.at || 0) > m.at) m = { title: me.title, body: me.body, url: me.url || "/hub", at: me.at };
    if (tk && (tk.at || 0) > m.at) m = { title: tk.title, body: tk.body, url: tk.url || "/", at: tk.at };
    if (!adm && !me && !(tk && tk.at)) m.url = tk?.url || "/";
    const panel = m.url.startsWith("/panel");
    await self.registration.showNotification(m.title, {
      body: m.body, icon: panel ? "/panel-icon-192.png" : "/app-icon-192.png", badge: "/panel-icon-192.png", tag: panel ? "panel-aviso" : "app-aviso", renotify: true,
      lang: "es-BO", data: { url: m.url },
    });
  })());
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const url = new URL(ev.notification.data?.url || "/panel.html", self.location.origin).href;
  ev.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const u = new URL(url);
    // WhatsApp del revendedor (afuera) o un link de cobro: se abre aparte, sin tocar otra pestaña de la tienda.
    if (u.origin !== self.location.origin || u.pathname.startsWith("/c/")) {
      const same = all.find((c) => c.url === url);
      return same ? same.focus() : self.clients.openWindow(url);
    }
    const isPanel = u.pathname.startsWith("/panel");
    const win = all.find((c) => new URL(c.url).pathname.startsWith("/panel") === isPanel);
    if (win) { await win.focus(); return win.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});

// 📗 «Mis hojas» sin internet (15/11/2026): los ARCHIVOS del panel (pantalla, código, estilos e íconos; nunca /api ni
// datos) quedan guardados en el aparato para poder abrirlo sin señal. Siempre se pide primero a internet (así cada
// publicación se ve al toque); la copia guardada se usa solo si no hay respuesta.
const PANEL_CACHE = "gs-panel-v1";
const STATIC = /\.(?:js|css|svg|png|webp|ico|webmanifest|woff2?)$/i;
const panelPage = (u) => u.pathname === "/panel" || u.pathname.startsWith("/panel.") || u.pathname.startsWith("/panel/");
async function netFirst(req, fallbackPage) {
  const cache = await caches.open(PANEL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (fallbackPage && ((await cache.match("/panel.html")) || (await cache.match("/panel"))));
    if (hit) return hit;
    throw err;
  }
}
self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") { if (panelPage(u)) ev.respondWith(netFirst(req, true)); return; }
  if (STATIC.test(u.pathname)) ev.respondWith(netFirst(req, false));
});
// El panel avisa qué archivos ya cargó (la primera vez todavía no pasaban por acá) para guardarlos.
self.addEventListener("message", (ev) => {
  if (ev.data?.type !== "gs-guardar" || !Array.isArray(ev.data.urls)) return;
  ev.waitUntil((async () => {
    const cache = await caches.open(PANEL_CACHE);
    for (const raw of ev.data.urls.slice(0, 300)) {
      try {
        const u = new URL(raw, self.location.origin);
        if (u.origin !== self.location.origin || u.pathname.startsWith("/api/") || !(STATIC.test(u.pathname) || panelPage(u))) continue;
        const res = await fetch(u.pathname + u.search, { credentials: "same-origin" });
        if (res.ok && res.type === "basic") await cache.put(u.pathname + u.search, res);
      } catch { /* sin señal: se guarda la próxima vez */ }
    }
  })());
});
