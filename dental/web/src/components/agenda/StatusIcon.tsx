import { Ban, CheckCheck, CircleCheck, Clock, DoorOpen, Stethoscope, UserX } from "lucide-react";

const ICONS = { scheduled: Clock, confirmed: CircleCheck, arrived: DoorOpen, in_progress: Stethoscope, completed: CheckCheck, no_show: UserX, cancelled: Ban } as const;
export const STATUS_TEXT: Record<string, string> = {
  scheduled: "Agendada", confirmed: "Confirmada", arrived: "En sala de espera", in_progress: "En atención", completed: "Atendida", no_show: "No asistió", cancelled: "Cancelada",
};

/** Ícono del estado con nombre accesible (el color no es la única pista). */
export function StatusIcon({ status, size = 13 }: { status: string; size?: number }) {
  const I = ICONS[status as keyof typeof ICONS] ?? Clock;
  return <I size={size} role="img" aria-label={STATUS_TEXT[status] ?? status} className="st-icon" style={{ flex: "none" }} />;
}
