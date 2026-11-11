// Saldo inicial traído del sistema anterior, en «Cuenta y pagos» del paciente. Solo se muestra si existe.
// No se edita: se anula con motivo (asiento opuesto) y el original queda en el historial.
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { bs, fmtDate } from "../../lib/format";
import { useAsk, useToast } from "../ui";

export function OpeningBalanceCard({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const ask = useAsk();
  const toast = useToast();
  const list = useApi<any[]>(`/api/patients/${patientId}/opening-balances`);
  if (!list.data?.length) return null;
  const voidIt = async (o: any) => {
    const reason = await ask({
      title: "Anular saldo inicial", message: `Se registra un asiento por ${bs(-o.amountCents)} que deja sin efecto el saldo inicial; el original se conserva en el historial.`,
      inputLabel: "Motivo de la anulación", confirmLabel: "Anular saldo inicial", danger: true,
    });
    if (!reason) return;
    try { await api.post(`/api/opening-balances/${o.id}/void`, { reason }); toast("Saldo inicial anulado"); list.reload(); onChanged(); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Saldo inicial (sistema anterior)</h2></div>
      <div className="table-wrap"><table className="table cards-sm">
        <thead><tr><th aria-label="Movimiento" /><th>Al día</th><th className="num">Monto</th><th /></tr></thead>
        <tbody>{list.data.map((o) => (
          <tr key={o.id} style={o.voided ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
            <td>
              <b>{o.voidsId ? `Anulación: ${o.voidReason}` : o.amountCents > 0 ? "Deuda al día del corte" : "Saldo a favor del paciente"}</b>
              {(o.notes || o.branchName) && <div className="muted small">{[o.notes, o.branchName].filter(Boolean).join(" · ")}</div>}
            </td>
            <td className="nowrap">{fmtDate(`${o.cutoffDate}T12:00:00`)}</td>
            <td className="num">{bs(o.amountCents)}</td>
            <td>{can("payments.void") && !o.voided && !o.voidsId ? <button className="btn btn-ghost btn-sm" style={{ minHeight: 40 }} onClick={() => voidIt(o)}>Anular</button> : null}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
