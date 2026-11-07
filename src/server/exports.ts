// Exportar a Excel e importar clientes desde Excel/CSV.
// Los permisos los vuelve a validar el núcleo en cada función que se llama.
import { authorize, DomainError, normalizePhone, type Actor, type GabrielStore } from "../store/index.js";
import { normHeader, readSheet, writeXlsx, type Cell, type Sheet } from "./xlsx.js";

const bsNum = (c: number) => Math.round(c) / 100;
const fd = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const fdt = (t: number) => new Date(t).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, string> = { awaiting_payment: "Esperando pago", payment_review: "En revisión", fulfilled: "Entregado", rejected: "Rechazado", expired: "Vencido", cancelled: "Cancelado" };
const KIND: Record<string, string> = { sale: "Venta", renewal: "Renovación", topup: "Recarga" };
const METHOD: Record<string, string> = { qr: "QR", balance: "Saldo", cash: "Efectivo" };

export type ExportKind = "clientes" | "ventas" | "servicios" | "cuentas" | "movimientos" | "todo";
export const EXPORT_KINDS: ExportKind[] = ["clientes", "ventas", "servicios", "cuentas", "movimientos", "todo"];

function clientes(s: GabrielStore, a: Actor): Sheet {
  const list = s.admin.customers(a, "");
  return {
    name: "Clientes", widths: [26, 18, 26, 12, 10, 10, 10, 34, 12],
    rows: [["Nombre", "WhatsApp", "Email", "Tipo", "Saldo (Bs)", "Servicios activos", "Acepta avisos", "Notas", "Alta"],
      ...list.map((c): Cell[] => [c.name, c.phone, c.email ?? "", c.kind === "reseller" ? "Revendedor" : "Cliente", bsNum(c.balance), c.activeServices, c.whatsappConsent ? "Sí" : "No", c.notes ?? "", fd(c.createdAt)])],
  };
}

function ventas(s: GabrielStore, a: Actor): Sheet {
  authorize(a, "stats.view");
  const list = s.admin.orders(a, { limit: 100_000 });
  return {
    name: "Ventas", widths: [17, 12, 24, 12, 34, 10, 10, 14, 18, 18],
    rows: [["Fecha", "Pedido", "Cliente", "Tipo", "Detalle", "Total (Bs)", "Pago", "Estado", "N.º operación", "Referencia banco"],
      ...list.map((o): Cell[] => [fdt(o.createdAt), o.id, o.customerName, KIND[o.kind] ?? o.kind,
        o.kind === "topup" ? "Recarga de saldo" : o.items.map((i) => `${i.qty} × ${i.productName}`).join(", "),
        bsNum(o.total), METHOD[o.paymentMethod] ?? o.paymentMethod, STATUS[o.status] ?? o.status, o.evidence?.declaredReference ?? "", o.confirmedReference ?? ""])],
  };
}

function servicios(s: GabrielStore, a: Actor): Sheet {
  const list = s.admin.assignments(a, {});
  const phones = new Map(s.admin.customers(a, "").map((c) => [c.id, c.phone]));
  return {
    name: "Servicios activos", widths: [24, 18, 20, 28, 14, 14, 14, 10],
    rows: [["Cliente", "WhatsApp", "Producto", "Cuenta", "Perfil", "Vence cliente", "Vence proveedor", "Días"],
      ...list.map((x): Cell[] => [x.customerName ?? "", phones.get(x.customerId) ?? "", x.product ?? "", x.email, x.profile, fd(x.customerExpiresAt), fd(x.supplierExpiresAt), Math.ceil((x.customerExpiresAt - Date.now()) / 86_400_000)])],
  };
}

function cuentas(s: GabrielStore, a: Actor, withSecrets: boolean): Sheet {
  const accs = s.inventory.listAccounts(a, { withSecrets });
  const st = s.engine.s;
  const SL: Record<string, string> = { available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena", retired: "retirado" };
  const rows: Cell[][] = [["Producto", "Cuenta", "Contraseña", "Perfil", "PIN", "Estado", "Proveedor", "Vence proveedor", "Costo cuenta (Bs)", "Notas"]];
  for (const acc of accs) {
    for (const sl of acc.slots) {
      rows.push([st.products[acc.productId]?.name ?? acc.productId, acc.email, acc.password, sl.label, withSecrets ? sl.pin ?? "" : "••••", SL[sl.status] ?? sl.status,
        st.suppliers[acc.supplierId]?.name ?? acc.supplierId, fd(acc.supplierExpiresAt), bsNum(acc.cost), acc.notes ?? ""]);
    }
  }
  return { name: "Cuentas y perfiles", widths: [18, 28, 18, 14, 8, 12, 18, 14, 12, 30], rows };
}

function movimientos(s: GabrielStore, a: Actor): Sheet {
  authorize(a, "stats.view");
  const names = new Map(Object.values(s.engine.s.customers).map((c) => [c.id, c.name]));
  const T: Record<string, string> = { topup: "Recarga", purchase: "Compra", renewal: "Renovación", refund: "Devolución", adjustment: "Ajuste" };
  const rows: Cell[][] = [["Fecha", "Cliente", "Tipo", "Monto (Bs)", "Saldo después (Bs)", "Referencia", "Nota"]];
  for (const id of names.keys()) {
    for (const m of s.wallet.history(a, id)) rows.push([fdt(m.at), names.get(id) ?? id, T[m.type] ?? m.type, bsNum(m.amount), bsNum(m.balanceAfter), m.ref, m.note ?? ""]);
  }
  return { name: "Movimientos de saldo", widths: [17, 24, 12, 12, 16, 14, 30], rows };
}

/** Arma el Excel pedido. "todo" incluye las hojas que el rol puede ver. */
export function buildExport(s: GabrielStore, a: Actor, kind: ExportKind, opts: { withSecrets?: boolean } = {}): { file: Buffer; name: string } {
  const day = new Date().toISOString().slice(0, 10);
  let sheets: Sheet[];
  if (kind === "todo") {
    const tryAdd = (f: () => Sheet) => { try { return [f()]; } catch (e) { if (e instanceof DomainError && e.code === "FORBIDDEN") return []; throw e; } };
    sheets = [...tryAdd(() => clientes(s, a)), ...tryAdd(() => ventas(s, a)), ...tryAdd(() => servicios(s, a)), ...tryAdd(() => cuentas(s, a, false)), ...tryAdd(() => movimientos(s, a))];
    if (!sheets.length) throw new DomainError("FORBIDDEN", "No tenés permiso para exportar");
  } else {
    sheets = [{ clientes, ventas, servicios, movimientos, cuentas: (x: GabrielStore, y: Actor) => cuentas(x, y, !!opts.withSecrets) }[kind](s, a)];
  }
  s.engine.tx(() => s.engine.audit(a, "export", "export", kind, { sheets: sheets.map((x) => x.name).join(","), withSecrets: !!opts.withSecrets }));
  return { file: writeXlsx(sheets), name: `gabriel-store-${kind}-${day}.xlsx` };
}

/* ---------------- importar clientes ---------------- */

const COLS = {
  name: ["nombre", "nombre completo", "cliente", "name"],
  phone: ["whatsapp", "telefono", "celular", "cel", "numero", "phone", "telefono whatsapp", "nro", "movil"],
  email: ["email", "correo", "mail", "e mail", "correo electronico"],
  notes: ["notas", "nota", "observaciones", "obs", "comentarios"],
  kind: ["tipo", "rol"],
} as const;

export interface ImportRow {
  row: number;
  name: string;
  phone: string;
  status: "nuevo" | "existe" | "error";
  error?: string;
}

/** Teléfono con código de país: si viene sin "+" y con 8 dígitos o menos, se asume Bolivia. */
export function phoneWithCountry(raw: string, country = "591"): string {
  const p = normalizePhone(raw);
  const digits = p.replace(/\D/g, "");
  if (!p.startsWith("+") && digits.length <= 8) return `+${country}${digits}`;
  if (!p.startsWith("+") && digits.startsWith(country)) return `+${digits}`;
  return p;
}

/**
 * Importa clientes desde un Excel o CSV. Con dryRun no guarda nada: devuelve la vista previa.
 * Clientes que ya existen (mismo teléfono) se saltean; no se pisan datos.
 */
export function importCustomers(s: GabrielStore, a: Actor, file: Buffer, opts: { dryRun: boolean }) {
  authorize(a, "customer.manage");
  let rows: string[][];
  try {
    rows = readSheet(file);
  } catch (e) {
    throw new DomainError("VALIDATION", (e as Error).message);
  }
  if (rows.length < 2) throw new DomainError("VALIDATION", "El archivo no tiene filas con datos (la primera fila tiene que ser el encabezado)");
  const header = rows[0].map(normHeader);
  const find = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const idx = { name: find(COLS.name), phone: find(COLS.phone), email: find(COLS.email), notes: find(COLS.notes), kind: find(COLS.kind) };
  if (idx.name < 0 || idx.phone < 0) {
    throw new DomainError("VALIDATION", `No encontré las columnas obligatorias. Encabezados leídos: ${rows[0].join(", ")}. Necesito una columna "Nombre" y una "WhatsApp" (o "Teléfono" / "Celular").`);
  }
  const existing = new Set(Object.values(s.engine.s.customers).map((c) => c.phone));
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  let created = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[idx.name] ?? "").replace(/\s+/g, " ").trim();
    const rawPhone = r[idx.phone] ?? "";
    const phone = rawPhone ? phoneWithCountry(rawPhone) : "";
    const base: ImportRow = { row: i + 1, name, phone, status: "nuevo" };
    if (!name || phone.replace(/\D/g, "").length < 7) { out.push({ ...base, status: "error", error: !name ? "Falta el nombre" : "Teléfono inválido o vacío" }); continue; }
    if (existing.has(phone) || seen.has(phone)) { out.push({ ...base, status: "existe", error: seen.has(phone) ? "Repetido en el archivo" : "Ya es cliente" }); continue; }
    seen.add(phone);
    const email = idx.email >= 0 ? r[idx.email] ?? "" : "";
    const notes = idx.notes >= 0 ? (r[idx.notes] ?? "").slice(0, 500) : "";
    const kindRaw = idx.kind >= 0 ? normHeader(r[idx.kind] ?? "") : "";
    const kind = kindRaw.startsWith("revend") ? "reseller" as const : "customer" as const;
    if (opts.dryRun) {
      if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) { out.push({ ...base, status: "error", error: "Email inválido" }); continue; }
      out.push(base);
      continue;
    }
    try {
      const c = s.catalog.createCustomer(a, { name, phone, email: email || undefined, kind, priceGroupId: kind === "reseller" ? "revendedor" : undefined, whatsappConsent: false });
      if (notes) s.catalog.updateCustomer(a, c.id, { notes });
      out.push(base);
      created++;
    } catch (e) {
      out.push({ ...base, status: "error", error: (e as Error).message });
    }
  }
  if (!opts.dryRun) s.engine.tx(() => s.engine.audit(a, "import.customers", "customer", "*", { created, rows: out.length }));
  return {
    dryRun: opts.dryRun, created,
    summary: { nuevos: out.filter((x) => x.status === "nuevo").length, existentes: out.filter((x) => x.status === "existe").length, errores: out.filter((x) => x.status === "error").length },
    columns: { nombre: rows[0][idx.name], whatsapp: rows[0][idx.phone], email: idx.email >= 0 ? rows[0][idx.email] : null, notas: idx.notes >= 0 ? rows[0][idx.notes] : null },
    rows: out,
  };
}

/** Plantilla vacía para que el dueño complete. */
export const customersTemplate = () => writeXlsx([{ name: "Clientes", widths: [26, 18, 26, 34, 12], rows: [["Nombre", "WhatsApp", "Email", "Notas", "Tipo"], ["María Quispe", "70011223", "maria@correo.com", "Paga por QR", "Cliente"]] }]);
