// Inventario: utilidades de interfaz compartidas (errores junto al campo, insignias de alerta, formatos).
import { useState, type ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import "./inventory.css";

/** Cantidad legible (hasta 3 decimales, coma decimal). */
export const qty = (n: number | string | null | undefined) =>
  n == null ? "—" : (Math.round(Number(n) * 1000) / 1000).toLocaleString("es-BO", { maximumFractionDigits: 3 });

/** "12,5" o "12.5" → 12.5; vacío → null; texto inválido → NaN. */
export const parseQty = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

/** Errores de la API: mensaje general + errores por campo (details[].path). */
export function useFormErrors() {
  const [state, setState] = useState<{ msg: string | null; fields: Record<string, string> }>({ msg: null, fields: {} });
  return {
    msg: state.msg,
    field: (p: string) => state.fields[p],
    fail: (e: any) => {
      const fields: Record<string, string> = {};
      for (const d of e?.details ?? []) if (d?.path && !fields[d.path]) fields[d.path] = d.message;
      setState({ msg: e?.message ?? "No se pudo guardar", fields });
    },
    set: (fields: Record<string, string>, msg: string | null = null) => setState({ msg, fields }),
    clear: () => setState({ msg: null, fields: {} }),
  };
}

/** Campo con etiqueta y error junto al control (mismo marcado que Field del sistema de diseño). */
export function InvField({ label, error, hint, span2, children }: { label: string; error?: string; hint?: string; span2?: boolean; children: ReactNode }) {
  return (
    <div className={`field ${span2 ? "span-2" : ""}`}>
      <label style={{ display: "contents" }}>
        <span className="label">{label}</span>
        {children}
      </label>
      {error ? <span className="inv-err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function FormAlert({ msg }: { msg: string | null }) {
  return msg ? <div className="alert danger" role="alert">{msg}</div> : null;
}

export interface InvAlert { type: string; bucket?: number; branchName?: string; lotCode?: string | null; daysLeft?: number; qtyMissing?: number }

export function AlertBadges({ alerts, showBranch }: { alerts: InvAlert[]; showBranch?: boolean }) {
  if (!alerts?.length) return null;
  const b = (a: InvAlert) => (showBranch && a.branchName ? ` · ${a.branchName}` : "");
  return (
    <span className="inv-badges">
      {alerts.map((a, i) => {
        if (a.type === "below_min") return <span key={i} className="badge danger">Bajo mínimo{b(a)}</span>;
        if (a.type === "expired") return <span key={i} className="badge danger">Vencido{a.lotCode ? ` (${a.lotCode})` : ""}{b(a)}</span>;
        if (a.type === "pending_consumption") return <span key={i} className="badge warn">Consumo pendiente{b(a)}</span>;
        return <span key={i} className={`badge ${a.bucket === 30 ? "warn" : a.bucket === 60 ? "info" : ""}`}>Vence en {a.daysLeft} d{b(a)}</span>;
      })}
    </span>
  );
}

export function ExpiryBadge({ expiresOn, daysLeft }: { expiresOn: string | null; daysLeft: number | null }) {
  if (!expiresOn) return <span className="muted">Sin vencimiento</span>;
  const [y, m, d] = expiresOn.split("-");
  const txt = `${d}/${m}/${y}`;
  if (daysLeft == null) return <span>{txt}</span>;
  if (daysLeft < 0) return <span className="badge danger">Vencido · {txt}</span>;
  if (daysLeft <= 30) return <span className="badge warn">{txt} · {daysLeft} d</span>;
  if (daysLeft <= 90) return <span className="badge info">{txt} · {daysLeft} d</span>;
  return <span>{txt}</span>;
}

export const KIND_LABELS: Record<string, string> = {
  purchase: "Compra", consumption: "Consumo", adjustment: "Ajuste", transfer_out: "Envío", transfer_in: "Recepción de transferencia",
};
export const REASONS: { id: string; label: string }[] = [
  { id: "count", label: "Conteo" }, { id: "breakage", label: "Rotura" }, { id: "expiry", label: "Vencimiento" }, { id: "other", label: "Otro" },
];

/** Sucursal activa: la elegida arriba, o la única; null = vista consolidada (todas). */
export function useInvBranch() {
  const { me, branchId } = useAuth();
  const branches = me?.branches ?? [];
  const current = branchId ?? (branches.length === 1 ? branches[0]!.id : null);
  return { current, branches, defaultBranch: current ?? branches[0]?.id ?? "", branchName: (id: string | null) => branches.find((b) => b.id === id)?.name ?? "" };
}

export function BranchSelect({ value, onChange, label = "Sucursal", exclude, error }: { value: string; onChange: (v: string) => void; label?: string; exclude?: string; error?: string }) {
  const { me } = useAuth();
  const list = (me?.branches ?? []).filter((b) => b.id !== exclude);
  return (
    <InvField label={label} error={error}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {!list.some((b) => b.id === value) && <option value="">Elige una sucursal</option>}
        {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </InvField>
  );
}
