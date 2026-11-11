// Botón «?» de la barra superior: abre la guía de la pantalla actual (primero la del rol de la
// persona). Si la pantalla no tiene guía, lleva a la página de Ayuda.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { Drawer } from "../ui";
import { guidesForPath, helpRoleFor } from "../../help/guides";
import { GuideCard } from "../../pages/Help";

export function HelpButton() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  if (pathname.startsWith("/ayuda")) return null;
  const guides = guidesForPath(pathname, helpRoleFor(me?.membership?.role));
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm hp-help-btn" aria-haspopup="dialog" title="Ayuda de esta pantalla" aria-label="Ayuda de esta pantalla"
        onClick={() => (guides.length ? setOpen(true) : nav("/ayuda"))}>?</button>
      {/* En un portal: la barra superior crea su propio contexto y recortaría el panel fijo. */}
      {open && createPortal(
        <Drawer title="Ayuda de esta pantalla" onClose={() => setOpen(false)}
          footer={<Link className="btn" to="/ayuda" onClick={() => setOpen(false)}>Ver toda la ayuda</Link>}>
          <div className="stack">{guides.map((g) => <GuideCard key={g.id} g={g} />)}</div>
        </Drawer>,
        document.body,
      )}
    </>
  );
}
