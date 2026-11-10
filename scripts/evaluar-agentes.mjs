// Banco de pruebas de la oficina virtual: corre los casos de test/fixtures/agentes/ y dice cuáles pasan.
//
// Modo simulado (por defecto, gratis): una "API de Claude" falsa responde lo esperado. Sirve para probar
// que todo está bien conectado y que las comparaciones del sistema (monto, número de operación, reglas
// de correos) funcionan. NO mide qué tan bien responde Claude.
//
// Modo real (cuesta centavos): usa Claude de verdad con tu clave.
//   ANTHROPIC_API_KEY=... node scripts/evaluar-agentes.mjs --real --modelo=claude-haiku-5-5 --tope=2
// Opciones: --solo=whatsapp|comprobantes|correos  --salida=carpeta  --modelo=<id>  --tope=<US$ máximo>
// Deja informe.md e informe.json en la carpeta de salida (por defecto ./evaluacion-agentes).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "test", "fixtures", "agentes");
const load = (f) => JSON.parse(readFileSync(join(FIX, f), "utf8"));

/** Lo que el comprobante "dice" (para la API simulada y para dibujarlo). */
export function receiptFacts(c) {
  const m = /([\d.,]+)/.exec(c.monto ?? "");
  const amount = c.borroso || !m ? null : Number(m[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return {
    is_payment_proof: !c.noComprobante, amount: c.noComprobante ? null : amount,
    currency: c.noComprobante ? null : c.usdt ? "USDT" : /\$/.test(c.monto ?? "") ? "US$" : "Bs",
    reference: c.noComprobante ? null : c.ref, date: c.fecha ?? null, recipient: c.destino ?? null,
    looks_edited: !!c.editado, notes: "",
  };
}

/** Dibuja un comprobante de prueba como imagen PNG (con Playwright, que viene en el entorno). */
async function renderReceipts(casos) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 420, height: 620 } });
  const out = {};
  for (const c of casos) {
    const html = c.noComprobante
      ? `<div style="font:20px sans-serif;padding:40px;background:#fde;height:540px"><h1>¡Promo Netflix!</h1><p>Captura de una publicación de Facebook con un meme de una película.</p></div>`
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

const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Corrige un caso de WhatsApp contra lo esperado. Devuelve la lista de fallas (vacía = pasó). */
export function gradeWhatsapp(espera, r) {
  const fails = [];
  if (espera.handoff !== undefined && r.handoff !== espera.handoff) fails.push(`pase a persona: ${r.handoff} (esperaba ${espera.handoff})`);
  if (espera.accion && !espera.accion.includes(r.action)) fails.push(`acción: ${r.action} (esperaba ${espera.accion.join(" o ")})`);
  for (const m of espera.mencionar ?? []) if (!norm(r.reply).includes(norm(m))) fails.push(`no menciona "${m}"`);
  for (const re of espera.no ?? []) if (new RegExp(re, "i").test(r.reply)) fails.push(`dice algo prohibido (/${re}/)`);
  return fails;
}

/** Corre el banco. `real` usa Claude de verdad (necesita apiKey). */
export async function run({ real = false, apiKey, model = "claude-haiku-5-5", limitUsd = 2, only, render = true } = {}) {
  const { Agents, defaultAiCfg } = await import(pathToFileURL(join(HERE, "..", "dist", "server", "agents.js")).href);
  const { classifyRisk } = await import(pathToFileURL(join(HERE, "..", "dist", "store", "watch.js")).href);
  const wa = load("whatsapp.json"), mails = load("correos.json"), rec = load("comprobantes.json");
  // API simulada: responde lo esperado para cada caso (así se prueba la conexión y las comparaciones).
  let oracle = () => ({});
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "msg_sim", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(oracle(body)) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let cfg = { ...defaultAiCfg("x"), month: "x", model, monthlyLimitUsd: limitUsd, enabled: { receipts: true, whatsapp: true, daily: true, watch: true } };
  const agents = new Agents({ apiKey: real ? apiKey : "sk-ant-simulada", fetchImpl: real ? undefined : fakeFetch, now: () => Date.now(),
    getCfg: () => cfg, saveCfg: (c) => { cfg = c; } });
  cfg.month = agents.monthKey();
  const results = { modo: real ? "real" : "simulado", modelo: model, whatsapp: [], comprobantes: [], correos: [] };

  if (!only || only === "whatsapp") {
    for (const c of wa.casos) {
      oracle = () => ({ reply: `${(c.espera.mencionar ?? []).join(" ")} Escribí *menu* para ver opciones.`, handoff: c.espera.handoff ?? false, action: c.espera.accion?.[0] ?? "none" });
      try {
        const r = await agents.whatsappReply({ storeContext: wa.tienda, customerContext: wa.clientes[c.cliente] ?? undefined, history: [], message: c.mensaje });
        results.whatsapp.push({ id: c.id, mensaje: c.mensaje, respuesta: r.reply, handoff: r.handoff, accion: r.action, fallas: gradeWhatsapp(c.espera, r) });
      } catch (e) { results.whatsapp.push({ id: c.id, mensaje: c.mensaje, fallas: [`error: ${e.message}`] }); }
    }
  }
  if (!only || only === "comprobantes") {
    const imgs = render ? await renderReceipts(rec.casos) : {};
    for (const c of rec.casos) {
      oracle = () => receiptFacts(c);
      try {
        const r = await agents.reviewReceipt({ file: imgs[c.id] ?? Buffer.from("x"), mime: "image/png", expectedTotal: c.usdt ? null : c.pedido.total,
          currencySymbol: "Bs", declaredReference: c.pedido.ref, methodName: c.banco ?? "QR" });
        results.comprobantes.push({ id: c.id, veredicto: r.verdict, leido: { monto: r.amount, ref: r.reference }, fallas: c.espera.includes(r.verdict) ? [] : [`veredicto ${r.verdict} (esperaba ${c.espera.join(" o ")})`] });
      } catch (e) { results.comprobantes.push({ id: c.id, fallas: [`error: ${e.message}`] }); }
    }
  }
  if (!only || only === "correos") {
    for (const c of mails.casos) {
      const rule = classifyRisk(c.subject, c.body);
      const row = { id: c.id, asunto: c.subject, reglas: rule, fallas: rule === c.espera ? [] : [`reglas: ${rule} (esperaba ${c.espera})`] };
      if (real) { // en modo real también se mide la IA como respaldo de las reglas
        try { const ai = await agents.classifyMail({ from: c.from, subject: c.subject, body: c.body }); row.ia = ai; if ((ai === "none" ? null : ai) !== c.espera) row.fallasIA = [`IA: ${ai} (esperaba ${c.espera ?? "none"})`]; }
        catch (e) { row.fallasIA = [`error IA: ${e.message}`]; }
      }
      results.correos.push(row);
    }
  }
  const sum = (l) => ({ total: l.length, pasan: l.filter((x) => !x.fallas.length).length });
  results.resumen = { whatsapp: sum(results.whatsapp), comprobantes: sum(results.comprobantes), correos: sum(results.correos), gastoUsd: cfg.spentUsd };
  return results;
}

function informe(r) {
  const t = (s) => `${s.pasan}/${s.total}`;
  const lines = [`# Banco de pruebas de la oficina virtual`, ``, `Modo: **${r.modo}**${r.modo === "real" ? ` · modelo ${r.modelo} · gasto aprox. US$ ${r.resumen.gastoUsd.toFixed(4)}` : " (no mide la calidad de Claude: prueba conexiones y comparaciones)"}`, ``,
    `| Banco | Pasan |`, `|---|---|`, `| WhatsApp | ${t(r.resumen.whatsapp)} |`, `| Comprobantes | ${t(r.resumen.comprobantes)} |`, `| Correos (reglas) | ${t(r.resumen.correos)} |`, ``];
  for (const [k, l] of [["WhatsApp", r.whatsapp], ["Comprobantes", r.comprobantes], ["Correos", r.correos]]) {
    const bad = l.filter((x) => x.fallas.length || x.fallasIA?.length);
    if (!bad.length) continue;
    lines.push(`## ${k}: casos con fallas`, "");
    for (const x of bad) lines.push(`- **${x.id}**${x.mensaje ? ` — "${x.mensaje}"` : ""}: ${[...x.fallas, ...(x.fallasIA ?? [])].join("; ")}${x.respuesta ? `\n  - Respondió: ${x.respuesta.replace(/\n/g, " ")}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
  const real = process.argv.includes("--real");
  if (real && !process.env.ANTHROPIC_API_KEY) { console.error("Para el modo real hace falta ANTHROPIC_API_KEY."); process.exit(2); }
  const r = await run({ real, apiKey: process.env.ANTHROPIC_API_KEY, model: arg("modelo", "claude-haiku-5-5"), limitUsd: Number(arg("tope", "2")), only: arg("solo", undefined) });
  const dir = arg("salida", "evaluacion-agentes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "informe.json"), JSON.stringify(r, null, 1));
  writeFileSync(join(dir, "informe.md"), informe(r));
  console.log(informe(r));
}
