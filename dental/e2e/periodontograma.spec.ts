import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
const cell = (page: Page, tooth: number, site: string, kind = "pd") => page.locator(`[data-tooth="${tooth}"][data-site="${site}"][data-kind="${kind}"]`);

test.describe.configure({ mode: "serial" });

test("periodontograma: un cuadrante solo con el teclado, avance automático, índices sobre lo medido y cierre", async ({ page }) => {
  await login(page, "dra.vargas@demo.local");
  const errors: string[] = []; // después del login (antes, /api/auth/me responde 401 a propósito)
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Perio Demostración");
  await page.locator("tbody tr", { hasText: "Perio Demostración" }).click();
  await page.getByRole("tab", { name: "Periodontograma" }).click();
  await expect(page.locator("tbody tr", { hasText: "Cerrada" })).toHaveCount(2);

  await page.getByRole("button", { name: "Nueva exploración" }).click();
  const dlg = page.getByRole("dialog", { name: "Nueva exploración periodontal" });
  await expect(dlg.getByRole("radio", { name: /A partir de la anterior/ })).toBeChecked();
  await dlg.getByRole("button", { name: "Iniciar" }).click();

  const grid = page.getByTestId("perio-grid");
  await expect(grid).toBeFocused();
  // Se copiaron ausentes (18) e implantes (46) de la anterior; el recorrido salta el 18
  await expect(page.getByTestId("perio-order")).toContainText("18→28 vestibular · 28→18 palatino · 48→38 lingual · 38→48 vestibular");
  await expect(page.getByRole("columnheader", { name: "Pieza 18, ausente" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Pieza 46, implante" })).toBeVisible();
  await expect(page.getByTestId("perio-active")).toContainText("17 · vestibular · DV · Sondaje");

  // Fuera de rango: + y 7 = 17 mm → se rechaza junto a la grilla y el foco no avanza
  await page.keyboard.press("+");
  await page.keyboard.press("7");
  await expect(page.getByTestId("perio-msg")).toContainText("17 mm supera el máximo de 15 mm. No se registró.");
  await expect(page.getByTestId("perio-active")).toContainText("17 · vestibular · DV");
  await expect(cell(page, 17, "DB")).toHaveText("");

  // Cuadrante 1 por vestibular (17 → 11): DV, V, MV; B marca sangrado en el sitio recién sondeado (MV)
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("3");
    await page.keyboard.press("2");
    await page.keyboard.press("4");
    await page.keyboard.press("b");
  }
  await expect(page.getByTestId("perio-active")).toContainText("21 · vestibular · MV · Sondaje");
  await expect(cell(page, 16, "DB")).toHaveText("3");
  await expect(cell(page, 16, "B")).toHaveText("2");
  await expect(cell(page, 16, "MB")).toHaveText("4");
  await expect(cell(page, 16, "MB").locator(".flag-bop")).toHaveCount(1);

  // Las flechas mueven el foco y no cambian valores
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("perio-active")).toContainText("11 · vestibular · MV");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(cell(page, 11, "MB")).toHaveText("4");
  await expect(cell(page, 11, "B")).toHaveText("2");

  // Índices sobre los 21 sitios medidos (no sobre 192) con el denominador visible
  await expect(page.getByTestId("ix-bleeding")).toContainText("33,3 %");
  await expect(page.getByTestId("ix-bleeding")).toContainText("7 de 21 sitios medidos");
  await expect(page.getByTestId("ix-pd4")).toContainText("7 sitios");
  await expect(page.getByTestId("ix-pd4")).toContainText("en 7 dientes");
  await expect(page.getByTestId("perio-save")).toContainText("Guardado", { timeout: 10_000 });

  // Cerrar con confirmación → queda congelada
  await page.getByRole("button", { name: "Cerrar exploración" }).click();
  const close = page.getByRole("dialog", { name: "Cerrar exploración" });
  await close.getByLabel("Nota de cierre (opcional)").fill("Control en 3 meses");
  await close.getByRole("button", { name: "Cerrar y congelar" }).click();
  await expect(page.getByRole("heading", { name: "Exploración cerrada" })).toBeVisible();
  await expect(page.getByTestId("ix-bleeding")).toContainText("7 de 21 sitios medidos");
  // Solo lectura: un dígito no cambia nada y lo explica
  await page.getByTestId("perio-grid").focus();
  await page.keyboard.press("9");
  await expect(page.getByTestId("perio-msg")).toContainText("solo lectura");

  // Comparación con la anterior y resumen para el paciente
  await page.getByRole("button", { name: "Volver a las exploraciones" }).click();
  await expect(page.locator("tbody tr", { hasText: "Cerrada" })).toHaveCount(3);
  await page.getByRole("button", { name: "Comparar" }).click();
  await expect(page.getByTestId("perio-deltas")).toContainText("Sangrado al sondaje");
  await expect(page.getByTestId("perio-cmp-counts")).toContainText("Mejoró");
  await page.getByRole("button", { name: "Volver a las exploraciones" }).click();
  await page.getByRole("button", { name: "Resumen para el paciente" }).click();
  const sum = page.getByRole("dialog", { name: "Resumen para el paciente" });
  await expect(sum.getByText("Este resumen no es un diagnóstico.")).toBeVisible();
  await expect(sum).toContainText("33,3 %");
  expect(errors).toEqual([]);
});
