// Versão: 1.1 | Data: 18/07/2026
// v1.1 (18/07/2026): commit otimista extraído p/ useCellCommit; erro expõe a
//   mensagem da action no title.
// Célula editável inline para COLUNAS DE RELAÇÃO de records (hoje: responsible_id)
// nas tabelas de "registros individuais". Renderiza um SELECT das entidades
// elegíveis (ex.: responsáveis ativos) em vez de texto livre, e grava a FK via
// updateRecordField(kind:"relation"). Quando a coluna está marcada p/ gravar no
// Bitrix (writeBack), o responsável escolhido também vira ASSIGNED_BY_ID do
// deal/lead (traduzido p/ bitrix_user_id no server action).
"use client";

import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { updateRecordField } from "@/lib/records/actions";
import { useCellCommit } from "@/components/registros/use-cell-commit";

export function RelationEditableCell({
  recordId,
  field,
  value: serverValue,
  options,
  writeBack,
  onSaved,
}: {
  recordId: string;
  field: string; // coluna FK do núcleo (ex.: "responsible_id")
  value: string; // id atual (ou "")
  options: { value: string; label: string }[];
  writeBack?: boolean; // grava também no Bitrix (ASSIGNED_BY_ID)
  onSaved?: () => void;
}) {
  // Commit otimista + reconcile com o servidor: ver use-cell-commit.ts.
  const { value, commit, pending, error } = useCellCommit(
    serverValue,
    (raw) =>
      updateRecordField(recordId, field, raw, { kind: "relation", writeBack }),
    onSaved
  );

  return (
    <Combobox
      options={[{ value: "", label: "—" }, ...options]}
      value={value}
      onValueChange={commit}
      placeholder="—"
      disabled={pending}
      className={cn("w-full", error && "border-destructive")}
      aria-label={field}
    />
  );
}
