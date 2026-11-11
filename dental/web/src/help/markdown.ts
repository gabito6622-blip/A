// Convertidor mínimo de Markdown a HTML para los manuales por puesto (docs/manuales/*.md).
// Seguro por construcción: TODO el texto se escapa primero y solo se generan etiquetas de una
// lista cerrada. No acepta HTML crudo, ni enlaces externos, ni imágenes fuera de «capturas/».
// Subconjunto admitido: títulos (#, ##, ###, ####), párrafos, listas numeradas y con viñetas
// (con líneas de continuación sangradas), citas (>), tablas simples con |, línea horizontal (---),
// **negrita**, *cursiva*, `código`, [enlace](destino), ![imagen](capturas/x.jpg) en su propia
// línea y los espacios «[La clínica completa: …]», que se resaltan para que la clínica los llene.

export interface MdOptions {
  /** Devuelve la URL servida de una captura («capturas/x.jpg») o null si no existe. */
  resolveImage?: (src: string) => string | null;
  /** Traduce un enlace permitido (otro manual «x.md», ruta interna «/agenda» o ancla «#id»). */
  resolveLink?: (href: string) => string | null;
}

export interface MdHeading { level: number; id: string; text: string }
export interface MdResult { html: string; title: string; headings: MdHeading[] }

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

export function slugify(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[«»"'`*_¿?¡!.,:;()[\]/]/g, "").trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").slice(0, 60) || "seccion";
}

const SAFE_HREF = /^(#[a-z0-9-]+|\/[a-z0-9\-/]*(\?[a-z0-9=&-]*)?|[a-z0-9-]+\.md(#[a-z0-9-]+)?)$/i;
const SAFE_IMG = /^capturas\/[a-z0-9-]+\.(jpg|jpeg|png)$/i;

/** Formato en línea sobre texto SIN escapar: escapa y aplica el subconjunto admitido. */
export function inline(raw: string, opts: MdOptions = {}): string {
  // 1) Los fragmentos `código` se protegen antes de cualquier otra transformación.
  const codes: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${escapeHtml(c)}</code>`) - 1}\u0000`);
  // 2) Enlaces e imágenes: se resuelven sobre el texto original y se guardan como fichas.
  const tokens: string[] = [];
  const keep = (html: string) => `\u0001${tokens.push(html) - 1}\u0001`;
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => {
    const url = SAFE_IMG.test(src) ? opts.resolveImage?.(src) ?? null : null;
    return url ? keep(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`) : keep(`<span class="mn-missing">[Falta la captura: ${escapeHtml(alt)}]</span>`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => {
    const to = SAFE_HREF.test(href) ? (opts.resolveLink ? opts.resolveLink(href) : href) : null;
    const label = inline(text, { ...opts, resolveLink: undefined });
    return to ? keep(`<a href="${escapeHtml(to)}">${label}</a>`) : keep(label);
  });
  // 3) Escape del resto y formato simple.
  s = escapeHtml(s)
    .replace(/\[La clínica completa:([^\]]*)\]/g, (_, t: string) => `<mark class="mn-fill">[La clínica completa:${t}]</mark>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  return s.replace(/\u0001(\d+)\u0001/g, (_, i: string) => tokens[Number(i)]!).replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]!);
}

/** Texto plano de una línea con formato (para títulos e índice). */
const plain = (s: string) => s.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

export function renderMarkdown(src: string, opts: MdOptions = {}): MdResult {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const headings: MdHeading[] = [];
  const used = new Set<string>();
  let title = "";
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[]; start: number } | null = null;
  let quote: string[] | null = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "), opts)}</p>`); para = []; } };
  const flushList = () => {
    if (!list) return;
    const start = list.type === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
    out.push(`<${list.type}${start}>${list.items.map((i) => `<li>${inline(i, opts)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => { if (quote) { out.push(`<blockquote><p>${inline(quote.join(" "), opts)}</p></blockquote>`); quote = null; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) { flushAll(); continue; }
    // Comentarios HTML (notas para quien edita): se omiten.
    if (t.startsWith("<!--")) { while (i < lines.length && !lines[i]!.includes("-->")) i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(#{1,4})\s+(.+)$/))) {
      flushAll();
      const level = m[1]!.length;
      const text = plain(m[2]!);
      let id = slugify(text);
      for (let n = 2; used.has(id); n++) id = `${slugify(text)}-${n}`;
      used.add(id);
      if (level === 1 && !title) title = text;
      if (level === 2) headings.push({ level, id, text });
      out.push(`<h${level} id="${id}">${inline(m[2]!, opts)}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flushAll(); out.push("<hr>"); continue; }
    if ((m = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
      flushAll();
      out.push(`<figure>${inline(t, opts)}${m[1] ? `<figcaption>${inline(m[1], opts)}</figcaption>` : ""}</figure>`);
      continue;
    }
    if (t.startsWith(">")) { flushPara(); flushList(); (quote ??= []).push(t.replace(/^>\s?/, "")); continue; }
    if (t.startsWith("|")) {
      flushAll();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith("|"); i++) {
        rows.push(lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      }
      i--;
      const sep = rows[1]?.every((c) => /^:?-{2,}:?$/.test(c));
      const head = sep ? rows[0]! : null;
      const body = sep ? rows.slice(2) : rows;
      out.push(`<div class="mn-table"><table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join("")}</tr></thead>` : ""}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if ((m = line.match(/^\s{0,3}(?:([-*])|(\d+)\.)\s+(.*)$/))) {
      flushPara(); flushQuote();
      const type = m[1] ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [], start: m[2] ? Number(m[2]) : 1 }; }
      list.items.push(m[3]!);
      continue;
    }
    // Línea sangrada después de un ítem: continuación del mismo ítem.
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${t}`; continue; }
    if (quote) { quote.push(t); continue; }
    flushList();
    para.push(t);
  }
  flushAll();
  return { html: out.join("\n"), title, headings };
}
