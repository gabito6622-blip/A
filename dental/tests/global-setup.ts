import pg from "pg";
import { createDb } from "../server/src/lib/db.js";
import { migrate } from "../server/src/lib/migrate.js";

// Crea una base de datos de pruebas limpia y aplica todas las migraciones.
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_test");
  const dbName = url.pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error("La base de pruebas debe contener 'test' en su nombre");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const c = new pg.Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  const db = createDb(url.toString());
  await migrate(db.adminPool);
  await db.close();
}
