import { expect, test, type Page } from "@playwright/test";

// B-090: el ingreso fallido no revela si el correo existe, y gerencia desbloquea a quien quedó
// bloqueado por intentos fallidos desde Configuración → Personal. Datos de la semilla demo.
const PW = "Demo2026dental";

async function tryLogin(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", password);
  await page.click('button:has-text("Ingresar")');
}

test("mismo mensaje para un correo existente y uno inexistente; la propietaria desbloquea a una recepcionista", async ({ page, browser }) => {
  await tryLogin(page, "no-existe@demo.local", "Cualquiera123");
  const ghost = (await page.getByRole("alert").innerText()).trim();
  await tryLogin(page, "recepcion.eal@demo.local", "Cualquiera123");
  const real = (await page.getByRole("alert").innerText()).trim();
  expect(real).toBe(ghost);
  expect(ghost).toMatch(/Correo o contraseña incorrectos/);

  // Cuatro intentos más (5 en total) desde esta red: queda bloqueada, aun con la contraseña correcta.
  for (let i = 0; i < 4; i++) {
    const r = await page.request.post("/api/auth/login", { data: { email: "recepcion.eal@demo.local", password: "Cualquiera123" } });
    expect(r.status()).toBe(401);
  }
  await tryLogin(page, "recepcion.eal@demo.local", PW);
  await expect(page.getByRole("alert")).toHaveText(ghost);

  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await tryLogin(owner, "propietaria@demo.local", PW);
  await expect(owner.locator(".sidebar")).toBeVisible();
  await owner.goto("/configuracion");
  await owner.getByRole("tab", { name: "Personal" }).click();
  const row = owner.locator("tr", { hasText: "recepcion.eal@demo.local" });
  await expect(row.getByText("Ingreso bloqueado")).toBeVisible();
  await row.getByRole("button", { name: "Desbloquear" }).click();
  await owner.getByRole("dialog", { name: "Desbloquear ingreso" }).getByRole("button", { name: "Desbloquear" }).click();
  await expect(owner.getByText("Recepción EAL ya puede ingresar")).toBeVisible();
  await expect(row.getByText("Ingreso bloqueado")).toHaveCount(0);
  await ctx.close();

  await tryLogin(page, "recepcion.eal@demo.local", PW);
  await expect(page.locator(".sidebar")).toBeVisible();
});
