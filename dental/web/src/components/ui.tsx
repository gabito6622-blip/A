import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";

// ---------- Avisos ----------
interface Toast { id: number; text: string; error?: boolean }
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, error }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), error ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.error ? "error" : ""}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Diálogo ----------
export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="dialog-head"><h2>{title}</h2><button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const titleId = useId();
  return (
    <>
      <div className="overlay" style={{ background: "rgba(11,42,60,.25)" }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-head"><h2 id={titleId}>{title}</h2><button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </aside>
    </>
  );
}

/** Campo con etiqueta asociada (accesible): la etiqueta envuelve el control.
 *  group=true para contenidos con varios botones (se usa un grupo con nombre en vez de <label>). */
export function Field({ label, children, hint, span2, group }: { label: string; children: ReactNode; hint?: string; span2?: boolean; group?: boolean }) {
  if (group) return (
    <div className={`field ${span2 ? "span-2" : ""}`} role="group" aria-label={label}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
  // La etiqueta envuelve solo el texto y el control (display: contents conserva el diseño);
  // la ayuda queda fuera para que no forme parte del nombre accesible del campo.
  return (
    <div className={`field ${span2 ? "span-2" : ""}`}>
      <label style={{ display: "contents" }}>
        <span className="label">{label}</span>
        {children}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; hidden?: boolean }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.filter((i) => !i.hidden).map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}>{i.label}</button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="stack" style={{ padding: 18 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}

const STATUS_TONE: Record<string, string> = {
  scheduled: "info", confirmed: "ok", arrived: "warn", in_progress: "warn", completed: "", cancelled: "danger", no_show: "danger",
  draft: "", presented: "info", accepted: "ok", rejected: "danger", pending_verification: "warn", voided: "danger",
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? ""}`}>{label ?? status}</span>;
}

// ---------- Preguntas al usuario (reemplazo accesible de window.prompt / window.confirm) ----------
interface AskOptions {
  title: string;
  message?: string;
  /** Si se indica, se pide un texto (p. ej. un motivo). */
  inputLabel?: string;
  placeholder?: string;
  /** Mínimo de caracteres del texto (por defecto 3 si hay campo). */
  minLength?: number;
  inputMode?: "text" | "numeric";
  confirmLabel?: string;
  danger?: boolean;
}
type AskFn = (o: AskOptions) => Promise<string | null>;
const AskCtx = createContext<AskFn>(async () => null);

export function AskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(AskOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const ask = useCallback<AskFn>((o) => new Promise((resolve) => { setValue(""); setTouched(false); setState({ ...o, resolve }); }), []);
  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const min = state?.inputLabel ? state.minLength ?? 3 : 0;
  const invalid = !!state?.inputLabel && value.trim().length < min;
  const submit = () => { setTouched(true); if (!invalid) close(state?.inputLabel ? value.trim() : "ok"); };
  return (
    <AskCtx.Provider value={ask}>
      {children}
      {state && (
        <Dialog title={state.title} onClose={() => close(null)} footer={<>
          <button className="btn" onClick={() => close(null)}>Cancelar</button>
          <button className={`btn ${state.danger ? "btn-danger" : "btn-primary"}`} onClick={submit}>{state.confirmLabel ?? "Aceptar"}</button>
        </>}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {state.message && <p>{state.message}</p>}
            {state.inputLabel && (
              <div className="field">
                <label htmlFor="ask-input" className="label">{state.inputLabel}</label>
                <input id="ask-input" className="input" autoFocus value={value} inputMode={state.inputMode} placeholder={state.placeholder}
                  aria-invalid={touched && invalid} onChange={(e) => setValue(e.target.value)} />
                {touched && invalid && <span className="hint" style={{ color: "var(--danger)" }}>Escribe al menos {min} caracteres</span>}
              </div>
            )}
          </form>
        </Dialog>
      )}
    </AskCtx.Provider>
  );
}
export const useAsk = () => useContext(AskCtx);
