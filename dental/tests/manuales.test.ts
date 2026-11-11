// Manuales por puesto (docs/manuales): estructura, capturas, peso y el convertidor seguro de
// Markdown que los muestra dentro de la app.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inline, renderMarkdown } from "../web/src/help/markdown";
import { MANUALS, manualLink, manualsForRole } from "../web/src/help/manuals";

const DIR = join(__dirname, "../docs/manuales");
const SHOTS = join(DIR, "capturas");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const ids = MANUALS.map((m) => m.id);
const images = (md: string) => [...md.matchAll(/!\[[^\]]*\]\((capturas\/[^)]+)\)/g)].map((m) => m[1]!);

describe("convertidor de Markdown de los manuales", () => {
  it("escapa todo el HTML y no deja pasar scripts, atributos ni enlaces peligrosos", () => {
    const { html } = renderMarkdown([
      "# Título <script>alert(1)</script>",
      "Texto <img src=x onerror=alert(1)> y **negrita** con \"comillas\" & más.",
      "[malo](javascript:alert(1)) [externo](https://ejemplo.com) [bueno](caja.md) [ruta](/agenda)",
      "![x](https://ejemplo.com/a.png)",
      "![y\" onerror=\"alert(1)](capturas/ok.jpg)",
      "| a | <b>b</b> |",
      "|---|---|",
      "| `<i>c</i>` | d |",
    ].join("\n"), { resolveImage: (s) => `/assets/${s.split("/")[1]}`, resolveLink: manualLink });
    // Ninguna etiqueta ni atributo peligroso: lo que no es del subconjunto queda como texto escapado.
    expect(html).not.toMatch(/<script|<img src=x|href="(javascript|https?):|<b>|<i>/);
    // Toda etiqueta generada es de la lista cerrada y solo lleva atributos permitidos (las comillas de los valores van escapadas).
    for (const tag of html.match(/<[a-z][^>]*>/g) ?? []) {
      expect(tag).toMatch(/^<(h[1-4]|p|ol|ul|li|strong|em|code|a|img|figure|figcaption|blockquote|hr|div|table|thead|tbody|tr|th|td|span|mark)(\s+(id|class|href|src|alt|loading|decoding|start)="[^"<>]*")*>$/);
    }
    expect(html).not.toContain("https://ejemplo.com");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<strong>negrita</strong>");
    expect(html).toContain('<a href="/ayuda/manual/caja">bueno</a>');
    expect(html).toContain('<a href="/agenda">ruta</a>');
    expect(html).toContain("malo"); // el texto se conserva sin enlace
    expect(html).toContain("[Falta la captura: x]");
    expect(html).toContain('<img src="/assets/ok.jpg" alt="y&quot; onerror=&quot;alert(1)"');
    expect(html).toContain("<code>&lt;i&gt;c&lt;/i&gt;</code>");
  });

  it("arma títulos con ancla e índice, listas, tablas, citas y resalta lo que completa la clínica", () => {
    const r = renderMarkdown("# Manual\n\n## Qué ves al entrar\n\n1. Uno\n   sigue\n2. Dos\n\n- a\n- b\n\n> Ojo\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nHorario: [La clínica completa: horario]\n\n## Qué ves al entrar");
    expect(r.title).toBe("Manual");
    expect(r.headings.map((h) => h.id)).toEqual(["que-ves-al-entrar", "que-ves-al-entrar-2"]);
    expect(r.html).toContain("<ol><li>Uno sigue</li><li>Dos</li></ol>");
    expect(r.html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(r.html).toContain("<blockquote><p>Ojo</p></blockquote>");
    expect(r.html).toContain("<thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>");
    expect(r.html).toContain('<mark class="mn-fill">[La clínica completa: horario]</mark>');
    expect(inline("2 * 3 y *cursiva*")).toBe("2 * 3 y <em>cursiva</em>");
  });

  it("solo enlaza manuales que existen", () => {
    expect(manualLink("chuleta-caja.md")).toBe("/ayuda/manual/caja/hoja");
    expect(manualLink("gerencia.md#anular")).toBe("/ayuda/manual/gerencia#anular");
    expect(manualLink("otro.md")).toBeNull();
  });
});

describe("manuales por puesto", () => {
  it("cada rol tiene su manual primero y cada manual existe con su hoja de una página", () => {
    expect(manualsForRole("owner")[0]!.id).toBe("propietaria");
    expect(manualsForRole("admin")[0]!.id).toBe("gerencia");
    expect(manualsForRole("receptionist").map((m) => m.id)).toEqual(["recepcion", "caja", "portal-paciente"]);
    expect(manualsForRole("dentist")[0]!.id).toBe("odontologo");
    expect(manualsForRole("assistant")[0]!.id).toBe("asistente");
    expect(manualsForRole("accountant")[0]!.id).toBe("contabilidad");
    expect(manualsForRole("support").map((m) => m.id)).toEqual(["limpieza"]);
    for (const id of ids) {
      expect(read(`${id}.md`).startsWith("# ")).toBe(true);
      expect(read(`chuleta-${id}.md`).startsWith("# ")).toBe(true);
    }
  });

  it("los manuales del personal tienen las secciones pedidas y de 5 a 10 tareas", () => {
    for (const id of ids.filter((x) => x !== "portal-paciente")) {
      const md = read(`${id}.md`);
      for (const s of ["## Qué ves al entrar", "## Tu día a día", "## Si algo sale mal", "## Lo que no puedes hacer en el sistema"]) expect(md, `${id}: ${s}`).toContain(s);
      const tasks = md.match(/^### \d+\./gm) ?? [];
      expect(tasks.length, `${id}: tareas`).toBeGreaterThanOrEqual(5);
      expect(tasks.length, `${id}: tareas`).toBeLessThanOrEqual(10);
    }
  });

  it("toda captura citada existe, toda captura se usa y la carpeta pesa menos de 8 MB", () => {
    const files = readdirSync(SHOTS);
    const used = new Set<string>();
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
      for (const src of images(read(f))) {
        expect(files, `${f} cita ${src}`).toContain(src.slice("capturas/".length));
        used.add(src.slice("capturas/".length));
      }
    }
    const unused = files.filter((f) => !used.has(f));
    expect(unused).toEqual([]);
    expect(files.every((f) => /^[a-z0-9-]+\.jpg$/.test(f))).toBe(true);
    const bytes = files.reduce((s, f) => s + statSync(join(SHOTS, f)).size, 0);
    expect(bytes).toBeLessThan(8_000_000); // menos de 8 MB (8 000 000 bytes)
  });

  it("no hacen afirmaciones legales y dejan a la clínica lo que depende de ella", () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
      const md = read(f);
      expect(md, f).not.toMatch(/validez legal|legalmente|tiene(n)? valor legal|cumple (con )?la (ley|norma)/i);
      for (const m of md.matchAll(/\[La clínica[^\]]*\]/g)) expect(m[0], f).toMatch(/^\[La clínica completa(: [^\]]+)?\]$/);
    }
  });
});
