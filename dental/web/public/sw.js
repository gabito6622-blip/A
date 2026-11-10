/* Dentalia: service worker mínimo para instalar la app.
 * Privacidad: NUNCA guarda respuestas de /api/ (datos de pacientes) ni documentos.
 * Solo guarda la "cáscara" de la aplicación (HTML, JS, CSS, fuentes e íconos) para abrir rápido
 * y mostrar un aviso claro cuando no hay conexión. */
const CACHE = "dentalia-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => url.pathname.startsWith("/assets/") || /\.(png|svg|woff2?|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Datos y documentos: siempre a la red, nunca al caché.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Red primero: la app siempre se abre actualizada; sin conexión, la última cáscara guardada.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); }
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  if (isStatic(url)) {
    // Los archivos de /assets/ llevan hash en el nombre: se pueden guardar sin riesgo de quedar viejos.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
