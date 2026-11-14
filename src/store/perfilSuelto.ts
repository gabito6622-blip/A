// Perfil suelto comprado a otra persona (pedido del dueño, 16/11/2026). Gabriel no solo compra cuentas enteras a
// proveedores: también le compra PERFILES SUELTOS a gente como «Juan» (un perfil de Netflix a Bs 15 por mes). Antes los
// cargaba como «cuenta de 1 perfil», anotaba el gasto aparte, y si Juan le vendía un segundo perfil de la misma cuenta
// el panel decía «Esa cuenta ya está cargada». Acá viven, con un toque cada una:
//  - «➕ Compré un perfil»: plataforma, a quién (alta rápida del vendedor), cuánto (Bs o US$ con tasa), hasta cuándo y
//    los datos. Deja el GASTO con fecha y categoría «perfil suelto» y el perfil LIBRE para vender. Un segundo perfil de la
//    misma cuenta se agrega a esa cuenta.
//  - «⚠️ Se cayó» con tres salidas: «Me lo repuso» (datos nuevos y aviso al cliente), «Me devolvió Bs __» (devolución
//    del vendedor) y «Lo perdí». En las tres el cliente pasa a otro perfil libre de la misma plataforma o se le devuelve;
//    el perfil muerto queda retirado, nunca «Libre».
//  - «Le pagué a Juan»: renovar ese perfil con el monto de la última vez y la fecha.
//  - El resumen por vendedor del mes (compré, vendí, gané, caídas, devolvió) para «Proveedores por mes».
// Plata en centavos; los dólares en centavos de US$ con su tasa.
import type { Account, Actor, Cents, Expense, Id, LooseFall, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boMonthKey } from "./time.js";
import { normEmail } from "./inventario.js";
import { addAccount, updateAccount } from "./inventory.js";
import { addExpenseFull, addRefund, parseWhen, suggestedRate } from "./gastos.js";
import { refundAssignment, replaceAssignment } from "./orders.js";
import { usdToBs } from "./usd.js";
import { looseInfo } from "./perfilInfo.js";
import { plainMoveError } from "./vendible.js";
import { queue } from "./notify.js";

const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));
const fbs = (c: Cents) => `Bs ${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const PERIOD = 30 * DAY;
/** Sin tildes ni mayúsculas, para no dar de alta dos veces a «Juán» y «juan». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/** «AAAA-MM-DD» → las 23:59 de ese día en Bolivia; un número se usa tal cual. */
export function parseUntil(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) throw new DomainError("VALIDATION", "Fecha inválida (dd/mm/aaaa)");
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23 + 4, 59);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new DomainError("VALIDATION", "Fecha inválida");
  return n;
}

interface Money { amount?: unknown; currency?: unknown; rate?: unknown }
/** Lo que pagaste, en Bs (y los dólares con su tasa si fue en US$ o USDT). */
function moneyOf(e: Engine, m: Money): { cost: Cents; usd?: number; rate?: number; currency: "BOB" | "USD" | "USDT" } {
  const cur = m.currency === undefined || m.currency === null || m.currency === "" ? "BOB" : String(m.currency).toUpperCase();
  if (cur !== "BOB" && cur !== "USD" && cur !== "USDT") throw new DomainError("VALIDATION", "Moneda: Bs, US$ o USDT");
  const amt = Math.round(Number(m.amount));
  if (!Number.isInteger(amt) || amt <= 0 || amt > 10_000_000) throw new DomainError("VALIDATION", "Poné cuánto pagaste (mayor a 0)");
  if (cur === "BOB") return { cost: amt, currency: "BOB" };
  const rate = m.rate === undefined || m.rate === null || m.rate === "" ? suggestedRate(e) : Number(m.rate);
  if (!(Number.isFinite(rate) && rate >= 1 && rate <= 100)) throw new DomainError("VALIDATION", "Poné la tasa (Bs por dólar, de 1 a 100)");
  const r = Math.round(rate * 10_000) / 10_000;
  return { cost: usdToBs(amt, r), usd: amt, rate: r, currency: cur };
}

/** El vendedor: uno que ya existe (por id o por nombre, sin tildes) o uno nuevo con ese nombre («alta rápida»). */
export function vendorOf(e: Engine, actor: Actor, input: { supplierId?: unknown; supplierName?: unknown }): Id {
  if (input.supplierId) {
    const s = e.s.suppliers[String(input.supplierId)];
    if (!s) throw new DomainError("NOT_FOUND", "Vendedor no encontrado");
    if (!s.active) s.active = true; // le volviste a comprar: vuelve a estar activo
    return s.id;
  }
  const name = String(input.supplierName ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new DomainError("VALIDATION", "Poné a quién se lo compraste (p. ej. Juan)");
  if (name.length > 60) throw new DomainError("VALIDATION", "El nombre del vendedor va hasta 60 letras");
  const found = Object.values(e.s.suppliers).find((s) => fold(s.name) === fold(name));
  if (found) { if (!found.active) found.active = true; return found.id; }
  authorize(actor, "supplier.manage");
  const id = e.id("sup");
  e.s.suppliers[id] = { id, name, active: true };
  e.audit(actor, "supplier.upsert", "supplier", id, { active: true, quick: true });
  return id;
}

/** Perfiles vivos (no retirados ni caídos) de una cuenta de perfiles sueltos. */
const aliveLoose = (e: Engine, accountId: Id) => Object.values(e.s.slots).filter((s) => s.accountId === accountId && s.loose && s.status !== "retired" && !s.loose.down);

/** El costo de la cuenta es la suma de sus perfiles vivos y vence cuando vence el último. */
export function syncLooseAccount(e: Engine, acc: Account): void {
  const alive = aliveLoose(e, acc.id);
  if (!alive.length) return;
  acc.cost = alive.reduce((t, s) => t + s.loose!.cost, 0);
  acc.supplierExpiresAt = Math.max(...alive.map((s) => s.loose!.until));
}

export interface BuyInput extends Money {
  productId?: unknown; supplierId?: unknown; supplierName?: unknown;
  email?: unknown; password?: unknown; label?: unknown; pin?: unknown;
  /** Hasta cuándo te lo vendió («AAAA-MM-DD»; sin dato, 30 días desde hoy). */
  until?: unknown;
  /** Cuándo le pagaste («AAAA-MM-DD»; sin dato, hoy). */
  date?: unknown;
}

/** «➕ Compré un perfil»: el gasto con fecha y el perfil libre para vender (en una cuenta nueva o en la que ya existe). */
export function buyProfile(e: Engine, actor: Actor, input: BuyInput) {
  authorize(actor, "inventory.manage");
  const productId = String(input.productId ?? "");
  const prod = e.s.products[productId];
  if (!prod) throw new DomainError("VALIDATION", "Elegí la plataforma");
  if (prod.kind === "iptv" || prod.kind === "combo") throw new DomainError("VALIDATION", "Los perfiles sueltos son de plataformas como Netflix o Disney");
  const email = normEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new DomainError("VALIDATION", "Revisá el correo de la cuenta");
  const password = String(input.password ?? "").trim();
  if (!password) throw new DomainError("VALIDATION", "Falta la clave de la cuenta");
  const label = String(input.label ?? "").trim() || "Perfil";
  if (label.length > 40) throw new DomainError("VALIDATION", "El nombre del perfil va hasta 40 letras");
  const pin = String(input.pin ?? "").trim();
  if (pin && !/^\d{1,8}$/.test(pin)) throw new DomainError("VALIDATION", "PIN: solo números, hasta 8");
  const money = moneyOf(e, input);
  const now = e.now();
  const paidAt = parseWhen(e, undefined, input.date);
  const until = parseUntil(input.until, paidAt + PERIOD);
  if (until <= now) throw new DomainError("VALIDATION", "La fecha «hasta cuándo» ya pasó: revisala");
  if (until - paidAt > 400 * DAY) throw new DomainError("VALIDATION", "La fecha «hasta cuándo» está a más de un año: revisala");
  return e.tx(() => {
    const supplierId = vendorOf(e, actor, input);
    const supName = e.s.suppliers[supplierId].name;
    const same = Object.values(e.s.accounts).find((a) => a.status === "active" && a.productId === productId && normEmail(a.email) === email);
    let acc: Account, slot: Slot, added = false;
    let warning: string | undefined;
    const loose = { supplierId, cost: money.cost, ...(money.usd ? { usd: money.usd, rate: money.rate } : {}), until, boughtAt: paidAt };
    if (same) {
      if (!same.loose) throw new DomainError("VALIDATION", `Esa cuenta ya está cargada como cuenta entera (${same.email}). Si Juan te vendió un perfil de OTRA cuenta, revisá el correo.`);
      if (same.fallen) throw new DomainError("INVALID_STATE", "Esa cuenta está marcada como caída: si volvió a funcionar, tocá «✅ Volvió a funcionar» primero");
      const taken = Object.values(e.s.slots).find((s) => s.accountId === same.id && s.status !== "retired" && !s.loose?.down && s.label.toLowerCase() === label.toLowerCase());
      if (taken) throw new DomainError("VALIDATION", `Esa cuenta ya tiene un perfil «${taken.label}»: si es otro, poné su nombre (p. ej. «Perfil 2»)`);
      if (Object.values(e.s.slots).filter((s) => s.accountId === same.id).length >= 20) throw new DomainError("VALIDATION", "Máximo 20 perfiles por cuenta");
      // La clave cambió: los clientes de esa cuenta ven la nueva y reciben el aviso (sin la clave).
      if (password !== same.password) { updateAccount(e, actor, same.id, { password }); warning = "La clave de esa cuenta cambió: a los que ya estaban adentro les dejamos el aviso"; }
      slot = { id: e.id("slt"), accountId: same.id, productId, label, ...(pin ? { pin } : {}), status: "available", loose };
      e.s.slots[slot.id] = slot;
      e.audit(actor, "slot.add", "slot", slot.id, { accountId: same.id, loose: true });
      acc = same; added = true;
    } else {
      const r = addAccount(e, actor, { productId, supplierId, email, password, supplierExpiresAt: until, cost: money.cost, profiles: [{ label, ...(pin ? { pin } : {}) }] }) as ReturnType<typeof addAccount> & { warning?: string };
      acc = e.s.accounts[r.account.id];
      acc.loose = true;
      slot = e.s.slots[r.slots[0].id];
      slot.loose = loose;
      warning = r.warning;
    }
    syncLooseAccount(e, acc);
    const exp = addExpenseFull(e, actor, {
      amount: money.usd ?? money.cost, currency: money.currency, ...(money.rate ? { rate: money.rate } : {}),
      note: `Perfil ${prod.name} (${label}) de ${supName}`.slice(0, 120), category: "perfil", supplierId, accountId: acc.id, date: input.date,
    });
    tagExpense(e, exp.id, slot.id, "compra", until, paidAt);
    e.audit(actor, "loose.buy", "slot", slot.id, { accountId: acc.id, supplierId, cost: money.cost, until, added });
    return {
      accountId: acc.id, slotId: slot.id, email: acc.email, label, product: prod.name, supplierId, supplierName: supName,
      cost: money.cost, until, added, profiles: aliveLoose(e, acc.id).length, expenseId: exp.id,
      text: `${added ? `Se agregó a la cuenta ${acc.email}` : "Perfil cargado"}: libre para vender. Gasto ${fbs(money.cost)} anotado el ${fdate(paidAt).slice(0, 5)} (perfil suelto, ${supName}).`,
      ...(warning ? { warning } : {}),
    };
  });
}

/** Deja el gasto atado al perfil (para el resumen y para no estimarlo de nuevo) y con los meses que cubre. */
function tagExpense(e: Engine, expenseId: Id, slotId: Id, kind: "compra" | "renovacion", until: number, paidAt: number): Expense {
  const x = (e.s.expenses ?? []).find((g) => g.id === expenseId)!;
  x.slotId = slotId; x.looseKind = kind;
  const months = Math.min(12, Math.max(1, Math.round((until - paidAt) / PERIOD)));
  if (months > 1) { x.months = months; x.coversUntil = until; }
  return x;
}

const looseSlot = (e: Engine, slotId: Id): Slot => {
  const s = e.get("slots", slotId);
  if (!s.loose) throw new DomainError("VALIDATION", "Ese perfil no es un perfil suelto comprado");
  return s;
};
const activeOn = (e: Engine, slotId: Id) => Object.values(e.s.assignments).find((a) => a.slotId === slotId && a.status === "active");

export interface DownInput extends Money {
  /** «repuso» = me lo repuso (datos nuevos), «devolvio» = me devolvió plata, «perdi» = lo perdí. */
  outcome?: unknown;
  /** Me lo repuso: los datos nuevos (si el correo es el mismo, solo cambia la clave / el perfil / el PIN). */
  email?: unknown; password?: unknown; label?: unknown; pin?: unknown;
  /** Qué hacer con el cliente que estaba adentro: pasarlo a otro perfil libre (por defecto) o devolverle plata. */
  client?: unknown; clientAmount?: unknown; clientCash?: unknown;
  date?: unknown;
}

/**
 * «⚠️ Se cayó» un perfil suelto. Las tres salidas dejan el perfil muerto RETIRADO (nunca «Libre») y el cliente que estaba
 * adentro pasa a otro perfil libre de la misma plataforma (o, si elegís, se le devuelve). Si no hay ningún perfil libre,
 * el cliente queda en Reubicar con el motivo «perfil caído» (y no se le puede renovar hasta moverlo).
 */
export function looseDown(e: Engine, actor: Actor, slotId: Id, input: DownInput) {
  authorize(actor, "inventory.manage");
  authorize(actor, "assignment.replace");
  const outcome = String(input.outcome ?? "");
  if (outcome !== "repuso" && outcome !== "devolvio" && outcome !== "perdi") throw new DomainError("VALIDATION", "Elegí qué pasó: me lo repuso, me devolvió plata o lo perdí");
  const client = input.client === "devolver" ? "devolver" : "mover";
  return e.tx(() => {
    const slot = looseSlot(e, slotId);
    if (slot.loose!.down || slot.status === "retired") throw new DomainError("INVALID_STATE", "Ese perfil ya está dado de baja");
    const acc = e.get("accounts", slot.accountId);
    const prod = e.s.products[slot.productId];
    const sup = e.s.suppliers[slot.loose!.supplierId];
    const asg = activeOn(e, slot.id);
    const fall: LooseFall = { at: e.now(), outcome };
    const out: { outcome: string; moved: Id[]; refundedClient?: Cents; stuck?: string; inPlace?: boolean; newSlotId?: Id; refund?: Cents; text: string } = { outcome, moved: [], text: "" };
    const reason = `Se cayó el perfil de ${sup?.name ?? "el vendedor"}`;

    if (outcome === "repuso") {
      const email = input.email ? normEmail(input.email) : acc.email;
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new DomainError("VALIDATION", "Revisá el correo nuevo");
      const password = String(input.password ?? "").trim();
      const label = String(input.label ?? "").trim() || slot.label;
      const pin = input.pin === undefined ? undefined : String(input.pin).trim();
      if (pin && !/^\d{1,8}$/.test(pin)) throw new DomainError("VALIDATION", "PIN: solo números, hasta 8");
      if (email === acc.email && label.toLowerCase() === slot.label.toLowerCase()) {
        // El mismo perfil con otra clave o PIN: se arregla en el lugar y el cliente recibe el aviso de datos nuevos.
        if (!password && pin === undefined) throw new DomainError("VALIDATION", "Pegá la clave nueva (o el PIN nuevo) que te pasó");
        const pwChanged = !!password && password !== acc.password;
        if (pwChanged) updateAccount(e, actor, acc.id, { password }); // avisa a todos los de esa cuenta (sin la clave)
        if (pin !== undefined && pin !== (slot.pin ?? "")) {
          slot.pin = pin || undefined;
          if (asg && !pwChanged) {
            asg.history.push({ at: e.now(), by: actor.id, event: "access_updated", slotId: slot.id, note: "PIN nuevo" });
            queue(e, asg.customerId, "access_updated", { product: prod?.name ?? "" });
          }
        }
        (slot.loose!.falls ??= []).push(fall);
        out.inPlace = true;
        if (asg) out.moved.push(asg.id);
        out.text = `Listo: ${label} quedó con los datos nuevos.${asg ? " Mandale los datos al cliente." : ""}`;
        e.audit(actor, "loose.down", "slot", slot.id, { outcome, inPlace: true });
        return out;
      }
      if (!password) throw new DomainError("VALIDATION", "Pegá la clave de la cuenta nueva");
      // Otro perfil (otra cuenta u otro nombre): queda como un perfil suelto nuevo del mismo vendedor, con el mismo costo y fecha.
      const target = Object.values(e.s.accounts).find((a) => a.status === "active" && a.productId === slot.productId && normEmail(a.email) === email);
      let fresh: Slot;
      const loose = { ...slot.loose!, prev: slot.id };
      delete loose.falls; delete loose.down;
      if (target) {
        if (!target.loose) throw new DomainError("VALIDATION", `Esa cuenta (${target.email}) ya está cargada como cuenta entera: revisá el correo`);
        if (Object.values(e.s.slots).some((s) => s.accountId === target.id && s.status !== "retired" && !s.loose?.down && s.label.toLowerCase() === label.toLowerCase())) throw new DomainError("VALIDATION", `Esa cuenta ya tiene un perfil «${label}»: poné el nombre del perfil nuevo`);
        if (password !== target.password) updateAccount(e, actor, target.id, { password });
        fresh = { id: e.id("slt"), accountId: target.id, productId: slot.productId, label, ...(pin ? { pin } : {}), status: "available", loose };
        e.s.slots[fresh.id] = fresh;
        syncLooseAccount(e, target);
      } else {
        const r = addAccount(e, actor, { productId: slot.productId, supplierId: slot.loose!.supplierId, email, password, supplierExpiresAt: Math.max(slot.loose!.until, e.now() + DAY), cost: slot.loose!.cost, profiles: [{ label, ...(pin ? { pin } : {}) }] });
        const na = e.s.accounts[r.account.id];
        na.loose = true;
        fresh = e.s.slots[r.slots[0].id];
        fresh.loose = { ...loose, until: Math.max(loose.until, e.now() + DAY) };
        syncLooseAccount(e, na);
      }
      out.newSlotId = fresh.id;
      if (asg) { replaceAssignment(e, actor, asg.id, { reason, oldSlot: "retired", toSlotId: fresh.id }); out.moved.push(asg.id); }
      slot.status = "retired";
      out.text = `Listo: el perfil nuevo quedó cargado${asg ? " y el cliente ya está ahí. Mandale los datos nuevos." : " y libre para vender."}`;
    } else {
      if (outcome === "devolvio") {
        const m = moneyOf(e, input);
        const ref = addRefund(e, actor, { amount: m.usd ?? m.cost, currency: m.currency, ...(m.rate ? { rate: m.rate } : {}), supplierId: slot.loose!.supplierId, accountId: acc.id, note: `Devolución perfil ${prod?.name ?? ""} (${slot.label})`.slice(0, 120), at: input.date });
        const x = (e.s.expenses ?? []).find((g) => g.id === ref.id)!;
        x.category = "perfil"; x.slotId = slot.id;
        fall.refund = m.cost; out.refund = m.cost;
      }
      if (asg) {
        if (client === "devolver") {
          const amt = input.clientAmount === undefined || input.clientAmount === null || input.clientAmount === "" ? undefined : Math.round(Number(input.clientAmount));
          const r = refundAssignment(e, actor, asg.id, { amount: amt, cash: input.clientCash === true, slotFallen: true, reason: `${reason}: devolución` });
          out.refundedClient = r.amount;
          slot.status = "retired";
        } else {
          try {
            replaceAssignment(e, actor, asg.id, { reason, oldSlot: "retired" });
            out.moved.push(asg.id);
          } catch (err) {
            // Sin perfil libre: queda en Reubicar («perfil caído») hasta que cargues otro.
            out.stuck = plainMoveError(e, err, slot.productId);
          }
        }
      } else slot.status = "retired";
      const what = outcome === "devolvio" ? `Devolución de ${fbs(out.refund!)} anotada (resta de tus gastos).` : "Quedó anotado como perdido.";
      const who = !asg ? "" : out.refundedClient !== undefined ? ` Al cliente le devolviste ${fbs(out.refundedClient)}.` : out.stuck ? ` ${out.stuck}` : " El cliente ya está en otro perfil: mandale los datos nuevos.";
      out.text = `${what} El perfil quedó dado de baja.${who}`;
    }
    slot.loose!.down = fall;
    (slot.loose!.falls ??= []).push(fall);
    // La cuenta sin perfiles vivos ni clientes adentro se retira sola (deja de contar su costo y de venderse).
    syncLooseAccount(e, acc);
    const busy = Object.values(e.s.slots).some((s) => s.accountId === acc.id && (s.status === "assigned" || s.status === "reserved"));
    if (!aliveLoose(e, acc.id).length && !busy && acc.status === "active") {
      acc.status = "retired";
      for (const s of Object.values(e.s.slots)) if (s.accountId === acc.id && s.status !== "retired") s.status = "retired";
      e.audit(actor, "account.retire", "account", acc.id, { reason: "Perfil suelto caído" });
    }
    e.audit(actor, "loose.down", "slot", slot.id, { outcome, client, moved: out.moved.length, ...(out.refund ? { refund: out.refund } : {}), ...(out.refundedClient !== undefined ? { refundedClient: out.refundedClient } : {}), ...(out.stuck ? { stuck: true } : {}) });
    return out;
  });
}

export interface PayInput extends Money { months?: unknown; date?: unknown; until?: unknown; confirmOther?: unknown }

/** «Le pagué a Juan»: renovar ese perfil. Sugiere lo mismo de la última vez; corre «hasta cuándo» 30 días por mes. */
export function payLoose(e: Engine, actor: Actor, slotId: Id, input: PayInput) {
  authorize(actor, "inventory.manage");
  const months = input.months === undefined || input.months === null || input.months === "" ? 1 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new DomainError("VALIDATION", "Meses: de 1 a 12");
  return e.tx(() => {
    const slot = looseSlot(e, slotId);
    if (slot.loose!.down || slot.status === "retired") throw new DomainError("INVALID_STATE", "Ese perfil ya se dio de baja: comprá otro con «➕ Compré un perfil»");
    const acc = e.get("accounts", slot.accountId);
    const sup = e.s.suppliers[slot.loose!.supplierId];
    const m = input.amount === undefined || input.amount === null || input.amount === ""
      ? { cost: slot.loose!.cost * months, ...(slot.loose!.usd ? { usd: slot.loose!.usd * months, rate: slot.loose!.rate } : {}), currency: (slot.loose!.usd ? "USD" : "BOB") as "BOB" | "USD" | "USDT" }
      : moneyOf(e, input);
    const paidAt = parseWhen(e, undefined, input.date);
    // Pagar dos veces el mismo mes por error: se pregunta antes.
    const prev = (e.s.expenses ?? []).filter((x) => x.slotId === slot.id && !x.refund && x.looseKind === "renovacion").sort((a, b) => b.at - a.at)[0];
    if (prev && Math.abs(paidAt - prev.at) < 10 * DAY && input.confirmOther !== true) throw new DomainError("DOUBLE_CHARGE", `Ya le pagaste a ${sup?.name ?? "tu vendedor"} este perfil el ${fdate(prev.at).slice(0, 5)} (${fbs(prev.amount)}). ¿Es otro mes?`);
    const base = slot.loose!.until < e.now() - 3 * DAY ? e.now() : slot.loose!.until;
    const until = parseUntil(input.until, base + months * PERIOD);
    if (until <= e.now()) throw new DomainError("VALIDATION", "La fecha nueva ya pasó: revisala");
    const exp = addExpenseFull(e, actor, {
      amount: m.usd ?? m.cost, currency: m.currency, ...(m.rate ? { rate: m.rate } : {}),
      note: `Renové perfil ${e.s.products[slot.productId]?.name ?? ""} (${slot.label}) con ${sup?.name ?? "el vendedor"}`.slice(0, 120), category: "perfil", supplierId: slot.loose!.supplierId, accountId: acc.id, date: input.date,
    });
    const x = tagExpense(e, exp.id, slot.id, "renovacion", until, paidAt);
    if (months > 1) { x.months = months; x.coversUntil = until; }
    slot.loose!.until = until;
    slot.loose!.cost = Math.round((m.cost) / months);
    if (m.usd) { slot.loose!.usd = Math.round(m.usd / months); slot.loose!.rate = m.rate; } else { delete slot.loose!.usd; delete slot.loose!.rate; }
    syncLooseAccount(e, acc);
    e.audit(actor, "loose.pay", "slot", slot.id, { amount: x.amount, months, until });
    return { slotId: slot.id, expenseId: x.id, amount: x.amount, until, text: `Anotado: le pagaste ${fbs(x.amount)} a ${sup?.name ?? "tu vendedor"} el ${fdate(paidAt).slice(0, 5)}. El perfil sigue hasta el ${fdate(until).slice(0, 5)}.` };
  });
}

/** La ficha del perfil (para el panel). */
export function looseCard(e: Engine, actor: Actor, slotId: Id) {
  authorize(actor, "inventory.manage");
  const s = looseSlot(e, slotId);
  return { slotId: s.id, label: s.label, accountId: s.accountId, email: e.s.accounts[s.accountId]?.email ?? "", product: e.s.products[s.productId]?.name ?? s.productId, status: s.status, ...looseInfo(e, s)! };
}

/** Vendedores de perfiles sueltos para el formulario (nombre e id), los que más usás primero. */
export function looseVendors(e: Engine, actor: Actor) {
  authorize(actor, "inventory.manage");
  const uses = new Map<Id, number>();
  for (const s of Object.values(e.s.slots)) if (s.loose) uses.set(s.loose.supplierId, (uses.get(s.loose.supplierId) ?? 0) + 1);
  return Object.values(e.s.suppliers).filter((s) => s.active && s.id !== "propias")
    .map((s) => ({ id: s.id, name: s.name, loose: uses.get(s.id) ?? 0 }))
    .sort((a, b) => b.loose - a.loose || a.name.localeCompare(b.name, "es"));
}

export interface LooseMonthRow { compre: number; compreBs: Cents; renoveBs: Cents; vendi: number; vendiBs: Cents; caidas: number; devolvio: Cents; gane: Cents }

/**
 * Perfiles sueltos de un mes por vendedor: cuántos compraste y cuánto pagaste (compras y renovaciones), cuántos cobros
 * entraron por clientes que estaban en esos perfiles y cuánto, cuántas caídas y cuánto te devolvieron. `gane` = lo que
 * entró − lo que pagaste + lo devuelto. `incomeBySlot`: lo que entró ese mes por perfil (proveedoresMes.ts).
 */
export function looseMonth(e: Engine, key: string, incomeBySlot: Map<Id, { n: number; amount: Cents }>): Map<Id, LooseMonthRow> {
  const out = new Map<Id, LooseMonthRow>();
  const row = (id: Id) => { let r = out.get(id); if (!r) { r = { compre: 0, compreBs: 0, renoveBs: 0, vendi: 0, vendiBs: 0, caidas: 0, devolvio: 0, gane: 0 }; out.set(id, r); } return r; };
  for (const x of e.s.expenses ?? []) {
    if (!x.slotId || boMonthKey(x.at) !== key) continue;
    const sid = x.supplierId ?? e.s.slots[x.slotId]?.loose?.supplierId;
    if (!sid) continue;
    const r = row(sid);
    if (x.refund) r.devolvio += x.amount;
    else if (x.looseKind === "compra") { r.compre++; r.compreBs += x.amount; }
    else r.renoveBs += x.amount;
  }
  for (const s of Object.values(e.s.slots)) {
    if (!s.loose) continue;
    for (const f of s.loose.falls ?? []) if (boMonthKey(f.at) === key) row(s.loose.supplierId).caidas++;
    const inc = incomeBySlot.get(s.id);
    if (inc) { const r = row(s.loose.supplierId); r.vendi += inc.n; r.vendiBs += inc.amount; }
  }
  for (const r of out.values()) r.gane = r.vendiBs - r.compreBs - r.renoveBs + r.devolvio;
  return out;
}
