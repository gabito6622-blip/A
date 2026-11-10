// Servidor para pruebas end-to-end: base limpia, migraciones, datos demo ficticios y servidor real.
import pg from "pg";
import { execFileSync } from "node:child_process";

const url = new URL(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_e2e");
const name = url.pathname.slice(1);
if (!/e2e|test/.test(name)) throw new Error("La base e2e debe contener 'e2e' o 'test' en el nombre");
const admin = new URL(url); admin.pathname = "/postgres";
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
await c.query(`CREATE DATABASE "${name}"`);
await c.end();
const env = { ...process.env, DATABASE_URL: url.toString(), DENTAL_SCRYPT_N: "1024", NODE_ENV: "development" };
execFileSync(process.execPath, ["--import", "tsx", "server/src/cli/seed.ts"], { env, stdio: "inherit" });
process.env.DATABASE_URL = url.toString();
process.env.DENTAL_STATIC_DIR = "web/dist";
process.env.PORT = process.env.E2E_PORT ?? "3199";
process.env.DENTAL_DISABLE_RATE_LIMIT = "1";
await import("../server/src/main.ts");
