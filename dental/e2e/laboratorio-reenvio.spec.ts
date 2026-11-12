// B-111 en el navegador: devolver un trabajo para ajuste y registrar su llegada con el costo adicional
// que cobró el laboratorio; la orden muestra el costo total y lo pendiente de pago.
import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}

test("laboratorio: reenvío con costo adicional", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text()); });
  await login(page, "dr.mendoza@demo.local");

  // Orden ficticia recibida, creada por la API con la misma sesión (lo de pantalla ya lo cubre laboratorio.spec)
  const number = await page.evaluate(async () => {
    const me = await (await fetch("/api/auth/me")).json();
    const post = async (url: string, body: unknown) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": me.csrfToken }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(`${url}: ${JSON.stringify(j)}`);
      return j;
    };
    const labs = await (await fetch("/api/lab/labs")).json();
    const pats = await (await fetch("/api/patients?q=Mamani")).json();
    const patient = (Array.isArray(pats) ? pats : pats.items ?? pats.rows ?? pats.patients)[0];
    const branch = me.branches.find((b: any) => /La Paz/.test(b.name)) ?? me.branches[0];
    const o = await post("/api/lab/orders", { patientId: patient.id, labId: labs[0].id, dentistId: me.user.id, branchId: branch.id, workType: "crown", teeth: [22], shade: "A3", impression: "digital", material: "Zirconio" });
    await post(`/api/lab/orders/${o.id}/transition`, { to: "sent" });
    await post(`/api/lab/orders/${o.id}/transition`, { to: "received", costCents: 30000 });
    return o.number as number;
  });

  await page.click('a:has-text("Laboratorio")');
  await page.locator("tbody tr", { hasText: `${number}` }).filter({ hasText: "corona 22" }).first().click();
  const d = page.getByRole("dialog", { name: `Orden de laboratorio N° ${number}` });
  await d.getByRole("button", { name: "Devolver para ajuste" }).click();
  await d.getByLabel("Motivo del ajuste o reenvío").fill("El color no coincide");
  await d.getByRole("button", { name: "Confirmar" }).click();
  await expect(d.locator(".badge", { hasText: /ajuste/i })).toBeVisible();

  await d.getByRole("button", { name: "Registrar llegada" }).click();
  await d.getByLabel(/Costo adicional del reenvío/).fill("50");
  await d.getByLabel(/Motivo del costo adicional/).fill("Repetición por color");
  await d.getByRole("button", { name: "Confirmar" }).click();
  await expect(d).toContainText("por reenvío");
  await expect(d).toContainText("Costos adicionales");
  await expect(d).toContainText("Repetición por color");
  expect(errors).toEqual([]);
});
