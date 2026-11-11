// Datos de demostración 100% ficticios (nunca datos reales).
// Uso: npm run seed            -> crea la clínica demo si no existe
//      npm run seed -- --reset -> borra TODOS los datos y vuelve a crearla (solo desarrollo)
import { DateTime } from "luxon";
import { loadConfig } from "../config.js";
import { createDb } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import { hashPassword } from "../lib/password.js";
import { seedCatalog } from "../lib/catalog.js";
import { normalize } from "../lib/text.js";
import { seedConsentTemplates } from "../modules/consents.js";
import { seedRecallsDemo } from "../modules/recallsDemo.js";
import { seedPerioDemo } from "../modules/perio.js";
import { seedCashAndFees } from "../modules/cashFeesSeed.js";
import { seedBudgetsV2 } from "../modules/budgets-v2-seed.js";
import { seedPortalDemo } from "../modules/portal/seed.js";
import { seedLabDemo } from "../modules/labSeed.js";
import { seedAgendaPlusDemo } from "../modules/agendaPlusDemo.js";
import { seedMessagingDemo } from "../modules/messaging/seed.js";
import { seedDocumentsDemo } from "../modules/documents-seed.js";
import { seedInventoryDemo } from "../modules/inventory/seed.js";
import { seedClinicalFilesDemo } from "../modules/clinicalFilesSeed.js";
import { seedCoordinationDemo } from "../modules/coordination/seed.js";
import { seedManagementDemo } from "../modules/management/seed.js";
import { seedAgreementsDemo } from "../modules/agreements/seed.js";

const cfg = loadConfig();
if (cfg.isProduction && process.env.SEED_ALLOW !== "1") {
  console.error("La semilla de demostración no se ejecuta en producción (usa SEED_ALLOW=1 solo en un entorno de demo).");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "Demo2026dental";
const ZONE = "America/La_Paz";
const db = createDb(cfg.databaseUrl);
const q = (sql: string, params: unknown[] = []) => db.adminPool.query(sql, params);

// Generador pseudoaleatorio determinista (mismos datos en cada ejecución)
let seed = 20261110;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

try {
  await migrate(db.adminPool);
  if (process.argv.includes("--reset")) {
    await q(`TRUNCATE sterilization_bio_results, sterilization_cycles, sterilizers, cleaning_logs, signed_documents, consent_templates, password_resets, mfa_recovery_codes, audit_log, payments, charges, budget_items, budgets, clinical_notes, odontogram_entries, waitlist_entries, appointments,
      procedures, medical_histories, patients, counters, schedule_blocks, dentist_schedules, chairs, branches, memberships, sessions, users, clinics, plans CASCADE`);
    console.log("Datos borrados.");
  }
  if ((await q("SELECT 1 FROM clinics WHERE slug = 'sonrisa-andina-demo'")).rowCount) {
    console.log("La clínica demo ya existe. Usa --reset para recrearla.");
    process.exit(0);
  }
  const pw = await hashPassword(PASSWORD);
  const plans = [
    ["consultorio", "Consultorio", 1, 4, 19900], ["clinica", "Clínica", 3, 15, 49900],
    ["red", "Red de clínicas", 5, 40, 89900], ["cadena", "Cadena", 50, 500, 0],
  ] as const;
  for (const [code, name, b, u, price] of plans) {
    await q("INSERT INTO plans (code, name, max_branches, max_users, price_cents) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING", [code, name, b, u, price]);
  }
  await q("INSERT INTO users (email, full_name, password_hash, is_platform_admin) VALUES ('superadmin@demo.local','Superadministrador SaaS',$1,true) ON CONFLICT DO NOTHING", [pw]);
  const planId = (await q("SELECT id FROM plans WHERE code = 'red'")).rows[0].id;
  const clinicId = (await q(
    "INSERT INTO clinics (slug, name, legal_name, tax_id, plan_id, status) VALUES ('sonrisa-andina-demo','Sonrisa Andina (demo)','Sonrisa Andina S.R.L. (ficticia)','0000000000',$1,'active') RETURNING id", [planId])).rows[0].id;

  const branchDefs = [
    ["LPZ", "La Paz Centro", "Av. 16 de Julio 1000 (ficticia)", "La Paz", 3],
    ["SUR", "La Paz Sur", "Calle 21 de Calacoto (ficticia)", "La Paz", 2],
    ["EAL", "El Alto", "Ciudad Satélite, Plan 500 (ficticia)", "El Alto", 2],
    ["CBB", "Cochabamba", "Av. América 500 (ficticia)", "Cochabamba", 2],
    ["SCZ", "Santa Cruz", "Equipetrol, 3er anillo (ficticia)", "Santa Cruz", 3],
  ] as const;
  const hours = { "1": [["08:00", "12:30"], ["14:30", "19:00"]], "2": [["08:00", "12:30"], ["14:30", "19:00"]], "3": [["08:00", "12:30"], ["14:30", "19:00"]], "4": [["08:00", "12:30"], ["14:30", "19:00"]], "5": [["08:00", "12:30"], ["14:30", "19:00"]], "6": [["08:00", "12:00"]] };
  const branches: { id: string; code: string; chairs: string[] }[] = [];
  for (const [code, name, address, city, nChairs] of branchDefs) {
    const id = (await q("INSERT INTO branches (clinic_id, code, name, address, city, phone, opening_hours) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [clinicId, code, name, address, city, "+59120000000", JSON.stringify(hours)])).rows[0].id;
    const chairs: string[] = [];
    for (let i = 1; i <= nChairs; i++) chairs.push((await q("INSERT INTO chairs (clinic_id, branch_id, name) VALUES ($1,$2,$3) RETURNING id", [clinicId, id, `Consultorio ${i}`])).rows[0].id);
    branches.push({ id, code, chairs });
  }
  { const c = await db.adminPool.connect(); await seedCatalog(c, clinicId); await seedConsentTemplates(c, clinicId, null); c.release(); }

  async function user(email: string, name: string, role: string, opts: { branches?: string[]; all?: boolean; pro?: boolean; color?: string; pct?: number; license?: string } = {}) {
    const id = (await q("INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id", [email, name, pw])).rows[0].id;
    await q(`INSERT INTO memberships (clinic_id, user_id, role, all_branches, branch_ids, is_professional, color, commission_pct, professional_license)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [clinicId, id, role, opts.all ?? false, opts.branches ?? [], opts.pro ?? false, opts.color ?? null, opts.pct ?? null, opts.license ?? null]);
    return id as string;
  }
  const B = Object.fromEntries(branches.map((b) => [b.code, b]));
  await user("propietaria@demo.local", "Dra. Carolina Ríos (propietaria)", "owner", { all: true });
  await user("gerente@demo.local", "Lic. Marco Antezana (gerente)", "admin", { all: true });
  await user("contabilidad@demo.local", "Lic. Patricia Salazar (contabilidad)", "accountant", { all: true });
  for (const b of branches) await user(`recepcion.${b.code.toLowerCase()}@demo.local`, `Recepción ${b.code}`, "receptionist", { branches: [b.id] });
  const dentists = [
    { email: "dr.mendoza@demo.local", name: "Dr. Luis Mendoza", br: ["LPZ", "SUR"], color: "#2563eb", pct: 35 },
    { email: "dra.vargas@demo.local", name: "Dra. Elena Vargas", br: ["LPZ"], color: "#db2777", pct: 40 },
    { email: "dr.quispe@demo.local", name: "Dr. Jorge Quispe", br: ["EAL"], color: "#059669", pct: 35 },
    { email: "dra.rojas@demo.local", name: "Dra. Sofía Rojas", br: ["SUR"], color: "#d97706", pct: 40 },
    { email: "dr.claure@demo.local", name: "Dr. Andrés Claure", br: ["CBB"], color: "#7c3aed", pct: 35 },
    { email: "dra.suarez@demo.local", name: "Dra. Valeria Suárez", br: ["SCZ"], color: "#0891b2", pct: 40 },
    { email: "dr.justiniano@demo.local", name: "Dr. Raúl Justiniano", br: ["SCZ"], color: "#dc2626", pct: 30 },
  ];
  const dentistIds: { id: string; br: string[] }[] = [];
  for (const d of dentists) {
    const id = await user(d.email, d.name, "dentist", { branches: d.br.map((c) => B[c]!.id), pro: true, color: d.color, pct: d.pct, license: `MP-${Math.floor(rnd() * 90000 + 10000)}` });
    dentistIds.push({ id, br: d.br });
    // Mendoza: mañanas en LPZ y tardes en SUR
    for (const wd of [1, 2, 3, 4, 5]) {
      if (d.br.length === 2) {
        await q("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,'08:00','12:30')", [clinicId, id, B[d.br[0]!]!.id, wd]);
        await q("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,'14:30','19:00')", [clinicId, id, B[d.br[1]!]!.id, wd]);
      } else {
        await q("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,'08:00','12:30')", [clinicId, id, B[d.br[0]!]!.id, wd]);
        await q("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,'14:30','19:00')", [clinicId, id, B[d.br[0]!]!.id, wd]);
      }
    }
    await q("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) VALUES ($1,$2,$3,6,'08:00','12:00')", [clinicId, id, B[d.br[0]!]!.id]);
  }
  await user("asistente@demo.local", "Asistente Dental LPZ", "assistant", { branches: [B.LPZ!.id] });
  // Bioseguridad: personal de limpieza, un autoclave por sucursal y ciclos de ejemplo
  const supportId = await user("limpieza.lpz@demo.local", "Rosa Mamani (limpieza LPZ)", "support", { branches: [B.LPZ!.id] });
  for (const b of branches) {
    const st = (await q("INSERT INTO sterilizers (clinic_id, branch_id, name) VALUES ($1,$2,'Autoclave 1') RETURNING id", [clinicId, b.id])).rows[0].id;
    for (let k = 1; k <= 6; k++) {
      const at = DateTime.now().setZone(ZONE).minus({ days: 7 - k }).set({ hour: 8, minute: 30 });
      const cy = (await q(`INSERT INTO sterilization_cycles (clinic_id, branch_id, sterilizer_id, cycle_number, program, temperature_c, duration_min, load_description, packages, chemical_indicator, operator_id, run_at, expires_on)
        VALUES ($1,$2,$3,$4,'134C',134,18,'Kits de examen y fórceps',8,'pass',$5,$6,$7) RETURNING id`, [clinicId, b.id, st, k, supportId, at.toJSDate(), at.plus({ days: 30 }).toISODate()])).rows[0].id;
      if (k <= 4) await q("INSERT INTO sterilization_bio_results (clinic_id, cycle_id, result, recorded_by, recorded_at) VALUES ($1,$2,'pass',$3,$4)", [clinicId, cy, supportId, at.plus({ days: 1 }).toJSDate()]);
    }
  }

  // Pacientes ficticios
  const names = ["Ana", "Luis", "María", "Carlos", "Rosa", "Juan", "Lucía", "Pedro", "Carmen", "Diego", "Valeria", "Miguel", "Gabriela", "Fernando", "Daniela", "Javier", "Paola", "Ricardo", "Natalia", "Sergio", "Andrea", "Óscar", "Mónica", "Hugo", "Silvia"];
  const lasts = ["Mamani", "Quispe", "Choque", "Flores", "Gutiérrez", "Vargas", "Rojas", "Condori", "Fernández", "Torrez", "Mendoza", "Copa", "Huanca", "Gonzales", "Ortiz", "Peña", "Alanoca", "Suárez", "Limachi", "Rocha"];
  const patients: string[] = [];
  for (let i = 1; i <= 90; i++) {
    const fn = pick(names), ln = `${pick(lasts)} ${pick(lasts)}`;
    const doc = String(1000000 + Math.floor(rnd() * 8999999));
    const phone = `+5917${Math.floor(1000000 + rnd() * 8999999)}`;
    const birth = DateTime.fromISO("1950-01-01").plus({ days: Math.floor(rnd() * 20000) }).toISODate();
    const minor = DateTime.fromISO(birth!).plus({ years: 18 }) > DateTime.now();
    const id = (await q(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, document_issued, birth_date, sex, phone, city,
         guardian_name, consent_reminders, consent_updated_at, search_text, preferred_branch_id)
       VALUES ($1,$2,$3,$4,'CI',$5,$6,$7,$8,$9,$10,$11,$12, now(), $13, $14) RETURNING id`,
      [clinicId, i, fn, ln, doc, pick(["LP", "CB", "SC"]), birth, pick(["F", "M"]), phone, pick(["La Paz", "El Alto", "Cochabamba", "Santa Cruz"]),
        minor ? `Responsable de ${fn}` : null, rnd() > 0.25, normalize(`${fn} ${ln} ${doc} ${phone} ${i}`), pick(branches).id])).rows[0].id;
    patients.push(id);
  }
  await q("INSERT INTO counters (clinic_id, name, value) VALUES ($1,'patient',90)", [clinicId]);

  // Citas: 30 días atrás y 10 hacia adelante
  const procs = (await q("SELECT id, code, duration_min, price_cents FROM procedures WHERE clinic_id = $1", [clinicId])).rows;
  let created = 0;
  const today = DateTime.now().setZone(ZONE).startOf("day");
  for (let d = -30; d <= 10; d++) {
    const day = today.plus({ days: d });
    if (day.weekday === 7) continue;
    for (const dent of dentistIds) {
      const slots = day.weekday === 6 ? ["08:00", "09:00", "10:30"] : ["08:00", "09:00", "10:00", "11:00", "14:30", "15:30", "16:30", "17:30"];
      for (const s of slots) {
        if (rnd() < 0.35) continue;
        const start = DateTime.fromISO(`${day.toISODate()}T${s}`, { zone: ZONE });
        const branchCode = dent.br.length === 2 && start.hour >= 14 ? dent.br[1]! : dent.br[0]!;
        const pr = pick(procs.filter((p) => p.duration_min <= 60));
        const past = start.toMillis() < Date.now();
        const status = d < 0 || (d === 0 && past && start.toMillis() < Date.now() - 2 * 3_600_000)
          ? (rnd() < 0.82 ? "completed" : rnd() < 0.5 ? "no_show" : "cancelled")
          : d === 0 && past ? pick(["arrived", "in_progress", "completed"])
          : rnd() < 0.4 ? "confirmed" : "scheduled";
        try {
          await q(`INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, status, reason, cancel_reason)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [clinicId, B[branchCode]!.id, pick(B[branchCode]!.chairs), dent.id, pick(patients), pr.id, start.toJSDate(), start.plus({ minutes: pr.duration_min }).toJSDate(),
              status, null, status === "cancelled" ? "Paciente reprogramará" : null]);
          created++;
        } catch { /* choque de horario aleatorio: se omite */ }
      }
    }
  }

  // Presupuestos, tratamientos realizados y pagos
  let budgetNo = 0, receipt = 0;
  for (let i = 0; i < 45; i++) {
    const patient = pick(patients);
    const dent = pick(dentistIds);
    const branch = B[dent.br[0]!]!;
    const status = pick(["presented", "accepted", "accepted", "completed", "rejected", "draft"]);
    const created_at = today.minus({ days: Math.floor(rnd() * 28) }).plus({ hours: 10 });
    const budgetId = (await q(`INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status, installments, created_at, presented_at, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id`,
      [clinicId, ++budgetNo, branch.id, patient, dent.id, status, pick([1, 1, 3, 6]), created_at.toJSDate(), ["accepted", "completed", "rejected"].includes(status) ? created_at.plus({ days: 2 }).toJSDate() : null])).rows[0].id;
    const nItems = 1 + Math.floor(rnd() * 3);
    let total = 0;
    for (let k = 0; k < nItems; k++) {
      const pr = pick(procs.filter((p) => !["CON-01"].includes(p.code)));
      const tooth = pick([11, 12, 16, 21, 26, 36, 37, 46, 47]);
      const done = status === "completed" || (status === "accepted" && rnd() < 0.5);
      const item = (await q(`INSERT INTO budget_items (clinic_id, budget_id, procedure_id, tooth, surfaces, description, unit_price_cents, status, performed_by, performed_at, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [clinicId, budgetId, pr.id, tooth, ["OPE-01", "OPE-02", "PRE-03"].includes(pr.code) ? ["O"] : [], pr.code, pr.price_cents, done ? "done" : "pending", done ? dent.id : null, done ? created_at.plus({ days: 3 }).toJSDate() : null, k])).rows[0].id;
      await q("UPDATE budget_items bi SET description = p.name FROM procedures p WHERE p.id = bi.procedure_id AND bi.id = $1", [item]);
      total += pr.price_cents;
      if (done) {
        await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
                 SELECT $1,$2,$3,$4,$5,description,$6,$5,$7 FROM budget_items WHERE id = $4`,
          [clinicId, branch.id, patient, item, dent.id, pr.price_cents, created_at.plus({ days: 3 }).toJSDate()]);
      }
    }
    if (["accepted", "completed"].includes(status)) {
      const paid = Math.round(total * pick([0.3, 0.5, 1]) / 100) * 100;
      const method = pick(["cash", "cash", "transfer", "qr"]);
      const pending = method !== "cash" && rnd() < 0.3;
      await q(`INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, budget_id, amount_cents, method, status, bank_reference, idempotency_key, received_by, received_at, verified_by, verified_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12)`,
        [clinicId, ++receipt, branch.id, patient, budgetId, paid, method, pending ? "pending_verification" : "confirmed", method === "cash" ? null : `OP-${100000 + receipt}`,
          `seed-${receipt}`, dent.id, created_at.plus({ days: 2 }).toJSDate(), pending ? null : dent.id]);
    }
  }
  await q("INSERT INTO counters (clinic_id, name, value) VALUES ($1,'budget',$2), ($1,'receipt',$3)", [clinicId, budgetNo, receipt]);
  const rd = await seedRecallsDemo(db.adminPool, clinicId);
  console.log(`Tiempos de cita: ${rd.events} eventos · ${rd.recalls} controles · ${rd.unclosed} citas pasadas sin cerrar.`);
  await seedPerioDemo(q, clinicId, B.LPZ!.id, dentistIds[1]!.id);
  await seedCashAndFees(db, clinicId);
  await seedBudgetsV2(db.adminPool, clinicId);
  await seedPortalDemo(q, clinicId);
  await seedLabDemo(db.adminPool, clinicId);
  await seedAgendaPlusDemo(db.adminPool, clinicId);
  await seedMessagingDemo(q, clinicId);
  await seedDocumentsDemo(db, clinicId, cfg.publicUrl);
  await seedInventoryDemo(db.adminPool, clinicId);
  await seedClinicalFilesDemo(db, clinicId, cfg);
  await seedCoordinationDemo(db.adminPool, clinicId);
  await seedManagementDemo(db.adminPool, clinicId);
  await seedAgreementsDemo(db.adminPool, clinicId);
  console.log(`Clínica demo creada: 5 sucursales, ${dentists.length} odontólogos, 90 pacientes ficticios, ${created} citas, ${budgetNo} presupuestos.`);
  console.log(`Usuarios (contraseña "${PASSWORD}"): propietaria@demo.local, gerente@demo.local, contabilidad@demo.local, recepcion.lpz@demo.local, dr.mendoza@demo.local, limpieza.lpz@demo.local, superadmin@demo.local`);
} finally {
  await db.close();
}
