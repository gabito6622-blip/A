import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { fmtDate } from "../../lib/format";
import { Dialog, Field } from "../ui";
import type { ExamSummary } from "./PerioCompare";
import { examLabel } from "./PerioCompare";
import { fmtMm, fmtPct } from "./IndicesPanel";

const PRINT_CSS = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:720px;margin:28px auto;padding:0 16px;color:#0b2a3c;line-height:1.55}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}.muted{color:#556677;font-size:13px}.box{border:1px solid #d5dee6;border-radius:10px;padding:12px 14px;margin:10px 0}
.big{font-size:26px;font-weight:700}ul{padding-left:20px}`;

/** Resumen en lenguaje sencillo para el paciente. Explica, no diagnostica. */
export function PatientSummaryDialog({ exams, patientName, clinicName, onClose }: { exams: ExamSummary[]; patientName: string; clinicName: string; onClose: () => void }) {
  const closed = exams.filter((e) => e.status === "closed").sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  const [id, setId] = useState(closed[0]?.id ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const cur = closed.find((e) => e.id === id);
  const prev = cur ? closed.find((e) => (e.closedAt ?? "") < (cur.closedAt ?? "")) : undefined;
  const print = () => {
    const w = window.open("", "_blank");
    if (!w || !ref.current) return;
    // outerHTML viene de React (texto ya escapado).
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resumen periodontal</title><style>${PRINT_CSS}</style></head><body>${ref.current.outerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <Dialog wide title="Resumen para el paciente" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cerrar</button>
      <button className="btn btn-primary" onClick={print} disabled={!cur}><Printer size={15} />Imprimir</button>
    </>}>
      {closed.length === 0 ? <div className="alert info">El resumen se genera a partir de una exploración cerrada.</div> : (
        <div className="stack">
          <Field label="Exploración"><select className="input" value={id} onChange={(e) => setId(e.target.value)}>{closed.map((e) => <option key={e.id} value={e.id}>{examLabel(e)}</option>)}</select></Field>
          {cur && <div ref={ref} className="perio-summary"><SummaryBody exam={cur} prev={prev} patientName={patientName} clinicName={clinicName} /></div>}
        </div>
      )}
    </Dialog>
  );
}

function SummaryBody({ exam, prev, patientName, clinicName }: { exam: ExamSummary; prev?: ExamSummary; patientName: string; clinicName: string }) {
  const ix = exam.indices, px = prev?.indices;
  const was = (v: string | null) => (prev && v ? <> En su control anterior ({fmtDate(prev.closedAt)}) era <b>{v}</b>.</> : null);
  return (
    <>
      <div className="muted">{clinicName}</div>
      <h1>Resumen de su control de encías</h1>
      <div className="muted">{patientName} · {fmtDate(exam.closedAt)} · Profesional: {exam.examinerName}</div>

      <h2>¿Qué medimos?</h2>
      <p>Con una sonda muy fina medimos, en {ix.sitesMeasured} puntos alrededor de sus dientes, qué tan profundo es el espacio entre la encía y el diente,
        y si la encía sangra al tocarla suavemente. Es una revisión de rutina que permite seguir la salud de sus encías con el tiempo.</p>

      <div className="box">
        <div>Sangrado al tocar la encía</div>
        <div className="big">{fmtPct(ix.bleeding.pct)}</div>
        <div className="muted">{ix.bleeding.count} de {ix.bleeding.denom} puntos revisados.{was(px ? fmtPct(px.bleeding.pct) : null)}</div>
        <p>Una encía sana casi no sangra. Cuando sangra, quiere decir que en ese punto la encía está irritada o inflamada.
          <b> Cuanto más bajo sea este número, más tranquila está su encía.</b></p>
      </div>

      <div className="box">
        <div>Placa bacteriana</div>
        <div className="big">{fmtPct(ix.plaque.pct)}</div>
        <div className="muted">{ix.plaque.count} de {ix.plaque.denom} puntos revisados.{was(px ? fmtPct(px.plaque.pct) : null)}</div>
        <p>La placa es una capa blanda y pegajosa de bacterias que se forma todos los días sobre los dientes. Se quita con el cepillado y la limpieza entre los dientes.</p>
      </div>

      <div className="box">
        <div>Profundidad entre la encía y el diente</div>
        <div className="big">{fmtMm(ix.meanPd.value)} <span className="muted">en promedio</span></div>
        <p>En una encía sana este espacio suele medir hasta 3 mm. En su control:</p>
        <ul>
          <li><b>{ix.pd4.sites}</b> punto(s) midieron 4 mm o más, en {ix.pd4.teeth} diente(s).{px ? ` Antes: ${px.pd4.sites}.` : ""}</li>
          <li><b>{ix.pd6.sites}</b> punto(s) midieron 6 mm o más, en {ix.pd6.teeth} diente(s).{px ? ` Antes: ${px.pd6.sites}.` : ""}</li>
        </ul>
      </div>

      <h2>Lo que usted puede hacer en casa</h2>
      <ul>
        <li>Cepillarse los dientes dos veces al día, también junto a la encía.</li>
        <li>Limpiar entre los dientes una vez al día, con hilo dental o cepillos interdentales.</li>
        <li>Volver a sus controles en la fecha que le indiquen.</li>
      </ul>
      <p className="muted"><b>Este resumen no es un diagnóstico.</b> Su odontólogo o su odontóloga le explicará qué significan estos números en su caso y si recomienda algún tratamiento.</p>
    </>
  );
}
