// Banco de pruebas de la oficina virtual (los casos están en src/server/agent-bank.ts; el panel tiene el
// mismo banco en el botón "Probar la oficina").
//
// Modo simulado (por defecto, gratis): una "API de Claude" falsa responde lo esperado. Prueba que todo está
// bien conectado y que las comparaciones del sistema (monto, número de operación, reglas de correos) andan.
// NO mide qué tan bien responde Claude.
//
// Modo real (cuesta centavos): usa Claude de verdad con tu clave, y también prueba los 12 comprobantes
// (los dibuja como imagen con Playwright).
//   ANTHROPIC_API_KEY=... node scripts/evaluar-agentes.mjs --real --modelo=claude-haiku-5-5 --tope=2
// Opciones: --salida=carpeta  --modelo=<id>  --tope=<US$ máximo>
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const dist = (p) => import(pathToFileURL(join(HERE, "..", "dist", "server", p)).href);

/** Dibuja los comprobantes de prueba como PNG (Playwright viene en el entorno). */
async function renderReceipts(casos) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 420, height: 620 } });
  const out = {};
  for (const c of casos) {
    const html = c.noComprobante
      ? `<div style="font:20px sans-serif;padding:40px;background:#fde;height:540px"><h1>¡Promo Netflix!</h1><p>Captura de una publicación con un meme de una película.</p></div>`
      : `<div style="font:16px Arial;padding:28px;background:#fff;color:#123;height:560px;${c.borroso ? "filter:blur(3px)" : ""}">
          <div style="background:#0a5;color:#fff;padding:14px;border-radius:10px;font-weight:700">${c.banco} · Transferencia exitosa</div>
          <p style="margin-top:24px;color:#555">Monto</p><p style="font-size:34px;font-weight:800;margin:0;${c.editado ? "font-family:'Times New Roman';color:#333;transform:translateY(5px) rotate(-1.5deg);letter-spacing:3px" : ""}">${c.monto}</p>
          <p style="color:#555;margin-top:20px">Destinatario</p><p style="margin:0;font-weight:700">${c.destino}</p>
          <p style="color:#555;margin-top:20px">Nro. de operación</p><p style="margin:0;font-weight:700">${c.ref}</p>
          <p style="color:#555;margin-top:20px">Fecha</p><p style="margin:0">${c.fecha}</p></div>`;
    await pg.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`);
    out[c.id] = await pg.screenshot({ type: "png" });
  }
  await b.close();
  return out;
}

/** Corre el banco. `real` usa Claude de verdad (necesita apiKey). `render` dibuja los comprobantes. */
export async function run({ real = false, apiKey, model = "claude-haiku-5-5", limitUsd = 2, render = true } = {}) {
  const { Agents, defaultAiCfg } = await dist("agents.js");
  const { runBank, receiptFacts, WA_BANK, RECEIPT_BANK } = await dist("agent-bank.js");
  // API simulada: responde lo esperado de cada caso (prueba conexiones y comparaciones, no la calidad).
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
    const content = body.messages[0].content;
    const user = typeof content === "string" ? content : content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    let out = {};
    if (props.includes("is_payment_proof")) { const c = RECEIPT_BANK.casos.find((x) => user.includes(`"${x.pedido.ref}"`) && user.includes(x.banco ?? "QR")); out = c ? receiptFacts(c) : {}; }
    else if (props.includes("risk")) out = { risk: "none" };
    else {
      const c = [...WA_BANK.casos].sort((a, b) => b.mensaje.length - a.mensaje.length).find((x) => user.endsWith(x.mensaje));
      out = { reply: `${(c?.espera.mencionar ?? []).join(" ")} Escribí *menu* para ver opciones.`, handoff: c?.espera.handoff ?? false, action: c?.espera.accion?.[0] ?? "none" };
    }
    return new Response(JSON.stringify({ id: "msg_sim", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(out) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let cfg = { ...defaultAiCfg("x"), model, monthlyLimitUsd: limitUsd, enabled: { receipts: true, whatsapp: true, daily: true, watch: true } };
  const agents = new Agents({ apiKey: real ? apiKey : "sk-ant-simulada", fetchImpl: real ? undefined : fakeFetch, now: () => Date.now(), getCfg: () => cfg, saveCfg: (c) => { cfg = c; } });
  cfg.month = agents.monthKey();
  const images = real && render ? await renderReceipts(RECEIPT_BANK.casos) : Object.fromEntries(RECEIPT_BANK.casos.map((c) => [c.id, Buffer.from("x")]));
  const r = await runBank(agents, () => cfg, { images, concurrency: real ? 4 : 1, useAiForMail: real });
  return { modo: real ? "real" : "simulado", modelo: model, ...r };
}

function informe(r) {
  const t = (s) => `${s.pasan}/${s.total}`;
  const lines = [`# Banco de pruebas de la oficina virtual`, ``, `Modo: **${r.modo}**${r.modo === "real" ? ` · modelo ${r.modelo} · gasto aprox. US$ ${r.gastoUsd.toFixed(4)}` : " (no mide la calidad de Claude: prueba conexiones y comparaciones)"}`, ``,
    `| Banco | Pasan |`, `|---|---|`, `| WhatsApp | ${t(r.resumen.whatsapp)} |`, `| Comprobantes | ${t(r.resumen.comprobantes)} |`, `| Correos | ${t(r.resumen.correos)} |`, ``];
  for (const [k, l] of [["WhatsApp", r.whatsapp], ["Comprobantes", r.comprobantes], ["Correos", r.correos]]) {
    const bad = l.filter((x) => x.fallas.length);
    if (!bad.length) continue;
    lines.push(`## ${k}: casos con fallas`, "");
    for (const x of bad) lines.push(`- **${x.id}** — "${x.texto}": ${x.fallas.join("; ")}${x.resultado ? `\n  - Resultado: ${x.resultado.replace(/\n/g, " ")}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
  const real = process.argv.includes("--real");
  if (real && !process.env.ANTHROPIC_API_KEY) { console.error("Para el modo real hace falta ANTHROPIC_API_KEY."); process.exit(2); }
  const r = await run({ real, apiKey: process.env.ANTHROPIC_API_KEY, model: arg("modelo", "claude-haiku-5-5"), limitUsd: Number(arg("tope", "2")) });
  const dir = arg("salida", "evaluacion-agentes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "informe.json"), JSON.stringify(r, null, 1));
  writeFileSync(join(dir, "informe.md"), informe(r));
  console.log(informe(r));
}
