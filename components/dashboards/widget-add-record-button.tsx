// Versão: 1.0 | Data: 12/08/2026
// Botão "+" de criação manual do widget de tabela (settings.showAddRecord):
// embrulha o RecordCreateSheet (o MESMO form de /registros e do quick-create do
// kanban) para o canto da tabela modo lista. As opções dos dropdowns
// (responsáveis/operações) carregam sob demanda via listRecordCreateOptions com
// cache de MÓDULO (padrão optionCache da table-filter-bar — 1 chamada por
// página, compartilhada entre widgets). Pós-criação: refresh debounced — a
// lista é RSC e o router.refresh() a recomputa (o emitDataChanged que o sheet
// já emite segue atualizando kanbans da página). O gate (base manual_entry +
// edit_record_values) é do WidgetCard; o servidor revalida de todo jeito.
"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import type { FieldDefinition } from "@/lib/records/types";
import {
  listRecordCreateOptions,
  type RecordCreateOptions,
} from "@/lib/records/actions";
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";

// Cache de módulo: as opções valem para a página inteira (não dependem do
// widget) — N botões = 1 chamada.
let optionsPromise: Promise<RecordCreateOptions> | null = null;

export function WidgetAddRecordButton({
  source,
  recordType,
  fields,
  userRoles,
}: {
  // Base de destino (raiz com manual_entry — gate manualEntryRootSource).
  source: { key: string; label: string };
  recordType?: string;
  // Definições já recortadas pelo WidgetCard (applies_to + visible_to_roles).
  fields: FieldDefinition[];
  userRoles: string[];
}) {
  const [options, setOptions] = useState<RecordCreateOptions | null>(null);
  const refresh = useDebouncedRefresh();

  useEffect(() => {
    let alive = true;
    optionsPromise ??= listRecordCreateOptions();
    optionsPromise.then((opts) => {
      if (alive) setOptions(opts);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!options) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        disabled
        aria-label={`Novo registro em ${source.label}`}
      >
        <Plus className="size-4" />
      </Button>
    );
  }

  return (
    <div className="flex h-8 shrink-0 items-center">
      <RecordCreateSheet
        source={source}
        recordType={recordType}
        fields={fields}
        responsibles={options.responsibles}
        operations={options.operations}
        userRoles={userRoles}
        onCreated={() => refresh()}
        triggerLabel={`Novo registro em ${source.label}`}
        iconTrigger
      />
    </div>
  );
}
