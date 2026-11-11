// Pasos del manual de Caja (docs/manuales/caja.md). En el sistema, quien cobra entra con el rol
// «Recepción» (recepcion.lpz@demo.local); la gerencia anula pagos (ver gerencia.cjs).
module.exports = async ({ paso, shot, login, menu, dialog, toast, settle, toTop, mark, unmark, apiGet, expect }) => {
  const page = await login("recepcion.lpz@demo.local");

  // Un paciente ficticio con saldo pendiente para el ejemplo de cobro.
  const list = await apiGet(page, "/api/patients?limit=40");
  let patient = null;
  for (const p of list.items) {
    const acc = await apiGet(page, `/api/patients/${p.id}/account`);
    if (acc.balanceCents >= 30000) { patient = p; break; }
  }
  if (!patient) throw new Error("La semilla no tiene un paciente con saldo para el ejemplo");
  const name = `${patient.firstName} ${patient.lastName}`;

  await paso("Sin caja abierta, el cobro en efectivo pide «Abre tu caja en esta sucursal…»", async () => {
    await menu(page, "Pacientes");
    await page.getByLabel("Buscar pacientes").fill(name);
    await page.locator("tr.clickable", { hasText: name }).first().click();
    await page.getByRole("tab", { name: "Cuenta y pagos", exact: true }).click();
    await page.getByRole("button", { name: "Registrar pago" }).click();
    const d = dialog(page, "Registrar pago");
    await d.getByLabel("Monto (Bs)").fill("10");
    await d.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(d.getByRole("alert")).toContainText("Abre tu caja en esta sucursal antes de registrar cobros en efectivo");
    await d.getByRole("button", { name: "Cancelar" }).click();
  });

  await paso("Abrir la caja: Caja › «Mi caja», «Fondo inicial (Bs)» y «Abrir caja»", async () => {
    await menu(page, "Caja");
    await settle(page);
    const card = page.getByRole("region", { name: "Mi caja" }).or(page.locator(".card", { has: page.getByRole("heading", { name: "Mi caja" }) })).first();
    await card.getByLabel("Fondo inicial (Bs)").fill("200");
    await card.getByLabel("Nota (opcional)").fill("Cambio entregado por gerencia");
    await shot("caja-abrir", card);
    await card.getByRole("button", { name: "Abrir caja" }).click();
    await toast(page, "Caja abierta");
    await expect(page.getByRole("button", { name: "Cerrar caja (arqueo)" })).toBeVisible();
  });

  await paso("Cobrar en efectivo: ficha del paciente › «Cuenta y pagos» › «Registrar pago»", async () => {
    await menu(page, "Pacientes");
    await page.getByLabel("Buscar pacientes").fill(name);
    await page.locator("tr.clickable", { hasText: name }).first().click();
    await page.getByRole("tab", { name: "Cuenta y pagos", exact: true }).click();
    await page.getByRole("button", { name: "Registrar pago" }).click();
    const d = dialog(page, "Registrar pago");
    await d.getByLabel("Monto (Bs)").fill("100");
    await d.getByLabel("Medio de pago").selectOption({ label: "Efectivo" });
    await shot("pago-efectivo", d);
    await d.getByRole("button", { name: "Registrar", exact: true }).click();
    await toast(page, /Pago registrado · recibo/);
    await settle(page);
  });

  await paso("Cobrar con QR o transferencia: «N° de operación / referencia»; queda «Por verificar»", async () => {
    await page.getByRole("button", { name: "Registrar pago" }).click();
    const d = dialog(page, "Registrar pago");
    await d.getByLabel("Monto (Bs)").fill("80");
    await d.getByLabel("Medio de pago").selectOption({ label: "QR bancario" });
    await d.getByLabel("N° de operación / referencia").fill("QR-558120");
    await shot("pago-qr", d);
    await d.getByRole("button", { name: "Registrar", exact: true }).click();
    await toast(page, /queda por verificar en el banco/);
    await settle(page);
  });

  await paso("Ver los pagos en la ficha y descargar el «Recibo» en PDF", async () => {
    await expect(page.getByText("Por verificar").first()).toBeVisible();
    const recibo = page.getByRole("button", { name: /^Recibo/ }).first();
    await expect(recibo).toBeVisible();
    await toTop(page);
    await mark(recibo);
    await shot("cuenta-pagos", page, { height: 640 });
    await unmark(page);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }).catch(() => null), recibo.click()]);
    if (!dl) await expect(page.getByText("No se pudo descargar el PDF")).toHaveCount(0);
  });

  await paso("Registrar un ingreso o egreso de efectivo: «Ingreso o egreso», «Egreso», concepto, monto y motivo", async () => {
    await menu(page, "Caja");
    await settle(page);
    await page.getByRole("button", { name: "Ingreso o egreso" }).click();
    const d = dialog(page, "Ingreso o egreso de efectivo");
    await d.getByRole("button", { name: "Egreso", exact: true }).click();
    await d.getByLabel("Concepto").selectOption({ label: "Gasto menor" });
    await d.getByLabel("Monto (Bs)").fill("20");
    await d.getByLabel("Motivo").fill("Compra de agua para la sala de espera");
    await shot("caja-egreso", d);
    await d.getByRole("button", { name: "Registrar", exact: true }).click();
    await toast(page, "Egreso registrado");
    await settle(page);
  });

  await paso("Si se corta internet aparece el aviso «Sin conexión a internet»", async () => {
    await page.context().setOffline(true);
    await expect(page.getByText(/Sin conexión a internet/)).toBeVisible();
    await toTop(page);
    await shot("sin-conexion", page, { full: true, shot: { clip: { x: 0, y: 0, width: 1440, height: 420 } } });
    await page.context().setOffline(false);
    await expect(page.getByText(/Sin conexión a internet/)).toHaveCount(0, { timeout: 10_000 });
  });

  await paso("Cerrar la caja: «Cerrar caja (arqueo)», contar billetes y monedas y «Cerrar caja»", async () => {
    await page.getByRole("button", { name: "Cerrar caja (arqueo)" }).click();
    const d = page.getByRole("dialog", { name: /Cerrar caja N°/ });
    // Fondo 200 + efectivo 100 − egreso 20 = 280; contamos 270 a propósito para ver la diferencia.
    await d.getByLabel("Cantidad de billetes de Bs 200", { exact: true }).fill("1");
    await d.getByLabel("Cantidad de billetes de Bs 50", { exact: true }).fill("1");
    await d.getByLabel("Cantidad de billetes de Bs 20", { exact: true }).fill("1");
    await d.getByRole("button", { name: "Cerrar caja", exact: true }).click();
    await expect(d.getByText("Hay diferencia: explica el motivo (al menos 5 letras)")).toBeVisible();
    await d.getByLabel("Motivo de la diferencia (obligatorio)").fill("Faltan Bs 10: cambio mal entregado a un paciente");
    await page.setViewportSize({ width: 1440, height: 1500 });
    await d.locator(".dialog-body").evaluate((el) => el.scrollTo(0, 0));
    await shot("caja-cerrar", d);
    await page.setViewportSize({ width: 1440, height: 900 });
    await d.getByRole("button", { name: "Cerrar caja", exact: true }).click();
    await toast(page, "Caja cerrada");
  });

  await paso("Se abre el reporte de la caja para «Imprimir»", async () => {
    await expect(page).toHaveURL(/\/caja\/sesiones\//);
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await settle(page);
    await toTop(page);
    await shot("caja-reporte", page);
  });

  await paso("En «Mis cierres de caja» ves tus cierres y si gerencia ya los revisó", async () => {
    await menu(page, "Caja");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Mis cierres de caja" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0); // recepción no anula pagos
  });

  await page.context().close();
};
