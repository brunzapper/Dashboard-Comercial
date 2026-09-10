// Versão: 1.5 | Data: 10/09/2026
// v1.5 (10/09/2026): `mirrorLeadDays` (com quanta antecedência a ocorrência
//   vira atividade no Bitrix) e o padrão de `lookahead` de 5 para 3. Os dois
//   números são configuráveis na regra; o que muda aqui é só o que vale para
//   quem não escolheu.
// Modelo da SÉRIE DE TAREFAS PERIÓDICAS (0132) — a tarefa recorrente que uma
// automação mantém sobre um registro ("enquanto o deal estiver em Nutrição,
// abra uma tarefa a cada quinze dias").
//
// v1.4 (10/09/2026): o SUBSTANTIVO da ocorrência virou dado (`noun`). Antes ele
// estava escrito no fonte, e a palavra escolhida não era a que este projeto
// usa. Vocabulário de domínio não pertence ao código: cada organização chama a
// própria rotina do jeito dela, e corrigir o termo no fonte só empurra o erro
// para a organização seguinte. O padrão é "Tarefa"; a automação escolhe outro,
// e a tarefa individual sobrepõe (tasks.occurrence_noun, 0137).
//
// O pedido separa duas coisas que costumam ser confundidas:
//  - o gatilho PRIMÁRIO (quais registros participam) — são as CONDIÇÕES da
//    regra, que o motor 0109 já casa em E; nada novo;
//  - o gatilho SECUNDÁRIO (qual data conta para o relógio) — é a `anchor`
//    daqui. A etapa diz QUEM entra; a data de mudança de etapa diz A PARTIR DE
//    QUANDO contar.
// Sem essa separação, "quinzenal" não teria de onde contar.
//
// Parse FAIL-CLOSED como todo jsonb do projeto: série malformada não roda
// "como der", fica inerte com erro visível.
import type { WorkflowFieldSpec } from "@/lib/workflow/types";

/** De onde sai a data que inicia a contagem. */
export type SeriesAnchor =
  // Última alteração de um campo, lida do HISTÓRICO (`audit_log`, 0135) — é o
  // "desde que mudou para esta etapa", e é o MESMO fato que a condição de
  // tempo `field_changed` já carrega para a rodada. NUNCA
  // `records.field_modified_at`: aquilo é o marcador de proteção do sync e
  // fica vazio para todo campo vindo do Bitrix (invariante 36).
  | { kind: "field_changed"; field: string }
  // Criação na origem (records.source_created_at).
  | { kind: "created" }
  // Um campo de data do próprio registro.
  | { kind: "field"; field: string };

/**
 * Limite de uma ponta da janela.
 *
 * A quarta forma de "quando parar" não está aqui: é a AUSÊNCIA de `until` —
 * a série segue enquanto as condições da regra valerem, e sair da etapa faz a
 * regra deixar de casar. As três abaixo são os limites explícitos.
 *
 * v1.1 (09/09/2026): `field_changed` — encerra quando ESSE campo mudar. Lê o
 * mesmo HISTÓRICO (`audit_log`) da âncora homônima e da condição de tempo do
 * motor, então o fato já chega na rodada sem consulta nova.
 */
export type SeriesBound =
  | { kind: "field"; field: string }
  // Data absoluta YYYY-MM-DD — o "prazo de término independente de variável".
  | { kind: "date"; date: string }
  | { kind: "field_changed"; field: string };

/** Em que escopo uma exceção de cadência pode ser gravada, e em que ordem. */
export type SeriesScopeKind = "record" | "responsible" | "field";

export interface SeriesScopeSpec {
  kind: SeriesScopeKind;
  /** Só em `field`: qual campo do registro recorta (ex.: `stage`). */
  field?: string;
}

export interface SeriesCadence {
  /** O padrão do esquema. 14 = quinzenal. */
  defaultDays: number;
  /**
   * Quem pode sobrescrever o padrão, NA ORDEM DE PRECEDÊNCIA (o primeiro que
   * tiver exceção gravada vence). É o esquema que declara isso; as exceções
   * em si são DADO (series_settings), editáveis sem abrir o construtor.
   */
  overrideScopes: SeriesScopeSpec[];
}

/**
 * O que fazer quando a âncora NÃO resolve — o campo nunca mudou, ou mudou antes
 * de o histórico existir.
 *
 * v1.2 (09/09/2026): "nenhum" (padrão) é o comportamento honesto — sem data de
 * início não há de onde contar, e inventar uma abriria tarefa por um atraso que
 * ninguém sabe se houve. "criacao" serve ao registro que já estava na etapa
 * antes de a série existir: conta da criação, que é uma data real.
 */
export type SeriesAnchorFallback = "nenhum" | "criacao";

/** Quando a primeira ocorrência acontece. */
export type SeriesFirstAt =
  // Um ciclo depois da âncora (o padrão: entrou em Nutrição hoje, a primeira
  // sai em 15 dias). Abrir no mesmo instante em que o registro entrou é ruído.
  | "apos_um_ciclo"
  // No próprio dia da âncora.
  | "imediato";

export interface SeriesConfig {
  /** Identidade da série — carimbada na tarefa e chave das exceções. */
  key: string;
  /** Título da tarefa gerada (template com as refs do esquema). */
  title: WorkflowFieldSpec | string;
  description?: string;
  anchor: SeriesAnchor;
  /** v1.2: âncora que não resolve — não gerar nada (padrão) ou usar a criação. */
  anchorFallback?: SeriesAnchorFallback;
  /** Janela: antes de `from` não gera; depois de `until` a série encerra. */
  from?: SeriesBound;
  until?: SeriesBound;
  cadence: SeriesCadence;
  firstAt: SeriesFirstAt;
  /** Teto de ocorrências por registro (0/ausente = sem teto). */
  maxOccurrences?: number;
  /**
   * Quantas ocorrências FUTURAS manter abertas além da devida hoje.
   *
   * v1.2 (09/09/2026): antes a série só criava a do dia, então o vendedor não
   * tinha como ver (nem remarcar) o que vinha pela frente — e num ciclo
   * quinzenal isso são 15 dias sem nada na tela. Criar adiantado é seguro
   * porque a trava é por OCORRÊNCIA (índice único da 0132, sem
   * `completed_at is null`): repetir é 23505, que já é no-op.
   *
   * NUNCA anda para trás: ocorrência vencida que ninguém abriu não vira tarefa
   * retroativa — ela segue aparecendo na Tree como galho vazio, que é o que
   * mostra a falta de acompanhamento.
   */
  lookahead?: number;
  /** Atributo concedido ao registro que entra na série (ex.: "tree"). */
  grantAttribute?: string;
  /**
   * Com quantos DIAS de antecedência a ocorrência vira atividade no Bitrix.
   *
   * v1.5 (10/09/2026): a tarefa nasce aqui assim que a janela a planeja — o
   * vendedor precisa ver o que vem —, mas mandar tudo para o CRM na mesma hora
   * enche a timeline do negócio com tarefas de meses à frente. O espelho
   * espera o vencimento se aproximar; quem cria é o varredor do tick.
   *
   * Ausente = DEFAULT_MIRROR_LEAD_DAYS. 0 = só no dia do vencimento.
   */
  mirrorLeadDays?: number;
  /**
   * Nível 2 da configuração do espelho no Bitrix (0136): "herdar" (o padrão,
   * segue a Base), "sempre" ou "nunca". Ausente = herdar — é o que faz ligar o
   * espelho na Base alcançar as séries que já rodam, sem editá-las.
   */
  mirrorBitrix?: "herdar" | "sempre" | "nunca";
  /**
   * v1.4: como ESTA série chama cada ocorrência ("Tarefa", "Follow-up",
   * "Visita"…). Ausente = DEFAULT_SERIES_NOUN. É rótulo de exibição — não
   * entra em chave, identidade nem consulta.
   */
  noun?: string;
}

export const SERIES_SCOPE_LABELS: Record<SeriesScopeKind, string> = {
  record: "Registro",
  responsible: "Responsável",
  field: "Campo",
};

/** Teto de sobrescritas declaradas (configuração humana, não carga de dados). */
export const MAX_SERIES_SCOPES = 6;
/** Teto de ocorrências futuras mantidas abertas (0 = só a devida hoje). */
export const MAX_SERIES_LOOKAHEAD = 12;
export const DEFAULT_SERIES_LOOKAHEAD = 3;
/**
 * Antecedência padrão do espelho no Bitrix, em dias.
 *
 * O teto é generoso porque quem decide é quem conhece o ciclo de venda; o
 * PADRÃO é curto porque a timeline do negócio é lida por pessoas, e tarefa
 * de dois meses à frente ali é ruído.
 */
export const MAX_MIRROR_LEAD_DAYS = 180;
export const DEFAULT_MIRROR_LEAD_DAYS = 3;
export const MIN_CADENCE_DAYS = 1;
export const MAX_CADENCE_DAYS = 365;

/**
 * Como uma ocorrência se chama quando ninguém escolheu outro nome.
 *
 * v1.4 (10/09/2026): antes o termo estava escrito no fonte, e não era o que
 * este projeto fala. "Tarefa" é o substantivo do próprio sistema; quem quiser
 * outro escreve na regra ou na tarefa.
 */
export const DEFAULT_SERIES_NOUN = "Tarefa";
export const MAX_SERIES_NOUN_LEN = 24;

/**
 * O rótulo de uma ocorrência no tronco da Tree ("3ª Tarefa").
 *
 * Dono ÚNICO da frase: a Tree, o editor da regra e o formulário da tarefa a
 * consomem. Remontá-la em cada tela é como a palavra errada se espalhou por
 * 37 arquivos da primeira vez.
 */
export function occurrenceLabel(
  occurrence: number,
  noun?: string | null
): string {
  const word = (noun ?? "").trim() || DEFAULT_SERIES_NOUN;
  return `${occurrence}ª ${word}`;
}

/** Saneia um substantivo vindo de jsonb/formulário. Vazio = usar o padrão. */
export function parseSeriesNoun(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().slice(0, MAX_SERIES_NOUN_LEN);
  return v === "" ? undefined : v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const SLUG = /^[a-z][a-z0-9_]{1,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseAnchor(raw: unknown): SeriesAnchor | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "created") return { kind: "created" };
  const field = typeof raw.field === "string" ? raw.field.trim() : "";
  if (field === "") return null;
  if (raw.kind === "field_changed") return { kind: "field_changed", field };
  if (raw.kind === "field") return { kind: "field", field };
  return null;
}

function parseBound(raw: unknown): SeriesBound | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "date") {
    const date = typeof raw.date === "string" ? raw.date.slice(0, 10) : "";
    return ISO_DATE.test(date) ? { kind: "date", date } : null;
  }
  if (raw.kind === "field" || raw.kind === "field_changed") {
    const field = typeof raw.field === "string" ? raw.field.trim() : "";
    if (field === "") return null;
    return raw.kind === "field"
      ? { kind: "field", field }
      : { kind: "field_changed", field };
  }
  return null;
}

function parseScopes(raw: unknown): SeriesScopeSpec[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SERIES_SCOPES) return null;
  const out: SeriesScopeSpec[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const kind = item.kind;
    if (kind === "record" || kind === "responsible") {
      out.push({ kind });
      continue;
    }
    if (kind === "field") {
      const field = typeof item.field === "string" ? item.field.trim() : "";
      if (field === "") return null;
      out.push({ kind: "field", field });
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Parse fail-closed da configuração da série. Devolve null para qualquer
 * estrutura fora do contrato — cadência zero, âncora sem campo, escopo
 * desconhecido. Série que "roda como der" abre tarefa para o vendedor errado.
 */
export function parseSeriesConfig(raw: unknown): SeriesConfig | null {
  if (!isRecord(raw)) return null;

  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  if (!SLUG.test(key)) return null;

  const titleRaw = raw.title;
  const title =
    typeof titleRaw === "string"
      ? titleRaw.trim()
      : isRecord(titleRaw) && typeof titleRaw.value === "string"
        ? titleRaw.value.trim()
        : "";
  if (title === "") return null;

  const anchor = parseAnchor(raw.anchor);
  if (!anchor) return null;

  const cadenceRaw = isRecord(raw.cadence) ? raw.cadence : null;
  const defaultDays =
    cadenceRaw && typeof cadenceRaw.defaultDays === "number"
      ? Math.floor(cadenceRaw.defaultDays)
      : NaN;
  if (
    !Number.isFinite(defaultDays) ||
    defaultDays < MIN_CADENCE_DAYS ||
    defaultDays > MAX_CADENCE_DAYS
  ) {
    return null;
  }
  const overrideScopes = parseScopes(cadenceRaw?.overrideScopes);
  if (!overrideScopes) return null;

  const config: SeriesConfig = {
    key,
    title,
    anchor,
    cadence: { defaultDays, overrideScopes },
    firstAt: raw.firstAt === "imediato" ? "imediato" : "apos_um_ciclo",
    lookahead:
      typeof raw.lookahead === "number" && Number.isFinite(raw.lookahead)
        ? Math.min(Math.max(Math.floor(raw.lookahead), 0), MAX_SERIES_LOOKAHEAD)
        : DEFAULT_SERIES_LOOKAHEAD,
  };

  // Ausente = o padrão. Série gravada antes desta chave existir passa a
  // espelhar com a antecedência padrão, sem ninguém editá-la — é o mesmo
  // princípio do "herdar" do mirrorBitrix.
  if (
    typeof raw.mirrorLeadDays === "number" &&
    Number.isFinite(raw.mirrorLeadDays)
  ) {
    config.mirrorLeadDays = Math.min(
      Math.max(Math.floor(raw.mirrorLeadDays), 0),
      MAX_MIRROR_LEAD_DAYS
    );
  }

  // Ausente = "nenhum": uma série existente não passa a contar da criação só
  // porque o parse ganhou uma chave nova.
  if (raw.anchorFallback === "criacao") config.anchorFallback = "criacao";

  if (typeof raw.description === "string" && raw.description.trim() !== "") {
    config.description = raw.description.trim();
  }
  for (const side of ["from", "until"] as const) {
    if (raw[side] !== undefined && raw[side] !== null) {
      const bound = parseBound(raw[side]);
      if (!bound) return null;
      config[side] = bound;
    }
  }
  if (typeof raw.maxOccurrences === "number" && raw.maxOccurrences > 0) {
    config.maxOccurrences = Math.floor(raw.maxOccurrences);
  }
  if (typeof raw.grantAttribute === "string" && SLUG.test(raw.grantAttribute)) {
    config.grantAttribute = raw.grantAttribute;
  }
  if (raw.mirrorBitrix === "sempre" || raw.mirrorBitrix === "nunca") {
    config.mirrorBitrix = raw.mirrorBitrix;
  }
  // v1.4: substantivo da ocorrência. Ausente/vazio = o padrão — nunca falha o
  // parse por causa de um rótulo.
  const noun = parseSeriesNoun(raw.noun);
  if (noun) config.noun = noun;
  return config;
}
