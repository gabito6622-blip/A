// QR de llegada por sucursal (R2-31): crear, renovar, desactivar e imprimir el cartel de recepción.
import { useEffect, useState } from "react";
import { Copy, Printer, QrCode, RefreshCw } from "lucide-react";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Dialog, Empty, Loading, useAsk, useToast } from "../ui";

interface Point { branchId: string; branchName: string; pointId: string | null; createdAt: string | null; url: string | null; qrSvg: string | null; today: { arrived: number; failed: number; blocked: number } }

/** El SVG lo genera el servidor (biblioteca qrcode) a partir del enlace firmado: solo contiene rectángulos. */
const Qr = ({ svg, label }: { svg: string; label: string }) => <div className="xp-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;

export function CheckinAdmin() {
  const toast = useToast();
  const ask = useAsk();
  const pts = useApi<Point[]>("/api/checkin/points");
  const [print, setPrint] = useState<Point | null>(null);
  const create = async (p: Point) => {
    if (p.pointId) {
      const ok = await ask({ title: "Renovar QR", message: `El QR impreso de ${p.branchName} dejará de funcionar. Tendrás que imprimir el nuevo.`, confirmLabel: "Renovar", danger: true });
      if (!ok) return;
    }
    try { await api.post("/api/checkin/points", { branchId: p.branchId }); toast(p.pointId ? "QR renovado" : "QR creado"); pts.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const revoke = async (p: Point) => {
    const ok = await ask({ title: "Desactivar QR", message: `Los pacientes de ${p.branchName} ya no podrán registrar su llegada con el QR.`, confirmLabel: "Desactivar", danger: true });
    if (!ok) return;
    try { await api.post(`/api/checkin/points/${p.pointId}/revoke`); toast("QR desactivado"); pts.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch { toast("No se pudo copiar el enlace", true); } };
  return (
    <div className="stack">
      <div className="alert info small">
        El paciente escanea el QR de la recepción, escribe los 4 últimos dígitos de su celular y su fecha de nacimiento y, si su cita es dentro de la próxima hora
        (o empezó hace menos de 30 minutos), aparece como «Llegó» en la sala de espera. La página no muestra nombres ni datos personales y bloquea tras 5 intentos fallidos.
      </div>
      {!pts.data ? <Loading rows={3} /> : pts.data.length ? (
        <div className="grid grid-3">
          {pts.data.map((p) => (
            <div key={p.branchId} className="card card-pad stack">
              <div className="row-between"><h2>{p.branchName}</h2>{p.pointId ? <span className="badge ok">Activo</span> : <span className="badge">Sin QR</span>}</div>
              {p.qrSvg && p.url ? (
                <>
                  <Qr svg={p.qrSvg} label={`Código QR de llegada de ${p.branchName}`} />
                  <span className="xp-url">{p.url}</span>
                  <span className="muted small">Creado el {fmtDateTime(p.createdAt)} · Hoy: {p.today.arrived} llegadas, {p.today.failed} intentos sin cita{p.today.blocked ? `, ${p.today.blocked} bloqueados` : ""}</span>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => setPrint(p)}><Printer size={15} />Imprimir</button>
                    <button className="btn btn-sm" onClick={() => copy(p.url!)}><Copy size={15} />Copiar enlace</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => create(p)}><RefreshCw size={15} />Renovar</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => revoke(p)}>Desactivar</button>
                  </div>
                </>
              ) : (
                <>
                  <Empty>Esta sucursal todavía no tiene QR de llegada.</Empty>
                  <button className="btn btn-primary" onClick={() => create(p)}><QrCode size={16} />Crear QR</button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : <Empty>No hay sucursales activas a tu cargo.</Empty>}
      {print && <PrintDialog p={print} onClose={() => setPrint(null)} />}
    </div>
  );
}

function PrintDialog({ p, onClose }: { p: Point; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add("xp-printing");
    return () => document.body.classList.remove("xp-printing");
  }, []);
  return (
    <Dialog title="Cartel para la recepción" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cerrar</button><button className="btn btn-primary" onClick={() => window.print()}><Printer size={16} />Imprimir</button></>}>
      <div className="xp-print stack">
        <h2>¿Llegaste a tu cita?</h2>
        <p>Escanea este código con la cámara de tu celular y avísanos que ya estás aquí. Te llamaremos por tu nombre.</p>
        <Qr svg={p.qrSvg!} label={`Código QR de llegada de ${p.branchName}`} />
        <p><b>{p.branchName}</b></p>
        <p className="muted small">Necesitarás los 4 últimos dígitos de tu celular y tu fecha de nacimiento. Si tienes dudas, acércate a recepción.</p>
      </div>
    </Dialog>
  );
}
