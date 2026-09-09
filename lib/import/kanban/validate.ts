// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): a ação `run_schema` é RECUSADA com mensagem. O parse
//   fail-closed a aceita (é regra válida), mas uma regra que executa um fluxo
//   com efeito fora do sistema não nasce de JSON gerado — ela é criada à mão,
//   nasce em simulação e alguém decide armá-la. Por isso também não entra no
//   SPEC (instructions.ts).
// Validador do contrato `kanban-config` (padrão §4.17). PURO — recebe o
// contexto FRESCO carregado pelo core e não toca no banco.
//
// Régua ÚNICA em tudo o que já existia:
//  - o quadro passa por `sanitizeKanbanSettings` (o MESMO módulo do import de
//    dashboard) DEPOIS de mesclado sobre a config atual com `deepMergeValue`
//    (a MESMA semântica de delta do rewrite da IA de dashboards);
//  - a regra passa por `parseAutomationRule` (o parse fail-closed que o
//    `saveAutomation` já usa) — por isso o payload de condição/ação viaja na
//    forma INTERNA, sem camada de tradução que pudesse derivar;
//  - o alvo de `set_field` é conferido contra `settableFields`, que o servidor
//    deriva do próprio `setFieldTargetError`.
// Nada aqui reimplementa uma dessas réguas.
import { deepMergeValue } from "@/lib/import/dashboard/rewrite";
import {
  sanitizeKanbanSettings,
  type SanitizeDeps,
} from "@/lib/import/dashboard/kanban-settings";
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import {
  MAX_RULE_CONDITIONS,
  parseAutomationRule,
} from "@/lib/kanban/automations/types";
import { KANBAN_OVERFLOW_KEY, type KanbanSettings } from "@/lib/kanban/types";

import {
  KANBAN_CONFIG_FORMAT,
  KANBAN_CONFIG_VERSION,
  MAX_AI_AUTOMATION_RULES,
  type KanbanConfigContext,
  type KanbanConfigValidation,
  type ParsedAutomationRule,
} from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Serialização CANÔNICA — alimenta o apply E a reinjeção da prévia pendente. */
export function serializeKanbanConfig(value: {
  quadro?: KanbanSettings;
  automacoes?: ParsedAutomationRule[];
}): string {
  return JSON.stringify(
    {
      formato: KANBAN_CONFIG_FORMAT,
      versao: KANBAN_CONFIG_VERSION,
      ...(value.quadro ? { quadro: value.quadro } : {}),
      ...(value.automacoes
        ? {
            automacoes: value.automacoes.map((a) => ({
              nome: a.nome,
              ativa: a.ativa,
              condicoes: a.rule.conditions,
              acao: a.rule.action,
            })),
          }
        : {}),
    },
    null,
    2
  );
}

export function validateKanbanConfig(
  raw: string,
  ctx: KanbanConfigContext
): KanbanConfigValidation {
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
        `Não consegui ler um objeto JSON na resposta. Responda APENAS com o objeto no formato "${KANBAN_CONFIG_FORMAT}".`,
      ],
    };
  }

  if (asString(obj.formato) !== KANBAN_CONFIG_FORMAT) {
    errors.push(`"formato" deve ser "${KANBAN_CONFIG_FORMAT}".`);
  }
  if (obj.versao !== KANBAN_CONFIG_VERSION) {
    errors.push(`"versao" deve ser ${KANBAN_CONFIG_VERSION}.`);
  }
  if (obj.quadro === undefined && obj.automacoes === undefined) {
    errors.push(
      'A resposta precisa trazer "quadro", "automacoes" ou os dois — não há nada a aplicar.'
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  for (const n of Array.isArray(obj.notas) ? obj.notas : []) {
    const nota = asString(n);
    if (nota) warnings.push(nota);
  }

  // ---------- quadro ----------
  const fieldRefs = new Set(ctx.fields.map((f) => f.ref));
  const deps: SanitizeDeps = {
    checkRef: (ref, where) => {
      if (fieldRefs.has(ref)) return true;
      errors.push(`${where}: campo desconhecido ("${ref}").`);
      return false;
    },
    knownSources: new Set(ctx.sourceKeys),
    rootSources: new Set(ctx.rootSourceKeys),
    where: "quadro",
    warnings,
  };

  let quadro: KanbanSettings | undefined;
  if (obj.quadro !== undefined) {
    if (!isRecord(obj.quadro)) {
      errors.push('"quadro" precisa ser um objeto (delta da configuração).');
    } else {
      // O delta é MESCLADO sobre a config atual antes de sanear: só assim
      // "pinte a coluna X de azul" preserva o resto do quadro.
      const merged = deepMergeValue(ctx.atual, obj.quadro);
      const clean = sanitizeKanbanSettings(merged, deps);
      if (!clean) {
        errors.push(
          "A configuração do quadro ficou incompleta depois do saneamento — confira a Base e o campo que define as colunas."
        );
      } else {
        quadro = clean;
      }
    }
  }

  // ---------- automações ----------
  let automacoes: ParsedAutomationRule[] | undefined;
  if (obj.automacoes !== undefined) {
    if (!Array.isArray(obj.automacoes)) {
      errors.push('"automacoes" precisa ser uma lista de regras.');
    } else if (obj.automacoes.length > MAX_AI_AUTOMATION_RULES) {
      errors.push(
        `"automacoes" tem ${obj.automacoes.length} regras — o máximo por resposta é ${MAX_AI_AUTOMATION_RULES}.`
      );
    } else {
      // As colunas do quadro EFETIVO (com o delta já aplicado) são o universo
      // dos alvos de "mover" — senão uma regra criada junto com a coluna nova
      // seria recusada sem motivo.
      const columnKeys = new Set(
        (quadro?.columns ?? ctx.atual.columns ?? []).map((c) => c.key)
      );
      for (const c of ctx.columns) columnKeys.add(c.key);
      const settable = new Set(ctx.settableFields.map((f) => f.ref));

      const parsed: ParsedAutomationRule[] = [];
      const usedNames = new Set<string>();
      obj.automacoes.forEach((item, i) => {
        const where = `automacoes[${i}]`;
        if (!isRecord(item)) {
          errors.push(`${where}: precisa ser um objeto.`);
          return;
        }
        const nome = asString(item.nome);
        if (!nome) {
          errors.push(`${where}: "nome" é obrigatório (é por ele que a regra é reconhecida).`);
          return;
        }
        const nomeKey = nome.toLocaleLowerCase("pt-BR");
        if (usedNames.has(nomeKey)) {
          errors.push(`${where}: já existe outra regra chamada "${nome}" nesta resposta.`);
          return;
        }
        usedNames.add(nomeKey);

        if (Array.isArray(item.condicoes) && item.condicoes.length > MAX_RULE_CONDITIONS) {
          errors.push(
            `${where} ("${nome}"): ${item.condicoes.length} condições — o máximo por regra é ${MAX_RULE_CONDITIONS}.`
          );
          return;
        }
        const rule = parseAutomationRule({
          v: 1,
          conditions: item.condicoes,
          action: item.acao,
        });
        if (!rule) {
          errors.push(
            `${where} ("${nome}"): regra incompleta ou fora do contrato — confira "condicoes" (pelo menos uma) e "acao".`
          );
          return;
        }

        // Ação que dispara efeito FORA do sistema não nasce de JSON gerado: a
        // regra é criada à mão, com o ensaio ligado por padrão e um humano
        // decidindo armá-la. Fica fora do SPEC de propósito.
        if (rule.action.type === "run_schema") {
          errors.push(
            `${where} ("${nome}"): a ação "executar esquema" precisa ser criada à mão no painel de automações — ela roda um fluxo que escreve fora do sistema.`
          );
          return;
        }

        // Alvo da ação — as duas famílias, cada uma pela sua régua existente.
        if (rule.action.type === "move_to_column") {
          const target = rule.action.targetKey;
          if (target === KANBAN_OVERFLOW_KEY) {
            errors.push(`${where} ("${nome}"): a coluna "Outros" não recebe cards.`);
            return;
          }
          if (!columnKeys.has(target)) {
            errors.push(
              `${where} ("${nome}"): coluna alvo "${target}" não existe neste quadro. Colunas: ${[...columnKeys].join(", ") || "(nenhuma)"}.`
            );
            return;
          }
        } else if (
          rule.action.type === "set_field" &&
          !settable.has(rule.action.field)
        ) {
          errors.push(
            `${where} ("${nome}"): o campo "${rule.action.field}" não pode ser gravado por automação (data, calculado, relação, campo casado/unificado, coluna do núcleo não editável ou o espelho da fase deste quadro).`
          );
          return;
        }

        // Refs de campo das condições: existência no catálogo do quadro.
        for (const cond of rule.conditions) {
          if (cond.kind === "field" && !fieldRefs.has(cond.filter.field)) {
            errors.push(
              `${where} ("${nome}"): condição sobre campo desconhecido ("${cond.filter.field}").`
            );
            return;
          }
          if (cond.kind === "related_count" && !ctx.rootSourceKeys.includes(cond.source)) {
            errors.push(
              `${where} ("${nome}"): "registros conectados" exige uma Base raiz ("${cond.source}" não é). Bases: ${ctx.rootSourceKeys.join(", ")}.`
            );
            return;
          }
          if (
            cond.kind === "time" &&
            cond.basis.type === "field_changed" &&
            !fieldRefs.has(cond.basis.field)
          ) {
            errors.push(
              `${where} ("${nome}"): condição de tempo sobre campo desconhecido ("${cond.basis.field}").`
            );
            return;
          }
        }

        parsed.push({
          nome,
          ativa: item.ativa !== false,
          posicao: parsed.length,
          rule,
        });
      });
      if (errors.length === 0) automacoes = parsed;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { quadro, automacoes }, warnings };
}
