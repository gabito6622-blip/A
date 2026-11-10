import { LOWER_POSITIONS, UPPER_POSITIONS, screenSites, toothAt, type Face, type PerioData } from "../../lib/perio";

export const COL = 34;
const K = 4; // px por mm
const H = 112;

/**
 * Gráfico de una cara de una arcada: línea roja = margen gingival, línea azul = fondo de la bolsa (NIC desde el LAC).
 * Las líneas se CORTAN en dientes ausentes y en sitios sin medir (nunca se interpola donde no hay datos).
 * Si un sitio tiene sondaje pero no recesión, el sondaje se dibuja desde el LAC (se indica en la leyenda).
 */
export function PerioChart({ data, arch, face }: { data: PerioData; arch: "U" | "L"; face: Face }) {
  const positions = arch === "U" ? UPPER_POSITIONS : LOWER_POSITIONS;
  const upper = arch === "U";
  // Superior: la raíz va hacia arriba; inferior: hacia abajo. y(mm) desde el LAC hacia apical.
  const cej = upper ? 88 : 24;
  const y = (mmApical: number) => Math.max(2, Math.min(H - 2, upper ? cej - mmApical * K : cej + mmApical * K));
  const gm: ({ x: number; y: number } | null)[] = [];
  const pb: ({ x: number; y: number } | null)[] = [];
  const missing: number[] = [];
  const implants: number[] = [];
  positions.forEach((pos, i) => {
    const tooth = toothAt(pos, data.primary);
    const t = data.teeth[String(tooth)];
    if (t?.missing) missing.push(i);
    if (t?.implant) implants.push(i);
    screenSites(pos, face).forEach((s, j) => {
      const x = (i * 3 + j) * COL + COL / 2;
      const sd = t?.missing ? undefined : t?.sites?.[s];
      gm.push(sd?.rec != null ? { x, y: y(sd.rec) } : null);
      pb.push(sd?.pd != null ? { x, y: y((sd.rec ?? 0) + sd.pd) } : null);
    });
  });
  const segments = (pts: ({ x: number; y: number } | null)[]) => {
    const out: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (const p of pts) {
      if (p) cur.push(p);
      else if (cur.length) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
  };
  const W = positions.length * 3 * COL;
  const line = (seg: { x: number; y: number }[]) => (seg.length === 1 ? `M${seg[0]!.x - 5},${seg[0]!.y}h10` : "M" + seg.map((p) => `${p.x},${p.y}`).join("L"));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico ${face === "B" ? "vestibular" : upper ? "palatino" : "lingual"} de la arcada ${upper ? "superior" : "inferior"}`} style={{ display: "block" }}>
      {/* referencias: LAC y 3 / 6 mm hacia apical */}
      <line x1={0} x2={W} y1={cej} y2={cej} stroke="#94a3b8" strokeWidth={1.2} />
      {[3, 6, 9].map((mm) => <line key={mm} x1={0} x2={W} y1={y(mm)} y2={y(mm)} stroke={mm === 6 ? "#fca5a5" : "#e2e8f0"} strokeDasharray="4 4" />)}
      {positions.map((_, i) => <line key={i} x1={i * 3 * COL} x2={i * 3 * COL} y1={0} y2={H} stroke={i === 8 ? "#33495a" : "#e2e8f0"} strokeWidth={i === 8 ? 2 : 1} />)}
      {missing.map((i) => (
        <g key={`m${i}`}>
          <rect x={i * 3 * COL} y={0} width={3 * COL} height={H} fill="#eef2f5" />
          <path d={`M${i * 3 * COL + 30},${H / 2 - 14}l42,28M${i * 3 * COL + 72},${H / 2 - 14}l-42,28`} stroke="#94a3b8" strokeWidth={2} />
        </g>
      ))}
      {implants.map((i) => <text key={`i${i}`} x={i * 3 * COL + 1.5 * COL} y={upper ? 14 : H - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#6d28d9">implante</text>)}
      {segments(pb).map((seg, k) => <path key={`p${k}`} d={line(seg)} fill="none" stroke="#1d4ed8" strokeWidth={2.4} strokeLinejoin="round" />)}
      {segments(gm).map((seg, k) => <path key={`g${k}`} d={line(seg)} fill="none" stroke="#dc2626" strokeWidth={2.4} strokeLinejoin="round" />)}
      {pb.map((p, k) => p && <circle key={`c${k}`} cx={p.x} cy={p.y} r={2.6} fill="#1d4ed8" />)}
    </svg>
  );
}

export function ChartLegend() {
  return (
    <div className="perio-legend">
      <span><i style={{ background: "#dc2626", height: 3 }} />Margen gingival</span>
      <span><i style={{ background: "#1d4ed8", height: 3 }} />Fondo de la bolsa (NIC)</span>
      <span><i style={{ background: "#94a3b8", height: 2 }} />Límite amelocementario (LAC)</span>
      <span><i style={{ background: "#fca5a5", height: 2 }} />6 mm desde el LAC</span>
      <span className="muted">Las líneas se cortan en dientes ausentes o sitios sin medir. Sin recesión registrada, el sondaje se dibuja desde el LAC.</span>
    </div>
  );
}
