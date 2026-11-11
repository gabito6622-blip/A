// Tasa del dólar del Banco Central de Bolivia (tipo de cambio oficial, se publica cada día hábil).
// Se lee de la portada del BCB: la tarjeta "Tipo de cambio oficial" trae la fecha (<time datetime>) y el
// número (bcb-tco-num, ej. "11,71"). Si la página cambia o el número no tiene sentido, se rechaza y no se
// toca la tasa de la tienda (mejor una tasa vieja con aviso que una equivocada).
export const BCB_URL = "https://www.bcb.gob.bo/";
/** Rango razonable (Bs por US$) para descartar lecturas rotas. */
export const BCB_MIN = 5, BCB_MAX = 50;

export interface BcbRate { rate: number; date: string }

export function parseBcbRate(html: string): BcbRate {
  const i = html.indexOf("is-tc-oficial");
  if (i < 0) throw new Error("No encontré el tipo de cambio oficial en la página del Banco Central");
  // Solo la tarjeta del dólar: hasta su </article> (la siguiente es la del oro, con otro número).
  const end = html.indexOf("</article>", i);
  const block = html.slice(i, end > i ? end : i + 3000);
  const num = /class="bcb-tco-num"[^>]*>\s*(\d{1,3}(?:[.,]\d{1,4})?)\s*</.exec(block);
  const date = /<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/.exec(block);
  if (!num || !date) throw new Error("La página del Banco Central cambió: no pude leer la tasa o la fecha");
  const rate = Number(num[1].replace(",", "."));
  if (!(rate >= BCB_MIN && rate <= BCB_MAX)) throw new Error(`La tasa leída (${num[1]}) no parece real`);
  return { rate: Math.round(rate * 100) / 100, date: date[1] };
}

export async function fetchBcbRate(fetchImpl: typeof fetch, url = BCB_URL): Promise<BcbRate> {
  const r = await fetchImpl(url, { headers: { "user-agent": "GaboHub (tasa del día)", accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`El Banco Central respondió ${r.status}`);
  return parseBcbRate(await r.text());
}
