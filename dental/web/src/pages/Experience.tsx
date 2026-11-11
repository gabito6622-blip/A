// «Experiencia del paciente»: segmentos y campañas, etiquetas, encuestas de satisfacción y QR de llegada.
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Tabs } from "../components/ui";
import { SegmentsTab } from "../components/family/Segments";
import { TagsAdmin } from "../components/family/TagsAdmin";
import { SurveysPanel } from "../components/family/SurveysPanel";
import { CheckinAdmin } from "../components/family/CheckinAdmin";

type Tab = "segmentos" | "etiquetas" | "encuestas" | "llegada";

export function ExperiencePage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const items: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: "segmentos", label: "Segmentos y campañas", hidden: !can("patients.read") },
    { id: "etiquetas", label: "Etiquetas", hidden: !can("patients.read") },
    { id: "encuestas", label: "Encuestas (NPS)", hidden: !can("clinic.manage") },
    { id: "llegada", label: "Llegada con QR", hidden: !can("clinic.manage") },
  ];
  const visible = items.filter((i) => !i.hidden);
  const asked = sp.get("tab") as Tab | null;
  const tab = visible.find((i) => i.id === asked)?.id ?? visible[0]?.id ?? "segmentos";
  return (
    <div className="stack xp">
      <div className="page-head">
        <div>
          <h1>Experiencia del paciente</h1>
          <p className="sub">Segmentos y campañas con consentimiento, etiquetas, satisfacción y llegada sin fila en recepción.</p>
        </div>
      </div>
      <Tabs<Tab> value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} items={items} />
      {tab === "segmentos" && <SegmentsTab />}
      {tab === "etiquetas" && <TagsAdmin />}
      {tab === "encuestas" && <SurveysPanel />}
      {tab === "llegada" && <CheckinAdmin />}
    </div>
  );
}
