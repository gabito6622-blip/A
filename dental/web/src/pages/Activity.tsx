// Diario de actividad del personal (R2-37): quién hizo qué y cuándo, en lenguaje claro.
// Se arma sobre la auditoría (no se puede borrar) y no muestra datos clínicos.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { addDays, localDate } from "../lib/format";
import { Empty, Field, Loading } from "../components/ui";
import "../components/coordination/coordination.css";

interface Item { id: string; at: string; local: string; date: string; time: string; actorName: string | null; actorRole: string | null; branchName: string | null; type: string; typeLabel: string; phrase: string }

const dayLabel = (d: string) => {
  const s = new Intl.DateTimeFormat("es-BO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z"));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function ActivityPage() {
  const { can } = useAuth();
  const opts = useApi<any>(can("audit.read") ? "/api/activity/options" : null);
  const [f, setF] = useState({ userId: "", branchId: "", type: "", from: addDays(localDate(), -6), to: localDate() });
  const [items, setItems] = useState<Item[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const filters = { userId: f.userId || undefined, branchId: f.branchId || undefined, type: f.type || undefined, from: f.from || undefined, to: f.to || undefined };
  const key = JSON.stringify(filters);
  const load = useCallback(async (after: string | null) => {
    const n = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const r = await api.get<{ items: Item[]; nextCursor: string | null }>(`/api/activity${qs({ ...JSON.parse(key), cursor: after ?? undefined, limit: 50 })}`);
      if (n !== seq.current) return;
      setItems((prev) => (after && prev ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e: any) { if (n === seq.current) setErr(e.message); } finally { if (n === seq.current) setBusy(false); }
  }, [key]);
  useEffect(() => {
    if (f.from && f.to && f.from > f.to) { setErr("La fecha «Desde» es posterior a «Hasta»"); return; }
    setItems(null); load(null);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can("audit.read")) return <div className="alert danger">Solo propietario o administración pueden ver el diario de actividad.</div>;
  const rangeErr = f.from && f.to && f.from > f.to;
  let lastDay = "";
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Actividad del equipo</h1>
          <p className="sub">Quién hizo qué y cuándo. Sale de la auditoría, que nadie puede borrar; no incluye datos clínicos.</p>
        </div>
        <a className="btn" href={`/api/activity.xlsx${qs(filters)}`} download aria-disabled={!!rangeErr}><Download size={16} />Exportar a Excel</a>
      </div>
      <div className="card card-pad">
        <div className="co-filters" role="group" aria-label="Filtros del diario">
          <Field label="Persona">
            <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
              <option value="">Todo el equipo</option>
              {(opts.data?.people ?? []).map((p: any) => <option key={p.userId} value={p.userId}>{p.fullName}{p.active ? "" : " (inactiva)"}</option>)}
            </select>
          </Field>
          <Field label="Sucursal">
            <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <option value="">Todas</option>
              {(opts.data?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Tipo">
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="">Todos</option>
              {(opts.data?.types ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Desde"><input className="input" type="date" value={f.from} max={f.to || undefined} aria-invalid={!!rangeErr} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={f.to} aria-invalid={!!rangeErr} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        {rangeErr && <p className="co-err" role="alert" style={{ margin: "8px 0 0" }}>La fecha «Desde» es posterior a «Hasta».</p>}
      </div>
      {err && !rangeErr && <div className="alert danger" role="alert">{err}</div>}
      <section className="card" aria-label="Diario de actividad">
        {!items ? <Loading rows={6} /> : !items.length ? <Empty>No hay actividad con esos filtros.</Empty> : (
          <ul className="co-feed">
            {items.map((it) => {
              const head = it.date !== lastDay ? <li key={`d-${it.date}-${it.id}`} className="co-day">{dayLabel(it.date)}</li> : null;
              lastDay = it.date;
              return [head, (
                <li key={it.id}>
                  <time dateTime={it.at}>{it.time}</time>
                  <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{it.phrase}</span>
                    <span className="muted small">{[it.actorRole, it.branchName, it.typeLabel].filter(Boolean).join(" · ")}</span>
                  </div>
                </li>
              )];
            })}
          </ul>
        )}
        {cursor && <div className="card-pad" style={{ textAlign: "center" }}><button className="btn" disabled={busy} onClick={() => load(cursor)}>{busy ? "Cargando…" : "Ver más antiguos"}</button></div>}
      </section>
    </div>
  );
}
