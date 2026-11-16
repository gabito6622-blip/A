/**
 * 🧹 Ordenar mis datos (16/11/2026). Lo que le falta a la tienda para trabajar sola, en una sola lista:
 * cuentas apartadas que esperan clave nueva, cuentas sin clave cargada, cuentas sin fecha del proveedor, correos mal
 * escritos y el Gmail del Panel de códigos. Solo lee: cada arreglo usa los botones de siempre (clave, liberar, fecha).
 * Nunca devuelve contraseñas.
 */
import type { Actor } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";

const YEARS_20 = 20 * 365 * 86_400_000;
const BAD_DOMAIN = /@(gmai|gmial|gmal|gamil|gmil|gnail)\.com$|@gmail\.co$|@gmailcom$|@hotmial\.com$|@hotmai\.com$/i;
const VALID = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export function ordenarView(e: Engine, actor: Actor) {
  authorize(actor, "inventory.manage");
  const prod = (id: string) => e.s.products[id]?.name ?? id;
  const live = Object.values(e.s.accounts).filter((a) => a.status === "active" && Object.values(e.s.slots).some((s) => s.accountId === a.id && s.status !== "retired"));
  const slotsOf = (id: string) => Object.values(e.s.slots).filter((s) => s.accountId === id);
  const row = (a: (typeof live)[number]) => ({ accountId: a.id, email: a.email, product: prod(a.productId), notes: (a.notes ?? "").slice(0, 160), hasPassword: !!a.password });
  const apartadas = live.map((a) => ({ a, q: slotsOf(a.id).filter((s) => s.status === "quarantined") })).filter((x) => x.q.length)
    .map(({ a, q }) => ({ ...row(a), slots: q.map((s) => ({ id: s.id, label: s.label })), passwordChangedAt: a.passwordChangedAt ?? null,
      // La usa el dueño o falta pagar al proveedor: se muestra el aviso y no se ofrece «liberar» directo.
      noFree: /NO ALQUILAR|PAGAR PROVEEDOR|clientes finales del due/i.test(a.notes ?? "") }))
    .sort((x, y) => Number(x.noFree) - Number(y.noFree) || x.email.localeCompare(y.email));
  const aparts = new Set(apartadas.map((x) => x.accountId));
  const sinClave = live.filter((a) => !a.password && !aparts.has(a.id)).map(row).sort((x, y) => x.email.localeCompare(y.email));
  // Sin fecha: cargada «sin vencimiento» con un proveedor (no las propias), o con la nota «falta que el dueño diga…».
  const sinFecha = live.filter((a) => (a.supplierExpiresAt - e.now() > YEARS_20 && !a.supplierId?.startsWith("propias")) || /sin fecha del proveedor:\s*falta/i.test(a.notes ?? ""))
    .map(row).sort((x, y) => x.email.localeCompare(y.email));
  // Solo correos (con @): las líneas de IPTV usan un usuario, no un correo, y no son un error.
  const correos = live.filter((a) => a.email.includes("@") && (!VALID.test(a.email) || BAD_DOMAIN.test(a.email)))
    .map((a) => ({ ...row(a), suggestion: a.email.replace(/@(gmai|gmial|gmal|gamil|gmil|gnail)\.com$/i, "@gmail.com").replace(/@gmail\.co$/i, "@gmail.com").replace(/@gmailcom$/i, "@gmail.com").replace(/@hotm(ial|ai)\.com$/i, "@hotmail.com") }));
  const boxes = Object.values(e.s.mailboxes ?? {});
  return {
    apartadas, sinClave, sinFecha, correos,
    gmail: { connected: boxes.filter((m) => !(m as { lastError?: string }).lastError).length, total: boxes.length },
    total: apartadas.length + sinClave.length + sinFecha.length + correos.length + (boxes.length ? 0 : 1),
  };
}
