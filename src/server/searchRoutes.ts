// 🔎 Buscador del panel (etapa 3 del panel ordenado, 12/11/2026): una sola búsqueda que encuentra clientes,
// revendedores, servicios (perfiles vendidos), cuentas por correo y pedidos por número o referencia del banco.
//
// Cada grupo respeta el permiso que ya tiene la pantalla de donde sale:
//   - clientes y revendedores: "customer.manage" (dueño, admin y atención), como Clientes;
//   - servicios: cualquier usuario del panel, como el Control de alquileres;
//   - cuentas: "inventory.manage" (dueño y admin), como Cuentas;
//   - pedidos: "payment.review" (dueño y admin), como Aprobar pagos.
// Nunca devuelve contraseñas, PIN, costos ni ganancias: solo lo necesario para reconocer el resultado y abrirlo.
import type { GabrielStore } from "../store/index.js";
import { can, isStaff } from "../store/auth.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { actor?: any; query: URLSearchParams };
type Route = (method: string, path: string, who: Who, handler: (c: Ctx) => unknown) => void;

export interface SearchItem { kind: "customer" | "reseller" | "service" | "account" | "order"; id: string; title: string; sub: string; q: string }
export interface SearchGroup { key: string; label: string; items: SearchItem[]; more: number }

const PER_GROUP = 6;
export const normq = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const ddmm = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit" }).format(new Date(t));
const STATUS: Record<string, string> = { awaiting_payment: "Esperando pago", payment_review: "Por revisar", fulfilled: "Entregado", rejected: "Rechazado", expired: "Vencido", cancelled: "Cancelado" };

export function search(store: GabrielStore, actor: { role: string }, raw: string): { q: string; groups: SearchGroup[] } {
  const q = normq(raw).slice(0, 80);
  if (q.length < 2) return { q, groups: [] };
  const digits = q.replace(/\D/g, "");
  const e = store.engine, s = e.s;
  // Un teléfono se encuentra con 4 dígitos o más, venga como venga (+591 700-11223, 70011223…).
  const phoneHit = (phone?: string) => digits.length >= 4 && String(phone ?? "").replace(/\D/g, "").includes(digits);
  const hit = (...parts: unknown[]) => parts.some((p) => normq(p).includes(q));
  const groups: SearchGroup[] = [];
  const push = (key: string, label: string, all: SearchItem[]) => { if (all.length) groups.push({ key, label, items: all.slice(0, PER_GROUP), more: Math.max(0, all.length - PER_GROUP) }); };
  const a = actor as never;

  if (can(a, "customer.manage")) {
    const cs = Object.values(s.customers).filter((c) => hit(c.name, c.email) || phoneHit(c.phone));
    const svc = (id: string) => Object.values(s.assignments).filter((x) => x.customerId === id && x.status === "active").length;
    push("customers", "Clientes", cs.filter((c) => c.kind !== "reseller").map((c) => ({ kind: "customer" as const, id: c.id, title: c.name, sub: `${c.phone} · ${svc(c.id)} servicio${svc(c.id) === 1 ? "" : "s"}`, q: c.name })));
    push("resellers", "Revendedores", cs.filter((c) => c.kind === "reseller").map((c) => ({ kind: "reseller" as const, id: c.id, title: c.name, sub: `${c.phone} · revendedor`, q: c.name })));
  }

  if (isStaff(a)) {
    const out: SearchItem[] = [];
    for (const x of Object.values(s.assignments)) {
      if (x.status !== "active") continue;
      const cust = s.customers[x.customerId], slot = s.slots[x.slotId], acc = slot ? s.accounts[slot.accountId] : undefined, prod = s.products[x.productId];
      if (!(hit(cust?.name, acc?.email, prod?.name ? `${prod.name} ${cust?.name ?? ""}` : "") || phoneHit(cust?.phone))) continue;
      out.push({ kind: "service", id: x.id, title: cust?.name ?? "?", sub: `${prod?.name ?? "?"} · ${slot?.label ?? ""} · vence ${ddmm(x.customerExpiresAt)}`, q: cust?.name ?? "" });
    }
    push("services", "Servicios", out.sort((p, r) => p.title.localeCompare(r.title)));
  }

  if (can(a, "inventory.manage")) {
    const out: SearchItem[] = [];
    for (const acc of Object.values(s.accounts)) {
      if (acc.status === "retired" || !hit(acc.email)) continue;
      const slots = Object.values(s.slots).filter((x) => x.accountId === acc.id && x.status !== "retired");
      const free = slots.filter((x) => x.status === "available").length;
      out.push({ kind: "account", id: acc.id, title: acc.email, sub: `${s.products[acc.productId]?.name ?? "?"} · ${free} libre${free === 1 ? "" : "s"} de ${slots.length} · proveedor vence ${ddmm(acc.supplierExpiresAt)}`, q: acc.email });
    }
    push("accounts", "Cuentas", out);
  }

  if (can(a, "payment.review")) {
    const out = Object.values(s.orders)
      .filter((o) => normq(o.id) === q || normq(o.id).endsWith(q) || hit(o.evidence?.declaredReference, o.confirmedReference))
      .sort((p, r) => r.createdAt - p.createdAt)
      .map((o) => ({ kind: "order" as const, id: o.id, title: `Pedido ${o.id}`, sub: `${s.customers[o.customerId]?.name ?? "?"} · ${STATUS[o.status] ?? o.status} · ${ddmm(o.createdAt)}`, q: o.status }));
    push("orders", "Pedidos", out);
  }
  return { q, groups };
}

export function registerSearchRoutes(d: { route: Route; store: GabrielStore }) {
  d.route("GET", "/api/admin/search", "staff", (c) => search(d.store, c.actor, c.query.get("q") ?? ""));
}
