// Pide los datos de la tienda apenas se abre la página, en paralelo con el JS (14/11/2026).
// Antes, en un celular con 4G lento, el catálogo recién se pedía a los ~2 s: después de bajar y ejecutar todo shop.js.
// common.js (api) usa estas respuestas UNA sola vez, en la primera carga; si algo cambia la sesión (entrar, salir,
// cualquier POST) se descartan. Con un link de acceso o de renovación (#acceso= / #renovar=) no se adelanta nada:
// ese link primero entra o renueva, y recién después se piden los datos de esa sesión.
(() => {
  try {
    if (window.__gsTempranoTarde || /^#(acceso|renovar)=/.test(location.hash)) return;
    const p = location.pathname;
    const slug = (p.match(/^\/r\/([a-z0-9-]{3,30})\/?$/i)?.[1] ?? (p === "/" ? document.querySelector('meta[name="gs-shop"]')?.content : null) ?? "").toLowerCase();
    const urls = slug ? [`/api/shops/${slug}`] : ["/api/settings", "/api/me", "/api/catalog"];
    const at = Date.now(), pre = {};
    for (const u of urls) {
      pre[u] = { at, p: fetch(u, { credentials: "same-origin" }).then(async (r) => (r.ok ? { data: await r.json() } : null)).catch(() => null) };
    }
    window.__gsTemprano = pre;
  } catch { /* navegador viejo: shop.js pide todo como siempre */ }
})();
