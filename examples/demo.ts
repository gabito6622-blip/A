// Ejemplo de uso del SDK. Ejecutar (Node 22+):
//   VP_EMAIL=... VP_PASSWORD=... node --experimental-strip-types examples/demo.ts
//
// Campos de login confirmados por decompilación del front: { email, password }.

import { VendePlayClient } from "../src/index.js";

async function main() {
  const client = new VendePlayClient();

  const credentials = {
    email: process.env.VP_EMAIL ?? "",
    password: process.env.VP_PASSWORD ?? "",
  };

  console.log("Login…");
  const tokens = await client.login(credentials);
  console.log("accessToken:", tokens.accessToken.slice(0, 12) + "…");

  const me = await client.me();
  console.log("me:", me);

  const dashboard = await client.metrics.dashboard();
  console.log("metrics/dashboard:", dashboard);

  const clients = await client.clients.list({ page: 1, limit: 20 });
  console.log("clients:", clients);

  // Gateway de WhatsApp (resuelve el plugin self.ws y usa x-api-key)
  try {
    const wa = await client.connectWhatsApp();
    console.log("whatsapp session:", await wa.sessions.status());
    // await wa.sendText("<chatId>", "Hola 👋");
  } catch (e) {
    console.log("whatsapp no disponible:", (e as Error).message);
  }

  await client.logout();
  console.log("Listo.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
