// Datos FICTICIOS para las capturas del video promo de Barbiño (solo en una base local de desarrollo).
// Llena la barbería «pardo» con barberos, servicios, clientes, turnos de hoy y de la semana,
// 30 días de ventas, productos y reseñas, para que el panel se vea como en un día real.
// Uso (desde la carpeta de gabo-barber, con la base local y el seed normal ya corridos):
//   MIGRATION_DATABASE_URL=postgresql://gabo_owner:gabo_owner_dev@localhost:5432/gabo node seed-video.mjs
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const pg = require("pg");

const db = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await db.connect();
const q = (sql, args) => db.query(sql, args).then((r) => r.rows);
const one = async (sql, args) => (await q(sql, args))[0];

const shop = await one(`SELECT id FROM barbershop WHERE slug = 'pardo'`);
const owner = await one(`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`);
const S = shop.id;
if ((await one(`SELECT count(*)::int n FROM barber WHERE barbershop_id = $1`, [S])).n > 0) {
  console.log("Ya tiene datos de video.");
  process.exit(0);
}
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

await q(`BEGIN`);
// Marca de la barbería
await q(
  `INSERT INTO barbershop_branding (barbershop_id, primary_color, accent_color, theme_mode, font_style, tagline, about, address, instagram, updated_at)
   VALUES ($1, '#1F5F4F', '#C9A15A', 'DARK', 'MODERN', 'Cortes con estilo en el centro de Santa Cruz', 'Barbería clásica y moderna. Reservá online en 1 minuto.', 'Calle Libertad 245, Santa Cruz', 'pardobarberclub', now())
   ON CONFLICT (barbershop_id) DO UPDATE SET theme_mode = 'DARK', tagline = excluded.tagline, about = excluded.about, address = excluded.address, instagram = excluded.instagram`,
  [S],
);

// Barberos
const barbers = [];
for (const [i, [name, spec, pct]] of [["Camilo", "Degradados y diseños", 50], ["Diego", "Barba y navaja", 45], ["Mateo", "Cortes clásicos", 50], ["Luis", "Color y perfilado", 40]].entries()) {
  barbers.push(await one(`INSERT INTO barber (barbershop_id, display_name, specialty, sort_order, commission_percent, updated_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING id, display_name`, [S, name, spec, i, pct]));
}
// Servicios
const services = [];
for (const [i, [name, min, bs, desc]] of [
  ["Corte clásico", 30, 50, "Tijera y máquina, con lavado."],
  ["Degradado (fade)", 45, 70, "Fade bajo, medio o alto, terminado a navaja."],
  ["Corte + barba", 60, 90, "El combo más pedido."],
  ["Perfilado de barba", 30, 40, "Toalla caliente y navaja."],
  ["Diseño / líneas", 15, 25, "Líneas y figuras a pedido."],
  ["Cejas", 10, 15, "Perfilado con navaja."],
].entries()) {
  services.push(await one(`INSERT INTO service (barbershop_id, name, description, duration_min, price_cents, sort_order, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id, name, duration_min, price_cents`, [S, name, desc, min, bs * 100, i]));
}
// Horarios: lunes a sábado 9:00–20:00 (en minutos)
for (let wd = 1; wd <= 6; wd++) await q(`INSERT INTO working_hours (barbershop_id, weekday, opens_min, closes_min, updated_at) VALUES ($1,$2,540,1200,now())`, [S, wd]);
await q(
  `INSERT INTO booking_settings (barbershop_id, deposit_enabled, deposit_percent, deposit_hold_min, deposit_account_holder, deposit_instructions, min_notice_min, updated_at)
   VALUES ($1, true, 25, 60, 'Pardo Barber Club', 'Escaneá el QR y subí la captura del pago.', 30, now())
   ON CONFLICT (barbershop_id) DO UPDATE SET deposit_enabled = true`,
  [S],
);

// Clientes
const NAMES = ["Martín Rojas", "Santiago Pérez", "Diego Vargas", "Andrés Gutiérrez", "Rodrigo Vaca", "Fernando Áñez", "Jorge Ribera", "Lucas Paz", "Mauricio Justiniano", "Sebastián Suárez", "Gabriel Montaño", "Nicolás Antelo", "Joaquín Saavedra", "Tomás Roca", "Matías Melgar", "Bruno Céspedes", "Álvaro Salvatierra", "Iván Moreno", "Pablo Chávez", "Kevin Flores", "Adrián Arteaga", "Emiliano Soliz", "Ricardo Banzer", "Daniel Ortiz", "Franco Pinto", "Hugo Mercado", "Leandro Quiroga", "Óscar Terceros"];
const TAGS = [["VIP"], [], ["Frecuente"], [], ["Nuevo"], ["VIP", "Frecuente"], [], ["Frecuente"]];
const customers = [];
for (const [i, name] of NAMES.entries()) {
  customers.push(await one(
    `INSERT INTO customer (barbershop_id, name, phone, tags, source, marketing_opt_in, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' days')::interval, now()) RETURNING id, name`,
    [S, name, `+5917${String(1000000 + i * 37129).slice(0, 7)}`, TAGS[i % TAGS.length], i % 3 ? "ONLINE" : "PANEL", false, 20 + i * 7],
  ));
}

// La Paz = UTC-4. Fecha base: hoy en La Paz.
const DAY = 864e5;
const now = Date.now();
const lpMidnight = (offsetDays) => {
  const d = new Date(now - 4 * 3600e3 + offsetDays * DAY);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 4 * 3600e3; // 00:00 La Paz en UTC
};
const at = (offsetDays, h, m = 0) => new Date(lpMidnight(offsetDays) + (h * 60 + m) * 60e3);

// Caja abierta (todas las ventas de demo cuelgan de esta caja)
const cash = await one(`INSERT INTO cash_session (barbershop_id, opened_by, opened_at, opening_cents) VALUES ($1,$2,$3,20000) RETURNING id`, [S, owner.id, new Date(now - 31 * DAY)]);
let saleNo = 0;
async function sale({ when, customer, barber, svc, method, tip = 0, appointmentId = null, product = null }) {
  saleNo++;
  const items = [{ kind: "SERVICE", service_id: svc.id, product_id: null, description: svc.name, qty: 1, unit: svc.price_cents }];
  if (product) items.push({ kind: "PRODUCT", service_id: null, product_id: product.id, description: product.name, qty: 1, unit: product.price_cents });
  const subtotal = items.reduce((a, b) => a + b.unit * b.qty, 0);
  await q(`SET CONSTRAINTS ALL DEFERRED`);
  const s = await one(
    `INSERT INTO sale (barbershop_id, number, cash_session_id, customer_id, appointment_id, barber_id, subtotal_cents, total_cents, tip_cents, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10) RETURNING id`,
    [S, saleNo, cash.id, customer.id, appointmentId, barber.id, subtotal, tip, owner.id, when],
  );
  for (const it of items) {
    const si = await one(`INSERT INTO sale_item (barbershop_id, sale_id, kind, service_id, product_id, description, quantity, unit_price_cents, total_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [S, s.id, it.kind, it.service_id, it.product_id, it.description, it.qty, it.unit, it.unit * it.qty]);
    if (it.kind === "PRODUCT") await q(`INSERT INTO stock_movement (barbershop_id, product_id, kind, quantity, sale_item_id, created_by, created_at) VALUES ($1,$2,'SALE',-1,$3,$4,$5)`, [S, it.product_id, si.id, owner.id, when]);
  }
  await q(`INSERT INTO sale_payment (barbershop_id, sale_id, method, amount_cents, reference, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [S, s.id, method, subtotal + tip, method === "QR" ? `QR${100000 + saleNo}` : null, when]);
}

// Productos
const cat = await one(`INSERT INTO product_category (barbershop_id, name, kind, updated_at) VALUES ($1,'Cuidado del cabello','PRODUCT',now()) RETURNING id`, [S]);
const drinks = await one(`INSERT INTO product_category (barbershop_id, name, kind, updated_at) VALUES ($1,'Bebidas','DRINK',now()) RETURNING id`, [S]);
const products = [];
for (const [name, bs, cost, stock, catId, min] of [["Cera mate", 60, 30, 14, cat.id, 5], ["Pomada brillo", 65, 32, 9, cat.id, 5], ["Aceite para barba", 80, 40, 3, cat.id, 5], ["Shampoo anticaspa", 55, 25, 11, cat.id, 4], ["Cerveza artesanal", 20, 10, 24, drinks.id, 6], ["Café americano", 12, 4, 40, drinks.id, 10]]) {
  const p = await one(`INSERT INTO product (barbershop_id, category_id, name, price_cents, cost_cents, min_stock, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id, name, price_cents`, [S, catId, name, bs * 100, cost * 100, min]);
  await q(`INSERT INTO stock_movement (barbershop_id, product_id, kind, quantity, unit_cost_cents, created_by, created_at) VALUES ($1,$2,'INITIAL',$3,$4,$5,$6)`, [S, p.id, stock + 8, cost * 100, owner.id, new Date(now - 31 * DAY)]);
  products.push(p);
}

// Historial: 30 días de turnos atendidos con su venta
async function appointment({ day, h, m, barber, svc, customer, status, source = "ONLINE", deposit = false, checkedIn = false }) {
  const start = at(day, h, m);
  const end = new Date(start.getTime() + svc.duration_min * 60e3);
  const dep = deposit ? Math.round(svc.price_cents * 0.25) : 0;
  const extra = status === "PENDING_DEPOSIT" ? { due: new Date(now + 50 * 60e3) } : {};
  return one(
    `INSERT INTO appointment (barbershop_id, barber_id, service_id, customer_id, starts_at, ends_at, status, source, price_cents, duration_min, deposit_cents, deposit_due_at, deposit_paid_at, proof_submitted_at, checked_in_at, created_by, created_at, updated_at, blocked_until, services_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),$6,$18) RETURNING id`,
    [S, barber.id, svc.id, customer.id, start, end, status, source, svc.price_cents, svc.duration_min, dep, extra.due ?? (dep ? start : null),
      dep && status !== "PENDING_DEPOSIT" && status !== "DEPOSIT_UNDER_REVIEW" ? new Date(start.getTime() - DAY) : null,
      status === "DEPOSIT_UNDER_REVIEW" ? new Date(now - 10 * 60e3) : null, checkedIn ? new Date(now - 5 * 60e3) : null, owner.id, new Date(start.getTime() - 2 * DAY), svc.name],
  );
}
const weights = [0, 1, 1, 2, 2, 2, 3, 1, 0, 3];
for (let d = -30; d <= -1; d++) {
  const wd = new Date(lpMidnight(d) - 4 * 3600e3).getUTCDay();
  if (wd === 0) continue;
  for (const barber of barbers) {
    let t = 9 * 60 + Math.floor(rnd() * 3) * 15;
    const n = 3 + Math.floor(rnd() * 4) + (wd >= 5 ? 2 : 0);
    for (let k = 0; k < n && t < 19 * 60; k++) {
      const svc = services[pick(weights)];
      const customer = pick(customers);
      const status = rnd() < 0.06 ? "NO_SHOW" : "COMPLETED";
      const ap = await appointment({ day: d, h: Math.floor(t / 60), m: t % 60, barber, svc, customer, status, source: rnd() < 0.7 ? "ONLINE" : "WALK_IN" });
      if (status === "COMPLETED") {
        await sale({ when: at(d, Math.floor(t / 60), (t % 60) + svc.duration_min), customer, barber, svc, method: pick(["CASH", "QR", "QR", "CARD"]), tip: rnd() < 0.3 ? 1000 : 0, appointmentId: ap.id, product: rnd() < 0.18 ? pick(products) : null });
        if (rnd() < 0.45) {
          const rating = rnd() < 0.85 ? 5 : 4;
          await q(`INSERT INTO review (barbershop_id, appointment_id, customer_id, barber_id, token_hash, rating, comment, requested_at, submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [S, ap.id, customer.id, barber.id, `demo-${ap.id}`, rating, pick(["Excelente atención, el fade quedó perfecto.", "Puntuales y muy buen ambiente.", "El mejor corte que me hicieron.", "Reservar fue facilísimo.", null, "10/10, vuelvo seguro."]), at(d, 21)]);
        }
      }
      t += svc.duration_min + pick([0, 15, 15, 30, 45]);
    }
  }
}

// Hoy: agenda llena con distintos estados
const nowLp = new Date(now - 4 * 3600e3);
const nowMin = nowLp.getUTCHours() * 60 + nowLp.getUTCMinutes();
const todayPlan = [
  [0, [[9, 0, 1], [9, 45, 2], [11, 0, 0], [12, 0, 1], [15, 0, 2], [16, 0, 1], [17, 0, 0], [18, 0, 1]]],
  [1, [[9, 30, 3], [10, 0, 2], [11, 30, 3], [14, 0, 2], [15, 30, 0], [17, 0, 3], [18, 30, 2]]],
  [2, [[10, 0, 0], [10, 30, 1], [12, 0, 0], [14, 30, 2], [16, 0, 1], [17, 30, 0]]],
  [3, [[9, 0, 1], [11, 0, 2], [13, 0, 1], [15, 0, 0], [16, 30, 2], [18, 0, 1]]],
];
let ci = 0;
for (const [bi, slots] of todayPlan) {
  for (const [h, m, si] of slots) {
    const svc = services[si];
    const customer = customers[ci++ % customers.length];
    const startMin = h * 60 + m;
    let status = "CONFIRMED";
    if (startMin + svc.duration_min <= nowMin) status = "COMPLETED";
    else if (ci % 7 === 3) status = "DEPOSIT_UNDER_REVIEW";
    else if (ci % 9 === 5) status = "PENDING_DEPOSIT";
    const ap = await appointment({ day: 0, h, m, barber: barbers[bi], svc, customer, status, deposit: status !== "COMPLETED" && ci % 2 === 0 || status.startsWith("DEPOSIT") || status === "PENDING_DEPOSIT", checkedIn: status === "CONFIRMED" && startMin <= nowMin + 10 });
    if (status === "COMPLETED") await sale({ when: at(0, h, m + svc.duration_min), customer, barber: barbers[bi], svc, method: pick(["CASH", "QR"]), appointmentId: ap.id });
  }
}
// Resto de la semana
for (let d = 1; d <= 5; d++) {
  for (const barber of barbers) {
    let t = 9 * 60 + Math.floor(rnd() * 4) * 30;
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n && t < 19 * 60; k++) {
      const svc = services[pick(weights)];
      await appointment({ day: d, h: Math.floor(t / 60), m: t % 60, barber, svc, customer: pick(customers), status: "CONFIRMED", deposit: rnd() < 0.5 });
      t += svc.duration_min + pick([15, 30, 60, 90]);
    }
  }
}
await q(`COMMIT`);
console.log(`Listo: ${barbers.length} barberos, ${services.length} servicios, ${customers.length} clientes, ${saleNo} ventas.`);
await db.end();
