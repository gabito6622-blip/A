// 📗 Mis hojas (15/11/2026). El dueño: «lo que me gustaba de mi Excel es que entraba a las hojas, estaban bien bonitas
// y aunque esté sin internet anotaba y ya estaba». Una hoja por plataforma (pestañas abajo, como el Excel), más
// «Revendedores» y «Me deben». Es OTRA FORMA DE VER los mismos datos: los botones son los de siempre (Renovar = el de
// Cuentas, Cortar y Ver en Cuentas = los del Tablero), así todo llega a Mi secretaria, Finanzas y el asistente.
//
// Sin internet: este aparato guarda una copia SIN contraseñas (solo correos, clientes, fechas y precios). Lo que se
// anota sin señal (Me pagó, Cambiar fecha, Nota) queda con ⏳ y se sube solo al volver la señal. Si mientras tanto esa
// cuenta cambió (la cortaron, otro cambió la fecha…), se pregunta antes de guardar. «Me pagó» se reintenta con la misma
// llave, así nunca se cobra dos veces aunque se corte la señal en el medio.
import { api, apiCacheClear, esc, bs, fdate, daysLeft, waLink, newKey, brandBadge, toast } from "/common.js";
import { renewFlow } from "/dia.js";
import { avisoRenovada, shortProduct } from "/panel-tablero.js";

const SNAP = "gs-hojas-v1", COLA = "gs-hojas-cola-v1";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } };
export const netErr = (e) => e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(String(e?.message));

let CTX = { me: () => null, settings: () => null, render: () => {}, view: () => "" };
let D = null; // datos en pantalla: { at, rows, debts }
let ST = { t: "", q: "" };
let OFF = false; // la última lectura no tuvo respuesta (sin internet, aunque el celular diga que hay wifi)
export const offline = () => OFF || (typeof navigator !== "undefined" && navigator.onLine === false);

/* ---------------- plataformas ---------------- */
const PLAT = [["Disney", /disney/], ["Netflix", /netflix/], ["Max", /\bmax\b|hbo/], ["Prime", /prime|amazon/], ["Spotify", /spotify/],
  ["Paramount", /paramount/], ["Crunchyroll", /crunchy/], ["YouTube", /youtube/], ["Star+", /star\b|star\+/], ["ViX", /\bvix\b/],
  ["ChatGPT", /chatgpt|openai|gpt/], ["Canva", /canva/], ["Apple TV", /apple/], ["IPTV", /iptv/]];
export const platOf = (name) => { const n = String(name ?? "").toLowerCase(); for (const [k, re] of PLAT) if (re.test(n)) return k; return "Otros"; };

/* ---------------- datos ---------------- */
/** Una fila por perfil ocupado (de los alquileres) y por perfil libre o apartado (de las cuentas). Sin contraseñas. */
export function buildRows(asg, accounts, products) {
  const pname = Object.fromEntries((products || []).map((p) => [p.id, p.name]));
  const rows = (asg || []).map((a) => ({
    a: a.id, slot: a.slotId, pid: a.productId, p: a.product || pname[a.productId] || "", e: a.email || "", pr: a.profile || "",
    cid: a.customerId, cn: a.customerName || "", ph: a.customerPhone || "", k: a.customerKind || "customer",
    rid: a.resellerId || "", rn: a.resellerName || "", rph: a.resellerPhone || "",
    x: a.customerExpiresAt, h: a.holdOpen ? 1 : 0, pay: a.control?.payStatus || "", n: a.control?.note || "", m: a.effectivePrice ?? a.productPrice ?? 0,
  }));
  for (const acc of accounts || []) {
    if (acc.status !== "active") continue;
    for (const s of acc.slots || []) {
      if (s.status !== "available" && s.status !== "quarantined") continue;
      rows.push({ [s.status === "available" ? "free" : "apart"]: 1, slot: s.id, pid: acc.productId, p: pname[acc.productId] || "", e: acc.email || "", pr: s.label || "" });
    }
  }
  return rows;
}
async function load() {
  apiCacheClear();
  const soft = (p, empty) => api("GET", p).catch((e) => { if (netErr(e) || e.status === 401) throw e; return empty; });
  const [asg, accounts, products, fiado] = await Promise.all([api("GET", "/api/admin/assignments"), soft("/api/admin/accounts", []), soft("/api/admin/products", []), soft("/api/admin/fiado", null)]);
  const debts = (fiado?.rows || []).filter((r) => r.owed > 0).map((r) => ({ cid: r.customerId, cn: r.name, ph: r.phone, owed: r.owed, late: r.overdue ? 1 : 0, since: r.oldestAt || 0 }));
  return { at: Date.now(), rows: buildRows(asg, accounts, products), debts };
}
function saveSnap(d) {
  const me = CTX.me();
  write(SNAP, { v: 1, at: d.at, me: me ? { loggedIn: true, kind: "staff", id: me.id, name: me.name, role: me.role, username: me.username } : null, settings: CTX.settings(), rows: d.rows, debts: d.debts });
}
/** La copia guardada (para abrir el panel sin internet). */
export const hojasSnapshot = () => { const s = read(SNAP); return s?.v === 1 && Array.isArray(s.rows) ? s : null; };
/** Al entrar con internet: si la copia es de otra persona del equipo, se borra (con sus cambios sin subir). */
export function hojasCheckUser(me) {
  const s = hojasSnapshot();
  if (s && s.me?.id && me?.id && s.me.id !== me.id) { drop(SNAP); drop(COLA); }
}
/** Al salir: la copia se borra. Si hay cambios sin subir, se pregunta antes. */
export function hojasLogout() {
  const n = pending().length;
  if (n && !confirm(`Tenés ${n} cambio${n === 1 ? "" : "s"} anotado${n === 1 ? "" : "s"} sin internet que todavía no se subi${n === 1 ? "ó" : "eron"}.\n\nSi salís, se borra${n === 1 ? "" : "n"}. ¿Salir igual?`)) return false;
  drop(SNAP); drop(COLA);
  return true;
}
/** Con internet, al abrir el panel: renueva la copia en silencio (solo si ya usa las hojas). */
export async function hojasRefresh() {
  if (!hojasSnapshot()) return;
  registerSw();
  try { D = await load(); OFF = false; saveSnap(D); } catch { /* sin internet: queda la copia anterior */ }
  hojasSync();
}

/* ---------------- copia de la pantalla en el aparato (service worker) ---------------- */
let swAsked = false;
export function registerSw() {
  if (swAsked || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  swAsked = true;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready).then((reg) => {
    // Lo que el panel ya cargó (sus archivos, no los datos) queda guardado para abrirlo sin internet.
    const same = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin && !x.pathname.startsWith("/api/"); } catch { return false; } };
    const urls = [location.pathname, "/panel.html", ...performance.getEntriesByType("resource").map((e) => e.name).filter(same)];
    reg.active?.postMessage({ type: "gs-guardar", urls: [...new Set(urls)] });
  }).catch(() => { /* sin service worker: las hojas andan igual con internet */ });
}

/* ---------------- cambios sin internet (cola) ---------------- */
const queue = () => { const q = read(COLA); return Array.isArray(q) ? q : []; };
const saveQ = (q) => write(COLA, q);
const pending = () => queue().filter((o) => !o.err);
const opText = (o) => (o.t === "pay" ? "💵 Me pagó (renovar 1 mes)" : o.t === "date" ? `📅 Nueva fecha ${fdate(o.v)}` : `📝 Nota «${String(o.v).slice(0, 40)}»`);

async function doOp(op) {
  if (op.t === "pay") return renewFlow(op.a, { key: op.k });
  if (op.t === "date") return api("POST", `/api/admin/assignments/${op.a}/expiry`, { expiresAt: op.v });
  if (op.t === "note") return api("POST", `/api/admin/assignments/${op.a}/control`, { note: op.v });
  return null;
}
function whatChanged(op, c) {
  if (op.t === "note") return (c.control?.note || "") !== (op.base.n || "") ? "alguien cambió la nota" : "";
  if (c.customerExpiresAt !== op.base.x) return `la fecha cambió: ahora vence el ${fdate(c.customerExpiresAt)}`;
  if (op.t === "pay" && c.control?.payStatus === "pagado" && op.base.pay !== "pagado") return "ya figura como pagada";
  return "";
}
let syncing = false;
/** Sube lo que se anotó sin internet. Corre al volver la señal, al abrir el panel y al abrir las hojas. */
export async function hojasSync() {
  if (syncing || (typeof navigator !== "undefined" && navigator.onLine === false) || !pending().length) return;
  syncing = true;
  let ok = 0, stop = false;
  try {
    apiCacheClear();
    const cur = new Map((await api("GET", "/api/admin/assignments")).map((a) => [a.id, a]));
    const seen = new Set(); // el primer cambio de cada cuenta se compara; los siguientes dependen de ese
    for (const op of queue()) {
      if (op.err) continue;
      const upd = (patch) => saveQ(queue().map((o) => (o.k === op.k ? { ...o, ...patch } : o)));
      const remove = () => saveQ(queue().filter((o) => o.k !== op.k));
      if (!op.sent && !seen.has(op.a)) {
        const c = cur.get(op.a);
        if (!c) { upd({ err: `${op.who} · ${op.e}: ya no está activa (la cortaron, la liberaron o la pasaron a otra persona). No se guardó: ${opText(op)}.` }); continue; }
        const why = whatChanged(op, c);
        if (why && !confirm(`Sin internet anotaste: ${opText(op)}\n${op.who} · ${op.e}\n\nPero mientras tanto ${why}.\n\n¿Guardarlo igual?`)) { remove(); continue; }
      }
      seen.add(op.a);
      upd({ sent: true });
      try {
        const r = await doOp(op);
        remove();
        if (!(op.t === "pay" && r === null)) ok++;
      } catch (e) {
        if (netErr(e) || e.status === 401) { stop = true; break; }
        upd({ err: `${op.who} · ${op.e}: ${e.message}. No se guardó: ${opText(op)}.` });
      }
    }
  } catch { stop = true; /* sin respuesta: se intenta de nuevo con la próxima señal */ } finally { syncing = false; }
  if (ok) toast(`✅ Se subi${ok === 1 ? "ó 1 cambio" : `eron ${ok} cambios`} que anotaste sin internet`);
  if ((ok || !stop) && CTX.view() === "hojas") CTX.render();
}

/* ---------------- pantalla ---------------- */
const STATE_ORDER = { r: 0, o: 1, g: 2, q: 3, l: 4 };
const stOf = (r) => (r.free ? "l" : r.apart ? "q" : r.h || daysLeft(r.x) < 0 ? "r" : daysLeft(r.x) <= 7 ? "o" : "g");
const sortRows = (l) => l.sort((a, b) => STATE_ORDER[stOf(a)] - STATE_ORDER[stOf(b)] || (a.x || 9e15) - (b.x || 9e15) || a.e.localeCompare(b.e));
const payer = (r) => (r.k === "reseller" ? { id: r.cid, name: r.cn, phone: r.ph } : r.rid ? { id: r.rid, name: r.rn, phone: r.rph } : { id: r.cid, name: r.cn, phone: r.ph });
const first = (n) => String(n || "").replace(/^.*·\s*/, "").split(" ")[0];
const hhmm = (t) => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return (today ? "" : fdate(t).slice(0, 5) + " ") + d.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }); };
const yyyymmdd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function venceTxt(r) {
  if (r.free || r.apart) return "";
  if (r.h) return `Esperando fecha`;
  const d = daysLeft(r.x);
  return `${fdate(r.x).slice(0, 5)}<small>${d < 0 ? `hace ${-d} d` : d === 0 ? "hoy" : `${d} d`}</small>`;
}
function cobrarMsg(r) {
  const p = payer(r), d = daysLeft(r.x);
  return `Hola ${first(p.name)} 👋\nTu ${shortProduct(r.p)} (${r.e}) ${d < 0 ? "venció" : "vence"} el ${fdate(r.x)}.\nPara renovar son ${bs(r.m)}. ¿Te la renuevo?`;
}
function listaMsg(name, rows) {
  return `Hola ${first(name)} 👋 tu resumen:\n${rows.map((r) => `• ${shortProduct(r.p)} (${r.e}) – ${r.h ? "esperando fecha" : `${daysLeft(r.x) < 0 ? "venció" : "vence"} el ${fdate(r.x)}`}`).join("\n")}\n¡Gracias! 🙌`;
}
function rowHtml(r, ops) {
  const s = stOf(r), mine = ops.filter((o) => o.a === r.a);
  const who = r.free ? `<span class="muted">— libre —</span>` : r.apart ? `🔒 Apartada <small class="muted">(cambiá la clave y liberala)</small>`
    : `<b>${esc(r.cn)}</b>${r.k === "reseller" ? ` <small class="muted">(rev.)</small>` : r.rn ? ` <small class="muted">de ${esc(first(r.rn))}</small>` : ""}`;
  const sub = [/^cuenta completa$/i.test(r.pr) ? "" : r.pr, !r.free && !r.apart && r.pay && r.pay !== "pagado" ? "💸 debe" : "", r.n ? "📝" : ""].filter(Boolean).join(" · ");
  const SHORT = { pay: "Me pagó", date: "fecha nueva", note: "nota" };
  const pend = mine.map((o) => `<div class="hjpend">⏳ ${SHORT[o.t]}</div>`).join("");
  const key = r.a || "s:" + r.slot;
  const dateOp = mine.filter((o) => o.t === "date").pop();
  return `<tr class="hj-${s}${mine.length ? " hj-wait" : ""}" data-hjrow="${esc(key)}" role="button" tabindex="0" aria-label="${esc(`${r.e} ${r.cn || "libre"}`)}">
    <td class="hjmail"><span>${esc(r.e.split("@")[0])}</span><small>@${esc(r.e.split("@")[1] || "")}</small></td>
    <td class="hjwho">${who}${sub ? `<small class="hjsub">${esc(sub)}</small>` : ""}${pend}</td>
    <td class="hjdate">${dateOp ? `${fdate(dateOp.v).slice(0, 5)}<small>⏳ nueva</small>` : venceTxt(r)}</td>
    <td class="hjm">${r.free || r.apart ? "" : esc(bs(r.m))}</td></tr>`;
}
const HEAD = `<thead><tr><th>Correo</th><th>Quién</th><th>Vence</th><th>Precio</th></tr></thead>`;
const match = (r, q) => !q || `${r.e} ${r.cn || ""} ${r.rn || ""} ${r.pr || ""} ${r.p || ""}`.toLowerCase().includes(q);

function tabsOf(d) {
  const by = {};
  for (const r of d.rows) (by[platOf(r.p)] ??= []).push(r);
  const plats = Object.entries(by).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const revs = new Set(d.rows.filter((r) => !r.free && !r.apart && (r.k === "reseller" || r.rid)).map((r) => payer(r).id));
  return { plats, revs: revs.size, debts: d.debts.length };
}
function sheetBody(d) {
  const ops = pending(), q = ST.q.trim().toLowerCase();
  const { plats } = tabsOf(d);
  if (ST.t === "rev") {
    const groups = {};
    for (const r of d.rows) if (!r.free && !r.apart && (r.k === "reseller" || r.rid)) (groups[payer(r).id] ??= []).push(r);
    const list = Object.values(groups).map((l) => sortRows(l)).filter((l) => l.some((r) => match(r, q) || match({ e: "", cn: payer(r).name }, q)))
      .sort((a, b) => STATE_ORDER[stOf(a[0])] - STATE_ORDER[stOf(b[0])] || payer(a[0]).name.localeCompare(payer(b[0]).name));
    if (!list.length) return `<p class="muted hjempty">${q ? "No hay revendedores con esa búsqueda." : "Todavía no tenés revendedores con cuentas."}</p>`;
    return `<table class="hjt">${HEAD}<tbody>${list.map((l) => {
      const p = payer(l[0]), due = l.filter((r) => ["r", "o"].includes(stOf(r))).length;
      return `<tr class="hjgrp"><th colspan="4"><span>👤 ${esc(p.name)} <small>${l.length} cuenta${l.length === 1 ? "" : "s"}${due ? ` · ${due} por cobrar` : ""}</small></span>${p.phone ? `<a class="pbtn sm" href="${esc(waLink(p.phone, listaMsg(p.name, l)))}" target="_blank" rel="noopener" data-hjlista="1">📋 Su lista</a>` : ""}</th></tr>${l.map((r) => rowHtml(r, ops)).join("")}`;
    }).join("")}</tbody></table>`;
  }
  if (ST.t === "debe") {
    const l = d.debts.filter((x) => !q || x.cn.toLowerCase().includes(q)).sort((a, b) => b.late - a.late || b.owed - a.owed);
    if (!l.length) return `<p class="muted hjempty">${q ? "Nadie con esa búsqueda." : "🎉 Nadie te debe."}</p>`;
    return `<table class="hjt"><thead><tr><th>Quién</th><th>Debe</th><th></th></tr></thead><tbody>${l.map((x) => `<tr class="hj-${x.late ? "r" : "o"}">
      <td class="hjwho"><b>${esc(x.cn)}</b>${x.late ? `<small class="hjsub">⚠️ atrasado</small>` : ""}</td><td class="hjm"><b>${esc(bs(x.owed))}</b></td>
      <td>${x.ph ? `<a class="pbtn sm" href="${esc(waLink(x.ph, `Hola ${first(x.cn)} 👋 te recuerdo que quedó pendiente ${bs(x.owed)}. ¡Gracias! 🙌`))}" target="_blank" rel="noopener">📲 Cobrar</a>` : ""}</td></tr>`).join("")}</tbody></table>`;
  }
  const rows = sortRows((plats.find(([k]) => k === ST.t)?.[1] || []).filter((r) => match(r, q)));
  if (!rows.length) return `<p class="muted hjempty">${q ? "No hay nada con esa búsqueda en esta hoja." : "Esta hoja está vacía."}</p>`;
  return `<table class="hjt">${HEAD}<tbody>${rows.map((r) => rowHtml(r, ops)).join("")}</tbody></table>`;
}
function chipsHtml(d) {
  if (ST.t === "debe") return `<span>${d.debts.length} con deuda</span><span>💸 ${esc(bs(d.debts.reduce((t, x) => t + x.owed, 0)))}</span>`;
  const l = ST.t === "rev" ? d.rows.filter((r) => !r.free && !r.apart && (r.k === "reseller" || r.rid)) : d.rows.filter((r) => platOf(r.p) === ST.t);
  const c = { r: 0, o: 0, g: 0, l: 0, q: 0 }; for (const r of l) c[stOf(r)]++;
  return `<span>${l.length - c.l - c.q} ocupadas</span>${c.g ? `<span>🟢 ${c.g} al día</span>` : ""}${c.o ? `<span>🟠 ${c.o} vencen pronto</span>` : ""}${c.r ? `<span>🔴 ${c.r} vencida${c.r === 1 ? "" : "s"}</span>` : ""}${c.l ? `<span>🔵 ${c.l} libre${c.l === 1 ? "" : "s"}</span>` : ""}${c.q ? `<span>🔒 ${c.q} apartada${c.q === 1 ? "" : "s"}</span>` : ""}`;
}
function netHtml(d) {
  const n = pending().length, bad = queue().filter((o) => o.err);
  const head = offline()
    ? `<div class="hjnet off" role="status">📶 Sin internet · ves lo guardado el ${esc(fdate(d.at).slice(0, 5))} a las ${esc(new Date(d.at).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }))}${n ? ` · ⏳ ${n} cambio${n === 1 ? "" : "s"} esperando internet` : " · podés anotar igual"}</div>`
    : n ? `<div class="hjnet" role="status">🔄 Subiendo ${n} cambio${n === 1 ? "" : "s"} que anotaste sin internet…</div>`
      : `<div class="hjnet ok" role="status">🟢 Con internet · copia guardada en este aparato a las ${esc(hhmm(d.at))}</div>`;
  return head + bad.map((o) => `<div class="hjnet bad">⚠️ ${esc(o.err)} <button class="pbtn sm" type="button" data-hjdrop="${esc(o.k)}">Entendido</button></div>`).join("");
}
function tabsHtml(d) {
  const { plats, revs, debts } = tabsOf(d);
  return `<nav class="hjtabs" aria-label="Hojas">${plats.map(([k, l]) => `<button type="button" data-hjtab="${esc(k)}" aria-pressed="${ST.t === k}">${brandBadge(k, undefined, "hjlogo")}${esc(k)} <i>${l.length}</i></button>`).join("")}
    <button type="button" data-hjtab="rev" aria-pressed="${ST.t === "rev"}">👥 Revendedores <i>${revs}</i></button>
    <button type="button" data-hjtab="debe" aria-pressed="${ST.t === "debe"}">💸 Me deben <i>${debts}</i></button></nav>`;
}
function paint() {
  const box = document.getElementById("hjbody");
  if (!box || !D) return;
  box.innerHTML = `<div class="hjchips">${chipsHtml(D)}</div>${sheetBody(D)}`;
  const tabs = document.querySelector("#hj .hjtabs");
  if (tabs) tabs.outerHTML = tabsHtml(D);
  const net = document.getElementById("hjnetbox");
  if (net) net.innerHTML = netHtml(D);
}

/** La pantalla. Con internet lee todo y guarda la copia; sin internet muestra la copia guardada. */
export async function hojasView(tab) {
  ST = (tab.hj ??= { t: "", q: "" });
  registerSw();
  if (typeof navigator !== "undefined" && navigator.onLine !== false) {
    try { D = await load(); OFF = false; saveSnap(D); } catch (e) {
      if (!netErr(e)) throw e;
      OFF = true; D = hojasSnapshot();
      if (!D) throw e;
    }
  } else { OFF = true; D = hojasSnapshot(); }
  if (!D) return `<div class="perr">📶 Sin internet y este aparato todavía no tiene tus hojas guardadas. Abrí «Mis hojas» una vez con internet.</div>`;
  const { plats } = tabsOf(D);
  if (!ST.t || (!["rev", "debe"].includes(ST.t) && !plats.some(([k]) => k === ST.t))) ST.t = plats[0]?.[0] || "rev";
  if (!offline() && pending().length) setTimeout(hojasSync, 50);
  return `<section class="card hj" id="hj">
    <div class="hjtop"><h2>📗 Mis hojas</h2><small class="muted">Tocá una fila para cobrar, cambiar la fecha o anotar.</small></div>
    <div id="hjnetbox">${netHtml(D)}</div>
    <input id="hjq" class="hjq" type="search" placeholder="🔍 Buscar correo, cliente o revendedor" value="${esc(ST.q)}" aria-label="Buscar en las hojas">
    <div id="hjbody"><div class="hjchips">${chipsHtml(D)}</div>${sheetBody(D)}</div>
    ${tabsHtml(D)}</section>`;
}

/* ---------------- tocar una fila ---------------- */
const findRow = (key) => D?.rows.find((r) => (r.a || "s:" + r.slot) === key);
function sheetHtml(r) {
  const off = offline(), mine = pending().filter((o) => o.a && o.a === r.a);
  const p = payer(r);
  const info = r.free ? "Perfil libre: se puede vender." : r.apart ? "Apartada: cambiá la clave y liberala en Mi secretaria → Apartadas." : `${esc(r.cn)}${r.rn && r.k !== "reseller" ? ` (de ${esc(r.rn)})` : ""} · ${r.h ? "esperando fecha" : `vence ${esc(fdate(r.x))}`} · ${esc(bs(r.m))}`;
  const btns = r.a ? `
      <button class="pbtn green" type="button" data-hjpay="${esc(r.a)}">💵 Me pagó · renovar 1 mes</button>
      <button class="pbtn" type="button" data-hjdate="${esc(r.a)}">📅 Cambiar fecha</button>
      <button class="pbtn" type="button" data-hjnote="${esc(r.a)}">📝 Nota</button>
      ${p.phone ? `<a class="pbtn" href="${esc(waLink(p.phone, cobrarMsg(r)))}" target="_blank" rel="noopener">📲 Cobrar por WhatsApp</a>` : ""}
      <button class="pbtn" type="button" data-slotcut="${esc(r.slot)}" data-who="${esc(r.cn)}"${off ? " disabled" : ""}>✂️ Cortar: no renovó</button>
      <button class="pbtn" type="button" data-tbslot="${esc(r.slot)}" data-q="${esc(r.e)}"${off ? " disabled" : ""}>🔎 Ver en Cuentas</button>`
    : `<button class="pbtn" type="button" data-tbslot="${esc(r.slot)}" data-q="${esc(r.e)}"${off ? " disabled" : ""}>🔎 Ver en Cuentas</button>`;
  return `<div class="hjscrim" id="hjsheet"><div class="hjsheet" role="dialog" aria-modal="true" aria-label="${esc(r.e)}">
    <div class="hjsheet-h"><b>${brandBadge(platOf(r.p), undefined, "hjlogo")} ${esc(r.e)}</b><button class="pbtn sm" type="button" data-hjclose="1" aria-label="Cerrar">✕</button></div>
    <p class="muted">${esc(r.pr)} · ${info}</p>
    ${r.n ? `<p class="hjnoteview">📝 ${esc(r.n)}</p>` : ""}
    ${mine.map((o) => `<p class="hjpend">⏳ ${esc(opText(o))}: se sube cuando vuelva internet</p>`).join("")}
    <div class="hjbtns">${btns}</div>
    <div id="hjform"></div>
    ${off ? `<p class="muted hjoffnote">📶 Sin internet: «Me pagó», «Cambiar fecha» y «Nota» se guardan acá y se suben solos. Cortar y Ver en Cuentas necesitan internet.</p>` : ""}
  </div></div>`;
}
function openSheet(key) {
  const r = findRow(key);
  if (!r) return;
  closeSheet();
  document.getElementById("hj")?.insertAdjacentHTML("beforeend", sheetHtml(r));
  document.querySelector("#hjsheet [data-hjclose]")?.focus();
}
const closeSheet = () => document.getElementById("hjsheet")?.remove();

/** Hace el cambio ya; si no hay señal, lo deja anotado con ⏳ para subirlo después. */
async function runOrQueue(r, t, v) {
  const op = { k: newKey(), t, a: r.a, v, who: r.cn, e: r.e, at: Date.now(), base: { x: r.x, pay: r.pay, n: r.n } };
  if (!offline()) {
    try {
      const res = await doOp(op);
      closeSheet();
      if (t === "pay") {
        if (res === null) { toast("No se anotó nada"); return; }
        toast(`✅ Renovado hasta ${fdate(res.to)}`);
        await CTX.render();
        const p = payer(r);
        avisoRenovada(p.phone, p.name, [{ product: r.p, email: r.e, to: res.to }]);
        return;
      }
      toast(t === "date" ? `📅 Nueva fecha: ${fdate(v)}` : "📝 Nota guardada");
      return CTX.render();
    } catch (e) {
      if (e.status === 401) return CTX.render();
      if (!netErr(e)) { toast(e.message); return; }
      op.sent = true; // ya salió una vez: al reintentar no se compara (la llave evita cobrar dos veces)
      OFF = true;
    }
  }
  saveQ([...queue(), op]);
  closeSheet();
  toast("⏳ Anotado en este aparato: se sube solo cuando vuelva internet");
  paint();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", async (ev) => {
    if (ev.target.id === "hjsheet") return closeSheet();
    const el = ev.target.closest("[data-hjtab], [data-hjrow], [data-hjpay], [data-hjdate], [data-hjnote], [data-hjclose], [data-hjdrop]");
    if (!el || !el.closest("#hj")) return;
    const d = el.dataset;
    if (d.hjtab) { ST.t = d.hjtab; paint(); document.querySelector("#hj .hjtop")?.scrollIntoView({ block: "start" }); return; }
    if (d.hjclose) return closeSheet();
    if (d.hjdrop) { saveQ(queue().filter((o) => o.k !== d.hjdrop)); return paint(); }
    if (d.hjrow) return openSheet(d.hjrow);
    const r = D?.rows.find((x) => x.a === (d.hjpay || d.hjdate || d.hjnote));
    if (!r) return;
    if (d.hjpay) {
      if (offline() && !confirm(`Sin internet: «Me pagó» de ${r.cn} queda anotado en este aparato y se renueva 1 mes cuando vuelva la señal.\n\n¿Anotarlo?`)) return;
      el.disabled = true;
      return runOrQueue(r, "pay", null);
    }
    const form = document.getElementById("hjform");
    if (d.hjdate) form.innerHTML = `<form class="hjf" data-hjform="date" data-a="${esc(r.a)}"><label>Nueva fecha de vencimiento<input type="date" name="v" required value="${esc(yyyymmdd(r.x))}"></label><button class="pbtn green" type="submit">Guardar fecha</button></form>`;
    if (d.hjnote) form.innerHTML = `<form class="hjf" data-hjform="note" data-a="${esc(r.a)}"><label>Nota (la ven vos y tu equipo)<textarea name="v" maxlength="300" rows="3">${esc(r.n)}</textarea></label><button class="pbtn green" type="submit">Guardar nota</button></form>`;
    form.querySelector("input, textarea")?.focus();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && document.getElementById("hjsheet")) return closeSheet();
    const row = ev.target.closest?.("[data-hjrow]");
    if (row && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openSheet(row.dataset.hjrow); }
  });
  document.addEventListener("input", (ev) => { if (ev.target.id === "hjq") { ST.q = ev.target.value; paint(); } });
  // El formulario de la hoja se atiende acá (en captura, antes que el del panel).
  document.addEventListener("submit", (ev) => {
    const f = ev.target.closest?.("[data-hjform]");
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const r = D?.rows.find((x) => x.a === f.dataset.a);
    if (!r) return;
    if (f.dataset.hjform === "date") {
      const [y, m, dd] = f.v.value.split("-").map(Number);
      if (!y) return toast("Elegí una fecha");
      return runOrQueue(r, "date", new Date(y, m - 1, dd, 23, 59).getTime());
    }
    return runOrQueue(r, "note", f.v.value.trim().slice(0, 300));
  }, true);
  addEventListener("online", () => { OFF = false; hojasSync(); if (CTX.view() === "hojas") CTX.render(); });
  addEventListener("offline", () => { OFF = true; if (CTX.view() === "hojas") paint(); });
}

/** panel.js le pasa cómo leer quién entró, los ajustes y cómo volver a dibujar. */
export function hojasInit(ctx) { CTX = { ...CTX, ...ctx }; }
