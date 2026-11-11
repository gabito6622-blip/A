#!/usr/bin/env node
// Recorre, con los usuarios demo y en un navegador real, CADA paso descrito en los manuales por
// puesto (docs/manuales/) y guarda las capturas que esos manuales muestran. Si un paso no existe
// o cambió su texto en la interfaz, el recorrido falla y dice qué paso de qué manual revisar
// (se corrige el manual, no la app).
//
// Uso (desde dental/, con la interfaz compilada: npm run build:web):
//   node scripts/manual-shots.cjs                    -> levanta un servidor e2e propio y recorre todo
//   node scripts/manual-shots.cjs recepcion caja     -> solo esos manuales
//   node scripts/manual-shots.cjs --solo-verificar   -> recorre sin escribir capturas
// Variables: MANUAL_BASE_URL (usar un servidor ya levantado con la semilla demo recién creada),
// E2E_PORT (3228 por defecto) y E2E_DATABASE_URL (base desechable; su nombre debe contener «e2e»).
// Las capturas usan solo los datos ficticios de la semilla demo. JPEG calidad 80, escala 2.
"use strict";
const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs/manuales/capturas");
const PW = "Demo2026dental";
const SLUG = "sonrisa-andina-demo";
const args = process.argv.slice(2);
const WRITE = !args.includes("--solo-verificar");
const ONLY = args.filter((a) => !a.startsWith("--"));
const PORT = Number(process.env.E2E_PORT ?? 3228);
const BASE = process.env.MANUAL_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "es-BO", timezoneId: "America/La_Paz" };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-BO", timezoneId: "America/La_Paz" };

let browser;
const written = [];
const log = (s) => process.stdout.write(`${s}\n`);
let current = { manual: "", step: "" };

/** Un paso del manual: si falla, el mensaje dice qué manual y qué paso revisar. */
async function paso(texto, fn) {
  current.step = texto;
  log(`  · ${texto}`);
  try { await fn(); } catch (e) {
    // Con MANUAL_DEBUG_DIR, guarda cómo estaban las páginas abiertas al fallar.
    if (process.env.MANUAL_DEBUG_DIR) {
      for (const [i, p] of browser.contexts().flatMap((c) => c.pages()).entries()) {
        await p.screenshot({ path: path.join(process.env.MANUAL_DEBUG_DIR, `fallo-${current.manual}-${i}.png`), timeout: 8000 }).catch((x) => log(`    (sin captura de depuración: ${x.message.split("\n")[0]})`));
      }
    }
    const err = new Error(`Manual «${current.manual}», paso «${texto}»: ${e.message.split("\n")[0]}`);
    err.stack = e.stack;
    throw err;
  }
}

/** Captura JPEG (calidad 80). target: página (lo visible) o un localizador (ese elemento).
 *  opts.fit: recorta el elemento hasta donde termina su contenido (paneles laterales altos).
 *  Los avisos flotantes («toasts») se ocultan salvo opts.toast. */
async function shot(name, target, opts = {}) {
  if (!WRITE) return;
  const file = path.join(OUT, `${name}.jpg`);
  const isPage = typeof target.goto === "function";
  const page = isPage ? target : target.page();
  await page.waitForTimeout(opts.wait ?? 350); // animaciones de diálogos y avisos
  const hide = opts.toast ? null : await page.addStyleTag({ content: ".toast-wrap { visibility: hidden !important; }" });
  const base = { path: file, type: "jpeg", quality: 80, animations: "disabled" };
  if (isPage) {
    // Página: sin el menú lateral (ya se ve en la captura de «qué ves al entrar»), salvo opts.full.
    const vp = page.viewportSize();
    const side = !opts.full && vp.width >= 1000 && (await page.locator(".sidebar").count()) ? 248 : 0;
    // Alto de 720 px: lo importante de cada pantalla sin inflar el peso de la imagen.
    await page.screenshot({ ...base, clip: { x: side, y: 0, width: vp.width - side, height: vp.width >= 1000 ? Math.min(vp.height, opts.height ?? 720) : vp.height }, ...opts.shot });
  }
  else if (opts.fit) {
    // Deja el elemento justo debajo de la barra superior fija y recorta hasta donde termina su contenido.
    await target.evaluate((el) => { el.scrollIntoView({ block: "start" }); if (!el.closest("[role=dialog]")) window.scrollBy(0, -96); });
    const clip = await target.evaluate((el, maxH) => {
      const r = el.getBoundingClientRect();
      let bottom = r.top;
      for (const c of el.querySelectorAll("*")) {
        const b = c.getBoundingClientRect();
        if (b.width && b.height && getComputedStyle(c).visibility !== "hidden") bottom = Math.max(bottom, b.bottom);
      }
      return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, bottom - r.top + 18, maxH, window.innerHeight - r.top) };
    }, opts.maxHeight ?? 820);
    await page.screenshot({ ...base, clip });
  } else await target.screenshot({ ...base, ...opts.shot });
  if (hide) await hide.evaluate((el) => el.remove());
  written.push(file);
}

async function newPage(device = DESK) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log(`    [error de página] ${e.message}`));
  return page;
}

async function login(email, device = DESK) {
  const page = await newPage(device);
  await page.goto(`${BASE}/`);
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await page.waitForSelector(device === MOBILE ? ".bottom-nav" : ".sidebar", { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  return page;
}

const toTop = (page) => page.evaluate(() => window.scrollTo(0, 0));
// Ítem del menú lateral (el de Tareas lleva además el contador de pendientes).
const menu = (page, name) => page.locator(".sidebar").getByRole("link", { name: new RegExp(`^${name}(?=$|[^\\p{L}])`, "u") }).click();
const dialog = (page, name) => page.getByRole("dialog", { name });
const toast = (page, text) => expect(page.getByText(text).first()).toBeVisible({ timeout: 10_000 });
async function settle(page) { await page.waitForLoadState("networkidle"); await page.waitForTimeout(250); }
/** Resalta un elemento con un recuadro (solo para la captura). */
async function mark(locator) {
  await locator.evaluate((el) => { el.style.outline = "3px solid #f59e0b"; el.style.outlineOffset = "3px"; el.setAttribute("data-manual-mark", "1"); });
}
async function unmark(page) {
  await page.evaluate(() => document.querySelectorAll("[data-manual-mark]").forEach((el) => { el.style.outline = ""; el.style.outlineOffset = ""; el.removeAttribute("data-manual-mark"); }));
}
/** Pide a la API del personal (con la sesión de la página). */
async function apiGet(page, url) { return (await page.request.get(`${BASE}${url}`)).json(); }

// Un archivo por manual en scripts/manual-shots/, en este orden (el de caja usa la cita que agenda recepción).
const ORDER = ["recepcion", "caja", "odontologo", "asistente", "limpieza", "contabilidad", "gerencia", "propietaria", "portal-paciente", "en-la-app"];
const kit = { paso, shot, login, newPage, menu, dialog, toast, settle, toTop, mark, unmark, apiGet, expect, base: () => BASE, SLUG, DESK, MOBILE };
const MANUALS = Object.fromEntries(ORDER.map((id) => [id, () => require(`./manual-shots/${id}.cjs`)(kit)]));

async function reachable(url) {
  try { const r = await fetch(`${url}/api/health`); return r.ok; } catch { return false; }
}

async function main() {
  let server = null;
  if (!process.env.MANUAL_BASE_URL) {
    if (await reachable(BASE)) throw new Error(`El puerto ${PORT} ya está ocupado. Usa MANUAL_BASE_URL para reutilizar ese servidor o elige otro E2E_PORT.`);
    log(`Levantando un servidor e2e con la semilla demo en ${BASE}…`);
    server = spawn(process.execPath, ["--import", "tsx", "e2e/server.ts"], {
      cwd: ROOT, stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, E2E_PORT: String(PORT), E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_e2e_manuales" },
    });
    for (let i = 0; i < 180 && !(await reachable(BASE)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await reachable(BASE))) throw new Error("El servidor e2e no arrancó");
  }
  fs.mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch();
  const failures = [];
  try {
    for (const [id, run] of Object.entries(MANUALS)) {
      if (ONLY.length && !ONLY.includes(id)) continue;
      current = { manual: id, step: "" };
      log(`\n▶ Manual «${id}»`);
      try { await run(); } catch (e) { failures.push(e.message); log(`  ✗ ${e.message}`); }
    }
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
  const bytes = written.reduce((s, f) => s + fs.statSync(f).size, 0);
  log(`\n${written.length} capturas escritas (${(bytes / 1048576).toFixed(2)} MB).`);
  const all = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  log(`Carpeta de capturas: ${(all / 1048576).toFixed(2)} MB en total.`);
  if (failures.length) { log(`\n${failures.length} manual(es) con pasos que no coinciden con la app:\n- ${failures.join("\n- ")}`); process.exit(1); }
  log("Todos los pasos recorridos coinciden con la app.");
}

main().catch((e) => { console.error(e); process.exit(1); });
