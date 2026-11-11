// «Manual de mi puesto»: los manuales de docs/manuales/ como página del sistema, con índice,
// hoja de una página («chuleta») y opción de imprimir. Contenido estático: no muestra datos de la
// clínica; las capturas son de la clínica demo ficticia.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Empty, Loading } from "../components/ui";
import { renderMarkdown } from "../help/markdown";
import { loadManual, manualImage, manualLink, manualsForRole, type ManualId } from "../help/manuals";
import "../help/manual.css";

export function ManualPage() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const mine = manualsForRole(me?.membership?.role);
  const [, , , asked, part] = pathname.split("/"); // /ayuda/manual/:id/hoja
  const sheet = part === "hoja";
  const current = mine.find((m) => m.id === asked) ?? null;
  const [src, setSrc] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!current) return;
    let alive = true;
    setSrc(undefined);
    loadManual(current.id, sheet).then((s) => { if (alive) setSrc(s); }, () => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [current?.id, sheet]);

  const doc = useMemo(() => (src ? renderMarkdown(src, { resolveImage: manualImage, resolveLink: manualLink }) : null), [src]);
  useEffect(() => { if (doc) document.title = `${doc.title} · Dentalia`; return () => { document.title = "Dentalia"; }; }, [doc]);

  // Sin manual elegido, o uno que no corresponde al rol: el del propio puesto.
  if (!current) return <Navigate to={`/ayuda/manual/${mine[0]!.id}`} replace />;
  const base = `/ayuda/manual/${current.id}`;
  const go = (id: ManualId) => nav(`/ayuda/manual/${id}${sheet ? "/hoja" : ""}`);

  return (
    <div className={`stack mn-page${sheet ? " mn-sheet" : ""}`}>
      <div className="page-head no-print">
        <div>
          <Link to="/ayuda" className="btn btn-ghost btn-sm mn-back"><ArrowLeft size={16} />Volver a la Ayuda</Link>
          <p className="sub" style={{ marginTop: 6 }}>{current.id === mine[0]!.id ? "Manual de tu puesto" : "Manual de otro puesto"} · {sheet ? "hoja de una página para imprimir" : "guía paso a paso"}</p>
        </div>
        <div className="row mn-actions">
          {mine.length > 1 && (
            <div className="field mn-pick">
              <label className="label" htmlFor="mn-pick">Manual</label>
              <select id="mn-pick" className="input" value={current.id} onChange={(e) => go(e.target.value as ManualId)}>
                {mine.map((m, i) => <option key={m.id} value={m.id}>{m.label}{i === 0 ? " (tu puesto)" : ""}</option>)}
              </select>
            </div>
          )}
          <div className="tabs mn-mode" role="tablist" aria-label="Formato">
            <button role="tab" aria-selected={!sheet} onClick={() => nav(base)}>Manual completo</button>
            <button role="tab" aria-selected={sheet} onClick={() => nav(`${base}/hoja`)}>Hoja de una página</button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={16} />Imprimir</button>
        </div>
      </div>

      {src === undefined ? <Loading rows={8} /> : !doc ? <Empty>No encontramos este manual. Avisa a la administración de tu clínica.</Empty> : (
        <div className="mn-layout">
          {!sheet && doc.headings.length > 2 && (
            <nav className="card mn-toc no-print" aria-label="Contenido del manual">
              <b>Contenido</b>
              <ol>
                {doc.headings.map((h) => (
                  <li key={h.id}><a href={`#${h.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ block: "start" }); }}>{h.text}</a></li>
                ))}
              </ol>
            </nav>
          )}
          {/* El HTML viene de renderMarkdown: todo el texto se escapa y solo produce etiquetas de una lista cerrada. */}
          <article className="card mn-doc" aria-label={doc.title} dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>
      )}
      <p className="muted small no-print">Las capturas son de la clínica de demostración, con datos ficticios. Lo marcado como «[La clínica completa: …]» lo define tu clínica.</p>
    </div>
  );
}
