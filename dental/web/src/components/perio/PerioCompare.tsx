import { useState } from "react";
import { useApi } from "../../lib/hooks";
import { fmtDateTime } from "../../lib/format";
import { Field, Loading } from "../ui";
import { LOWER_POSITIONS, PERMANENT_TEETH, SITES, UPPER_POSITIONS, screenSites, siteLabel, type Comparison, type Face, type Indices, type SiteComparison } from "../../lib/perio";
import { fmtMm, fmtPct } from "./IndicesPanel";
import "./perio.css";

export interface ExamSummary { id: string; status: string; createdAt: string; closedAt: string | null; examinerName: string; indices: Indices; amendsExamId: string | null }
export const examLabel = (e: ExamSummary) =>
  `${fmtDateTime(e.closedAt ?? e.createdAt)} · ${e.examinerName}${e.status === "draft" ? " (borrador)" : ""}${e.amendsExamId ? " (enmienda)" : ""}`;

const STATUS_CLASS = { improved: "cmp-improved", worse: "cmp-worse", unchanged: "cmp-unchanged", not_comparable: "cmp-na" } as const;
const STATUS_LABEL = { improved: "mejoró", worse: "empeoró", unchanged: "sin cambio", not_comparable: "no comparable" } as const;

export function PerioCompare({ exams }: { exams: ExamSummary[] }) {
  const usable = exams.filter((e) => e.status !== "discarded");
  const closed = usable.filter((e) => e.status === "closed");
  const [b, setB] = useState(closed[0]?.id ?? usable[0]?.id ?? "");
  const [a, setA] = useState(closed[1]?.id ?? usable[1]?.id ?? "");
  const [threshold, setThreshold] = useState(2);
  const cmp = useApi<{ a: ExamSummary; b: ExamSummary; comparison: Comparison }>(a && b && a !== b ? `/api/perio-exams/compare?a=${a}&b=${b}&threshold=${threshold}` : null);
  if (usable.length < 2) return <div className="alert info">Se necesitan al menos dos exploraciones (no descartadas) para comparar.</div>;
  const c = cmp.data?.comparison;
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <Field label="Exploración anterior"><select className="input" value={a} onChange={(e) => setA(e.target.value)}>{usable.map((e) => <option key={e.id} value={e.id}>{examLabel(e)}</option>)}</select></Field>
          <Field label="Exploración posterior"><select className="input" value={b} onChange={(e) => setB(e.target.value)}>{usable.map((e) => <option key={e.id} value={e.id}>{examLabel(e)}</option>)}</select></Field>
          <Field label="Cambio mínimo para contar" hint="Con 2 mm, un cambio de 1 mm se toma como error de medición.">
            <select className="input" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>{[1, 2, 3].map((t) => <option key={t} value={t}>{t} mm</option>)}</select>
          </Field>
        </div>
        {a === b && <div className="alert warn" style={{ marginTop: 10 }}>Elige dos exploraciones distintas.</div>}
        {cmp.error && <div className="alert danger" style={{ marginTop: 10 }}>{cmp.error}</div>}
      </div>
      {cmp.loading && !c && <Loading />}
      {c && cmp.data && (
        <>
          <div className="card">
            <div className="card-head"><h3>Índices: {fmtDateTime(cmp.data.a.closedAt ?? cmp.data.a.createdAt)} → {fmtDateTime(cmp.data.b.closedAt ?? cmp.data.b.createdAt)}</h3></div>
            <div className="table-wrap">
              <table className="table" data-testid="perio-deltas">
                <thead><tr><th>Indicador</th><th className="num">Antes</th><th className="num">Después</th><th className="num">Diferencia</th></tr></thead>
                <tbody>
                  <DeltaRow label="Sangrado al sondaje" a={fmtPct(c.indicesA.bleeding.pct)} aSub={`${c.indicesA.bleeding.count}/${c.indicesA.bleeding.denom}`} b={fmtPct(c.indicesB.bleeding.pct)} bSub={`${c.indicesB.bleeding.count}/${c.indicesB.bleeding.denom}`} d={c.deltas.bleedingPct} unit=" pp" />
                  <DeltaRow label="Placa" a={fmtPct(c.indicesA.plaque.pct)} aSub={`${c.indicesA.plaque.count}/${c.indicesA.plaque.denom}`} b={fmtPct(c.indicesB.plaque.pct)} bSub={`${c.indicesB.plaque.count}/${c.indicesB.plaque.denom}`} d={c.deltas.plaquePct} unit=" pp" />
                  <DeltaRow label="Sondaje medio" a={fmtMm(c.indicesA.meanPd.value)} aSub={`${c.indicesA.meanPd.denom} sitios`} b={fmtMm(c.indicesB.meanPd.value)} bSub={`${c.indicesB.meanPd.denom} sitios`} d={c.deltas.meanPd} unit=" mm" />
                  <DeltaRow label="NIC medio" a={fmtMm(c.indicesA.meanCal.value)} aSub={`${c.indicesA.meanCal.denom} sitios`} b={fmtMm(c.indicesB.meanCal.value)} bSub={`${c.indicesB.meanCal.denom} sitios`} d={c.deltas.meanCal} unit=" mm" />
                  <DeltaRow label="Sitios con sondaje ≥ 4 mm" a={String(c.indicesA.pd4.sites)} b={String(c.indicesB.pd4.sites)} d={c.deltas.pd4Sites} />
                  <DeltaRow label="Dientes con algún sitio ≥ 4 mm" a={String(c.indicesA.pd4.teeth)} b={String(c.indicesB.pd4.teeth)} d={c.deltas.pd4Teeth} />
                  <DeltaRow label="Sitios con sondaje ≥ 6 mm" a={String(c.indicesA.pd6.sites)} b={String(c.indicesB.pd6.sites)} d={c.deltas.pd6Sites} />
                  <DeltaRow label="Dientes con algún sitio ≥ 6 mm" a={String(c.indicesA.pd6.teeth)} b={String(c.indicesB.pd6.teeth)} d={c.deltas.pd6Teeth} />
                </tbody>
              </table>
            </div>
            <div className="card-pad muted small">pp = puntos porcentuales. En todos estos indicadores, un número menor es favorable (verde).</div>
          </div>
          <div className="card">
            <div className="card-head" style={{ flexWrap: "wrap" }}>
              <h3>Sondaje por sitio (diferencia en mm)</h3>
              <div className="perio-legend" data-testid="perio-cmp-counts">
                <span><i className="cmp-improved" style={{ border: "1px solid #86efac" }} />Mejoró: {c.counts.improved}</span>
                <span><i className="cmp-worse" style={{ border: "1px solid #fca5a5" }} />Empeoró: {c.counts.worse}</span>
                <span><i className="cmp-unchanged" style={{ border: "1px solid #cbd5e1" }} />Sin cambio: {c.counts.unchanged}</span>
                <span className="muted">No comparables (sin medir o ausentes): {c.counts.not_comparable}</span>
              </div>
            </div>
            <div className="perio-scroll">
              <div className="perio-grid" role="table" aria-label="Diferencia de sondaje por sitio">
                <CmpArch arch="U" sites={c.sites} />
                <div className="perio-sep" />
                <CmpArch arch="L" sites={c.sites} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DeltaRow({ label, a, b, d, unit = "", aSub, bSub }: { label: string; a: string; b: string; d: number | null; unit?: string; aSub?: string; bSub?: string }) {
  const cls = d == null || d === 0 ? "" : d < 0 ? "delta-good" : "delta-bad";
  const txt = d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toLocaleString("es-BO", { maximumFractionDigits: 2 })}${unit}`;
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{a}{aSub && <div className="muted small">{aSub}</div>}</td>
      <td className="num">{b}{bSub && <div className="muted small">{bSub}</div>}</td>
      <td className={`num ${cls}`}>{txt}</td>
    </tr>
  );
}

function CmpArch({ arch, sites }: { arch: "U" | "L"; sites: SiteComparison[] }) {
  const positions = arch === "U" ? UPPER_POSITIONS : LOWER_POSITIONS;
  const faces: Face[] = arch === "U" ? ["B", "L"] : ["L", "B"];
  // compareExams() devuelve los sitios en el orden de PERMANENT_TEETH × SITES (una entrada por posición y sitio).
  const at = (pos: number, s: (typeof SITES)[number]) => sites[PERMANENT_TEETH.indexOf(pos) * 6 + SITES.indexOf(s)];
  return (
    <>
      <div role="row" style={{ display: "contents" }}>
        <div className="perio-label">{arch === "U" ? "Superior" : "Inferior"}</div>
        {positions.map((p, i) => <div key={p} className={`perio-cell perio-head span3 ${i === 8 ? "mid" : "t0"}`}>{at(p, "MB")?.tooth ?? p}</div>)}
      </div>
      {faces.map((face) => (
        <div role="row" key={face} style={{ display: "contents" }}>
          <div className="perio-label">{face === "B" ? "Vestibular" : arch === "U" ? "Palatino" : "Lingual"}</div>
          {positions.flatMap((pos, i) => screenSites(pos, face).map((s, j) => {
            const x = at(pos, s);
            const st = x?.status ?? "not_comparable";
            const title = x ? `${x.tooth} ${siteLabel(x.tooth, s)}: ${x.pdA ?? "—"} → ${x.pdB ?? "—"} mm (${STATUS_LABEL[st]})` : "";
            return (
              <div key={`${pos}${s}`} role="cell" title={title} aria-label={title} data-status={st}
                className={`perio-cell ${STATUS_CLASS[st]} ${j === 0 ? (i === 8 ? "mid" : "t0") : ""}`} style={{ cursor: "default", fontSize: 12.5 }}>
                {x?.delta == null ? "·" : x.delta > 0 ? `+${x.delta}` : x.delta < 0 ? `−${-x.delta}` : "0"}
              </div>
            );
          }))}
        </div>
      ))}
    </>
  );
}
