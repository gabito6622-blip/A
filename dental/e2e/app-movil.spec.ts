import { expect, test } from "@playwright/test";

// Aplicación instalable (PWA) y tablas como tarjetas en el celular.
test("la app es instalable, no guarda datos de la API en el dispositivo y avisa cuando no hay conexión", async ({ page, context }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.headers()["content-type"]).toContain("manifest+json");
  const m = await manifest.json();
  expect(m.display).toBe("standalone");
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.fill("#email", "propietaria@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.getByRole("navigation", { name: "Navegación móvil" })).toBeVisible();
  await page.goto("/pacientes");
  await expect(page.locator("tbody tr").first()).toBeVisible();

  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) out.push(...(await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname));
    return out;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((u) => u.startsWith("/api/"))).toEqual([]);

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Sin conexión a internet" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".offline-banner")).toHaveCount(0);
});

test("en el celular, las órdenes de laboratorio se ven como tarjetas con etiquetas y sin desborde", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "propietaria@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.getByRole("navigation", { name: "Navegación móvil" })).toBeVisible();
  await page.goto("/laboratorio");
  const cell = page.locator("table.cards-sm tbody td[data-label='Trabajo']").first();
  await expect(cell).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.goto("/inventario");
  await expect(page.locator("table.cards-sm tbody tr").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
