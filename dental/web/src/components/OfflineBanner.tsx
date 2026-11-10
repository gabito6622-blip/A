import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Aviso fijo cuando el dispositivo pierde la conexión. Los datos nunca se guardan en el dispositivo. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden />
      <span>Sin conexión a internet. Nada de lo que hagas se guardará hasta que vuelva la conexión.</span>
    </div>
  );
}
