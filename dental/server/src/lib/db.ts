// Acceso a PostgreSQL.
//
// Dos pools:
//  * appPool: cada conexión ejecuta `SET ROLE dental_app` al abrirse. Ese rol no es dueño
//    de las tablas ni tiene BYPASSRLS, así que Row Level Security se aplica SIEMPRE.
//  * adminPool: rol dueño. Solo para migraciones, semillas y métricas agregadas de plataforma.
//
// withTenant() abre una transacción y fija app.clinic_id / app.user_id con alcance local
// a esa transacción (set_config(..., true)), así una conexión reutilizada nunca arrastra
// el contexto de otra petición.
import pg from "pg";

// Las columnas bigint (centavos) llegan como string; las convertimos a number.
// Seguro mientras los montos < 2^53 centavos (≈ 90 billones de Bs).
pg.types.setTypeParser(20, (v) => Number(v));
// Fechas "date" como texto YYYY-MM-DD (sin conversión de zona horaria).
pg.types.setTypeParser(1082, (v) => v);
// numeric como number
pg.types.setTypeParser(1700, (v) => Number(v));

export type Client = pg.PoolClient;

export interface Db {
  appPool: pg.Pool;
  adminPool: pg.Pool;
  close(): Promise<void>;
}

// Pools cuyas conexiones deben operar SIEMPRE como dental_app (RLS obligatorio).
const APP_POOLS = new WeakSet<pg.Pool>();

export function createDb(databaseUrl: string): Db {
  const appPool = new pg.Pool({ connectionString: databaseUrl, max: 15 });
  APP_POOLS.add(appPool);
  appPool.on("connect", (client) => {
    client.query("SET ROLE dental_app").catch(() => {});
  });
  const adminPool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  return {
    appPool,
    adminPool,
    async close() {
      await appPool.end();
      await adminPool.end();
    },
  };
}

export interface TenantCtx {
  clinicId: string | null;
  userId: string | null;
}

/** Ejecuta fn dentro de una transacción con el contexto de clínica/usuario fijado. */
export async function withTenant<T>(pool: pg.Pool, ctx: TenantCtx, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Verificación defensiva: nunca operar como dueño/superusuario desde la app.
    if (APP_POOLS.has(pool)) {
      const r = await client.query<{ role: string }>("SELECT current_user AS role");
      if (r.rows[0]?.role !== "dental_app") await client.query("SET ROLE dental_app");
    }
    await client.query("SELECT set_config('app.clinic_id', $1, true), set_config('app.user_id', $2, true)", [
      ctx.clinicId ?? "",
      ctx.userId ?? "",
    ]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Siguiente número correlativo por clínica (fichas, presupuestos, recibos). Bloquea la fila. */
export async function nextCounter(c: Client, clinicId: string, name: string): Promise<number> {
  const r = await c.query<{ value: number }>(
    `INSERT INTO counters (clinic_id, name, value) VALUES ($1, $2, 1)
     ON CONFLICT (clinic_id, name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [clinicId, name],
  );
  return r.rows[0]!.value;
}
