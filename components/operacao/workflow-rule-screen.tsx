// Versão: 1.0 | Data: 09/09/2026
// A TELA DE CONSTRUÇÃO de uma automação.
//
// Ela existe porque a lista do Workflow mostrava a regra e não deixava
// editá-la: o card só oferecia ligar/desligar, "Executar agora" e um link
// "abrir o quadro" que só existe quando a regra TEM quadro. Uma automação de
// Base (0127) — como a do acompanhamento — não tem quadro nenhum, então dentro
// do Workflow ela era literalmente ineditável.
//
// O editor aqui é o MESMO componente do painel do quadro
// (`AutomationRuleEditor`): mesmo banco de peças, mesmos seletores de campo e
// de ação. O que muda é só quem hospeda — e é o host que sabe se existe quadro,
// porque é isso que decide se "mover de coluna" e "tempo na coluna" fazem
// sentido.
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ComboboxOption } from "@/components/ui/combobox";
import { notifyOnError } from "@/lib/feedback/notify";
import {
  ACTION_OPTIONS,
  AutomationRuleEditor,
  draftToRule,
  ruleToDraft,
  type RuleDraft,
} from "@/components/kanban/automation-rule-editor";
import {
  getAutomationFieldOptions,
  saveAutomation,
  type AutomationFieldCatalog,
} from "@/lib/kanban/automations/actions";
import type {
  AutomationOwner,
  AutomationRow,
} from "@/lib/kanban/automations/types";
import type { KanbanColumn } from "@/lib/kanban/types";

export function WorkflowRuleScreen({
  row,
  owner,
  source,
  columns,
  isCustomColumns,
  ownerLabel,
}: {
  row: AutomationRow;
  owner: AutomationOwner;
  source?: string;
  /** Vazio quando a regra é de uma Base: não há quadro. */
  columns: KanbanColumn[];
  isCustomColumns: boolean;
  ownerLabel: string;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<AutomationFieldCatalog | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  // O catálogo é o banco de peças: sem ele o editor não tem campo para
  // oferecer. Carrega uma vez, e o rascunho nasce da regra já gravada.
  useEffect(() => {
    let alive = true;
    void getAutomationFieldOptions(source, owner).then((res) => {
      if (!alive || !res.ok || !res.catalog) return;
      setCatalog(res.catalog);
      setDraft(ruleToDraft(row, res.catalog.fields as ComboboxOption[]));
    });
    return () => {
      alive = false;
    };
  }, [owner, source, row]);

  const targetOptions: ComboboxOption[] = columns
    .filter((c) => !c.noDrop)
    .map((c) => ({ value: c.key, label: c.label }));

  // Sem quadro não há posição para medir nem coluna para onde mover. As opções
  // aparecem DESABILITADAS com o motivo — esconder faria procurar o que não
  // existe (precedente do editor de fórmulas).
  const semQuadro = columns.length === 0;
  const timeBasisOptions: ComboboxOption[] = [
    { value: "created", label: "Desde a criação" },
    { value: "field_changed", label: "Desde a última alteração de um campo" },
    {
      value: "in_column",
      label: "Na coluna atual",
      ...(isCustomColumns
        ? {}
        : {
            disabledReason: semQuadro
              ? "Esta automação é de uma Base: não há quadro, e sem posição não há tempo de coluna para medir."
              : "Só em quadro com colunas “Personalizar” — nas demais, a coluna sai de um campo e não há entrada para cronometrar.",
          }),
    },
  ];
  const actionOptions: ComboboxOption[] = ACTION_OPTIONS.map((o) =>
    o.value === "move_to_column" && semQuadro
      ? {
          ...o,
          disabledReason:
            "Mover de coluna exige um quadro. Nesta automação, use “Definir campo”.",
        }
      : o
  );

  const salvar = () => {
    if (!draft) return;
    const rule = draftToRule(draft);
    if (!rule) {
      setMessage({
        ok: false,
        text: "Regra incompleta: confira as condições e a ação.",
      });
      return;
    }
    startTransition(async () => {
      const res = await notifyOnError(
        saveAutomation(owner, {
          id: row.id,
          name: draft.name.trim() || "Sem nome",
          enabled: draft.enabled,
          position: row.position,
          rule,
        }),
        "Não foi possível salvar a automação"
      );
      const ok = res?.ok === true;
      setMessage({ ok, text: ok ? "Salva." : (res?.message ?? "Falhou.") });
      if (ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link href="/operacao/workflow">
            <ArrowLeft className="size-4" /> Esquemas
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {row.name || "Sem nome"}
          </h1>
          <p className="text-muted-foreground text-xs">
            Automação · {ownerLabel}
            {semQuadro
              ? " · sem quadro (roda sobre a Base inteira)"
              : ""}
          </p>
        </div>
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {message.text}
        </p>
      ) : null}

      {!draft ? (
        <p className="text-muted-foreground text-sm">Carregando o construtor…</p>
      ) : (
        <AutomationRuleEditor
          draft={draft}
          setDraft={setDraft}
          catalog={catalog}
          source={source}
          targetOptions={targetOptions}
          fieldOptions={(catalog?.fields ?? []) as ComboboxOption[]}
          relSourceOptions={(catalog?.sources ?? []).map((s) => ({
            value: s.value,
            label: s.label,
          }))}
          timeBasisOptions={timeBasisOptions}
          actionOptions={actionOptions}
          saving={pending}
          onSave={salvar}
          onCancel={() => router.push("/operacao/workflow")}
          saveLabel="Salvar automação"
        />
      )}
    </div>
  );
}
