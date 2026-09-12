// Versão: 1.0 | Data: 12/09/2026
// Paridade do SPEC com o código: tipo de campo novo no Workflow tem de aparecer
// no enunciado, e o EXEMPLO tem de passar pelo validador REAL — um exemplo
// quebrado ensina a IA errado, e o erro só apareceria em produção, na cara de
// quem está lançando um lead.
import { describe, expect, it } from "vitest";

import { WORKFLOW_FIELD_TYPES } from "@/lib/workflow/types";

import {
  FORM_FILL_SPEC,
  FORM_FILL_SPEC_EXAMPLE,
  buildFormFillPromptText,
} from "./instructions";
import { FORM_FILL_FORMAT, FORM_FILL_VERSION, type FormFillContext } from "./types";
import { validateFormFill } from "./validate";

const CTX: FormFillContext = {
  schemaKey: "bitrix_lead_form",
  schemaLabel: "Formulário de criação Bitrix",
  fields: [
    { key: "empresa", label: "Nome do Lead (empresa)", type: "texto", required: true },
    { key: "contato_nome", label: "Nome do contato", type: "texto", required: true },
    { key: "telefone", label: "Telefone do contato", type: "telefone", required: false },
    { key: "email", label: "E-mail", type: "email", required: false },
    {
      key: "fonte",
      label: "Fonte",
      type: "selecao",
      required: false,
      options: ["Indicação", "Site", "Outro"],
    },
    { key: "comentarios", label: "Comentários", type: "texto_longo", required: false },
  ],
};

describe("FORM_FILL_SPEC é derivado do código", () => {
  it("todo tipo de campo do Workflow tem regra no enunciado", () => {
    for (const t of WORKFLOW_FIELD_TYPES) {
      expect(FORM_FILL_SPEC).toContain(`- ${t}:`);
    }
  });

  it("o envelope citado é o do contrato", () => {
    expect(FORM_FILL_SPEC).toContain(FORM_FILL_FORMAT);
    expect(FORM_FILL_SPEC).toContain(String(FORM_FILL_VERSION));
    expect(FORM_FILL_SPEC).toContain('"respostas"');
  });

  it("o EXEMPLO do enunciado passa pelo validador real", () => {
    const v = validateFormFill(FORM_FILL_SPEC_EXAMPLE, CTX);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.values.empresa).toBe("ACME Indústria");
    expect(v.values.contato_nome).toBe("Maria Silva");
    expect(v.values.fonte).toBe("Indicação");
    expect(v.warnings).toHaveLength(1);
  });

  it("o prompt carrega a data de hoje e o rótulo do formulário", () => {
    const text = buildFormFillPromptText({
      schemaLabel: "Formulário de criação Bitrix",
      todayIso: "2026-09-12",
      catalogJson: '{"campos":[]}',
    });
    expect(text).toContain("2026-09-12");
    expect(text).toContain("Formulário de criação Bitrix");
    expect(text).toContain(FORM_FILL_SPEC.trim());
  });
});
