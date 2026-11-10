import { useState } from "react";
import { ArrowLeft, FileText, GitCompare, Plus } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api, ApiError } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Dialog, Empty, Loading, useToast } from "../ui";
import { PerioEditor, type ExamDto } from "./PerioEditor";
import { PerioCompare, type ExamSummary } from "./PerioCompare";
import { PatientSummaryDialog } from "./PatientSummary";
import { fmtMm, fmtPct } from "./IndicesPanel";
import "./perio.css";

type View = { kind: "list" } | { kind: "exam"; id: string } | { kind: "compare" };
type Row = ExamSummary & { branchName: string; origin: string };

const STATUS = { draft: ["Borrador", "warn"], closed: ["Cerrada", "ok"], discarded: ["Descartada", "danger"] } as const;

export function Periodontogram({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can, me, branchId } = useAuth();
  const toast = useToast();
  const canWrite = can("clinical.write");
  const list = useApi<Row[]>(`/api/patients/${patientId}/perio-exams`);
  const [view, setView] = useState<View>({ kind: "list" });
  const [newDlg, setNewDlg] = useState(false);
  const [summary, setSummary] = useState(false);
  const rows = list.data ?? [];
  const draft = rows.find((r) => r.status === "draft");
  const closedCount = rows.filter((r) => r.status === "closed").length;
  const usable = rows.filter((r) => r.status !== "discarded").length;
  const back = () => { setView({ kind: "list" }); list.reload(); };

  const create = async (mode: "blank" | "previous" | "amendment", sourceExamId?: string) => {
    const r = await api.post<ExamDto & { prefilledFromOdontogram: number[] }>(`/api/patients/${patientId}/perio-exams`, {
      branchId: branchId ?? me!.branches[0]!.id, mode, sourceExamId: sourceExamId ?? null,
    });
    if (r.prefilledFromOdontogram?.length) toast(`Tomados del odontograma (puedes cambiarlos): ${r.prefilledFromOdontogram.join(", ")}`);
    list.reload();
    setView({ kind: "exam", id: r.id });
  };

  if (view.kind === "exam") {
    return (
      <div className="stack">
        <div><button className="btn btn-ghost" onClick={back}><ArrowLeft size={16} />Volver a las exploraciones</button></div>
        <ExamView id={view.id} canWrite={canWrite} onBack={back}
          onAmend={async (id) => { try { await create("amendment", id); } catch (e) { toast((e as Error).message, true); } }} />
      </div>
    );
  }
  if (view.kind === "compare") {
    return (
      <div className="stack">
        <div><button className="btn btn-ghost" onClick={back}><ArrowLeft size={16} />Volver a las exploraciones</button></div>
        <PerioCompare exams={rows} />
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <h2>Periodontograma</h2>
        <div className="row">
          {usable >= 2 && <button className="btn" onClick={() => setView({ kind: "compare" })}><GitCompare size={15} />Comparar</button>}
          {closedCount > 0 && <button className="btn" onClick={() => setSummary(true)}><FileText size={15} />Resumen para el paciente</button>}
          {canWrite && (draft
            ? <button className="btn btn-primary" onClick={() => setView({ kind: "exam", id: draft.id })}>Continuar borrador</button>
            : <button className="btn btn-primary" onClick={() => setNewDlg(true)}><Plus size={15} />Nueva exploración</button>)}
        </div>
      </div>
      {list.error ? <div className="alert danger" style={{ margin: 16 }}>{list.error}</div> : !list.data ? <Loading /> : rows.length === 0 ? (
        <Empty>Sin exploraciones periodontales. {canWrite ? "Inicia la primera con «Nueva exploración»." : ""}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Estado</th><th className="hide-mobile">Examinador</th><th className="num">Sangrado</th><th className="num hide-mobile">Sondaje medio</th><th className="num">≥ 6 mm</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setView({ kind: "exam", id: r.id })}>
                  <td className="nowrap"><button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setView({ kind: "exam", id: r.id }); }}>{fmtDateTime(r.closedAt ?? r.createdAt)}</button></td>
                  <td>
                    <span className={`badge ${STATUS[r.status as keyof typeof STATUS][1]}`}>{STATUS[r.status as keyof typeof STATUS][0]}</span>
                    {r.amendsExamId && <span className="badge info" style={{ marginLeft: 4 }}>Enmienda</span>}
                  </td>
                  <td className="hide-mobile">{r.examinerName}<div className="muted small">{r.branchName}</div></td>
                  <td className="num">{fmtPct(r.indices.bleeding.pct)}<div className="muted small">{r.indices.bleeding.count} de {r.indices.bleeding.denom} sitios</div></td>
                  <td className="num hide-mobile">{fmtMm(r.indices.meanPd.value)}<div className="muted small">{r.indices.meanPd.denom} sitios</div></td>
                  <td className="num">{r.indices.pd6.sites} sitios<div className="muted small">{r.indices.pd6.teeth} dientes</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {newDlg && <NewExamDialog hasClosed={closedCount > 0} onClose={() => setNewDlg(false)} onCreate={async (mode) => { await create(mode); setNewDlg(false); }} />}
      {summary && <PatientSummaryDialog exams={rows} patientName={patientName} clinicName={me?.clinic?.name ?? ""} onClose={() => setSummary(false)} />}
    </div>
  );
}

function ExamView({ id, canWrite, onBack, onAmend }: { id: string; canWrite: boolean; onBack: () => void; onAmend: (id: string) => void }) {
  const ex = useApi<ExamDto>(`/api/perio-exams/${id}`);
  if (ex.error) return <div className="alert danger">{ex.error}</div>;
  if (!ex.data) return <Loading rows={8} />;
  const e = ex.data;
  return (
    <PerioEditor
      key={`${e.id}-${e.status}`} exam={e} canWrite={canWrite}
      onClosed={() => ex.reload()} onDiscarded={onBack} onAmend={() => onAmend(e.id)}
    />
  );
}

function NewExamDialog({ hasClosed, onClose, onCreate }: { hasClosed: boolean; onClose: () => void; onCreate: (mode: "blank" | "previous") => Promise<void> }) {
  const [mode, setMode] = useState<"blank" | "previous">(hasClosed ? "previous" : "blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Nueva exploración periodontal" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await onCreate(mode); } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); setBusy(false); }
      }}>Iniciar</button>
    </>}>
      <div className="stack" role="radiogroup" aria-label="Cómo empezar">
        <label className="check" style={{ alignItems: "flex-start" }}>
          <input type="radio" name="perio-mode" checked={mode === "previous"} disabled={!hasClosed} onChange={() => setMode("previous")} />
          <span><b>A partir de la anterior</b><br /><span className="muted small">Copia ausentes, implantes y movilidad de la última exploración cerrada. Nunca copia sondajes, recesiones ni sangrado.{!hasClosed && " (No hay una exploración cerrada.)"}</span></span>
        </label>
        <label className="check" style={{ alignItems: "flex-start" }}>
          <input type="radio" name="perio-mode" checked={mode === "blank"} onChange={() => setMode("blank")} />
          <span><b>En blanco</b><br /><span className="muted small">Toma los dientes ausentes e implantes del odontograma; puedes cambiarlos.</span></span>
        </label>
        {error && <div className="alert danger" role="alert">{error}</div>}
      </div>
    </Dialog>
  );
}
