// Puesta en marcha: el propietario sigue un paso de «Primeros pasos», importa un Excel de citas con
// un error y ve el reporte, y recepción abre su ayuda (también con el botón «?»).
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
const consoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (400|401|409)/.test(m.text())) errors.push(m.text()); });
  return errors;
};

test("el propietario sigue un paso de la lista y se marca solo", async ({ page }) => {
  const errors = consoleErrors(page);
  await login(page, "propietaria@demo.local");
  const card = page.getByRole("region", { name: "Primeros pasos" });
  await expect(card).toBeVisible();
  const step = card.locator('[data-step="procedures"]');
  await expect(step).toContainText("Pendiente");
  await expect(step).toContainText("18 de 18 prestaciones siguen con el precio de ejemplo");
  const before = Number((await card.getByRole("progressbar").getAttribute("aria-valuenow")) ?? 0);

  await step.getByRole("link", { name: "Abrir Configuración › Prestaciones" }).click();
  await expect(page.getByRole("tab", { name: "Prestaciones" })).toHaveAttribute("aria-selected", "true");
  await page.locator("tr", { hasText: "Blanqueamiento en consultorio" }).getByRole("button", { name: "Editar" }).click();
  const dlg = page.getByRole("dialog", { name: "Editar Blanqueamiento en consultorio" });
  await dlg.getByLabel("Precio (Bs)").fill("1350,00");
  await dlg.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Prestación actualizada")).toBeVisible();

  await page.getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(step).toContainText("Listo");
  await expect(step).toContainText("17 de 18 prestaciones siguen con el precio de ejemplo");
  await expect.poll(async () => Number(await card.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("importar un Excel de citas con un error: revisión, reporte descargable e importación confirmada", async ({ page }) => {
  const errors = consoleErrors(page);
  await login(page, "propietaria@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { "x-csrf-token": me.csrfToken };
  // Paciente nuevo (sin citas) y un horario libre real de la agenda: la prueba no depende de la fecha.
  const ci = String(70_000_000 + Math.floor(Math.random() * 9_000_000));
  const pat = await (await page.request.post("/api/patients", { headers, data: { firstName: "Importada", lastName: "Prueba E2E", documentType: "CI", documentNumber: ci, allowDuplicate: true } })).json();
  expect(pat.id).toBeTruthy();
  const search = await (await page.request.get("/api/availability/search?days=21&limit=5&durationMin=30")).json();
  const slot = search.slots[0];
  expect(slot).toBeTruthy();
  const branch = me.branches.find((b: any) => b.id === slot.branchId);
  const at = new Date(slot.startsAt);
  const date = at.toLocaleDateString("en-GB", { timeZone: "America/La_Paz" }); // dd/mm/aaaa
  const time = at.toLocaleTimeString("en-GB", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit" });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Citas");
  ws.addRow(["Fecha", "Hora", "Duración (min)", "Profesional", "Sucursal", "CI del paciente", "Motivo"]);
  ws.addRow([date, time, 30, slot.dentistName, branch.code, ci, "Control (importada)"]);
  ws.addRow([date, time, 30, "Dr. Inexistente Pérez", branch.code, ci, "Error a propósito"]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.getByRole("link", { name: "Importar datos" }).click();
  await page.getByRole("button", { name: /Citas futuras/ }).click();
  await expect(page.getByRole("heading", { name: "1. Elige el archivo de citas futuras" })).toBeVisible();
  await page.getByLabel("Archivo de Excel").setInputFiles({ name: "citas.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await expect(page.getByText("citas.xlsx")).toBeVisible();
  await expect(page.getByLabel("Profesional *")).toHaveValue("4");
  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  const sum = page.locator(".ob-sum");
  await expect(sum).toContainText("Se crearán1");
  await expect(sum).toContainText("Errores1");
  await expect(page.locator("tr", { hasText: "Fila 3" })).toContainText("No hay un profesional activo llamado «Dr. Inexistente Pérez»");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar reporte (Excel)" }).click()]);
  const rep = new ExcelJS.Workbook();
  await rep.xlsx.load(await (await import("node:fs/promises")).readFile((await download.path())!) as unknown as ArrayBuffer);
  const rws = rep.getWorksheet("Reporte")!;
  expect(String(rws.getRow(3).getCell(2).value)).toBe("Error");
  expect(String(rws.getRow(3).getCell(3).value)).toMatch(/No hay un profesional activo/);

  await page.getByRole("button", { name: "Importar 1 cita" }).click();
  const ask = page.getByRole("dialog", { name: "Importar 1 cita" });
  await expect(ask).toContainText("Se crearán exactamente 1 cita");
  await ask.getByRole("button", { name: "Importar 1 cita" }).click();
  await expect(page.getByText("4. Importación lista: se creó 1 cita.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Importaciones realizadas" }).locator("tr", { hasText: "Citas futuras" })).toBeVisible();
  // La cita quedó en la agenda del paciente
  const appts = await (await page.request.get(`/api/appointments?from=${encodeURIComponent(new Date(at.getTime() - 60_000).toISOString())}&to=${encodeURIComponent(new Date(at.getTime() + 3_600_000).toISOString())}&patientId=${pat.id}`)).json();
  expect(appts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("recepción abre la ayuda de su rol, busca y usa el botón «?» de la pantalla", async ({ page }) => {
  const errors = consoleErrors(page);
  await login(page, "recepcion.lpz@demo.local");
  await page.getByRole("link", { name: "Ayuda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ayuda", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Recepción (tu rol)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("article", { name: "Agendar una cita" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Abrir y cerrar mi caja" })).toContainText("«Cerrar caja (arqueo)»");
  await page.getByRole("article", { name: "Cobrar (efectivo, QR o transferencia)" }).getByRole("link", { name: "Ir a Pacientes" }).click();
  await expect(page.getByRole("heading", { name: "Pacientes", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Ayuda", exact: true }).click();
  await page.getByLabel("Buscar en la ayuda").fill("esterilizacion");
  await expect(page.getByRole("article", { name: "Registrar un ciclo de esterilización" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Agendar una cita" })).toHaveCount(0);

  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.getByRole("button", { name: "Ayuda de esta pantalla" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("article", { name: "Abrir y cerrar mi caja" })).toBeVisible();
  await expect(drawer.getByRole("article", { name: "Verificar pagos con QR o transferencia" })).toHaveCount(0); // no es de su rol
  await drawer.getByRole("link", { name: "Ver toda la ayuda" }).click();
  await expect(page.getByRole("heading", { name: "Ayuda", level: 1 })).toBeVisible();
  // Recepción no ve los primeros pasos ni la importación
  await page.getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page.getByRole("region", { name: "Primeros pasos" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Importar datos" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
