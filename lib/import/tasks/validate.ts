// Versão: 1.1 | Data: 11/09/2026
// v1.1 (11/09/2026): o alvo aceita `tarefa_data`, e existe `adiar_sequencia`.
//
// O que estava quebrado: o alvo era SÓ o título, e numa série todas as
// ocorrências têm o mesmo. Com as 3 abertas do padrão, `editar`/`concluir`/
// `excluir` caíam sempre no ramo de ambiguidade — o verbo `excluir` entregue na
// véspera nunca funcionou nas tarefas de que a Tree é feita. A data já estava no
// catálogo; faltava o contrato deixar a IA usá-la. A ambiguidade segue ERRO
// quando nem a data resolve (mesmo título, mesmo dia): aí é empate de verdade.
//
// `adiar_sequencia` não mexe em tarefa nenhuma — ver ParsedTaskSnoozeSeries.
// Validador do contrato `tarefas-edit` (§4.17). FAIL-CLOSED por item: chave
// desconhecida, título não-resolvido (0 hits lista as visíveis; >1 =
// ambiguidade), fase fora das colunas do quadro efetivo, data/hora malformada
// ou hora final sem hora inicial = erro. PURO — recebe o contexto FRESCO.
//
// A regra da hora final é a mesma do banco (CHECK da 0111) e a mesma do
// `readTaskForm`: repeti-la aqui não é régua paralela, é traduzir a recusa
// silenciosa do choke point (que DESCARTA a hora final órfã) em erro que o
// laço de autocorreção consegue consertar.
import { normalizeName } from "@/lib/sync/shared";
import { stripCodeFence } from "@/lib/import/dashboard/validate";

import {
  MAX_AI_TASK_ACTIONS,
  type TasksEditModes,
  TASKS_EDIT_FORMAT,
  TASKS_EDIT_VERSION,
  type ParsedTaskAction,
  type ParsedTaskFields,
  type ParsedTaskTarget,
  type TaskPhaseRef,
  type TasksEditContext,
  type TasksEditValidation,
} from "./types";

const TOP_KEYS = new Set(["formato", "versao", "acoes", "notas"]);
const CAMPOS = ["descricao", "responsavel", "data", "hora", "hora_fim", "fase"];
/** v1.1: a segunda coordenada do alvo, em toda ação que referencia tarefa. */
const ALVO = ["acao", "tarefa", "tarefa_data"];
const KEYS_BY_ACAO: Record<string, Set<string>> = {
  criar: new Set(["acao", "titulo", "quadro", ...CAMPOS]),
  editar: new Set([...ALVO, "novo_titulo", ...CAMPOS]),
  concluir: new Set(ALVO),
  // v1.1 (10/09): só aceita com `allowDelete` — ver `acoesAceitas` abaixo.
  excluir: new Set(ALVO),
  // v1.1 (11/09): só com `allowSeries`. Não tem alvo de TAREFA.
  adiar_sequencia: new Set(["acao", "sequencia", "ate"]),
};

/** As ações que ESTA superfície aceita, e a frase que as lista no erro. */
function acoesAceitas(modes: TasksEditModes): { set: Set<string>; frase: string } {
  const set = new Set(["criar", "editar", "concluir"]);
  const nomes = ["criar", "editar", "concluir"];
  if (modes.allowDelete === true) {
    set.add("excluir");
    nomes.push("excluir");
  }
  if (modes.allowSeries === true) {
    set.add("adiar_sequencia");
    nomes.push("adiar_sequencia");
  }
  const frase =
    nomes.length === 1
      ? nomes[0]
      : `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
  return { set, frase };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v != null && !Array.isArray(v);

const asString = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

const shortList = (names: string[]): string => {
  const cut = names.slice(0, 12);
  return cut.join(", ") + (names.length > cut.length ? ", …" : "");
};

/**
 * Serialização CANÔNICA das ações já resolvidas, de volta ao formato de FIO
 * (nomes e rótulos, nunca ids). É ela que alimenta o apply e a reinjeção da
 * prévia pendente no turno seguinte — por isso precisa ser re-validável.
 */
export function serializeTasksEdit(actions: ParsedTaskAction[]): string {
  // v1.1: a data do alvo volta ao fio SÓ quando ela foi o que desempatou. Sem
  // isso, a prévia reinjetada de uma ocorrência de série cairia de novo no erro
  // de ambiguidade que ela acabou de resolver.
  const alvoData = (alvo: { data?: string | null }): Record<string, unknown> =>
    alvo.data !== undefined ? { tarefa_data: alvo.data } : {};
  const campos = (a: ParsedTaskFields): Record<string, unknown> => ({
    ...(a.descricao !== undefined ? { descricao: a.descricao } : {}),
    ...(a.responsavel !== undefined
      ? { responsavel: a.responsavel === null ? null : a.responsavel.nome }
      : {}),
    ...(a.data !== undefined ? { data: a.data } : {}),
    ...(a.hora !== undefined ? { hora: a.hora } : {}),
    ...(a.hora_fim !== undefined ? { hora_fim: a.hora_fim } : {}),
    ...(a.fase ? { fase: a.fase.label } : {}),
  });
  const acoes = actions.map((a) => {
    if (a.acao === "adiar_sequencia")
      return { acao: a.acao, sequencia: a.serie.label, ate: a.ate };
    if (a.acao === "concluir" || a.acao === "excluir")
      return { acao: a.acao, tarefa: a.alvo.titulo, ...alvoData(a.alvo) };
    if (a.acao === "criar")
      return {
        acao: a.acao,
        titulo: a.titulo,
        ...(a.quadro ? { quadro: a.quadro.nome } : {}),
        ...campos(a),
      };
    return {
      acao: a.acao,
      tarefa: a.alvo.titulo,
      ...alvoData(a.alvo),
      ...(a.novoTitulo ? { novo_titulo: a.novoTitulo } : {}),
      ...campos(a),
    };
  });
  return JSON.stringify(
    { formato: TASKS_EDIT_FORMAT, versao: TASKS_EDIT_VERSION, acoes },
    null,
    2
  );
}

export function validateTasksEdit(
  raw: string,
  ctx: TasksEditContext,
  opts?: TasksEditModes
): TasksEditValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Molde do `{ selection: true }` de validateRecordsUpdate: um validador só,
  // com modos — nunca um segundo contrato para a superfície nova.
  const aceitas = acoesAceitas(opts ?? {});

  let obj: Record<string, unknown>;
  try {
    const text = stripCodeFence(raw);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("sem objeto JSON");
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      errors: [
        `Não consegui ler um objeto JSON na resposta. Responda APENAS com o objeto no formato "${TASKS_EDIT_FORMAT}".`,
      ],
    };
  }

  for (const k of Object.keys(obj)) {
    if (!TOP_KEYS.has(k)) errors.push(`Chave desconhecida na raiz: "${k}".`);
  }
  if (asString(obj.formato) !== TASKS_EDIT_FORMAT)
    errors.push(`"formato" deve ser "${TASKS_EDIT_FORMAT}".`);
  if (obj.versao !== TASKS_EDIT_VERSION)
    errors.push(`"versao" deve ser ${TASKS_EDIT_VERSION}.`);
  if (!Array.isArray(obj.acoes) || obj.acoes.length === 0)
    errors.push('"acoes" precisa ser uma lista com ao menos uma ação.');
  if (errors.length > 0) return { ok: false, errors };

  const acoes = obj.acoes as unknown[];
  if (acoes.length > MAX_AI_TASK_ACTIONS) {
    return {
      ok: false,
      errors: [
        `A resposta tem ${acoes.length} ações — o máximo é ${MAX_AI_TASK_ACTIONS}. Mantenha as mais importantes e explique o resto em "notas".`,
      ],
    };
  }

  for (const n of Array.isArray(obj.notas) ? obj.notas : []) {
    const nota = asString(n);
    if (nota) warnings.push(nota);
  }

  // ---- Índices de resolução (por nome normalizado).
  const tasksByTitle = new Map<string, TasksEditContext["tasks"]>();
  for (const t of ctx.tasks) {
    const k = normalizeName(t.title);
    if (!k) continue;
    const list = tasksByTitle.get(k) ?? [];
    list.push(t);
    tasksByTitle.set(k, list);
  }
  const respByName = new Map<string, { id: string; name: string }>();
  for (const r of ctx.responsibles) respByName.set(normalizeName(r.name), r);
  const boardByName = new Map<string, TasksEditContext["boards"][number]>();
  for (const b of ctx.boards) boardByName.set(normalizeName(b.name), b);

  const phasesOf = (boardId: string | null | undefined): TaskPhaseRef[] => {
    if (!boardId) return ctx.defaultPhases;
    return ctx.boards.find((b) => b.id === boardId)?.phases ?? ctx.defaultPhases;
  };

  /** Campos comuns. Devolve null quando algo falhou (erros já registrados). */
  function readFields(
    rawA: Record<string, unknown>,
    where: string,
    phases: TaskPhaseRef[],
    /** Hora já gravada na tarefa (editar) — a base do par hora/hora_fim. */
    horaAtual: string | null
  ): (ParsedTaskFields & { mudou: boolean }) | null {
    const out: ParsedTaskFields & { mudou: boolean } = { mudou: false };
    let falhou = false;

    if ("descricao" in rawA) {
      out.mudou = true;
      out.descricao = rawA.descricao === null ? null : asString(rawA.descricao) || null;
    }

    if ("responsavel" in rawA) {
      out.mudou = true;
      if (rawA.responsavel === null) out.responsavel = null;
      else {
        const nome = asString(rawA.responsavel);
        const r = respByName.get(normalizeName(nome));
        if (!r) {
          errors.push(
            `${where}: responsável "${nome}" não existe. Cadastrados: ${shortList(ctx.responsibles.map((x) => x.name))}.`
          );
          falhou = true;
        } else out.responsavel = { id: r.id, nome: r.name };
      }
    }

    if ("data" in rawA) {
      out.mudou = true;
      if (rawA.data === null) out.data = null;
      else {
        const d = asString(rawA.data);
        if (!DATE_RE.test(d)) {
          errors.push(`${where}: "data" precisa ser YYYY-MM-DD (recebi "${d}").`);
          falhou = true;
        } else out.data = d;
      }
    }

    if ("hora" in rawA) {
      out.mudou = true;
      if (rawA.hora === null) out.hora = null;
      else {
        const h = asString(rawA.hora);
        if (!TIME_RE.test(h)) {
          errors.push(`${where}: "hora" precisa ser HH:MM (recebi "${h}").`);
          falhou = true;
        } else out.hora = h;
      }
    }

    if ("hora_fim" in rawA) {
      out.mudou = true;
      if (rawA.hora_fim === null) out.hora_fim = null;
      else {
        const h = asString(rawA.hora_fim);
        if (!TIME_RE.test(h)) {
          errors.push(`${where}: "hora_fim" precisa ser HH:MM (recebi "${h}").`);
          falhou = true;
        } else out.hora_fim = h;
      }
    }

    if ("fase" in rawA) {
      out.mudou = true;
      const nome = asString(rawA.fase);
      const fase = phases.find(
        (p) => normalizeName(p.label) === normalizeName(nome) || p.key === nome
      );
      if (!fase) {
        errors.push(
          `${where}: fase "${nome}" não existe neste quadro. Disponíveis: ${shortList(phases.map((p) => p.label))}.`
        );
        falhou = true;
      } else out.fase = fase;
    }

    // Par hora/hora_fim: o CHECK da 0111 exige a inicial, e o `readTaskForm`
    // DESCARTA a final órfã em silêncio — aqui vira erro corrigível.
    if (!falhou && out.hora_fim) {
      const inicio = "hora" in rawA ? (out.hora ?? null) : horaAtual;
      if (!inicio) {
        errors.push(
          `${where}: "hora_fim" exige "hora" (a tarefa precisa de hora inicial).`
        );
        falhou = true;
      } else if (out.hora_fim <= inicio.slice(0, 5)) {
        errors.push(`${where}: "hora_fim" precisa ser depois de "hora".`);
        falhou = true;
      }
    }

    return falhou ? null : out;
  }

  const actions: ParsedTaskAction[] = [];
  acoes.forEach((rawA, i) => {
    const where = `acoes[${i}]`;
    if (!isRecord(rawA)) {
      errors.push(`${where}: precisa ser um objeto.`);
      return;
    }
    const acao = asString(rawA.acao);
    const allowed = aceitas.set.has(acao) ? KEYS_BY_ACAO[acao] : undefined;
    if (!allowed) {
      errors.push(
        `${where}: "acao" inválida ("${acao}"). Use ${aceitas.frase}.`
      );
      return;
    }
    for (const k of Object.keys(rawA)) {
      if (!allowed.has(k)) errors.push(`${where}: chave desconhecida "${k}".`);
    }

    /**
     * Resolve o alvo entre as tarefas VISÍVEIS: título + (v1.1) a data.
     *
     * O título sozinho nunca resolveu uma ocorrência de série — elas têm todas
     * o mesmo, e o padrão são 3 abertas. `tarefa_data` é a segunda coordenada,
     * e o catálogo já a publica por tarefa. `null` mira explicitamente a SEM
     * prazo; ausente = o título tem de bastar.
     */
    const resolveAlvo = (
      soAbertas: boolean
    ): {
      id: string;
      titulo: string;
      data?: string | null;
      phase: string;
      boardId: string | null;
      dueTime: string | null;
      fromSeries: boolean;
    } | null => {
      const titulo = asString(rawA.tarefa);
      if (!titulo) {
        errors.push(`${where}: "tarefa" é obrigatória (o título atual).`);
        return null;
      }

      const temData = "tarefa_data" in rawA;
      let alvoData: string | null = null;
      if (temData && rawA.tarefa_data !== null) {
        alvoData = asString(rawA.tarefa_data);
        if (!DATE_RE.test(alvoData)) {
          errors.push(
            `${where}: "tarefa_data" precisa ser YYYY-MM-DD (recebi "${alvoData}").`
          );
          return null;
        }
      }

      const mesmoTitulo = (tasksByTitle.get(normalizeName(titulo)) ?? []).filter(
        (t) => !soAbertas || !t.completed
      );
      const hits = temData
        ? mesmoTitulo.filter((t) => (t.dueDate?.slice(0, 10) ?? null) === alvoData)
        : mesmoTitulo;

      if (hits.length === 0) {
        const quando = temData
          ? alvoData
            ? ` com prazo em ${alvoData}`
            : " sem prazo"
          : "";
        const datas = mesmoTitulo.map((t) => t.dueDate ?? "sem prazo");
        errors.push(
          `${where}: não encontrei a tarefa "${titulo}"${quando}${soAbertas ? " em aberto" : ""}.` +
            (temData && datas.length > 0
              ? ` Prazos com esse título: ${shortList(datas)}.`
              : "")
        );
        return null;
      }
      if (hits.length > 1) {
        // Com a data já aplicada, sobrar mais de uma é empate DE VERDADE
        // (mesmo título, mesmo dia) — escolher seria adivinhar. Sem a data, a
        // saída é ela: por isso o erro ensina o campo em vez de mandar
        // renomear a tarefa na tela.
        errors.push(
          temData
            ? `${where}: "${titulo}" tem ${hits.length} tarefas no mesmo dia. Renomeie uma delas na tela ou faça a edição por lá.`
            : `${where}: "${titulo}" casa com ${hits.length} tarefas. Informe "tarefa_data" com o prazo da que você quer — os prazos são ${shortList(mesmoTitulo.map((t) => t.dueDate ?? "sem prazo"))}.`
        );
        return null;
      }
      const t = hits[0];
      return {
        id: t.id,
        titulo: t.title,
        ...(temData ? { data: alvoData } : {}),
        phase: t.phase,
        boardId: t.boardId,
        dueTime: t.dueTime,
        fromSeries: t.fromSeries,
      };
    };

    /** O alvo já resolvido, no formato do modelo (com a data que desempatou). */
    const alvoRef = (a: {
      id: string;
      titulo: string;
      data?: string | null;
    }): ParsedTaskTarget => ({
      id: a.id,
      titulo: a.titulo,
      ...("data" in a ? { data: a.data } : {}),
    });

    if (acao === "adiar_sequencia") {
      // Não resolve tarefa nenhuma: o alvo é a SÉRIE do registro em contexto.
      const series = ctx.series ?? [];
      const nome = asString(rawA.sequencia);
      const ate = asString(rawA.ate);
      if (series.length === 0) {
        errors.push(
          `${where}: não há sequência periódica neste registro que você possa adiar.`
        );
        return;
      }
      // Uma só, e sem nome dito: é ela. Com várias o nome é obrigatório —
      // escolher seria adivinhar de qual acompanhamento a pessoa falou.
      const serie =
        !nome && series.length === 1
          ? series[0]
          : series.find((x) => normalizeName(x.label) === normalizeName(nome));
      if (!serie) {
        errors.push(
          `${where}: sequência "${nome}" não existe neste registro. Disponíveis: ${shortList(series.map((x) => x.label))}.`
        );
        return;
      }
      if (!DATE_RE.test(ate)) {
        errors.push(`${where}: "ate" precisa ser YYYY-MM-DD (recebi "${ate}").`);
        return;
      }
      actions.push({
        acao: "adiar_sequencia",
        serie: { key: serie.key, label: serie.label },
        ate,
      });
      return;
    }

    if (acao === "concluir") {
      const alvo = resolveAlvo(true);
      if (!alvo) return;
      actions.push({ acao: "concluir", alvo: alvoRef(alvo) });
      return;
    }

    if (acao === "excluir") {
      // Concluída também se exclui: some com o registro da tarefa, não é o
      // mesmo que fechá-la.
      const alvo = resolveAlvo(false);
      if (!alvo) return;
      if (alvo.fromSeries) {
        // Excluir ocorrência de série NÃO GRUDA: a trava
        // `uq_tasks_series_occurrence` só impede recriar enquanto a linha
        // existe, então o tick reabre a ocorrência no minuto seguinte e a
        // pessoa fica achando que a ação falhou. Encerrar de verdade são as
        // DUAS metades (apagar as abertas + desligar a série no escopo do
        // registro), e isso é decisão humana, no diálogo da árvore.
        errors.push(
          `${where}: "${alvo.titulo}" veio de uma sequência periódica e não pode ser excluída assim — o sistema a recria. Conclua-a, ou encerre a sequência pela árvore.`
        );
        return;
      }
      actions.push({ acao: "excluir", alvo: alvoRef(alvo) });
      return;
    }

    if (acao === "criar") {
      const titulo = asString(rawA.titulo);
      if (!titulo) {
        errors.push(`${where}: "titulo" é obrigatório.`);
        return;
      }
      let quadro: { id: string; nome: string } | undefined;
      let phases = ctx.defaultPhases;
      if (rawA.quadro !== undefined && rawA.quadro !== null) {
        const nome = asString(rawA.quadro);
        const b = boardByName.get(normalizeName(nome));
        if (!b) {
          errors.push(
            `${where}: quadro "${nome}" não existe. Disponíveis: ${shortList(ctx.boards.map((x) => x.name))}.`
          );
          return;
        }
        quadro = { id: b.id, nome: b.name };
        phases = b.phases;
      }
      const campos = readFields(rawA, where, phases, null);
      if (!campos) return;
      if (tasksByTitle.has(normalizeName(titulo))) {
        // AVISO, não erro: tarefa repetida é legítima (recorrente), mas na
        // dúvida o usuário precisa ver antes de aplicar.
        warnings.push(
          `Já existe uma tarefa "${titulo}" — a ação ${i + 1} cria outra.`
        );
      }
      const { mudou: _m, ...fields } = campos;
      actions.push({ acao: "criar", titulo, ...(quadro ? { quadro } : {}), ...fields });
      return;
    }

    // editar
    const alvo = resolveAlvo(false);
    if (!alvo) return;
    const campos = readFields(rawA, where, phasesOf(alvo.boardId), alvo.dueTime);
    if (!campos) return;
    const novoTitulo = asString(rawA.novo_titulo);
    if (!campos.mudou && !novoTitulo) {
      errors.push(`${where}: nenhuma mudança — informe ao menos um campo.`);
      return;
    }
    const { mudou: _m, ...fields } = campos;
    actions.push({
      acao: "editar",
      alvo: alvoRef(alvo),
      ...(novoTitulo ? { novoTitulo } : {}),
      ...fields,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  if (actions.length === 0)
    return { ok: false, errors: ["Nenhuma ação válida na resposta."] };
  return { ok: true, actions, warnings };
}
