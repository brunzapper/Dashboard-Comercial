// Versão: 1.2 | Data: 18/09/2026
// v1.2 (18/09/2026): `reparte_por` passa a sair por CHAVE e cada membro de
//   `familias` ganha a CHAVE ao lado do rótulo. As duas coisas que a IA precisa
//   ESCREVER a partir deste bloco são `manualdim:<chave da família>` e o valor
//   de um filtro de coordenada (a chave do MEMBRO); o bloco só expunha rótulos,
//   e um filtro com rótulo passa no validador e não casa com nada em runtime.
//   `coordenadas` segue por rótulo de propósito: ela é LEITURA, é compartilhada
//   com o prompt do assistente da Base manual (que funciona como está) e agora
//   é mapeável por `familias`.
// v1.1 (18/09/2026): as FAMÍLIAS (0143) entram no bloco — o catálogo dos eixos
//   e a `coordenadas` de cada lançamento. Mesma razão do resto do módulo: sem
//   elas a IA de dashboards veria "1000", "500" e "500" do mesmo dado no mesmo
//   mês e concluiria que são 2000. É a coordenada que diz que são o MESMO mil.
//   As palavras (`familias`/`membros`/`coordenadas`) são as do contrato
//   `base-manual-edit` — duas grafias e a IA aprende uma num prompt e outra no
//   seguinte.
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
import { familyLabelOfKey } from "./families";
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
  /** A REPARTIÇÃO deste lançamento: rótulo de família → rótulo de membro, com
   *  `null` no residual. Ausente = é o TOTAL do dado. */
  coordenadas?: Record<string, string | null>;
}

export interface ManualModelBlock {
  dados: {
    chave: string;
    rotulo: string;
    distribuicao_padrao?: string;
    /** As famílias em que ESTE dado se reparte (0143), por CHAVE — é a chave
     *  que a IA precisa escrever em `manualdim:<chave>`. Ausente = nenhuma. */
    reparte_por?: string[];
  }[];
  /** O catálogo dos eixos (0143). Ausente quando a org não tem família.
   *  O membro sai com CHAVE e rótulo: o valor de um filtro de coordenada é a
   *  CHAVE, e um filtro escrito com o rótulo passa no validador e não casa com
   *  nada em runtime (as `coords` guardam chaves). */
  familias?: {
    chave: string;
    rotulo: string;
    membros: { chave: string; rotulo: string }[];
  }[];
  lancamentos: ManualModelEntry[];
  /** Quantos lançamentos ficaram de fora do teto. Ausente = nenhum. */
  truncado?: number;
}

export interface ManualModelOptions {
  /** id → nome. O chamador resolve; este módulo não consulta nada. */
  respById: ReadonlyMap<string, string>;
  opById: ReadonlyMap<string, string>;
  /** `series_id` → chaves de família declaradas (0143). */
  declarations?: Record<string, string[]>;
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
  const declarations = opts.declarations ?? {};
  const membersOfFamily = new Map<
    string,
    { chave: string; rotulo: string }[]
  >();
  for (const f of base.families) {
    membersOfFamily.set(
      f.key,
      base.members
        .filter((m) => m.family_id === f.id)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((m) => ({ chave: m.key, rotulo: m.label }))
    );
  }
  const memberLabel = (famKey: string, member: string | null): string | null => {
    if (member == null) return null;
    const fam = base.families.find((f) => f.key === famKey);
    if (!fam) return member;
    return (
      base.members.find((m) => m.family_id === fam.id && m.key === member)
        ?.label ?? member
    );
  };
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
    const axes = Object.keys(e.coords);
    if (axes.length > 0) {
      const coords: Record<string, string | null> = {};
      for (const key of axes.sort()) {
        coords[familyLabelOfKey(key, base.families)] = memberLabel(
          key,
          e.coords[key] ?? null
        );
      }
      row.coordenadas = coords;
    }
    return row;
  });

  const block: ManualModelBlock = {
    dados: base.series.map((s) => {
      const declared = declarations[s.id] ?? [];
      return {
        chave: s.key,
        rotulo: s.label,
        ...(includeSpread
          ? { distribuicao_padrao: MANUAL_SPREAD_LABELS[s.default_spread] }
          : {}),
        // Por CHAVE, não por rótulo (18/09/2026): a dimensão que a IA tem de
        // escrever é `manualdim:<chave>`, e emitir "Canal" aqui a obrigava a
        // adivinhar a chave "canal" — foi assim que um board real pediu a
        // família sobre cinco dados que não a declaram e saiu vazio. O rótulo
        // legível segue em `familias[].rotulo`.
        ...(declared.length > 0 ? { reparte_por: [...declared] } : {}),
      };
    }),
    ...(base.families.length > 0
      ? {
          familias: base.families.map((f) => ({
            chave: f.key,
            rotulo: f.label,
            membros: membersOfFamily.get(f.key) ?? [],
          })),
        }
      : {}),
    lancamentos,
  };
  const left = ordered.length - kept.length;
  if (left > 0) block.truncado = left;
  return block;
}
