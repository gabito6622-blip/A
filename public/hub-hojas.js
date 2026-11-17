// 📒 Mis hojas del revendedor (GaboHub, 17/11/2026). El dueño: «que mis revendedores tengan lo mismo que yo».
// Como «📗 Mis hojas» del panel (panel-hojas.js), pero con SUS clientes: lo vendido de la tienda, sus cuentas propias
// y los perfiles que reparte. Una hoja por plataforma (pestañas abajo, como el Excel) y «Me deben».
// Lo que se puede tocar es lo mismo que ya puede tocar en sus otras pantallas: Me pagó / Renovó, fecha (no en las
// cuentas de la tienda: esa la pone la tienda) y nota. Todo pasa por /api/me/hojas/op, que usa las mismas funciones.
//
// Sin internet: este aparato guarda una copia SIN contraseñas (el servidor nunca las manda acá). Lo anotado sin señal
// queda con ⏳ y se sube solo al volver. Si esa fila cambió mientras tanto, el servidor avisa (409) y se pregunta antes
// de guardarlo. Cada cambio lleva su llave: reintentar nunca renueva dos veces.
import { api, apiCacheClear, esc, bs, fdate, daysLeft, waLink, newKey, toast } from "/common.js";

const SNAP = "gs-hubhojas-v1", COLA = "gs-hubhojas-cola-v1";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } };
const netErr = (e) => e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(String(e?.message));

let CTX = { me: () => null, render: () => {}, isOn: () => false };
let D = null; // { at, rows }
let ERR = ""; // por qué no se pudo leer (plan, etc.)
let ST = { t: "", q: "" };
let OFF = false;
let COLD = false; // el GaboHub abrió sin internet (solo las hojas)
const offline = () => OFF || (typeof navigator !== "undefined" && navigator.onLine === false);
const meId = (me) => me?.id ?? me?.customerId ?? null;

/* ---------------- plataformas ---------------- */
const PLAT = [["Disney", /disney/], ["Netflix", /netflix/], ["Max", /\bmax\b|hbo/], ["Prime", /prime|amazon/], ["Spotify", /spotify/],
  ["Paramount", /paramount/], ["Crunchyroll", /crunchy/], ["YouTube", /youtube/], ["Star+", /star\b|star\+/], ["ViX", /\bvix\b/],
  ["ChatGPT", /chatgpt|openai|gpt/], ["Canva", /canva/], ["Apple TV", /apple/], ["IPTV", /iptv|flujo/]];
const platOf = (name) => { const n = String(name ?? "").toLowerCase(); for (const [k, re] of PLAT) if (re.test(n)) return k; return "Otros"; };
const KIND = { t: "de la tienda", o: "cuenta propia", s: "perfil repartido" };
const GO = { t: "control", o: "propias", s: "perfiles" };
const GO_TXT = { t: "📊 Ver en Mi control", o: "📦 Ver en Mis cuentas propias", s: "🧩 Ver en Repartir perfiles" };

/* ---------------- copia en el aparato ---------------- */
export const hubHojasSnapshot = () => { const s = read(SNAP); return s?.v === 1 && Array.isArray(s.rows) ? s : null; };
function saveSnap(d) {
  const me = CTX.me();
  // Solo lo necesario para abrir sin internet: quién es (sin datos de sesión) y las filas (sin contraseñas).
  write(SNAP, { v: 1, at: d.at, me: me ? { id: meId(me), name: me.name || "" } : null, sym: d.sym || "", rows: d.rows });
}
/** Al entrar con internet: si la copia es de otra persona, se borra con sus cambios sin subir. */
export function hubHojasCheckUser(me) {
  const s = hubHojasSnapshot();
  if (s && s.me?.id && meId(me) && s.me.id !== meId(me)) { drop(SNAP); drop(COLA); }
}
/** Al salir: se borra la copia (si hay cambios sin subir, se pregunta). Devuelve false si eligió no salir. */
export function hubHojasLogout() {
  const n = pending().length;
  if (n && !confirm(`Tenés ${n} cambio${n === 1 ? "" : "s"} anotado${n === 1 ? "" : "s"} sin internet sin subir.\n\nSi salís, se borra${n === 1 ? "" : "n"}. ¿Salir igual?`)) return false;
  drop(SNAP); drop(COLA);
  return true;
}

/* ---------------- cola de cambios ---------------- */
const queue = () => { const q = read(COLA); return Array.isArray(q) ? q : []; };
const saveQ = (q) => write(COLA, q);
const pending = () => queue().filter((o) => !o.err);
const opText = (o) => (o.t === "pay" ? (o.kind === "t" ? "💵 Me pagó" : "🔄 Renovó y pagó") : o.t === "date" ? `📅 Nueva fecha ${fdate(o.v)}` : `📝 Nota «${String(o.v).slice(0, 40)}»`);
const send = (o, force = false) => api("POST", "/api/me/hojas/op", { k: o.k, row: o.row, t: o.t, v: o.v, base: o.base, ...(force ? { force: true } : {}) });

let syncing = false;
/** Sube lo anotado sin internet. Corre al volver la señal y al abrir las hojas. */
export async function hubHojasSync() {
  if (syncing || COLD || (typeof navigator !== "undefined" && navigator.onLine === false) || !pending().length) return;
  syncing = true;
  let ok = 0;
  try {
    for (const o of queue()) {
      if (o.err) continue;
      const upd = (patch) => saveQ(queue().map((x) => (x.k === o.k ? { ...x, ...patch } : x)));
      const remove = () => saveQ(queue().filter((x) => x.k !== o.k));
      try {
        await send(o); remove(); ok++;
      } catch (e) {
        if (netErr(e) || e.status === 401) break;
        if (e.code === "INVALID_STATE") {
          if (confirm(`Sin internet anotaste: ${opText(o)}\n${o.who} · ${o.e}\n\n${e.message}.\n\n¿Guardarlo igual?`)) {
            try { await send(o, true); remove(); ok++; } catch (e2) { if (netErr(e2)) break; upd({ err: `${o.who} · ${o.e}: ${e2.message}. No se guardó: ${opText(o)}.` }); }
          } else remove();
          continue;
        }
        upd({ err: `${o.who} · ${o.e}: ${e.message}. No se guardó: ${opText(o)}.` });
      }
    }
  } finally { syncing = false; }
  if (ok) toast(`✅ Se subi${ok === 1 ? "ó 1 cambio" : `eron ${ok} cambios`} que anotaste sin internet`);
  if (CTX.isOn()) { await hubHojasLoad(); CTX.render(); }
}

/* ---------------- datos ---------------- */
/** Lee las hojas. Sin internet usa la copia guardada. */
export async function hubHojasLoad() {
  ERR = "";
  ensureCss();
  if (typeof navigator !== "undefined" && navigator.onLine === false) { OFF = true; D = hubHojasSnapshot(); return; }
  try {
    apiCacheClear();
    const r = await api("GET", "/api/me/hojas");
    D = { at: r.at || Date.now(), rows: r.rows || [] };
    OFF = false; saveSnap(D); registerSw();
    if (pending().length) setTimeout(hubHojasSync, 50);
  } catch (e) {
    if (netErr(e)) { OFF = true; D = hubHojasSnapshot(); return; }
    D = null; ERR = e.message;
  }
}
/** Guarda en el aparato los ARCHIVOS de GaboHub (no los datos) para poder abrirlo sin internet. */
let swAsked = false;
function registerSw() {
  // Se avisa en cada lectura con internet: si una vez se cortó la señal a mitad, lo que faltó se guarda la próxima.
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  (swAsked ? navigator.serviceWorker.ready.then(() => null) : navigator.serviceWorker.register("/sw.js", { scope: "/" })).then(() => navigator.serviceWorker.ready).then((reg) => {
    const same = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin && !x.pathname.startsWith("/api/"); } catch { return false; } };
    const urls = ["/hub", "/hub-hojas.js", "/hub-hojas.css", ...performance.getEntriesByType("resource").map((e) => e.name).filter(same)];
    reg.active?.postMessage({ type: "gs-guardar", urls: [...new Set(urls)] });
  }).catch(() => { /* sin service worker: las hojas andan igual con internet */ });
  swAsked = true;
}
function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("hhcss")) return;
  const l = document.createElement("link");
  l.id = "hhcss"; l.rel = "stylesheet"; l.href = "/hub-hojas.css";
  document.head.appendChild(l);
}

/* ---------------- pantalla ---------------- */
const owes = (r) => (r.debt || 0) > 0 || (r.pay && r.pay !== "pagado" && !r.trial);
const stOf = (r) => (r.h ? "o" : daysLeft(r.x) < 0 ? "r" : daysLeft(r.x) <= 7 ? "o" : "g");
const ORD = { r: 0, o: 1, g: 2 };
const sortRows = (l) => l.sort((a, b) => ORD[stOf(a)] - ORD[stOf(b)] || a.x - b.x || a.cn.localeCompare(b.cn));
const match = (r, q) => !q || `${r.e} ${r.cn} ${r.pr} ${r.p} ${r.n}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const hhmm = (t) => new Date(t).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
const yyyymmdd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function tabsOf() {
  const by = {};
  for (const r of D.rows) (by[platOf(r.p)] ??= []).push(r);
  return Object.entries(by).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}
function rowHtml(r, ops) {
  const s = stOf(r), mine = ops.filter((o) => o.row === r.id), dateOp = mine.filter((o) => o.t === "date").pop();
  const d = daysLeft(r.x);
  const vence = dateOp ? `${fdate(dateOp.v).slice(0, 5)}<small>⏳ nueva</small>` : r.h ? "Esperando fecha" : `${fdate(r.x).slice(0, 5)}<small>${d < 0 ? `hace ${-d} d` : d === 0 ? "hoy" : `${d} d`}</small>`;
  const sub = [r.pr && !/^cuenta completa$/i.test(r.pr) ? r.pr : "", KIND[r.k], owes(r) ? "💸 debe" : "", r.n ? "📝" : ""].filter(Boolean).join(" · ");
  const user = String(r.e || ""), at = user.indexOf("@");
  return `<tr class="hh-${s}${mine.length ? " hh-wait" : ""}" data-hhrow="${esc(r.id)}" role="button" tabindex="0" aria-label="${esc(`${r.cn}, ${r.p}, vence ${fdate(r.x)}`)}">
    <td class="hhwho"><b>${esc(r.cn)}</b><small>${esc(sub)}</small>${mine.map((o) => `<small class="hhpend">⏳ ${esc(opText(o))}</small>`).join("")}</td>
    <td class="hhmail">${at > 0 ? `${esc(user.slice(0, at))}<small>${esc(user.slice(at))}</small>` : esc(user)}</td>
    <td class="hhdate">${vence}</td>
    <td class="hhm">${r.m ? esc(bs(r.m)) : ""}</td></tr>`;
}
function bodyHtml() {
  const ops = pending(), q = ST.q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const head = `<thead><tr><th>Cliente</th><th>Correo</th><th>Vence</th><th>Precio</th></tr></thead>`;
  const list = ST.t === "debe" ? D.rows.filter(owes) : (tabsOf().find(([k]) => k === ST.t)?.[1] || []);
  const rows = sortRows(list.filter((r) => match(r, q)));
  if (!rows.length) return `<p class="hhempty">${q ? "No hay nada con esa búsqueda en esta hoja." : ST.t === "debe" ? "🎉 Nadie te debe." : D.rows.length ? "Esta hoja está vacía." : "Todavía no tenés clientes. Cuando vendas, aparecen acá."}</p>`;
  const c = { r: 0, o: 0, g: 0 }; for (const r of rows) c[stOf(r)]++;
  const owed = rows.reduce((t, r) => t + (r.debt || (owes(r) ? r.m : 0)), 0);
  const chips = `<div class="hhchips"><span>${rows.length} cliente${rows.length === 1 ? "" : "s"}</span>${c.g ? `<span>🟢 ${c.g} al día</span>` : ""}${c.o ? `<span>🟠 ${c.o} vencen pronto</span>` : ""}${c.r ? `<span>🔴 ${c.r} vencida${c.r === 1 ? "" : "s"}</span>` : ""}${ST.t === "debe" && owed ? `<span>💸 ${esc(bs(owed))}</span>` : ""}</div>`;
  return `${chips}<div class="hhscroll"><table class="hht">${head}<tbody>${rows.map((r) => rowHtml(r, ops)).join("")}</tbody></table></div>`;
}
function netHtml() {
  const n = pending().length, bad = queue().filter((o) => o.err);
  const head = offline()
    ? `<div class="hhnet off" role="status">📶 Sin internet · ves lo guardado el ${esc(fdate(D.at).slice(0, 5))} a las ${esc(hhmm(D.at))}${n ? ` · ⏳ ${n} cambio${n === 1 ? "" : "s"} esperando internet` : " · podés anotar igual"}</div>`
    : n ? `<div class="hhnet" role="status">🔄 Subiendo ${n} cambio${n === 1 ? "" : "s"} que anotaste sin internet…</div>`
      : `<div class="hhnet ok" role="status">🟢 Con internet · copia guardada en este aparato a las ${esc(hhmm(D.at))}</div>`;
  return head + bad.map((o) => `<div class="hhnet bad">⚠️ ${esc(o.err)} <button class="sbtn sm" type="button" data-hhdrop="${esc(o.k)}">Entendido</button></div>`).join("");
}
function tabsHtml() {
  const plats = tabsOf(), debe = D.rows.filter(owes).length;
  return `<nav class="hhtabs" aria-label="Hojas">${plats.map(([k, l]) => `<button type="button" data-hhtab="${esc(k)}" aria-pressed="${ST.t === k}">${esc(k)} <i>${l.length}</i></button>`).join("")}<button type="button" data-hhtab="debe" aria-pressed="${ST.t === "debe"}">💸 Me deben <i>${debe}</i></button></nav>`;
}
function paint() {
  const box = document.getElementById("hhbody");
  if (!box || !D) return;
  box.innerHTML = bodyHtml();
  const t = document.querySelector("#hh .hhtabs"); if (t) t.outerHTML = tabsHtml();
  const n = document.getElementById("hhnetbox"); if (n) n.innerHTML = netHtml();
}

/** La pantalla (después de hubHojasLoad). */
export function hubHojasView() {
  ensureCss();
  if (!D) return ERR ? `<div class="sbox"><p class="err" style="margin:0">${esc(ERR)}</p></div>`
    : `<div class="sbox"><p style="margin:0">📶 Sin internet y este aparato todavía no tiene tus hojas guardadas. Abrí «Mis hojas» una vez con internet.</p></div>`;
  const plats = tabsOf();
  if (!ST.t || (ST.t !== "debe" && !plats.some(([k]) => k === ST.t))) ST.t = plats[0]?.[0] || "debe";
  return `<section class="sbox hh" id="hh">
    <div class="hhtop"><h2>📒 Mis hojas</h2><small>Tus clientes como en el Excel. Tocá una fila para cobrar, cambiar la fecha o anotar.</small></div>
    <div id="hhnetbox">${netHtml()}</div>
    <label class="hhql"><span class="hhsr">Buscar en las hojas</span><input id="hhq" class="hhq" type="search" placeholder="🔍 Buscar cliente, correo o app" value="${esc(ST.q)}" autocomplete="off"></label>
    ${tabsHtml()}
    <div id="hhbody">${bodyHtml()}</div></section>`;
}

/** GaboHub abierto sin internet: muestra solo las hojas guardadas. true si pudo. */
export function hubHojasOffline(box) {
  const s = hubHojasSnapshot();
  if (!s || !box) return false;
  COLD = true; OFF = true; D = s;
  CTX = { ...CTX, isOn: () => true, render: () => { box.innerHTML = coldHtml(); } };
  box.innerHTML = coldHtml();
  addEventListener("online", () => location.reload(), { once: true });
  return true;
}
const coldHtml = () => `<p class="hhcold">📶 Abriste GaboHub sin internet: solo están tus hojas. Cuando vuelva la señal, se abre todo solo.</p>${hubHojasView()}`;

/* ---------------- tocar una fila ---------------- */
const findRow = (id) => D?.rows.find((r) => r.id === id);
function cobrarMsg(r) {
  const d = daysLeft(r.x);
  return `Hola ${first(r.cn)} 👋\nTu ${r.p} ${r.h ? "está activa" : `${d < 0 ? "venció" : "vence"} el ${fdate(r.x)}`}.${r.m ? `\nPara renovar son ${bs(r.m)}.` : ""} ¿Te la renuevo?`;
}
function sheetHtml(r) {
  const off = offline(), mine = pending().filter((o) => o.row === r.id);
  const payTxt = r.k === "t" ? (r.pay === "pagado" ? "" : "💵 Me pagó") : "🔄 Renovó y me pagó";
  return `<div class="hhscrim" id="hhsheet"><div class="hhsheet" role="dialog" aria-modal="true" aria-labelledby="hhsh">
    <div class="hhsheet-h"><b id="hhsh">${esc(r.cn)}</b><button class="sbtn sm" type="button" data-hhclose="1" aria-label="Cerrar">✕</button></div>
    <p class="hhinfo">${esc(r.p)} · ${esc(r.e)}${r.pr ? ` · ${esc(r.pr)}` : ""}<br>${esc(KIND[r.k])} · ${r.h ? "esperando fecha" : `vence ${esc(fdate(r.x))}`}${r.m ? ` · ${esc(bs(r.m))}` : ""}${owes(r) ? ` · 💸 debe${r.debt ? ` ${esc(bs(r.debt))}` : ""}` : ""}</p>
    ${r.n ? `<p class="hhnote">📝 ${esc(r.n)}</p>` : ""}
    ${mine.map((o) => `<p class="hhpend">⏳ ${esc(opText(o))}: se sube cuando vuelva internet</p>`).join("")}
    <div class="hhbtns">
      ${payTxt ? `<button class="sbtn pri" type="button" data-hhpay="${esc(r.id)}">${payTxt}</button>` : ""}
      ${r.k !== "t" ? `<button class="sbtn" type="button" data-hhdate="${esc(r.id)}">📅 Cambiar fecha</button>` : ""}
      <button class="sbtn" type="button" data-hhnote="${esc(r.id)}">📝 Nota</button>
      ${r.ph ? `<a class="sbtn" href="${esc(waLink(r.ph, cobrarMsg(r)))}" target="_blank" rel="noopener">📲 Cobrar por WhatsApp</a>` : ""}
      ${COLD ? "" : `<button class="sbtn" type="button" data-rtool="${GO[r.k]}"${off ? " disabled" : ""}>${GO_TXT[r.k]}</button>`}
    </div>
    <div id="hhform"></div>
    ${r.k === "t" ? `<p class="hhhint">La fecha de una cuenta de la tienda la pone la tienda: para renovarla usá Mi control.</p>` : ""}
    ${off ? `<p class="hhhint">📶 Sin internet: lo que anotes se guarda acá y se sube solo.</p>` : ""}
  </div></div>`;
}
function openSheet(id) {
  const r = findRow(id); if (!r) return;
  closeSheet();
  document.getElementById("hh")?.insertAdjacentHTML("beforeend", sheetHtml(r));
  document.querySelector("#hhsheet [data-hhclose]")?.focus();
}
const closeSheet = () => document.getElementById("hhsheet")?.remove();

/** Hace el cambio ya; sin señal lo deja en la cola con ⏳. */
async function runOrQueue(r, t, v) {
  const o = { k: newKey(), t, row: r.id, kind: r.k, v, who: r.cn, e: r.e, at: Date.now(), base: { x: r.x, pay: r.pay, n: r.n } };
  if (!offline()) {
    try {
      await send(o);
      closeSheet();
      toast(t === "pay" ? "✅ Anotado" : t === "date" ? `📅 Nueva fecha: ${fdate(v)}` : "📝 Nota guardada");
      await hubHojasLoad(); return CTX.render();
    } catch (e) {
      if (e.code === "INVALID_STATE") {
        if (!confirm(`${e.message}.\n\n¿Guardarlo igual?`)) { closeSheet(); await hubHojasLoad(); return CTX.render(); }
        try { await send(o, true); closeSheet(); toast("✅ Guardado"); await hubHojasLoad(); return CTX.render(); } catch (e2) { if (!netErr(e2)) return formErr(e2.message); }
      } else if (!netErr(e)) return formErr(e.message);
      OFF = true; // se cortó: queda en la cola (la llave evita hacerlo dos veces)
    }
  }
  saveQ([...queue(), o]);
  closeSheet();
  toast("⏳ Anotado en este aparato: se sube solo cuando vuelva internet");
  paint();
}
function formErr(m) {
  const f = document.getElementById("hhform");
  if (f) f.innerHTML = `<p class="err" role="alert">${esc(m)}</p>`; else toast(m);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (ev) => {
    if (ev.target.id === "hhsheet") return closeSheet();
    const el = ev.target.closest?.("[data-hhtab], [data-hhrow], [data-hhpay], [data-hhdate], [data-hhnote], [data-hhclose], [data-hhdrop]");
    if (!el || !el.closest("#hh")) return;
    const d = el.dataset;
    if (d.hhtab) { ST.t = d.hhtab; return paint(); }
    if (d.hhclose) return closeSheet();
    if (d.hhdrop) { saveQ(queue().filter((o) => o.k !== d.hhdrop)); return paint(); }
    if (d.hhrow) return openSheet(d.hhrow);
    const r = findRow(d.hhpay || d.hhdate || d.hhnote);
    if (!r) return;
    if (d.hhpay) {
      const what = r.k === "t" ? `«Me pagó» de ${r.cn}` : `«Renovó y me pagó» de ${r.cn} (suma un período)`;
      if (!confirm(`${what}.\n\n${offline() ? "Sin internet: queda anotado en este aparato y se sube cuando vuelva la señal. " : ""}¿Anotarlo?`)) return;
      el.disabled = true;
      return runOrQueue(r, "pay", null);
    }
    const form = document.getElementById("hhform");
    if (d.hhdate) form.innerHTML = `<form class="hhf" data-hhform="date" data-row="${esc(r.id)}"><label>Nueva fecha de vencimiento<input type="date" name="v" required value="${esc(yyyymmdd(r.x))}"></label><button class="sbtn pri" type="submit">Guardar fecha</button></form>`;
    if (d.hhnote) form.innerHTML = `<form class="hhf" data-hhform="note" data-row="${esc(r.id)}"><label>Nota (solo la ves vos)<textarea name="v" maxlength="120" rows="3">${esc(r.n)}</textarea></label><button class="sbtn pri" type="submit">Guardar nota</button></form>`;
    form.querySelector("input, textarea")?.focus();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && document.getElementById("hhsheet")) return closeSheet();
    const row = ev.target.closest?.("[data-hhrow]");
    if (row && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openSheet(row.dataset.hhrow); }
  });
  document.addEventListener("input", (ev) => { if (ev.target.id === "hhq") { ST.q = ev.target.value; paint(); } });
  document.addEventListener("submit", (ev) => {
    const f = ev.target.closest?.("[data-hhform]");
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const r = findRow(f.dataset.row); if (!r) return;
    if (f.dataset.hhform === "date") {
      const [y, m, dd] = f.v.value.split("-").map(Number);
      if (!y) return formErr("Elegí una fecha");
      return runOrQueue(r, "date", new Date(y, m - 1, dd, 23, 59).getTime());
    }
    return runOrQueue(r, "note", f.v.value.trim().slice(0, 120));
  }, true);
  addEventListener("online", () => { OFF = false; hubHojasSync(); });
  addEventListener("offline", () => { OFF = true; if (CTX.isOn()) paint(); });
}

/** shop.js le pasa quién entró, cómo volver a dibujar y si la hoja está a la vista. */
export function hubHojasInit(ctx) { CTX = { ...CTX, ...ctx }; }
