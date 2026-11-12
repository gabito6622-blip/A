// v0.9: textos de certificados por clínica (B-075) y anular una transferencia en tránsito (B-072).
import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("certificados: la gerencia guarda una versión propia del texto y vuelve al original", async ({ page }) => {
  await login(page, "gerente@demo.local");
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/settings?tab=certificates");
  const row = page.locator("tbody tr", { hasText: "Certificado de atención odontológica" });
  await expect(row).toContainText("Texto base");
  await row.getByRole("button", { name: /Editar/ }).click();
  const dlg = page.getByRole("dialog");
  // Un marcador inventado se rechaza con un mensaje claro
  const body = dlg.locator("textarea");
  const original = await body.inputValue();
  await body.fill(`${original} {firma}`);
  await dlg.getByRole("button", { name: "Guardar versión nueva" }).click();
  await expect(dlg.getByRole("alert")).toContainText("{firma}");
  await body.fill(original.replace("Se extiende el presente certificado", "Se emite este certificado"));
  await dlg.getByLabel("Nota del cambio (opcional)").fill("Prueba e2e");
  await dlg.getByRole("button", { name: "Guardar versión nueva" }).click();
  await expect(dlg).toBeHidden();
  await expect(row).toContainText("Propio de la clínica");
  await row.getByRole("button", { name: /Historial/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Nota: Prueba e2e");
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  // Volver al original (confirmación con el diálogo propio, no window.prompt)
  await row.getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Volver al texto original" }).click();
  await page.getByRole("button", { name: "Volver al original" }).click();
  await expect(row).toContainText("Texto base");
  expect(errors).toEqual([]);
});

test("inventario: anular una transferencia en tránsito con motivo (la demo trae una de Sur a La Paz)", async ({ page }) => {
  await login(page, "gerente@demo.local");
  await page.goto("/inventory");
  await page.getByRole("tab", { name: /Transferencias/ }).click();
  const btn = page.getByRole("button", { name: /Anular transferencia N°/ }).first();
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); // celular primero: botón de 44 px
  await btn.click();
  const ask = page.getByRole("dialog", { name: "Anular transferencia" });
  await ask.getByLabel("Motivo").fill("Se envió por error (e2e)");
  await ask.getByRole("button", { name: "Anular transferencia" }).click();
  await expect(page.getByText("Transferencia anulada: el stock volvió al origen")).toBeVisible();
  const hist = page.locator("section.card", { hasText: "Recibidas y anuladas" });
  await expect(hist).toContainText("Se envió por error (e2e)");
});
