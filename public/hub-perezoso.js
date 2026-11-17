// Funciones de GaboHub (panel del revendedor) que se cargan solo cuando hacen falta (14/11/2026).
//
// Por qué: la tienda del cliente y la página /r/<slug> bajaban y ejecutaban ~42 KB comprimidos de módulos del
// panel del revendedor (ownstock, cuaderno, propias-plata…) antes de pedir el catálogo. Un cliente nunca los usa.
// shop.js los importa desde acá con los mismos nombres: cada nombre es un «puente» que llama al módulo real.
//  - En GaboHub (o cuando entra un revendedor), shop.js espera `cargarHub()` antes de dibujar: todo funciona igual.
//  - Los `init…` que shop.js llama al arrancar se guardan y se aplican apenas carga el módulo.
//  - Las funciones que devuelven promesas esperan a que cargue.
//  - Si una función que dibuja se llamara antes de cargar (no debería pasar), devuelve "" y se vuelve a dibujar
//    cuando termina de cargar.
// Para agregar un nombre: exportalo acá con el mismo tipo de puente (init, espera o dibujo).
export const MODULOS_HUB = ["/ownstock.js", "/propias-plata.js", "/hub-mes.js", "/cuaderno.js", "/sublinks.js", "/cambio-cuenta.js", "/arranque.js", "/descargas.js", "/hub-cobros.js"];

const M = {};
let listo = false, carga = null, redibujar = null;
const pendientes = [];

/** Carga (una sola vez) los módulos del panel. Si falla (sin conexión), se puede reintentar. */
export function cargarHub() {
  carga ??= Promise.all(MODULOS_HUB.map((u) => import(u))).then((mods) => {
    for (const m of mods) Object.assign(M, m);
    listo = true;
    for (const [n, a] of pendientes.splice(0)) M[n](...a);
  }, (e) => { carga = null; throw e; });
  return carga;
}
export const hubListo = () => listo;
/** Qué hacer si algo se dibujó antes de que cargara el panel (shop.js pasa su render). */
export function alCargarHub(fn) { redibujar = fn; }

const init = (n) => (...a) => (listo ? M[n](...a) : void pendientes.push([n, a]));
const espera = (n) => async (...a) => { await cargarHub(); return M[n](...a); };
const dibujo = (n) => (...a) => {
  if (listo) return M[n](...a);
  cargarHub().then(() => redibujar?.(), () => {});
  return "";
};

// sublinks.js
export const subLinkBox = dibujo("subLinkBox"), cobroLine = dibujo("cobroLine"), clientLinkBox = dibujo("clientLinkBox");
export const subLinkClick = espera("subLinkClick"), clientLinkClick = espera("clientLinkClick");
// descargas.js
export const initDescargas = init("initDescargas"), descargasBind = init("descargasBind");
export const descargasEnsure = espera("descargasEnsure"), descargasClick = espera("descargasClick");
export const descargasView = dibujo("descargasView");
// ownstock.js
export const initOwnStock = init("initOwnStock"), loadOwnStock = espera("loadOwnStock");
export const ownStockView = dibujo("ownStockView"), ownData = dibujo("ownData");
// propias-plata.js
export const initPropiasPlata = init("initPropiasPlata");
export const loadOwnDay = espera("loadOwnDay"), loadOwnBack = espera("loadOwnBack"), loadOwnEarn = espera("loadOwnEarn");
export const ownDayHtml = dibujo("ownDayHtml"), ownBackHtml = dibujo("ownBackHtml"), ownControlHtml = dibujo("ownControlHtml"), ownDebeHtml = dibujo("ownDebeHtml");
export const ownOwed = dibujo("ownOwed"), ownEarnHtml = dibujo("ownEarnHtml"), ownDayMerge = dibujo("ownDayMerge"), ownDayNote = dibujo("ownDayNote");
export const ownTodayNums = dibujo("ownTodayNums"), ownComboPicks = dibujo("ownComboPicks");
// hub-mes.js
export const hubMesInit = init("hubMesInit"), loadRentAlerts = espera("loadRentAlerts");
export const rentAlertBanner = dibujo("rentAlertBanner"), renewManyBox = dibujo("renewManyBox"), qrBoxIds = dibujo("qrBoxIds");
// cuaderno.js
export const cuadernoInit = init("cuadernoInit");
export const tail = dibujo("tail"), who = dibujo("who"), owedText = dibujo("owedText"), payButtons = dibujo("payButtons"), undoBar = dibujo("undoBar");
export const subsNav = dibujo("subsNav"), cutsBox = dibujo("cutsBox"), subsDebtBox = dibujo("subsDebtBox"), subPayButtons = dibujo("subPayButtons");
export const historyBox = dibujo("historyBox"), gananciaRealBox = dibujo("gananciaRealBox");
// cambio-cuenta.js
export const initAccChanges = init("initAccChanges"), accChangeBox = dibujo("accChangeBox"), accChangesBanner = dibujo("accChangesBanner");
// arranque.js
export const initArranque = init("initArranque");
export const firstStepsCard = dibujo("firstStepsCard"), indepLine = dibujo("indepLine"), indepCatalog = dibujo("indepCatalog");
export const pageAskItem = dibujo("pageAskItem"), slugField = dibujo("slugField"), slugConfirm = dibujo("slugConfirm");
// hub-cobros.js (17/11/2026): Anotar rápido, Me pagó todo, Deshacer y comprobantes de los links
export const initHubCobros = init("initHubCobros"), loadHubCobros = espera("loadHubCobros");
export const hubCobrosHome = dibujo("hubCobrosHome"), hubCobrosDia = dibujo("hubCobrosDia"), payAllBtn = dibujo("payAllBtn");
