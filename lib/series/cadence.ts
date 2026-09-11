// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): ADIAR a sequência — `snoozeUntil` numa linha de exceção.
//   Uma linha com `active: false` + `snoozeUntil: D` vale como desligada ATÉ D,
//   e a partir de D deixa de valer sozinha. Escolhi assim para não abrir ramo
//   novo: a travessia de liga/desliga já existia, e `occurrencesToOpen`/o tick
//   seguem intocados — a série volta porque a exceção expirou, não porque
//   alguém a religou. `snoozeUntil` sem `active: false` não significa nada (e o
//   app nunca grava assim): quem desliga é o `active`.
// v1.1 (10/09/2026)
// v1.1 (10/09/2026): o escopo `record` passa a ser SEMPRE consultado na
//   travessia do LIGA/DESLIGA, esteja ou não declarado em `overrideScopes`.
//   Motivo: a Tree passou a oferecer "encerrar a sequência para este registro"
//   ao concluir/excluir uma ocorrência, e isso grava `active:false` no escopo
//   do registro. Uma série que não declarasse `record` ignoraria a linha em
//   silêncio — o botão diria "encerrada" e o tick reabriria a próxima no minuto
//   seguinte. A travessia da CADÊNCIA segue como estava: lá a precedência é
//   declarada pelo esquema de propósito. Seguro para o que já existe: a única
//   escrita de escopo `record` até aqui era `setRecordCadence`, que grava
//   `cadence_days` e deixa `active` no default `true`.
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
  /**
   * v1.2: com `active: false`, o dia em que a série volta a valer
   * (`YYYY-MM-DD`). Null = desligamento sem data de volta, o de sempre.
   */
  snoozeUntil?: string | null;
}

export interface CadenceResolution {
  days: number;
  /** A série está ligada para este registro? */
  active: boolean;
  /** Qual escopo decidiu a cadência (null = o padrão do esquema). */
  fromScope: SeriesScopeSpec | null;
  /** Qual escopo desligou, quando desligado. */
  disabledBy: SeriesScopeSpec | null;
  /**
   * v1.2: quando o desligamento tem data de volta, ela. É o que deixa a tela
   * dizer "adiada até 31/10" em vez de "desligada" — a diferença entre um
   * acompanhamento abandonado e um combinado com o cliente.
   */
  snoozedUntil?: string | null;
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

/** O escopo que a v1.1 consulta mesmo sem declaração (só no liga/desliga). */
export const RECORD_SCOPE: SeriesScopeSpec = { kind: "record" };

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
 *    ser anulado por uma exceção de cadência mais específica. E o escopo do
 *    REGISTRO vale sempre (v1.1): quem encerra a sequência de um registro pela
 *    Tree não abriu o construtor e não tem como saber quais escopos a regra
 *    declarou; um "não" que depende de declaração prévia é um "não" que falha
 *    em silêncio.
 */
export function resolveCadence(
  cadence: SeriesCadence,
  record: RecordRow,
  available: AvailableField[],
  settings: SeriesSetting[],
  /**
   * v1.2: hoje em Brasília, para o adiamento expirar sozinho. Omitir mantém o
   * comportamento da v1.1 (um adiamento sem data de referência é lido como
   * desligamento) — nenhum chamador existente muda de resultado.
   */
  todayIso?: string
): CadenceResolution {
  const index = settingsIndex(settings);
  let days = cadence.defaultDays;
  let fromScope: SeriesScopeSpec | null = null;
  let disabledBy: SeriesScopeSpec | null = null;
  let snoozedUntil: string | null = null;

  /**
   * A linha desliga a série HOJE?
   *
   * v1.2: `snoozeUntil` no futuro desliga e diz até quando; vencido, a linha
   * simplesmente deixa de valer — ninguém precisa apagá-la, e uma rodada
   * perdida não deixa a série adiada para sempre.
   */
  const desliga = (hit: SeriesSetting): boolean => {
    if (hit.active) return false;
    const until = hit.snoozeUntil?.slice(0, 10);
    if (!until || !todayIso) return true;
    return todayIso.slice(0, 10) < until;
  };

  for (const scope of cadence.overrideScopes) {
    const value = scopeValueFor(scope, record, available);
    if (!value) continue;
    const hit = index.get(keyOf(scope.kind, value));
    if (!hit) continue;
    if (desliga(hit) && !disabledBy) {
      disabledBy = scope;
      snoozedUntil = hit.snoozeUntil?.slice(0, 10) ?? null;
    }
    if (hit.cadenceDays != null && fromScope == null) {
      days = hit.cadenceDays;
      fromScope = scope;
    }
  }

  // O desligar por REGISTRO independe da declaração. Só o liga/desliga: uma
  // `cadence_days` gravada num escopo não declarado segue sendo ignorada.
  if (!disabledBy && !cadence.overrideScopes.some((s) => s.kind === "record")) {
    const hit = index.get(keyOf("record", record.id));
    if (hit && desliga(hit)) {
      disabledBy = RECORD_SCOPE;
      snoozedUntil = hit.snoozeUntil?.slice(0, 10) ?? null;
    }
  }

  return {
    days,
    active: disabledBy == null,
    fromScope,
    disabledBy,
    snoozedUntil: disabledBy ? snoozedUntil : null,
  };
}
