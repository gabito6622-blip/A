// Pasos comunes a todos los manuales (entrar, «?», Mi cuenta, Salir) y la página «Manual de mi
// puesto» dentro de la app.
module.exports = async ({ paso, shot, login, newPage, settle, toTop, expect, base, MOBILE }) => {
  await paso("Pantalla de ingreso: «Correo», «Contraseña», «Ingresar» y «Olvidé mi contraseña»", async () => {
    const page = await newPage();
    await page.goto(`${base()}/`);
    await expect(page.getByLabel("Correo")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    await page.getByText("Olvidé mi contraseña").click();
    await expect(page.getByRole("button", { name: "Enviar enlace" })).toBeVisible();
    await expect(page.getByText("Te enviaremos un enlace de un solo uso, válido por 30 minutos.")).toBeVisible();
    await page.context().close();
  });

  const page = await login("recepcion.lpz@demo.local");
  await paso("Arriba: «?» abre la ayuda de la pantalla, tu correo abre «Mi cuenta» y «Salir» cierra la sesión", async () => {
    await expect(page.getByRole("button", { name: "Ayuda de esta pantalla" })).toBeVisible();
    await expect(page.getByTitle("Cerrar sesión")).toBeVisible();
    await page.getByRole("link", { name: /recepcion\.lpz@demo\.local/ }).click();
    await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  });

  await paso("Ayuda › «Manual de mi puesto» abre el manual de tu rol, con «Hoja de una página» e «Imprimir»", async () => {
    await page.locator(".sidebar").getByRole("link", { name: "Ayuda", exact: true }).click();
    await page.getByRole("link", { name: "Manual de mi puesto" }).click();
    await expect(page).toHaveURL(/\/ayuda\/manual\/recepcion$/);
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Hoja de una página" })).toBeVisible();
    await settle(page);
    await toTop(page);
    await shot("ayuda-manual", page, { height: 540 });
  });
  await page.context().close();

  await paso("Cada manual se abre en la app con todas sus capturas, y cada hoja cabe en una página A4", async () => {
    const owner = await login("propietaria@demo.local");
    const ids = ["recepcion", "caja", "odontologo", "asistente", "limpieza", "contabilidad", "gerencia", "propietaria", "portal-paciente"];
    for (const id of ids) {
      await owner.goto(`${base()}/ayuda/manual/${id}`);
      const doc = owner.locator("article.mn-doc");
      await expect(doc.locator("h1")).toBeVisible();
      await expect(doc.locator(".mn-missing"), `capturas faltantes en ${id}`).toHaveCount(0);
      const broken = await doc.locator("img").evaluateAll(async (imgs) => {
        await Promise.all(imgs.map((i) => { i.loading = "eager"; return i.decode().catch(() => null); }));
        return imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("alt"));
      });
      expect(broken, `imágenes rotas en ${id}`).toEqual([]);
      await owner.goto(`${base()}/ayuda/manual/${id}/hoja`);
      await expect(owner.locator("article.mn-doc h1")).toBeVisible();
      await owner.emulateMedia({ media: "print" });
      const pdf = await owner.pdf({ format: "A4", margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
      await owner.emulateMedia({ media: "screen" });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages, `la hoja de ${id} ocupa ${pages} páginas`).toBe(1);
    }
    await owner.context().close();
  });

  await paso("En el celular, «Ayuda» está en «Más»", async () => {
    const m = await login("recepcion.lpz@demo.local", MOBILE);
    await m.getByRole("button", { name: /^Más/ }).click();
    await expect(m.getByRole("dialog", { name: "Menú completo" }).getByRole("link", { name: "Ayuda" })).toBeVisible();
    await m.context().close();
  });
};
