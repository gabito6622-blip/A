import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarSearch, ChevronLeft, ChevronRight, MessageCircle, Plus, UserPlus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi, useDebounced } from "../lib/hooks";
import { api, newKey, qs } from "../lib/api";
import { addDays, fmtDateLong, fmtTime, laPazISO, localDate, minutesOfDay } from "../lib/format";
import { Dialog, Drawer, Empty, Field, Loading, StatusBadge, useToast } from "../components/ui";
import { PortalRequestsButton } from "./PortalRequests";

const START = 7 * 60, END = 21 * 60, STEP = 15, PX = 18;
const ROWS = (END - START) / STEP;

const TRANSITION_LABELS: Record<string, string> = {
  confirmed: "Confirmar", arrived: "Llegó", in_progress: "En atención", completed: "Atendido", cancelled: "Cancelar", no_show: "No asistió", scheduled: "Volver a agendada",
};

export interface NewApptPrefill { date?: string; time?: string; dentistId?: string; durationMin?: number; procedureId?: string | null; patient?: { id: string; name: string } | null }

export function AgendaPage() {
  const { me, can, branchId: selBranch, setBranchId } = useAuth();
  const branchId = selBranch ?? me?.branches[0]?.id ?? null;
  const [date, setDate] = useState(localDate());
  const [view, setView] = useState<"grid" | "list">(() => (window.innerWidth < 860 ? "list" : "grid"));
  const [newAppt, setNewAppt] = useState<NewApptPrefill | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [reminders, setReminders] = useState(false);
  const appts = useApi<any[]>(branchId ? `/api/appointments${qs({ from: laPazISO(date, "00:00"), to: laPazISO(addDays(date, 1), "00:00"), branchId })}` : null);
  const avail = useApi<any[]>(branchId ? `/api/availability${qs({ date, branchId, durationMin: 15 })}` : null);
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const matches = useApi<any[]>(branchId ? `/api/waitlist/matches${qs({ date, branchId })}` : null);
  const reload = () => { appts.reload(); avail.reload(); matches.reload(); };

  const columns = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string | null; work: { s: number; e: number }[] }>();
    for (const a of avail.data ?? []) {
      const st = staff.data?.find((s) => s.userId === a.dentistId);
      map.set(a.dentistId, { id: a.dentistId, name: a.dentistName, color: st?.color ?? null, work: a.work.map((w: any) => ({ s: minutesOfDay(w.start), e: minutesOfDay(w.end) || 24 * 60 })) });
    }
    for (const a of appts.data ?? []) if (!map.has(a.dentistId)) map.set(a.dentistId, { id: a.dentistId, name: a.dentistName, color: a.dentistColor, work: [] });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [avail.data, appts.data, staff.data]);

  const isToday = date === localDate();
  const nowMin = minutesOfDay(new Date().toISOString());

  if (!branchId) return <Empty>Selecciona una sucursal.</Empty>;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{fmtDateLong(laPazISO(date, "12:00"))}</h1>
          <div className="row" style={{ marginTop: 4 }}>
            {me && me.branches.length > 1 ? (
              <select className="input" style={{ width: "auto", minHeight: 32, padding: "4px 8px" }} aria-label="Sucursal de la agenda" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <span className="sub">{me?.branches[0]?.name}</span>}
            <span className="muted">{appts.data?.filter((a) => a.status !== "cancelled").length ?? 0} citas</span>
          </div>
        </div>
        <div className="row">
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-icon" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior"><ChevronLeft size={18} /></button>
            <button className="btn" onClick={() => setDate(localDate())}>Hoy</button>
            <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 150 }} aria-label="Fecha" />
            <button className="btn btn-icon" onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente"><ChevronRight size={18} /></button>
          </div>
          <select className="input" style={{ width: 120 }} value={view} onChange={(e) => setView(e.target.value as "grid" | "list")} aria-label="Vista">
            <option value="grid">Columnas</option><option value="list">Lista</option>
          </select>
          <button className="btn" onClick={() => setSearch(true)}><CalendarSearch size={16} />Buscar horario</button>
          <button className="btn" onClick={() => setReminders(true)}><MessageCircle size={16} />Recordatorios</button>
          <PortalRequestsButton branchId={branchId} onChanged={reload} />
          {can("agenda.write") && <button className="btn btn-primary" onClick={() => setNewAppt({ date })}><Plus size={16} />Nueva cita</button>}
        </div>
      </div>

      {!!matches.data?.length && (
        <div className="alert info">
          <b>Huecos recuperables:</b> {matches.data.length} paciente(s) de la lista de espera encajan en horarios libres de este día.{" "}
          {matches.data.slice(0, 3).map((m) => (
            <button key={m.waitlistId} className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => setNewAppt({ date, time: fmtTime(m.slots[0].startsAt), dentistId: m.slots[0].dentistId, durationMin: m.durationMin, patient: { id: m.patientId, name: m.patientName } })}>
              {m.patientName} · {fmtTime(m.slots[0].startsAt)}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {(appts.loading && !appts.data) || (avail.loading && !avail.data) ? <Loading rows={8} /> : view === "list" || columns.length === 0 ? (
          appts.data?.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Hora</th><th>Paciente</th><th className="hide-mobile">Profesional</th><th className="hide-mobile">Prestación</th><th>Estado</th></tr></thead>
              <tbody>{appts.data.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setOpenId(a.id)}>
                  <td className="nowrap">{fmtTime(a.startsAt)}<span className="hide-mobile">–{fmtTime(a.endsAt)}</span></td><td><b>{a.patientName}</b><div className="muted small">{a.dentistName}{a.procedureName ? ` · ${a.procedureName}` : ""}</div></td><td className="hide-mobile">{a.dentistName}</td>
                  <td className="hide-mobile">{a.procedureName ?? a.reason ?? "—"}</td><td><StatusBadge status={a.status} label={a.statusLabel} /></td>
                </tr>))}
              </tbody></table></div>
          ) : <Empty>{columns.length === 0 ? "Ningún profesional atiende en esta sucursal este día." : "Sin citas este día."}</Empty>
        ) : (
          <div className="agenda" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(170px, 1fr))` }}>
            <div className="agenda-col-head" style={{ position: "sticky", left: 0, zIndex: 4, borderLeft: "none" }} />
            {columns.map((c) => (
              <div key={c.id} className="agenda-col-head"><i className="dot" style={{ background: c.color ?? "var(--accent)" }} />{c.name}</div>
            ))}
            <div className="agenda-time">
              {Array.from({ length: ROWS }, (_, i) => <div key={i} style={{ height: PX }}>{(START + i * STEP) % 60 === 0 ? `${String((START + i * STEP) / 60).padStart(2, "0")}:00` : ""}</div>)}
            </div>
            {columns.map((c) => (
              <div key={c.id} style={{ position: "relative" }}>
                {Array.from({ length: ROWS }, (_, i) => {
                  const m = START + i * STEP;
                  const working = c.work.some((w) => m >= w.s && m < w.e);
                  const past = isToday && m + STEP <= nowMin;
                  const canBook = working && !past && can("agenda.write");
                  return (
                    <div key={i} className={`agenda-cell ${m % 60 === 0 ? "hour" : ""} ${working ? "free" : "off"}`} style={{ height: PX, cursor: canBook ? "pointer" : "default" }}
                      title={working ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` : "Fuera de horario"}
                      onClick={() => canBook && setNewAppt({ date, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, dentistId: c.id })} />
                  );
                })}
                {(appts.data ?? []).filter((a) => a.dentistId === c.id && a.status !== "cancelled").map((a) => {
                  const s = minutesOfDay(a.startsAt), e = minutesOfDay(a.endsAt) || 24 * 60;
                  return (
                    <div key={a.id} className={`appt s-${a.status}`} style={{ top: ((s - START) / STEP) * PX + 1, height: Math.max(((e - s) / STEP) * PX - 2, 18), borderLeftColor: c.color ?? undefined }}
                      onClick={() => setOpenId(a.id)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && setOpenId(a.id)}>
                      <b>{fmtTime(a.startsAt)}</b> {a.patientName}
                      <div className="muted">{a.procedureName ?? a.reason ?? ""}{a.chairName ? ` · ${a.chairName}` : ""}</div>
                    </div>
                  );
                })}
                {isToday && nowMin > START && nowMin < END && <div className="now-line" style={{ top: ((nowMin - START) / STEP) * PX }} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {newAppt && <NewAppointmentDialog branchId={branchId} prefill={newAppt} onClose={() => setNewAppt(null)} onSaved={() => { setNewAppt(null); reload(); }} />}
      {openId && <AppointmentDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
      {search && <SlotSearchDialog branchId={branchId} onClose={() => setSearch(false)} onPick={(p) => { setSearch(false); setDate(p.date!); setNewAppt(p); }} />}
      {reminders && <RemindersDialog branchId={branchId} onClose={() => setReminders(false)} />}
    </div>
  );
}

export function PatientPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const res = useApi<any>(dq.length >= 2 ? `/api/patients${qs({ q: dq, limit: 8 })}` : null);
  const [creating, setCreating] = useState(false);
  if (value) return (
    <div className="row-between input" style={{ alignItems: "center" }}>
      <b>{value.name}</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Cambiar</button>
    </div>
  );
  return (
    <div className="stack-sm">
      <input className="input" placeholder="Buscar por nombre, CI, teléfono o N° de ficha" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {dq.length >= 2 && res.data && (
        <div className="card" style={{ maxHeight: 220, overflowY: "auto" }}>
          {res.data.items.map((p: any) => (
            <button type="button" key={p.id} className="btn btn-ghost" style={{ width: "100%", justifyContent: "space-between" }} onClick={() => onChange({ id: p.id, name: `${p.firstName} ${p.lastName}` })}>
              <span>{p.firstName} {p.lastName}</span><span className="muted small">Ficha {p.recordNumber}{p.documentNumber ? ` · CI ${p.documentNumber}` : ""}</span>
            </button>
          ))}
          {!res.data.items.length && <p className="muted small" style={{ padding: 10 }}>Sin resultados.</p>}
        </div>
      )}
      <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setCreating(true)}><UserPlus size={15} />Paciente nuevo</button>
      {creating && <QuickPatientDialog onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); onChange(p); }} />}
    </div>
  );
}

export function QuickPatientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: { id: string; name: string }) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ firstName: "", lastName: "", documentNumber: "", phone: "", birthDate: "", guardianName: "", consentReminders: true });
  const [dups, setDups] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async (allowDuplicate = false) => {
    setErr(null);
    try {
      const r = await api.post("/api/patients", { ...f, documentType: f.documentNumber ? "CI" : "SIN", birthDate: f.birthDate || null, guardianName: f.guardianName || null, allowDuplicate });
      toast(`Paciente registrado (ficha ${r.recordNumber})`);
      onCreated({ id: r.id, name: `${f.firstName} ${f.lastName}` });
    } catch (e: any) {
      if (e.code === "possible_duplicate") setDups(e.details.duplicates);
      else setErr(e.message);
    }
  };
  return (
    <Dialog title="Paciente nuevo" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={() => save(false)}>Registrar</button></>}>
      <div className="stack">
        {err && <div className="alert danger">{err}</div>}
        {dups && (
          <div className="alert warn stack-sm">
            <b>Posibles duplicados — revisa antes de crear otro:</b>
            {dups.map((d) => <button key={d.id} className="btn btn-sm" onClick={() => onCreated({ id: d.id, name: `${d.firstName} ${d.lastName}` })}>Usar ficha {d.recordNumber}: {d.firstName} {d.lastName} (coincide {d.reason})</button>)}
            <button className="btn btn-sm btn-danger" onClick={() => save(true)}>Es otra persona: registrar igual</button>
          </div>
        )}
        <div className="form-grid">
          <Field label="Nombres"><input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
          <Field label="Apellidos"><input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
          <Field label="CI (opcional)"><input className="input" inputMode="numeric" value={f.documentNumber} onChange={(e) => setF({ ...f, documentNumber: e.target.value })} /></Field>
          <Field label="Celular"><input className="input" inputMode="tel" placeholder="7xxxxxxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Fecha de nacimiento"><input className="input" type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} /></Field>
          <Field label="Responsable (si es menor)"><input className="input" value={f.guardianName} onChange={(e) => setF({ ...f, guardianName: e.target.value })} /></Field>
          <label className="check span-2"><input type="checkbox" checked={f.consentReminders} onChange={(e) => setF({ ...f, consentReminders: e.target.checked })} />El paciente acepta recibir recordatorios por WhatsApp</label>
        </div>
      </div>
    </Dialog>
  );
}

function NewAppointmentDialog({ branchId, prefill, onClose, onSaved }: { branchId: string; prefill: NewApptPrefill; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const procs = useApi<any[]>("/api/procedures");
  const branches = useApi<any[]>("/api/branches");
  const chairs = branches.data?.find((b) => b.id === branchId)?.chairs.filter((c: any) => c.active) ?? [];
  const [patient, setPatient] = useState(prefill.patient ?? null);
  const [f, setF] = useState({
    dentistId: prefill.dentistId ?? (me?.membership?.role === "dentist" ? me.user.id : ""), chairId: "", procedureId: prefill.procedureId ?? "",
    date: prefill.date ?? localDate(), time: prefill.time ?? "09:00", durationMin: prefill.durationMin ?? 30, reason: "", source: "reception",
  });
  const [key] = useState(newKey());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dentists = (staff.data ?? []).filter((s) => s.allBranches || s.role === "owner" || s.branchIds.includes(branchId));
  useEffect(() => {
    const p = procs.data?.find((x) => x.id === f.procedureId);
    if (p && !prefill.durationMin) setF((x) => ({ ...x, durationMin: p.durationMin }));
  }, [f.procedureId, procs.data, prefill.durationMin]);
  const save = async () => {
    if (!patient) { setErr("Elige un paciente"); return; }
    if (!f.dentistId) { setErr("Elige el profesional"); return; }
    setBusy(true); setErr(null);
    try {
      await api.post("/api/appointments", {
        branchId, patientId: patient.id, dentistId: f.dentistId, chairId: f.chairId || null, procedureId: f.procedureId || null,
        startsAt: laPazISO(f.date, f.time), durationMin: Number(f.durationMin), reason: f.reason || null, source: f.source, idempotencyKey: key,
      });
      toast("Cita agendada");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Nueva cita" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Agendar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Paciente" group><PatientPicker value={patient} onChange={setPatient} /></Field>
        <div className="form-grid">
          <Field label="Profesional">
            <select className="input" value={f.dentistId} onChange={(e) => setF({ ...f, dentistId: e.target.value })}>
              <option value="">Elegir…</option>{dentists.map((d) => <option key={d.userId} value={d.userId}>{d.fullName}</option>)}
            </select>
          </Field>
          <Field label="Consultorio">
            <select className="input" value={f.chairId} onChange={(e) => setF({ ...f, chairId: e.target.value })}>
              <option value="">Sin asignar</option>{chairs.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Prestación" span2>
            <select className="input" value={f.procedureId} onChange={(e) => setF({ ...f, procedureId: e.target.value })}>
              <option value="">Consulta / otro</option>{procs.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.durationMin} min)</option>)}
            </select>
          </Field>
          <Field label="Fecha"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Hora"><input className="input" type="time" step={900} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
            <Field label="Duración (min)"><input className="input" type="number" min={5} step={5} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Motivo / nota"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Field label="Canal">
            <select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              <option value="reception">Recepción</option><option value="phone">Teléfono</option><option value="whatsapp">WhatsApp</option><option value="walk_in">Sin cita (presencial)</option>
            </select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function AppointmentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const a = useApi<any>(`/api/appointments/${id}`);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [resched, setResched] = useState<{ date: string; time: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const setStatus = async (status: string, reason?: string) => {
    setErr(null);
    try {
      await api.post(`/api/appointments/${id}/status`, { status, reason: reason ?? null });
      toast("Estado actualizado"); a.reload(); onChanged(); setCancelReason(null);
    } catch (e: any) { setErr(e.message); }
  };
  const reschedule = async () => {
    if (!resched) return;
    setErr(null);
    try {
      await api.patch(`/api/appointments/${id}`, { startsAt: laPazISO(resched.date, resched.time) });
      toast("Cita reprogramada"); setResched(null); a.reload(); onChanged();
    } catch (e: any) { setErr(e.message); }
  };
  const d = a.data;
  return (
    <Drawer title="Cita" onClose={onClose}>
      {!d ? <Loading /> : (
        <div className="stack">
          {err && <div className="alert danger" role="alert">{err}</div>}
          <div className="stack-sm">
            <Link to={`/pacientes/${d.patientId}`} style={{ fontSize: 18, fontWeight: 650 }}>{d.patientName}</Link>
            <span className="muted">Ficha {d.recordNumber}{d.patientPhone ? ` · ${d.patientPhone}` : ""}</span>
          </div>
          <div className="card card-pad stack-sm">
            <div className="row-between"><span className="muted">Horario</span><b>{fmtTime(d.startsAt)} – {fmtTime(d.endsAt)}</b></div>
            <div className="row-between"><span className="muted">Profesional</span><span>{d.dentistName}</span></div>
            <div className="row-between"><span className="muted">Consultorio</span><span>{d.chairName ?? "—"}</span></div>
            <div className="row-between"><span className="muted">Prestación</span><span>{d.procedureName ?? d.reason ?? "—"}</span></div>
            <div className="row-between"><span className="muted">Estado</span><StatusBadge status={d.status} label={d.statusLabel} /></div>
            {d.rescheduleCount > 0 && <div className="row-between"><span className="muted">Reprogramaciones</span><span>{d.rescheduleCount}</span></div>}
            {d.cancelReason && <div className="row-between"><span className="muted">Motivo</span><span>{d.cancelReason}</span></div>}
          </div>
          {can("agenda.write") && (
            <>
              <div className="row">
                {d.allowedTransitions.filter((s: string) => s !== "cancelled").map((s: string) => (
                  <button key={s} className={`btn btn-sm ${s === "confirmed" || s === "arrived" || s === "completed" ? "btn-primary" : ""}`} onClick={() => setStatus(s)}>{TRANSITION_LABELS[s]}</button>
                ))}
                {d.allowedTransitions.includes("cancelled") && <button className="btn btn-sm btn-danger" onClick={() => setCancelReason("")}>Cancelar cita</button>}
                {["scheduled", "confirmed"].includes(d.status) && <button className="btn btn-sm" onClick={() => setResched({ date: localDate(new Date(d.startsAt)), time: fmtTime(d.startsAt) })}>Reprogramar</button>}
              </div>
              {cancelReason !== null && (
                <div className="card card-pad stack">
                  <Field label="Motivo de la cancelación"><input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus /></Field>
                  <button className="btn btn-danger" disabled={!cancelReason.trim()} onClick={() => setStatus("cancelled", cancelReason)}>Confirmar cancelación</button>
                </div>
              )}
              {resched && (
                <div className="card card-pad stack">
                  <div className="form-grid">
                    <Field label="Nueva fecha"><input className="input" type="date" value={resched.date} onChange={(e) => setResched({ ...resched, date: e.target.value })} /></Field>
                    <Field label="Nueva hora"><input className="input" type="time" step={900} value={resched.time} onChange={(e) => setResched({ ...resched, time: e.target.value })} /></Field>
                  </div>
                  <button className="btn btn-primary" onClick={reschedule}>Guardar nuevo horario</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function SlotSearchDialog({ branchId, onClose, onPick }: { branchId: string; onClose: () => void; onPick: (p: NewApptPrefill) => void }) {
  const procs = useApi<any[]>("/api/procedures");
  const [f, setF] = useState({ procedureId: "", from: localDate(), days: 7, period: "any", allBranches: false });
  const [res, setRes] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRes(await api.get(`/api/availability/search${qs({ procedureId: f.procedureId || undefined, from: f.from, days: f.days, period: f.period, branchId: f.allBranches ? undefined : branchId, limit: 20 })}`)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title="Buscar horario libre" onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid">
          <Field label="Prestación"><select className="input" value={f.procedureId} onChange={(e) => setF({ ...f, procedureId: e.target.value })}><option value="">Consulta (30 min)</option>{procs.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.durationMin} min)</option>)}</select></Field>
          <Field label="Desde"><input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Turno"><select className="input" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="any">Cualquiera</option><option value="morning">Mañana</option><option value="afternoon">Tarde</option></select></Field>
          <Field label="Alcance" group><label className="check input" style={{ border: "none", paddingLeft: 0 }}><input type="checkbox" checked={f.allBranches} onChange={(e) => setF({ ...f, allBranches: e.target.checked })} />Buscar en todas mis sucursales</label></Field>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={busy} style={{ alignSelf: "flex-start" }}>{busy ? "Buscando…" : "Buscar"}</button>
        {res && (res.slots.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Hora</th><th>Profesional</th><th>Sucursal</th><th /></tr></thead>
            <tbody>{res.slots.map((s: any, i: number) => (
              <tr key={i}><td>{fmtDateLong(s.startsAt)}</td><td><b>{fmtTime(s.startsAt)}</b></td><td>{s.dentistName}</td><td>{s.branchName}</td>
                <td>{s.branchId === branchId && <button className="btn btn-sm btn-primary" onClick={() => onPick({ date: localDate(new Date(s.startsAt)), time: fmtTime(s.startsAt), dentistId: s.dentistId, durationMin: res.durationMin, procedureId: f.procedureId || null })}>Agendar</button>}</td></tr>
            ))}</tbody></table></div>
        ) : <Empty>No hay horarios libres en ese rango.</Empty>)}
      </div>
    </Dialog>
  );
}

function RemindersDialog({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const [date, setDate] = useState(addDays(localDate(), 1));
  const r = useApi<any[]>(`/api/reminders${qs({ date, branchId })}`);
  const ready = r.data?.filter((x) => x.whatsappUrl) ?? [];
  return (
    <Dialog title="Recordatorios por WhatsApp" onClose={onClose} wide>
      <div className="stack">
        <div className="row"><Field label="Citas del día"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        <div className="alert info small">Se envían desde tu WhatsApp con un clic (enlace oficial wa.me). Solo aparecen habilitados los pacientes que aceptaron recibir recordatorios. El mensaje no incluye información clínica.</div>
        {!r.data ? <Loading /> : r.data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Hora</th><th>Paciente</th><th>Profesional</th><th>Envío</th></tr></thead>
            <tbody>{r.data.map((x) => (
              <tr key={x.appointmentId}><td>{fmtTime(x.startsAt)}</td><td>{x.patientFirstName}</td><td>{x.dentistName}</td>
                <td>{x.whatsappUrl ? <a className="btn btn-sm btn-primary" href={x.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} />Enviar</a> : <span className="badge warn">{x.blockedReason}</span>}</td></tr>
            ))}</tbody></table></div>
        ) : <Empty>No hay citas agendadas ese día.</Empty>}
        {r.data && <p className="muted small">{ready.length} de {r.data.length} listos para enviar.</p>}
      </div>
    </Dialog>
  );
}
