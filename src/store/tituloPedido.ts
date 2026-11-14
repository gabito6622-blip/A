// Título de un pedido para el cliente (revisión «en el lugar de ~30 clientes», 14/11/2026): las tarjetas decían
// «Compra · Bs 35» y el historial «Compra ord_…», y el cliente no sabía de qué era. Ahora: «Netflix», «Netflix + Disney+»,
// «Renovación · Netflix» o «Recarga de saldo». Solo usa nombres de productos (nada de costos ni de otros clientes).
import type { Order } from "./types.js";
import type { Engine } from "./engine.js";

const clean = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "").trim();

/** Nombre corto de lo que compró: «Netflix», «2 × Netflix», «Netflix + Disney+», «Netflix, Disney+ y 2 más». */
export function orderTitle(e: Engine, o: Order): string {
  if (o.kind === "topup") return "Recarga de saldo";
  if (o.kind === "renewal") {
    const a = o.renewal ? e.s.assignments[o.renewal.assignmentId] : undefined;
    const n = a ? clean(e.s.products[a.productId]?.name ?? "") : "";
    return n ? `Renovación · ${n}` : "Renovación";
  }
  const names = (o.items ?? []).map((i) => {
    const n = clean(e.s.products[i.productId]?.name ?? "") || "Producto";
    return i.qty > 1 ? `${i.qty} × ${n}` : n;
  });
  if (!names.length) return "Compra";
  if (names.length <= 3) return names.join(" + ");
  return `${names.slice(0, 2).join(", ")} y ${names.length - 2} más`;
}
