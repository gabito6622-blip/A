import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { AskProvider, ToastProvider } from "./components/ui";
import { registerPwa } from "./lib/pwa";
import { startTableCards } from "./lib/tableCards";
import { OfflineBanner } from "./components/OfflineBanner";

registerPwa();
startTableCards();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OfflineBanner />
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AskProvider>
            <App />
          </AskProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
