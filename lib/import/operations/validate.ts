// Versão: 1.0 | Data: 31/07/2026
// Validador do contrato `operacoes-edit` (assistente de IA de operações,
// §4.17). FAIL-CLOSED por item: chave desconhecida, nome não-resolvido (0
// hits lista os cadastrados; >1 = ambiguidade), operação AUTOMÁTICA tocada,
// ciclo de pai, colisão de nome ou prioridade em conflito = erro. Processa
// as ações EM ORDEM com um catálogo de TRABALHO (existentes + criadas no
// lote) — "crie X e vincule fulano a X" funciona. O perfil passa pela MESMA
// sanitização do choke point (lib/config/operation-profile.ts) e ainda exige
// field ∈ catálogo e sources ⊆ fontes (mais estrito que a UI, de propósito:
// um perfil com campo inexistente nunca casaria nada em silêncio).
import { sanitizeProfileFilters } from "@/lib/config/operation-profile";
import { normalizeName } from "@/lib/sync/shared";
import type { WidgetFilter } from "@/lib/widgets/types";
import { stripCodeFence } from "@/lib/import/dashboard/validate";

import {
  MAX_AI_OPERATION_ACTIONS,
  OPERATIONS_EDIT_FORMAT,
  OPERATIONS_EDIT_VERSION,
  type OperationsEditContext,
  type OperationsEditValidation,
  type OperationTargetRef,
  type ParsedOperationAction,
  type ParsedOperationCreate,
  type ParsedOperationEdit,
  type ParsedOperationLink,
  type ParsedOperationUnlink,
} from "./types";

const TOP_KEYS = new Set(["formato", "versao", "acoes", "notas"]);
const KEYS_BY_ACAO: Record<string, Set<string>> = {
  criar: new Set(["acao", "nome", "pai", "perfil"]),
  editar: new Set(["acao", "operacao", "novo_nome", "novo_pai", "ativa", "perfil"]),
  vincular: new Set(["acao", "responsavel", "operacao", "prioridade"]),
  desvincular: new Set(["acao", "responsavel", "operacao"]),
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v != null && !Array.isArray(v);

// Chave interna do catálogo de trabalho ("ex:<id>" | "new:<índice do criar>").
const keyOf = (ref: OperationTargetRef): string =>
  ref.kind === "existente" ? `ex:${ref.id}` : `new:${ref.index}`;

const shortList = (names: string[]): string => {
  const cut = names.slice(0, 12);
  return cut.join(", ") + (names.length > cut.length ? ", …" : "");
};

interface WorkOp {
  ref: OperationTargetRef;
  norm: string;
  auto: boolean;
}

export function validateOperationsEdit(
  raw: string,
  ctx: OperationsEditContext
): OperationsEditValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    const text = stripCodeFence(raw);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    parsed = JSON.parse(
      start >= 0 && end > start ? text.slice(start, end + 1) : text
    );
  } catch {
    return { ok: false, errors: ["JSON inválido — devolva um único objeto JSON."] };
  }
  if (!isRecord(parsed)) {
    return { ok: false, errors: ["A resposta deve ser um objeto JSON."] };
  }
  for (const k of Object.keys(parsed)) {
    if (!TOP_KEYS.has(k))
      errors.push(
        `Chave desconhecida no topo: "${k}" (aceitas: formato, versao, acoes, notas).`
      );
  }
  if (parsed.formato !== OPERATIONS_EDIT_FORMAT)
    errors.push(`"formato" deve ser "${OPERATIONS_EDIT_FORMAT}".`);
  if (parsed.versao !== OPERATIONS_EDIT_VERSION)
    errors.push(`"versao" deve ser ${OPERATIONS_EDIT_VERSION}.`);
  const acoesRaw = parsed.acoes;
  if (!Array.isArray(acoesRaw) || acoesRaw.length === 0) {
    errors.push('"acoes" deve ser uma lista com ao menos uma ação.');
    return { ok: false, errors };
  }
  if (acoesRaw.length > MAX_AI_OPERATION_ACTIONS) {
    errors.push(
      `NO MÁXIMO ${MAX_AI_OPERATION_ACTIONS} ações por resposta — mantenha as ${MAX_AI_OPERATION_ACTIONS} primeiras e explique em "notas".`
    );
    return { ok: false, errors };
  }

  // ---- Catálogo de TRABALHO (existentes + criadas no lote, renames aplicados).
  const workOps: WorkOp[] = ctx.operations.map((o) => ({
    ref: { kind: "existente", id: o.id, nome: o.name },
    norm: normalizeName(o.name),
    auto: o.auto,
  }));
  const parentByKey = new Map<string, string | null>();
  for (const o of ctx.operations)
    parentByKey.set(`ex:${o.id}`, o.parentId ? `ex:${o.parentId}` : null);
  // Vínculos de trabalho: respId → prioridade → opKey (pré-check do unique).
  const linksByResp = new Map<string, Map<number, string>>();
  const linkedPairs = new Set<string>(); // `${respId}|${opKey}`
  for (const l of ctx.links) {
    const m = linksByResp.get(l.responsibleId) ?? new Map<number, string>();
    m.set(l.priority, `ex:${l.operationId}`);
    linksByResp.set(l.responsibleId, m);
    linkedPairs.add(`${l.responsibleId}|ex:${l.operationId}`);
  }

  const opNames = () => shortList(workOps.map((w) => w.ref.nome));
  const resolveOp = (
    nome: unknown,
    label: string
  ): OperationTargetRef | { error: string } => {
    const s = typeof nome === "string" ? nome.trim() : "";
    if (!s) return { error: `${label}: informe o NOME da operação.` };
    const n = normalizeName(s);
    const hits = workOps.filter((w) => w.norm === n);
    if (hits.length === 0)
      return {
        error: `${label}: operação "${s}" não encontrada. Cadastradas: ${opNames()}.`,
      };
    if (hits.length > 1)
      return {
        error: `${label}: "${s}" é ambíguo (${hits.length} operações com esse nome) — gerencie pela tela de Operações.`,
      };
    return hits[0].ref;
  };
  const respByNorm = new Map<string, { id: string; name: string }[]>();
  for (const r of ctx.responsibles) {
    const n = normalizeName(r.name);
    respByNorm.set(n, [...(respByNorm.get(n) ?? []), { id: r.id, name: r.name }]);
  }
  const resolveResp = (
    nome: unknown,
    label: string
  ): { id: string; nome: string } | { error: string } => {
    const s = typeof nome === "string" ? nome.trim() : "";
    if (!s) return { error: `${label}: informe o NOME do responsável.` };
    const hits = respByNorm.get(normalizeName(s)) ?? [];
    if (hits.length === 0)
      return {
        error: `${label}: responsável "${s}" não encontrado. Ativos: ${shortList(
          ctx.responsibles.map((r) => r.name)
        )}.`,
      };
    if (hits.length > 1)
      return { error: `${label}: "${s}" é ambíguo (${hits.length} responsáveis).` };
    return { id: hits[0].id, nome: hits[0].name };
  };
  const autoOf = (ref: OperationTargetRef): boolean =>
    ref.kind === "existente" &&
    (workOps.find((w) => keyOf(w.ref) === keyOf(ref))?.auto ?? false);
  const AUTO_MSG =
    "é uma operação AUTOMÁTICA de parceria — gerida pela rotina; ajuste a configuração da parceria em Registros → Bases.";
  const validateProfile = (
    rawProfile: unknown,
    label: string
  ): WidgetFilter[] | { error: string } => {
    const res = sanitizeProfileFilters(rawProfile);
    if (!res.ok) return { error: `${label}: ${res.message}` };
    for (const c of res.clean) {
      if (!ctx.profileFields.includes(c.field))
        return {
          error: `${label}: campo desconhecido no perfil ("${c.field}") — use as refs do catálogo (campos_para_perfil).`,
        };
      for (const s of c.sources ?? [])
        if (!ctx.sourceKeys.includes(String(s)))
          return { error: `${label}: fonte desconhecida no perfil ("${s}").` };
    }
    return res.clean;
  };
  // Ciclo: subir os ancestrais de `startKey` no mapa de trabalho; alcançar
  // `targetKey` fecharia o laço (mesma regra da action updateOperation).
  const createsCycle = (startKey: string, targetKey: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null | undefined = startKey;
    while (cur) {
      if (cur === targetKey) return true;
      if (seen.has(cur)) return false;
      seen.add(cur);
      cur = parentByKey.get(cur) ?? null;
    }
    return false;
  };

  const actions: ParsedOperationAction[] = [];
  acoesRaw.forEach((item, i) => {
    const label = `Ação ${i + 1}`;
    if (!isRecord(item)) {
      errors.push(`${label}: deve ser um objeto.`);
      return;
    }
    const acao = String(item.acao ?? "");
    const known = KEYS_BY_ACAO[acao];
    if (!known) {
      errors.push(
        `${label}: "acao" deve ser criar, editar, vincular ou desvincular (exclusão fica na tela de Operações).`
      );
      return;
    }
    for (const k of Object.keys(item)) {
      if (!known.has(k)) {
        errors.push(
          `${label}: chave desconhecida "${k}" (aceitas em ${acao}: ${[...known].join(", ")}).`
        );
        return;
      }
    }

    if (acao === "criar") {
      const nome = typeof item.nome === "string" ? item.nome.trim() : "";
      if (!nome) {
        errors.push(`${label}: informe o "nome" da nova operação.`);
        return;
      }
      const norm = normalizeName(nome);
      if (workOps.some((w) => w.norm === norm)) {
        errors.push(
          `${label}: já existe operação chamada "${nome}" — use outro nome (a resolução por nome exige unicidade).`
        );
        return;
      }
      let pai: OperationTargetRef | null = null;
      if (item.pai != null) {
        const r = resolveOp(item.pai, label);
        if ("error" in r) {
          errors.push(r.error);
          return;
        }
        if (autoOf(r)) {
          errors.push(`${label}: "${r.nome}" ${AUTO_MSG}`);
          return;
        }
        pai = r;
      }
      const out: ParsedOperationCreate = { acao: "criar", nome, pai };
      if (item.perfil != null) {
        const p = validateProfile(item.perfil, label);
        if (!Array.isArray(p)) {
          errors.push(p.error);
          return;
        }
        out.perfil = p;
      }
      const ref: OperationTargetRef = { kind: "nova", index: i, nome };
      workOps.push({ ref, norm, auto: false });
      parentByKey.set(keyOf(ref), pai ? keyOf(pai) : null);
      actions.push(out);
      return;
    }

    if (acao === "editar") {
      const r = resolveOp(item.operacao, label);
      if ("error" in r) {
        errors.push(r.error);
        return;
      }
      if (r.kind === "nova") {
        errors.push(
          `${label}: "${r.nome}" foi criada neste lote — ajuste a própria ação "criar" (pai/perfil) em vez de editar.`
        );
        return;
      }
      if (autoOf(r)) {
        errors.push(`${label}: "${r.nome}" ${AUTO_MSG}`);
        return;
      }
      const out: ParsedOperationEdit = {
        acao: "editar",
        alvo: { id: r.id, nome: r.nome },
      };
      const selfKey = keyOf(r);
      if ("novo_nome" in item) {
        const novo = typeof item.novo_nome === "string" ? item.novo_nome.trim() : "";
        if (!novo) {
          errors.push(`${label}: "novo_nome" vazio.`);
          return;
        }
        const norm = normalizeName(novo);
        if (workOps.some((w) => w.norm === norm && keyOf(w.ref) !== selfKey)) {
          errors.push(`${label}: já existe operação chamada "${novo}".`);
          return;
        }
        out.novoNome = novo;
        // Rename vale para o RESTO do lote: norm E nome do ref (uma ação
        // posterior referencia pelo nome NOVO — e a serialização round-tripa
        // porque a ordem das ações é preservada).
        const entry = workOps.find((w) => keyOf(w.ref) === selfKey);
        if (entry) {
          entry.norm = norm;
          entry.ref = { ...entry.ref, nome: novo };
        }
      }
      if ("novo_pai" in item) {
        if (item.novo_pai == null) {
          out.novoPai = null;
          parentByKey.set(selfKey, null);
        } else {
          const p = resolveOp(item.novo_pai, label);
          if ("error" in p) {
            errors.push(p.error);
            return;
          }
          if (autoOf(p)) {
            errors.push(`${label}: "${p.nome}" ${AUTO_MSG}`);
            return;
          }
          if (keyOf(p) === selfKey || createsCycle(keyOf(p), selfKey)) {
            errors.push(
              `${label}: mover "${r.nome}" para "${p.nome}" criaria um ciclo na árvore.`
            );
            return;
          }
          out.novoPai = p;
          parentByKey.set(selfKey, keyOf(p));
        }
      }
      if ("ativa" in item) {
        if (typeof item.ativa !== "boolean") {
          errors.push(`${label}: "ativa" deve ser true/false.`);
          return;
        }
        out.ativa = item.ativa;
      }
      if ("perfil" in item) {
        if (item.perfil === null) out.perfil = null;
        else {
          const p = validateProfile(item.perfil, label);
          if (!Array.isArray(p)) {
            errors.push(p.error);
            return;
          }
          out.perfil = p;
        }
      }
      if (
        out.novoNome === undefined &&
        out.novoPai === undefined &&
        out.ativa === undefined &&
        out.perfil === undefined
      ) {
        errors.push(`${label}: nada a alterar em "${r.nome}" — remova a ação.`);
        return;
      }
      actions.push(out);
      return;
    }

    // vincular / desvincular
    const resp = resolveResp(item.responsavel, label);
    if ("error" in resp) {
      errors.push(resp.error);
      return;
    }
    const op = resolveOp(item.operacao, label);
    if ("error" in op) {
      errors.push(op.error);
      return;
    }
    if (autoOf(op)) {
      errors.push(`${label}: "${op.nome}" ${AUTO_MSG}`);
      return;
    }
    if (acao === "vincular") {
      const prio = item.prioridade;
      if (typeof prio !== "number" || !Number.isInteger(prio) || prio < 1) {
        errors.push(`${label}: "prioridade" deve ser inteiro >= 1 (1 = primária).`);
        return;
      }
      const opKey = keyOf(op);
      const m = linksByResp.get(resp.id) ?? new Map<number, string>();
      const occupied = m.get(prio);
      if (occupied && occupied !== opKey) {
        const who =
          workOps.find((w) => keyOf(w.ref) === occupied)?.ref.nome ?? "outra operação";
        errors.push(
          `${label}: ${resp.nome} já tem a prioridade ${prio} ocupada por "${who}" — desvincule antes ou use outra prioridade.`
        );
        return;
      }
      m.set(prio, opKey);
      linksByResp.set(resp.id, m);
      linkedPairs.add(`${resp.id}|${opKey}`);
      const out: ParsedOperationLink = {
        acao: "vincular",
        responsavel: resp,
        operacao: op,
        prioridade: prio,
      };
      actions.push(out);
      return;
    }
    // desvincular
    if (op.kind === "nova") {
      errors.push(
        `${label}: "${op.nome}" foi criada neste lote — não há vínculo a desfazer.`
      );
      return;
    }
    const pairKey = `${resp.id}|${keyOf(op)}`;
    if (!linkedPairs.has(pairKey)) {
      errors.push(
        `${label}: ${resp.nome} não está vinculado(a) à operação "${op.nome}".`
      );
      return;
    }
    linkedPairs.delete(pairKey);
    const m = linksByResp.get(resp.id);
    if (m)
      for (const [p, k] of m) if (k === keyOf(op)) m.delete(p);
    const out: ParsedOperationUnlink = {
      acao: "desvincular",
      responsavel: resp,
      operacao: { id: op.id, nome: op.nome },
    };
    actions.push(out);
  });

  if (Array.isArray(parsed.notas)) {
    for (const n of parsed.notas)
      if (typeof n === "string" && n.trim()) warnings.push(n.trim());
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, actions, warnings };
}

/**
 * Serialização CANÔNICA (por NOME — round-trip pelo próprio validador):
 * usada como pendingJson da conversa e como payload do Aplicar.
 */
export function serializeOperationsEdit(
  actions: ParsedOperationAction[]
): string {
  const acoes = actions.map((a) => {
    if (a.acao === "criar")
      return {
        acao: a.acao,
        nome: a.nome,
        ...(a.pai ? { pai: a.pai.nome } : {}),
        ...(a.perfil ? { perfil: a.perfil } : {}),
      };
    if (a.acao === "editar")
      return {
        acao: a.acao,
        operacao: a.alvo.nome,
        ...(a.novoNome !== undefined ? { novo_nome: a.novoNome } : {}),
        ...(a.novoPai !== undefined
          ? { novo_pai: a.novoPai === null ? null : a.novoPai.nome }
          : {}),
        ...(a.ativa !== undefined ? { ativa: a.ativa } : {}),
        ...(a.perfil !== undefined ? { perfil: a.perfil } : {}),
      };
    if (a.acao === "vincular")
      return {
        acao: a.acao,
        responsavel: a.responsavel.nome,
        operacao: a.operacao.nome,
        prioridade: a.prioridade,
      };
    return {
      acao: a.acao,
      responsavel: a.responsavel.nome,
      operacao: a.operacao.nome,
    };
  });
  return JSON.stringify(
    { formato: OPERATIONS_EDIT_FORMAT, versao: OPERATIONS_EDIT_VERSION, acoes },
    null,
    2
  );
}
