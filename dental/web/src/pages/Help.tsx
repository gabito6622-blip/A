// Ayuda dentro de la app: guías cortas por rol, con buscador. Abre primero la guía del rol de
// quien la consulta. Cada paso enlaza a la pantalla donde se hace.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Empty, Tabs } from "../components/ui";
import { OnboardingChecklist } from "../components/onboarding/OnboardingChecklist";
import { GUIDES, HELP_ROLES, helpRoleFor, searchGuides, type Guide, type HelpRole } from "../help/guides";
import "../components/onboarding/onboarding.css";

export function GuideCard({ g, showRoles = false }: { g: Guide; showRoles?: boolean }) {
  return (
    <article className="card hp-guide" id={`guia-${g.id}`} aria-labelledby={`guia-${g.id}-t`}>
      <div className="card-pad stack-sm">
        <h3 id={`guia-${g.id}-t`}>{g.title}</h3>
        {showRoles && <div className="row" style={{ gap: 4 }}>{g.roles.map((r) => <span key={r} className="badge">{HELP_ROLES.find((x) => x.id === r)?.label}</span>)}</div>}
        <p className="muted small" style={{ margin: 0 }}>{g.summary}</p>
        <ol>
          {g.steps.map((s, i) => (
            <li key={i}>{s.text}{s.to && <> <Link to={s.to}>{s.link ?? "Abrir"} →</Link></>}</li>
          ))}
        </ol>
        {g.tip && <p className="hp-tip" style={{ margin: 0 }}>{g.tip}</p>}
      </div>
    </article>
  );
}

export function HelpPage() {
  const { me, can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const mine = helpRoleFor(me?.membership?.role);
  const asked = sp.get("guia");
  const askedGuide = GUIDES.find((g) => g.id === asked);
  const [role, setRole] = useState<HelpRole>(askedGuide && !askedGuide.roles.includes(mine) ? askedGuide.roles[0]! : mine);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!askedGuide) return;
    if (!askedGuide.roles.includes(role)) setRole(askedGuide.roles.includes(mine) ? mine : askedGuide.roles[0]!);
    const t = setTimeout(() => document.getElementById(`guia-${askedGuide.id}`)?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const results = q.trim() ? searchGuides(q) : null;
  const list = results ?? GUIDES.filter((g) => g.roles.includes(role));
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Ayuda</h1>
          <p className="sub">Guías cortas para el día a día, según tu rol. Cada paso tiene un enlace a la pantalla donde se hace.</p>
        </div>
        <div className="hp-head-actions">
          <Link className="btn btn-primary hp-manual" to="/ayuda/manual"><BookOpen size={16} aria-hidden="true" />Manual de mi puesto</Link>
          <div className="hp-search">
            <Search size={17} aria-hidden="true" />
            <input className="input" type="search" placeholder="Buscar: cobrar, receta, caja, esterilización…" aria-label="Buscar en la ayuda" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>
      {!results && (
        <Tabs<HelpRole> value={role} onChange={(r) => { setRole(r); if (asked) setSp({}, { replace: true }); }} items={HELP_ROLES.map((r) => ({ id: r.id, label: r.id === mine ? `${r.label} (tu rol)` : r.label }))} />
      )}
      {results && <p className="muted" role="status" style={{ margin: 0 }}>{results.length ? `${results.length} guía${results.length === 1 ? "" : "s"} para «${q.trim()}»` : ""}</p>}
      {list.length ? (
        <div className="hp-guides">{list.map((g) => <GuideCard key={g.id} g={g} showRoles={!!results} />)}</div>
      ) : <Empty>No encontramos guías para «{q.trim()}». Prueba con otra palabra (por ejemplo «pago», «cita» o «limpieza»).</Empty>}
      {!results && role === "owner" && can("clinic.manage") && <OnboardingChecklist force />}
      <p className="muted small">¿Algo no funciona como dice aquí? Avisa a la administración de tu clínica para que lo comunique al soporte de Dentalia.</p>
    </div>
  );
}
