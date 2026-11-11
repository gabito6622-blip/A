// Bot de WhatsApp: contesta solo, a cualquier hora, con datos reales de la tienda.
//
// Reglas de seguridad:
// - Nunca manda contraseñas ni PIN por WhatsApp. Para eso está el link de acceso a "Mis cuentas".
// - Solo responde sobre el cliente cuyo número escribió (WhatsApp ya verificó ese número).
// - "0" o "persona" pasa la charla a un humano y el bot se calla por unas horas.
// - "BAJA" deja de mandar avisos; "ALTA" los vuelve a activar.
// - Las respuestas propias del dueño (palabras clave → texto) van antes que las automáticas.
import { localHour, reminderSettings, type GabrielStore } from "../store/index.js";

export interface BotContext {
  store: GabrielStore;
  /** URL pública de la tienda (https://…). Sin esto, el bot no puede mandar links. */
  origin?: string;
  /** Crea un link de acceso de un solo uso para el cliente. */
  loginLink: (customerId: string) => string | null;
}

export interface BotAnswer {
  replies: string[];
  /** Mandar además el QR de cobro como imagen. */
  sendQr?: boolean;
  human?: boolean;
  consent?: boolean;
  /** El bot de palabras clave no entendió el mensaje (ahí puede responder la IA). */
  unknown?: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const bs = (c: number) => "Bs " + (c / 100).toLocaleString("es-BO", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const usdText = (c: number) => `US$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const fd = (t: number) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });

const MATCH: [RegExp, string][] = [
  [/^(0|humano|persona|asesor|asesora|operador|hablar con (alguien|una persona|un humano)|atencion|ayuda humana)$/, "human"],
  [/^(baja|stop|no quiero (mas )?mensajes|cancelar avisos)$/, "optout"],
  [/^(alta|si quiero avisos|quiero avisos|activar avisos)$/, "optin"],
  [/^(1|servicios|mis servicios|vencimiento|vencimientos|cuando vence|vence)$/, "services"],
  [/^(2|precio|precios|catalogo|productos|que venden|lista)$/, "prices"],
  [/^(3|pagar|pago|como pago|como pagar|qr|cuenta bancaria|transferencia)$/, "pay"],
  [/^(4|entrar|link|acceso|mi cuenta|ingresar|contrasena|clave|mis claves|mis accesos)$/, "login"],
  [/^(5|codigo|codigos|codigo de acceso|codigo de verificacion)$/, "codes"],
  [/^(6|saldo|mi saldo|creditos)$/, "balance"],
  [/^(7|pedido|pedidos|mi pedido|mis pedidos|estado|estado de mi pedido|ya pague)$/, "orders"],
  [/^(8|clientes|mis clientes|clientes por vencer)$/, "resellerClients"],
  [/^(hola|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|menu|inicio|opciones|hey|ola)$/, "menu"],
  [/^(gracias|muchas gracias|grax|ok gracias|listo gracias|genial|perfecto|ok|okey|dale|de una)$/, "thanks"],
  [/^(renovar|quiero renovar|renovacion)$/, "renew"],
];

export function botAnswer(ctx: BotContext, phone: string, rawText: string, profileName?: string): BotAnswer {
  const s = ctx.store;
  const st = s.engine.s;
  const t = norm(rawText);
  const customer = Object.values(st.customers).find((c) => c.phone === phone);
  const store = st.settings.storeName;
  const bot = s.chats.botSettings();
  const name = (customer?.name ?? profileName ?? "").split(" ")[0];
  const shop = ctx.origin ? `${ctx.origin}/tienda/` : "";
  const words = ` ${t} `;
  const isReseller = customer?.kind === "reseller";
  // Cliente en la lista en dólares: sus precios, su saldo y sus pedidos van en US$ (nunca como si fueran Bs).
  const usdW = !!customer && s.usd.isUsd(customer.id);
  const money = (c: number) => (usdW ? usdText(c) : bs(c));

  // 1) Comandos exactos (números y palabras del menú).
  let intent = MATCH.find(([re]) => re.test(t))?.[1];
  // 2) Respuestas propias del dueño.
  if (!intent) {
    const q = (bot.quickReplies ?? []).find((r) => r.keywords.some((k) => { const n = norm(k); return !!n && words.includes(` ${n} `); }));
    if (q) return { replies: [q.answer.replaceAll("{name}", name).replaceAll("{store}", store).replaceAll("{tienda}", shop)] };
  }
  // 3) Nombre de un producto ("cuánto está netflix").
  const catalog = s.catalog.publicCatalog(customer?.id);
  const named = intent ? [] : catalog.filter((p) => {
    const n = norm(p.name);
    const key = n.split(" ").find((w) => w.length >= 4);
    return words.includes(` ${n} `) || (!!key && words.includes(` ${key} `));
  });
  if (!intent && named.length) intent = "product";
  // 4) Pistas sueltas dentro de una frase.
  intent ??= /(precio|cuanto|catalogo|costo|comprar|tienen|venden)/.test(t) ? "prices" : /(pagar|pago|qr|deposit|transfer)/.test(t) ? "pay"
    : /(codigo)/.test(t) ? "codes" : /(vence|vencimiento|renovar)/.test(t) ? "services" : /(persona|humano|asesor)/.test(t) ? "human"
    : /(pedido|comprobante)/.test(t) ? "orders" : /(saldo|recarg)/.test(t) ? "balance" : /(gracias)/.test(t) ? "thanks" : "unknown";

  const menu = () => {
    const hello = (bot.welcome || "¡Hola{name}! 👋 Soy el asistente de *{store}*. Te ayudo a cualquier hora.")
      .replace("{name}", name ? ` ${name}` : "").replace("{store}", store);
    const opts = customer
      ? ["1️⃣ Mis servicios y vencimientos", "2️⃣ Precios", "3️⃣ Cómo pagar", "4️⃣ Entrar a mi cuenta (ver claves)", "5️⃣ Códigos de verificación", "6️⃣ Mi saldo", "7️⃣ Mis pedidos",
        ...(isReseller ? ["8️⃣ Mis clientes por vencer"] : []), "0️⃣ Hablar con una persona"]
      : ["2️⃣ Precios", "3️⃣ Cómo pagar", "0️⃣ Hablar con una persona"];
    return `${hello}\n\nRespondé con un número:\n${opts.join("\n")}${!customer && shop ? `\n\n🛒 Tienda: ${shop}` : ""}`;
  };

  const notClient = `Todavía no tengo compras a tu número. Podés comprar en la tienda${shop ? `: ${shop}` : ""} o escribir *0* para hablar con una persona.`;

  switch (intent) {
    case "human": {
      const hh = bot.humanHours;
      const h = hh ? localHour(s.engine.now(), reminderSettings(s.engine).timeZone) : 0;
      const closed = !!hh && (h < hh.from || h >= hh.to);
      return {
        replies: [closed
          ? `Listo${name ? `, ${name}` : ""}. Ahora estamos fuera del horario de atención (de ${hh!.from}:00 a ${hh!.to}:00). Dejá tu consulta acá y te responde una persona apenas abramos. 🙌\n\nMientras tanto, escribí *menu* para ver lo que el bot puede resolver ya.`
          : `Listo${name ? `, ${name}` : ""}. Le aviso a una persona del equipo y te responde por acá apenas pueda. 🙌`],
        human: true,
      };
    }
    case "thanks":
      return { replies: [`¡De nada${name ? `, ${name}` : ""}! 🙌 Si necesitás algo más, escribí *menu*.`] };
    case "product": {
      const lines = named.slice(0, 8).map((p) => `• *${p.name}*: ${money(p.price)} / ${p.durationDays} días · ${p.available > 0 ? (p.available <= 2 ? `quedan ${p.available}` : "disponible ✅") : "agotado ❌"}`);
      return { replies: [`${lines.join("\n")}${isReseller ? "\n_(precio de revendedor)_" : ""}${shop ? `\n\n🛒 Comprá acá: ${shop}#catalogo` : ""}\n\nEscribí *3* para ver cómo pagar o *2* para ver todos los precios.`] };
    }
    case "orders": {
      if (!customer) return { replies: [notClient] };
      const STATUS: Record<string, string> = { awaiting_payment: "⏳ falta el comprobante", payment_review: "🔎 verificando el pago", fulfilled: "✅ entregado", rejected: "❌ rechazado", expired: "⌛ venció sin pago", cancelled: "cancelado" };
      const KIND: Record<string, string> = { sale: "Compra", renewal: "Renovación", topup: "Recarga" };
      const list = Object.values(st.orders).filter((o) => o.customerId === customer.id || o.payerId === customer.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
      if (!list.length) return { replies: [`Todavía no tenés pedidos.${shop ? ` Mirá los productos: ${shop}#catalogo` : ""}`] };
      const review = list.some((o) => o.status === "payment_review");
      // Lo que pagó su revendedor es el costo del revendedor: el cliente final no lo ve.
      const orderAmount = (o: (typeof list)[number]) => ((o.payerId ?? o.customerId) !== customer.id ? "lo pagó tu revendedor" : o.usd !== undefined ? usdText(o.usd) : bs(o.total));
      return { replies: [`🧾 *Tus últimos pedidos*\n${list.map((o) => `• ${KIND[o.kind] ?? o.kind} #${o.id} · ${orderAmount(o)} · ${STATUS[o.status] ?? o.status}`).join("\n")}${review ? "\n\nLos pagos se verifican en 10–30 minutos (en horario de atención). Te avisamos por acá." : ""}`] };
    }
    case "resellerClients": {
      if (!isReseller) return { replies: [menu()] };
      const mine = new Set(Object.values(st.customers).filter((c) => c.resellerId === customer!.id).map((c) => c.id));
      const soon = Object.values(st.assignments).filter((a) => a.status === "active" && mine.has(a.customerId) && a.customerExpiresAt - s.engine.now() <= 7 * 86_400_000)
        .sort((a, b) => a.customerExpiresAt - b.customerExpiresAt);
      if (!soon.length) return { replies: [`Ninguno de tus ${mine.size} cliente(s) vence en los próximos 7 días. 👌`] };
      const lines = soon.slice(0, 20).map((a) => {
        const d = Math.ceil((a.customerExpiresAt - s.engine.now()) / 86_400_000);
        return `• ${st.customers[a.customerId]?.name}: ${st.products[a.productId]?.name} · ${d < 0 ? "⚠️ vencido" : d === 0 ? "vence hoy" : `vence en ${d} día(s)`}`;
      });
      const link = ctx.loginLink(customer!.id);
      return { replies: [`👥 *Clientes por vencer (7 días)*\n${lines.join("\n")}${soon.length > 20 ? `\n…y ${soon.length - 20} más` : ""}\n\nRenovalos con tu saldo desde *Mis clientes*${link ? `:\n${link}` : "."}`] };
    }
    case "unknown":
      return { replies: [`No te entendí del todo 🤔${name ? `, ${name}` : ""}.\n\n${menu()}`], unknown: true };
    case "optout":
      return { replies: ["Listo, no te vamos a mandar más avisos automáticos. Si cambiás de idea, escribí *ALTA*."], consent: false };
    case "optin":
      return { replies: ["¡Perfecto! Te vamos a avisar de tus pedidos y vencimientos. Para dejar de recibirlos escribí *BAJA*."], consent: true };
    case "prices": {
      const list = s.catalog.publicCatalog(customer?.id).filter((p) => p.available > 0);
      if (!list.length) return { replies: ["Ahora no tenemos productos disponibles. Escribí *0* y te avisamos cuando haya. 🙏"] };
      const lines = list.slice(0, 25).map((p) => `• ${p.name}: *${money(p.price)}* / ${p.durationDays} días`);
      return { replies: [`💰 *Precios${customer?.kind === "reseller" ? " de revendedor" : ""}*\n${lines.join("\n")}${shop ? `\n\n🛒 Comprá acá: ${shop}#catalogo` : ""}\n\nEscribí *3* para ver cómo pagar.`] };
    }
    case "pay": {
      const note = st.settings.paymentNote ? `\n🏦 ${st.settings.paymentNote}` : "";
      const hasQr = !!st.settings.qrFileRef;
      return {
        replies: [`💳 *Cómo pagar*\n1. Elegí tu producto en la tienda${shop ? ` (${shop})` : ""}.\n2. Pagá con QR o con tu saldo.\n3. Subí la foto del comprobante en el mismo pedido.${note}\n\nVerificamos el pago en 10–30 minutos y te avisamos por acá.`],
        sendQr: hasQr && !!ctx.origin?.startsWith("https://"),
      };
    }
    case "services":
    case "renew": {
      if (!customer) return { replies: [notClient] };
      const list = Object.values(st.assignments).filter((a) => a.customerId === customer.id && a.status === "active").sort((a, b) => a.customerExpiresAt - b.customerExpiresAt);
      if (!list.length) return { replies: [`No tenés servicios activos ahora.${shop ? ` Mirá los productos: ${shop}#catalogo` : ""}`] };
      const lines = list.map((a) => {
        const d = Math.ceil((a.customerExpiresAt - s.engine.now()) / 86_400_000);
        return `• ${st.products[a.productId]?.name} (${st.slots[a.slotId]?.label}): vence *${fd(a.customerExpiresAt)}* ${d < 0 ? "⚠️ vencido" : d <= 3 ? `⚠️ en ${d} día(s)` : `(${d} días)`}`;
      });
      const link = ctx.loginLink(customer.id);
      return { replies: [`📺 *Tus servicios*\n${lines.join("\n")}\n\n${intent === "renew" ? "Para renovar entrá a tu cuenta y tocá *Renovar*" : "Tus claves y PIN están en tu cuenta"}${link ? `:\n${link}\n_(link personal, sirve una vez por 24 h)_` : "."}`] };
    }
    case "login": {
      if (!customer) return { replies: [notClient] };
      const link = ctx.loginLink(customer.id);
      return { replies: [link ? `🔐 Este es tu link personal para entrar a *Mis cuentas* (claves, PIN, renovar):\n${link}\n\nSirve una sola vez, por 24 horas. No lo compartas.` : "Ahora no puedo generar tu link. Escribí *0* y te ayuda una persona."] };
    }
    case "codes": {
      if (!customer) return { replies: [notClient] };
      const codes = s.portal.codes({ id: `bot:${customer.id}`, role: customer.kind === "reseller" ? "reseller" : "customer", customerId: customer.id }, customer.id);
      if (!codes.length) return { replies: ["No llegó ningún código nuevo a tus cuentas en los últimos 30 minutos. Si la plataforma te pidió uno recién, esperá un minuto y escribí *5* de nuevo."] };
      return { replies: [`🔢 *Códigos recientes*\n${codes.slice(0, 5).map((c) => `• ${c.subject}: *${c.code}*`).join("\n")}\n\nSon solo para vos. Duran poco: usalos ya.`] };
    }
    case "balance": {
      if (!customer) return { replies: [notClient] };
      // Saldo en dólares (lista en US$): se dice en US$, nunca como si fueran Bs.
      return { replies: [`💼 Tu saldo es *${money(s.wallet.balance(customer.id))}*.${shop ? ` Recargá en ${shop}#recargas` : ""}`] };
    }
    default:
      return { replies: [menu()] };
  }
}
