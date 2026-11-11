// Pasos del manual de la dueña o dueño (docs/manuales/propietaria.md), con propietaria@demo.local.
module.exports = async ({ paso, shot, login, menu, dialog, toast, settle, toTop, expect }) => {
  const page = await login("propietaria@demo.local");
  const steps = page.getByRole("region", { name: "Primeros pasos" });

  await paso("Al entrar ves «Primeros pasos» y el resumen del mes por sucursal", async () => {
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("progressbar")).toBeVisible();
    await toTop(page);
    await shot("propietaria-inicio", page, { full: true, height: 640 });
  });

  await paso("Cada paso de «Primeros pasos» tiene un botón a la pantalla exacta", async () => {
    const step = steps.locator('[data-step="procedures"]');
    await step.getByRole("link", { name: "Abrir Configuración › Prestaciones" }).click();
    await expect(page.getByRole("tab", { name: "Prestaciones", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  await paso("Precios: Configuración › «Prestaciones» › «Editar» › «Precio (Bs)» › «Guardar»", async () => {
    await page.locator("tr", { hasText: "Blanqueamiento en consultorio" }).getByRole("button", { name: "Editar" }).click();
    const d = dialog(page, "Editar Blanqueamiento en consultorio");
    await d.getByLabel("Precio (Bs)").fill("1350,00");
    await shot("prestacion-precio", d);
    await d.getByRole("button", { name: "Guardar", exact: true }).click();
    await toast(page, "Prestación actualizada");
  });

  await paso("Consentimientos: Configuración › «Consentimientos» con «Nueva versión»", async () => {
    await page.getByRole("tab", { name: "Consentimientos", exact: true }).click();
    await expect(page.getByRole("button", { name: /Nueva versión/ }).first()).toBeVisible();
  });

  await paso("Seguridad: Configuración › «Seguridad» › «Marcar recomendados» › «Guardar política»", async () => {
    await page.getByRole("tab", { name: "Seguridad", exact: true }).click();
    await page.getByRole("button", { name: "Marcar recomendados" }).click();
    await expect(page.getByRole("button", { name: "Guardar política" })).toBeVisible();
    await shot("seguridad-politica", page.locator(".card", { has: page.getByRole("button", { name: "Guardar política" }) }).first(), { fit: true });
    // No se guarda: exigiría la verificación en dos pasos a la gerencia y a contabilidad en el resto del recorrido.
  });

  await paso("Mi cuenta: verificación en dos pasos con «Activar»", async () => {
    await page.getByRole("link", { name: /propietaria@demo\.local/ }).click();
    await expect(page.getByRole("button", { name: "Activar" })).toBeVisible();
    await shot("mi-cuenta", page.locator(".card", { has: page.getByRole("button", { name: "Activar" }) }).first(), { fit: true });
    await page.getByRole("button", { name: "Activar" }).click();
    await page.getByLabel("Confirma tu contraseña").fill("Demo2026dental");
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar y activar" })).toBeVisible();
    await expect(page.getByText(/¿No puedes escanear\? Ingresa esta clave/)).toBeVisible();
    // No se confirma: la demo no tiene el celular con la app.
  });

  await paso("Importar datos: elegir qué traer, «Descargar plantilla», «Revisar» e «Importar»", async () => {
    await menu(page, "Importar datos");
    await settle(page);
    await expect(page.getByRole("button", { name: /Pacientes/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Descargar plantilla" })).toBeVisible();
    await toTop(page);
    await shot("importar", page);
  });

  await paso("Ver cómo va la clínica: Inicio con «Rango libre» y Gestión › «Rentabilidad»", async () => {
    await menu(page, "Inicio");
    await page.getByRole("button", { name: "Rango libre" }).click();
    await expect(page.getByLabel("Desde").first()).toBeVisible();
    await menu(page, "Configuración");
    await expect(page.getByRole("tab", { name: "Auditoría", exact: true })).toBeVisible();
    await menu(page, "Gestión");
    await expect(page.getByRole("tab", { name: "Rentabilidad", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  await paso("La dueña no registra limpieza ni firma evoluciones (salvo que también atienda)", async () => {
    await menu(page, "Bioseguridad");
    await expect(page.getByRole("button", { name: "Registrar ciclo" })).toHaveCount(0);
  });

  await page.context().close();
};
