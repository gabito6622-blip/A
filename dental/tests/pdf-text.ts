// Extractor de texto mínimo para los PDF que genera pdfkit (fuentes CID Identity-H con
// ToUnicode). Sirve para comprobar en las pruebas que el texto (con tildes y ñ) está en el PDF.
import { inflateSync } from "node:zlib";

interface Obj { dict: string; stream: Buffer | null }

function parseObjects(pdf: Buffer): Map<number, Obj> {
  const s = pdf.toString("latin1");
  const out = new Map<number, Obj>();
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    const body = s.slice(start, end);
    const si = body.indexOf("stream");
    let dict = body, stream: Buffer | null = null;
    if (si >= 0 && body.slice(0, si).includes("/Length")) {
      dict = body.slice(0, si);
      const len = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      let off = start + si + "stream".length;
      if (s[off] === "\r") off++;
      if (s[off] === "\n") off++;
      const raw = pdf.subarray(off, off + len);
      stream = dict.includes("/FlateDecode") ? inflateSync(raw) : raw;
    }
    out.set(Number(m[1]), { dict, stream });
  }
  return out;
}

function parseCmap(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const hex = (h: string) => { let r = ""; for (let i = 0; i < h.length; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return r; };
  for (const m of text.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
    const start = parseInt(m[1]!, 16);
    const vals = [...m[3]!.matchAll(/<([0-9a-fA-F ]*)>/g)].map((x) => hex(x[1]!.replace(/\s/g, "")));
    vals.forEach((v, k) => map.set(start + k, v));
  }
  return map;
}

/** Texto aproximado de todas las páginas (una línea por cada operación de texto). */
export function pdfText(pdf: Buffer): string {
  const objs = parseObjects(pdf);
  const fontCmap = new Map<number, Map<number, string>>();
  for (const [id, o] of objs) {
    const tu = /\/ToUnicode (\d+) 0 R/.exec(o.dict);
    if (tu) fontCmap.set(id, parseCmap(objs.get(Number(tu[1]))?.stream?.toString("latin1") ?? ""));
  }
  const lines: string[] = [];
  for (const [, o] of objs) {
    if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;
    const resRef = /\/Resources (\d+) 0 R/.exec(o.dict);
    const resDict = resRef ? objs.get(Number(resRef[1]))?.dict ?? "" : o.dict;
    const fontsDict = /\/Font\s*<<([^>]*)>>/.exec(resDict)?.[1] ?? "";
    const names = new Map<string, number>();
    for (const f of fontsDict.matchAll(/\/(\w+) (\d+) 0 R/g)) names.set(f[1]!, Number(f[2]));
    const contents = /\/Contents (\d+) 0 R/.exec(o.dict);
    const cs = contents ? objs.get(Number(contents[1]))?.stream?.toString("latin1") ?? "" : "";
    let cmap: Map<number, string> | undefined;
    for (const tok of cs.matchAll(/\/(\w+) [\d.]+ Tf|\[((?:<[0-9a-fA-F]*>|[^\]])*)\] TJ|<([0-9a-fA-F]*)> Tj/g)) {
      if (tok[1]) { cmap = fontCmap.get(names.get(tok[1]) ?? -1); continue; }
      const parts = tok[2] !== undefined ? [...tok[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]!) : [tok[3]!];
      let line = "";
      for (const h of parts) for (let i = 0; i < h.length; i += 4) line += cmap?.get(parseInt(h.slice(i, i + 4), 16)) ?? "";
      lines.push(line);
    }
  }
  return lines.join("\n");
}
