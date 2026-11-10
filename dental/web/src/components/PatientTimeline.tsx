// Historial del paciente (R2-18): una sola línea de tiempo con citas, notas, odontograma,
// presupuestos, cargos y pagos, documentos, controles y mensajes. El servidor solo envía lo que
// el rol puede ver. Horas en la zona de la clínica (America/La_Paz).
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, FileSignature, History, MessageSquare, PhoneCall, ReceiptText, Smile, Stethoscope, Wallet } from "lucide-react";
import { api, qs } from "../lib/api";
import { bs } from "../lib/format";
import { Empty, Loading } from "./ui";

const ICONS: Record<string, typeof History> = {
  appointments: CalendarDays, notes: Stethoscope, odontogram: Smile, budgets: ReceiptText, payments: Wallet,
  documents: FileSignature, recalls: PhoneCall, messages: MessageSquare,
};

interface Item {
  id: string; ids: string[]; groupKey: string; count: number; category: string; categoryLabel: string; kind: string; title: string; detail: string | null;
  at: string; local: string; firstAt: string; firstLocal: string; appointmentLocal: string | null; actor: string | null; branch: string | null; amountCents: number | null;
}

const dayLabel = (iso: string) => {
  const s = new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

export function PatientTimeline({ patientId }: { patientId: string }) {
  const [types, setTypes] = useState<string[]>([]);
  const [available, setAvailable] = useState<{ id: string; label: string }[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (after: string | null) => {
    const n = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const r = await api.get<{ available: any[]; items: Item[]; nextCursor: string | null }>(
        `/api/patients/${patientId}/timeline${qs({ types: types.length ? types.join(",") : undefined, cursor: after ?? undefined, limit: 30 })}`);
      if (n !== seq.current) return;
      setAvailable(r.available);
      setCursor(r.nextCursor);
      setItems((prev) => {
        if (!after || !prev) return r.items;
        // Une un grupo que quedó partido entre dos páginas.
        const out = [...prev];
        const [first, ...rest] = r.items;
        const last = out[out.length - 1];
        if (first && last && last.groupKey === first.groupKey) {
          out[out.length - 1] = { ...last, count: last.count + first.count, ids: [...last.ids, ...first.ids], firstAt: first.firstAt, firstLocal: first.firstLocal };
          return [...out, ...rest];
        }
        return [...out, ...r.items];
      });
    } catch (e: any) {
      if (n === seq.current) setErr(e.message);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, [patientId, types]);

  useEffect(() => { setItems(null); load(null); }, [load]);

  const toggle = (id: string) => setTypes((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  let lastDay = "";
  return (
    <section className="card span-all" aria-labelledby="historial-title">
      <div className="card-head">
        <h2 id="historial-title" className="row" style={{ gap: 8 }}><History size={18} />Historial</h2>
        <span className="muted small">Horas de La Paz</span>
      </div>
      <div className="card-pad stack">
        <div className="row tl-filters" role="group" aria-label="Filtrar el historial por tipo">
          <button type="button" className={`chip ${types.length === 0 ? "on" : ""}`} aria-pressed={types.length === 0} onClick={() => setTypes([])}>Todo</button>
          {available.map((a) => (
            <button key={a.id} type="button" className={`chip ${types.includes(a.id) ? "on" : ""}`} aria-pressed={types.includes(a.id)} onClick={() => toggle(a.id)}>{a.label}</button>
          ))}
        </div>
        {err && <div className="alert danger" role="alert">No se pudo cargar el historial: {err}</div>}
        {!items ? <Loading rows={5} /> : !items.length ? <Empty>No hay movimientos{types.length ? " de ese tipo" : ""} todavía.</Empty> : (
          <ol className="timeline">
            {items.map((it) => {
              const k = dayKey(it.at);
              const head = k !== lastDay ? <li key={`d-${k}-${it.id}`} className="tl-day"><h3>{dayLabel(it.at)}</h3></li> : null;
              lastDay = k;
              const Icon = ICONS[it.category] ?? History;
              return [head, (
                <li key={it.id} className={`tl-item tl-${it.category}`}>
                  <span className="tl-icon" aria-hidden="true"><Icon size={15} /></span>
                  <div className="tl-body">
                    <div className="row-between" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                      <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                        <span className="tl-title"><b>{it.title}</b>{it.count > 1 && <span className="badge warn" style={{ marginLeft: 6 }}>×{it.count}</span>}</span>
                        {it.detail && <span className="tl-detail">{it.detail}</span>}
                        <span className="muted small">
                          {it.count > 1 ? `Entre ${it.firstLocal} y ${it.local}` : it.local.slice(11)}
                          {it.actor ? ` · ${it.actor}` : ""}{it.branch ? ` · ${it.branch}` : ""} · <span className="sr-only">Tipo: </span>{it.categoryLabel}
                        </span>
                      </div>
                      {it.amountCents != null && <span className={`tl-amount ${it.amountCents < 0 ? "neg" : ""}`}>{bs(it.amountCents)}</span>}
                    </div>
                  </div>
                </li>
              )];
            })}
          </ol>
        )}
        {cursor && <button className="btn" disabled={busy} onClick={() => load(cursor)} style={{ alignSelf: "center" }}>{busy ? "Cargando…" : "Ver más antiguos"}</button>}
      </div>
    </section>
  );
}
