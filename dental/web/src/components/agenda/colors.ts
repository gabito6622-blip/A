// Color de la agenda: por tipo de cita (por defecto), por profesional o por consultorio.
// Es una preferencia de cada persona y se guarda en este navegador (localStorage).
import { useState } from "react";

export type ColorMode = "type" | "dentist" | "chair";
export const COLOR_MODE_LABELS: Record<ColorMode, string> = { type: "Tipo de cita", dentist: "Profesional", chair: "Consultorio" };
const KEY = "agenda.colorBy";
export const NEUTRAL = "#64788a";
const PALETTE = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f", "#9333ea", "#0f766e"];

export function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const [mode, setMode] = useState<ColorMode>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "dentist" || v === "chair" || v === "type" ? v : "type";
    } catch { return "type"; }
  });
  const set = (m: ColorMode) => {
    setMode(m);
    try { localStorage.setItem(KEY, m); } catch { /* sin almacenamiento */ }
  };
  return [mode, set];
}

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const paletteFor = (id: string, index = -1) => PALETTE[(index >= 0 ? index : hash(id)) % PALETTE.length]!;

export interface ColorCtx { chairs: { id: string; name: string }[] }

export function colorFor(a: any, mode: ColorMode, ctx: ColorCtx): string {
  if (mode === "type") return a.typeColor ?? NEUTRAL;
  if (mode === "dentist") return a.dentistColor ?? paletteFor(a.dentistId);
  if (!a.chairId) return NEUTRAL;
  return paletteFor(a.chairId, ctx.chairs.findIndex((c) => c.id === a.chairId));
}

/** Fondo suave a partir del color (texto oscuro legible encima). */
export const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, white)`;

export interface LegendItem { key: string; label: string; color: string }

export function legendFor(mode: ColorMode, o: { types: any[]; appts: any[]; staff: any[]; chairs: { id: string; name: string }[] }): LegendItem[] {
  if (mode === "type") {
    return [...o.types.map((t) => ({ key: t.id, label: t.name, color: t.color })), { key: "none", label: "Sin tipo", color: NEUTRAL }];
  }
  if (mode === "dentist") {
    const ids = new Map<string, LegendItem>();
    for (const a of o.appts) if (!ids.has(a.dentistId)) ids.set(a.dentistId, { key: a.dentistId, label: a.dentistName, color: a.dentistColor ?? paletteFor(a.dentistId) });
    for (const s of o.staff) if (!ids.has(s.userId) && o.appts.length === 0) ids.set(s.userId, { key: s.userId, label: s.fullName, color: s.color ?? paletteFor(s.userId) });
    return [...ids.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  return [...o.chairs.map((c, i) => ({ key: c.id, label: c.name, color: paletteFor(c.id, i) })), { key: "none", label: "Sin consultorio", color: NEUTRAL }];
}
