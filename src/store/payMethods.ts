// Métodos de cobro por país (manuales, con comprobante): Yappy en Panamá, Tigo Money o giros en
// Paraguay, otra cuenta, etc. Cada método se muestra a los clientes de ciertas listas de precios
// (que es como se separan los países). El pago lo revisa una persona, igual que el QR.
import type { Actor, Id, LocalPayMethod } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export interface PayMethodInput {
  id?: Id;
  name: string;
  country?: string;
  account: string;
  holder?: string;
  instructions?: string;
  priceGroupIds?: Id[];
  replacesQr?: boolean;
  enabled?: boolean;
}

export function savePayMethod(e: Engine, actor: Actor, input: PayMethodInput): LocalPayMethod {
  authorize(actor, "catalog.manage");
  const name = txt(input.name, 40), account = txt(input.account, 120);
  if (name.length < 2) throw new DomainError("VALIDATION", "Poné el nombre del método (ej.: Yappy)");
  if (!account) throw new DomainError("VALIDATION", "Poné el número, alias o cuenta donde te pagan");
  const priceGroupIds = Array.isArray(input.priceGroupIds) ? [...new Set(input.priceGroupIds.map(String))] : [];
  for (const g of priceGroupIds) if (!e.s.priceGroups[g]) throw new DomainError("VALIDATION", `Lista de precios inexistente: ${g}`);
  return e.tx(() => {
    const list = (e.s.settings.payMethods ??= []);
    const prev = input.id ? list.find((m) => m.id === input.id) : undefined;
    if (input.id && !prev) throw new DomainError("NOT_FOUND", "Método de cobro inexistente");
    if (!prev && list.length >= 12) throw new DomainError("VALIDATION", "Máximo 12 métodos de cobro");
    const key = (n: string, c?: string) => `${n.toLowerCase()}|${(c ?? "").toLowerCase()}`;
    if (list.some((x) => x.id !== prev?.id && key(x.name, x.country) === key(name, txt(input.country, 30))))
      throw new DomainError("VALIDATION", `Ya tenés "${name}"${input.country ? ` para ${txt(input.country, 30)}` : ""}: editá ese en vez de crear otro`);
    const m: LocalPayMethod = {
      id: prev?.id ?? e.id("pm"), name, account,
      ...(txt(input.country, 30) ? { country: txt(input.country, 30) } : {}),
      ...(txt(input.holder, 60) ? { holder: txt(input.holder, 60) } : {}),
      ...(txt(input.instructions, 300) ? { instructions: txt(input.instructions, 300) } : {}),
      priceGroupIds, replacesQr: !!input.replacesQr, enabled: input.enabled ?? prev?.enabled ?? true,
      ...(prev?.qrFileRef ? { qrFileRef: prev.qrFileRef } : {}),
    };
    if (prev) list[list.indexOf(prev)] = m; else list.push(m);
    e.audit(actor, prev ? "paymethod.update" : "paymethod.create", "settings", m.id, { name: m.name, enabled: m.enabled });
    return structuredClone(m);
  });
}

/** Devuelve el archivo de QR anterior (para borrarlo del disco). */
export function setPayMethodQr(e: Engine, actor: Actor, id: Id, fileRef: string | null): { old?: string } {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const m = (e.s.settings.payMethods ?? []).find((x) => x.id === id);
    if (!m) throw new DomainError("NOT_FOUND", "Método de cobro inexistente");
    const old = m.qrFileRef;
    if (fileRef) m.qrFileRef = fileRef; else delete m.qrFileRef;
    e.audit(actor, "paymethod.qr", "settings", id, { name: m.name, removed: !fileRef });
    return old ? { old } : {};
  });
}

export function deletePayMethod(e: Engine, actor: Actor, id: Id): { old?: string } {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const list = e.s.settings.payMethods ?? [];
    const m = list.find((x) => x.id === id);
    if (!m) throw new DomainError("NOT_FOUND", "Método de cobro inexistente");
    e.s.settings.payMethods = list.filter((x) => x !== m);
    e.audit(actor, "paymethod.delete", "settings", id, { name: m.name });
    return m.qrFileRef ? { old: m.qrFileRef } : {};
  });
}

export function listPayMethods(e: Engine, actor: Actor): LocalPayMethod[] {
  authorize(actor, "catalog.manage");
  return structuredClone(e.s.settings.payMethods ?? []);
}

/** Los métodos que ve este cliente: activos y de su lista de precios (sin listas = todos). */
export function methodsFor(e: Engine, customerId: Id | undefined): LocalPayMethod[] {
  const g = customerId ? e.s.customers[customerId]?.priceGroupId : undefined;
  return (e.s.settings.payMethods ?? []).filter((m) => m.enabled && (!m.priceGroupIds.length || (!!g && m.priceGroupIds.includes(g))));
}

/** El QR de Bolivia se esconde si alguno de sus métodos lo reemplaza (ej.: clientes de Panamá pagan con Yappy). */
export const qrAllowedFor = (e: Engine, customerId: Id | undefined) => !methodsFor(e, customerId).some((m) => m.replacesQr);

/** Lo que ve el cliente en la tienda. */
export function myPayMethods(e: Engine, actor: Actor) {
  const id = actor.customerId;
  return {
    qr: qrAllowedFor(e, id),
    methods: methodsFor(e, id).map((m) => ({ id: m.id, name: m.name, country: m.country ?? "", account: m.account, holder: m.holder ?? "", instructions: m.instructions ?? "", hasQr: !!m.qrFileRef })),
  };
}
