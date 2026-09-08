// Versão: 1.0 | Data: 08/09/2026
// Validador do contrato `remuneracao-edit` (padrão §4.17). PURO — recebe o
// contexto FRESCO e os catálogos já carregados pelo core.
//
// O que ele faz e o que NÃO faz, porque a fronteira importa: aqui só se
// TRADUZ o delta declarativo da IA (nomes, rótulos, texto de fórmula) para um
// `CompPlanConfig` completo, mesclado sobre a config existente. A régua de
// validade é `validateCompPlanSave` (lib/comp/plan-validate.ts), o MESMO
// módulo que o `savePlan` roda — este arquivo nunca repete uma checagem dele.
//
// Duas identidades são sagradas e por isso NUNCA vêm do JSON:
//  - `CompFactor.id`: chave de `inputs.overrides.factors`, de
//    `detailGrouping.byFactor` e — via `metricKey` — das linhas de `goals`.
//    Fator casado por RÓTULO herda o id existente; regenerá-lo orfanaria
//    overrides, agrupamento e metas de todos os meses já lançados.
//  - `CompCommissionBlock.id`: chave do breakdown e das `memberTiers`.
// Fator/bloco novo ganha id no SERVIDOR, e o `metricKey` sai como o sentinela
// `__auto__` que o savePlan resolve.
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import type { OperandRef } from "@/lib/records/date-operands";
import type { Formula } from "@/lib/records/formulas";
import { AUTO_METRIC_KEY } from "@/lib/comp/plan-validate";
import type {
  CompCommissionBlock,
  CompCommissionTier,
  CompFactor,
  CompPlanConfig,
} from "@/lib/comp/model";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import type { WidgetFilter } from "@/lib/widgets/types";

import {
  COMP_EDIT_FORMAT,
  COMP_EDIT_VERSION,
  MAX_AI_COMP_TARGETS,
  type CompEditContext,
  type CompEditValidation,
  type ParsedCompEdit,
  type ParsedCompTarget,
} from "./types";

const UI_FILTER_OPS = new Set(FILTER_OPS.map((o) => o.op));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Chave de casamento por rótulo — o contrato inteiro compara assim. */
function labelKey(s: string): string {
  return s.trim().toLocaleLowerCase("pt-BR");
}

/** Serialização CANÔNICA — alimenta o apply E a reinjeção da prévia. */
export function serializeCompEdit(value: ParsedCompEdit): string {
  return JSON.stringify(
    {
      formato: COMP_EDIT_FORMAT,
      versao: COMP_EDIT_VERSION,
      ...(value.plano ? { plano: value.plano } : {}),
      ...(value.metas ? { metas: value.metas } : {}),
    },
    null,
    2
  );
}

/** Dependências do servidor que a tradução precisa (injetadas pelo core). */
export interface CompEditDeps {
  /** Catálogo agregado, para tokenizar a fórmula do fator. */
  aggCatalog: OperandRef[];
  /** Catálogo `comp:*` do config RESULTANTE, para a fórmula do total. */
  compCatalogFor: (config: CompPlanConfig) => OperandRef[];
  /** Config ATUAL parseada — a base do merge. */
  atual: CompPlanConfig;
  /** Gera um id estável para fator/bloco novo. */
  newId: (prefix: string) => string;
  /** display_name → id canônico do responsável (null = desconhecido). */
  memberIdByName: (name: string) => string | null;
  /** nome → id de operação ativa (null = desconhecida). */
  operationIdByName: (name: string) => string | null;
}

/** Resultado da tradução: o config completo + as metas resolvidas por id. */
export interface CompEditResolved {
  value: ParsedCompEdit;
  /** Config COMPLETA a passar ao savePlan (delta já mesclado). */
  config: CompPlanConfig;
  nome: string;
  ativo: boolean;
  /** Metas com membro e fator já resolvidos. */
  targets: { responsibleId: string; factorId: string; value: number | null }[];
  warnings: string[];
}

export function validateCompEdit(
  raw: string,
  ctx: CompEditContext,
  deps: CompEditDeps
): CompEditValidation & { resolved?: CompEditResolved } {
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
        `Não consegui ler um objeto JSON na resposta. Responda APENAS com o objeto no formato "${COMP_EDIT_FORMAT}".`,
      ],
    };
  }

  if (asString(obj.formato) !== COMP_EDIT_FORMAT)
    errors.push(`"formato" deve ser "${COMP_EDIT_FORMAT}".`);
  if (obj.versao !== COMP_EDIT_VERSION)
    errors.push(`"versao" deve ser ${COMP_EDIT_VERSION}.`);
  if (obj.plano === undefined && obj.metas === undefined)
    errors.push(
      'A resposta precisa trazer "plano", "metas" ou os dois — não há nada a aplicar.'
    );
  if (errors.length > 0) return { ok: false, errors };

  for (const n of Array.isArray(obj.notas) ? obj.notas : []) {
    const nota = asString(n);
    if (nota) warnings.push(nota);
  }

  // Começa da config ATUAL: tudo que a IA não mencionar sobrevive — inclusive
  // `presetKey`, `detailGrouping`, `memberTeams` e os `filters` do recorte,
  // que o save do plan-editor também re-emite (sem isso o round-trip os
  // destruiria no primeiro apply).
  const config: CompPlanConfig = JSON.parse(
    JSON.stringify(deps.atual)
  ) as CompPlanConfig;
  let nome = ctx.planName;
  // Default = estado ATUAL (não `true`): delta silencioso não reativa plano.
  let ativo = ctx.planActive;

  const plano = obj.plano;
  if (plano !== undefined) {
    if (!isRecord(plano)) {
      errors.push('"plano" precisa ser um objeto (delta da configuração).');
      return { ok: false, errors };
    }

    const novoNome = asString(plano.nome);
    if (novoNome) nome = novoNome;
    if (plano.ativo !== undefined) ativo = plano.ativo !== false;

    if (plano.apuracao !== undefined) {
      if (plano.apuracao === null || plano.apuracao === "mes_corrente")
        delete config.apuracao;
      else if (plano.apuracao === "mes_anterior") config.apuracao = "mes_anterior";
      else
        errors.push(
          `"plano.apuracao" inválida ("${String(plano.apuracao)}"). Use "mes_anterior" ou null.`
        );
    }

    // Membros por NOME → ids canônicos. Presença da chave ⇒ lista EXPLÍCITA
    // (mesmo resolvendo vazio) — nunca cair no "todos os ativos".
    if (plano.membros !== undefined) {
      if (!Array.isArray(plano.membros)) {
        errors.push('"plano.membros" precisa ser uma lista de nomes.');
      } else {
        const ids: string[] = [];
        for (const raw of plano.membros) {
          const nomeMembro = asString(raw);
          if (!nomeMembro) continue;
          const id = deps.memberIdByName(nomeMembro);
          if (!id) {
            errors.push(
              `Membro desconhecido em "plano.membros": "${nomeMembro}".`
            );
            continue;
          }
          if (!ids.includes(id)) ids.push(id);
        }
        config.memberIds = ids;
      }
    }
    if (plano.operacoesDeMembros !== undefined) {
      if (!Array.isArray(plano.operacoesDeMembros)) {
        errors.push('"plano.operacoesDeMembros" precisa ser uma lista de nomes.');
      } else {
        const ids: string[] = [];
        for (const raw of plano.operacoesDeMembros) {
          const nomeOp = asString(raw);
          if (!nomeOp) continue;
          const id = deps.operationIdByName(nomeOp);
          if (!id) {
            errors.push(`Operação desconhecida: "${nomeOp}".`);
            continue;
          }
          if (!ids.includes(id)) ids.push(id);
        }
        config.memberOperationIds = ids;
      }
    }

    // ---- Fatores: DELTA por rótulo.
    if (plano.fatores !== undefined) {
      if (!Array.isArray(plano.fatores)) {
        errors.push('"plano.fatores" precisa ser uma lista.');
      } else {
        const byLabel = new Map(config.factors.map((f) => [labelKey(f.label), f]));
        plano.fatores.forEach((rawF, i) => {
          const where = `plano.fatores[${i}]`;
          if (!isRecord(rawF)) {
            errors.push(`${where}: precisa ser um objeto.`);
            return;
          }
          const nomeFator = asString(rawF.nome);
          if (!nomeFator) {
            errors.push(`${where}: "nome" é obrigatório (identifica o fator).`);
            return;
          }
          const existente = byLabel.get(labelKey(nomeFator));
          // Fator NOVO nasce com id do servidor e metricKey sentinela — o
          // savePlan resolve a chave a partir do rótulo.
          const alvo: CompFactor = existente ?? {
            id: deps.newId("f"),
            label: nomeFator,
            weightPct: 0,
            metricKey: AUTO_METRIC_KEY,
            money: false,
            formula: { tokens: [] } as Formula,
            sources: [],
          };
          if (!existente) {
            config.factors.push(alvo);
            byLabel.set(labelKey(nomeFator), alvo);
          }

          const renomear = asString(rawF.novoNome);
          if (renomear) alvo.label = renomear;
          const peso = asNumber(rawF.pesoPct);
          if (peso != null) alvo.weightPct = peso;
          if (rawF.moeda !== undefined) alvo.money = rawF.moeda === true;

          if (rawF.formulaTexto !== undefined) {
            const texto = asString(rawF.formulaTexto);
            const tok = tokenizeFormulaText(texto, deps.aggCatalog);
            if (!tok.ok) {
              errors.push(`${where} ("${nomeFator}"): fórmula — ${tok.error}`);
            } else {
              alvo.formula = tok.formula;
            }
          } else if (!existente) {
            errors.push(
              `${where} ("${nomeFator}"): fator novo precisa de "formulaTexto".`
            );
          }

          if (rawF.fontes !== undefined) {
            if (!Array.isArray(rawF.fontes)) {
              errors.push(`${where}: "fontes" precisa ser uma lista de Bases.`);
            } else {
              alvo.sources = rawF.fontes.map((s) => asString(s)).filter(Boolean);
            }
          }

          if (rawF.filtros !== undefined) {
            if (rawF.filtros === null) delete alvo.filters;
            else if (!Array.isArray(rawF.filtros)) {
              errors.push(`${where}: "filtros" precisa ser uma lista.`);
            } else {
              const out: WidgetFilter[] = [];
              rawF.filtros.forEach((rawFlt, j) => {
                if (!isRecord(rawFlt)) return;
                const field = asString(rawFlt.field);
                const op = asString(rawFlt.op);
                if (!field || !op) {
                  errors.push(`${where}.filtros[${j}]: "field" e "op" são obrigatórios.`);
                  return;
                }
                // Ops INTERNOS (eq_ci/*_num) seriam dropados em silêncio pelo
                // caminho de consulta ⇒ recorte mais largo do que o pedido.
                if (!UI_FILTER_OPS.has(op as WidgetFilter["op"])) {
                  errors.push(
                    `${where}.filtros[${j}]: operador "${op}" não é aceito. Válidos: ${[...UI_FILTER_OPS].join(", ")}.`
                  );
                  return;
                }
                const flt: WidgetFilter = {
                  field,
                  op: op as WidgetFilter["op"],
                };
                if ("value" in rawFlt) flt.value = rawFlt.value;
                out.push(flt);
              });
              alvo.filters = out;
            }
          }

          if (rawF.campoDeMembro !== undefined) {
            const ref = asString(rawF.campoDeMembro);
            if (!ref) delete alvo.memberField;
            else alvo.memberField = ref;
          }
          for (const [chave, prop] of [
            ["capPct", "capPct"],
            ["floorPct", "floorPct"],
            ["alvoPadrao", "defaultTarget"],
          ] as const) {
            if (rawF[chave] === undefined) continue;
            if (rawF[chave] === null) {
              delete (alvo as unknown as Record<string, unknown>)[prop];
              continue;
            }
            const n = asNumber(rawF[chave]);
            if (n == null) {
              errors.push(`${where}: "${chave}" precisa ser um número ou null.`);
              continue;
            }
            (alvo as unknown as Record<string, unknown>)[prop] = n;
          }
          if (rawF.moedaDoAlvo !== undefined) {
            const code = asString(rawF.moedaDoAlvo);
            if (!code) delete alvo.targetCurrency;
            else alvo.targetCurrency = code;
          }
        });
      }
    }

    // ---- Comissões: quando presente, é a lista COMPLETA desejada.
    if (plano.comissoes !== undefined) {
      if (!Array.isArray(plano.comissoes)) {
        errors.push('"plano.comissoes" precisa ser uma lista.');
      } else {
        const prevById = new Map(
          (config.commissions ?? []).map((b) => [labelKey(b.label ?? b.id), b])
        );
        const factorIdByLabel = new Map(
          config.factors.map((f) => [labelKey(f.label), f.id])
        );
        const blocks: CompCommissionBlock[] = [];
        plano.comissoes.forEach((rawB, i) => {
          const where = `plano.comissoes[${i}]`;
          if (!isRecord(rawB)) {
            errors.push(`${where}: precisa ser um objeto.`);
            return;
          }
          const nomeBloco = asString(rawB.nome);
          if (!nomeBloco) {
            errors.push(`${where}: "nome" é obrigatório (identifica o bloco).`);
            return;
          }
          const gatilho = asString(rawB.gatilho);
          const triggerId = factorIdByLabel.get(labelKey(gatilho));
          if (!triggerId) {
            errors.push(
              `${where} ("${nomeBloco}"): fator de gatilho desconhecido ("${gatilho}").`
            );
            return;
          }
          let basisKind: "base" | "factor" = "base";
          let basisFactorId: string | undefined;
          if (isRecord(rawB.base)) {
            const nomeBase = asString(rawB.base.fator);
            const baseId = factorIdByLabel.get(labelKey(nomeBase));
            if (!baseId) {
              errors.push(
                `${where} ("${nomeBloco}"): fator-base desconhecido ("${nomeBase}").`
              );
              return;
            }
            basisKind = "factor";
            basisFactorId = baseId;
          } else if (rawB.base !== undefined && rawB.base !== "base") {
            errors.push(
              `${where} ("${nomeBloco}"): "base" deve ser "base" ou { "fator": "<rótulo>" }.`
            );
            return;
          }

          const tipo = asString(rawB.tipo) || "pct";
          if (tipo !== "pct" && tipo !== "flat" && tipo !== "per_unit") {
            errors.push(
              `${where} ("${nomeBloco}"): "tipo" inválido ("${tipo}"). Válidos: pct | flat | per_unit.`
            );
            return;
          }
          if (tipo === "per_unit" && basisKind !== "factor") {
            errors.push(
              `${where} ("${nomeBloco}"): "per_unit" exige uma base do tipo { "fator": … } — é o realizado dele que multiplica o valor.`
            );
            return;
          }
          const faixaPor = asString(rawB.faixaPor) || "attainment";
          if (faixaPor !== "attainment" && faixaPor !== "realized") {
            errors.push(
              `${where} ("${nomeBloco}"): "faixaPor" inválido ("${faixaPor}"). Válidos: attainment | realized.`
            );
            return;
          }

          const tiers: CompCommissionTier[] = [];
          const rawTiers = Array.isArray(rawB.faixas) ? rawB.faixas : [];
          if (rawTiers.length === 0) {
            errors.push(`${where} ("${nomeBloco}"): "faixas" não pode ser vazia.`);
            return;
          }
          for (let j = 0; j < rawTiers.length; j++) {
            const t = rawTiers[j];
            if (!isRecord(t)) continue;
            const from = asNumber(t.aPartirDe);
            if (from == null || from < 0) {
              errors.push(`${where}.faixas[${j}]: "aPartirDe" precisa ser um número >= 0.`);
              return;
            }
            if (tipo === "pct") {
              const rate = asNumber(t.percentual);
              if (rate == null || rate < 0) {
                errors.push(
                  `${where}.faixas[${j}]: bloco "pct" exige "percentual" >= 0.`
                );
                return;
              }
              tiers.push({ fromPct: from, ratePct: rate });
            } else {
              const amount = asNumber(t.valor);
              if (amount == null || amount < 0) {
                errors.push(
                  `${where}.faixas[${j}]: bloco "${tipo}" exige "valor" >= 0.`
                );
                return;
              }
              tiers.push({ fromPct: from, amount });
            }
          }

          const prev = prevById.get(labelKey(nomeBloco));
          blocks.push({
            // Id herdado do bloco de mesmo rótulo (chave de breakdown e das
            // memberTiers) — regenerar perderia os overrides por membro.
            id: prev?.id ?? deps.newId("c"),
            label: nomeBloco,
            triggerFactorId: triggerId,
            basisKind,
            ...(basisFactorId ? { basisFactorId } : {}),
            tierBy: faixaPor,
            kind: tipo,
            tiers,
            // Tabelas por membro são config durável e NUNCA vêm do JSON.
            ...(prev?.memberTiers ? { memberTiers: prev.memberTiers } : {}),
          });
        });
        if (errors.length === 0) config.commissions = blocks;
      }
    }

    // ---- Fórmula livre do total (tokenizada sobre o config RESULTANTE).
    if (plano.formulaTotalTexto !== undefined) {
      if (plano.formulaTotalTexto === null) {
        config.totalFormula = null;
      } else {
        const texto = asString(plano.formulaTotalTexto);
        const tok = tokenizeFormulaText(texto, deps.compCatalogFor(config));
        if (!tok.ok) errors.push(`Fórmula do total: ${tok.error}`);
        else config.totalFormula = tok.formula;
      }
    }
  }

  // ---- Metas
  const targets: CompEditResolved["targets"] = [];
  if (obj.metas !== undefined) {
    if (!Array.isArray(obj.metas)) {
      errors.push('"metas" precisa ser uma lista.');
    } else if (obj.metas.length > MAX_AI_COMP_TARGETS) {
      errors.push(
        `"metas" tem ${obj.metas.length} células — o máximo por resposta é ${MAX_AI_COMP_TARGETS}.`
      );
    } else {
      const factorIdByLabel = new Map(
        config.factors.map((f) => [labelKey(f.label), f.id])
      );
      obj.metas.forEach((rawT, i) => {
        const where = `metas[${i}]`;
        if (!isRecord(rawT)) {
          errors.push(`${where}: precisa ser um objeto.`);
          return;
        }
        const membro = asString(rawT.membro);
        const fator = asString(rawT.fator);
        const respId = membro ? deps.memberIdByName(membro) : null;
        if (!respId) {
          errors.push(`${where}: membro desconhecido ("${membro}").`);
          return;
        }
        const factorId = factorIdByLabel.get(labelKey(fator));
        if (!factorId) {
          errors.push(`${where}: fator desconhecido ("${fator}").`);
          return;
        }
        let value: number | null = null;
        if (rawT.valor !== null && rawT.valor !== undefined) {
          const n = asNumber(rawT.valor);
          if (n == null) {
            errors.push(
              `${where}: "valor" precisa ser um número ou null (null EXCLUI a meta).`
            );
            return;
          }
          value = n;
        }
        targets.push({ responsibleId: respId, factorId, value });
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: ParsedCompEdit = {
    ...(obj.plano !== undefined ? { plano: obj.plano as ParsedCompEdit["plano"] } : {}),
    ...(obj.metas !== undefined
      ? { metas: obj.metas as unknown as ParsedCompTarget[] }
      : {}),
  };
  return {
    ok: true,
    value,
    warnings,
    resolved: { value, config, nome, ativo, targets, warnings },
  };
}
