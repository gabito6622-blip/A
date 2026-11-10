// Imágenes y archivos del paciente (B-012): galería por fecha y tipo, filtro por pieza, visor a
// pantalla completa con zoom y desplazamiento, comparación lado a lado (antes/después), subida
// desde la cámara del celular o arrastrando en el escritorio, con barra de progreso.
// El servidor decide qué ve cada rol (recepción: solo documentos escaneados) y valida el tipo por
// la firma de bytes; aquí solo se adelantan los avisos para no esperar la subida.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from "react";
import { Archive, ArchiveRestore, Camera, ChevronLeft, ChevronRight, Columns2, FileDown, FileText, Images, RotateCcw, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { fmtDateTime, localDate } from "../lib/format";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "./ui";
import { downloadPdf } from "./ClinicalDocuments";
import "./clinical-files.css";

export interface ClinicalFile {
  id: string; kind: string; kindLabel: string; teeth: number[]; takenOn: string; description: string | null; originalName: string | null;
  mimeType: string; typeLabel: string; isImage: boolean; sizeBytes: number; sha256: string; branchName: string; uploadedBy: string; createdAt: string;
  archived: { at: string; reason: string; by: string } | null; viewUrl: string | null; canArchive: boolean;
}
interface ListResponse {
  items: ClinicalFile[]; archivedCount: number; maxBytes: number; maxLabel: string;
  kinds: { id: string; label: string; canUpload: boolean; accepts: string[] }[];
}

const VALID_TEETH = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85,
]);
const KIND_MIMES: Record<string, string[]> = {
  xray_periapical: ["JPG", "PNG", "WebP", "DICOM"], xray_panoramic: ["JPG", "PNG", "WebP", "DICOM"],
  photo_intraoral: ["JPG", "PNG", "WebP"], photo_extraoral: ["JPG", "PNG", "WebP"],
  scanned_document: ["JPG", "PNG", "WebP", "PDF"], other: ["JPG", "PNG", "WebP", "PDF", "DICOM"],
};

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDay = (d: string) => {
  const s = new Intl.DateTimeFormat("es-BO", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${d}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const shortDate = (d: string) => d.split("-").reverse().join("/");

/** Adelanta en el navegador la misma verificación por firma que hace el servidor (que es quien decide). */
async function sniff(file: File): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 132).arrayBuffer());
  const s = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "JPG";
  if (b[0] === 0x89 && s(1, 4) === "PNG") return "PNG";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "WebP";
  if (s(0, 5) === "%PDF-") return "PDF";
  if (b.length >= 132 && s(128, 132) === "DICM") return "DICOM";
  return null;
}

export function parseTeeth(s: string): { teeth: number[]; error: string | null } {
  const parts = s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const nums = parts.map(Number);
  const bad = parts.filter((p, i) => !Number.isInteger(nums[i]) || !VALID_TEETH.has(nums[i]!));
  if (bad.length) return { teeth: [], error: `Pieza inválida (notación FDI): ${bad.join(", ")}` };
  const teeth = [...new Set(nums)].sort((a, b) => a - b);
  if (teeth.length > 16) return { teeth: [], error: "Indica como máximo 16 piezas" };
  return { teeth, error: null };
}

function xhrUpload(url: string, file: File, meta: object, csrf: string, onProgress: (p: number) => void): Promise<{ ok: boolean; body: any }> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.withCredentials = true;
    x.setRequestHeader("content-type", "application/octet-stream");
    x.setRequestHeader("x-csrf-token", csrf);
    x.setRequestHeader("x-file-meta", encodeURIComponent(JSON.stringify(meta)));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let body: any = null;
      try { body = JSON.parse(x.responseText); } catch { /* respuesta sin JSON */ }
      resolve({ ok: x.status >= 200 && x.status < 300, body });
    };
    x.onerror = () => resolve({ ok: false, body: { error: { message: "Se cortó la conexión durante la subida. Vuelve a intentarlo." } } });
    x.send(file);
  });
}

// ---------------- Panel ----------------
export function ClinicalFilesPanel({ patientId, tooth, onToothChange }: { patientId: string; tooth?: number | null; onToothChange?: (t: number | null) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const data = useApi<ListResponse>(`/api/patients/${patientId}/clinical-files?status=${status}`);
  const [kind, setKind] = useState("");
  const [toothSel, setToothSel] = useState<number | null>(tooth ?? null);
  useEffect(() => { setToothSel(tooth ?? null); }, [tooth]);
  const [pending, setPending] = useState<File[] | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const lastReload = useRef(0);

  const items = data.data?.items ?? [];
  const canUpload = !!data.data?.kinds.some((k) => k.canUpload);
  const filtered = useMemo(() => items.filter((f) => (!kind || f.kind === kind) && (toothSel == null || f.teeth.includes(toothSel))), [items, kind, toothSel]);
  const groups = useMemo(() => {
    const m = new Map<string, ClinicalFile[]>();
    for (const f of filtered) m.set(f.takenOn, [...(m.get(f.takenOn) ?? []), f]);
    return [...m.entries()];
  }, [filtered]);
  const teethWithFiles = useMemo(() => [...new Set(items.flatMap((f) => f.teeth))].sort((a, b) => a - b), [items]);
  const setTooth = (t: number | null) => { setToothSel(t); onToothChange?.(t); };

  // Los enlaces de vista duran 5 minutos: si una miniatura falla, se recarga el listado (como mucho cada 20 s).
  const onThumbError = useCallback(() => {
    if (Date.now() - lastReload.current < 20_000) return;
    lastReload.current = Date.now();
    data.reload();
  }, [data]);

  const addFiles = (list: FileList | File[] | null) => {
    const files = list ? [...list] : [];
    if (!files.length) return;
    if (!canUpload) { toast("Tu rol no puede subir archivos a la ficha", true); return; }
    setPending(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };
  const togglePick = (f: ClinicalFile) => {
    if (!f.isImage) { toast("Solo se comparan imágenes", true); return; }
    setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : p.length >= 2 ? [p[1]!, f.id] : [...p, f.id]));
  };
  const pickedFiles = picked.map((id) => items.find((f) => f.id === id)).filter(Boolean) as ClinicalFile[];

  return (
    <div className="stack cf-panel" onDragOver={(e) => { if (canUpload && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }} onDrop={canUpload ? onDrop : undefined}>
      <div className="card">
        <div className="card-head cf-head">
          <h2>Imágenes y archivos</h2>
          <div className="row">
            {canUpload && <>
              <button type="button" className="btn btn-primary" onClick={() => pickRef.current?.click()}><Upload size={16} />Subir archivos</button>
              <button type="button" className="btn cf-camera" onClick={() => camRef.current?.click()}><Camera size={16} />Tomar foto</button>
              <input ref={pickRef} type="file" multiple hidden aria-label="Elegir archivos para subir" accept="image/jpeg,image/png,image/webp,application/pdf,application/dicom,.dcm"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={camRef} type="file" hidden aria-label="Tomar una foto con la cámara" accept="image/*" capture="environment"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </>}
          </div>
        </div>
        <div className="card-pad stack">
          <div className="cf-filters">
            <Field label="Tipo">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Todos</option>
                {data.data?.kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Pieza">
              <select className="input" value={toothSel ?? ""} onChange={(e) => setTooth(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todas</option>
                {[...new Set([...teethWithFiles, ...(toothSel != null ? [toothSel] : [])])].sort((a, b) => a - b).map((t) => <option key={t} value={t}>Pieza {t}</option>)}
              </select>
            </Field>
            <div className="cf-filter-actions row">
              <button type="button" className={`btn ${compareMode ? "btn-primary" : ""}`} aria-pressed={compareMode} onClick={() => { setCompareMode(!compareMode); setPicked([]); }}>
                <Columns2 size={16} />{compareMode ? "Cancelar comparación" : "Comparar"}
              </button>
              <button type="button" className="btn btn-ghost" aria-pressed={status === "archived"} onClick={() => setStatus(status === "active" ? "archived" : "active")}>
                {status === "active" ? <><Archive size={16} />Ver archivados{data.data?.archivedCount ? ` (${data.data.archivedCount})` : ""}</> : <><Images size={16} />Ver vigentes</>}
              </button>
            </div>
          </div>
          {compareMode && (
            <div className="alert info cf-compare-bar" role="status">
              <span>{picked.length < 2 ? `Elige dos imágenes para comparar (${picked.length} de 2).` : "Listo: dos imágenes elegidas."}</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={picked.length !== 2} onClick={() => setComparing(true)}>Comparar lado a lado</button>
            </div>
          )}
          {canUpload && status === "active" && (
            <div className={`cf-drop hide-mobile ${dragOver ? "over" : ""}`} aria-hidden="true">
              <Upload size={18} />Arrastra aquí radiografías, fotos o documentos escaneados ({data.data?.maxLabel ?? "15 MB"} como máximo cada uno)
            </div>
          )}
          {status === "archived" && <div className="alert warn">Archivos archivados: no se muestran en la galería, pero se conservan en la ficha y en la auditoría.</div>}
          {data.error ? <div className="alert danger">{data.error}</div> : !data.data ? <Loading rows={3} /> : !filtered.length ? (
            <Empty>{items.length ? "Ningún archivo coincide con el filtro." : status === "archived" ? "No hay archivos archivados." : "Todavía no hay imágenes ni archivos en esta ficha."}</Empty>
          ) : (
            <div className="stack">
              {groups.map(([day, files]) => (
                <section key={day} className="stack-sm" aria-label={`Tomadas el ${fmtDay(day)}`}>
                  <h3 className="cf-day">{fmtDay(day)}</h3>
                  <ul className="cf-grid">
                    {files.map((f) => {
                      const sel = picked.includes(f.id);
                      return (
                        <li key={f.id}>
                          <button type="button" className={`cf-card ${sel ? "picked" : ""}`} aria-pressed={compareMode ? sel : undefined}
                            aria-label={`${f.kindLabel}${f.teeth.length ? `, pieza ${f.teeth.join(", ")}` : ""}, ${shortDate(f.takenOn)}${compareMode ? (sel ? " (elegida)" : "") : ""}`}
                            onClick={() => (compareMode ? togglePick(f) : setViewer(filtered.indexOf(f)))}>
                            <span className="cf-thumb">
                              {f.isImage && f.viewUrl ? <img src={f.viewUrl} alt="" loading="lazy" decoding="async" onError={onThumbError} /> : <FileText size={34} aria-hidden="true" />}
                              {sel && <span className="cf-pick-mark" aria-hidden="true">{picked.indexOf(f.id) + 1}</span>}
                            </span>
                            <span className="cf-meta">
                              <b>{f.kindLabel}</b>
                              <span className="muted small">{f.teeth.length ? `Pieza ${f.teeth.join(", ")} · ` : ""}{f.typeLabel}</span>
                              {f.description && <span className="small cf-desc">{f.description}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {pending && data.data && (
        <UploadDialog patientId={patientId} files={pending} info={data.data} defaultTooth={toothSel}
          onClose={() => setPending(null)} onDone={(n) => { setPending(null); if (n) { toast(n === 1 ? "1 archivo subido" : `${n} archivos subidos`); setStatus("active"); data.reload(); } }} />
      )}
      {viewer != null && filtered[viewer] && (
        <Viewer files={filtered} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} onChanged={() => { setViewer(null); data.reload(); }} />
      )}
      {comparing && pickedFiles.length === 2 && <CompareViewer a={pickedFiles[0]!} b={pickedFiles[1]!} onClose={() => setComparing(false)} />}
    </div>
  );
}

// ---------------- Subida ----------------
type Row = { file: File; progress: number; status: "waiting" | "uploading" | "done" | "error"; error: string | null; /** undefined: aún sin revisar */ type?: string | null };

function UploadDialog({ patientId, files, info, defaultTooth, onClose, onDone }: {
  patientId: string; files: File[]; info: ListResponse; defaultTooth: number | null; onClose: () => void; onDone: (uploaded: number) => void;
}) {
  const { me, branchId } = useAuth();
  const uploadable = info.kinds.filter((k) => k.canUpload);
  const firstImage = files.some((f) => f.type.startsWith("image/"));
  const [kind, setKind] = useState(uploadable.find((k) => k.id === (firstImage ? "photo_intraoral" : "scanned_document"))?.id ?? uploadable[0]?.id ?? "");
  const [takenOn, setTakenOn] = useState(localDate());
  const [teethText, setTeethText] = useState(defaultTooth ? String(defaultTooth) : "");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState(branchId ?? me?.branches[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>(() => files.map((file) => ({ file, progress: 0, status: "waiting", error: null })));
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const done = rows.filter((r) => r.status === "done").length;

  useEffect(() => {
    let alive = true;
    Promise.all(files.map(sniff)).then((types) => alive && setRows((rs) => rs.map((r, i) => ({ ...r, type: types[i] ?? null }))));
    return () => { alive = false; };
  }, [files]);

  const teeth = parseTeeth(teethText);
  const today = localDate();
  const dateError = !takenOn ? "Indica la fecha de toma" : takenOn > today ? "La fecha de toma no puede ser futura" : null;
  const accepts = KIND_MIMES[kind] ?? [];
  const rowError = (r: Row): string | null => {
    if (r.error) return r.error;
    if (r.file.size === 0) return "El archivo está vacío";
    if (r.file.size > info.maxBytes) return `Supera el límite de ${info.maxLabel}`;
    if (r.type === null && r.status === "waiting") return "Tipo no permitido: se aceptan JPG, PNG, WebP, PDF y DICOM";
    if (r.type && !accepts.includes(r.type)) return `Un ${r.type} no corresponde a este tipo (se acepta ${accepts.join(", ")})`;
    return null;
  };
  const ready = rows.filter((r) => r.status !== "done" && r.type !== undefined && !rowError(r));

  const submit = async () => {
    setTouched(true);
    if (teeth.error || dateError || !branch || !kind || !ready.length) return;
    setBusy(true);
    let ok = done;
    for (const r of ready) {
      const idx = rows.indexOf(r);
      const set = (patch: Partial<Row>) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
      set({ status: "uploading", progress: 0, error: null });
      const res = await xhrUpload(`/api/patients/${patientId}/clinical-files`, r.file,
        { branchId: branch, kind, takenOn, teeth: teeth.teeth, description: description.trim() || null, fileName: r.file.name }, me?.csrfToken ?? "",
        (p) => set({ progress: p }));
      if (res.ok) { ok++; set({ status: "done", progress: 100 }); } else set({ status: "error", error: res.body?.error?.message ?? "No se pudo subir el archivo" });
    }
    setBusy(false);
    if (ok === rows.length) onDone(ok);
  };

  return (
    <Dialog title="Subir a la ficha" onClose={() => (busy ? undefined : onDone(done))} wide footer={<>
      <button type="button" className="btn" disabled={busy} onClick={() => onDone(done)}>{done ? "Cerrar" : "Cancelar"}</button>
      <button type="button" className="btn btn-primary" disabled={busy || !ready.length} onClick={submit}>
        <Upload size={16} />{busy ? "Subiendo…" : ready.length > 1 ? `Subir ${ready.length} archivos` : "Subir"}
      </button>
    </>}>
      <div className="stack">
        <ul className="cf-upload-list" aria-label="Archivos para subir">
          {rows.map((r, i) => {
            const err = rowError(r);
            return (
              <li key={i} className="stack-sm">
                <div className="row-between">
                  <span className="cf-filename">{r.file.name}</span>
                  <span className="muted small nowrap">{fmtSize(r.file.size)}{r.type ? ` · ${r.type}` : ""}</span>
                </div>
                {(r.status === "uploading" || r.status === "done") && (
                  <div className="cf-progress" role="progressbar" aria-label={`Progreso de ${r.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.progress}>
                    <span style={{ width: `${r.progress}%` }} />
                  </div>
                )}
                {r.status === "done" && <span className="small" style={{ color: "var(--ok)" }}>Subido</span>}
                {err && <span className="field-error" role="alert">{err}</span>}
              </li>
            );
          })}
        </ul>
        <div className="form-grid">
          <Field label="Tipo de archivo">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
              {uploadable.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Fecha de toma">
            <input className="input" type="date" max={today} value={takenOn} onChange={(e) => setTakenOn(e.target.value)} disabled={busy} aria-invalid={touched && !!dateError} />
          </Field>
          {touched && dateError && <span className="field-error span-2">{dateError}</span>}
          <Field label="Piezas (opcional)" hint="Notación FDI separada por comas, por ejemplo: 36, 37">
            <input className="input" inputMode="numeric" value={teethText} onChange={(e) => setTeethText(e.target.value)} disabled={busy} aria-invalid={!!teeth.error} />
          </Field>
          {(me?.branches.length ?? 0) > 1 ? (
            <Field label="Sucursal">
              <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={busy}>
                {me!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : <span />}
          {teeth.error && <span className="field-error span-2" role="alert">{teeth.error}</span>}
          <Field label="Descripción (opcional)" span2>
            <textarea className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy}
              placeholder="Ej.: control posoperatorio, antes del tratamiento…" style={{ minHeight: 64 }} />
          </Field>
        </div>
        <p className="muted small">Se verifica el tipo real de cada archivo (no la extensión). Las imágenes clínicas solo las ve el personal clínico; cada vez que alguien las abre queda registrado.</p>
      </div>
    </Dialog>
  );
}

// ---------------- Zoom y desplazamiento ----------------
interface ZoomState { s: number; x: number; y: number }
const Z0: ZoomState = { s: 1, x: 0, y: 0 };
const clampS = (s: number) => Math.min(8, Math.max(1, s));

function ZoomPane({ src, alt, z, setZ, label }: { src: string; alt: string; z: ZoomState; setZ: (f: (z: ZoomState) => ZoomState) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
      setZ((z) => {
        const s = clampS(z.s * Math.exp(-e.deltaY * 0.0015));
        if (s === 1) return Z0;
        const k = s / z.s;
        return { s, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [setZ]);

  const down = (e: RPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), s: z.s };
    }
  };
  const move = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const s = clampS(pinch.current.s * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.d));
      setZ((z) => (s === 1 ? Z0 : { ...z, s }));
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      setZ((z) => (z.s === 1 ? z : { ...z, x: z.x + dx, y: z.y + dy }));
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  return (
    <div ref={ref} className={`cf-zoom ${z.s > 1 ? "zoomed" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={() => setZ((z) => (z.s > 1 ? Z0 : { ...z, s: 2.5 }))} role="img" aria-label={label}>
      {!loaded && !failed && <span className="cf-loading muted">Cargando imagen…</span>}
      {failed && <span className="cf-loading">No se pudo cargar la imagen. Cierra y vuelve a abrirla.</span>}
      <img src={src} alt={alt} draggable={false} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
        style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
    </div>
  );
}

function ZoomButtons({ z, setZ }: { z: ZoomState; setZ: (f: (z: ZoomState) => ZoomState) => void }) {
  return (
    <div className="cf-zoom-buttons" role="group" aria-label="Zoom">
      <button type="button" className="btn btn-icon" aria-label="Alejar" disabled={z.s <= 1} onClick={() => setZ((v) => (clampS(v.s / 1.5) === 1 ? Z0 : { ...v, s: clampS(v.s / 1.5) }))}><ZoomOut size={18} /></button>
      <span className="cf-zoom-level" aria-live="polite">{Math.round(z.s * 100)} %</span>
      <button type="button" className="btn btn-icon" aria-label="Acercar" disabled={z.s >= 8} onClick={() => setZ((v) => ({ ...v, s: clampS(v.s * 1.5) }))}><ZoomIn size={18} /></button>
      <button type="button" className="btn btn-icon" aria-label="Restablecer zoom" disabled={z.s === 1 && z.x === 0 && z.y === 0} onClick={() => setZ(() => Z0)}><RotateCcw size={16} /></button>
    </div>
  );
}

/** Pide un enlace fresco (5 minutos) para ver la imagen en el visor. */
function useFreshViewUrl(f: ClinicalFile) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null); setErr(null);
    if (!f.isImage) return;
    api.get<{ url: string }>(`/api/clinical-files/${f.id}/link?purpose=view`).then((r) => alive && setUrl(r.url), (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [f.id, f.isImage]);
  return { url, err };
}

function useFullscreenKeys(handlers: Record<string, () => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const h = ref.current[e.key];
      if (h) { e.preventDefault(); h(); }
    };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, []);
}

async function download(f: ClinicalFile): Promise<string | null> {
  try {
    const r = await api.get<{ url: string }>(`/api/clinical-files/${f.id}/link?purpose=download`);
    return await downloadPdf(r.url, `${f.kindLabel}.${f.typeLabel.toLowerCase()}`);
  } catch (e: any) { return e.message ?? "No se pudo descargar"; }
}

// ---------------- Visor ----------------
function Viewer({ files, index, onIndex, onClose, onChanged }: { files: ClinicalFile[]; index: number; onIndex: (i: number) => void; onClose: () => void; onChanged: () => void }) {
  const f = files[index]!;
  const toast = useToast();
  const ask = useAsk();
  const { url, err } = useFreshViewUrl(f);
  const [z, setZState] = useState<ZoomState>(Z0);
  const setZ = useCallback((fn: (z: ZoomState) => ZoomState) => setZState(fn), []);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setZState(Z0); }, [f.id]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const go = (d: number) => { const i = index + d; if (i >= 0 && i < files.length) onIndex(i); };
  useFullscreenKeys({
    Escape: onClose, ArrowLeft: () => go(-1), ArrowRight: () => go(1),
    "+": () => setZ((v) => ({ ...v, s: clampS(v.s * 1.5) })), "-": () => setZ((v) => (clampS(v.s / 1.5) === 1 ? Z0 : { ...v, s: clampS(v.s / 1.5) })), "0": () => setZ(() => Z0),
  });
  const archive = async () => {
    const restoring = !!f.archived;
    const reason = await ask({
      title: restoring ? "Restaurar archivo" : "Archivar archivo", inputLabel: "Motivo",
      message: restoring ? "Vuelve a la galería de la ficha." : "No se borra: deja de verse en la galería, pero se conserva en la ficha (Ver archivados) y en la auditoría.",
      placeholder: restoring ? "Ej.: se archivó por error" : "Ej.: imagen de otro paciente, toma repetida", confirmLabel: restoring ? "Restaurar" : "Archivar", danger: !restoring,
    });
    if (!reason) return;
    setBusy(true);
    try { await api.post(`/api/clinical-files/${f.id}/${restoring ? "restore" : "archive"}`, { reason }); toast(restoring ? "Archivo restaurado" : "Archivo archivado"); onChanged(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const dl = async () => { setBusy(true); const e = await download(f); setBusy(false); if (e) toast(e, true); };
  const title = `${f.kindLabel}${f.teeth.length ? ` · pieza ${f.teeth.join(", ")}` : ""}`;
  return (
    <div className="cf-full" role="dialog" aria-modal="true" aria-label={`Visor: ${title}`}>
      <div className="cf-full-head">
        <div className="cf-full-title">
          <b>{title}</b>
          <span className="small">{shortDate(f.takenOn)} · {index + 1} de {files.length}</span>
        </div>
        <div className="row cf-full-actions">
          {f.isImage && <ZoomButtons z={z} setZ={setZ} />}
          <button type="button" className="btn btn-icon" aria-label="Descargar" title="Descargar" onClick={dl} disabled={busy}><FileDown size={18} /></button>
          {f.canArchive && (
            <button type="button" className="btn btn-icon" aria-label={f.archived ? "Restaurar" : "Archivar"} title={f.archived ? "Restaurar" : "Archivar"} onClick={archive} disabled={busy}>
              {f.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </button>
          )}
          <button ref={closeRef} type="button" className="btn btn-icon" aria-label="Cerrar visor" onClick={onClose}><X size={20} /></button>
        </div>
      </div>
      <div className="cf-full-body">
        {f.isImage ? (url ? <ZoomPane src={url} alt={title} z={z} setZ={setZ} label={`${title}. Rueda o pellizco para acercar; arrastra para desplazar.`} />
          : <span className="cf-loading">{err ?? "Preparando imagen…"}</span>) : (
          <div className="cf-nofile">
            <FileText size={56} aria-hidden="true" />
            <p>{f.typeLabel === "DICOM" ? "Archivo DICOM: se abre con el visor de radiografías del equipo." : "Documento PDF: se descarga para verlo."}</p>
            <button type="button" className="btn btn-primary" onClick={dl} disabled={busy}><FileDown size={16} />Descargar {f.typeLabel}</button>
          </div>
        )}
        {index > 0 && <button type="button" className="btn btn-icon cf-nav prev" aria-label="Anterior" onClick={() => go(-1)}><ChevronLeft size={22} /></button>}
        {index < files.length - 1 && <button type="button" className="btn btn-icon cf-nav next" aria-label="Siguiente" onClick={() => go(1)}><ChevronRight size={22} /></button>}
      </div>
      <div className="cf-full-foot small">
        {f.description && <span>{f.description}</span>}
        <span>Subido por {f.uploadedBy} · {f.branchName} · {fmtDateTime(f.createdAt)} · {fmtSize(f.sizeBytes)}</span>
        {f.archived && <span className="cf-archived-note">Archivado el {fmtDateTime(f.archived.at)} por {f.archived.by}: {f.archived.reason}</span>}
      </div>
    </div>
  );
}

function CompareViewer({ a, b, onClose }: { a: ClinicalFile; b: ClinicalFile; onClose: () => void }) {
  const [first, second] = a.takenOn <= b.takenOn ? [a, b] : [b, a];
  const ua = useFreshViewUrl(first), ub = useFreshViewUrl(second);
  const [linked, setLinked] = useState(true);
  const [za, setZa] = useState<ZoomState>(Z0);
  const [zb, setZb] = useState<ZoomState>(Z0);
  const setA = useCallback((fn: (z: ZoomState) => ZoomState) => { setZa(fn); if (linked) setZb(fn); }, [linked]);
  const setB = useCallback((fn: (z: ZoomState) => ZoomState) => { setZb(fn); if (linked) setZa(fn); }, [linked]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useFullscreenKeys({ Escape: onClose, "0": () => { setZa(Z0); setZb(Z0); } });
  const pane = (f: ClinicalFile, u: { url: string | null; err: string | null }, z: ZoomState, set: typeof setA, tag: string) => (
    <figure className="cf-compare-pane">
      <figcaption><b>{tag}</b> · {f.kindLabel}{f.teeth.length ? ` · pieza ${f.teeth.join(", ")}` : ""} · {shortDate(f.takenOn)}</figcaption>
      {u.url ? <ZoomPane src={u.url} alt={`${tag}: ${f.kindLabel} del ${shortDate(f.takenOn)}`} z={z} setZ={set} label={`${tag}: ${f.kindLabel} del ${shortDate(f.takenOn)}`} /> : <span className="cf-loading">{u.err ?? "Preparando imagen…"}</span>}
      <ZoomButtons z={z} setZ={set} />
    </figure>
  );
  return (
    <div className="cf-full" role="dialog" aria-modal="true" aria-label="Comparar imágenes">
      <div className="cf-full-head">
        <div className="cf-full-title"><b>Comparar lado a lado</b><span className="small">Antes y después, por fecha de toma</span></div>
        <div className="row cf-full-actions">
          <label className="check cf-link-check"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />Mover juntas</label>
          <button ref={closeRef} type="button" className="btn btn-icon" aria-label="Cerrar comparación" onClick={onClose}><X size={20} /></button>
        </div>
      </div>
      <div className="cf-compare">
        {pane(first, ua, za, setA, "Antes")}
        {pane(second, ub, zb, setB, "Después")}
      </div>
    </div>
  );
}
