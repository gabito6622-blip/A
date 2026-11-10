// Rutas públicas del paciente (se muestran antes del ingreso del personal).
import { Navigate, Route, Routes } from "react-router-dom";
import { BookingPage } from "./Booking";
import { MyAccountPage, ReceiptPage } from "./MyAccount";

export const isPortalPath = (p: string) => p.startsWith("/reservar/") || p.startsWith("/mi-cuenta/");

export default function PortalApp() {
  return (
    <Routes>
      <Route path="/reservar/:slug" element={<BookingPage />} />
      <Route path="/mi-cuenta/:slug" element={<MyAccountPage />} />
      <Route path="/mi-cuenta/:slug/recibo/:id" element={<ReceiptPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
