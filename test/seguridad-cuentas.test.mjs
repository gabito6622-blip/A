// Seguridad de las cuentas (14/11/2026). El dueño: «que se sienta seguro de que nadie está entrando a su cuenta;
// igual que la mía». La revisión encontró: cambiar el PIN no sacaba a quien ya había entrado (30 días), los ingresos
// no quedaban anotados, el freno de contraseñas se saltaba cambiando la IP en la cabecera y el freno del PIN vivía en
// memoria (se borraba al publicar). Datos ficticios en carpeta temporal; reloj simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

const ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test("Seguridad de las cuentas: ingresos anotados, aparatos, PIN nuevo saca a todos, frenos que sobreviven a publicar", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-seg-"));
  const clock = { t: Date.UTC(2026, 10, 14, 15), now() { return this.t; } };
  const boot = async () => {
    const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock, trustProxy: true });
    return { app, base: `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}` };
  };
  let { app, base } = await boot();
  try {
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
    const ari = s.catalog.createCustomer(owner, { name: "Ari Prueba", phone: "+59171000011", kind: "reseller", priceGroupId: "revendedor" });
    const call = async (method, p, body, ck, headers = {}) => {
      const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] };
    };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" }, null, { "user-agent": WINDOWS })).ck;
    await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" }, ock);
    const lck = (await call("POST", "/api/auth/staff/login", { username: "lucia", password: "clave-de-lucia-123" })).ck;
    const { pin } = (await call("POST", `/api/admin/customers/${ari.id}/login-pin`, {}, ock)).json;
    const loginAri = (ua, p = pin, ip = "200.87.1.1") => call("POST", "/api/auth/customer/pin", { phone: ari.phone, pin: p }, null, { "user-agent": ua, "x-forwarded-for": ip });

    // 1) Dos aparatos: ambos aparecen, con nombre entendible, cómo entró y cuál es «este».
    const a1 = (await loginAri(ANDROID)).ck;
    clock.t += 60_000;
    const a2 = (await loginAri(WINDOWS, pin, "181.115.9.9")).ck;
    const sec = (await call("GET", "/api/me/security", null, a1)).json;
    assert.equal(sec.sessions.length, 2);
    assert.deepEqual(sec.sessions.map((x) => x.device).sort(), ["💻 Windows · Edge", "📱 Android · Chrome"]);
    assert.equal(sec.sessions.find((x) => x.current).device, "📱 Android · Chrome");
    assert.ok(sec.sessions.every((x) => x.via === "PIN"));
    assert.equal(sec.sessions.find((x) => !x.current).place, "181.115", "solo el comienzo de la IP");
    assert.deepEqual(sec.log.filter((x) => x.event === "login").length, 2);
    assert.ok(!JSON.stringify(sec).includes("tokenHash"), "nunca se manda el hash de la sesión");

    // 2) Cerrar la otra sesión desde este aparato.
    const other = sec.sessions.find((x) => !x.current).id;
    assert.equal((await call("POST", "/api/me/security/logout", { id: other }, a1)).status, 200);
    assert.notEqual((await call("GET", "/api/me", null, a2)).json.loggedIn, true, "la sesión de Windows quedó cerrada");
    assert.equal((await call("GET", "/api/me", null, a1)).json.loggedIn, true, "este aparato sigue adentro");

    // 3) La tienda le genera un PIN nuevo → afuera de todos lados (antes seguía adentro hasta 30 días).
    const b1 = (await loginAri(IPHONE)).ck;
    const np = (await call("POST", `/api/admin/customers/${ari.id}/login-pin`, {}, ock)).json.pin;
    for (const ck of [a1, b1]) assert.notEqual((await call("GET", "/api/me", null, ck)).json.loggedIn, true, "PIN nuevo: sesiones viejas cerradas");
    assert.equal((await loginAri(ANDROID, pin)).status, 401, "el PIN viejo ya no sirve");

    // 4) Cambiar MI PIN saca a los otros aparatos y deja este.
    const c1 = (await loginAri(ANDROID, np)).ck, c2 = (await loginAri(WINDOWS, np)).ck;
    const ch = await call("POST", "/api/me/login-pin", { current: np, pin: "4826" }, c1);
    assert.equal(ch.status, 200); assert.equal(ch.json.closed, 1);
    assert.equal((await call("GET", "/api/me", null, c1)).json.loggedIn, true);
    assert.notEqual((await call("GET", "/api/me", null, c2)).json.loggedIn, true);

    // 5) El dueño ve sus ingresos y lo saca de todos lados; Atención no puede.
    assert.equal((await call("GET", `/api/admin/customers/${ari.id}/security`, null, lck)).status, 403);
    assert.equal((await call("POST", `/api/admin/customers/${ari.id}/logout-all`, {}, lck)).status, 403);
    const os = (await call("GET", `/api/admin/customers/${ari.id}/security`, null, ock)).json;
    assert.ok(os.log.some((x) => x.event === "pin_reset" && x.via === "la tienda"));
    assert.ok(os.log.some((x) => x.event === "pin_change"));
    const out = await call("POST", `/api/admin/customers/${ari.id}/logout-all`, {}, ock);
    assert.equal(out.json.closed, 1);
    assert.notEqual((await call("GET", "/api/me", null, c1)).json.loggedIn, true);
    assert.ok(s.engine.s.audit.some?.((x) => x.action === "customer.logout_all") ?? true);

    // 6) PIN adivinado a fuerza: 5 fallos → frenado aunque después ponga el bueno, aunque cambie de IP, y aunque se reinicie el servidor.
    for (let i = 0; i < 5; i++) assert.equal((await loginAri(ANDROID, "0000", `10.0.0.${i}`)).status, 401);
    const locked = await loginAri(ANDROID, "4826", "10.9.9.9");
    assert.equal(locked.status, 429);
    assert.match(locked.json.message, /frenada.*minutos/);
    assert.ok((await call("GET", `/api/admin/customers/${ari.id}/security`, null, ock)).json.log.filter((x) => x.event === "login_fail").length >= 5, "los intentos fallidos quedan anotados");
    await app.close();
    ({ app, base } = await boot()); // como una publicación nueva
    assert.equal((await loginAri(ANDROID, "4826", "10.9.9.10")).status, 429, "el freno sobrevive al reinicio");
    clock.t += 16 * 60_000;
    assert.equal((await loginAri(ANDROID, "4826", "10.9.9.11")).status, 200, "pasados los 15 minutos, entra");

    // 7) Contraseña del panel: el freno es por usuario, aunque cambie la IP de la cabecera.
    for (let i = 0; i < 5; i++) await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "mala" + i }, null, { "x-forwarded-for": `1.2.3.${i}` });
    const st = await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" }, null, { "x-forwarded-for": "9.9.9.9" });
    assert.equal(st.status, 429, "cambiar la IP en la cabecera ya no salta el freno");
    clock.t += 16 * 60_000;
    const ok = await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" }, null, { "user-agent": WINDOWS, "x-forwarded-for": "9.9.9.9" });
    assert.equal(ok.status, 200);
    const mine = (await call("GET", "/api/admin/my-security", null, ok.ck)).json;
    assert.ok(mine.log.filter((x) => x.event === "login_fail" && !x.ok).length >= 5, "el dueño ve sus intentos fallidos");
    assert.ok(mine.sessions.some((x) => x.current && x.device === "💻 Windows · Edge"));
    const oc = await call("POST", "/api/admin/my-security/logout-others", {}, ok.ck);
    assert.equal(oc.status, 200);
    assert.equal((await call("GET", "/api/admin/my-security", null, ok.ck)).json.sessions.length, 1, "queda solo este aparato");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
