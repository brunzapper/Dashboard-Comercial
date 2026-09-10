// Versão: 1.0 | Data: 10/09/2026
// O CONSTRUTOR de série dentro da Tree — criar uma sequência nova, ou editar a
// que já sustenta um tronco.
//
// O que faltava: a árvore deixava ajustar a cadência DESTE registro e pausar o
// acompanhamento, e mais nada. Criar outra sequência exigia sair para o
// Workflow, escolher a Base, achar a regra — sendo que quem está olhando a
// árvore de um lead é exatamente quem sabe que falta uma segunda sequência.
//
// O editor é o MESMO componente do painel do quadro e da tela do Workflow
// (`AutomationRuleEditor`). Um terceiro construtor seria a régua paralela da
// invariante 25, e divergiria no primeiro campo novo da série. Este arquivo é
// só o HOST: traz o catálogo, a semente e o que fazer no salvar — exatamente o
// papel que `workflow-rule-screen.tsx` cumpre na outra tela.
//
// O DONO é a BASE do registro (`AutomationOwner {kind:"source"}`), não o
// registro: uma série é uma regra que vale para todos os registros que casarem
// as condições. É por isso que ela nasce DESLIGADA — ligar é dizer "isto vale
// para a Base inteira", e essa decisão não se toma sem ver as condições.
// O gate (admin) é o de `saveAutomation`; a RLS da 0127 segue sendo a muralha.
"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { notifyOnError } from "@/lib/feedback/notify";
import {
  ACTION_OPTIONS,
  AutomationRuleEditor,
  draftToRule,
  ruleToDraft,
  seedSeriesDraft,
  type RuleDraft,
} from "@/components/kanban/automation-rule-editor";
import {
  getAutomationFieldOptions,
  listAutomations,
  saveAutomation,
  type AutomationFieldCatalog,
} from "@/lib/kanban/automations/actions";
import type { AutomationOwner } from "@/lib/kanban/automations/types";

/**
 * Sem quadro não há coluna para onde mover nem posição para cronometrar.
 * Aparecem DESABILITADAS com o motivo, como na tela do Workflow — esconder
 * faria procurar o que não existe.
 */
const SEM_QUADRO =
  "Esta automação é de uma Base: não há quadro, e sem coluna não há para onde mover nem posição para medir.";

const TIME_BASIS_OPTIONS: ComboboxOption[] = [
  { value: "created", label: "Desde a criação" },
  { value: "field_changed", label: "Desde a última alteração de um campo" },
  { value: "in_column", label: "Na coluna atual", disabledReason: SEM_QUADRO },
];

const ACTION_OPTIONS_SEM_QUADRO: ComboboxOption[] = ACTION_OPTIONS.map((o) =>
  o.value === "move_to_column" ? { ...o, disabledReason: SEM_QUADRO } : o
);

export function TreeSeriesSheet({
  sourceKey,
  /** Regra a EDITAR. Ausente = criar uma sequência nova. */
  ruleId,
  /** Nome sugerido para a sequência nova (o título do registro em foco). */
  suggestedName,
  onSaved,
}: {
  sourceKey: string;
  ruleId?: string | null;
  suggestedName?: string;
  onSaved?: () => void;
}) {
  const owner: AutomationOwner = { kind: "source", id: sourceKey };
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<AutomationFieldCatalog | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [position, setPosition] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  // Catálogo e rascunho carregam ao ABRIR: a Tree é um widget de dashboard, e
  // uma consulta de catálogo por widget montado seria um custo cobrado de quem
  // nunca vai abrir o construtor.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      // A limpeza da mensagem entra no MESMO passo assíncrono do carregamento:
      // um `setState` síncrono no corpo do efeito cascateia render (a regra
      // `react-hooks/set-state-in-effect` do projeto).
      if (alive) setMessage(null);
      const res = await getAutomationFieldOptions(sourceKey, owner);
      if (!alive || !res.ok || !res.catalog) {
        if (alive) {
          setMessage({
            ok: false,
            text: res.message ?? "Não foi possível carregar o construtor.",
          });
        }
        return;
      }
      setCatalog(res.catalog);
      if (!ruleId) {
        setDraft(seedSeriesDraft(suggestedName ?? ""));
        setPosition(0);
        return;
      }
      // Editar: o rascunho nasce da regra GRAVADA, como na tela do Workflow.
      const list = await listAutomations(owner);
      if (!alive) return;
      const row = (list.rows ?? []).find((r) => r.id === ruleId);
      if (!row) {
        setMessage({ ok: false, text: "Automação não encontrada." });
        return;
      }
      setPosition(row.position);
      setDraft(ruleToDraft(row, res.catalog.fields as ComboboxOption[]));
    })();
    return () => {
      alive = false;
    };
    // `owner` é derivado de sourceKey; incluí-lo remontaria a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceKey, ruleId, suggestedName]);

  const salvar = () => {
    if (!draft) return;
    const rule = draftToRule(draft);
    if (!rule) {
      setMessage({
        ok: false,
        text: "Sequência incompleta: confira as condições e os campos da série.",
      });
      return;
    }
    startTransition(async () => {
      const res = await notifyOnError(
        saveAutomation(owner, {
          id: ruleId ?? null,
          name: draft.name.trim() || "Sem nome",
          // Regra NOVA nasce desligada; editar preserva o estado atual.
          enabled: ruleId ? draft.enabled : false,
          position,
          rule,
        }),
        "Não foi possível salvar a sequência"
      );
      const ok = res?.ok === true;
      setMessage({
        ok,
        text: ok
          ? ruleId
            ? "Salva."
            : "Criada e DESLIGADA. Ligue quando as condições estiverem certas."
          : (res?.message ?? "Falhou."),
      });
      if (ok) {
        onSaved?.();
        if (!ruleId) setOpen(false);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {ruleId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            title="Editar a automação desta sequência"
            aria-label="Editar a automação desta sequência"
          >
            <Settings2 className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-1">
            <Plus className="size-3.5" /> Nova sequência
          </Button>
        )}
      </SheetTrigger>
      <ResizableSheetContent
        side="right"
        storageKey="tree-series"
        defaultWidth={560}
      >
        <SheetHeader>
          <SheetTitle>
            {ruleId ? "Editar sequência" : "Nova sequência"}
          </SheetTitle>
          <SheetDescription>
            Uma sequência é uma automação da Base: ela abre a tarefa recorrente
            em todos os registros que casarem as condições, e cada um pode ter
            cadência própria pela árvore.
          </SheetDescription>
        </SheetHeader>

        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={`px-4 text-sm ${
              message.ok ? "text-muted-foreground" : "text-destructive"
            }`}
          >
            {message.text}
          </p>
        ) : null}

        {draft ? (
          <AutomationRuleEditor
            draft={draft}
            setDraft={setDraft}
            catalog={catalog}
            source={sourceKey}
            targetOptions={[]}
            fieldOptions={(catalog?.fields ?? []) as ComboboxOption[]}
            relSourceOptions={(catalog?.sources ?? []).map((s) => ({
              value: s.value,
              label: s.label,
            }))}
            timeBasisOptions={TIME_BASIS_OPTIONS}
            actionOptions={ACTION_OPTIONS_SEM_QUADRO}
            saving={pending}
            onSave={salvar}
            onCancel={() => setOpen(false)}
            saveLabel={ruleId ? "Salvar sequência" : "Criar sequência"}
          />
        ) : message ? null : (
          <p className="text-muted-foreground px-4 text-sm">
            Carregando o construtor…
          </p>
        )}
      </ResizableSheetContent>
    </Sheet>
  );
}
