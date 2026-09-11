// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): `tarefa_data` e `adiar_sequencia`.
// O caso que estes testes guardam é o que a v1.1 não cobria e que quebrou em
// produção: numa SÉRIE todas as ocorrências têm o mesmo título, então
// `editar`/`concluir`/`excluir` caíam sempre no ramo de ambiguidade. A data é a
// saída, e o erro sem ela precisa ENSINAR a saída em vez de mandar renomear a
// tarefa na tela.
// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): a ação `excluir` e o modo `allowDelete`.
// O que os testes novos protegem é a LINHA: sem o modo, `excluir` é ação
// desconhecida (é isso que mantém /operacao/tarefas sem exclusão em lote); com
// ele, o alvo resolve como qualquer outro — MENOS ocorrência de série, que o
// tick recriaria, fazendo a IA prometer algo que não gruda.
// Guardas do contrato `tarefas-edit`. O que se pina aqui é o conjunto de
// silêncios que o validador transforma em erro corrigível: título ambíguo
// (escolher um seria adivinhar), hora final órfã (o choke point a DESCARTA
// sem avisar) e fase que não existe no quadro efetivo (a tarefa iria para uma
// coluna invisível).
import { describe, expect, it } from "vitest";

import { MAX_AI_TASK_ACTIONS, type TasksEditContext } from "./types";
import { serializeTasksEdit, validateTasksEdit } from "./validate";

function makeCtx(over: Partial<TasksEditContext> = {}): TasksEditContext {
  return {
    tasks: [
      {
        id: "t1",
        title: "Enviar contrato",
        phase: "a_fazer",
        boardId: null,
        completed: false,
        responsibleId: null,
        dueDate: null,
        dueTime: "09:00",
        fromSeries: false,
      },
      {
        id: "t2",
        title: "Tarefa fechada",
        phase: "concluida",
        boardId: null,
        completed: true,
        responsibleId: null,
        dueDate: null,
        dueTime: null,
        fromSeries: false,
      },
      {
        id: "t3",
        title: "No quadro",
        phase: "triagem",
        boardId: "b1",
        completed: false,
        responsibleId: null,
        dueDate: null,
        dueTime: null,
        fromSeries: false,
      },
    ],
    responsibles: [{ id: "r1", name: "Maria Silva" }],
    boards: [
      {
        id: "b1",
        name: "Onboarding",
        phases: [
          { key: "triagem", label: "Triagem", completes: false },
          { key: "pronto", label: "Pronto", completes: true },
        ],
      },
    ],
    defaultPhases: [
      { key: "a_fazer", label: "A fazer", completes: false },
      { key: "concluida", label: "Concluída", completes: true },
    ],
    ...over,
  };
}

/**
 * Uma SÉRIE: três ocorrências, mesmo título, prazos diferentes. É a forma
 * normal de uma sequência periódica — e era exatamente o que o contrato não
 * sabia endereçar.
 */
function ctxSerie(): TasksEditContext {
  const base = makeCtx();
  const occ = (id: string, dueDate: string) => ({
    ...base.tasks[0],
    id,
    title: "Acompanhar deal em Nutrição",
    dueDate,
    dueTime: null,
    fromSeries: true,
  });
  return {
    ...base,
    tasks: [occ("s1", "2026-09-15"), occ("s2", "2026-09-30"), occ("s3", "2026-10-15")],
    series: [{ key: "nutricao", label: "Acompanhamento de Nutrição" }],
  };
}

const run = (
  acoes: unknown[],
  ctx = makeCtx(),
  /** v1.1: o modo da superfície (só a Tree liga a exclusão). */
  opts?: { allowDelete?: boolean; allowSeries?: boolean }
) =>
  validateTasksEdit(
    JSON.stringify({ formato: "tarefas-edit", versao: 1, acoes }),
    ctx,
    opts
  );

describe("resolução do alvo", () => {
  it("título ambíguo é ERRO, nunca uma escolha", () => {
    const ctx = makeCtx();
    ctx.tasks.push({ ...ctx.tasks[0], id: "t9" });
    const res = run([{ acao: "editar", tarefa: "Enviar contrato", data: null }], ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("2 tarefas");
  });

  it("concluir só enxerga tarefas EM ABERTO", () => {
    expect(run([{ acao: "concluir", tarefa: "Tarefa fechada" }]).ok).toBe(false);
    expect(run([{ acao: "concluir", tarefa: "Enviar contrato" }]).ok).toBe(true);
  });

  it("título fora do catálogo é erro (nunca cria uma parecida)", () => {
    const res = run([{ acao: "editar", tarefa: "Não existe", data: null }]);
    expect(res.ok).toBe(false);
  });
});

describe("prazo", () => {
  it("hora_fim sem hora inicial é erro (o choke point a descartaria calado)", () => {
    const res = run([
      { acao: "criar", titulo: "X", hora_fim: "15:00" },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("hora_fim");
  });

  it("na edição, a hora JÁ GRAVADA serve de base para a hora final", () => {
    // t1 tem due_time 09:00 — "hora_fim: 10:00" é válido sem repetir a hora.
    const res = run([
      { acao: "editar", tarefa: "Enviar contrato", hora_fim: "10:00" },
    ]);
    expect(res.ok).toBe(true);
  });

  it("hora final antes da inicial é erro", () => {
    const res = run([
      { acao: "criar", titulo: "X", hora: "14:00", hora_fim: "13:00" },
    ]);
    expect(res.ok).toBe(false);
  });

  it("data fora de YYYY-MM-DD é erro", () => {
    expect(run([{ acao: "criar", titulo: "X", data: "10/09/2026" }]).ok).toBe(false);
  });
});

describe("fase", () => {
  it("aceita o rótulo da coluna do QUADRO escolhido", () => {
    const res = run([
      { acao: "criar", titulo: "X", quadro: "Onboarding", fase: "Pronto" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a = res.actions[0];
    expect(a.acao === "criar" && a.fase?.key).toBe("pronto");
    expect(a.acao === "criar" && a.fase?.completes).toBe(true);
  });

  it("recusa fase de OUTRO quadro (a tarefa cairia numa coluna invisível)", () => {
    const res = run([{ acao: "criar", titulo: "X", fase: "Triagem" }]);
    expect(res.ok).toBe(false);
  });

  it("na edição, as fases vêm do quadro da PRÓPRIA tarefa", () => {
    expect(run([{ acao: "editar", tarefa: "No quadro", fase: "Pronto" }]).ok).toBe(true);
    expect(run([{ acao: "editar", tarefa: "No quadro", fase: "A fazer" }]).ok).toBe(false);
  });
});

describe("forma da resposta", () => {
  it("recusa chave desconhecida na ação", () => {
    const res = run([{ acao: "criar", titulo: "X", record_id: "abc" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("record_id");
  });

  it("recusa ação sem mudança", () => {
    expect(run([{ acao: "editar", tarefa: "Enviar contrato" }]).ok).toBe(false);
  });

  it("recusa responsável desconhecido", () => {
    expect(run([{ acao: "criar", titulo: "X", responsavel: "Fulano" }]).ok).toBe(false);
  });

  it("respeita o teto do lote", () => {
    const acoes = Array.from({ length: MAX_AI_TASK_ACTIONS + 1 }, (_, i) => ({
      acao: "criar",
      titulo: `T${i}`,
    }));
    const res = run(acoes);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain(String(MAX_AI_TASK_ACTIONS));
  });
});

describe("serializeTasksEdit", () => {
  it("faz round-trip pelo validador (a prévia pendente volta ao modelo)", () => {
    // Se a serialização perdesse um campo ou emitisse id, o turno seguinte
    // reinjetaria uma prévia que o próprio validador recusaria.
    const ctx = makeCtx();
    const first = run(
      [
        { acao: "criar", titulo: "Nova", quadro: "Onboarding", fase: "Pronto",
          responsavel: "Maria Silva", data: "2026-09-10", hora: "09:00",
          hora_fim: "10:00", descricao: null },
        { acao: "editar", tarefa: "Enviar contrato", responsavel: null },
        { acao: "concluir", tarefa: "Enviar contrato" },
      ],
      ctx
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const json = serializeTasksEdit(first.actions);
    expect(json).not.toContain('"id"');
    const again = validateTasksEdit(json, ctx);
    expect(again.ok ? [] : again.errors).toEqual([]);
    if (!again.ok) return;
    expect(again.actions).toEqual(first.actions);
  });
});

// ---------------------------------------------------------------------------
// v1.1 — `excluir` e o modo por superfície.
// ---------------------------------------------------------------------------
describe("excluir só existe com allowDelete", () => {
  const excluir = [{ acao: "excluir", tarefa: "Enviar contrato" }];

  it("SEM o modo é ação desconhecida — /operacao/tarefas segue sem exclusão", () => {
    const v = run(excluir);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join(" ")).toContain('"acao" inválida');
      // A frase lista só o que aquela superfície aceita.
      expect(v.errors.join(" ")).toContain("criar, editar ou concluir");
    }
  });

  it("COM o modo resolve o alvo como qualquer outra ação", () => {
    const v = run(excluir, makeCtx(), { allowDelete: true });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.actions).toEqual([
        { acao: "excluir", alvo: { id: "t1", titulo: "Enviar contrato" } },
      ]);
    }
  });

  it("excluir alcança a CONCLUÍDA — some com ela, não é o mesmo que fechar", () => {
    const v = run([{ acao: "excluir", tarefa: "Tarefa fechada" }], makeCtx(), {
      allowDelete: true,
    });
    expect(v.ok).toBe(true);
  });

  it("título que não existe segue erro, com o modo ligado", () => {
    const v = run([{ acao: "excluir", tarefa: "Não existe" }], makeCtx(), {
      allowDelete: true,
    });
    expect(v.ok).toBe(false);
  });

  it("o round-trip do serialize devolve a ação", () => {
    const v = run(excluir, makeCtx(), { allowDelete: true });
    if (!v.ok) throw new Error("esperava ok");
    expect(serializeTasksEdit(v.actions)).toContain('"acao": "excluir"');
  });
});

describe("ocorrência de série não se exclui por aqui", () => {
  // Excluir uma ocorrência sem desligar a série é desfeito pelo tick no minuto
  // seguinte: a trava `uq_tasks_series_occurrence` só impede recriar enquanto a
  // linha existe. A IA prometeria algo que não gruda.
  const base = makeCtx();
  const comSerie = makeCtx({
    tasks: base.tasks.map((t) =>
      t.id === "t1" ? { ...t, fromSeries: true } : t
    ),
  });

  it("excluir é recusado, e o erro ensina a saída", () => {
    const v = run([{ acao: "excluir", tarefa: "Enviar contrato" }], comSerie, {
      allowDelete: true,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join(" ")).toMatch(/sequência periódica/i);
      expect(v.errors.join(" ")).toMatch(/Conclua-a|encerre a sequência/i);
    }
  });

  it("concluir a MESMA tarefa passa — isso gruda", () => {
    const v = run([{ acao: "concluir", tarefa: "Enviar contrato" }], comSerie, {
      allowDelete: true,
    });
    expect(v.ok).toBe(true);
  });

  it("editar (remarcar) a MESMA tarefa passa", () => {
    const v = run(
      [{ acao: "editar", tarefa: "Enviar contrato", data: "2026-09-20" }],
      comSerie,
      { allowDelete: true }
    );
    expect(v.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// v1.2 — o alvo por data, e a sequência como alvo.
// ---------------------------------------------------------------------------
describe("ocorrências homônimas se resolvem pela DATA", () => {
  it("sem tarefa_data segue ambíguo — mas o erro ensina a saída", () => {
    const v = run([{ acao: "editar", tarefa: "Acompanhar deal em Nutrição", data: "2026-10-31" }], ctxSerie());
    expect(v.ok).toBe(false);
    if (!v.ok) {
      // O erro antigo mandava "renomear uma delas na tela": impossível numa
      // série, e foi o que fez a IA devolver a pergunta para o usuário.
      expect(v.errors.join(" ")).toContain("tarefa_data");
      expect(v.errors.join(" ")).toContain("2026-09-15");
    }
  });

  it("com tarefa_data mira a ocorrência certa", () => {
    const v = run(
      [
        {
          acao: "editar",
          tarefa: "Acompanhar deal em Nutrição",
          tarefa_data: "2026-09-30",
          data: "2026-10-31",
        },
      ],
      ctxSerie()
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      const a = v.actions[0];
      expect(a.acao === "editar" && a.alvo.id).toBe("s2");
      expect(a.acao === "editar" && a.alvo.data).toBe("2026-09-30");
    }
  });

  it("data que não existe nesse título é erro, e lista os prazos", () => {
    const v = run(
      [
        {
          acao: "concluir",
          tarefa: "Acompanhar deal em Nutrição",
          tarefa_data: "2026-12-01",
        },
      ],
      ctxSerie()
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toContain("2026-10-15");
  });

  it("tarefa_data null mira a SEM prazo", () => {
    const ctx = ctxSerie();
    ctx.tasks.push({ ...ctx.tasks[0], id: "s0", dueDate: null });
    const v = run(
      [
        {
          acao: "concluir",
          tarefa: "Acompanhar deal em Nutrição",
          tarefa_data: null,
        },
      ],
      ctx
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.actions[0].acao === "concluir" && v.actions[0].alvo.id).toBe("s0");
  });

  it("duas de mesmo título no MESMO dia seguem erro — aí é empate de verdade", () => {
    const ctx = ctxSerie();
    ctx.tasks.push({ ...ctx.tasks[0], id: "s9" });
    const v = run(
      [
        {
          acao: "concluir",
          tarefa: "Acompanhar deal em Nutrição",
          tarefa_data: "2026-09-15",
        },
      ],
      ctx
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toContain("mesmo dia");
  });

  it("o round-trip devolve a data que desempatou", () => {
    // Sem isso, a prévia reinjetada cairia de novo no erro que ela resolveu.
    const v = run(
      [
        {
          acao: "concluir",
          tarefa: "Acompanhar deal em Nutrição",
          tarefa_data: "2026-09-15",
        },
      ],
      ctxSerie()
    );
    if (!v.ok) throw new Error("esperava ok");
    const json = serializeTasksEdit(v.actions);
    expect(json).toContain('"tarefa_data": "2026-09-15"');
    const again = validateTasksEdit(json, ctxSerie());
    expect(again.ok).toBe(true);
  });

  it("título único segue funcionando SEM a chave (nada mudou para quem já usava)", () => {
    const v = run([{ acao: "concluir", tarefa: "Enviar contrato" }]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(serializeTasksEdit(v.actions)).not.toContain("tarefa_data");
  });
});

describe("adiar_sequencia", () => {
  const adiar = [
    { acao: "adiar_sequencia", sequencia: "Acompanhamento de Nutrição", ate: "2026-10-31" },
  ];

  it("não existe sem o modo", () => {
    const v = run(adiar, ctxSerie());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toContain('"acao" inválida');
  });

  it("com o modo, resolve a série pelo RÓTULO", () => {
    const v = run(adiar, ctxSerie(), { allowSeries: true });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.actions).toEqual([
        {
          acao: "adiar_sequencia",
          serie: { key: "nutricao", label: "Acompanhamento de Nutrição" },
          ate: "2026-10-31",
        },
      ]);
    }
  });

  it("registro SEM série recusa mesmo com o modo ligado", () => {
    // É o que protege quem não pode gravar em series_settings: o core não
    // publica a lista, e aí o verbo não tem alvo possível.
    const v = run(adiar, makeCtx(), { allowSeries: true });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toMatch(/não há sequência/i);
  });

  it("com UMA série, o nome é dispensável", () => {
    const v = run(
      [{ acao: "adiar_sequencia", ate: "2026-10-31" }],
      ctxSerie(),
      { allowSeries: true }
    );
    expect(v.ok).toBe(true);
  });

  it("data malformada é erro", () => {
    const v = run(
      [{ acao: "adiar_sequencia", sequencia: "Acompanhamento de Nutrição", ate: "31/10/2026" }],
      ctxSerie(),
      { allowSeries: true }
    );
    expect(v.ok).toBe(false);
  });

  it("faz round-trip pelo validador", () => {
    const v = run(adiar, ctxSerie(), { allowSeries: true });
    if (!v.ok) throw new Error("esperava ok");
    const again = validateTasksEdit(serializeTasksEdit(v.actions), ctxSerie(), {
      allowSeries: true,
    });
    expect(again.ok ? [] : again.errors).toEqual([]);
  });
});
