import { loadConfig } from "./config.js";
import { createDb } from "./lib/db.js";
import { migrate } from "./lib/migrate.js";
import { buildApp } from "./app.js";
import { startMessagingScheduler } from "./modules/messaging/index.js";
import { whatsappProviderFromEnv } from "./modules/messaging/whatsapp.js";
import { startMessageDispatcher } from "./lib/messageDispatch.js";
import { startOpsMonitor } from "./modules/ops/index.js";

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
if (process.env.MIGRATE_ON_START !== "0") {
  const applied = await migrate(db.adminPool, undefined, (m) => console.log(m));
  if (applied.length) console.log(`Migraciones aplicadas: ${applied.join(", ")}`);
}
const app = await buildApp(cfg, db, { logger: true });
await app.listen({ port: cfg.port, host: cfg.host });
if (process.env.MESSAGING_SCHEDULER === "1") startMessagingScheduler(db, cfg);
// B-070: con proveedor real, la bandeja se envía desde la cola, fuera de las transacciones.
const waProvider = whatsappProviderFromEnv();
if (waProvider) startMessageDispatcher(db, waProvider);
if (app.ops.ops.alerts.monitorEnabled) startOpsMonitor(app, db);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
