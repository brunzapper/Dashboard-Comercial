// Versão: 1.0 | Data: 09/09/2026
// A CASCATA DA CADÊNCIA — pura.
//
// O pedido: "por padrão quinzenal, mas deve poder ser configurado o padrão por
// responsável, registro, etapa ou qualquer outro campo do registro". A decisão
// tomada com o usuário foi: o PADRÃO e a ORDEM DE PRECEDÊNCIA vivem no esquema
// (o construtor declara quem pode sobrescrever), e as EXCEÇÕES são DADO — uma
// linha em `series_settings`, editável na Tree ou num painel por um gestor,
// sem abrir o construtor e sem versionar o fluxo inteiro.
//
// A mesma cascata resolve o "ativar/desativar por responsável específico":
// `active = false` num escopo alcançado desliga a série ali. É de propósito que
// as duas coisas andem juntas — quem sabe dizer "o João é mensal" é quem sabe
// dizer "o João não participa".
import { recordRawValue } from "@/lib/widgets/quick-filters";
import type { AvailableField } from "@/lib/widgets/fields";
import type { RecordRow } from "@/lib/records/types";

import type { SeriesCadence, SeriesScopeKind, SeriesScopeSpec } from "./types";

/** Uma exceção gravada (linha de series_settings). */
export interface SeriesSetting {
  scopeKind: SeriesScopeKind;
  /** id do registro/responsável, ou "<ref>=<valor>" no escopo de campo. */
  scopeValue: string;
  /** null = não mexe na cadência (a linha existe só para ligar/desligar). */
  cadenceDays: number | null;
  active: boolean;
}

export interface CadenceResolution {
  days: number;
  /** A série está ligada para este registro? */
  active: boolean;
  /** Qual escopo decidiu a cadência (null = o padrão do esquema). */
  fromScope: SeriesScopeSpec | null;
  /** Qual escopo desligou, quando desligado. */
  disabledBy: SeriesScopeSpec | null;
}

/** Chave de um escopo para um registro concreto — a mesma que a linha grava. */
export function scopeValueFor(
  scope: SeriesScopeSpec,
  record: RecordRow,
  available: AvailableField[]
): string | null {
  if (scope.kind === "record") return record.id;
  if (scope.kind === "responsible") {
    const id = record.responsible_id;
    return typeof id === "string" && id !== "" ? id : null;
  }
  if (!scope.field) return null;
  const raw = recordRawValue(scope.field, record, available);
  const value = raw == null ? "" : String(raw).trim();
  // Campo vazio não vira exceção: "" casaria com toda linha sem valor.
  return value === "" ? null : `${scope.field}=${value}`;
}

function keyOf(kind: SeriesScopeKind, value: string): string {
  return `${kind} ${value}`;
}

export function settingsIndex(
  settings: SeriesSetting[]
): Map<string, SeriesSetting> {
  const out = new Map<string, SeriesSetting>();
  for (const s of settings) out.set(keyOf(s.scopeKind, s.scopeValue), s);
  return out;
}

/**
 * Resolve a cadência efetiva e se a série está ligada.
 *
 * Duas travessias com regras DIFERENTES, de propósito:
 *  - CADÊNCIA: o primeiro escopo com número gravado vence (precedência
 *    declarada); ninguém gravou = o padrão do esquema.
 *  - LIGADO: QUALQUER escopo alcançado que diga `active: false` desliga. Um
 *    "não" é mais forte que um "sim" — desligar para um responsável não pode
 *    ser anulado por uma exceção de cadência mais específica.
 */
export function resolveCadence(
  cadence: SeriesCadence,
  record: RecordRow,
  available: AvailableField[],
  settings: SeriesSetting[]
): CadenceResolution {
  const index = settingsIndex(settings);
  let days = cadence.defaultDays;
  let fromScope: SeriesScopeSpec | null = null;
  let disabledBy: SeriesScopeSpec | null = null;

  for (const scope of cadence.overrideScopes) {
    const value = scopeValueFor(scope, record, available);
    if (!value) continue;
    const hit = index.get(keyOf(scope.kind, value));
    if (!hit) continue;
    if (!hit.active && !disabledBy) disabledBy = scope;
    if (hit.cadenceDays != null && fromScope == null) {
      days = hit.cadenceDays;
      fromScope = scope;
    }
  }

  return { days, active: disabledBy == null, fromScope, disabledBy };
}
