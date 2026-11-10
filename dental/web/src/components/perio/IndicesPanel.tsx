import type { Indices } from "../../lib/perio";

export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("es-BO", { maximumFractionDigits: 1 })} %`);
export const fmtMm = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("es-BO", { maximumFractionDigits: 2 })} mm`);

/** Índices con su denominador SIEMPRE visible (sobre sitios medidos de dientes presentes). */
export function IndicesPanel({ ix }: { ix: Indices }) {
  const of = (count: number, denom: number) => `${count} de ${denom} sitios medidos`;
  return (
    <div className="stack-sm" data-testid="perio-indices">
      <div className="muted small">
        Base del cálculo: <b>{ix.sitesMeasured}</b> sitios medidos en <b>{ix.teethMeasured}</b> de {ix.teethPresent} dientes presentes
        ({ix.sitesPossible} sitios posibles). Los porcentajes se calculan solo sobre los sitios medidos.
      </div>
      <div className="perio-kpis">
        <div className="kpi" data-testid="ix-bleeding"><div className="label">Sangrado al sondaje</div><div className="value">{fmtPct(ix.bleeding.pct)}</div><div className="foot">{of(ix.bleeding.count, ix.bleeding.denom)}</div></div>
        <div className="kpi" data-testid="ix-plaque"><div className="label">Placa</div><div className="value">{fmtPct(ix.plaque.pct)}</div><div className="foot">{of(ix.plaque.count, ix.plaque.denom)}</div></div>
        <div className="kpi"><div className="label">Supuración</div><div className="value">{fmtPct(ix.suppuration.pct)}</div><div className="foot">{of(ix.suppuration.count, ix.suppuration.denom)}</div></div>
        <div className="kpi" data-testid="ix-meanpd"><div className="label">Sondaje medio</div><div className="value">{fmtMm(ix.meanPd.value)}</div><div className="foot">sobre {ix.meanPd.denom} sitios</div></div>
        <div className="kpi"><div className="label">NIC medio (sondaje + recesión)</div><div className="value">{fmtMm(ix.meanCal.value)}</div><div className="foot">sobre {ix.meanCal.denom} sitios con sondaje y recesión (sin implantes)</div></div>
        <div className="kpi" data-testid="ix-pd4"><div className="label">Sondaje ≥ 4 mm</div><div className="value">{ix.pd4.sites} sitios</div><div className="foot">en {ix.pd4.teeth} dientes</div></div>
        <div className="kpi" data-testid="ix-pd6"><div className="label">Sondaje ≥ 6 mm</div><div className="value">{ix.pd6.sites} sitios</div><div className="foot">en {ix.pd6.teeth} dientes</div></div>
      </div>
    </div>
  );
}
