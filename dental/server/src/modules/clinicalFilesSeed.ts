// Datos demo (ficticios) de imágenes y archivos: una paciente con radiografías periapicales de
// la pieza 36 antes y después de la obturación, una panorámica, una foto intraoral y un documento
// escaneado. Todas las imágenes son PNG SINTÉTICOS generados en código (lib/png.ts).
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { Db } from "../lib/db.js";
import { nextCounter } from "../lib/db.js";
import { normalize } from "../lib/text.js";
import { createFileStore, newStorageKey } from "../lib/filestore.js";
import { syntheticIntraoral, syntheticPanoramic, syntheticPeriapical, syntheticScan } from "../lib/png.js";

export async function seedClinicalFilesDemo(db: Db, clinicId: string, cfg: { filesDir: string }) {
  const store = createFileStore(cfg);
  const c = await db.adminPool.connect();
  const written: string[] = [];
  try {
    await c.query("BEGIN");
    const br = (await c.query<{ id: string }>("SELECT id FROM branches WHERE clinic_id = $1 AND code = 'LPZ'", [clinicId])).rows[0]!.id;
    const dr = (await c.query<{ id: string }>("SELECT id FROM users WHERE email = 'dr.mendoza@demo.local'")).rows[0]!.id;
    const rec = (await c.query<{ id: string }>("SELECT id FROM users WHERE email = 'recepcion.lpz@demo.local'")).rows[0]?.id ?? dr;
    const n = await nextCounter(c, clinicId, "patient");
    const pid = (await c.query<{ id: string }>(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, document_issued, birth_date, sex, phone, city, search_text, preferred_branch_id)
       VALUES ($1,$2,'Valeria','Demo Imágenes','CI','9900002','LP','1992-07-21','F','+59170000002','La Paz',$3,$4) RETURNING id`,
      [clinicId, n, normalize(`Valeria Demo Imagenes 9900002 +59170000002 ${n}`), br])).rows[0]!.id;
    const day = (d: number) => DateTime.now().setZone("America/La_Paz").minus({ days: d }).toISODate()!;
    const files = [
      { kind: "xray_panoramic", teeth: [], taken: day(60), desc: "Panorámica de control inicial (imagen sintética de demostración)", png: syntheticPanoramic(), by: dr, name: "panoramica.png" },
      { kind: "xray_periapical", teeth: [36], taken: day(45), desc: "Pieza 36 antes del tratamiento (imagen sintética)", png: syntheticPeriapical(1, false), by: dr, name: "periapical-36-antes.png" },
      { kind: "xray_periapical", teeth: [36], taken: day(10), desc: "Pieza 36 después de la obturación (imagen sintética)", png: syntheticPeriapical(1, true), by: dr, name: "periapical-36-despues.png" },
      { kind: "photo_intraoral", teeth: [11, 21], taken: day(10), desc: "Foto frontal (imagen sintética)", png: syntheticIntraoral(), by: dr, name: "intraoral.png" },
      { kind: "scanned_document", teeth: [], taken: day(60), desc: "Formulario del seguro escaneado (documento sintético)", png: syntheticScan(), by: rec, name: "formulario-seguro.png" },
    ];
    for (const f of files) {
      const key = newStorageKey(clinicId);
      await store.put(key, f.png);
      written.push(key);
      const id = (await c.query<{ id: string }>(
        `INSERT INTO clinical_files (clinic_id, patient_id, branch_id, kind, teeth, taken_on, description, original_name, mime_type, size_bytes, sha256, storage_driver, storage_key, uploaded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'image/png',$9,$10,$11,$12,$13, ($6::date + time '10:30') AT TIME ZONE 'America/La_Paz') RETURNING id`,
        [clinicId, pid, br, f.kind, f.teeth, f.taken, f.desc, f.name, f.png.length, createHash("sha256").update(f.png).digest("hex"), store.driver, key, f.by],
      )).rows[0]!.id;
      await c.query("INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data) VALUES ($1,$2,'clinical_file.uploaded','clinical_file',$3,$4,$5)",
        [clinicId, f.by, id, br, JSON.stringify({ patientId: pid, kind: f.kind, seed: true })]);
    }
    await c.query("COMMIT");
    return { patientId: pid, files: files.length };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    for (const k of written) await store.remove(k).catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
