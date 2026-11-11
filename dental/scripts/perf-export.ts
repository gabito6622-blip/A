// Medición de exportaciones grandes (no corre en CI): primer byte, tiempo total y memoria máxima del
// proceso mientras se descarga. A diferencia de perf-bench.ts (fastify.inject junta toda la respuesta),
// aquí la app escucha en un puerto local y un cliente HTTP real descarta los bytes a medida que llegan.
//
//   PERF_DATABASE_URL=… npx tsx scripts/perf-export.ts "/api/patients/export.xlsx" [--reps=3] [--as=duena@perf.dentalia.test]
//
// Conviene medir cada ruta en un proceso aparte: la memoria residente (RSS) de Node casi no baja.
import http from "node:http";
import type { AddressInfo } from "node:net";

const url = process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_perf";
process.env.DATABASE_URL = url;
process.env.DENTAL_DISABLE_RATE_LIMIT = "1";
const target = process.argv[2];
if (!target) throw new Error("Indica la ruta, p. ej. /api/patients/export.xlsx");
const reps = Number(process.argv.find((a) => a.startsWith("--reps="))?.slice(7) ?? 3);
const as = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "duena@perf.dentalia.test";

const { loadConfig } = await import("../server/src/config.js");
const { createDb } = await import("../server/src/lib/db.js");
const { buildApp } = await import("../server/src/app.js");
const { MemoryMailer } = await import("../server/src/lib/mailer.js");

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
const app = await buildApp(cfg, db, { mailer: new MemoryMailer() });
await app.listen({ port: 0, host: "127.0.0.1" });
const port = (app.server.address() as AddressInfo).port;
const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: as, password: "Rendimiento2026" } });
if (login.statusCode !== 200) throw new Error(`No se pudo ingresar: ${login.body}`);
const cookie = String(login.headers["set-cookie"]).split(";")[0]!;

const mb = (b: number) => Math.round(b / 1024 / 1024);
function once(): Promise<{ status: number; ttfb: number; total: number; bytes: number; peakRss: number; peakHeap: number }> {
  return new Promise((resolve, reject) => {
    let peakRss = 0, peakHeap = 0;
    const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed + m.external + m.arrayBuffers); };
    const timer = setInterval(sample, 20);
    const t0 = performance.now();
    let ttfb = 0, bytes = 0;
    const req = http.get({ host: "127.0.0.1", port, path: target, headers: { cookie } }, (res) => {
      res.once("data", () => { ttfb = performance.now() - t0; });
      res.on("data", (ch: Buffer) => { bytes += ch.length; });
      res.on("end", () => {
        clearInterval(timer); sample();
        resolve({ status: res.statusCode ?? 0, ttfb, total: performance.now() - t0, bytes, peakRss, peakHeap });
      });
    });
    req.on("error", (e) => { clearInterval(timer); reject(e); });
  });
}

global.gc?.();
const base = process.memoryUsage();
console.log(`${target} — memoria antes: RSS ${mb(base.rss)} MB, heap+buffers ${mb(base.heapUsed + base.external + base.arrayBuffers)} MB`);
const rows: Awaited<ReturnType<typeof once>>[] = [];
for (let i = 0; i < reps; i++) {
  const r = await once();
  rows.push(r);
  console.log(`  #${i + 1}: ${r.status} · primer byte ${r.ttfb.toFixed(0)} ms · total ${r.total.toFixed(0)} ms · ${(r.bytes / 1024).toFixed(0)} kB · RSS máx ${mb(r.peakRss)} MB · heap+buffers máx ${mb(r.peakHeap)} MB`);
}
const med = (k: "ttfb" | "total") => [...rows].map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)]!;
console.log(`Mediana: primer byte ${med("ttfb").toFixed(0)} ms · total ${med("total").toFixed(0)} ms · RSS máx ${mb(Math.max(...rows.map((r) => r.peakRss)))} MB (antes ${mb(base.rss)}) · heap+buffers máx ${mb(Math.max(...rows.map((r) => r.peakHeap)))} MB`);
await app.close();
await db.close();
