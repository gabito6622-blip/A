import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { LoginPage, ClinicSelectPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { AgendaPage } from "./pages/Agenda";
import { PatientsPage } from "./pages/Patients";
import { PatientDetailPage } from "./pages/PatientDetail";
import { BudgetsPage } from "./pages/Budgets";
import { CashPage } from "./pages/Cash";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { AssistantPage } from "./pages/Assistant";
import { PlatformPage } from "./pages/Platform";
import { Loading } from "./components/ui";

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading rows={6} />;
  if (!me) return <LoginPage />;
  if (!me.clinic) {
    if (me.user.isPlatformAdmin && me.clinics.length === 0) return <Layout platformOnly><PlatformPage /></Layout>;
    return <ClinicSelectPage />;
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/pacientes" element={<PatientsPage />} />
        <Route path="/pacientes/:id" element={<PatientDetailPage />} />
        <Route path="/presupuestos" element={<BudgetsPage />} />
        <Route path="/caja" element={<CashPage />} />
        <Route path="/reportes" element={<ReportsPage />} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="/asistente" element={<AssistantPage />} />
        {me.user.isPlatformAdmin && <Route path="/plataforma" element={<PlatformPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
