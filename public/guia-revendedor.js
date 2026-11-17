// Guía con fotos para revendedores (17/11/2026): nombre de la plataforma y WhatsApp de la tienda.
// Va en un archivo aparte porque la política de seguridad no deja correr scripts dentro del HTML.
  // Nombre de la plataforma y WhatsApp de la tienda (si no carga, la guía igual se lee).
  fetch("/api/settings").then((r) => r.json()).then((d) => {
    const st = d.settings ?? d;
    if (st.platformName) for (const el of document.querySelectorAll(".plat")) el.textContent = st.platformName;
    document.title = `Guía para revendedores · ${st.platformName || "panel"}`;
    const wa = String(st.whatsapp || "").replace(/\D/g, "");
    if (wa) { const a = document.getElementById("wa"); a.href = `https://wa.me/${wa}?text=${encodeURIComponent("Hola, tengo una duda con mi panel de revendedor")}`; a.target = "_blank"; a.rel = "noopener"; a.hidden = false; }
  }).catch(() => {});
  for (const el of document.querySelectorAll(".hub")) el.textContent = location.host + "/hub";
