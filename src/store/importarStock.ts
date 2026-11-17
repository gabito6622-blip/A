/**
 * 📦 Cargar cuentas para vender desde Excel (17/11/2026). El dueño: «mañana voy a meter más cuentas… cuentas completas
 * y con perfiles desde un Excel, de manera masiva». Antes había importación de clientes y de servicios (quién tiene
 * qué), pero no de stock nuevo: había que cargarlas de a una o pegando una lista por producto.
 *
 * Una fila = una cuenta. Usa la misma carga de siempre (addAccount): sin correos repetidos, fecha del proveedor
 * obligatoria, perfiles libres listos para vender. Todo en una transacción con un punto de restauración por fila
 * (una fila con error no frena a las demás) y la vista previa hace todo igual y al final lo deshace.
 */
import type { Actor, Cents } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { upsertSupplier } from "./catalog.js";
import { addAccount, ensurePropias } from "./inventory.js";

export interface StockRow {
  row: number;
  product: string;
  email: string;
  password: string;
  /** Vacío, un número (1 = cuenta completa), «completa» o nombres separados por coma. */
  profiles: string;
  pin?: string;
  supplierExpiresAt?: number;
  cost?: Cents;
  costUsd?: number;
  supplier?: string;
  note?: string;
}

export interface StockResult {
  row: number;
  status: "ok" | "error";
  product: string;
  account: string;
  profiles: number;
  expiresAt?: number;
  created: string[];
  warnings: string[];
  error?: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const DRY_RUN = Symbol("dry-run");

/** Producto por id, por nombre exacto o, si no hay, por la única coincidencia parcial («Prime» → «Amazon Prime Video»). */
export function findStockProduct(e: Engine, name: string) {
  const n = norm(name);
  const all = Object.values(e.s.products).filter((p) => p.kind !== "combo");
  const exact = all.find((p) => p.id === name.trim() || norm(p.name) === n);
  if (exact) return exact;
  const part = n ? all.filter((p) => norm(p.name).includes(n) || norm(p.id).includes(n)) : [];
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new DomainError("VALIDATION", `«${name}» puede ser: ${part.slice(0, 5).map((p) => p.name).join(" · ")}. Escribí el nombre completo.`);
  throw new DomainError("NOT_FOUND", `No existe el producto «${name}». Copiá el nombre de la hoja «Productos» de la plantilla.`);
}

/** Cuántos perfiles lleva una cuenta si la celda está vacía (lo mismo que sugiere la carga rápida). */
export function defaultProfiles(p: { id: string; name: string; kind: string; profileDefaults?: { label: string }[] }): number {
  if (p.profileDefaults?.length) return p.profileDefaults.length;
  if (p.kind !== "profile") return 1;
  const t = `${p.id} ${p.name}`.toLowerCase();
  return /disney/.test(t) ? 7 : /prime|amazon/.test(t) ? 6 : 5;
}

function profilesOf(raw: string, p: Parameters<typeof defaultProfiles>[0] & { profileDefaults?: { label: string; pin?: string }[] }, pin?: string) {
  const v = raw.trim().replace(/\.0+$/, "");
  const labels = (n: number) => n === 1 ? ["Cuenta completa"] : (p.profileDefaults?.length === n ? p.profileDefaults.map((x) => x.label) : Array.from({ length: n }, (_, i) => `Perfil ${i + 1}`));
  let list: string[];
  if (!v) list = labels(defaultProfiles(p));
  else if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n < 1 || n > 20) throw new DomainError("VALIDATION", `Perfiles: de 1 a 20 (decía «${raw}»)`);
    list = labels(n);
  } else if (/^(cuenta )?complet[ao]$/i.test(norm(v))) list = ["Cuenta completa"];
  else {
    list = v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
    if (!list.length || list.length > 20) throw new DomainError("VALIDATION", "Perfiles: de 1 a 20 nombres separados por coma");
  }
  return list.map((label) => ({ label: label.slice(0, 40), ...(pin ? { pin } : {}) }));
}

export function importStock(e: Engine, actor: Actor, rows: StockRow[], opts: { dryRun: boolean }) {
  authorize(actor, "inventory.manage");
  if (rows.length > 1000) throw new DomainError("VALIDATION", "Máximo 1000 cuentas por archivo");
  const results: StockResult[] = [];
  const run = () => {
    for (const r of rows) {
      const res: StockResult = { row: r.row, status: "ok", product: r.product, account: r.email, profiles: 0, expiresAt: r.supplierExpiresAt, created: [], warnings: [] };
      try {
        e.savepoint(() => {
          const p = findStockProduct(e, r.product);
          res.product = p.name;
          if (!r.supplierExpiresAt) throw new DomainError("VALIDATION", "Falta «Vence proveedor» (hasta cuándo pagaste la cuenta, ej. 15/12/2026)");
          const profiles = profilesOf(r.profiles, p, r.pin);
          res.profiles = profiles.length;
          const supName = r.supplier?.trim() ?? "";
          let supplierId: string;
          if (supName) {
            let sup = Object.values(e.s.suppliers).find((s) => norm(s.name) === norm(supName));
            if (!sup) { sup = upsertSupplier(e, actor, { name: supName, active: true }); res.created.push("proveedor"); }
            supplierId = sup.id;
          } else supplierId = ensurePropias(e);
          if (r.cost === undefined && r.costUsd === undefined) res.warnings.push("Sin costo: la ganancia la cuenta como gratis (ponelo en Cuentas)");
          const out = addAccount(e, actor, {
            productId: p.id, supplierId, email: r.email, password: r.password, supplierExpiresAt: r.supplierExpiresAt, cost: r.cost ?? 0,
            ...(r.costUsd ? { costUsd: r.costUsd } : {}), profiles, ...(r.note ? { notes: r.note } : {}),
          });
          const w = (out as { warning?: string }).warning; if (w) res.warnings.push(w);
          if (r.supplierExpiresAt - e.now() < 3 * 86_400_000) res.warnings.push("Vence con el proveedor en menos de 3 días");
          res.created.push("cuenta");
        });
      } catch (err) {
        res.status = "error"; res.error = (err as Error).message; res.created = [];
      }
      results.push(res);
    }
    const ok = results.filter((x) => x.status === "ok");
    e.audit(actor, opts.dryRun ? "import.stock.preview" : "import.stock", "account", "*", { ok: ok.length, errors: results.length - ok.length, profiles: ok.reduce((t, x) => t + x.profiles, 0) });
    if (opts.dryRun) throw DRY_RUN;
  };
  try { e.tx(run); } catch (err) { if (err !== DRY_RUN) throw err; }
  const ok = results.filter((x) => x.status === "ok");
  // Por producto: cuántas cuentas y perfiles entran (para la vista previa).
  const byProduct: Record<string, { cuentas: number; perfiles: number }> = {};
  for (const x of ok) { const b = (byProduct[x.product] ??= { cuentas: 0, perfiles: 0 }); b.cuentas++; b.perfiles += x.profiles; }
  return {
    dryRun: opts.dryRun,
    summary: { ok: ok.length, errores: results.length - ok.length, perfiles: ok.reduce((t, x) => t + x.profiles, 0), avisos: results.reduce((t, x) => t + x.warnings.length, 0) },
    byProduct,
    rows: results,
  };
}
