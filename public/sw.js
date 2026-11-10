// Avisos al celular del panel. El servidor manda un "toque" sin contenido; acá pedimos el texto
// al panel (con la sesión del usuario) y mostramos la notificación. No guarda nada en caché.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener("push", (ev) => {
  ev.waitUntil((async () => {
    let m = { title: "Tenés avisos en el panel", body: "Tocá para verlos.", go: "notificaciones" };
    try {
      const r = await fetch("/api/admin/push/latest", { credentials: "same-origin", cache: "no-store" });
      if (r.ok) m = { ...m, ...(await r.json()) };
    } catch { /* sin conexión o sesión vencida: mostramos el aviso genérico */ }
    await self.registration.showNotification(m.title, {
      body: m.body, icon: "/panel-icon-192.png", badge: "/panel-icon-192.png", tag: "panel-aviso", renotify: true,
      lang: "es-BO", data: { url: `/panel.html#${encodeURIComponent(m.go || "notificaciones")}` },
    });
  })());
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const url = new URL(ev.notification.data?.url || "/panel.html", self.location.origin).href;
  ev.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const panel = all.find((c) => new URL(c.url).pathname.startsWith("/panel"));
    if (panel) { await panel.focus(); return panel.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
