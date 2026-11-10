import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { BarChart3, CalendarDays, FileText, LayoutDashboard, LogOut, Settings, Sparkles, Users, Wallet, Building2, Armchair, UserCog, ShieldPlus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { PhoneCall } from "lucide-react";

export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 14c-6 0-10 5-10 12 0 9 5 14 7 23 1 5 3 8 6 8 4 0 4-5 5-10 1-4 2-6 4-6s3 2 4 6c1 5 1 10 5 10 3 0 5-3 6-8 2-9 7-14 7-23 0-7-4-12-10-12-5 0-7 2-12 2s-7-2-12-2z" fill="#5eead4" /></svg>
);

export function Layout({ children, platformOnly }: { children: ReactNode; platformOnly?: boolean }) {
  const { me, can, logout, branchId, setBranchId } = useAuth();
  const items = platformOnly
    ? [{ to: "/", label: "Plataforma", icon: Building2, show: true }]
    : [
        { to: "/", label: "Inicio", icon: LayoutDashboard, show: can("agenda.read") || can("reports.operational") || can("reports.financial") || can("patients.read") },
        { to: "/agenda", label: "Agenda", icon: CalendarDays, show: can("agenda.read") },
        { to: "/sala-espera", label: "Sala de espera", icon: Armchair, show: can("agenda.read") },
        { to: "/controles", label: "Controles", icon: PhoneCall, show: can("agenda.read") },
        { to: "/pacientes", label: "Pacientes", icon: Users, show: can("patients.read") },
        { to: "/presupuestos", label: "Presupuestos", icon: FileText, show: can("budgets.read") },
        { to: "/caja", label: "Caja", icon: Wallet, show: can("payments.read") },
        { to: "/reportes", label: "Reportes", icon: BarChart3, show: can("reports.financial") || can("reports.operational") },
        { to: "/bioseguridad", label: "Bioseguridad", icon: ShieldPlus, show: can("biosafety.read") },
        { to: "/asistente", label: "Asistente", icon: Sparkles, show: can("assistant.use") },
        { to: "/configuracion", label: "Configuración", icon: Settings, show: can("clinic.manage") || can("staff.manage") || can("audit.read") },
        { to: "/plataforma", label: "Plataforma SaaS", icon: Building2, show: !!me?.user.isPlatformAdmin },
      ].filter((i) => i.show);
  const preferred = ["/", "/agenda", "/pacientes", "/caja", "/asistente"];
  const mobile = (items.filter((i) => preferred.includes(i.to)).length >= 3 ? items.filter((i) => preferred.includes(i.to)) : items).slice(0, 5);
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Logo /></div>
          <div><b>Dentalia</b><small>{me?.clinic?.name ?? "Plataforma"}</small></div>
        </div>
        <nav className="nav" aria-label="Principal">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === "/"}><i.icon size={18} />{i.label}</NavLink>
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
        {mobile.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === "/"}><i.icon size={20} />{i.label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
