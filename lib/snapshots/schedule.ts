// Versão: 1.0 | Data: 15/07/2026
// Agenda de atualização de um snapshot — presets simples (manual / a cada
// hora / diário HH:MM / semanal dia+HH:MM), no fuso de Brasília. Como em
// lib/date/today.ts, Brasília é tratada como UTC-3 fixo (sem horário de verão
// desde 2019): wall clock = UTC − 3h.
import type { RefreshMode } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const BRASILIA_OFFSET_MS = 3 * HOUR_MS;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" válido? (usado também na validação das server actions) */
export function isValidTime(s: string | null | undefined): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/**
 * Próximo disparo da agenda, em UTC. Manual → null. Hourly → agora + 1h.
 * Daily/weekly → próxima ocorrência de HH:MM (Brasília); weekly usa o dia ISO
 * (1 = segunda … 7 = domingo). Hora inválida/ausente cai em 06:00.
 */
export function computeNextRefreshAt(
  mode: RefreshMode,
  time?: string | null,
  weekday?: number | null,
  now: Date = new Date()
): Date | null {
  if (mode === "manual") return null;
  if (mode === "hourly") return new Date(now.getTime() + HOUR_MS);

  const [h, m] = isValidTime(time) ? time.split(":").map(Number) : [6, 0];
  // Relógio de parede de Brasília representado em campos UTC.
  const wall = new Date(now.getTime() - BRASILIA_OFFSET_MS);
  let target = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    h,
    m
  );

  if (mode === "daily") {
    if (target <= wall.getTime()) target += DAY_MS;
  } else {
    // weekly
    const wd =
      typeof weekday === "number" && weekday >= 1 && weekday <= 7 ? weekday : 1;
    const targetIso = ((new Date(target).getUTCDay() + 6) % 7) + 1;
    let delta = (wd - targetIso + 7) % 7;
    if (delta === 0 && target <= wall.getTime()) delta = 7;
    target += delta * DAY_MS;
  }

  return new Date(target + BRASILIA_OFFSET_MS);
}
