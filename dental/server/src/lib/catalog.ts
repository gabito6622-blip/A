// Catálogo inicial de prestaciones (precios referenciales en Bs; cada clínica los ajusta).
import type { Client } from "./db.js";

export const DEFAULT_PROCEDURES: [code: string, name: string, category: string, priceBs: number, minutes: number, scope: string, condition: string | null][] = [
  ["CON-01", "Consulta y diagnóstico", "Diagnóstico", 100, 30, "mouth", null],
  ["RX-01", "Radiografía periapical", "Diagnóstico", 50, 15, "tooth", null],
  ["RX-02", "Radiografía panorámica", "Diagnóstico", 180, 15, "mouth", null],
  ["PRE-01", "Profilaxis (limpieza dental)", "Prevención", 200, 45, "mouth", null],
  ["PRE-02", "Aplicación de flúor", "Prevención", 80, 15, "mouth", null],
  ["PRE-03", "Sellante de fosas y fisuras", "Prevención", 90, 20, "surface", "sealant"],
  ["OPE-01", "Restauración con resina (1 superficie)", "Operatoria", 250, 45, "surface", "restoration"],
  ["OPE-02", "Restauración con resina (2+ superficies)", "Operatoria", 350, 60, "surface", "restoration"],
  ["END-01", "Endodoncia unirradicular", "Endodoncia", 900, 90, "tooth", "endodontics"],
  ["END-02", "Endodoncia multirradicular", "Endodoncia", 1400, 120, "tooth", "endodontics"],
  ["CIR-01", "Extracción simple", "Cirugía", 200, 30, "tooth", "missing"],
  ["CIR-02", "Extracción de tercer molar", "Cirugía", 700, 60, "tooth", "missing"],
  ["PER-01", "Raspaje y alisado radicular (por cuadrante)", "Periodoncia", 350, 60, "quadrant", null],
  ["PRO-01", "Corona de porcelana", "Prótesis", 2500, 60, "tooth", "crown"],
  ["PRO-02", "Prótesis removible parcial", "Prótesis", 3000, 60, "mouth", null],
  ["IMP-01", "Implante dental (fase quirúrgica)", "Implantes", 6500, 90, "tooth", "implant"],
  ["ORT-01", "Control de ortodoncia", "Ortodoncia", 250, 30, "mouth", null],
  ["EST-01", "Blanqueamiento en consultorio", "Estética", 1200, 60, "mouth", null],
];

/** Meses sugeridos hasta el próximo control, por código de prestación (cada clínica los ajusta). */
export const DEFAULT_RECALL_MONTHS: Record<string, number> = {
  "PRE-01": 6, "PRE-02": 6, "PER-01": 3, "END-01": 12, "END-02": 12, "IMP-01": 6, "ORT-01": 1, "PRO-01": 12, "PRO-02": 12,
};

export async function seedCatalog(c: Client, clinicId: string) {
  for (const [code, name, category, price, minutes, scope, cond] of DEFAULT_PROCEDURES) {
    await c.query(
      `INSERT INTO procedures (clinic_id, code, name, category, price_cents, duration_min, scope, odontogram_condition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (clinic_id, code) DO NOTHING`,
      [clinicId, code, name, category, price * 100, minutes, scope, cond],
    );
  }
  for (const [code, months] of Object.entries(DEFAULT_RECALL_MONTHS)) {
    await c.query("UPDATE procedures SET recall_months = $3 WHERE clinic_id = $1 AND code = $2 AND recall_months IS NULL", [clinicId, code, months]);
  }
}
