// Perfiles sueltos comprados a otras personas (16/11/2026): «➕ Compré un perfil» (Inicio, Cuentas y Carga), la ficha del
// perfil («Te costó Bs 15 · lo vendiste a Bs 25 · ganás Bs 10»), «⚠️ Se cayó» con sus tres salidas y «Le pagué a Juan».
// La lógica de plata vive en el servidor (src/store/perfilSuelto.ts); acá solo los formularios. panel.js solo los llama.
import { api, esc, bs, toCents, fdate } from "/common.js";
import { sendqStart } from "/panel-caidas.js";

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");
const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
let C = null; // { render, go, P, toast }
let lastOk = "";

/** Botón «➕ Compré un perfil» (Inicio y Cuentas): lleva al formulario de Carga. */
export const perfilBtn = () => `<button class="pbtn sm" type="button" data-pfgo="1">➕ Compré un perfil</button>`;

/** Formulario «➕ Compré un perfil» (arriba de Carga de cuentas). */
export function perfilCompreCard(products, vendors, rate) {
  const prods = products.filter((p) => p.kind !== "iptv" && p.kind !== "combo");
  if (!prods.length) return "";
  return `<section class="card ok-card pf-card" id="pfCompre"><h2>➕ Compré un perfil <small>· a Juan, a Rosa…</small></h2>
    <p class="muted" style="margin:0">Un toque: queda el gasto con su fecha (categoría «perfil suelto») y el perfil <b>libre para vender</b>. Si es otro perfil de una cuenta que ya cargaste, se agrega a esa cuenta.</p>
    ${lastOk ? `<p class="pf-ok" role="status">✅ ${esc(lastOk)}</p>` : ""}
    <form class="form" data-pfform="buy" novalidate autocomplete="off">
      <label>Plataforma<select name="productId">${prods.map((p) => opt(p.id, p.name)).join("")}</select></label>
      <label>¿A quién se lo compraste?<input name="supplierName" list="pfVend" required placeholder="Ej.: Juan" maxlength="60"><datalist id="pfVend">${vendors.map((v) => `<option value="${esc(v.name)}"></option>`).join("")}</datalist></label>
      <label>¿Cuánto pagaste?<input name="amount" inputmode="decimal" required placeholder="Ej.: 15"></label>
      <label>Moneda<select name="currency">${opt("BOB", "Bs")}${opt("USD", "US$")}${opt("USDT", "USDT")}</select></label>
      <label class="pf-rate" hidden>Tasa (Bs por dólar)<input name="rate" inputmode="decimal" value="${esc(rate ? String(rate).replace(".", ",") : "")}"></label>
      <label>Le pagaste el<input type="date" name="date" value="${iso(Date.now())}" max="${iso(Date.now())}"></label>
      <label>Te lo vende hasta<input type="date" name="until" value="${iso(Date.now() + 30 * DAY)}"></label>
      <label style="grid-column:1/-1">Correo de la cuenta<input name="email" type="email" required placeholder="correo@gmail.com"></label>
      <label style="grid-column:1/-1">Clave<input name="password" required placeholder="clave de la cuenta"></label>
      <label>Perfil<input name="label" maxlength="40" placeholder="Ej.: Perfil 3"></label>
      <label>PIN <small class="muted">(opcional)</small><input name="pin" inputmode="numeric" maxlength="8"></label>
      <p class="pf-err" role="alert" hidden></p>
      <button class="pbtn dark" type="submit" style="grid-column:1/-1">➕ Guardar: gasto anotado y perfil libre</button>
    </form></section>`;
}

/** Ficha y acciones de un perfil suelto (dentro de la tarjeta del perfil, en Cuentas). */
export function perfilSlotCard(acc, sl, pname) {
  const l = sl.loose;
  if (!l || sl.status === "retired") return "";
  const who = esc(l.supplierName);
  const dead = !!l.down;
  const client = sl.status === "assigned" ? (sl.customerName || "el cliente").split(" ")[0] : "";
  return `<section class="card pf-slot"><h2>🧩 Perfil suelto de ${who}</h2>
    <p class="pf-ficha"><b>${esc(l.text)}</b></p>
    <p class="muted" style="margin:0">${dead ? "⚠️ Se cayó: el cliente está en Reubicar." : `Vence con ${who} el ${fdate(l.until)}`}${l.falls ? ` · se cayó ${l.falls} ${l.falls === 1 ? "vez" : "veces"}` : ""}</p>
    ${dead ? `<div class="inline"><button class="pbtn sm" type="button" data-go="reubicar">Ir a Reubicar</button></div>` : `
    <details class="pf-more"><summary>⚠️ Se cayó</summary>
      <form class="form pf-down" data-pfform="down" data-slot="${esc(sl.id)}" novalidate autocomplete="off">
        <fieldset class="pf-opts"><legend>¿Qué pasó?</legend>
          <label class="pf-opt"><input type="radio" name="outcome" value="repuso"> 🔁 ${who} me lo repuso</label>
          <label class="pf-opt"><input type="radio" name="outcome" value="devolvio"> 💚 Me devolvió plata</label>
          <label class="pf-opt"><input type="radio" name="outcome" value="perdi"> ❌ Lo perdí</label>
        </fieldset>
        <div class="pf-rep" hidden>
          <label>Correo<input name="email" type="email" value="${esc(acc.email)}"></label>
          <label>Clave nueva<input name="password" placeholder="la que te pasó ${who}"></label>
          <label>Perfil<input name="label" maxlength="40" value="${esc(sl.label)}"></label>
          <label>PIN <small class="muted">(opcional)</small><input name="pin" inputmode="numeric" maxlength="8"></label>
        </div>
        <label class="pf-dev" hidden>¿Cuánto te devolvió? (Bs)<input name="amount" inputmode="decimal" placeholder="Ej.: 10"></label>
        ${client ? `<fieldset class="pf-opts pf-cli" hidden><legend>¿Y ${esc(client)}?</legend>
          <label class="pf-opt"><input type="radio" name="client" value="mover" checked> ↔️ Pasarlo a otro perfil libre de ${esc(pname(acc.productId))}</label>
          <label class="pf-opt"><input type="radio" name="client" value="devolver"> ↩️ Devolverle plata</label>
          <div class="pf-cliback" hidden><label>¿Cuánto le devolvés? (Bs)<input name="clientAmount" inputmode="decimal" placeholder="lo que le faltaba"></label>
            <label class="chk"><input type="checkbox" name="clientCash" checked> En efectivo (si no, a su saldo)</label></div>
        </fieldset>` : ""}
        <p class="pf-err" role="alert" hidden></p>
        <button class="pbtn dark" type="submit">Guardar</button>
      </form></details>
    <details class="pf-more"><summary>💳 Le pagué a ${who}</summary>
      <form class="form" data-pfform="pay" data-slot="${esc(sl.id)}" novalidate autocomplete="off">
        <label>Monto (Bs)<input name="amount" inputmode="decimal" value="${esc(String(l.suggest / 100).replace(".", ","))}"></label>
        <label>Meses<select name="months">${[1, 2, 3, 6].map((m) => opt(m, m === 1 ? "1 mes" : `${m} meses`)).join("")}</select></label>
        <label>Le pagaste el<input type="date" name="date" value="${iso(Date.now())}" max="${iso(Date.now())}"></label>
        <p class="pf-err" role="alert" hidden></p>
        <button class="pbtn green" type="submit">💳 Anotar el pago</button>
      </form></details>`}
  </section>`;
}

/** Línea de perfiles sueltos de un vendedor en «Proveedores por mes». */
export function perfilMesLine(p) {
  if (!p) return "";
  return `<span class="pf-mes">🧩 Perfiles: compré <b>${p.compre}</b>${p.compreBs ? ` (${bs(p.compreBs)})` : ""}${p.renoveBs ? ` · renové ${bs(p.renoveBs)}` : ""} · vendí <b>${p.vendi}</b> (${bs(p.vendiBs)}) · <b class="${p.gane < 0 ? "down" : "up"}">${p.gane < 0 ? "perdiste" : "ganaste"} ${bs(Math.abs(p.gane))}</b>${p.caidas ? ` · ${p.caidas} caída${p.caidas === 1 ? "" : "s"}` : ""}${p.devolvio ? ` · te devolvió ${bs(p.devolvio)}` : ""}</span>`;
}

/* ---------------- eventos ---------------- */
function err(f, msg) { const p = f.querySelector(".pf-err"); if (p) { p.textContent = msg; p.hidden = !msg; } }
function syncDown(f) {
  const o = f.querySelector('[name="outcome"]:checked')?.value;
  f.querySelector(".pf-rep").hidden = o !== "repuso";
  f.querySelector(".pf-dev").hidden = o !== "devolvio";
  const cli = f.querySelector(".pf-cli");
  if (cli) { cli.hidden = !o || o === "repuso"; cli.querySelector(".pf-cliback").hidden = f.querySelector('[name="client"]:checked')?.value !== "devolver"; }
}
const money = (v) => { const c = toCents(v); return c && !Number.isNaN(c) && c > 0 ? c : 0; };

async function onSubmit(ev) {
  const f = ev.target, kind = f.dataset?.pfform;
  if (!kind) return;
  ev.preventDefault();
  err(f, "");
  const btn = f.querySelector('[type="submit"]');
  try {
    if (kind === "buy") {
      const amount = money(f.amount.value);
      if (!f.supplierName.value.trim()) { f.supplierName.focus(); throw new Error("Poné a quién se lo compraste (p. ej. Juan)"); }
      if (!amount) { f.amount.focus(); throw new Error("Poné cuánto pagaste"); }
      if (!f.email.value.trim()) { f.email.focus(); throw new Error("Poné el correo de la cuenta"); }
      if (!f.password.value.trim()) { f.password.focus(); throw new Error("Poné la clave"); }
      const body = { productId: f.productId.value, supplierName: f.supplierName.value.trim(), amount, currency: f.currency.value,
        ...(f.currency.value !== "BOB" ? { rate: Number(String(f.rate.value).replace(",", ".")) } : {}),
        date: f.date.value || undefined, until: f.until.value || undefined, email: f.email.value.trim(), password: f.password.value.trim(), label: f.label.value.trim(), pin: f.pin.value.trim() };
      if (btn) btn.disabled = true;
      const r = await api("POST", "/api/admin/perfiles-sueltos", body);
      lastOk = `${r.text}${r.warning ? ` ${r.warning}` : ""}`;
      C.toast(`✅ ${r.text}`);
      await C.render();
      document.querySelector("#pfCompre .pf-ok")?.focus?.();
      return;
    }
    if (kind === "down") {
      const o = f.querySelector('[name="outcome"]:checked')?.value;
      if (!o) throw new Error("Elegí qué pasó");
      const body = { outcome: o };
      if (o === "repuso") Object.assign(body, { email: f.email.value.trim(), password: f.password.value.trim(), label: f.label.value.trim(), ...(f.pin.value.trim() ? { pin: f.pin.value.trim() } : {}) });
      if (o === "devolvio") { const a = money(f.amount.value); if (!a) { f.amount.focus(); throw new Error("Poné cuánto te devolvió"); } body.amount = a; }
      const cli = f.querySelector('[name="client"]:checked')?.value;
      if (o !== "repuso" && cli === "devolver") Object.assign(body, { client: "devolver", ...(f.clientAmount.value ? { clientAmount: money(f.clientAmount.value) } : {}), clientCash: f.clientCash.checked });
      if (btn) btn.disabled = true;
      const r = await api("POST", `/api/admin/perfiles-sueltos/${encodeURIComponent(f.dataset.slot)}/caido`, body);
      C.P.tab.slotAct = "";
      if (r.moved?.length) { sendqStart(C.P, r.moved, { title: "perfil caído", note: `✅ ${r.text}` }); C.P.tab.cf = "todos"; C.go("control"); return; }
      C.toast(r.text);
      await C.render();
      return;
    }
    if (kind === "pay") {
      const amount = money(f.amount.value);
      if (!amount) { f.amount.focus(); throw new Error("Poné cuánto le pagaste"); }
      const body = { amount, months: Number(f.months.value) || 1, date: f.date.value || undefined };
      if (btn) btn.disabled = true;
      let r;
      try { r = await api("POST", `/api/admin/perfiles-sueltos/${encodeURIComponent(f.dataset.slot)}/pague`, body); }
      catch (e) {
        if (e.code !== "DOUBLE_CHARGE" && !/¿Es otro mes\?/.test(e.message)) throw e;
        if (!confirm(e.message)) { if (btn) btn.disabled = false; return; }
        r = await api("POST", `/api/admin/perfiles-sueltos/${encodeURIComponent(f.dataset.slot)}/pague`, { ...body, confirmOther: true });
      }
      C.toast(r.text);
      await C.render();
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    err(f, e.message || "No se pudo guardar");
  }
}

export function initPerfil(ctx) {
  if (C) return;
  C = ctx;
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", (ev) => {
    const f = ev.target.form;
    if (f?.dataset?.pfform === "down") syncDown(f);
    if (f?.dataset?.pfform === "buy" && ev.target.name === "currency") f.querySelector(".pf-rate").hidden = ev.target.value === "BOB";
  });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-pfgo]");
    if (!b) return;
    C.go("carga");
    for (let i = 0; i < 50; i++) { const f = document.querySelector('[data-pfform="buy"]'); if (f) { f.scrollIntoView({ block: "start" }); f.supplierName.focus(); break; } await new Promise((r) => setTimeout(r, 100)); }
  });
}
