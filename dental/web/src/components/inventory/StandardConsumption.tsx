// Editor del «Consumo estándar» de una prestación (Configuración → Prestaciones).
// Al marcar la prestación como realizada se descuentan estos insumos en la sucursal de la cita.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { useToast } from "../ui";
import { FormAlert, InvField, parseQty, useFormErrors } from "./shared";

const PER = [{ id: "treatment", label: "Por tratamiento" }, { id: "tooth", label: "Por pieza" }, { id: "surface", label: "Por superficie" }];

export function StandardConsumptionEditor({ procedureId }: { procedureId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const items = useApi<any[]>(can("inventory.read") ? "/api/inventory/items" : null);
  const current = useApi<any[]>(can("inventory.read") ? `/api/procedures/${procedureId}/materials` : null);
  const [rows, setRows] = useState<{ itemId: string; q: string; per: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  useEffect(() => {
    if (current.data) setRows(current.data.map((m) => ({ itemId: m.itemId, q: String(Number(m.qty)).replace(".", ","), per: m.per })));
  }, [current.data]);
  if (!can("inventory.read")) return null;
  const editable = can("inventory.manage");
  const save = async () => {
    const errs: Record<string, string> = {};
    const body = rows.map((r, i) => {
      const n = parseQty(r.q);
      if (!r.itemId) errs[`items.${i}.itemId`] = "Elige el insumo";
      if (n == null || Number.isNaN(n) || n <= 0) errs[`items.${i}.qty`] = "Cantidad mayor que cero";
      return { itemId: r.itemId, qty: n, per: r.per };
    });
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try { await api.put(`/api/procedures/${procedureId}/materials`, { items: body }); toast("Consumo estándar guardado"); current.reload(); }
    catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  const unit = (id: string) => items.data?.find((x) => x.id === id)?.useUnit;
  return (
    <fieldset className="inv-fieldset stack-sm">
      <legend>Consumo estándar</legend>
      <p className="muted small">Insumos que se descuentan solos al marcar esta prestación como realizada. Si falta stock, el tratamiento se registra igual y queda un aviso de «consumo pendiente».</p>
      <FormAlert msg={E.msg} />
      {rows.length === 0 && <p className="small">Sin insumos definidos.</p>}
      {rows.map((r, i) => {
        const upd = (p: Partial<typeof r>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={i} className="inv-line" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr) auto" }}>
            <InvField label="Insumo" error={E.field(`items.${i}.itemId`)}>
              <select className="input" value={r.itemId} disabled={!editable} onChange={(e) => upd({ itemId: e.target.value })}>
                <option value="">Elige un insumo</option>
                {(items.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.sku}</option>)}
              </select>
            </InvField>
            <InvField label={`Cantidad${unit(r.itemId) ? ` (${unit(r.itemId)})` : ""}`} error={E.field(`items.${i}.qty`)}>
              <input className="input" inputMode="decimal" value={r.q} disabled={!editable} onChange={(e) => upd({ q: e.target.value })} />
            </InvField>
            <InvField label="Se cuenta">
              <select className="input" value={r.per} disabled={!editable} onChange={(e) => upd({ per: e.target.value })}>
                {PER.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </InvField>
            {editable ? <button type="button" className="btn btn-ghost btn-icon" aria-label="Quitar insumo" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button> : <span />}
          </div>
        );
      })}
      {editable && (
        <div className="row">
          <button type="button" className="btn" onClick={() => setRows([...rows, { itemId: "", q: "1", per: "treatment" }])}><Plus size={16} />Agregar insumo</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar consumo estándar"}</button>
        </div>
      )}
    </fieldset>
  );
}
