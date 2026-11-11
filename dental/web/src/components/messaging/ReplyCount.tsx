// Contador de respuestas de pacientes sin atender, junto a «Respuestas» en el menú (B-070).
// Se consulta al navegar (como mucho cada 30 s) y enseguida después de marcar una respuesta.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

let last = 0;
let value = 0;
const subs = new Set<(n: number) => void>();
function refresh(force = false) {
  if (!force && Date.now() - last < 30_000) return;
  last = Date.now();
  api.get<{ pending: number }>("/api/messaging/replies/count")
    .then((r) => { value = r.pending; subs.forEach((f) => f(value)); })
    .catch(() => {});
}

export function ReplyCount() {
  const [n, setN] = useState(value);
  const { pathname } = useLocation();
  const { me } = useAuth();
  useEffect(() => {
    subs.add(setN);
    const onWrite = (e: Event) => { if (String((e as CustomEvent<string>).detail ?? "").startsWith("/api/messaging/replies")) refresh(true); };
    window.addEventListener("api-write", onWrite);
    return () => { subs.delete(setN); window.removeEventListener("api-write", onWrite); };
  }, []);
  useEffect(() => { last = 0; value = 0; setN(0); refresh(true); }, [me?.user.id, me?.clinic?.id]);
  useEffect(() => { refresh(false); }, [pathname]);
  if (!n) return null;
  return <span className="nav-count" aria-label={`${n} ${n === 1 ? "respuesta sin atender" : "respuestas sin atender"}`}>{n}</span>;
}
