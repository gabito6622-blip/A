import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BarChart3, CalendarDays, FileText, LayoutDashboard, LogOut, Settings, Sparkles, Users, Wallet, Building2, Armchair, UserCog, ShieldPlus, HandCoins, MessagesSquare, Package } from "lucide-react";
import { useAuth } from "../lib/auth";
import { FlaskConical, PhoneCall, ListTodo, ScrollText, Scale, Handshake, Landmark, Menu, X, HeartHandshake } from "lucide-react";

export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 14c-6 0-10 5-10 12 0 9 5 14 7 23 1 5 3 8 6 8 4 0 4-5 5-10 1-4 2-6 4-6s3 2 4 6c1 5 1 10 5 10 3 0 5-3 6-8 2-9 7-14 7-23 0-7-4-12-10-12-5 0-7 2-12 2s-7-2-12-2z" fill="#5eead4" /></svg>
);

const GROUPS = [
  { id: "day", label: "Día a día" },
  { id: "patients", label: "Pacientes" },
  { id: "money", label: "Dinero" },
  { id: "clinic", label: "Clínica" },
  { id: "manage", label: "Gestión" },
  { id: "help", label: "" },
  { id: "settings", label: "Ajustes" },
];

export function Layout({ children, platformOnly }: { children: ReactNode; platformOnly?: boolean }) {
  const { me, can, logout, branchId, setBranchId } = useAuth();
  const items = platformOnly
    ? [{ group: "day", to: "/", label: "Plataforma", icon: Building2, show: true }]
    : [
        { to: "/", label: "Inicio", icon: LayoutDashboard, show: can("agenda.read") || can("reports.operational") || can("reports.financial") || can("patients.read") },
        { group: "day", to: "/agenda", label: "Agenda", icon: CalendarDays, show: can("agenda.read") },
        { group: "day", to: "/sala-espera", label: "Sala de espera", icon: Armchair, show: can("agenda.read") },
        { group: "day", to: "/controles", label: "Controles", icon: PhoneCall, show: can("agenda.read") },
        { group: "day", to: "/tareas", label: "Tareas", icon: ListTodo, show: can("tasks.use") },
        { group: "patients", to: "/pacientes", label: "Pacientes", icon: Users, show: can("patients.read") },
        { group: "patients", to: "/presupuestos", label: "Presupuestos", icon: FileText, show: can("budgets.read") },
        { group: "money", to: "/caja", label: "Caja", icon: Wallet, show: can("payments.read") },
        { group: "patients", to: "/experiencia", label: "Experiencia", icon: HeartHandshake, show: can("patients.read") || can("clinic.manage") },
        { group: "patients", to: "/convenios", label: "Convenios", icon: Handshake, show: can("patients.read") && (can("payments.read") || can("clinic.manage")) },
        { group: "money", to: "/conciliacion", label: "Conciliación", icon: Landmark, show: can("payments.verify") },
        { group: "money", to: "/honorarios", label: "Honorarios", icon: HandCoins, show: can("reports.financial") || can("treatments.perform") },
        { group: "manage", to: "/reportes", label: "Reportes", icon: BarChart3, show: can("reports.financial") || can("reports.operational") },
        { group: "manage", to: "/gestion", label: "Gestión", icon: Scale, show: can("reports.financial") },
        { group: "clinic", to: "/laboratorio", label: "Laboratorio", icon: FlaskConical, show: can("clinical.read") || can("budgets.read") || ((can("payments.verify") || can("clinic.manage")) && !!me?.membership?.allBranches) },
        { group: "clinic", to: "/bioseguridad", label: "Bioseguridad", icon: ShieldPlus, show: can("biosafety.read") },
        { group: "help", to: "/asistente", label: "Asistente", icon: Sparkles, show: can("assistant.use") },
        { group: "clinic", to: "/inventario", label: "Inventario", icon: Package, show: can("inventory.read") },
        { group: "manage", to: "/mensajes", label: "Mensajes", icon: MessagesSquare, show: can("clinic.manage") },
        { group: "manage", to: "/actividad", label: "Actividad", icon: ScrollText, show: can("audit.read") },
        { group: "settings", to: "/configuracion", label: "Configuración", icon: Settings, show: can("clinic.manage") || can("staff.manage") || can("audit.read") },
        { group: "settings", to: "/plataforma", label: "Plataforma SaaS", icon: Building2, show: !!me?.user.isPlatformAdmin },
      ].filter((i) => i.show);
  const sections = GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length);
  // Celular: 4 accesos directos + "Más" con el menú completo. Si todo cabe en 5, no hace falta "Más".
  const preferred = ["/", "/agenda", "/pacientes", "/caja", "/inventario", "/bioseguridad", "/tareas"];
  const byPreference = items.filter((i) => preferred.includes(i.to)).sort((a, b) => preferred.indexOf(a.to) - preferred.indexOf(b.to));
  const quick = items.length <= 5 ? items : (byPreference.length >= 3 ? byPreference : items).slice(0, 4);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  const inMore = !quick.some((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Logo /></div>
          <div><b>Dentalia</b><small>{me?.clinic?.name ?? "Plataforma"}</small></div>
        </div>
        <nav className="nav" aria-label="Principal">
          {sections.map((g) => (
            <div className="nav-group" key={g.id} role="group" aria-label={g.label}>
              {sections.length > 1 && g.label && <div className="nav-title" aria-hidden>{g.label}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"}><i.icon size={18} />{i.label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div style={{ color: "#fff", fontWeight: 600 }}>{me?.user.fullName}</div>
          <div>{me?.membership?.roleLabel ?? (me?.user.isPlatformAdmin ? "Superadministrador" : "")}</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          {!platformOnly && me && me.branches.length > 1 && (
            <select className="input" style={{ maxWidth: 230 }} aria-label="Sucursal" value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value || null)}>
              {me.membership?.allBranches && <option value="">Todas las sucursales</option>}
              {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {!platformOnly && me && me.branches.length === 1 && <span className="badge brand">{me.branches[0]!.name}</span>}
          <div className="grow" />
          {!platformOnly && <Link to="/cuenta" className="btn btn-ghost btn-sm" title="Mi cuenta: contraseña y verificación en dos pasos"><UserCog size={16} /><span className="hide-mobile">{me?.user.email}</span></Link>}
          <button className="btn btn-ghost btn-sm" onClick={logout} title="Cerrar sesión"><LogOut size={16} /><span className="hide-mobile">Salir</span></button>
        </header>
        <main className="content">{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Navegación móvil">
        {quick.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === "/"}><i.icon size={20} />{i.label}</NavLink>
        ))}
        {items.length > quick.length && (
          <button type="button" className={inMore ? "active" : ""} aria-expanded={moreOpen} aria-controls="menu-completo" onClick={() => setMoreOpen(true)}>
            <Menu size={20} />Más
          </button>
        )}
      </nav>
      {moreOpen && (
        <>
          <div className="overlay more-overlay" onMouseDown={() => setMoreOpen(false)} />
          <div className="more-sheet" id="menu-completo" role="dialog" aria-modal="true" aria-label="Menú completo">
            <div className="row-between more-head">
              <b>Menú</b>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setMoreOpen(false)} aria-label="Cerrar menú"><X size={18} /></button>
            </div>
            <nav aria-label="Menú completo">
              {sections.map((g) => (
                <div className="more-group" key={g.id} role="group" aria-label={g.label}>
                  {g.label && <div className="more-title">{g.label}</div>}
                  <div className="more-grid">
                    {g.items.map((i) => (
                      <NavLink key={i.to} to={i.to} end={i.to === "/"}><i.icon size={20} />{i.label}</NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
