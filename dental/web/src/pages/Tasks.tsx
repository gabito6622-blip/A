// Tareas internas (R2-36): "Mis tareas", "Creadas por mí" y el tablero de la sucursal.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { Empty, Field, Loading, Tabs } from "../components/ui";
import { NewTaskDialog, TaskDetailDialog, TaskItem, type Task } from "../components/coordination/Tasks";

type View = "mias" | "creadas" | "sucursal";
const SCOPE: Record<View, string> = { mias: "mine", creadas: "created", sucursal: "branch" };

export function TasksPage() {
  const { branchId } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = (["mias", "creadas", "sucursal"].includes(params.get("vista") ?? "") ? params.get("vista") : "mias") as View;
  const [status, setStatus] = useState<"active" | "done" | "cancelled">("active");
  const list = useApi<Task[]>(`/api/tasks${qs({ scope: SCOPE[view], branchId, status: view === "sucursal" ? "all" : status })}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const setView = (v: View) => setParams(v === "mias" ? {} : { vista: v }, { replace: true });
  const items = list.data ?? [];
  const cols: { id: Task["status"][]; label: string }[] = [
    { id: ["open"], label: "Abiertas" }, { id: ["taken"], label: "Tomadas" }, { id: ["done", "cancelled"], label: "Cerradas (60 días)" },
  ];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Tareas</h1>
          <p className="sub">Relevos del equipo: quién hace qué y para cuándo. Las vencidas aparecen en el Inicio de quien corresponde.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nueva tarea</button>
      </div>
      <Tabs<View> value={view} onChange={setView} items={[
        { id: "mias", label: "Mis tareas" }, { id: "creadas", label: "Creadas por mí" }, { id: "sucursal", label: "Tablero" },
      ]} />
      {view !== "sucursal" && (
        <Field label="Mostrar" group>
          <div className="co-seg">
            {([["active", "Pendientes"], ["done", "Hechas"], ["cancelled", "Canceladas"]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>
            ))}
          </div>
        </Field>
      )}
      {list.error && <div className="alert danger" role="alert">{list.error}</div>}
      {list.loading && !list.data ? <div className="card"><Loading /></div> : view === "sucursal" ? (
        <div className="co-board">
          {cols.map((c) => {
            const its = items.filter((t) => c.id.includes(t.status));
            return (
              <section key={c.label} className="co-col" aria-label={c.label}>
                <h3>{c.label}<span className="badge">{its.length}</span></h3>
                {its.length ? <div className="co-list">{its.map((t) => <TaskItem key={t.id} t={t} onOpen={setOpenId} onChanged={list.reload} showBranch={!branchId} />)}</div>
                  : <Empty>Nada por aquí.</Empty>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card">
          {items.length ? <div className="co-list">{items.map((t) => <TaskItem key={t.id} t={t} onOpen={setOpenId} onChanged={list.reload} showBranch={!branchId} />)}</div>
            : <Empty>{status === "active" ? (view === "mias" ? "No tienes tareas pendientes." : "No creaste tareas pendientes.") : "No hay tareas en esta lista."}</Empty>}
        </div>
      )}
      {openId && <TaskDetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
      {creating && <NewTaskDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />}
    </div>
  );
}
