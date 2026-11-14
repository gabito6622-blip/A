// Aviso temprano de los módulos JS que la página va a necesitar (14/11/2026).
//
// Por qué: el navegador recién descubre los módulos que importa shop.js cuando terminó de bajar shop.js
// (~95 KB comprimidos): en 4G lento eso es una espera en cadena. Con <link rel="modulepreload"> en el HTML los
// pide todos juntos desde el principio. La lista se arma leyendo los `import … from "/x.js"` de verdad (no a mano),
// así no queda vieja cuando alguien agrega o saca un módulo.
//  - Tienda y página /r/<slug>: shop.js y sus módulos fijos (sin el panel del revendedor).
//  - GaboHub: además los módulos del panel (hub-perezoso.js → MODULOS_HUB), que ahí sí se usan siempre.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ModoPagina = "store" | "hub" | "rshop";

const IMPORT_FIJO = /^\s*import\s+(?:[^"';]*?\s+from\s+)?"(\/[a-z0-9_-]+\.js)"/gim;

export function createPrecarga(staticDir: string): (modo: ModoPagina) => string {
  let cache: { firma: string; tags: Record<ModoPagina, string> } | null = null;
  const leer = (url: string) => { const f = join(staticDir, url); return existsSync(f) ? readFileSync(f, "utf8") : ""; };
  /** Módulos que `entrada` importa de forma fija, recorriendo todo el árbol (sin los import() a demanda). */
  function arbol(entradas: string[]): string[] {
    const vistos = new Set<string>(), cola = [...entradas];
    while (cola.length) {
      const u = cola.shift()!;
      if (vistos.has(u)) continue;
      vistos.add(u);
      for (const m of leer(u).matchAll(IMPORT_FIJO)) cola.push(m[1]);
    }
    return [...vistos];
  }
  function armar(): Record<ModoPagina, string> {
    const tienda = arbol(["/shop.js"]).filter((u) => u !== "/shop.js");
    const hubMods = [...leer("/hub-perezoso.js").matchAll(/MODULOS_HUB\s*=\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"(\/[a-z0-9_-]+\.js)"/g)].map((x) => x[1]));
    const hub = [...new Set([...tienda, ...arbol(hubMods)])].filter((u) => u !== "/shop.js");
    const tags = (l: string[]) => l.filter((u) => existsSync(join(staticDir, u))).map((u) => `<link rel="modulepreload" href="${u}">`).join("\n");
    return { store: tags(tienda), rshop: tags(tienda), hub: tags(hub) };
  }
  return (modo) => {
    try {
      // Se rearma solo si cambió algún archivo de la carpeta (fecha de shop.js y de hub-perezoso.js alcanza en la práctica).
      const firma = ["/shop.js", "/hub-perezoso.js"].map((u) => { try { return statSync(join(staticDir, u)).mtimeMs; } catch { return 0; } }).join("|");
      if (!cache || cache.firma !== firma) cache = { firma, tags: armar() };
      return cache.tags[modo];
    } catch {
      return ""; // sin aviso: la página anda igual, solo un poco más lenta
    }
  };
}
