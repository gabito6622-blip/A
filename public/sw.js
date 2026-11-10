// Avisos al celular (panel y panel de clientes/revendedores). El servidor manda un "toque" sin contenido; acá pedimos el texto
// al panel (con la sesión del usuario) y mostramos la notificación. No guarda nada en caché.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener("push", (ev) => {
  ev.waitUntil((async () => {
    // El mismo celular puede ser del panel (dueño/equipo) o de un cliente/revendedor: pedimos los dos y mostramos el más nuevo.
    const get = async (u) => { try { const r = await fetch(u, { credentials: "same-origin", cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; } };
    const [adm, me] = await Promise.all([get("/api/admin/push/latest"), get("/api/me/push/latest")]);
    let m = { title: "Tenés avisos", body: "Tocá para verlos.", url: "/" , at: 0 };
    if (adm) m = { title: adm.title, body: adm.body, url: `/panel.html#${encodeURIComponent(adm.go || "notificaciones")}`, at: adm.at || 0 };
    if (me && (me.at || 0) > m.at) m = { title: me.title, body: me.body, url: me.url || "/", at: me.at };
    if (!adm && !me) m.url = "/";
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
    const isPanel = new URL(url).pathname.startsWith("/panel");
    const win = all.find((c) => new URL(c.url).pathname.startsWith("/panel") === isPanel);
    if (win) { await win.focus(); return win.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
