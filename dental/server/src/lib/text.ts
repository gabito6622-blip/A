/** Minúsculas y sin tildes, para búsquedas tolerantes ("Jose" encuentra "José"). */
export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Teléfono boliviano a E.164 cuando es posible (8 dígitos móviles → +591...). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("591") && digits.length === 11) return `+${digits}`;
  if (/^[67]\d{7}$/.test(digits)) return `+591${digits}`;
  return digits;
}

export function money(cents: number, currency = "BOB"): string {
  return new Intl.NumberFormat("es-BO", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}
