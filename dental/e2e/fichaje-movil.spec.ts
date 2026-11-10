import { expect, test, type Page } from "@playwright/test";

// Proyecto «celular» (Pixel 7): el nombre del archivo termina en movil.spec.ts.
const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.getByRole("navigation", { name: "Navegación móvil" })).toBeVisible();
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("recepción marca entrada y salida desde el celular con el botón grande de Inicio", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|409)/.test(m.text())) errors.push(m.text()); });
  await login(page, "recepcion.eal@demo.local");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Mi asistencia" }) });
  await expect(card).toBeVisible();
  const enter = card.getByRole("button", { name: "Marcar entrada" });
  await expect(enter).toBeVisible();
  const box = await enter.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await enter.click();
  await expect(card.getByRole("status")).toContainText("Trabajando en El Alto desde las");
  await expect(page.getByText("Entrada registrada")).toBeVisible();
  // Recargar no duplica: sigue dentro
  await page.reload();
  await expect(card.getByRole("button", { name: "Marcar salida" })).toBeVisible();
  await card.getByRole("button", { name: "Marcar salida" }).click();
  await expect(card.getByRole("status")).toContainText("turno de hoy cerrado");
  await expect(card).toContainText(/Marcas de hoy: entrada \d{2}:\d{2} · salida \d{2}:\d{2}/);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  // La marca no se puede editar desde la app: solo la ve gerencia en el informe
  const me = await (await page.request.get("/api/timeclock/me")).json();
  expect(me.todayEntries.map((e: any) => e.kind)).toEqual(["in", "out"]);
  expect((await page.request.get("/api/timeclock/report")).status()).toBe(403);
  expect(errors).toEqual([]);
});

test("en el celular la gestión se ve en tarjetas, sin desborde horizontal", async ({ page }) => {
  await login(page, "propietaria@demo.local");
  for (const tab of ["rentabilidad", "gastos", "fichaje"]) {
    await page.goto(`/gestion?tab=${tab}`);
    await expect(page.getByRole("heading", { name: "Gestión", level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), `desborde en ${tab}`).toBeLessThanOrEqual(1);
  }
  await page.goto("/gestion?tab=rentabilidad");
  await expect(page.getByRole("heading", { name: "Consolidado" })).toBeVisible();
});
