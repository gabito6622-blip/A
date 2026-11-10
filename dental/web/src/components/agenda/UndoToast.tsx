import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";

export interface UndoAction { id: number; text: string; run: () => Promise<void> }

/** Aviso con "Deshacer" durante 8 segundos (después desaparece solo). */
export function UndoToast({ action, onClose, ms = 8000 }: { action: UndoAction; onClose: () => void; ms?: number }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(onClose, ms);
    return () => window.clearTimeout(t);
  }, [action.id, ms, onClose]);
  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{action.text}</span>
      <button className="btn btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await action.run(); } finally { setBusy(false); onClose(); } }}>
        <Undo2 size={15} />Deshacer
      </button>
      <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Cerrar aviso"><X size={16} /></button>
      <span className="undo-bar" style={{ animationDuration: `${ms}ms` }} aria-hidden="true" />
    </div>
  );
}
