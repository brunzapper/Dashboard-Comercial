// @vitest-environment jsdom
// Versão: 2.1 | Data: 30/07/2026
// Testes do FormulaEditor — a superfície ÚNICA de edição de fórmulas
// (AGENTS.md), agora UNIFICADA (só texto assistido; o modo visual de
// chips/botões foi absorvido). Invariantes: fórmula com `source` abre
// byte-idêntica e salva sem edição não muda; fórmula token-only é SERIALIZADA
// com rótulo (ref crua quando o rótulo é duplicado — senão não re-tokeniza); a
// linha de status usa as MESMAS mensagens do servidor (tokenizador +
// validateFormulaForContext); o modo formulário emite o contrato
// formula/formula_text/formula_mode do FieldForm com mode SEMPRE "text"; o
// onChange deduplica por assinatura (regressão v1.1 do loop de re-emissão); a
// assinatura viva destaca o argumento sob o caret; autocomplete ignora
// acentos, fecha no Escape e substitui a ref INTEIRA no meio dela.
// v2.1: o dropdown virou Radix Popover (regressão v2.0: portal manual em
// `document.body` herdava `pointer-events: none` do Sheet modal) — testes de
// composição: abrir a lista não rouba o foco e Escape não fecha o Sheet.
// jsdom não faz hit-testing de pointer-events, então o bug original só é
// reproduzível no Playwright (e2e/formula-editor.spec.ts) — aqui garantimos
// a fiação de foco/camadas que o fix exige.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormulaEditor } from "@/components/formula/formula-editor";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RefOption } from "@/lib/records/date-operands";
import { COND_AGG_IN_RECORD_MSG } from "@/lib/records/formula-validate";
import type { Formula, FormulaToken } from "@/lib/records/formulas";

const CATALOG: RefOption[] = [
  { ref: "value", label: "Valor" },
  { ref: "custom:licencas", label: "Licenças" },
];

const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const hidden = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const textbox = () =>
  screen.getByRole("textbox", { name: "Fórmula (texto)" }) as HTMLTextAreaElement;

// O autocomplete reposiciona o caret num requestAnimationFrame.
async function flushRaf() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

function typeText(value: string, caret?: number) {
  const ta = textbox();
  fireEvent.change(ta, { target: { value } });
  const pos = caret ?? value.length;
  ta.setSelectionRange(pos, pos);
  fireEvent.click(ta); // sincroniza o caret interno
  return ta;
}

describe("contrato de form (FieldForm)", () => {
  it("fórmula com source abre byte-idêntica; hidden mode é sempre 'text'", () => {
    const initial: Formula = {
      tokens: [ref("value"), { kind: "op", op: "+" }, { kind: "const", value: 1 }],
      source: "[Valor] + 1",
    };
    const { container } = render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} formInputs />
    );
    expect(textbox()).toHaveValue("[Valor] + 1");
    expect(hidden(container, "formula_mode")).toHaveValue("text");
    expect(hidden(container, "formula_text")).toHaveValue("[Valor] + 1");
    expect(JSON.parse(hidden(container, "formula")!.value).tokens).toEqual(
      initial.tokens
    );
  });

  it("fórmula token-only (legado do builder) é serializada e re-tokeniza igual", () => {
    const initial: Formula = {
      tokens: [ref("value"), { kind: "op", op: "*" }, { kind: "const", value: 2 }],
    };
    const { container } = render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} formInputs />
    );
    expect(hidden(container, "formula_text")).toHaveValue("[Valor] * 2");
    expect(JSON.parse(hidden(container, "formula")!.value).tokens).toEqual(
      initial.tokens
    );
  });

  it("rótulo DUPLICADO serializa a ref crua (senão não re-tokenizaria)", () => {
    const dupCatalog: RefOption[] = [
      { ref: "value", label: "Valor" },
      { ref: "custom:valor2", label: "Valor" },
    ];
    const { container } = render(
      <FormulaEditor
        context="record"
        catalog={dupCatalog}
        initial={{ tokens: [ref("custom:valor2")] }}
        formInputs
      />
    );
    expect(hidden(container, "formula_text")).toHaveValue("[custom:valor2]");
    expect(screen.getByText("Fórmula válida")).toBeInTheDocument();
  });
});

describe("linha de status (fiação com tokenizador + validateFormulaForContext)", () => {
  it("SOMASE em contexto por-registro exibe a mensagem dedicada do servidor", () => {
    const initial: Formula = {
      tokens: [
        { kind: "func", name: "SOMASE" },
        { kind: "lparen" },
        ref("value"),
        { kind: "argsep" },
        ref("value"),
        { kind: "cmp", op: ">" },
        { kind: "const", value: 0 },
        { kind: "rparen" },
      ],
    };
    render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} />
    );
    expect(screen.getByText(COND_AGG_IN_RECORD_MSG)).toBeInTheDocument();
  });

  it("fórmula válida exibe o status verde", () => {
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [ref("value"), { kind: "op", op: "*" }, { kind: "const", value: 2 }] }}
      />
    );
    expect(screen.getByText("Fórmula válida")).toBeInTheDocument();
  });

  it("excludeKeys tira a ref do conjunto de validação (ciclo → coluna desconhecida)", () => {
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [ref("custom:licencas")] }}
        excludeKeys={new Set(["licencas"])}
      />
    );
    // A serialização usa o rótulo do catálogo de EXIBIÇÃO; a tokenização usa o
    // de VALIDAÇÃO (sem a ref de ciclo) — mesma mensagem que o servidor daria.
    expect(
      screen.getByText("Coluna desconhecida: [Licenças]")
    ).toBeInTheDocument();
  });
});

describe("onChange controlado (dedupe por assinatura)", () => {
  it("não reemite quando só a IDENTIDADE do catálogo muda", () => {
    const onChange = vi.fn();
    const initial: Formula = { tokens: [ref("value")] };
    const { rerender } = render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} onChange={onChange} />
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    // Novo array com o MESMO conteúdo (host re-renderizou): nada a emitir.
    rerender(
      <FormulaEditor
        context="record"
        catalog={[...CATALOG.map((o) => ({ ...o }))]}
        initial={initial}
        onChange={onChange}
      />
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      { tokens: initial.tokens, source: "[Valor]" },
      { ok: true }
    );
  });

  it("edição real (digitar) reemite com o novo conteúdo", () => {
    const onChange = vi.fn();
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [ref("value")] }}
        onChange={onChange}
      />
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    typeText("[Valor] + 1");
    expect(onChange).toHaveBeenCalledTimes(2);
    const [formula, status] = onChange.mock.calls[1];
    expect(formula.tokens).toEqual([
      ref("value"),
      { kind: "op", op: "+" },
      { kind: "const", value: 1 },
    ]);
    expect(status.ok).toBe(true);
  });
});

describe("assinatura viva", () => {
  it("destaca o argumento sob o caret", () => {
    render(<FormulaEditor context="aggregate" catalog={CATALOG} />);
    typeText("SOMASE([Valor]; ");
    expect(screen.getByText("Ex.:", { exact: false })).toBeInTheDocument();
    // Assinatura exibida com o 2º parâmetro (condição) ativo.
    const active = screen.getByText("condição; …");
    expect(active.className).toContain("font-semibold");
    expect(
      screen.getByText("Soma o campo apenas nos registros que atendem à condição.")
    ).toBeInTheDocument();
  });

  it("fora de chamada não exibe painel de assinatura", () => {
    render(<FormulaEditor context="aggregate" catalog={CATALOG} />);
    typeText("[Valor] + 1");
    expect(screen.queryByText("Ex.:", { exact: false })).not.toBeInTheDocument();
  });
});

describe("autocomplete de colunas", () => {
  it("busca ignora acentos e a inserção substitui o fragmento", async () => {
    render(<FormulaEditor context="record" catalog={CATALOG} />);
    typeText("[licencas");
    const option = screen.getByRole("option", { name: /Licenças/ });
    fireEvent.mouseDown(option);
    await flushRaf();
    expect(textbox()).toHaveValue("[Licenças]");
  });

  it("inserção no MEIO de uma ref substitui a ref inteira (sem `]` órfão)", async () => {
    render(<FormulaEditor context="record" catalog={CATALOG} />);
    typeText("[Valor] + 1", 1); // caret logo após o `[` de "[Valor]"
    const option = screen.getByRole("option", { name: /Licenças/ });
    fireEvent.mouseDown(option);
    await flushRaf();
    expect(textbox()).toHaveValue("[Licenças] + 1");
  });

  it("Escape fecha a lista e Enter volta a inserir quebra de linha", () => {
    render(<FormulaEditor context="record" catalog={CATALOG} />);
    const ta = typeText("[Val");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    // Sem lista aberta, Enter NÃO é interceptado (preventDefault não chamado).
    const enter = fireEvent.keyDown(ta, { key: "Enter" });
    expect(enter).toBe(true); // não-cancelado = quebra de linha nativa
  });
});

describe("composição com Sheet modal (dropdown em Radix Popover)", () => {
  it("abrir a lista NÃO rouba o foco do textarea (onOpenAutoFocus prevenido)", () => {
    render(<FormulaEditor context="record" catalog={CATALOG} />);
    const ta = textbox();
    act(() => ta.focus());
    typeText("[val");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    // Sem o preventDefault do onOpenAutoFocus, o FocusScope do Radix moveria
    // o foco para o content do popover e a digitação pararia de funcionar.
    expect(document.activeElement).toBe(ta);
  });

  it("Escape com a lista aberta fecha SÓ a lista, nunca o Sheet envolvente", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>Editar campo</SheetTitle>
          <SheetDescription>Fórmula</SheetDescription>
          <FormulaEditor context="record" catalog={CATALOG} />
        </SheetContent>
      </Sheet>
    );
    const ta = typeText("[Val");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    // A camada do popover é a mais alta — o Dialog do Sheet ignora o Escape.
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("autocomplete de funções e paleta", () => {
  it("digitar letras sugere funções (alias inglês incluso)", async () => {
    render(<FormulaEditor context="aggregate" catalog={CATALOG} />);
    const ta = typeText("cont");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    fireEvent.keyDown(ta, { key: "Enter" });
    await flushRaf();
    // Primeira sugestão: CONT.SE — inserida como chamada com caret dentro.
    expect(textbox().value).toMatch(/^CONT\./);
    expect(textbox().value).toContain("()");
  });

  it("contexto por-registro não sugere aggOnly", () => {
    render(<FormulaEditor context="record" catalog={CATALOG} />);
    typeText("somase");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
