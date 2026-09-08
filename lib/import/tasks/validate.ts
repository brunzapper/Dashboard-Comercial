// Versão: 1.0 | Data: 08/09/2026
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
  TASKS_EDIT_FORMAT,
  TASKS_EDIT_VERSION,
  type ParsedTaskAction,
  type ParsedTaskFields,
  type TaskPhaseRef,
  type TasksEditContext,
  type TasksEditValidation,
} from "./types";

const TOP_KEYS = new Set(["formato", "versao", "acoes", "notas"]);
const CAMPOS = ["descricao", "responsavel", "data", "hora", "hora_fim", "fase"];
const KEYS_BY_ACAO: Record<string, Set<string>> = {
  criar: new Set(["acao", "titulo", "quadro", ...CAMPOS]),
  editar: new Set(["acao", "tarefa", "novo_titulo", ...CAMPOS]),
  concluir: new Set(["acao", "tarefa"]),
};

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
    if (a.acao === "concluir") return { acao: a.acao, tarefa: a.alvo.titulo };
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
  ctx: TasksEditContext
): TasksEditValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

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
    const allowed = KEYS_BY_ACAO[acao];
    if (!allowed) {
      errors.push(
        `${where}: "acao" inválida ("${acao}"). Use criar, editar ou concluir.`
      );
      return;
    }
    for (const k of Object.keys(rawA)) {
      if (!allowed.has(k)) errors.push(`${where}: chave desconhecida "${k}".`);
    }

    /** Resolve o alvo pelo título, entre as tarefas VISÍVEIS. */
    const resolveAlvo = (
      soAbertas: boolean
    ): {
      id: string;
      titulo: string;
      phase: string;
      boardId: string | null;
      dueTime: string | null;
    } | null => {
      const titulo = asString(rawA.tarefa);
      if (!titulo) {
        errors.push(`${where}: "tarefa" é obrigatória (o título atual).`);
        return null;
      }
      const hits = (tasksByTitle.get(normalizeName(titulo)) ?? []).filter(
        (t) => !soAbertas || !t.completed
      );
      if (hits.length === 0) {
        errors.push(
          `${where}: não encontrei a tarefa "${titulo}"${soAbertas ? " em aberto" : ""}.`
        );
        return null;
      }
      if (hits.length > 1) {
        // Título é a única identidade do contrato; escolher uma seria
        // adivinhar em qual das tarefas homônimas o usuário mandou escrever.
        errors.push(
          `${where}: "${titulo}" casa com ${hits.length} tarefas. Renomeie uma delas na tela ou faça a edição por lá.`
        );
        return null;
      }
      const t = hits[0];
      return {
        id: t.id,
        titulo: t.title,
        phase: t.phase,
        boardId: t.boardId,
        dueTime: t.dueTime,
      };
    };

    if (acao === "concluir") {
      const alvo = resolveAlvo(true);
      if (!alvo) return;
      actions.push({ acao: "concluir", alvo: { id: alvo.id, titulo: alvo.titulo } });
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
      alvo: { id: alvo.id, titulo: alvo.titulo },
      ...(novoTitulo ? { novoTitulo } : {}),
      ...fields,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  if (actions.length === 0)
    return { ok: false, errors: ["Nenhuma ação válida na resposta."] };
  return { ok: true, actions, warnings };
}
