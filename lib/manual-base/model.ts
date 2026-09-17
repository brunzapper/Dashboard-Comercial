// Versão: 1.0 | Data: 17/09/2026
// Os lançamentos da Base manual SERIALIZADOS para uma IA — dono único do
// vocabulário.
//
// Existia um só lugar que fazia isso (o catálogo do assistente da própria Base
// manual, em lib/ai/manual-base.ts) e agora existem dois consumidores: aquele
// assistente e o dump do modelo que o construtor de dashboards manda à IA. Duas
// grafias para o mesmo fato — `periodo` aqui, `inicio`/`fim` ali, `dado` ×
// `serie` — é exatamente a régua paralela que a invariante 25 proíbe: a IA
// aprenderia uma palavra num prompt e outra no seguinte.
//
// As palavras são as que o contrato `base-manual-edit` já usa na LEITURA:
// `dado` (rótulo), `periodo` ("<início> a <fim>"), `valor`, `operacao`,
// `responsavel`. Ids NUNCA saem daqui — nem os de série, nem os de responsável
// ou operação (lib/import/manual-base/types.ts: "IDS NUNCA VÊM DO JSON").
//
// Módulo PURO e client-safe, como o resto de lib/manual-base: sem I/O, sem
// `server-only`. Quem carrega a base é o chamador.
import { MANUAL_SPREAD_LABELS, type ManualBaseData } from "./types";

/**
 * Teto de lançamentos num prompt. Folgado de propósito: o docstring de
 * `loadManualBase` diz que a base é "pequena por natureza — são números
 * digitados à mão", e quem limita o crescimento é a chave natural
 * (dado × período × atribuição). O precedente do assistente da Base manual é
 * 200; as amostras de registros do prompt de dashboard são ~20 linhas por Base.
 */
export const MAX_MANUAL_ENTRIES_IN_PROMPT = 400;

export interface ManualModelEntry {
  dado: string | null;
  periodo: string;
  valor: number;
  operacao: string | null;
  responsavel: string | null;
  /** Só com `includeSpread` — ver o bloco de opções abaixo. */
  distribuicao?: string;
}

export interface ManualModelBlock {
  dados: { chave: string; rotulo: string; distribuicao_padrao?: string }[];
  lancamentos: ManualModelEntry[];
  /** Quantos lançamentos ficaram de fora do teto. Ausente = nenhum. */
  truncado?: number;
}

export interface ManualModelOptions {
  /** id → nome. O chamador resolve; este módulo não consulta nada. */
  respById: ReadonlyMap<string, string>;
  opById: ReadonlyMap<string, string>;
  /**
   * Inclui a FORMA DE CONTAGEM de cada lançamento (e o padrão de cada dado).
   *
   * O construtor de dashboards pede: é a distribuição que decide se "3520 em
   * agosto" repete em cada mês tocado ou se divide por dia, e sem ela a IA não
   * tem como prever o que o número vai fazer num gráfico por semana. O
   * assistente da Base manual NÃO pede — o prompt dele funciona e uma entrega
   * que o altera sem necessidade é risco de graça.
   */
  includeSpread?: boolean;
  limit?: number;
}

/**
 * A Base manual em forma de bloco de prompt.
 *
 * Ordena por início DESC porque `loadManualBase` devolve os lançamentos na
 * ordem do banco — e uma lista truncada sem ordem própria cortaria meses ao
 * acaso em vez dos mais antigos.
 */
export function manualBaseModelBlock(
  base: ManualBaseData,
  opts: ManualModelOptions
): ManualModelBlock {
  const { respById, opById, includeSpread, limit } = opts;
  const cap = limit ?? MAX_MANUAL_ENTRIES_IN_PROMPT;
  const seriesById = new Map(base.series.map((s) => [s.id, s]));

  const ordered = [...base.entries].sort((a, b) =>
    a.period_start === b.period_start
      ? a.period_end.localeCompare(b.period_end)
      : b.period_start.localeCompare(a.period_start)
  );
  const kept = ordered.slice(0, cap);

  const lancamentos = kept.map((e): ManualModelEntry => {
    const row: ManualModelEntry = {
      dado: seriesById.get(e.series_id)?.label ?? null,
      periodo: `${e.period_start} a ${e.period_end}`,
      valor: e.value,
      operacao: e.operation_id ? (opById.get(e.operation_id) ?? null) : null,
      responsavel: e.responsible_id
        ? (respById.get(e.responsible_id) ?? null)
        : null,
    };
    if (includeSpread) row.distribuicao = MANUAL_SPREAD_LABELS[e.spread];
    return row;
  });

  const block: ManualModelBlock = {
    dados: base.series.map((s) => ({
      chave: s.key,
      rotulo: s.label,
      ...(includeSpread
        ? { distribuicao_padrao: MANUAL_SPREAD_LABELS[s.default_spread] }
        : {}),
    })),
    lancamentos,
  };
  const left = ordered.length - kept.length;
  if (left > 0) block.truncado = left;
  return block;
}
