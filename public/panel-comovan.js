// 📈 Cómo van tus revendedores: quién crece, quién baja y quién se te está por ir, con un
// WhatsApp listo para cada uno. Solo dueño y admin (el servidor responde 403 a los demás).
// Nada se manda solo: "Escribirle" abre el WhatsApp de UNA persona con el mensaje escrito.
import { api, esc, bs, fdate, waLink, icon } from "/common.js";

const ST = {
  creciendo: { t: "📈 Creciendo", k: "ok" },
  estable: { t: "➖ Estable", k: "mute" },
  bajando: { t: "📉 Bajando", k: "warn" },
  dormido: { t: "💤 Dormido", k: "bad" },
  nuevo: { t: "🌱 Nuevo", k: "new" },
};
const ORDER = ["creciendo", "estable", "bajando", "dormido", "nuevo"];

/** Mensaje sugerido según cómo viene. Voseo, sin urgencias ni datos de cuentas. */
export function suggestMsg(r) {
  const n = (r.name || "").split(" ")[0];
  return {
    creciendo: `¡Hola ${n}! 👋 Vi que te está yendo muy bien con tus cuentas. ¡Felicitaciones y gracias por confiar en nosotros! 🙌 Si necesitás algo para seguir creciendo, avisame.`,
    bajando: `¡Hola ${n}! 👋 ¿Cómo va todo? Te escribo para ver si te ayudo con algo. ¿Tus clientes están renovando? Si algo te complica, contame y lo vemos juntos.`,
    dormido: `¡Hola ${n}! 👋 Te extrañamos por acá. ¿Te armo algo? Si querés, te paso los precios de hoy.`,
    nuevo: `¡Hola ${n}! 👋 ¿Cómo te va con tus primeras cuentas? Si tenés alguna duda o algo no anda, escribime y te ayudo.`,
    estable: `¡Hola ${n}! 👋 ¿Cómo va todo? Cualquier cosa que necesites, acá estoy.`,
  }[r.status];
}

const chip = (s) => `<span class="cv-chip cv-${ST[s].k}">${ST[s].t}</span>`;
/** "↑ Bs 120 (+12 %)" con color; sin base para comparar dice solo el monto. */
const delta = (d, p) => {
  if (!d) return `<span class="muted">= igual</span>`;
  const cls = d > 0 ? "up" : "down", arrow = d > 0 ? "↑" : "↓";
  return `<span class="${cls}">${arrow} ${bs(Math.abs(d))}${p === null || p === undefined ? "" : ` (${p > 0 ? "+" : ""}${p} %)`}</span>`;
};
const ago = (t, now) => {
  if (!t) return "nunca";
  const d = Math.floor((now - t) / 86_400_000);
  return `${fdate(t)} (${d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`})`;
};
const mix = (r) => r.active.length ? r.active.map((a) => `${esc(a.name)} ×${a.count}`).join(", ") : "Sin alquileres activos";

export async function comoVanView(T) {
  const d = await api("GET", "/api/admin/resellers/overview");
  const t = d.totals, now = d.at;
  const f = ORDER.includes(T.cvf) ? T.cvf : "todos";
  const shown = d.list.filter((r) => f === "todos" || r.status === f);
  // 14/11/2026: un solo período a la vista, «este mes» (del día 1 a hoy). El estado (creciendo, bajando…) sigue
  // comparando 30 días contra 30 días para que el día 3 del mes no parezca que todos bajan; eso se explica abajo.
  const tm = t.month ?? { paid: t.thisMonth, profit: null, cost: 0, fromControl: 0, fromFiado: 0, concentration: t.concentration, dropped: t.dropped };
  const debt = t.debt ?? { total: 0, fiado: 0, pending: 0, people: 0 };
  const max = Math.max(1, ...d.list.map((r) => r.thisMonth));
  const conc = tm.concentration;
  const concNames = conc.names.length > 1 ? `${conc.names.slice(0, -1).join(", ")} y ${conc.names.at(-1)}` : conc.names[0] ?? "";

  const kpis = `<section class="card cv-head" aria-label="Resumen de este mes">
    <p class="cv-period"><b>📅 Este mes</b> <span class="muted">· del ${fdate(d.monthStart).slice(0, 5)} a hoy</span></p>
    <div class="cv-kpis cv4">
      <div class="cv-kpi"><small>Te pagaron este mes</small><b>${bs(t.thisMonth)}</b>
        <span>${t.prevMonthToDate || t.thisMonth ? `${delta(t.change, t.changePct)} <span class="muted">vs el mes pasado a esta altura</span>` : `<span class="muted">Todavía sin pagos</span>`}</span>
        <span class="muted">Mes pasado completo: ${bs(t.prevMonth)}</span>
        ${tm.fromControl || tm.fromFiado ? `<span class="muted">Incluye ${tm.fromControl ? `${bs(tm.fromControl)} marcados 💵 en el Control` : ""}${tm.fromControl && tm.fromFiado ? " y " : ""}${tm.fromFiado ? `${bs(tm.fromFiado)} de pagos del fiado` : ""}</span>` : ""}</div>
      <div class="cv-kpi"><small>Ganancia estimada este mes</small><b class="${tm.profit > 0 ? "up" : tm.profit < 0 ? "down" : ""}">${tm.profit === null ? "—" : bs(tm.profit)}</b>
        <span class="muted">Lo que te pagaron menos lo que te cuestan esas cuentas (${bs(tm.cost)}, estimado con el costo de tus cuentas)</span></div>
      <div class="cv-kpi"><small>Te deben hoy</small><b class="${debt.total ? "down" : ""}">${bs(debt.total)}</b>
        <span class="muted">${debt.total ? `Fiado ${bs(debt.fiado)} · sin pagar en el Control ${bs(debt.pending)} · ${debt.people} revendedor(es)` : "Nadie te debe 🎉"}</span></div>
      <div class="cv-kpi"><small>Vence en 7 días</small><b>${bs(t.due7.amount)}</b>
        <span class="muted">${t.due7.count} alquiler(es) a su precio</span>
        <span class="muted">${conc.pct === null ? "Sin pagos este mes" : `${esc(concNames)} ${conc.topN > 1 ? "son" : "es"} el ${conc.pct} % de lo que te pagaron este mes`}</span>
        ${tm.dropped?.count ? `<span class="muted">Se les cayeron ${tm.dropped.count} alquiler(es) este mes (${bs(tm.dropped.amount)})</span>` : ""}</div>
    </div></section>`;

  const chips = `<div class="tabs ctl-chips cv-filters" role="tablist" aria-label="Filtrar por estado">${[["todos", `Todos (${d.list.length})`], ...ORDER.map((s) => [s, `${ST[s].t} (${t.byStatus[s]})`])]
    .map(([k, txt]) => `<button type="button" role="tab" data-tab="cvf:${k}" aria-selected="${f === k}">${txt}</button>`).join("")}</div>`;

  const row = (r) => {
    const msg = suggestMsg(r);
    const w = Math.round((r.thisMonth / max) * 100);
    const m = r.month ?? { paid: r.thisMonth, profit: null, renewalsOnTime: r.renewalsOnTime, renewalsLate: r.renewalsLate, dropped: r.dropped, droppedAmount: r.droppedAmount };
    const dt = r.debt ?? { total: 0, fiado: 0, pending: 0 };
    return `<li><details class="cv-row" data-cv="${esc(r.id)}">
      <summary><span class="cv-top"><b class="cv-name">${esc(r.name)}</b>${chip(r.status)}<b class="cv-amt">${bs(r.thisMonth)}</b></span>
        ${r.topupsMonth !== undefined ? `<small class="cv-topup">💰 recargó ${bs(r.topupsMonth)} este mes</small>` : ""}
        <span class="cv-bar" aria-hidden="true"><i style="width:${r.thisMonth ? Math.max(w, 2) : 0}%"></i></span>
        <small class="muted cv-mix">${mix(r)}${dt.total ? ` · <b class="down">te debe ${bs(dt.total)}</b>` : ""}</small></summary>
      <div class="cv-det">
        <small class="muted">Todo es de este mes (del día 1 a hoy), salvo lo que te debe, que es a hoy.</small>
        <dl class="cv-grid">
          <div><dt>Te pagó</dt><dd>${bs(r.thisMonth)} ${r.thisMonth || r.prevMonthToDate ? delta(r.change, r.changePct) : ""}</dd></div>
          ${r.topupsMonth !== undefined ? `<div><dt>Recargó este mes</dt><dd>${bs(r.topupsMonth)}<br><small class="muted">lo que te mandó a su saldo</small></dd></div>` : ""}
          <div><dt>Ganancia estimada</dt><dd class="${m.profit > 0 ? "up" : m.profit < 0 ? "down" : ""}">${m.profit === null ? "—" : bs(m.profit)}</dd></div>
          <div><dt>Te debe</dt><dd class="${dt.total ? "down" : ""}">${bs(dt.total)}${dt.total ? `<br><small class="muted">fiado ${bs(dt.fiado)} · Control ${bs(dt.pending)}</small>` : ""}</dd></div>
          <div><dt>Renovó a tiempo</dt><dd>${m.renewalsOnTime}</dd></div>
          <div><dt>Renovó tarde</dt><dd class="${m.renewalsLate ? "down" : ""}">${m.renewalsLate}</dd></div>
          <div><dt>Se le cayeron</dt><dd class="${m.dropped ? "down" : ""}">${m.dropped}${m.dropped ? ` · ${bs(m.droppedAmount)}` : ""}</dd></div>
          <div><dt>Le vence en 7 días</dt><dd>${r.due7.count}${r.due7.count ? ` · ${bs(r.due7.amount)}` : ""}</dd></div>
          <div><dt>Última compra</dt><dd>${ago(r.lastOrderAt, now)}</dd></div>
          <div><dt>Último ingreso</dt><dd>${r.lastLoginAt ? ago(r.lastLoginAt, now) : "nunca entró"}</dd></div>
        </dl>
        <p class="cv-msg"><small class="muted">Mensaje sugerido (lo podés cambiar antes de mandarlo):</small><br>${esc(msg)}</p>
        ${r.phone ? `<a class="pbtn green" href="${waLink(r.phone, msg)}" target="_blank" rel="noopener">${icon("wa")}Escribirle a ${esc((r.name || "").split(" ")[0])}</a>` : `<span class="pp pp-warn">Sin WhatsApp</span>`}
      </div></details></li>`;
  };

  return `${kpis}<section class="card cv-list-card"><h2>${icon("users")}Tus revendedores <small>ordenados por lo que te pagaron este mes</small></h2>
    ${chips}
    ${shown.length ? `<ul class="cv-list">${shown.map(row).join("")}</ul>` : `<div class="emptybox">${d.list.length ? "Ninguno en este estado." : "Todavía no tenés revendedores."}</div>`}
    <details class="cv-rules"><summary>¿Cómo se calcula?</summary>
      <p class="muted">Todos los montos son de <b>este mes</b> (del día 1 a hoy). Lo que te pagaron son sus compras y renovaciones entregadas (sin recargas de saldo, para no contarlas dos veces; lo que <b>recargó</b> este mes, la plata que de verdad te mandó a su saldo, va aparte al lado de cada uno) <b>más los alquileres que marcás 💵 cobrado en el Control y los pagos que anotás en el Fiado</b>. La <b>ganancia estimada</b> resta lo que te cuestan esos perfiles o cuentas, según el costo que cargaste en tus cuentas. <b>Te debe</b> es su fiado más los alquileres marcados «Pendiente» o «No pagó» en el Control, a hoy. Los cobros que ya habías marcado antes cuentan en el día que empezó ese mes de alquiler. Si ese mes ya tiene un pedido de renovación, la marca no se suma de nuevo. El estado de cada uno compara los últimos 30 días con los 30 anteriores: <b>Creciendo</b>: en 30 días te pagó ${d.rules.growPct} % más que en los 30 anteriores (y al menos ${bs(d.rules.minChange)}). <b>Bajando</b>: ${d.rules.dropPct} % menos, o se le cayeron más alquileres de los que renovó. <b>Dormido</b>: sin compras ni alquileres activos en 30 días. <b>Nuevo</b>: lo creaste hace menos de ${d.rules.newDays} días. Lo que tus revendedores anotan de sus clientes no se ve acá.</p></details>
  </section>`;
}
