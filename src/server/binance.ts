// Binance Pay (API de comerciante): crear orden, consultar y verificar la firma del webhook.
// Docs de referencia: developer.binance.com/docs/binance-pay/introduction
// Las peticiones se firman con HMAC-SHA512; el webhook de Binance se verifica con RSA (certificado público).
import { createHmac, randomBytes, createVerify, timingSafeEqual } from "node:crypto";

export class BinanceError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryable = false) {
    super(message);
    this.name = "BinanceError";
  }
}

export interface BinanceKeys {
  apiKey: string;
  apiSecret: string;
}

export interface CreateOrderInput {
  merchantTradeNo: string;
  /** Monto en USDT como número (se formatea a 2 decimales). */
  amount: number;
  goodsName: string;
  returnUrl?: string;
  cancelUrl?: string;
  /** Vencimiento en milisegundos epoch (opcional). */
  expireAt?: number;
}

export interface CreateOrderResult {
  prepayId: string;
  checkoutUrl?: string;
  qrcodeLink?: string;
  qrContent?: string;
  deeplink?: string;
  universalUrl?: string;
  expireTime?: number;
}

type Fetch = typeof fetch;

export class BinancePay {
  private certs: { sn: string; pem: string }[] = [];
  constructor(private keys: BinanceKeys, private fetchImpl: Fetch = fetch, private base = "https://bpay.binanceapi.com") {}

  /** Crea una orden de pago. Devuelve el enlace/QR para que el cliente pague en Binance. */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const body = {
      env: { terminalType: "WEB" },
      merchantTradeNo: input.merchantTradeNo,
      orderAmount: input.amount.toFixed(2),
      currency: "USDT",
      goods: { goodsType: "02", goodsCategory: "Z000", referenceGoodsId: input.merchantTradeNo, goodsName: input.goodsName.slice(0, 256) },
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
      ...(input.expireAt ? { orderExpireTime: input.expireAt } : {}),
    };
    const data = await this.call<CreateOrderResult>("/binancepay/openapi/v3/order", body);
    return data;
  }

  /** Consulta el estado de una orden por nuestro número de operación. */
  async queryOrder(merchantTradeNo: string): Promise<{ status: string; transactionId?: string }> {
    return this.call("/binancepay/openapi/v2/order/query", { merchantTradeNo });
  }

  /** Descarga (y cachea) los certificados públicos con los que Binance firma sus webhooks. */
  async getCertificates(force = false): Promise<{ sn: string; pem: string }[]> {
    if (this.certs.length && !force) return this.certs;
    const data = await this.call<{ certSerialNumber: string; certPublic: string }[]>("/binancepay/openapi/certificates", {});
    this.certs = (data ?? []).map((c) => ({ sn: c.certSerialNumber, pem: c.certPublic }));
    return this.certs;
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const payload = JSON.stringify(body);
    const ts = String(Date.now());
    const nonce = randomBytes(16).toString("hex"); // 32 caracteres alfanuméricos
    const toSign = `${ts}\n${nonce}\n${payload}\n`;
    const signature = createHmac("sha512", this.keys.apiSecret).update(toSign).digest("hex").toUpperCase();
    let r: Response;
    try {
      r = await this.fetchImpl(`${this.base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "BinancePay-Timestamp": ts,
          "BinancePay-Nonce": nonce,
          "BinancePay-Certificate-SN": this.keys.apiKey,
          "BinancePay-Signature": signature,
        },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new BinanceError(`Sin conexión con Binance: ${(e as Error).message}`, 0, undefined, true);
    }
    const j = (await r.json().catch(() => ({}))) as { status?: string; code?: string; errorMessage?: string; data?: T };
    if (!r.ok || j.status !== "SUCCESS") {
      throw new BinanceError(explain(j.code, j.errorMessage) , r.status, j.code, r.status >= 500 || r.status === 429);
    }
    return j.data as T;
  }
}

/** Verifica la firma del webhook de Binance (RSA SHA256) contra los certificados públicos. */
export function verifyWebhook(rawBody: Buffer | string, headers: { timestamp?: string; nonce?: string; signature?: string }, certs: { sn: string; pem: string }[]): boolean {
  const { timestamp, nonce, signature } = headers;
  if (!timestamp || !nonce || !signature || !certs.length) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const payload = `${timestamp}\n${nonce}\n${body}\n`;
  let sig: Buffer;
  try { sig = Buffer.from(signature, "base64"); } catch { return false; }
  for (const c of certs) {
    try {
      const v = createVerify("RSA-SHA256");
      v.update(payload, "utf8");
      v.end();
      if (v.verify(c.pem, sig)) return true;
    } catch { /* certificado inválido: probar el siguiente */ }
  }
  return false;
}

/** El cuerpo del webhook trae `data` como string JSON; lo parsea y saca lo que importa. */
export function parseWebhook(body: { bizType?: string; bizStatus?: string; data?: string }): { bizStatus: string; merchantTradeNo?: string; transactionId?: string; totalFee?: string; currency?: string } {
  let d: Record<string, unknown> = {};
  try { d = typeof body.data === "string" ? JSON.parse(body.data) : (body.data ?? {}); } catch { /* data inválida */ }
  return {
    bizStatus: body.bizStatus ?? "",
    merchantTradeNo: typeof d.merchantTradeNo === "string" ? d.merchantTradeNo : undefined,
    transactionId: typeof d.transactionId === "string" ? d.transactionId : undefined,
    totalFee: d.totalFee != null ? String(d.totalFee) : undefined,
    currency: typeof d.currency === "string" ? d.currency : undefined,
  };
}

/** Compara dos firmas en tiempo constante (para la respuesta al webhook si hiciera falta). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function explain(code: string | undefined, msg: string | undefined): string {
  const known: Record<string, string> = {
    "400201": "El número de operación ya existe en Binance (merchantTradeNo repetido).",
    "400203": "Falta o es inválido un dato de la orden (revisá el monto y los campos).",
    "400001": "La firma o las llaves de Binance Pay no son válidas. Revisá la API Key y la API Secret.",
    "400002": "La petición venció (reloj del servidor desfasado).",
    "403000": "Esta cuenta de Binance no está habilitada como comerciante para Binance Pay.",
  };
  const base = code && known[code] ? known[code] : "";
  return `${base}${base ? " " : ""}${msg ? `(Binance: ${msg})` : code ? `(Binance ${code})` : "Error de Binance"}`.trim();
}
