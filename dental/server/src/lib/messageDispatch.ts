// Despachador de la bandeja de mensajes (B-070): envía al proveedor FUERA de la transacción de la
// clínica.
//
//   1. Transacción corta por clínica: toma los mensajes 'queued' vencidos de ESE proveedor con
//      FOR UPDATE SKIP LOCKED (dos procesos no toman el mismo) y los marca 'sending'. COMMIT.
//   2. Envía cada uno sin transacción abierta.
//   3. Transacción corta: 'sent' con el id del proveedor, o
//        - error transitorio (429, 5xx, red; error.retryable): vuelve a 'queued' con espera creciente
//          (1, 2, 4, 8… min, hasta MAX_ATTEMPTS);
//        - error definitivo (número inválido, plantilla rechazada): 'failed' con el motivo.
//   Un mensaje que quedó 'sending' más de STALE_MINUTES (el proceso se cayó en pleno envío) NO se
//   reenvía, porque no se sabe si salió: pasa a 'failed' y se puede reintentar a mano.
import type { Db } from "./db.js";
import { withTenant } from "./db.js";
import type { MessageProvider } from "./messaging.js";

export const MAX_ATTEMPTS = 5;
export const STALE_MINUTES = 10;
const BATCH = 20;

export interface DispatchSummary { clinics: number; sent: number; failed: number; retried: number; stale: number }

interface Row { id: string; channel: string; recipient: string; template: string; body: string; provider_template: any; attempts: number }

export const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

/** Una pasada: todas las clínicas con mensajes en cola para este proveedor. */
export async function dispatchOnce(db: Db, provider: MessageProvider, now: Date = new Date()): Promise<DispatchSummary> {
  const sum: DispatchSummary = { clinics: 0, sent: 0, failed: 0, retried: 0, stale: 0 };
  const ids = (await db.appPool.query<{ id: string }>("SELECT messaging_clinics_with_outbox($1) AS id", [provider.name])).rows.map((r) => r.id);
  for (const clinicId of ids) {
    sum.clinics++;
    const ctx = { clinicId, userId: null };
    // 1. Tomar (y cerrar los que quedaron «enviando» de una caída).
    const batch = await withTenant(db.appPool, ctx, async (c) => {
      const stale = await c.query(
        `UPDATE outbound_messages SET status = 'failed', error = 'Estado incierto: el envío se interrumpió y no se sabe si salió. Revísalo y reintenta si hace falta.'
          WHERE provider = $1 AND status = 'sending' AND claimed_at < $2::timestamptz - make_interval(mins => $3)`,
        [provider.name, now, STALE_MINUTES]);
      sum.stale += stale.rowCount ?? 0;
      return (await c.query<Row>(
        `UPDATE outbound_messages m SET status = 'sending', claimed_at = $2, attempts = m.attempts + 1
          WHERE m.id IN (SELECT x.id FROM outbound_messages x
                          WHERE x.provider = $1 AND x.status = 'queued' AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= $2)
                          ORDER BY x.created_at LIMIT $3 FOR UPDATE SKIP LOCKED)
          RETURNING m.id, m.channel, m.recipient, m.template, m.body, m.provider_template, m.attempts`,
        [provider.name, now, BATCH])).rows;
    });
    // 2 y 3. Enviar fuera de la transacción y registrar el resultado.
    for (const m of batch) {
      let outcome: { kind: "sent"; providerId: string } | { kind: "retry"; error: string } | { kind: "failed"; error: string };
      try {
        const r = await provider.send({ channel: m.channel as any, recipient: m.recipient, template: m.template, body: m.body, providerTemplate: m.provider_template ?? null });
        outcome = { kind: "sent", providerId: r.providerMessageId };
      } catch (e) {
        const error = String((e as Error).message ?? e).slice(0, 300);
        outcome = (e as { retryable?: boolean }).retryable && m.attempts < MAX_ATTEMPTS ? { kind: "retry", error } : { kind: "failed", error };
      }
      await withTenant(db.appPool, ctx, async (c) => {
        if (outcome.kind === "sent") {
          await c.query("UPDATE outbound_messages SET status = 'sent', provider_message_id = $2, sent_at = now(), error = NULL WHERE id = $1 AND status = 'sending'", [m.id, outcome.providerId]);
          sum.sent++;
        } else if (outcome.kind === "retry") {
          await c.query(
            "UPDATE outbound_messages SET status = 'queued', error = $2, next_attempt_at = $3::timestamptz + make_interval(mins => $4) WHERE id = $1 AND status = 'sending'",
            [m.id, outcome.error, now, backoffMinutes(m.attempts)]);
          sum.retried++;
        } else {
          await c.query("UPDATE outbound_messages SET status = 'failed', error = $2 WHERE id = $1 AND status = 'sending'", [m.id, outcome.error]);
          sum.failed++;
        }
      });
    }
  }
  return sum;
}

// ---------------- En el proceso ----------------
let running: { db: Db; provider: MessageProvider; busy: boolean; again: boolean } | null = null;

async function pass() {
  if (!running) return;
  if (running.busy) { running.again = true; return; }
  running.busy = true;
  try {
    do {
      running.again = false;
      const s = await dispatchOnce(running.db, running.provider);
      if (s.sent || s.failed || s.retried || s.stale) console.log(`[mensajes] Despachados: ${s.sent} enviados, ${s.failed} fallidos, ${s.retried} para reintentar, ${s.stale} en estado incierto`);
    } while (running?.again);
  } catch (e) {
    console.error(`[mensajes] El despachador falló: ${(e as Error).message}`);
  } finally {
    if (running) running.busy = false;
  }
}

/** Pide una pasada pronto (después del COMMIT de quien encoló). Sin despachador activo, no hace nada. */
export function kickDispatch(): void {
  if (!running) return;
  setTimeout(() => { void pass(); }, 200).unref?.();
}

/** Arranca el despachador (main.ts, solo con proveedor real). Devuelve la función para detenerlo. */
export function startMessageDispatcher(db: Db, provider: MessageProvider, intervalMs = 15_000): () => void {
  running = { db, provider, busy: false, again: false };
  const h = setInterval(() => { void pass(); }, Math.max(2_000, intervalMs));
  h.unref?.();
  void pass();
  console.log(`[mensajes] Despachador activo con el proveedor ${provider.name} (cada ${Math.round(intervalMs / 1000)} s y al encolar).`);
  return () => { clearInterval(h); running = null; };
}
