import { loadConfig } from "./config.js";
import { createDb } from "./lib/db.js";
import { migrate } from "./lib/migrate.js";
import { buildApp } from "./app.js";

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
if (process.env.MIGRATE_ON_START !== "0") {
  const applied = await migrate(db.adminPool, undefined, (m) => console.log(m));
  if (applied.length) console.log(`Migraciones aplicadas: ${applied.join(", ")}`);
}
const app = await buildApp(cfg, db, { logger: true });
await app.listen({ port: cfg.port, host: cfg.host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
