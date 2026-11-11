import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Operación diaria (Equipo V): se ejecuta la CLI real de respaldo contra la base e2e (carpeta local
// temporal, cifrado) y la plataforma ve el resultado en Plataforma SaaS → Estado del sistema.
const PW = "Demo2026dental";

test("la plataforma ve el panel de estado con el último respaldo", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-respaldos-"));
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", "server/src/cli/backup.ts", "run", "--json"], {
      env: {
        ...process.env, NODE_ENV: "development", DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_e2e",
        BACKUP_STORAGE: "local", BACKUP_DIR: dir, BACKUP_PASSPHRASE: "frase-e2e-de-prueba-0123456789",
      },
    }).toString();
    const result = JSON.parse(out);
    expect(result.ok, out).toBe(true);

    await page.goto("/");
    await page.fill("#email", "superadmin@demo.local");
    await page.fill("#pw", PW);
    await page.click('button:has-text("Ingresar")');
    await expect(page.getByRole("heading", { name: "Plataforma SaaS" })).toBeVisible();
    await page.getByRole("tab", { name: "Estado del sistema" }).click();

    const last = page.getByLabel("Último respaldo");
    await expect(last).toContainText("Correcto");
    await expect(last).toContainText(/hace (un momento|\d+ min)/);
    await expect(page.getByLabel("Último simulacro de restauración")).toContainText("Sin simulacros");
    await expect(page.getByRole("cell", { name: result.name })).toBeVisible();
    await expect(page.getByText("Último respaldo cifrado:")).toContainText("Sí");
    await expect(page.getByText("Base de datos", { exact: true })).toBeVisible();
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();

    // Alerta de prueba: simulada fuera de producción.
    await page.getByRole("button", { name: "Enviar alerta de prueba" }).click();
    await expect(page.getByText(/Alerta de prueba simulada/)).toBeVisible();
    await expect(page.getByRole("cell", { name: /Alerta de prueba/ })).toBeVisible();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
