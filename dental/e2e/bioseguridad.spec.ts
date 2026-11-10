import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", "Demo2026dental");
  const me = page.waitForResponse((r) => r.url().endsWith("/api/auth/me") && r.request().method() === "GET");
  await page.click('button:has-text("Ingresar")');
  await me;
}

test("limpieza: entra directo a Bioseguridad, registra limpieza y un ciclo; un indicador fallido alerta", async ({ page }) => {
  await login(page, "limpieza.lpz@demo.local");
  await expect(page).toHaveURL(/\/bioseguridad$/);
  await expect(page.getByRole("link", { name: "Pacientes" })).toHaveCount(0);
  const c1 = page.locator("section", { has: page.getByRole("heading", { name: "Consultorio 1" }) });
  await c1.getByRole("button", { name: "Apertura" }).click();
  await expect(page.getByText("Registrado: Apertura del consultorio · Consultorio 1")).toBeVisible();
  await expect(c1.getByText("Apertura ✓")).toBeVisible();

  await page.getByRole("tab", { name: /Esterilización/ }).click();
  await page.getByRole("button", { name: "Registrar ciclo" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar ciclo de esterilización" });
  await dlg.getByRole("button", { name: "Guardar ciclo" }).click();
  await expect(dlg.getByText("Describe qué se esterilizó")).toBeVisible();
  await dlg.getByLabel("Carga (qué se esterilizó)").fill("Kits de prueba E2E");
  await dlg.getByRole("button", { name: "No viró (falló)" }).click();
  await expect(dlg.getByText(/no uses esta carga/)).toBeVisible();
  await dlg.getByRole("button", { name: "Guardar ciclo" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "indicador químico fallido" })).toBeVisible();
});

test("odontólogo ve 'Mis pacientes de hoy' en el inicio", async ({ page }) => {
  await login(page, "dr.mendoza@demo.local");
  await expect(page.getByRole("heading", { name: "Mis pacientes de hoy" })).toBeVisible();
});
