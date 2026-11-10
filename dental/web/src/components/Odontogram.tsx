import { useMemo, useState } from "react";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Empty, Field, Loading, useToast } from "./ui";

type Surface = "M" | "D" | "O" | "V" | "L";
interface Entry { id: string; tooth: number; surfaces: Surface[]; condition: string; state: "existing" | "planned" | "completed"; notes: string | null; recordedAt: string; recordedBy: string; voided?: boolean; voidsEntryId?: string | null }

const Q1 = [18, 17, 16, 15, 14, 13, 12, 11], Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
const Q4 = [48, 47, 46, 45, 44, 43, 42, 41], Q3 = [31, 32, 33, 34, 35, 36, 37, 38];
const Q5 = [55, 54, 53, 52, 51], Q6 = [61, 62, 63, 64, 65], Q8 = [85, 84, 83, 82, 81], Q7 = [71, 72, 73, 74, 75];
const STATE_LABEL = { existing: "Existente", planned: "Planificado", completed: "Realizado" } as const;
const SURF_LABEL: Record<Surface, string> = { M: "Mesial", D: "Distal", O: "Oclusal/incisal", V: "Vestibular", L: "Lingual/palatino" };

const RED = "#dc2626", BLUE = "#1d4ed8";

/** Qué superficie ocupa cada zona del dibujo según el cuadrante (vista del profesional). */
function regionMap(tooth: number): Record<"top" | "bottom" | "left" | "right" | "center", Surface> {
  const q = Math.floor(tooth / 10);
  const upper = [1, 2, 5, 6].includes(q);
  const viewerLeft = [1, 4, 5, 8].includes(q); // lado derecho del paciente
  return { top: upper ? "V" : "L", bottom: upper ? "L" : "V", left: viewerLeft ? "D" : "M", right: viewerLeft ? "M" : "D", center: "O" };
}

function surfaceColor(entries: Entry[], s: Surface): { fill: string; dashed: boolean } | null {
  const e = [...entries].reverse().find((x) => x.surfaces.includes(s));
  if (!e) return null;
  if (e.state === "planned") return { fill: "#fecaca", dashed: true };
  if (e.condition === "caries") return { fill: RED, dashed: false };
  if (e.condition === "fracture") return { fill: "#ea580c", dashed: false };
  if (e.condition === "sealant") return { fill: "#60a5fa", dashed: false };
  return { fill: BLUE, dashed: false };
}

function ToothSvg({ tooth, entries, size = 38, onSurface }: { tooth: number; entries: Entry[]; size?: number; onSurface?: (s: Surface) => void }) {
  const map = regionMap(tooth);
  const regions = {
    top: "0,0 40,0 28,12 12,12", bottom: "0,40 40,40 28,28 12,28", left: "0,0 12,12 12,28 0,40", right: "40,0 28,12 28,28 40,40",
  } as const;
  const whole = entries.filter((e) => e.surfaces.length === 0);
  const last = (c: string) => [...whole].reverse().find((e) => e.condition === c);
  const col = (e: Entry) => (e.state === "planned" || ["root_remnant", "mobility", "extraction"].includes(e.condition) && e.state !== "completed" ? RED : BLUE);
  const missing = last("missing"), extraction = last("extraction"), crown = last("crown"), endo = last("endodontics"), implant = last("implant");
  const textMarks = ([["pontic", "PT"], ["removable_prosthesis", "PR"], ["orthodontic_appliance", "OR"], ["root_remnant", "RR"], ["mobility", "MV"], ["unerupted", "NE"]] as const)
    .map(([c, t]) => ({ e: last(c), t })).filter((x) => x.e);
  return (
    <svg width={size} height={size} viewBox="-2 -2 44 44" aria-hidden="true">
      {(Object.keys(regions) as (keyof typeof regions)[]).map((k) => {
        const c = surfaceColor(entries, map[k]);
        return <polygon key={k} points={regions[k]} fill={c?.fill ?? "#fff"} stroke={c?.dashed ? RED : "#94a3b8"} strokeWidth={c?.dashed ? 1.6 : 1} strokeDasharray={c?.dashed ? "3 2" : undefined}
          onClick={(ev) => { if (onSurface) { ev.stopPropagation(); onSurface(map[k]); } }} style={{ cursor: "pointer" }}><title>{SURF_LABEL[map[k]]}</title></polygon>;
      })}
      {(() => { const c = surfaceColor(entries, "O"); return <rect x={12} y={12} width={16} height={16} fill={c?.fill ?? "#fff"} stroke={c?.dashed ? RED : "#94a3b8"} strokeDasharray={c?.dashed ? "3 2" : undefined} onClick={(ev) => { if (onSurface) { ev.stopPropagation(); onSurface("O"); } }} style={{ cursor: "pointer" }}><title>{SURF_LABEL.O}</title></rect>; })()}
      {crown && <circle cx={20} cy={20} r={21} fill="none" stroke={col(crown)} strokeWidth={2.4} />}
      {endo && <line x1={20} y1={-1} x2={20} y2={41} stroke={col(endo)} strokeWidth={3} />}
      {implant && <text x={20} y={26} textAnchor="middle" fontSize={16} fontWeight={800} fill={col(implant)}>I</text>}
      {missing && <g stroke={col(missing)} strokeWidth={3.2}><line x1={2} y1={2} x2={38} y2={38} /><line x1={38} y1={2} x2={2} y2={38} /></g>}
      {extraction && !missing && <g stroke={col(extraction)} strokeWidth={3.2}><line x1={2} y1={2} x2={38} y2={38} /><line x1={38} y1={2} x2={2} y2={38} /></g>}
      {textMarks.slice(0, 1).map(({ e, t }) => <text key={t} x={20} y={25} textAnchor="middle" fontSize={12} fontWeight={800} fill={col(e!)}>{t}</text>)}
    </svg>
  );
}

export function Odontogram({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const toast = useToast();
  const data = useApi<{ active: Entry[]; history: Entry[] }>(`/api/patients/${patientId}/odontogram`);
  const meta = useApi<{ conditions: Record<string, { label: string; surface: boolean }> }>("/api/odontogram/conditions");
  const [dentition, setDentition] = useState<"permanent" | "primary" | "mixed">("permanent");
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<{ condition: string; surfaces: Surface[]; state: "existing" | "planned" | "completed"; notes: string }>({ condition: "caries", surfaces: [], state: "existing", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const byTooth = useMemo(() => {
    const m = new Map<number, Entry[]>();
    for (const e of data.data?.active ?? []) m.set(e.tooth, [...(m.get(e.tooth) ?? []), e]);
    return m;
  }, [data.data]);
  const conditions = meta.data?.conditions ?? {};
  const cond = conditions[form.condition];

  const pick = (t: number, s?: Surface) => {
    setSel(t); setErr(null);
    if (s) setForm((f) => ({ ...f, surfaces: f.surfaces.includes(s) && sel === t ? f.surfaces.filter((x) => x !== s) : sel === t ? [...f.surfaces, s] : [s] }));
    else if (sel !== t) setForm((f) => ({ ...f, surfaces: [] }));
  };
  const save = async () => {
    if (!sel) return;
    setErr(null);
    try {
      await api.post(`/api/patients/${patientId}/odontogram`, { tooth: sel, surfaces: cond?.surface ? form.surfaces : [], condition: form.condition, state: form.state, notes: form.notes || null });
      toast(`Pieza ${sel}: registrado`);
      setForm((f) => ({ ...f, surfaces: [], notes: "" }));
      data.reload();
    } catch (e: any) { setErr(e.message); }
  };
  const voidEntry = async (id: string) => {
    const reason = window.prompt("Motivo de la anulación (queda en el historial):");
    if (!reason) return;
    try { await api.post(`/api/odontogram/${id}/void`, { reason }); toast("Registro anulado"); data.reload(); } catch (e: any) { toast(e.message, true); }
  };

  const Quad = ({ teeth }: { teeth: number[] }) => (
    <div className="quad">
      {teeth.map((t) => (
        <div key={t} className={`tooth ${sel === t ? "selected" : ""}`} onClick={() => pick(t)} role="button" tabIndex={0} aria-label={`Pieza ${t}`} onKeyDown={(e) => e.key === "Enter" && pick(t)}>
          {Math.floor(t / 10) <= 2 || (Math.floor(t / 10) >= 5 && Math.floor(t / 10) <= 6) ? <span className="tn">{t}</span> : null}
          <ToothSvg tooth={t} entries={byTooth.get(t) ?? []} onSurface={canWrite ? (s) => pick(t, s) : undefined} />
          {[3, 4, 7, 8].includes(Math.floor(t / 10)) ? <span className="tn">{t}</span> : null}
        </div>
      ))}
    </div>
  );

  if (!data.data || !meta.data) return <Loading rows={6} />;
  const selEntries = sel ? byTooth.get(sel) ?? [] : [];
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
      <div className="card card-pad stack">
        <div className="row-between">
          <div className="row" role="radiogroup" aria-label="Dentición">
            {(["permanent", "mixed", "primary"] as const).map((d) => (
              <button key={d} className={`btn btn-sm ${dentition === d ? "btn-primary" : ""}`} onClick={() => setDentition(d)}>{d === "permanent" ? "Permanente" : d === "primary" ? "Temporal" : "Mixta"}</button>
            ))}
          </div>
          <div className="legend">
            <span><i className="dot" style={{ background: RED }} />Hallazgo / por tratar</span>
            <span><i className="dot" style={{ background: BLUE }} />Existente / realizado</span>
            <span><i className="dot" style={{ background: "#fecaca", border: `1px dashed ${RED}` }} />Planificado</span>
          </div>
        </div>
        <div className="odonto">
          {dentition !== "primary" && <div className="arch"><Quad teeth={Q1} /><Quad teeth={Q2} /></div>}
          {dentition !== "permanent" && <div className="arch"><Quad teeth={Q5} /><Quad teeth={Q6} /></div>}
          {dentition !== "permanent" && <div className="arch"><Quad teeth={Q8} /><Quad teeth={Q7} /></div>}
          {dentition !== "primary" && <div className="arch"><Quad teeth={Q4} /><Quad teeth={Q3} /></div>}
        </div>
        <p className="muted small">Notación FDI. Toca una pieza para ver su detalle{canWrite ? "; toca las superficies para seleccionarlas" : ""}.</p>
      </div>

      {sel && (
        <div className="card">
          <div className="card-head"><h2>Pieza {sel}</h2><button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Cerrar</button></div>
          <div className="card-pad grid grid-2">
            <div className="stack">
              <h3>Estado actual</h3>
              {selEntries.length ? selEntries.map((e) => (
                <div key={e.id} className="row-between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <b>{conditions[e.condition]?.label ?? e.condition}{e.surfaces.length ? ` · ${e.surfaces.join(", ")}` : ""}</b>
                    <span className="muted small">{STATE_LABEL[e.state]} · {fmtDateTime(e.recordedAt)} · {e.recordedBy}</span>
                    {e.notes && <span className="small">{e.notes}</span>}
                  </div>
                  {canWrite && <button className="btn btn-sm btn-danger" onClick={() => voidEntry(e.id)}>Anular</button>}
                </div>
              )) : <p className="muted">Sin registros en esta pieza.</p>}
            </div>
            {canWrite && (
              <div className="stack">
                <h3>Registrar</h3>
                {err && <div className="alert danger">{err}</div>}
                <Field label="Condición / tratamiento">
                  <select className="input" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                    {Object.entries(conditions).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </Field>
                {cond?.surface && (
                  <Field label="Superficies" group>
                    <div className="row">
                      {(["M", "D", "O", "V", "L"] as Surface[]).map((s) => (
                        <label key={s} className="check"><input type="checkbox" checked={form.surfaces.includes(s)} onChange={(e) => setForm({ ...form, surfaces: e.target.checked ? [...form.surfaces, s] : form.surfaces.filter((x) => x !== s) })} />{SURF_LABEL[s]}</label>
                      ))}
                    </div>
                  </Field>
                )}
                <Field label="Estado" group>
                  <div className="row">
                    {(["existing", "planned", "completed"] as const).map((s) => (
                      <label key={s} className="check"><input type="radio" name="state" checked={form.state === s} onChange={() => setForm({ ...form, state: s })} />{STATE_LABEL[s]}</label>
                    ))}
                  </div>
                </Field>
                <Field label="Nota (opcional)"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
                <button className="btn btn-primary" onClick={save} style={{ alignSelf: "flex-start" }}>Guardar en pieza {sel}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Historial del odontograma</h2><button className="btn btn-sm" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Ocultar" : `Ver (${data.data.history.length})`}</button></div>
        {showHistory && (data.data.history.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Pieza</th><th>Registro</th><th>Estado</th><th className="hide-mobile">Profesional</th></tr></thead>
            <tbody>{[...data.data.history].reverse().map((e) => (
              <tr key={e.id} style={e.voided ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                <td className="nowrap">{fmtDateTime(e.recordedAt)}</td><td>{e.tooth}</td>
                <td>{e.voidsEntryId ? <i>Anulación: {e.notes}</i> : <>{conditions[e.condition]?.label ?? e.condition}{e.surfaces.length ? ` (${e.surfaces.join(",")})` : ""}</>}</td>
                <td>{e.voidsEntryId ? "—" : STATE_LABEL[e.state]}</td><td className="hide-mobile">{e.recordedBy}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Empty>Sin registros todavía.</Empty>)}
      </div>
    </div>
  );
}
