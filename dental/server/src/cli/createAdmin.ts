// Primer administrador de la plataforma en un servidor nuevo (B-100). Solo se usa una vez, desde la
// consola del servicio, después de que las migraciones crearon la base:
//
//   node server/dist/cli/createAdmin.js correo@dominio "Nombre y apellido"
//   (desarrollo: npx tsx server/src/cli/createAdmin.ts …)
//
// Crea la cuenta con una contraseña temporal que se muestra UNA vez y que hay que cambiar al ingresar.
// Si el correo ya existe, no toca nada. La plataforma crea después la clínica y su propietario desde
// el panel «Plataforma SaaS».
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "../lib/password.js";

const [email, ...nameParts] = process.argv.slice(2);
const fullName = nameParts.join(" ").trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || fullName.length < 3) {
  console.error('Uso: createAdmin.js correo@dominio "Nombre y apellido"');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const exists = (await client.query("SELECT 1 FROM users WHERE email = $1", [email.toLowerCase()])).rowCount;
  if (exists) {
    console.error("Ya existe una cuenta con ese correo: no se cambió nada.");
    process.exit(1);
  }
  const temp = `Tmp-${randomBytes(9).toString("base64url")}7`;
  await client.query(
    "INSERT INTO users (email, full_name, password_hash, is_platform_admin, must_change_password) VALUES ($1,$2,$3,true,true)",
    [email.toLowerCase(), fullName, await hashPassword(temp)]);
  console.log(`Administrador de plataforma creado: ${email.toLowerCase()}`);
  console.log(`Contraseña temporal (se muestra una sola vez; cámbiala al ingresar y activa los 2 pasos): ${temp}`);
} finally {
  await client.end();
}
