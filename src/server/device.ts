/**
 * Nombre simple de un aparato a partir del "user-agent" del navegador (14/11/2026), para «Seguridad de mi cuenta»:
 * «📱 Android · Chrome», «💻 Windows · Edge», «📱 iPhone · Safari». No es exacto ni pretende serlo: alcanza para que
 * la persona reconozca su celular o se dé cuenta de que hay uno que no es suyo.
 */
export function deviceOf(ua: string): string {
  const u = ua || "";
  if (!u) return "❔ Aparato desconocido";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows"
    : /Mac OS X|Macintosh/.test(u) ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux" : "Otro";
  const br = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /SamsungBrowser/.test(u) ? "Samsung Internet" : /Firefox\//.test(u) ? "Firefox"
    : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : /curl|node|python|bot|spider|HeadlessChrome/i.test(u) ? "programa" : "navegador";
  const icon = ["iPhone", "Android"].includes(os) && !/Tablet|iPad/.test(u) ? "📱" : os === "iPad" ? "📱" : os === "Otro" ? "❔" : "💻";
  return `${icon} ${os} · ${br}`;
}
