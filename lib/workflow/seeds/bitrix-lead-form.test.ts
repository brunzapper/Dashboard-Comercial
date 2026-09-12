// Versão: 1.2 | Data: 12/09/2026
// v1.2 (12/09/2026): o endereço padrão do e-mail é dado do esquema.
// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): a base do passo de registro passa a ser conferida
//   contra o CATÁLOGO (BUILTIN_SOURCES) em vez de contra o literal que o
//   próprio esquema escreve — o teste antigo afirmava a si mesmo e deixou
//   passar um record_type ("lead") onde a action espera uma source-key
//   ("leads"), quebrando o formulário em produção com o esquema verde.
// O esquema de fábrica é DADO — e dado erra calado. Estes testes pinam as duas
// propriedades que o desenho promete: o formulário é PLANO (nenhuma noção de
// entidade chega a quem preenche) e forma um par fechado com os passos — todo
// campo perguntado é consumido por algum passo, e todo {{form.x}} citado
// existe no formulário.
import { describe, expect, it } from "vitest";

import { BUILTIN_SOURCES } from "@/lib/sources";

import { formRefsIn } from "../refs";
import { parseWorkflowDefinition, visibleFields } from "../types";
import { bitrixLeadFormDefinition, BITRIX_LEAD_FORM_KEY } from "./bitrix-lead-form";

const def = parseWorkflowDefinition(bitrixLeadFormDefinition())!;

/** Todos os templates dos passos, em uma lista. */
function allTemplates(): string[] {
  const out: string[] = [];
  for (const step of def.steps) {
    if (step.type !== "record.create" && step.params.skipIfEmpty) {
      out.push(step.params.skipIfEmpty);
    }
    if (step.type === "bitrix.entity.add" || step.type === "bitrix.entity.update") {
      for (const spec of Object.values(step.params.fields)) out.push(spec.value);
      if (step.type === "bitrix.entity.update") out.push(step.params.entityId.value);
    } else if (step.type === "record.update") {
      out.push(step.params.recordIdFrom);
      for (const spec of Object.values(step.params.fields)) out.push(spec.value);
    } else {
      for (const spec of Object.values(step.params.core)) out.push(spec.value);
      for (const spec of Object.values(step.params.custom)) out.push(spec.value);
    }
  }
  return out;
}

describe("esquema de fábrica bitrix_lead_form", () => {
  it("é válido pelo parse fail-closed", () => {
    expect(def).not.toBeNull();
    expect(BITRIX_LEAD_FORM_KEY).toBe("bitrix_lead_form");
  });

  it("traz os campos padrão pedidos, visíveis e nesta ordem", () => {
    expect(visibleFields(def).map((f) => f.key)).toEqual([
      "empresa",
      "contato_nome",
      "telefone",
      "email",
      "fonte",
      "fonte_info",
      "comentarios",
    ]);
  });

  it("Fonte, Etapa e Responsável são listas alimentadas pelo sistema", () => {
    const byKey = new Map(def.form.fields.map((f) => [f.key, f]));
    expect(byKey.get("fonte")?.optionsSource).toBe("bitrix:sources");
    expect(byKey.get("etapa")?.optionsSource).toBe("bitrix:lead_status");
    expect(byKey.get("responsavel")?.optionsSource).toBe("responsibles");
    // Nenhuma delas é lista digitada à mão.
    for (const k of ["fonte", "etapa", "responsavel"]) {
      expect(byKey.get(k)?.options).toBeUndefined();
    }
  });

  it("o formulário é PLANO: nenhum campo carrega marca de entidade", () => {
    // Se um dia alguém acrescentar `entity`/`group` ao campo, é sinal de que a
    // UI voltou a agrupar por entidade — que é justamente o que não se quer.
    for (const field of def.form.fields) {
      expect(Object.keys(field)).not.toContain("entity");
      expect(Object.keys(field)).not.toContain("group");
      expect(Object.keys(field)).not.toContain("step");
    }
  });

  it("toda ref {{form.x}} dos passos existe no formulário", () => {
    const known = new Set(def.form.fields.map((f) => f.key));
    for (const t of allTemplates()) {
      for (const ref of formRefsIn(t)) {
        expect(known.has(ref), `ref desconhecida: ${ref}`).toBe(true);
      }
    }
  });

  it("todo campo VISÍVEL é consumido por algum passo", () => {
    // Campo perguntado que nenhum passo usa é um campo mudo: a pessoa digita e
    // o dado se perde.
    const used = new Set(allTemplates().flatMap(formRefsIn));
    for (const field of visibleFields(def)) {
      expect(used.has(field.key), `campo mudo: ${field.key}`).toBe(true);
    }
  });

  it("os três passos do CRM encadeiam os ids", () => {
    const byId = new Map(def.steps.map((s) => [s.id, s]));
    const contato = byId.get("criar_contato")!;
    const lead = byId.get("criar_lead")!;
    expect(contato.type).toBe("bitrix.entity.add");
    if (contato.type !== "bitrix.entity.add" || lead.type !== "bitrix.entity.add") {
      throw new Error("passos do CRM ausentes");
    }
    expect(contato.params.fields.COMPANY_ID.value).toContain(
      "{{steps.criar_empresa.id}}"
    );
    expect(lead.params.fields.COMPANY_ID.value).toContain(
      "{{steps.criar_empresa.id}}"
    );
    expect(lead.params.fields.CONTACT_ID.value).toContain(
      "{{steps.criar_contato.id}}"
    );
  });

  it("o registro local nasce vinculado ao lead", () => {
    const rec = def.steps.find((s) => s.type === "record.create")!;
    if (rec.type !== "record.create") throw new Error("passo ausente");
    expect(rec.params.linkSourceIdFrom).toBe("criar_lead");
  });

  // v1.1 (09/09/2026): o teste antigo pinava `sourceKey === "lead"` — o mesmo
  // literal que o esquema escrevia, então ele afirmava a si mesmo e passou
  // verde enquanto o formulário morria em produção. "lead" é o RECORD_TYPE da
  // base; a chave do catálogo é "leads", e é a chave que a action procura.
  // A pergunta certa é se ela EXISTE no catálogo, não qual string é.
  it("a base do passo de registro é uma SOURCE-KEY do catálogo, não um record_type", () => {
    const rec = def.steps.find((s) => s.type === "record.create")!;
    if (rec.type !== "record.create") throw new Error("passo ausente");
    const keys = BUILTIN_SOURCES.map((s) => s.key);
    expect(keys).toContain(rec.params.sourceKey);
    // A confusão que causou o bug: nenhum record_type é uma chave válida aqui.
    expect(BUILTIN_SOURCES.map((s) => s.recordType)).not.toContain(
      rec.params.sourceKey
    );
  });

  it("e-mail e telefone declaram o formato de comunicação no ESQUEMA", () => {
    const lead = def.steps.find((s) => s.id === "criar_lead")!;
    if (lead.type !== "bitrix.entity.add") throw new Error("passo ausente");
    expect(lead.params.fields.EMAIL.shape).toBe("comm");
    expect(lead.params.fields.PHONE.shape).toBe("comm");
  });

  // v1.2 (12/09/2026): lead sem e-mail não vai com o campo vazio ao CRM. O
  // endereço é DADO do esquema, e é o `defaultValue` — não um `required`, que
  // barraria o lançamento, nem uma constante no código.
  it("o e-mail tem endereço padrão, e ele é opcional (não bloqueia o lançamento)", () => {
    const email = def.form.fields.find((f) => f.key === "email")!;
    expect(email.defaultValue).toBe("sememail@sememail.com");
    expect(email.required).toBe(false);
    expect(email.visible).toBe(true);
  });
});
