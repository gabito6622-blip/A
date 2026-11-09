// Exportar a Excel e importar clientes desde Excel/CSV.
// Los permisos los vuelve a validar el núcleo en cada función que se llama.
import { authorize, DomainError, normalizePhone, type Actor, type GabrielStore, type ServiceResult, type ServiceRow } from "../store/index.js";
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

/* ---------------- importar servicios ---------------- */

const SCOLS = {
  name: ["cliente", "nombre", "nombre cliente", "nombre del cliente"],
  phone: ["whatsapp", "telefono", "celular", "cel", "numero", "telefono whatsapp", "movil"],
  product: ["producto", "plataforma", "servicio", "plan"],
  email: ["cuenta", "correo cuenta", "email cuenta", "correo de la cuenta", "email", "correo", "usuario", "mail"],
  password: ["contrasena", "clave", "password", "pass", "contrasena cuenta"],
  profile: ["perfil", "pantalla", "nombre perfil"],
  pin: ["pin"],
  expires: ["vence", "vencimiento", "vence cliente", "fecha vencimiento", "fecha de vencimiento", "fin", "hasta", "vencimiento cliente"],
  supExpires: ["vence proveedor", "vencimiento proveedor", "fecha proveedor", "vence cuenta"],
  supplier: ["proveedor"],
  cost: ["costo", "costo cuenta", "costo bs"],
} as const;

/**
 * Fecha de una celda: número de serie de Excel (46012), "15/12/2026", "15-12-26" o "2026-12-15".
 * Queda a las 23:59 de ese día (hora del servidor).
 */
export function parseDate(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 30000 || serial > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
    else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) [d, m, y] = [+mt[1], +mt[2], mt[3].length === 2 ? 2000 + +mt[3] : +mt[3]];
    else return null;
  }
  const t = new Date(y, m - 1, d, 23, 59, 0, 0);
  if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null;
  return t.getTime();
}

export function importServicesFile(s: GabrielStore, a: Actor, file: Buffer, opts: { dryRun: boolean }) {
  authorize(a, "inventory.manage");
  let rows: string[][];
  try {
    rows = readSheet(file);
  } catch (e) {
    throw new DomainError("VALIDATION", (e as Error).message);
  }
  if (rows.length < 2) throw new DomainError("VALIDATION", "El archivo no tiene filas con datos (la primera fila tiene que ser el encabezado)");
  const header = rows[0].map(normHeader);
  const used = new Set<number>();
  const find = (names: readonly string[]) => {
    const i = header.findIndex((h, k) => !used.has(k) && names.includes(h));
    if (i >= 0) used.add(i);
    return i;
  };
  // El orden importa: "vence proveedor" se busca antes que "vence".
  const idx = {
    supExpires: find(SCOLS.supExpires), name: find(SCOLS.name), phone: find(SCOLS.phone), product: find(SCOLS.product),
    password: find(SCOLS.password), profile: find(SCOLS.profile), pin: find(SCOLS.pin), expires: find(SCOLS.expires),
    supplier: find(SCOLS.supplier), cost: find(SCOLS.cost), email: find(SCOLS.email),
  };
  const missing = [["Cliente", idx.name], ["WhatsApp", idx.phone], ["Producto", idx.product], ["Cuenta (correo)", idx.email], ["Vence", idx.expires]].filter(([, i]) => (i as number) < 0).map(([n]) => n);
  if (missing.length) throw new DomainError("VALIDATION", `Faltan columnas: ${missing.join(", ")}. Encabezados leídos: ${rows[0].join(", ")}. Descargá la plantilla de servicios para ver el formato.`);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const parseErrors: ServiceResult[] = [];
  const valid: ServiceRow[] = [];
  for (let k = 1; k < rows.length; k++) {
    const r = rows[k];
    const base = { row: k + 1, customer: cell(r, idx.name), product: cell(r, idx.product), account: cell(r, idx.email), profile: cell(r, idx.profile) || "Cuenta completa", created: [], warnings: [] };
    const fail = (error: string) => parseErrors.push({ ...base, status: "error", error });
    const rawPhone = cell(r, idx.phone);

    if (!base.product) { fail("Falta el producto"); continue; }
    if (!/^[^@\s]+@[^@\s]+$/.test(base.account)) { fail("Cuenta: falta el correo o es inválido"); continue; }
    const exp = parseDate(cell(r, idx.expires));
    if (!exp) { fail(`Fecha de vencimiento inválida: "${cell(r, idx.expires)}" (usá 15/12/2026)`); continue; }
    const supRaw = cell(r, idx.supExpires);
    const supExp = supRaw ? parseDate(supRaw) : null;
    if (supRaw && !supExp) { fail(`Fecha del proveedor inválida: "${supRaw}"`); continue; }
    const pin = cell(r, idx.pin).replace(/\.0+$/, "");
    if (pin && !/^\d{1,8}$/.test(pin)) { fail(`PIN inválido: "${pin}"`); continue; }
    const costRaw = cell(r, idx.cost).replace(",", ".");
    valid.push({
      row: k + 1, customerName: base.customer, phone: rawPhone ? phoneWithCountry(rawPhone) : "", product: base.product, email: base.account,
      password: cell(r, idx.password), profile: base.profile, pin: pin || undefined, customerExpiresAt: exp,
      supplierExpiresAt: supExp ?? undefined, supplier: cell(r, idx.supplier) || undefined,
      cost: costRaw && Number.isFinite(+costRaw) ? Math.round(+costRaw * 100) : undefined,
    });
  }
  const res = valid.length ? s.inventory.importServices(a, valid, opts) : { dryRun: opts.dryRun, summary: { ok: 0, errores: 0, clientesNuevos: 0, cuentasNuevas: 0, perfilesNuevos: 0, avisos: 0 }, rows: [] as ServiceResult[] };
  res.rows = [...res.rows, ...parseErrors].sort((x, y) => x.row - y.row);
  res.summary.errores += parseErrors.length;
  return res;
}

export const servicesTemplate = () => writeXlsx([{
  name: "Servicios", widths: [22, 16, 16, 28, 16, 14, 8, 14, 16, 18, 10],
  rows: [
    ["Cliente", "WhatsApp", "Producto", "Cuenta", "Contraseña", "Perfil", "PIN", "Vence", "Vence proveedor", "Proveedor", "Costo"],
    ["María Quispe", "70011223", "Netflix", "netflix01@correo.com", "Clave#123", "Perfil 1", "1234", "15/12/2026", "31/01/2027", "Proveedor Andes", 30],
    ["Luis Choque", "78889900", "Netflix", "netflix01@correo.com", "Clave#123", "Perfil 2", "5678", "20/12/2026", "31/01/2027", "Proveedor Andes", ""],
  ],
}]);

/** Plantilla vacía para que el dueño complete. */
export const customersTemplate = () => writeXlsx([{ name: "Clientes", widths: [26, 18, 26, 34, 12], rows: [["Nombre", "WhatsApp", "Email", "Notas", "Tipo"], ["María Quispe", "70011223", "maria@correo.com", "Paga por QR", "Cliente"]] }]);
