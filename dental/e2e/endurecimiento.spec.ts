import { expect, test } from "@playwright/test";

// Equipo Q: cabeceras de seguridad de la página y API cerrada sin sesión, vistas desde el navegador.
test("la aplicación envía cabeceras de seguridad y la API del personal exige sesión", async ({ page, request }) => {
  const res = await page.goto("/");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("script-src 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  for (const url of ["/api/patients", "/api/reports/payments.xlsx", "/api/audit", "/api/patients/export.xlsx"]) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(401);
    expect(r.headers()["cache-control"]).toBe("no-store");
  }
  // Un cuerpo grande sin sesión se rechaza antes de leerlo.
  const big = await request.post("/api/patients", { data: { firstName: "x".repeat(3 * 1024 * 1024) } });
  expect(big.status()).toBe(401);
});
