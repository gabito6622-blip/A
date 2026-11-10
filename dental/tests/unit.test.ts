import { describe, expect, it } from "vitest";
import { mergeIntervals, slotStarts, subtract, workIntervalsForDay } from "../server/src/lib/slots.js";
import { permissionsFor } from "../server/src/lib/rbac.js";
import { normalize, normalizePhone } from "../server/src/lib/text.js";
import { hashPassword, passwordProblem, verifyPassword } from "../server/src/lib/password.js";

const H = 3_600_000;

describe("cálculo de horarios libres", () => {
  it("une intervalos superpuestos y contiguos", () => {
    expect(mergeIntervals([[0, 2], [1, 3], [3, 4], [6, 7]])).toEqual([[0, 4], [6, 7]]);
  });
  it("resta ocupados a la jornada", () => {
    expect(subtract([[8 * H, 12 * H]], [[9 * H, 10 * H], [11 * H, 13 * H]])).toEqual([[8 * H, 9 * H], [10 * H, 11 * H]]);
  });
  it("genera inicios que caben completos", () => {
    const starts = slotStarts([[8 * H, 9 * H]], 30, 15);
    expect(starts.map((t) => (t - 8 * H) / 60000)).toEqual([0, 15, 30]);
  });
  it("respeta notBefore (no ofrece horas pasadas)", () => {
    expect(slotStarts([[8 * H, 10 * H]], 30, 30, 9 * H + 1)).toEqual([9.5 * H]);
    expect(slotStarts([[8 * H, 10 * H]], 60, 30, 9 * H + 1)).toEqual([]);
  });
  it("aplica la zona horaria de la clínica (La Paz = UTC-4)", () => {
    const [[s]] = workIntervalsForDay("2026-03-02", "America/La_Paz", [{ start: "08:00", end: "12:00" }]) as [[number, number]];
    expect(new Date(s).toISOString()).toBe("2026-03-02T12:00:00.000Z");
  });
});

describe("roles y permisos", () => {
  it("recepción no accede a lo clínico ni verifica pagos", () => {
    const p = permissionsFor("receptionist", false);
    expect(p.has("clinical.read")).toBe(false);
    expect(p.has("payments.verify")).toBe(false);
    expect(p.has("payments.create")).toBe(true);
  });
  it("el propietario solo ve lo clínico si además es profesional", () => {
    expect(permissionsFor("owner", false).has("clinical.read")).toBe(false);
    expect(permissionsFor("owner", true).has("clinical.read")).toBe(true);
  });
  it("contabilidad no modifica pacientes", () => {
    expect(permissionsFor("accountant", false).has("patients.write")).toBe(false);
  });
});

describe("utilidades", () => {
  it("normaliza tildes y mayúsculas", () => expect(normalize("  José  ÑANDÚ ")).toBe("jose nandu"));
  it("convierte celulares bolivianos a E.164", () => {
    expect(normalizePhone("7123-4567")).toBe("+59171234567");
    expect(normalizePhone("59161234567")).toBe("+59161234567");
  });
  it("hashea y verifica contraseñas", async () => {
    const h = await hashPassword("Secreta12345");
    expect(await verifyPassword("Secreta12345", h)).toBe(true);
    expect(await verifyPassword("otra", h)).toBe(false);
  });
  it("exige contraseñas razonables", () => {
    expect(passwordProblem("corta1")).toBeTruthy();
    expect(passwordProblem("soloLetrasLargas")).toBeTruthy();
    expect(passwordProblem("Larga123456")).toBeNull();
  });
});
