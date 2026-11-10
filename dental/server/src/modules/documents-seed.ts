// Datos demo (ficticios) de documentos: un paciente con alergia a la penicilina, una receta
// y un certificado de atención ya emitidos con su PDF. El catálogo de medicamentos lo
// siembra la migración 0012 al crear la clínica.
import type { Db } from "../lib/db.js";
import { nextCounter } from "../lib/db.js";
import { normalize } from "../lib/text.js";
import type { AuthCtx } from "../lib/rbac.js";
import { issueClinicalDocument } from "./documents.js";

export async function seedDocumentsDemo(db: Db, clinicId: string, publicUrl: string) {
  const c = await db.adminPool.connect();
  try {
    await c.query("BEGIN");
    const br = (await c.query<{ id: string }>("SELECT id FROM branches WHERE clinic_id = $1 AND code = 'LPZ'", [clinicId])).rows[0]!.id;
    const dr = (await c.query<{ id: string; full_name: string }>(
      "SELECT u.id, u.full_name FROM users u WHERE u.email = 'dr.mendoza@demo.local'")).rows[0]!;
    const n = await nextCounter(c, clinicId, "patient");
    const pid = (await c.query<{ id: string }>(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, document_issued, birth_date, sex, phone, city, search_text, preferred_branch_id)
       VALUES ($1,$2,'Rodrigo','Demo Receta','CI','9900001','LP','1985-03-14','M','+59170000001','La Paz',$3,$4) RETURNING id`,
      [clinicId, n, normalize(`Rodrigo Demo Receta 9900001 +59170000001 ${n}`), br])).rows[0]!.id;
    await c.query("INSERT INTO medical_histories (clinic_id, patient_id, data, recorded_by) VALUES ($1,$2,$3,$4)",
      [clinicId, pid, JSON.stringify({ allergies: "Penicilina", medications: null, conditions: [], anticoagulants: false, pregnant: false, smoker: false }), dr.id]);
    const auth = {
      userId: dr.id, clinicId, fullName: dr.full_name, ip: null, permissions: new Set(),
      membership: { id: "", clinicId, role: "dentist", allBranches: true, branchIds: [], isProfessional: true },
    } as unknown as AuthCtx;
    await issueClinicalDocument(c, auth, publicUrl, {
      patientId: pid, branchId: br, kind: "prescription", template: null, title: "Receta", summary: "Ibuprofeno Comprimidos 400 mg, Clorhexidina Colutorio 0,12 %",
      content: {
        lines: [
          { drug: "Ibuprofeno", presentation: "Comprimidos 400 mg", dose: "1 comprimido", frequency: "Cada 8 horas", duration: "3 días", instructions: "Vía oral, después de las comidas." },
          { drug: "Clorhexidina", presentation: "Colutorio 0,12 %", dose: "15 ml", frequency: "Cada 12 horas", duration: "7 días", instructions: "Enjuagar 30 segundos y escupir. No tragar." },
        ],
        indications: "Dieta blanda las primeras 24 horas. Volver si hay fiebre o sangrado.", allergies: "Penicilina",
      },
      warnings: [], ack: false, reissueOfId: null, noteKind: "prescription", noteBody: "Ibuprofeno y clorhexidina (demo).",
    });
    await issueClinicalDocument(c, auth, publicUrl, {
      patientId: pid, branchId: br, kind: "certificate", template: "attendance", title: "Certificado de atención odontológica", summary: "Atención por control y profilaxis",
      content: {
        body: "Certifico que Rodrigo Demo Receta, con CI 9900001 LP, fue atendido en Sonrisa Andina (demo), sucursal La Paz Centro, por control y profilaxis.\n\nSe extiende el presente certificado a solicitud del interesado, para los fines que convengan.",
        fields: { reason: "Control y profilaxis" },
      },
      warnings: [], ack: false, reissueOfId: null, noteKind: "other", noteBody: "Certificado de atención (demo).",
    });
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
