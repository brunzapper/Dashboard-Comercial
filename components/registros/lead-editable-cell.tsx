// Versão: 1.0 | Data: 12/07/2026
// Célula editável inline para a coluna de relação `related_lead_id` (Lead
// relacionado) nas tabelas de "registros individuais" dos widgets. Diferente do
// RelationEditableCell (lista fixa de responsáveis), o lead é escolhido num
// combobox PESQUISÁVEL (LeadCombobox + searchLeads) — há muitos leads. Grava a FK
// via updateRecordField(kind:"relation"), sempre LOCAL (sem write-back no Bitrix).
// O vínculo manual carimba field_modified_at.related_lead_id e fica protegido de
// sobrescrita pelo sync. Recomputa lead_time_days no server action.
"use client";

import { useState, useTransition } from "react";

import { LeadCombobox } from "@/components/registros/lead-combobox";
import { updateRecordField, type LeadOption } from "@/lib/records/actions";

export function LeadEditableCell({
  recordId,
  value,
  label,
  onSaved,
}: {
  recordId: string;
  value: string; // id do lead atual (ou "")
  label: string | null; // nome do lead atual (resolvido em fkLabels)
  onSaved?: () => void;
}) {
  // Valor "confirmado" (fonte da verdade). O key força o remount do combobox p/
  // refletir o confirmado — usado tanto no sucesso (novo lead) quanto ao reverter
  // um erro (volta ao lead anterior), já que o LeadCombobox mantém seleção própria.
  const [committed, setCommitted] = useState<{ id: string; label: string | null }>({
    id: value,
    label,
  });
  const [revertKey, setRevertKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function commit(lead: LeadOption | null) {
    const nextId = lead?.id ?? "";
    if (nextId === committed.id) return;
    setError(false);
    startTransition(async () => {
      const res = await updateRecordField(recordId, "related_lead_id", nextId, {
        kind: "relation",
      });
      if (res.ok) {
        setCommitted({ id: nextId, label: lead?.label ?? null });
        onSaved?.();
      } else {
        setError(true);
        setRevertKey((k) => k + 1); // remonta o combobox no valor confirmado
      }
    });
  }

  return (
    <div className={error ? "rounded-md ring-1 ring-destructive" : undefined}>
      <LeadCombobox
        key={`${committed.id}:${revertKey}`}
        defaultId={committed.id || null}
        defaultLabel={committed.label}
        disabled={pending}
        onChange={commit}
      />
    </div>
  );
}
