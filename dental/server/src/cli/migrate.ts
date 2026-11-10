import { loadConfig } from "../config.js";
import { createDb } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
try {
  const applied = await migrate(db.adminPool, undefined, console.log);
  console.log(applied.length ? `Migraciones aplicadas: ${applied.join(", ")}` : "La base ya está al día.");
} finally {
  await db.close();
}
