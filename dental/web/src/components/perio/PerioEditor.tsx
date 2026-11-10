import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { CheckCircle2, CloudOff, Loader2, Lock, PenLine, Undo2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { fmtDateTime, fmtTime } from "../../lib/format";
import { Dialog, Field, useToast } from "../ui";
import {
  FACE_SITES, FURCATION_ENTRANCE_LABEL, FURCATION_LABEL, LOWER_POSITIONS, ORDER_PRESETS, PRIMARY_SUCCESSOR, PROGNOSIS, PROGNOSIS_LABEL,
  UPPER_POSITIONS, computeIndices, faceLabel, furcationEntrances, isPrimary, isUpper, orderDescription, probingSequence,
  screenSites, siteLabel, toothAt, toothHasMeasurements, validatePerio,
  type Face, type OrderPreset, type PerioData, type Prognosis, type Site, type SiteData, type ToothData,
} from "../../lib/perio";
import { COL, ChartLegend, PerioChart } from "./PerioChart";
import { IndicesPanel } from "./IndicesPanel";
import "./perio.css";

// ---------------------------------------------------------------- Filas de la grilla
type Kind = "mob" | "pd" | "rec";
interface RowDef { arch: "U" | "L"; kind: Kind; face?: Face }
// Superior: vestibular arriba y palatino hacia el centro. Inferior: lingual hacia el centro y vestibular abajo.
const ROWS: RowDef[] = [
  { arch: "U", kind: "mob" }, { arch: "U", kind: "pd", face: "B" }, { arch: "U", kind: "rec", face: "B" },
  { arch: "U", kind: "rec", face: "L" }, { arch: "U", kind: "pd", face: "L" },
  { arch: "L", kind: "mob" }, { arch: "L", kind: "pd", face: "L" }, { arch: "L", kind: "rec", face: "L" },
  { arch: "L", kind: "rec", face: "B" }, { arch: "L", kind: "pd", face: "B" },
];
const KIND_LABEL: Record<Kind, string> = { mob: "Movilidad", pd: "Sondaje", rec: "Recesión" };
const RANGE: Record<Kind, [number, number]> = { mob: [0, 3], pd: [0, 15], rec: [-5, 15] };
const positionsOf = (arch: "U" | "L") => (arch === "U" ? UPPER_POSITIONS : LOWER_POSITIONS);
const nCols = (row: RowDef) => (row.kind === "mob" ? 16 : 48);
const faceShort = (arch: "U" | "L", face: Face) => (face === "B" ? "V" : arch === "U" ? "P" : "L");
const rowLabel = (row: RowDef) => (row.kind === "mob" ? "Movilidad" : `${KIND_LABEL[row.kind]} ${faceShort(row.arch, row.face!)}`);

interface Cursor { r: number; c: number }
function cellInfo(row: RowDef, c: number, primary: number[]) {
  const pos = positionsOf(row.arch)[row.kind === "mob" ? c : Math.floor(c / 3)]!;
  const tooth = toothAt(pos, primary);
  const site = row.kind === "mob" ? undefined : screenSites(pos, row.face!)[c % 3];
  return { pos, tooth, site };
}
const posOf = (tooth: number) => (isPrimary(tooth) ? PRIMARY_SUCCESSOR[tooth]! : tooth);
function cellFor(tooth: number, site: Site, kind: "pd" | "rec"): Cursor {
  const arch = isUpper(tooth) ? "U" : "L";
  const face: Face = FACE_SITES.B.includes(site) ? "B" : "L";
  const r = ROWS.findIndex((x) => x.arch === arch && x.kind === kind && x.face === face);
  const pos = posOf(tooth);
  return { r, c: positionsOf(arch).indexOf(pos) * 3 + screenSites(pos, face).indexOf(site) };
}
const mobCell = (tooth: number): Cursor => {
  const arch = isUpper(tooth) ? "U" : "L";
  return { r: ROWS.findIndex((x) => x.arch === arch && x.kind === "mob"), c: positionsOf(arch).indexOf(posOf(tooth)) };
};

// ---------------------------------------------------------------- Ayudas de datos (inmutables)
function cleanTooth(t: ToothData): ToothData {
  const o: ToothData = {};
  if (t.missing) o.missing = true;
  if (t.implant) o.implant = true;
  if (t.mobility != null) o.mobility = t.mobility;
  if (t.prognosis != null) o.prognosis = t.prognosis;
  const f = Object.fromEntries(Object.entries(t.furcation ?? {}).filter(([, v]) => v != null));
  if (Object.keys(f).length) o.furcation = f;
  const sites: Partial<Record<Site, SiteData>> = {};
  for (const [s, sd] of Object.entries(t.sites ?? {}) as [Site, SiteData][]) {
    const x: SiteData = {};
    if (sd.pd != null) x.pd = sd.pd;
    if (sd.rec != null) x.rec = sd.rec;
    if (sd.bop) x.bop = true;
    if (sd.sup) x.sup = true;
    if (sd.pl) x.pl = true;
    if (Object.keys(x).length) sites[s] = x;
  }
  if (Object.keys(sites).length) o.sites = sites;
  return o;
}
function setTooth(d: PerioData, tooth: number, fn: (t: ToothData) => ToothData): PerioData {
  const cur = d.teeth[String(tooth)] ?? {};
  const next = cleanTooth(fn(JSON.parse(JSON.stringify(cur)) as ToothData));
  const teeth = { ...d.teeth };
  if (Object.keys(next).length) teeth[String(tooth)] = next;
  else delete teeth[String(tooth)];
  return { ...d, teeth };
}
const setSite = (d: PerioData, tooth: number, site: Site, patch: Partial<SiteData>) =>
  setTooth(d, tooth, (t) => ({ ...t, sites: { ...t.sites, [site]: { ...t.sites?.[site], ...patch } } }));

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
const FLAG_LABEL = { bop: "Sangrado", sup: "Supuración", pl: "Placa" } as const;

const ORDER_KEY = "perio.order";
const loadOrder = (): OrderPreset => {
  try { const v = localStorage.getItem(ORDER_KEY); return ORDER_PRESETS.some((p) => p.id === v) ? (v as OrderPreset) : "standard"; } catch { return "standard"; }
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface ExamDto {
  id: string; patientId: string; status: "draft" | "closed" | "discarded"; origin: string; revision: number; data: PerioData;
  examinerName: string; branchName: string; createdAt: string; updatedAt: string; closedAt: string | null; closedByName: string | null;
  closeNote: string | null; amendsExamId: string | null; amendedBy: { id: string; status: string } | null; discardReason: string | null;
  indices: ReturnType<typeof computeIndices>;
}

export function PerioEditor({ exam, canWrite, onClosed, onAmend, onDiscarded }: {
  exam: ExamDto; canWrite: boolean; onClosed: () => void; onAmend: () => void; onDiscarded: () => void;
}) {
  const toast = useToast();
  const readOnly = exam.status !== "draft" || !canWrite;
  const [data, setData] = useState<PerioData>(exam.data);
  const [preset, setPreset] = useState<OrderPreset>(loadOrder);
  const seq = useMemo(() => probingSequence(preset, data.primary), [preset, data.primary]);
  const firstCursor = useMemo(() => {
    const s = seq.find((x) => !exam.data.teeth[String(x.tooth)]?.missing);
    return s ? cellFor(s.tooth, s.site, "pd") : { r: 1, c: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [cur, setCur] = useState<Cursor>(firstCursor);
  const [prefix, setPrefix] = useState<"+" | "-" | null>(null);
  const [lastFilled, setLastFilled] = useState<{ tooth: number; site: Site } | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const history = useRef<PerioData[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  // ---------------- Guardado automático (serializado, con control de revisión)
  const dataRef = useRef(data);
  dataRef.current = data;
  const revRef = useRef(exam.revision);
  const savedJson = useRef(JSON.stringify(exam.data));
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const conflictRef = useRef(false);
  const [save, setSave] = useState<{ state: SaveState; at?: string; error?: string }>({ state: "saved", at: exam.updatedAt });
  const doSave = useCallback(async (): Promise<boolean> => {
    const json = JSON.stringify(dataRef.current);
    if (json === savedJson.current) { setSave((s) => (s.state === "saved" ? s : { state: "saved", at: s.at })); return true; }
    if (conflictRef.current) return false;
    setSave((s) => ({ ...s, state: "saving" }));
    try {
      const r = await api.put<{ revision: number; updatedAt: string }>(`/api/perio-exams/${exam.id}`, { revision: revRef.current, data: JSON.parse(json) });
      revRef.current = r.revision;
      savedJson.current = json;
      setSave({ state: JSON.stringify(dataRef.current) === json ? "saved" : "dirty", at: r.updatedAt });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "perio_revision_conflict") { conflictRef.current = true; setSave({ state: "conflict", error: e.message }); }
      else setSave({ state: "error", error: (e as Error).message });
      return false;
    }
  }, [exam.id]);
  const saveNow = useCallback(() => (chain.current = chain.current.then(doSave)), [doSave]);
  useEffect(() => {
    if (readOnly) return;
    if (JSON.stringify(data) === savedJson.current) return;
    setSave((s) => (s.state === "conflict" ? s : { ...s, state: s.state === "error" ? "error" : "dirty" }));
    const t = setTimeout(saveNow, 700);
    return () => clearTimeout(t);
  }, [data, readOnly, saveNow]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (JSON.stringify(dataRef.current) !== savedJson.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); if (!readOnly) void saveNow(); };
  }, [readOnly, saveNow]);

  useEffect(() => { gridRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    document.getElementById(`pc-${cur.r}-${cur.c}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cur]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 900); return () => clearTimeout(t); }, [flash]);

  const commit = (next: PerioData) => {
    history.current.push(data);
    if (history.current.length > 200) history.current.shift();
    setData(next);
  };
  const err = (text: string, cell?: Cursor) => { setMsg({ tone: "error", text }); if (cell) setFlash(`${cell.r}-${cell.c}`); };
  const info = (text: string) => setMsg({ tone: "info", text });

  const row = ROWS[cur.r]!;
  const ci = cellInfo(row, cur.c, data.primary);

  const move = (to: Cursor) => { setCur(to); setPrefix(null); setLastFilled(null); };
  const moveV = (dir: 1 | -1) => {
    const r2 = cur.r + dir;
    if (r2 < 0 || r2 >= ROWS.length) return;
    const from = ROWS[cur.r]!, to = ROWS[r2]!;
    let c = cur.c;
    if (from.kind === "mob" && to.kind !== "mob") c = cur.c * 3 + 1;
    else if (from.kind !== "mob" && to.kind === "mob") c = Math.floor(cur.c / 3);
    move({ r: r2, c });
  };

  const advanceFrom = (d: PerioData, tooth: number, site: Site, kind: "pd" | "rec") => {
    const i = seq.findIndex((x) => x.tooth === tooth && x.site === site);
    for (let j = i + 1; j < seq.length; j++) {
      const n = seq[j]!;
      if (!d.teeth[String(n.tooth)]?.missing) { setCur(cellFor(n.tooth, n.site, kind)); return; }
    }
    info("Fin del recorrido de sondaje.");
  };
  const advanceMob = (d: PerioData, tooth: number) => {
    const order = [...new Set(seq.map((x) => x.tooth))];
    const i = order.indexOf(tooth);
    for (let j = i + 1; j < order.length; j++) if (!d.teeth[String(order[j]!)]?.missing) { setCur(mobCell(order[j]!)); return; }
  };

  const fill = (v: number) => {
    const [min, max] = RANGE[row.kind];
    const unit = row.kind === "mob" ? "" : " mm";
    const where = row.kind === "mob" ? `Movilidad del ${ci.tooth}` : `${ci.tooth} ${siteLabel(ci.tooth, ci.site!)} (${KIND_LABEL[row.kind].toLowerCase()})`;
    setPrefix(null);
    if (v > max) return err(`${where}: ${row.kind === "rec" ? signed(v) : v}${unit} supera el máximo de ${max}${unit}. No se registró.`, cur);
    if (v < min) return err(`${where}: ${signed(v)}${unit} es menor que el mínimo de ${signed(min)}${unit}. No se registró.`, cur);
    const t = data.teeth[String(ci.tooth)];
    if (t?.missing) return err(`El ${ci.tooth} está marcado como ausente. Pulsa M para cambiarlo.`, cur);
    if (row.kind === "mob") {
      const next = setTooth(data, ci.tooth, (x) => ({ ...x, mobility: v }));
      commit(next);
      info(`Movilidad del ${ci.tooth}: ${v}`);
      advanceMob(next, ci.tooth);
      return;
    }
    const next = setSite(data, ci.tooth, ci.site!, row.kind === "pd" ? { pd: v } : { rec: v });
    commit(next);
    setLastFilled({ tooth: ci.tooth, site: ci.site! });
    setMsg(null);
    advanceFrom(next, ci.tooth, ci.site!, row.kind);
  };

  const mark = (flag: "bop" | "sup" | "pl") => {
    const tgt = lastFilled ?? (ci.site ? { tooth: ci.tooth, site: ci.site } : null);
    if (!tgt) return err("Ubícate en una fila de sondaje o recesión para marcar sangrado, supuración o placa.");
    if (data.teeth[String(tgt.tooth)]?.missing) return err(`El ${tgt.tooth} está ausente.`);
    const on = !data.teeth[String(tgt.tooth)]?.sites?.[tgt.site]?.[flag];
    commit(setSite(data, tgt.tooth, tgt.site, { [flag]: on }));
    info(`${FLAG_LABEL[flag]} ${on ? "marcado" : "quitado"} en ${tgt.tooth} ${siteLabel(tgt.tooth, tgt.site)}`);
  };

  const toggleMissing = (tooth = ci.tooth) => {
    const t = data.teeth[String(tooth)];
    if (!t?.missing && toothHasMeasurements(t)) return err(`El ${tooth} tiene mediciones: bórralas (Retroceso) antes de marcarlo ausente.`, cur);
    commit(setTooth(data, tooth, (x) => ({ ...x, missing: !x.missing, implant: x.missing ? x.implant : false })));
    info(`${tooth}: ${t?.missing ? "presente" : "ausente"}`);
  };
  const toggleImplant = (tooth = ci.tooth) => {
    const t = data.teeth[String(tooth)];
    if (isPrimary(tooth)) return err(`El ${tooth} es temporal: no puede ser implante.`);
    if (!t?.implant && t?.furcation && Object.keys(t.furcation).length) return err(`El ${tooth} tiene furca registrada: bórrala antes de marcarlo como implante.`);
    commit(setTooth(data, tooth, (x) => ({ ...x, implant: !x.implant, missing: false })));
    info(`${tooth}: ${t?.implant ? "diente natural" : "implante"}`);
  };
  const togglePrimary = (pos = ci.pos) => {
    if (pos % 10 > 5) return err(`La posición del ${pos} no tiene pieza temporal.`);
    const prim = pos + 40;
    const on = data.primary.includes(prim);
    const busy = on ? data.teeth[String(prim)] : data.teeth[String(pos)];
    if (toothHasMeasurements(busy) || busy?.missing || busy?.implant) return err(`Borra los datos del ${on ? prim : pos} antes de cambiar entre permanente y temporal.`);
    const teeth = { ...data.teeth };
    delete teeth[String(on ? prim : pos)];
    commit({ ...data, teeth, primary: on ? data.primary.filter((p) => p !== prim) : [...data.primary, prim].sort() });
    info(on ? `Posición ${pos}: permanente` : `Posición ${pos}: temporal ${prim}`);
  };
  const clear = () => {
    if (data.teeth[String(ci.tooth)]?.missing) return;
    if (row.kind === "mob") commit(setTooth(data, ci.tooth, (x) => ({ ...x, mobility: null })));
    else if (row.kind === "pd") commit(setSite(data, ci.tooth, ci.site!, { pd: null, bop: false, sup: false, pl: false }));
    else commit(setSite(data, ci.tooth, ci.site!, { rec: null }));
    setLastFilled(null);
    info(`Borrado: ${ci.tooth}${ci.site ? " " + siteLabel(ci.tooth, ci.site) : ""} (${KIND_LABEL[row.kind].toLowerCase()})`);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return info("No hay nada que deshacer.");
    setData(prev);
    info("Se deshizo el último cambio.");
  };

  /** Una sola entrada para teclado físico y teclado en pantalla. Devuelve true si la tecla se usó. */
  const handleKey = (key: string, ctrl = false): boolean => {
    if (ctrl && key.toLowerCase() === "z") { if (!readOnly) undo(); return true; }
    if (ctrl) return false;
    switch (key) {
      case "ArrowLeft": if (cur.c > 0) move({ r: cur.r, c: cur.c - 1 }); return true;
      case "ArrowRight": if (cur.c < nCols(row) - 1) move({ r: cur.r, c: cur.c + 1 }); return true;
      case "ArrowUp": moveV(-1); return true;
      case "ArrowDown": moveV(1); return true;
      case "Home": move({ r: cur.r, c: 0 }); return true;
      case "End": move({ r: cur.r, c: nCols(row) - 1 }); return true;
      case "Escape": setPrefix(null); setMsg(null); return true;
    }
    if (readOnly) {
      if (/^[0-9+\-bspmitBSPMIT]$/.test(key) || key === "Backspace" || key === "Delete" || key === "Enter") {
        info(exam.status === "draft" ? "No tienes permiso para modificar esta exploración." : "Exploración cerrada: es de solo lectura. Para corregirla, crea una enmienda.");
        return true;
      }
      return false;
    }
    if (/^[0-9]$/.test(key)) {
      const d = Number(key);
      fill(prefix === "+" ? 10 + d : prefix === "-" ? -d : d);
      return true;
    }
    switch (key) {
      case "+": if (row.kind === "mob") err("La movilidad va de 0 a 3.", cur); else { setPrefix("+"); info("Escribe el segundo dígito: + y 2 = 12 mm."); } return true;
      case "-": if (row.kind !== "rec") err("Solo la recesión admite valores negativos (encía por encima del LAC).", cur); else { setPrefix("-"); info("Escribe el dígito de la recesión negativa (− y 2 = −2 mm)."); } return true;
      case "Enter": {
        if (row.kind === "mob") advanceMob(data, ci.tooth); else advanceFrom(data, ci.tooth, ci.site!, row.kind);
        setLastFilled(null); setPrefix(null); return true;
      }
      case "Backspace": case "Delete": clear(); return true;
    }
    switch (key.toLowerCase()) {
      case "b": mark("bop"); return true;
      case "s": mark("sup"); return true;
      case "p": mark("pl"); return true;
      case "m": toggleMissing(); return true;
      case "i": toggleImplant(); return true;
      case "t": togglePrimary(); return true;
    }
    return false;
  };
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.altKey) return;
    if (handleKey(e.key, e.ctrlKey || e.metaKey)) e.preventDefault();
  };
  const pad = (key: string) => { handleKey(key); gridRef.current?.focus({ preventScroll: true }); };

  const ix = useMemo(() => computeIndices(data), [data]);
  const closeIssues = useMemo(() => (readOnly ? [] : validatePerio(data, { forClose: true })), [data, readOnly]);
  const markTarget = lastFilled ? cellFor(lastFilled.tooth, lastFilled.site, "pd") : null;
  const activeTooth = data.teeth[String(ci.tooth)];
  const [dlg, setDlg] = useState<null | "close" | "discard">(null);

  // ---------------- Render de la grilla
  const renderArch = (arch: "U" | "L") => {
    const positions = positionsOf(arch);
    const rows = ROWS.map((r, i) => ({ r, i })).filter((x) => x.r.arch === arch);
    const header = (
      <div role="row" style={{ display: "contents" }}>
        <div className="perio-label" role="rowheader">{arch === "U" ? "Superior" : "Inferior"}<small>{arch === "U" ? "18 → 28" : "48 → 38"}</small></div>
        {positions.map((pos, i) => {
          const tooth = toothAt(pos, data.primary);
          const t = data.teeth[String(tooth)];
          return (
            <div key={pos} role="columnheader" className={`perio-cell perio-head span3 ${i === 8 ? "mid" : "t0"}`} aria-label={`Pieza ${tooth}${t?.missing ? ", ausente" : ""}${t?.implant ? ", implante" : ""}`}>
              <span>{tooth}</span>
              {t?.missing ? <span className="tag miss">ausente</span> : t?.implant ? <span className="tag imp">implante</span> : isPrimary(tooth) ? <span className="tag prim">temporal</span> : null}
            </div>
          );
        })}
      </div>
    );
    const cells = ({ r, i: ri }: { r: RowDef; i: number }) => (
      <div role="row" key={ri} style={{ display: "contents" }}>
        <div className="perio-label" role="rowheader">
          {rowLabel(r)}
          {r.kind === "rec" && <small>+ apical al LAC</small>}
          {r.kind === "pd" && <small>{faceLabel(positions[0]!, r.face!)}</small>}
        </div>
        {Array.from({ length: nCols(r) }, (_, c) => {
          const { tooth, site } = cellInfo(r, c, data.primary);
          const t = data.teeth[String(tooth)];
          const sd = site ? t?.sites?.[site] : undefined;
          const val = r.kind === "mob" ? t?.mobility : r.kind === "pd" ? sd?.pd : sd?.rec;
          const active = cur.r === ri && cur.c === c;
          const isMark = markTarget && r.kind === "pd" && markTarget.r === ri && markTarget.c === c && !active;
          const sep = r.kind === "mob" ? (c === 8 ? "mid" : "t0") : c === 24 ? "mid" : c % 3 === 0 ? "t0" : "";
          const tone = r.kind === "pd" && val != null ? (val >= 6 ? "pd6" : val >= 4 ? "pd4" : "") : "";
          const flags = r.kind === "pd" && sd ? [sd.bop && "bop", sd.sup && "sup", sd.pl && "pl"].filter(Boolean) as string[] : [];
          const shown = val == null ? (active && prefix ? (prefix === "+" ? "1·" : "−·") : "") : r.kind === "rec" ? signed(val) : String(val);
          const label = r.kind === "mob"
            ? `Movilidad ${tooth}: ${val ?? "sin dato"}`
            : `${tooth} ${siteLabel(tooth, site!)} ${KIND_LABEL[r.kind].toLowerCase()}: ${val == null ? "sin dato" : `${r.kind === "rec" ? signed(val) : val} mm`}${flags.map((f) => ", " + FLAG_LABEL[f as keyof typeof FLAG_LABEL].toLowerCase()).join("")}`;
          return (
            <div
              key={c} id={`pc-${ri}-${c}`} role="gridcell" aria-selected={active} aria-label={t?.missing ? `${tooth} ausente` : label}
              data-tooth={tooth} data-site={site ?? ""} data-kind={r.kind}
              className={`perio-cell ${r.kind === "mob" ? "span3" : ""} ${sep} ${tone} ${t?.missing ? "missing" : ""} ${active ? "active" : ""} ${isMark ? "marktarget" : ""} ${flash === `${ri}-${c}` ? "flash" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); move({ r: ri, c }); gridRef.current?.focus({ preventScroll: true }); }}
            >
              {t?.missing ? "" : shown}
              {flags.length > 0 && <span className="flags">{flags.map((f) => <i key={f} className={`flag-${f}`} />)}</span>}
            </div>
          );
        })}
      </div>
    );
    const chartRow = (face: Face) => (
      <Fragment key={`chart-${face}`}>
        <div className="perio-label perio-chart-label">Gráfico {faceShort(arch, face)}</div>
        <div className="perio-chart"><PerioChart data={data} arch={arch} face={face} /></div>
      </Fragment>
    );
    const [mob, pdA, recA, recB, pdB] = rows as [typeof rows[0], typeof rows[0], typeof rows[0], typeof rows[0], typeof rows[0]];
    const outer: Face = arch === "U" ? "B" : "L";
    const inner: Face = arch === "U" ? "L" : "B";
    return (
      <>
        {header}
        {cells(mob)}{cells(pdA)}{cells(recA)}
        {chartRow(outer)}{chartRow(inner)}
        {cells(recB)}{cells(pdB)}
      </>
    );
  };

  const saveIndicator = (
    <span className={`save-ind ${save.state}`} role="status" aria-live="polite" data-testid="perio-save">
      {save.state === "saved" && <><CheckCircle2 size={15} />Guardado{save.at ? ` ${fmtTime(save.at)}` : ""}</>}
      {save.state === "dirty" && <><PenLine size={15} />Cambios sin guardar…</>}
      {save.state === "saving" && <><Loader2 size={15} />Guardando…</>}
      {save.state === "error" && <><CloudOff size={15} />No se guardó: {save.error} <button className="btn btn-sm" onClick={() => void saveNow()}>Reintentar</button></>}
      {save.state === "conflict" && <><CloudOff size={15} />{save.error}</>}
    </span>
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div className="row">
            <h2>{exam.status === "draft" ? (exam.amendsExamId ? "Enmienda en borrador" : "Exploración en borrador") : exam.status === "closed" ? "Exploración cerrada" : "Exploración descartada"}</h2>
            {exam.status === "closed" && <span className="badge ok"><Lock size={12} />Cerrada {fmtDateTime(exam.closedAt)}</span>}
            {exam.status === "discarded" && <span className="badge danger">Descartada</span>}
            {exam.amendedBy && <span className="badge warn">Corregida por una enmienda{exam.amendedBy.status === "draft" ? " (en borrador)" : ""}</span>}
          </div>
          <div className="row">
            {!readOnly && saveIndicator}
            {!readOnly && <button className="btn btn-sm" onClick={undo} title="Ctrl+Z"><Undo2 size={14} />Deshacer</button>}
            {!readOnly && <button className="btn btn-danger" onClick={() => setDlg("discard")}>Descartar borrador</button>}
            {!readOnly && <button className="btn btn-primary" onClick={() => setDlg("close")}><Lock size={15} />Cerrar exploración</button>}
            {exam.status === "closed" && canWrite && !exam.amendedBy && <button className="btn" onClick={onAmend}><PenLine size={15} />Corregir (enmienda)</button>}
          </div>
        </div>
        <div className="perio-bar">
          <span>Examinador: <b>{exam.examinerName}</b> · {exam.branchName} · iniciada {fmtDateTime(exam.createdAt)}</span>
          {exam.status === "closed" && <span>Cerrada por <b>{exam.closedByName}</b>{exam.closeNote ? ` · Nota: ${exam.closeNote}` : ""}</span>}
          {exam.status === "discarded" && <span>Motivo: {exam.discardReason}</span>}
        </div>
        <div className="perio-bar">
          <Field label="Orden de sondaje">
            <select className="input" value={preset} onChange={(e) => { const v = e.target.value as OrderPreset; setPreset(v); try { localStorage.setItem(ORDER_KEY, v); } catch { /* sin almacenamiento */ } gridRef.current?.focus(); }}>
              {ORDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <span data-testid="perio-order">Recorrido: <b>{orderDescription(preset).join(" · ")}</b></span>
        </div>
        <div className="perio-bar" aria-live="polite">
          <span data-testid="perio-active">Activo: <b>{ci.tooth}{ci.site ? ` · ${faceLabel(ci.tooth, row.face!)} · ${siteLabel(ci.tooth, ci.site)}` : ""} · {KIND_LABEL[row.kind]}</b></span>
          {!readOnly && <span>B / S / P marcan: <b data-testid="perio-mark-target">{lastFilled ? `${lastFilled.tooth} ${siteLabel(lastFilled.tooth, lastFilled.site)} (recién sondeado)` : ci.site ? `${ci.tooth} ${siteLabel(ci.tooth, ci.site)}` : "—"}</b></span>}
          {prefix && <span className="badge info">Esperando dígito: {prefix === "+" ? "10 a 15" : "recesión negativa"}</span>}
        </div>
        <div className={`perio-msg ${msg?.tone ?? "info"}`} role={msg?.tone === "error" ? "alert" : "status"} data-testid="perio-msg">{msg?.text ?? ""}</div>
        <div className="perio-scroll">
          <div
            ref={gridRef} className="perio-grid" role="grid" tabIndex={0} aria-label="Periodontograma: escribe un dígito para el sitio activo"
            aria-activedescendant={`pc-${cur.r}-${cur.c}`} aria-readonly={readOnly} onKeyDown={onKeyDown} data-testid="perio-grid"
          >
            {renderArch("U")}
            <div className="perio-sep" />
            {renderArch("L")}
          </div>
        </div>
        <div className="card-pad stack-sm" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="perio-keys" aria-label="Atajos de teclado">
            <span><kbd>0</kbd>–<kbd>9</kbd> registra y avanza</span>
            <span><kbd>+</kbd> y dígito = 10 a 15 mm</span>
            <span><kbd>−</kbd> y dígito = recesión negativa</span>
            <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> mueven (no cambian valores)</span>
            <span><kbd>B</kbd> sangrado <i className="dot flag-bop" /></span>
            <span><kbd>S</kbd> supuración <i className="dot flag-sup" /></span>
            <span><kbd>P</kbd> placa <i className="dot flag-pl" /></span>
            <span><kbd>M</kbd> ausente · <kbd>I</kbd> implante · <kbd>T</kbd> temporal</span>
            <span><kbd>Retroceso</kbd> borra · <kbd>Intro</kbd> salta · <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace</span>
          </div>
          <div className="muted small">
            <b>Convención de signo:</b> recesión <b>positiva</b> = margen gingival por debajo (apical) del límite amelocementario, raíz expuesta;
            <b> negativa</b> = margen por encima (coronal) del LAC, encía agrandada. <b>NIC = sondaje + recesión</b> (no se calcula en implantes).
          </div>
          <ChartLegend />
        </div>
        {!readOnly && (
          <div className="perio-pad no-print" aria-label="Teclado en pantalla">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((k) => <button key={k} className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad(k)}>{k}</button>)}
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("+")} aria-label="Diez o más">+10</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("-")} aria-label="Negativo">−</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("b")}>B</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("s")}>S</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("p")}>P</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("ArrowLeft")} aria-label="Sitio anterior">←</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("Enter")} aria-label="Saltar al siguiente">→</button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => pad("Backspace")} aria-label="Borrar">⌫</button>
          </div>
        )}
      </div>

      <div className="grid perio-bottom">
        <div className="card card-pad stack-sm">
          <h3>Índices {exam.status === "closed" ? "(congelados al cerrar)" : "(en vivo, mismo cálculo que al cerrar)"}</h3>
          <IndicesPanel ix={exam.status === "closed" ? exam.indices : ix} />
          {ix.ignoredMarks > 0 && <div className="alert warn small">{ix.ignoredMarks} marca(s) de sangrado, supuración o placa están en sitios sin sondaje y no cuentan. Registra el sondaje o quita la marca.</div>}
        </div>
        <ToothPanel
          tooth={ci.tooth} pos={ci.pos} t={activeTooth} readOnly={readOnly} primaryOn={isPrimary(ci.tooth)}
          onChange={(fn) => commit(setTooth(data, ci.tooth, fn))}
          onMissing={() => toggleMissing(ci.tooth)} onImplant={() => toggleImplant(ci.tooth)} onPrimary={() => togglePrimary(ci.pos)}
        />
      </div>

      {dlg === "close" && (
        <CloseDialog
          issues={closeIssues} ix={ix} onCancel={() => setDlg(null)}
          onConfirm={async (note) => {
            const ok = await saveNow();
            if (!ok) throw new Error("No se pudieron guardar los últimos cambios. No se cerró la exploración.");
            await api.post(`/api/perio-exams/${exam.id}/close`, { revision: revRef.current, data: dataRef.current, note: note || null });
            savedJson.current = JSON.stringify(dataRef.current);
            toast("Exploración cerrada");
            setDlg(null);
            onClosed();
          }}
        />
      )}
      {dlg === "discard" && (
        <DiscardDialog onCancel={() => setDlg(null)} onConfirm={async (reason) => {
          await api.post(`/api/perio-exams/${exam.id}/discard`, { reason });
          savedJson.current = JSON.stringify(dataRef.current);
          toast("Borrador descartado (queda en el historial)");
          setDlg(null);
          onDiscarded();
        }} />
      )}
    </div>
  );
}

function ToothPanel({ tooth, pos, t, readOnly, primaryOn, onChange, onMissing, onImplant, onPrimary }: {
  tooth: number; pos: number; t: ToothData | undefined; readOnly: boolean; primaryOn: boolean;
  onChange: (fn: (t: ToothData) => ToothData) => void; onMissing: () => void; onImplant: () => void; onPrimary: () => void;
}) {
  const entrances = furcationEntrances(tooth);
  const dis = readOnly || !!t?.missing;
  return (
    <div className="card card-pad stack-sm perio-tooth-panel">
      <h3>Pieza {tooth}{t?.missing ? " (ausente)" : t?.implant ? " (implante)" : primaryOn ? " (temporal)" : ""}</h3>
      <div className="row">
        <label className="check"><input type="checkbox" checked={!!t?.missing} disabled={readOnly} onChange={onMissing} />Ausente</label>
        <label className="check"><input type="checkbox" checked={!!t?.implant} disabled={readOnly || primaryOn} onChange={onImplant} />Implante</label>
        {pos % 10 <= 5 && <label className="check"><input type="checkbox" checked={primaryOn} disabled={readOnly} onChange={onPrimary} />Temporal ({pos + 40})</label>}
      </div>
      <div className="form-grid">
        <Field label="Movilidad (0–3)">
          <select className="input" value={t?.mobility ?? ""} disabled={dis} onChange={(e) => onChange((x) => ({ ...x, mobility: e.target.value === "" ? null : Number(e.target.value) }))}>
            <option value="">Sin dato</option>{[0, 1, 2, 3].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Pronóstico">
          <select className="input" value={t?.prognosis ?? ""} disabled={dis} onChange={(e) => onChange((x) => ({ ...x, prognosis: (e.target.value || null) as Prognosis | null }))}>
            <option value="">Sin dato</option>{PROGNOSIS.map((p) => <option key={p} value={p}>{PROGNOSIS_LABEL[p]}</option>)}
          </select>
        </Field>
        {entrances.map((en) => (
          <Field key={en} label={`Furca ${FURCATION_ENTRANCE_LABEL[en]} (0–III)`}>
            <select className="input" value={t?.furcation?.[en] ?? ""} disabled={dis || !!t?.implant}
              onChange={(e) => onChange((x) => ({ ...x, furcation: { ...x.furcation, [en]: e.target.value === "" ? null : Number(e.target.value) } }))}>
              <option value="">Sin dato</option>{FURCATION_LABEL.map((l, v) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        ))}
      </div>
      {entrances.length === 0 && <span className="muted small">Esta pieza no tiene entradas de furca.</span>}
    </div>
  );
}

function CloseDialog({ issues, ix, onCancel, onConfirm }: { issues: { message: string }[]; ix: ReturnType<typeof computeIndices>; onCancel: () => void; onConfirm: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Cerrar exploración" onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>Volver</button>
      <button className="btn btn-primary" disabled={busy || issues.length > 0} onClick={async () => {
        setBusy(true); setError(null);
        try { await onConfirm(note); } catch (e) { setError((e as Error).message); setBusy(false); }
      }}><Lock size={15} />{busy ? "Cerrando…" : "Cerrar y congelar"}</button>
    </>}>
      <div className="stack">
        <p>Al cerrar, la exploración queda <b>congelada</b>: ya no se puede cambiar. Para corregir algo después tendrás que crear una enmienda (el original se conserva).</p>
        <p className="muted">Se guardan primero todos los cambios pendientes; si algo falla, no se cierra.</p>
        <div className="row small">
          <span className="badge">{ix.sitesMeasured} sitios medidos de {ix.sitesPossible}</span>
          <span className="badge">Sangrado {ix.bleeding.pct == null ? "—" : `${ix.bleeding.pct.toLocaleString("es-BO")} %`}</span>
          <span className="badge">{ix.pd4.sites} sitios ≥ 4 mm</span>
        </div>
        {issues.length > 0 && (
          <div className="alert danger" role="alert">
            <b>No se puede cerrar todavía:</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{issues.slice(0, 8).map((i, k) => <li key={k}>{i.message}</li>)}</ul>
            {issues.length > 8 && <div>… y {issues.length - 8} más.</div>}
          </div>
        )}
        {error && <div className="alert danger" role="alert">{error}</div>}
        <Field label="Nota de cierre (opcional)"><input className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: control en 3 meses" /></Field>
      </div>
    </Dialog>
  );
}

function DiscardDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Descartar borrador" onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>Volver</button>
      <button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={async () => {
        try { await onConfirm(reason.trim()); } catch (e) { setError((e as Error).message); }
      }}>Descartar</button>
    </>}>
      <div className="stack">
        <p>El borrador no se borra: queda en el historial como <b>descartado</b>, con el motivo, y no cuenta en los índices ni en las comparaciones.</p>
        <Field label="Motivo"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} /></Field>
        {error && <div className="alert danger" role="alert">{error}</div>}
      </div>
    </Dialog>
  );
}

export { COL };
