import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Empty, Tabs } from "../components/ui";
import { ProfitabilityTab } from "../components/management/Profitability";
import { ExpensesTab } from "../components/management/Expenses";
import { TimeClockAdminTab } from "../components/management/TimeClock";

type Tab = "rentabilidad" | "gastos" | "fichaje";

/** Vista del dueño y del gerente: rentabilidad por sucursal y sillón, gastos y fichaje del personal. */
export function ManagementPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (["rentabilidad", "gastos", "fichaje"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "rentabilidad") as Tab;
  if (!can("reports.financial")) return <Empty>Tu rol no tiene acceso a la gestión financiera.</Empty>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Gestión</h1>
          <p className="sub">Rentabilidad por sucursal y sillón, gastos y asistencia del personal</p>
        </div>
      </div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} items={[
        { id: "rentabilidad", label: "Rentabilidad" },
        { id: "gastos", label: "Gastos" },
        { id: "fichaje", label: "Fichaje" },
      ]} />
      {tab === "rentabilidad" && <ProfitabilityTab />}
      {tab === "gastos" && <ExpensesTab />}
      {tab === "fichaje" && <TimeClockAdminTab />}
    </div>
  );
}
