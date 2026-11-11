// Manuales por puesto dentro de la app: cada rol abre desde Ayuda «Manual de mi puesto» y ve el
// manual de su rol (con capturas, índice, hoja de una página e «Imprimir»), sin datos de la clínica.
import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}

const ROLES: { email: string; title: string; id: string; others: number }[] = [
  { email: "propietaria@demo.local", title: "Manual de la dueña o el dueño", id: "propietaria", others: 9 },
  { email: "gerente@demo.local", title: "Manual de Gerencia", id: "gerencia", others: 9 },
  { email: "recepcion.lpz@demo.local", title: "Manual de Recepción", id: "recepcion", others: 3 },
  { email: "dr.mendoza@demo.local", title: "Manual del Odontólogo", id: "odontologo", others: 2 },
  { email: "asistente@demo.local", title: "Manual de Asistente dental", id: "asistente", others: 2 },
  { email: "contabilidad@demo.local", title: "Manual de Contabilidad", id: "contabilidad", others: 2 },
  { email: "limpieza.lpz@demo.local", title: "Manual de Limpieza y apoyo", id: "limpieza", others: 0 },
];

for (const r of ROLES) {
  test(`${r.email} abre «Manual de mi puesto» y ve el suyo`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" && !/status of (400|401|409)/.test(m.text())) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, r.email);
    await page.locator(".sidebar").getByRole("link", { name: "Ayuda", exact: true }).click();
    await page.getByRole("link", { name: "Manual de mi puesto" }).click();
    await expect(page).toHaveURL(new RegExp(`/ayuda/manual/${r.id}$`));
    const doc = page.getByRole("article", { name: r.title });
    await expect(doc.getByRole("heading", { level: 1, name: r.title })).toBeVisible();
    await expect(page.getByText("Manual de tu puesto")).toBeVisible();
    // Índice, capturas cargadas y ningún espacio roto
    await expect(page.getByRole("navigation", { name: "Contenido del manual" }).getByRole("link").first()).toBeVisible();
    const img = doc.locator("figure img").first();
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(doc.locator(".mn-missing")).toHaveCount(0);
    // Contenido estático: sin datos de la clínica
    await expect(doc).not.toContainText("Sonrisa Andina");
    // Selector de otros manuales solo para quien lo necesita
    const pick = page.getByLabel("Manual", { exact: true });
    if (r.others) await expect(pick.locator("option")).toHaveCount(r.others);
    else await expect(pick).toHaveCount(0);
    // Hoja de una página e «Imprimir»
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await page.getByRole("tab", { name: "Hoja de una página" }).click();
    await expect(page).toHaveURL(new RegExp(`/ayuda/manual/${r.id}/hoja$`));
    await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("hoja rápida");
    await page.getByRole("button", { name: "Imprimir" }).evaluate(() => { (window as any).print = () => { (window as any).__printed = true; }; });
    await page.getByRole("button", { name: "Imprimir" }).click();
    expect(await page.evaluate(() => (window as any).__printed)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("recepción no abre el manual de otro puesto que no le corresponde y vuelve al suyo", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  await page.goto("/ayuda/manual/gerencia");
  await expect(page).toHaveURL(/\/ayuda\/manual\/recepcion$/);
  // Sí puede abrir el de caja (también es su rol) y saltar entre manuales con los enlaces
  await page.getByLabel("Manual", { exact: true }).selectOption("caja");
  await expect(page.getByRole("heading", { level: 1, name: "Manual de Caja" })).toBeVisible();
  await page.getByRole("article").getByRole("link", { name: "manual de Recepción" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Manual de Recepción" })).toBeVisible();
});

test("en el celular el manual se lee sin desborde horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.fill("#email", "limpieza.lpz@demo.local");
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await page.locator(".bottom-nav").getByRole("link", { name: /Ayuda/ }).click();
  await page.getByRole("link", { name: "Manual de mi puesto" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Manual de Limpieza y apoyo" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
