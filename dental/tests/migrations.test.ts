import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../server/src/lib/db.js";
import { migrate, MIGRATIONS_DIR } from "../server/src/lib/migrate.js";

describe("migraciones", () => {
  it("son idempotentes: volver a ejecutar no aplica nada", async () => {
    const db = createDb(process.env.DATABASE_URL!);
    try {
      expect(await migrate(db.adminPool)).toEqual([]);
    } finally { await db.close(); }
  });

  it("detectan si una migración ya aplicada fue modificada", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR)) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const first = readdirSync(dir).sort()[0]!;
    writeFileSync(join(dir, first), "-- cambiado\n", { flag: "a" });
    const db = createDb(process.env.DATABASE_URL!);
    try {
      await expect(migrate(db.adminPool, dir)).rejects.toThrow(/checksum/);
    } finally { await db.close(); }
  });
});
