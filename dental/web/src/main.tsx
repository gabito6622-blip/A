import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { AskProvider, ToastProvider } from "./components/ui";
import { registerPwa } from "./lib/pwa";
import { startTableCards } from "./lib/tableCards";
import { OfflineBanner } from "./components/OfflineBanner";

const DEMO = import.meta.env.MODE === "demo";
// En la demo (página de Claude) no hay servidor: rutas con # y datos grabados (web/src/demo/mockApi.ts).
const Router = DEMO ? HashRouter : BrowserRouter;

async function start() {
  if (DEMO) {
    const { installDemoApi } = await import("./demo/mockApi");
    await installDemoApi("./demo-fixtures.json");
  } else registerPwa();
  startTableCards();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {DEMO && <div className="demo-banner" role="note">Demo con datos inventados · no se guardan cambios</div>}
      <OfflineBanner />
      <Router>
        <AuthProvider>
          <ToastProvider>
            <AskProvider>
              <App />
            </AskProvider>
          </ToastProvider>
        </AuthProvider>
      </Router>
    </StrictMode>,
  );
}
void start();
