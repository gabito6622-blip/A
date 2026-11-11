// Pasos del manual de Contabilidad (docs/manuales/contabilidad.md), con contabilidad@demo.local.
const path = require("node:path");

module.exports = async ({ paso, shot, login, menu, dialog, toast, settle, toTop, mark, unmark, expect }) => {
  const page = await login("contabilidad@demo.local");

  await paso("Al entrar ves el Inicio con cobrado, producción, cuentas por cobrar y la comparación por sucursal", async () => {
    await expect(page.getByText("Cobrado (confirmado)")).toBeVisible();
    await expect(page.getByText("Cuentas por cobrar").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Primeros pasos" })).toHaveCount(0);
    await toTop(page);
    await shot("contabilidad-inicio", page, { full: true, height: 600 });

  });

  await paso("Caja › «Pagos por verificar en el banco»: «Confirmar» lo que viste en el banco", async () => {
    await menu(page, "Caja");
    await settle(page);
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "Pagos por verificar en el banco" }) });
    await expect(card.getByRole("button", { name: "Confirmar" }).first()).toBeVisible();
    await shot("verificar-pagos", card, { fit: true, maxHeight: 440 });
    await card.getByRole("button", { name: "Confirmar" }).first().click();
    await toast(page, "Pago confirmado");
  });

  await paso("«Rechazar» con el motivo si el pago no llegó", async () => {
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "Pagos por verificar en el banco" }) });
    await card.getByRole("button", { name: "Rechazar" }).first().click();
    const d = dialog(page, "Rechazar pago");
    await d.getByLabel("Motivo del rechazo").fill("No figura en el extracto bancario");
    await d.getByRole("button", { name: "Rechazar", exact: true }).click();
    await toast(page, "Pago rechazado");
  });

  await paso("Revisar un cierre de caja: «Cierres de caja» › N° › «Marcar revisada»", async () => {
    const hist = page.locator(".card", { has: page.getByRole("heading", { name: "Cierres de caja" }) });
    const row = hist.locator("tr", { hasText: "Pendiente" }).first();
    await row.getByRole("link").first().click();
    await page.getByRole("button", { name: "Marcar revisada" }).click();
    const d = page.getByRole("dialog", { name: /Revisar cierre N°/ });
    const note = d.getByLabel(/Qué se verificó \(obligatorio\)|Nota \(opcional\)/);
    await note.fill("Contado y comparado con los recibos del día");
    await shot("caja-revisar", d);
    await d.getByRole("button", { name: "Marcar revisada" }).click();
    await toast(page, "Cierre revisado");
  });

  await paso("Conciliación › «Subir extracto»: elegir el archivo, revisar e «Importar N movimientos»", async () => {
    await menu(page, "Conciliación");
    await settle(page);
    await page.getByLabel("Archivo del extracto").setInputFiles(path.join(__dirname, "../../docs/extracto-ejemplo.csv"));
    const imp = page.getByRole("button", { name: /^Importar \d+ movimientos/ });
    await expect(imp).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Cuenta o banco del extracto").fill("Banco Ficticio, cuenta 1-000000-0");
    await shot("conciliacion-subir", page.locator(".card", { has: page.getByRole("heading", { name: "Subir extracto" }) }).first(), { fit: true, maxHeight: 760 });
    await imp.click();
    await settle(page);
  });

  await paso("«Por conciliar»: «Confirmar» la sugerencia que corresponde o «Descartar»", async () => {
    await page.getByRole("tab", { name: "Por conciliar", exact: true }).click();
    await settle(page);
    await expect(page.getByRole("button", { name: "Descartar" }).first()).toBeVisible();
    await toTop(page);
    await shot("conciliacion-por-conciliar", page, { height: 600 });
  });

  await paso("Reportes: «Desde», «Hasta» y las descargas en Excel", async () => {
    await menu(page, "Reportes");
    await settle(page);
    await expect(page.getByLabel("Desde").first()).toBeVisible();
    for (const name of ["Pagos (Excel)", "Panel por sucursal (Excel)", "Producción por profesional (Excel)", "Cuentas por cobrar (Excel)"]) {
      await expect(page.getByRole("link", { name }).first()).toBeVisible();
    }
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Cuentas por cobrar (Excel)" }).first().click()]);
    expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
    await shot("reportes", page.locator(".card", { has: page.getByRole("link", { name: "Pagos (Excel)" }) }).first(), { fit: true });
  });

  await paso("Gestión › «Gastos» › «Registrar gasto»: categoría, descripción, monto y fecha", async () => {
    await menu(page, "Gestión");
    await page.getByRole("tab", { name: "Gastos", exact: true }).click();
    await page.getByRole("button", { name: "Registrar gasto" }).click();
    const d = dialog(page, "Registrar gasto");
    await d.getByLabel("Descripción").fill("Material de escritorio");
    await d.getByLabel("Monto (Bs)").fill("85,50");
    await shot("gasto-registrar", d);
    await d.getByRole("button", { name: "Registrar gasto" }).click();
    await toast(page, "Gasto registrado");
    await expect(page.getByRole("button", { name: "Nuevo gasto fijo" })).toBeVisible();
  });

  await paso("Convenios: empresas con convenio y su estado de cuenta", async () => {
    await menu(page, "Convenios");
    await settle(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Convenios/);
  });

  await paso("Honorarios › «Liquidaciones»: «Preparar borradores del período» y revisar cada borrador (lo cierra la gerencia)", async () => {
    await menu(page, "Honorarios");
    await settle(page);
    await page.getByRole("tab", { name: "Liquidaciones", exact: true }).click().catch(() => {});
    await page.getByRole("button", { name: "Preparar borradores del período" }).click();
    await settle(page);
    await shot("honorarios-liquidaciones", page.locator(".card", { has: page.getByRole("columnheader", { name: "Profesional" }) }).first(), { fit: true, maxHeight: 520 });
    // Contabilidad prepara y revisa; cerrar la liquidación lo hace la gerencia o la dueña.
    const draft = page.locator("tr", { hasText: "Borrador" }).first();
    await draft.getByRole("link").first().click();
    await expect(page.getByText("Borrador: los montos se recalculan hasta que administración cierre la liquidación.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar liquidación" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Excel" }).or(page.getByRole("button", { name: "Excel" })).first()).toBeVisible();
  });

  await page.context().close();
};
