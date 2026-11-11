// B-070: la bandeja se envía al proveedor FUERA de la transacción de la clínica.
// Proveedor falso: nunca sale un mensaje real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { createMessenger, type MessageProvider } from "../server/src/lib/messaging.js";
import { backoffMinutes, dispatchOnce, MAX_ATTEMPTS, STALE_MINUTES } from "../server/src/lib/messageDispatch.js";
import { createClinic, setupEnv, teardown, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let A: TestClinic, B: TestClinic;
beforeAll(async () => {
  env = await setupEnv();
  A = await createClinic(env.db);
  B = await createClinic(env.db);
}, 60_000);
afterAll(async () => teardown(env));

let seq = 0;
function fakeProvider(name: string, behave: (n: number, recipient: string) => "ok" | "transient" | "permanent" = () => "ok") {
  const sent: { recipient: string; template: string; providerTemplate: unknown }[] = [];
  let calls = 0;
  const p: MessageProvider = {
    name,
    async send(m) {
      const b = behave(++calls, m.recipient);
      if (b === "transient") throw Object.assign(new Error("WhatsApp rechazó el mensaje (503): ocupado"), { retryable: true });
      if (b === "permanent") throw new Error("WhatsApp rechazó el mensaje (400): número inválido");
      sent.push({ recipient: m.recipient, template: m.template, providerTemplate: m.providerTemplate ?? null });
      return { providerMessageId: `wamid.${name}.${++seq}` };
    },
  };
  return { p, sent, calls: () => calls };
}
const enqueue = (clinicId: string, provider: MessageProvider, recipient: string, extra: Record<string, unknown> = {}) =>
  withTenant(env.db.appPool, { clinicId, userId: null }, (c) =>
    createMessenger({ isProduction: true }, { provider, log: () => {} }).enqueue(c, {
      clinicId, channel: "whatsapp", recipient, template: "prueba.cola", purpose: "transactional", body: "Hola", ...extra,
    }));
const row = async (id: string) => (await env.db.adminPool.query("SELECT * FROM outbound_messages WHERE id = $1", [id])).rows[0];

describe("cola de envío (B-070)", () => {
  it("encolar no envía; el despachador envía después del COMMIT y guarda el id del proveedor y la plantilla", async () => {
    const f = fakeProvider("cola-ok");
    const tpl = { name: "recordatorio_cita", language: "es", params: ["Ana", "jueves 10:00"] };
    const r = await enqueue(A.clinicId, f.p, "+59170000001", { providerTemplate: tpl });
    expect(r.status).toBe("queued");
    expect(f.sent).toHaveLength(0);
    const s = await dispatchOnce(env.db, f.p);
    expect(s).toMatchObject({ sent: 1, failed: 0 });
    expect(f.sent).toEqual([{ recipient: "+59170000001", template: "prueba.cola", providerTemplate: tpl }]);
    expect(await row(r.id)).toMatchObject({ status: "sent", attempts: 1 });
    expect((await row(r.id)).provider_message_id).toMatch(/^wamid\.cola-ok\./);
    // Una segunda pasada no lo vuelve a enviar.
    await dispatchOnce(env.db, f.p);
    expect(f.sent).toHaveLength(1);
  });

  it("si la transacción que lo encoló se revierte, el mensaje no sale nunca", async () => {
    const f = fakeProvider("cola-rollback");
    await expect(withTenant(env.db.appPool, { clinicId: A.clinicId, userId: null }, async (c) => {
      await createMessenger({ isProduction: true }, { provider: f.p, log: () => {} }).enqueue(c, {
        clinicId: A.clinicId, channel: "whatsapp", recipient: "+59170000002", template: "prueba.cola", purpose: "transactional", body: "Hola",
      });
      throw new Error("falla posterior en la misma operación");
    })).rejects.toThrow(/falla posterior/);
    await dispatchOnce(env.db, f.p);
    expect(f.calls()).toBe(0);
  });

  it("error transitorio: reintenta con espera creciente; error definitivo: falla con el motivo", async () => {
    const f = fakeProvider("cola-reintento", (n) => (n <= 2 ? "transient" : "ok"));
    const r = await enqueue(A.clinicId, f.p, "+59170000003");
    const t0 = new Date("2026-11-11T12:00:00Z");
    expect((await dispatchOnce(env.db, f.p, t0)).retried).toBe(1);
    expect(await row(r.id)).toMatchObject({ status: "queued", attempts: 1 });
    expect((await row(r.id)).error).toMatch(/503/);
    // Antes de la espera no se intenta.
    await dispatchOnce(env.db, f.p, new Date(+t0 + 30_000));
    expect(f.calls()).toBe(1);
    await dispatchOnce(env.db, f.p, new Date(+t0 + backoffMinutes(1) * 60_000));
    expect(await row(r.id)).toMatchObject({ status: "queued", attempts: 2 });
    await dispatchOnce(env.db, f.p, new Date(+t0 + 10 * 60_000));
    expect(await row(r.id)).toMatchObject({ status: "sent", attempts: 3, error: null });

    const g = fakeProvider("cola-definitivo", () => "permanent");
    const r2 = await enqueue(A.clinicId, g.p, "+59170000004");
    expect((await dispatchOnce(env.db, g.p)).failed).toBe(1);
    expect(await row(r2.id)).toMatchObject({ status: "failed", attempts: 1, error: "WhatsApp rechazó el mensaje (400): número inválido" });

    // Transitorio que nunca se recupera: falla al llegar al máximo de intentos.
    const h = fakeProvider("cola-agotado", () => "transient");
    const r3 = await enqueue(A.clinicId, h.p, "+59170000005");
    let t = new Date("2026-11-11T12:00:00Z");
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) { await dispatchOnce(env.db, h.p, t); t = new Date(+t + 61 * 60_000); }
    expect(await row(r3.id)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(h.calls()).toBe(MAX_ATTEMPTS);
  });

  it("un envío interrumpido (quedó «enviando») no se reenvía: pasa a fallido con motivo", async () => {
    const f = fakeProvider("cola-caida");
    const r = await enqueue(A.clinicId, f.p, "+59170000006");
    await env.db.adminPool.query("UPDATE outbound_messages SET status = 'sending', claimed_at = now() - interval '1 hour', attempts = 1 WHERE id = $1", [r.id]);
    const s = await dispatchOnce(env.db, f.p, new Date(Date.now() + STALE_MINUTES * 60_000));
    expect(s.stale).toBe(1);
    expect(f.calls()).toBe(0);
    expect(await row(r.id)).toMatchObject({ status: "failed" });
    expect((await row(r.id)).error).toMatch(/incierto/);
  });

  it("dos despachadores a la vez no envían dos veces el mismo mensaje; cada clínica con su propio contexto", async () => {
    const f = fakeProvider("cola-paralelo");
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await enqueue(i % 2 ? A.clinicId : B.clinicId, f.p, `+5917100000${i}`)).id);
    await Promise.all([dispatchOnce(env.db, f.p), dispatchOnce(env.db, f.p), dispatchOnce(env.db, f.p)]);
    expect(f.sent).toHaveLength(6);
    expect(new Set(f.sent.map((x) => x.recipient)).size).toBe(6);
    const rows = (await env.db.adminPool.query("SELECT clinic_id, status FROM outbound_messages WHERE id = ANY($1)", [ids])).rows;
    expect(rows.every((x) => x.status === "sent")).toBe(true);
    // La función que lista clínicas solo devuelve identificadores y respeta el proveedor.
    const list = (await env.db.appPool.query("SELECT messaging_clinics_with_outbox('cola-paralelo') AS id")).rows;
    expect(list).toEqual([]);
  });

  it("sin proveedor (producción sin credenciales) el mensaje queda en cola y ningún despachador lo toma", async () => {
    const r = await withTenant(env.db.appPool, { clinicId: A.clinicId, userId: null }, (c) =>
      createMessenger({ isProduction: true }, { provider: null, log: () => {} }).enqueue(c, {
        clinicId: A.clinicId, channel: "whatsapp", recipient: "+59170000009", template: "prueba.cola", purpose: "transactional", body: "Hola",
      }));
    const f = fakeProvider("cola-otro");
    await dispatchOnce(env.db, f.p);
    expect(f.calls()).toBe(0);
    expect(await row(r.id)).toMatchObject({ status: "queued", provider: null });
  });
});
