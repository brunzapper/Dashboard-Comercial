// Versão: 1.1 | Data: 08/09/2026
// O parse do esquema é FAIL-CLOSED: estas asserções existem para que uma
// definição meio-válida nunca vire "fluxo que roda como der".
import { describe, expect, it } from "vitest";

import { bitrixLeadFormDefinition } from "./seeds/bitrix-lead-form";
import { parseWorkflowDefinition, visibleFields } from "./types";

const base = () => JSON.parse(JSON.stringify(bitrixLeadFormDefinition()));

describe("parseWorkflowDefinition", () => {
  it("aceita o esquema de fábrica e sobrevive ao round-trip", () => {
    const parsed = parseWorkflowDefinition(base());
    expect(parsed).not.toBeNull();
    // Reparsear a saída devolve a mesma coisa: é o que o save faz antes de
    // gravar, e um parse não-idempotente perderia configuração a cada save.
    expect(parseWorkflowDefinition(parsed)).toEqual(parsed);
  });

  it("recusa versão desconhecida", () => {
    expect(parseWorkflowDefinition({ ...base(), version: 2 })).toBeNull();
  });

  it("recusa tipo de passo desconhecido", () => {
    const def = base();
    def.steps[0].type = "http.post";
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("recusa conexão fora do registry", () => {
    const def = base();
    // Se isto passasse, o jsonb estaria escolhendo qual variável de ambiente
    // o servidor lê.
    def.steps[0].connection = "SUPABASE_SERVICE_ROLE_KEY";
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("recusa link para um passo que não existe", () => {
    const def = base();
    const record = def.steps.find((s: { type: string }) => s.type === "record.create");
    record.params.linkSourceIdFrom = "passo_fantasma";
    // Sem isto, a linha local nasceria sem source_id e o sync criaria uma
    // duplicata do lead.
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("recusa ids de passo duplicados", () => {
    const def = base();
    def.steps[1].id = def.steps[0].id;
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("recusa chaves de campo duplicadas", () => {
    const def = base();
    def.form.fields[1].key = def.form.fields[0].key;
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("recusa campo de seleção sem provedor de opções", () => {
    const def = base();
    const fonte = def.form.fields.find((f: { key: string }) => f.key === "fonte");
    delete fonte.optionsSource;
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("recusa fieldId do Bitrix fora do formato", () => {
    const def = base();
    def.steps[0].params.fields["title; drop"] = { value: "x" };
    expect(parseWorkflowDefinition(def)).toBeNull();
  });

  it("campo sem `visible` nasce VISÍVEL e passo sem `enabled` nasce LIGADO", () => {
    // Ausência não pode virar "some calado" — quem acrescenta um campo ao
    // jsonb à mão espera vê-lo.
    const parsed = parseWorkflowDefinition({
      version: 1,
      form: { fields: [{ key: "a", label: "A", type: "texto" }] },
      steps: [
        {
          id: "s1",
          type: "record.create",
          label: "S",
          params: { sourceKey: "lead", core: { title: "{{form.a}}" } },
        },
      ],
    });
    expect(parsed?.form.fields[0].visible).toBe(true);
    expect(parsed?.steps[0].enabled).toBe(true);
  });

  it("ordena os campos por `order`, não pela ordem do array", () => {
    const parsed = parseWorkflowDefinition({
      version: 1,
      form: {
        fields: [
          { key: "b", label: "B", type: "texto", order: 5 },
          { key: "a", label: "A", type: "texto", order: 1 },
        ],
      },
      steps: [],
    });
    expect(parsed?.form.fields.map((f) => f.key)).toEqual(["a", "b"]);
  });

  it("visibleFields devolve só o que o formulário pergunta", () => {
    const def = parseWorkflowDefinition(base())!;
    const keys = visibleFields(def).map((f) => f.key);
    expect(keys).toContain("empresa");
    // `etapa` e `responsavel` nascem ocultos — disponíveis, não perguntados.
    expect(keys).not.toContain("etapa");
    expect(keys).not.toContain("responsavel");
  });
});

describe("parseWorkflowDefinition — passos que ALTERAM (v1.1)", () => {
  const base = (step: unknown) => ({
    version: 1,
    form: { fields: [] },
    steps: [step],
  });

  const update = {
    id: "altera",
    type: "bitrix.entity.update",
    label: "Altera lead",
    connection: "bitrix_webhook",
    params: {
      entity: "lead",
      entityId: "{{form.bitrix_id}}",
      fields: { TITLE: "{{form.empresa}}" },
    },
  };

  it("aceita bitrix.entity.update com alvo", () => {
    const def = parseWorkflowDefinition(base(update));
    expect(def?.steps[0].type).toBe("bitrix.entity.update");
  });

  it("update SEM alvo é esquema inválido — não existe update sem id", () => {
    expect(
      parseWorkflowDefinition(
        base({ ...update, params: { ...update.params, entityId: "" } })
      )
    ).toBeNull();
    expect(
      parseWorkflowDefinition(
        base({ ...update, params: { entity: "lead", fields: {} } })
      )
    ).toBeNull();
  });

  it("record.update aceita coluna do núcleo e custom:, e exige algum campo", () => {
    const ok = parseWorkflowDefinition(
      base({
        id: "grava",
        type: "record.update",
        label: "Grava",
        params: {
          recordIdFrom: "{{ctx.triggerRecordId}}",
          fields: { stage: "ganho", "custom:status": "ok" },
        },
      })
    );
    expect(ok?.steps[0].type).toBe("record.update");

    // Sem campo nenhum o passo seria inerte disfarçado de passo.
    expect(
      parseWorkflowDefinition(
        base({
          id: "grava",
          type: "record.update",
          label: "Grava",
          params: { recordIdFrom: "{{ctx.triggerRecordId}}", fields: {} },
        })
      )
    ).toBeNull();

    // Sem alvo idem.
    expect(
      parseWorkflowDefinition(
        base({
          id: "grava",
          type: "record.update",
          label: "Grava",
          params: { fields: { stage: "x" } },
        })
      )
    ).toBeNull();
  });

  it("sourceRef do campo sobrevive ao parse (é a origem quando quem alimenta é um registro)", () => {
    const def = parseWorkflowDefinition({
      version: 1,
      form: {
        fields: [
          {
            key: "empresa",
            label: "Empresa",
            type: "texto",
            sourceRef: "  title  ",
          },
        ],
      },
      steps: [],
    });
    expect(def?.form.fields[0].sourceRef).toBe("title");
  });
});
