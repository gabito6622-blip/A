import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { LoginPage, ClinicSelectPage, MfaVerifyPage, ResetPasswordPage } from "./pages/Login";
import { AccountPage, SecurityGatePage } from "./pages/Account";
import { WaitingRoomPage } from "./pages/WaitingRoom";
import { BiosafetyPage } from "./pages/Biosafety";
import { DashboardPage } from "./pages/Dashboard";
import { AgendaPage } from "./pages/Agenda";
import { PatientsPage } from "./pages/Patients";
import { PatientDetailPage } from "./pages/PatientDetail";
import { BudgetsPage } from "./pages/Budgets";
import { CashPage } from "./pages/Cash";
import { CashSessionReportPage } from "./pages/CashSessions";
import { FeesPage, FeeSettlementPage } from "./pages/Fees";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { AssistantPage } from "./pages/Assistant";
import { PlatformPage } from "./pages/Platform";
import { RecallsPage } from "./pages/Recalls";
import { Loading } from "./components/ui";
import { PublicBudgetPage } from "./pages/PublicBudget";
import { MessagesPage } from "./pages/Messages";

const PortalApp = lazy(() => import("./portal/PortalApp"));

export function App() {
  const { me, loading } = useAuth();
  const { pathname } = useLocation();
  if (window.location.pathname === "/restablecer") return <ResetPasswordPage />;
  if (window.location.pathname.startsWith("/p/presupuesto/")) return <PublicBudgetPage />;
  if (/^\/(reservar|mi-cuenta)\//.test(pathname)) return <Suspense fallback={<Loading rows={4} />}><PortalApp /></Suspense>;
  if (loading) return <Loading rows={6} />;
  if (!me) return <LoginPage />;
  if (me.mfaPending) return <MfaVerifyPage />;
  if (me.mustChangePassword || me.mfaEnrollmentRequired) return <SecurityGatePage />;
  if (!me.clinic) {
    if (me.user.isPlatformAdmin && me.clinics.length === 0) return <Layout platformOnly><PlatformPage /></Layout>;
    return <ClinicSelectPage />;
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/sala-espera" element={<WaitingRoomPage />} />
        <Route path="/controles" element={<RecallsPage />} />
        <Route path="/cuenta" element={<AccountPage />} />
        <Route path="/bioseguridad" element={<BiosafetyPage />} />
        <Route path="/pacientes" element={<PatientsPage />} />
        <Route path="/pacientes/:id" element={<PatientDetailPage />} />
        <Route path="/presupuestos" element={<BudgetsPage />} />
        <Route path="/caja" element={<CashPage />} />
        <Route path="/caja/sesiones/:id" element={<CashSessionReportPage />} />
        <Route path="/honorarios" element={<FeesPage />} />
        <Route path="/honorarios/:id" element={<FeeSettlementPage />} />
        <Route path="/reportes" element={<ReportsPage />} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="/asistente" element={<AssistantPage />} />
        <Route path="/mensajes" element={<MessagesPage />} />
        {me.user.isPlatformAdmin && <Route path="/plataforma" element={<PlatformPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
