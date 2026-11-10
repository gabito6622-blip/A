// Inventario: diálogos rápidos (consumir, ajustar, ingresar compra, insumo y transferencia).
// Los errores se muestran junto al campo o en una alerta dentro del diálogo; nunca con window.alert.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { localDate, parseBs } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Dialog, useToast } from "../ui";
import { BranchSelect, FormAlert, InvField, parseQty, qty, REASONS, useFormErrors } from "./shared";

export interface InvItem {
  id: string; sku: string; name: string; useUnit: string; purchaseUnit: string; purchaseFactor: number; tracksLots: boolean; category?: string;
  active?: boolean; preferredSupplierId?: string | null; mins?: { branchId: string; minQty: number }[];
}

function ItemSelect({ items, value, onChange, error }: { items: InvItem[]; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <InvField label="Insumo" error={error}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
        <option value="">Elige un insumo</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.sku}</option>)}
      </select>
    </InvField>
  );
}

/** Lotes con saldo del insumo en la sucursal ("L-01 · 10 disp. · vence 25/11/2026"). */
function useLots(branchId: string, itemId: string, withEmpty = false) {
  return useApi<any[]>(branchId && itemId ? `/api/inventory/lots?branchId=${branchId}&itemId=${itemId}${withEmpty ? "&withEmpty=1" : ""}` : null);
}
const lotLabel = (l: any) => `${l.lotCode ?? "Sin lote"} · ${qty(l.qty)} disp.${l.expiresOn ? ` · vence ${l.expiresOn.split("-").reverse().join("/")}${l.daysLeft < 0 ? " (VENCIDO)" : ""}` : ""}`;

function DialogFoot({ onClose, busy, label, onSave }: { onClose: () => void; busy: boolean; label: string; onSave: () => void }) {
  return <><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? "Guardando…" : label}</button></>;
}

// ---------------- Consumir ----------------
export function ConsumeDialog({ items, branchId: b0, itemId: i0, onClose, onDone }: { items: InvItem[]; branchId: string; itemId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [branchId, setBranchId] = useState(b0);
  const [itemId, setItemId] = useState(i0 ?? "");
  const [lotId, setLotId] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const item = items.find((i) => i.id === itemId);
  const lots = useLots(branchId, itemId);
  const available = (lots.data ?? []).filter((l) => l.daysLeft == null || l.daysLeft >= 0).reduce((s, l) => s + Number(l.qty), 0);
  const save = async () => {
    const n = parseQty(q);
    const errs: Record<string, string> = {};
    if (!branchId) errs.branchId = "Elige la sucursal";
    if (!itemId) errs.itemId = "Elige el insumo";
    if (n == null || Number.isNaN(n) || n <= 0) errs.qty = "Escribe una cantidad mayor que cero";
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try {
      await api.post("/api/inventory/consume", { branchId, itemId, qty: n, lotId: lotId || null, note: note || null });
      toast(`Consumo registrado: ${qty(n)} ${item?.useUnit ?? ""} de ${item?.name ?? ""}`); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Consumir insumo" onClose={onClose} footer={<DialogFoot onClose={onClose} busy={busy} label="Registrar consumo" onSave={save} />}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <div className="form-grid">
          <BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setLotId(""); }} error={E.field("branchId")} />
          <ItemSelect items={items} value={itemId} onChange={(v) => { setItemId(v); setLotId(""); }} error={E.field("itemId")} />
          <InvField label={`Cantidad${item ? ` (${item.useUnit})` : ""}`} error={E.field("qty")} hint={item ? `Disponible: ${qty(available)} ${item.useUnit}` : undefined}>
            <input className="input" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={!!E.field("qty")} />
          </InvField>
          <InvField label="Lote" error={E.field("lotId")} hint="Vacío = el que vence primero (FEFO)">
            <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!itemId}>
              <option value="">Automático (vence primero)</option>
              {(lots.data ?? []).filter((l) => l.lotCode).map((l) => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
            </select>
          </InvField>
          <InvField label="Nota (opcional)" span2 error={E.field("note")}>
            <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: sillón 2, urgencia" />
          </InvField>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Ajustar ----------------
export function AdjustDialog({ items, branchId: b0, itemId: i0, lotId: l0, direction: d0, reason: r0, onClose, onDone }: {
  items: InvItem[]; branchId: string; itemId?: string; lotId?: string; direction?: "in" | "out"; reason?: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [branchId, setBranchId] = useState(b0);
  const [itemId, setItemId] = useState(i0 ?? "");
  const [direction, setDirection] = useState<"in" | "out">(d0 ?? "out");
  const [reason, setReason] = useState(r0 ?? "");
  const [lotId, setLotId] = useState(l0 ?? "");
  const [lotCode, setLotCode] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const item = items.find((i) => i.id === itemId);
  const lots = useLots(branchId, itemId, direction === "in");
  const save = async () => {
    const n = parseQty(q);
    const errs: Record<string, string> = {};
    if (!itemId) errs.itemId = "Elige el insumo";
    if (n == null || Number.isNaN(n) || n <= 0) errs.qty = "Escribe una cantidad mayor que cero";
    if (!reason) errs.reason = "Elige el motivo";
    if (reason === "other" && note.trim().length < 3) errs.note = "Explica qué pasó";
    if (item?.tracksLots && direction === "out" && !lotId) errs.lotId = "Elige el lote";
    if (item?.tracksLots && direction === "in" && !lotId && (!lotCode.trim() || !expiresOn)) {
      if (!lotCode.trim()) errs.lotCode = "Indica el lote"; if (!expiresOn) errs.expiresOn = "Indica el vencimiento";
    }
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try {
      await api.post("/api/inventory/adjust", {
        branchId, itemId, direction, qty: n, reason, note: note || null, lotId: lotId || null,
        lotCode: !lotId && item?.tracksLots ? lotCode : null, expiresOn: !lotId && item?.tracksLots ? expiresOn : null,
      });
      toast("Ajuste registrado"); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Ajustar stock" onClose={onClose} footer={<DialogFoot onClose={onClose} busy={busy} label="Registrar ajuste" onSave={save} />}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <div className="form-grid">
          <BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setLotId(""); }} />
          <ItemSelect items={items} value={itemId} onChange={(v) => { setItemId(v); setLotId(""); }} error={E.field("itemId")} />
          <div className="field span-2" role="group" aria-label="Tipo de ajuste">
            <span className="label">Tipo de ajuste</span>
            <div className="row">
              <button type="button" className={`btn ${direction === "out" ? "btn-primary" : ""}`} aria-pressed={direction === "out"} onClick={() => { setDirection("out"); setLotId(""); }}>Restar (−)</button>
              <button type="button" className={`btn ${direction === "in" ? "btn-primary" : ""}`} aria-pressed={direction === "in"} onClick={() => { setDirection("in"); setLotId(""); }}>Sumar (+)</button>
            </div>
          </div>
          <InvField label="Motivo" error={E.field("reason")}>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!E.field("reason")}>
              <option value="">Elige el motivo</option>
              {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </InvField>
          <InvField label={`Cantidad${item ? ` (${item.useUnit})` : ""}`} error={E.field("qty")}>
            <input className="input" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={!!E.field("qty")} />
          </InvField>
          {item?.tracksLots && (
            <InvField label="Lote" error={E.field("lotId")} span2>
              <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)} aria-invalid={!!E.field("lotId")}>
                <option value="">{direction === "in" ? "Lote nuevo (escribe abajo)" : "Elige el lote"}</option>
                {(lots.data ?? []).filter((l) => l.lotCode).map((l) => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
              </select>
            </InvField>
          )}
          {item?.tracksLots && direction === "in" && !lotId && <>
            <InvField label="Número de lote" error={E.field("lotCode")}><input className="input" value={lotCode} maxLength={60} onChange={(e) => setLotCode(e.target.value)} /></InvField>
            <InvField label="Vencimiento" error={E.field("expiresOn")}><input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></InvField>
          </>}
          <InvField label={reason === "other" ? "Explicación (obligatoria)" : "Nota (opcional)"} span2 error={E.field("note")}>
            <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-invalid={!!E.field("note")} />
          </InvField>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Ingresar compra directa ----------------
export function ReceiptDialog({ items, branchId: b0, itemId: i0, onClose, onDone }: { items: InvItem[]; branchId: string; itemId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const suppliers = useApi<any[]>("/api/inventory/suppliers");
  const [branchId, setBranchId] = useState(b0);
  const [itemId, setItemId] = useState(i0 ?? "");
  const [unit, setUnit] = useState<"purchase" | "use">("purchase");
  const [q, setQ] = useState("");
  const [price, setPrice] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const item = items.find((i) => i.id === itemId);
  const n = parseQty(q);
  const save = async () => {
    const cents = parseBs(price || "0");
    const errs: Record<string, string> = {};
    if (!itemId) errs.itemId = "Elige el insumo";
    if (n == null || Number.isNaN(n) || n <= 0) errs.qty = "Escribe una cantidad mayor que cero";
    if (!Number.isFinite(cents) || cents < 0) errs.unitPriceCents = "Precio inválido";
    if (item?.tracksLots && !lotCode.trim()) errs.lotCode = "Indica el número de lote";
    if (item?.tracksLots && !expiresOn) errs.expiresOn = "Indica el vencimiento";
    if (item?.tracksLots && expiresOn && expiresOn < localDate()) errs.expiresOn = "Ese lote ya está vencido: no lo ingreses";
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try {
      const r = await api.post("/api/inventory/receipts", {
        branchId, itemId, qty: n, unit, unitPriceCents: cents, lotCode: item?.tracksLots ? lotCode : null, expiresOn: item?.tracksLots ? expiresOn : null,
        supplierId: supplierId || null, documentRef: doc || null,
      });
      toast(`Ingresaron ${qty(r.qty)} ${item?.useUnit ?? ""} de ${item?.name ?? ""}`); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Ingresar compra" onClose={onClose} footer={<DialogFoot onClose={onClose} busy={busy} label="Ingresar al stock" onSave={save} />}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <p className="muted small">Para compras sin orden. Si hay una orden de compra, regístrala desde «Compras» para que quede la recepción.</p>
        <div className="form-grid">
          <BranchSelect value={branchId} onChange={setBranchId} />
          <ItemSelect items={items} value={itemId} onChange={setItemId} error={E.field("itemId")} />
          <InvField label="Se ingresa en">
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as "purchase" | "use")}>
              <option value="purchase">{item ? `${item.purchaseUnit} (unidad de compra)` : "Unidad de compra"}</option>
              <option value="use">{item ? `${item.useUnit} (unidad de uso)` : "Unidad de uso"}</option>
            </select>
          </InvField>
          <InvField label="Cantidad" error={E.field("qty")}
            hint={item && unit === "purchase" && n && !Number.isNaN(n) ? `= ${qty(n * item.purchaseFactor)} ${item.useUnit}` : undefined}>
            <input className="input" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={!!E.field("qty")} />
          </InvField>
          <InvField label={`Precio por ${unit === "purchase" ? item?.purchaseUnit ?? "unidad de compra" : item?.useUnit ?? "unidad"} (Bs)`} error={E.field("unitPriceCents")}>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
          </InvField>
          <InvField label="Proveedor (opcional)">
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {(suppliers.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </InvField>
          {item?.tracksLots && <>
            <InvField label="Número de lote" error={E.field("lotCode")}><input className="input" value={lotCode} maxLength={60} onChange={(e) => setLotCode(e.target.value)} aria-invalid={!!E.field("lotCode")} /></InvField>
            <InvField label="Vencimiento" error={E.field("expiresOn")}><input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} aria-invalid={!!E.field("expiresOn")} /></InvField>
          </>}
          <InvField label="Factura o nota de entrega (opcional)"><input className="input" value={doc} maxLength={60} onChange={(e) => setDoc(e.target.value)} /></InvField>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Insumo (catálogo) ----------------
export function ItemDialog({ item, onClose, onDone }: { item: Partial<InvItem>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const suppliers = useApi<any[]>("/api/inventory/suppliers");
  const isNew = !item.id;
  const [f, setF] = useState({
    sku: item.sku ?? "", name: item.name ?? "", category: item.category ?? "General", useUnit: item.useUnit ?? "unidad", purchaseUnit: item.purchaseUnit ?? "",
    purchaseFactor: item.purchaseFactor != null ? String(item.purchaseFactor) : "1", tracksLots: item.tracksLots ?? false,
    preferredSupplierId: item.preferredSupplierId ?? "", active: item.active ?? true,
  });
  const [mins, setMins] = useState<Record<string, string>>(() => Object.fromEntries((item.mins ?? []).map((m) => [m.branchId, String(Number(m.minQty))])));
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const save = async () => {
    const factor = parseQty(f.purchaseFactor);
    const errs: Record<string, string> = {};
    if (isNew && !f.sku.trim()) errs.sku = "Indica el código (SKU)";
    if (f.name.trim().length < 2) errs.name = "Escribe el nombre del insumo";
    if (!f.useUnit.trim()) errs.useUnit = "Indica la unidad de uso";
    if (!f.purchaseUnit.trim()) errs.purchaseUnit = "Indica la unidad de compra";
    if (factor == null || Number.isNaN(factor) || factor <= 0) errs.purchaseFactor = "Debe ser un número mayor que cero";
    const minList: { branchId: string; minQty: number }[] = [];
    (me?.branches ?? []).forEach((b, i) => {
      const v = parseQty(mins[b.id] ?? "");
      if (v == null) return;
      if (Number.isNaN(v)) errs[`mins.${i}.minQty`] = "Número inválido"; else minList.push({ branchId: b.id, minQty: v });
    });
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    const body = { ...f, purchaseFactor: factor, preferredSupplierId: f.preferredSupplierId || null, mins: minList };
    try {
      if (isNew) await api.post("/api/inventory/items", body);
      else { const { sku: _s, ...rest } = body; await api.put(`/api/inventory/items/${item.id}`, rest); }
      toast(isNew ? "Insumo creado" : "Insumo actualizado"); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog wide title={isNew ? "Nuevo insumo" : `Editar ${item.name}`} onClose={onClose} footer={<DialogFoot onClose={onClose} busy={busy} label="Guardar" onSave={save} />}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <div className="form-grid">
          <InvField label="Código (SKU)" error={E.field("sku")} hint={isNew ? "Único en la clínica. Letras, números y guiones." : "El código no cambia"}>
            <input className="input" value={f.sku} disabled={!isNew} maxLength={40} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} aria-invalid={!!E.field("sku")} />
          </InvField>
          <InvField label="Categoría" error={E.field("category")}><input className="input" value={f.category} maxLength={60} onChange={set("category")} /></InvField>
          <InvField label="Nombre" span2 error={E.field("name")}><input className="input" value={f.name} maxLength={120} onChange={set("name")} aria-invalid={!!E.field("name")} /></InvField>
          <InvField label="Unidad de uso" error={E.field("useUnit")} hint="Lo que se descuenta al usar: unidad, par, cartucho, ml…"><input className="input" value={f.useUnit} maxLength={30} onChange={set("useUnit")} /></InvField>
          <InvField label="Unidad de compra" error={E.field("purchaseUnit")} hint="Cómo se compra: caja de 100, frasco de 5 ml…"><input className="input" value={f.purchaseUnit} maxLength={40} onChange={set("purchaseUnit")} /></InvField>
          <InvField label="Unidades de uso por unidad de compra" error={E.field("purchaseFactor")} hint="Ej.: una caja de 100 = 100">
            <input className="input" inputMode="decimal" value={f.purchaseFactor} onChange={set("purchaseFactor")} aria-invalid={!!E.field("purchaseFactor")} />
          </InvField>
          <InvField label="Proveedor habitual" error={E.field("preferredSupplierId")}>
            <select className="input" value={f.preferredSupplierId} onChange={set("preferredSupplierId")}>
              <option value="">—</option>
              {(suppliers.data ?? []).filter((s) => s.active || s.id === f.preferredSupplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </InvField>
          <label className="check span-2"><input type="checkbox" checked={f.tracksLots} onChange={(e) => setF({ ...f, tracksLots: e.target.checked })} />Se maneja por lotes con vencimiento</label>
          {E.field("tracksLots") && <span className="inv-err span-2" role="alert">{E.field("tracksLots")}</span>}
          <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo</label>
        </div>
        <fieldset className="inv-fieldset">
          <legend>Stock mínimo por sucursal ({f.useUnit || "unidades de uso"})</legend>
          <div className="form-grid">
            {(me?.branches ?? []).map((b, i) => (
              <InvField key={b.id} label={b.name} error={E.field(`mins.${i}.minQty`)}>
                <input className="input" inputMode="decimal" value={mins[b.id] ?? ""} placeholder="0" onChange={(e) => setMins({ ...mins, [b.id]: e.target.value })} />
              </InvField>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

// ---------------- Nueva transferencia ----------------
export function TransferDialog({ items, branchId: b0, onClose, onDone }: { items: InvItem[]; branchId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const all = useApi<any[]>("/api/branches");
  const [from, setFrom] = useState(b0);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ itemId: string; q: string }[]>([{ itemId: "", q: "" }]);
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const save = async () => {
    const errs: Record<string, string> = {};
    if (!to) errs.toBranchId = "Elige la sucursal de destino";
    const body = lines.map((l, i) => {
      const n = parseQty(l.q);
      if (!l.itemId) errs[`lines.${i}.itemId`] = "Elige el insumo";
      if (n == null || Number.isNaN(n) || n <= 0) errs[`lines.${i}.qty`] = "Cantidad inválida";
      return { itemId: l.itemId, qty: n };
    });
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try {
      const r = await api.post("/api/inventory/transfers", { fromBranchId: from, toBranchId: to, note: note || null, lines: body });
      toast(`Transferencia N° ${r.number} enviada: queda en tránsito hasta que la reciban`); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title="Enviar a otra sucursal" onClose={onClose} footer={<DialogFoot onClose={onClose} busy={busy} label="Enviar" onSave={save} />}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <p className="muted small">Lo enviado sale de esta sucursal ahora y entra en la de destino cuando allí confirmen la recepción. Se envían primero los lotes que vencen antes.</p>
        <div className="form-grid">
          <BranchSelect label="Desde" value={from} onChange={setFrom} />
          <InvField label="Hacia" error={E.field("toBranchId")}>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!E.field("toBranchId")}>
              <option value="">Elige la sucursal de destino</option>
              {(all.data ?? []).filter((b) => b.active && b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </InvField>
        </div>
        {lines.map((l, i) => {
          const it = items.find((x) => x.id === l.itemId);
          return (
            <div key={i} className="inv-line">
              <ItemSelect items={items} value={l.itemId} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: v } : x)))} error={E.field(`lines.${i}.itemId`)} />
              <InvField label={`Cantidad${it ? ` (${it.useUnit})` : ""}`} error={E.field(`lines.${i}.qty`)}>
                <input className="input" inputMode="decimal" value={l.q} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
              </InvField>
              {lines.length > 1 && <button type="button" className="btn btn-ghost btn-icon" aria-label="Quitar línea" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
            </div>
          );
        })}
        <div><button type="button" className="btn" onClick={() => setLines([...lines, { itemId: "", q: "" }])}><Plus size={16} />Agregar insumo</button></div>
        <InvField label="Nota (opcional)"><input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></InvField>
      </div>
    </Dialog>
  );
}

// ---------------- Recibir transferencia ----------------
export function ReceiveTransferDialog({ transfer, onClose, onDone }: { transfer: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, { q: string; reason: string }>>(() =>
    Object.fromEntries(transfer.lines.map((l: any) => [l.id, { q: String(Number(l.qtySent)).replace(".", ","), reason: "" }])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const E = useFormErrors();
  const save = async () => {
    const errs: Record<string, string> = {};
    const lines = transfer.lines.map((l: any, i: number) => {
      const v = vals[l.id]!;
      const n = parseQty(v.q);
      if (n == null || Number.isNaN(n) || n < 0) errs[`lines.${i}.qtyReceived`] = "Cantidad inválida";
      else if (n > Number(l.qtySent)) errs[`lines.${i}.qtyReceived`] = `Máximo ${qty(l.qtySent)}`;
      else if (n < Number(l.qtySent) && v.reason.trim().length < 3) errs[`lines.${i}.reason`] = "Explica la diferencia";
      return { lineId: l.id, qtyReceived: n, reason: v.reason || null };
    });
    if (Object.keys(errs).length) return E.set(errs);
    setBusy(true); E.clear();
    try {
      const r = await api.post(`/api/inventory/transfers/${transfer.id}/receive`, { lines, note: note || null });
      toast(r.differences ? `Recibida con ${r.differences} diferencia(s) registrada(s)` : "Transferencia recibida"); onDone();
    } catch (e) { E.fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={`Recibir transferencia N° ${transfer.number}`} onClose={onClose} footer={<DialogFoot onClose={onClose} busy={busy} label="Confirmar recepción" onSave={save} />}>
      <div className="stack">
        <FormAlert msg={E.msg} />
        <p className="muted small">Desde {transfer.fromBranchName}. Cuenta lo que llegó; si falta algo, anota la diferencia.</p>
        {transfer.lines.map((l: any, i: number) => {
          const v = vals[l.id]!;
          const short = (parseQty(v.q) ?? 0) < Number(l.qtySent);
          return (
            <div key={l.id} className="card card-pad stack-sm">
              <b>{l.itemName}</b>
              <span className="muted small">{l.lotCode ? `Lote ${l.lotCode} · ` : ""}Enviado: {qty(l.qtySent)} {l.useUnit}</span>
              <div className="form-grid">
                <InvField label={`Recibido (${l.useUnit})`} error={E.field(`lines.${i}.qtyReceived`)}>
                  <input className="input" inputMode="decimal" value={v.q} onChange={(e) => setVals({ ...vals, [l.id]: { ...v, q: e.target.value } })} />
                </InvField>
                {short && (
                  <InvField label="¿Qué pasó con la diferencia?" error={E.field(`lines.${i}.reason`)}>
                    <input className="input" value={v.reason} maxLength={300} onChange={(e) => setVals({ ...vals, [l.id]: { ...v, reason: e.target.value } })} />
                  </InvField>
                )}
              </div>
            </div>
          );
        })}
        <InvField label="Nota (opcional)"><input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></InvField>
      </div>
    </Dialog>
  );
}

