import { expect, test } from "@playwright/test";

// B-070: recepción ve las respuestas de los pacientes de su sucursal, con el contador del menú, y
// las marca atendidas. Respuestas ficticias de la semilla demo (una por sucursal).
test("recepción atiende una respuesta de WhatsApp y el contador del menú baja", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "recepcion.cbb@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();

  const link = page.locator(".sidebar").getByRole("link", { name: /^Respuestas/ });
  await expect(link.locator(".nav-count")).toHaveText("1");
  await link.click();
  await expect(page.getByRole("heading", { name: "Respuestas" })).toBeVisible();
  const items = page.locator(".reply-item");
  await expect(items).toHaveCount(1); // solo la de su sucursal
  await items.first().getByRole("button", { name: "Marcar atendida" }).click();
  const dlg = page.getByRole("dialog", { name: "Marcar atendida" });
  await dlg.getByLabel("Nota (opcional)").fill("Le respondí por teléfono");
  await dlg.getByRole("button", { name: "Marcar atendida" }).click();
  await expect(page.getByText("Respuesta atendida")).toBeVisible();
  await expect(page.getByText("No hay respuestas sin atender.")).toBeVisible();
  await expect(link.locator(".nav-count")).toHaveCount(0);

  await page.getByRole("tab", { name: "Atendidas" }).click();
  await expect(page.getByText(/Atendida por .* Le respondí por teléfono/)).toBeVisible();
  // Se deja como estaba para que la prueba se pueda repetir con la misma base.
  await page.getByRole("button", { name: "Volver a pendiente" }).click();
  await expect(page.getByText("Respuesta pendiente otra vez")).toBeVisible();
});
