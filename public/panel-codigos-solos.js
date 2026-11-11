// Panel de códigos → "📩 Los clientes de tus revendedores ven su código solos".
// El dueño lo permite o no (apagado por defecto). Si lo apaga, ningún link de cobro muestra códigos,
// aunque el revendedor tenga su interruptor prendido. Muestra solo totales: nada de tokens ni clientes.
import { api, esc, toast } from "/common.js";

let RENDER = async () => {};

/** Recuadro para el Panel de códigos (solo dueño; el servidor responde 403 a los demás). */
export async function selfCodesCard(render) {
  RENDER = render;
  const d = await api("GET", "/api/admin/self-codes").catch(() => null);
  if (!d) return "";
  return `<section class="card" aria-labelledby="pcsT"><h2 id="pcsT">📩 Que vean su código solos <small>en el link de cobro de cada cliente</small></h2>
    <p class="muted" style="margin:0">Los clientes de tus revendedores tocan “Ver mi código de acceso” y ven <b>solo</b> el código que llegó al correo de su cuenta (los últimos 30 minutos). Nunca ven el correo ni la contraseña. Cada revendedor decide en qué cuentas lo prende.</p>
    <label class="chk" style="min-height:44px"><input type="checkbox" id="pcsAllowed" ${d.allowed ? "checked" : ""}> Permitir que los clientes de mis revendedores vean sus códigos</label>
    <p class="muted" style="margin:0">${d.allowed ? `Este mes vieron <b>${esc(d.month)}</b> código${d.month === 1 ? "" : "s"} solos · ${d.resellers === 1 ? "1 revendedor lo prendió" : `${esc(d.resellers)} revendedores lo prendieron`}.` : "Apagado: ningún cliente ve códigos por su link, aunque su revendedor lo haya prendido."}</p></section>`;
}

if (typeof document !== "undefined") {
  document.addEventListener("change", async (ev) => {
    const el = ev.target;
    if (el?.id !== "pcsAllowed") return;
    ev.stopPropagation();
    el.disabled = true;
    try {
      const r = await api("POST", "/api/admin/self-codes", { on: el.checked });
      toast(r.allowed ? "📩 Listo: los clientes de tus revendedores pueden ver su código" : "Apagado: nadie ve códigos por su link");
      await RENDER();
    } catch (e) { el.checked = !el.checked; el.disabled = false; toast(e.message); }
  }, true);
}
