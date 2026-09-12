// Versão: 1.0 | Data: 12/09/2026
// Interruptor "mostrar campos vazios" do painel de detalhe do registro —
// compartilhado pelas DUAS superfícies (o painel do dashboard e o de
// /registros). Um só componente porque a escolha é a mesma e fica gravada na
// preferência do usuário (uiPrefs.recordPanelAllFields, 0141): quem prefere a
// ficha completa a quer completa nas duas telas.
//
// O recorte em si é CLIENT-SIDE: alternar não pode custar uma ida ao servidor,
// e um registro tem dezenas de campos, não milhares. O save é otimista e em
// background, como todo save fora de formulário no app.
"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { saveUiPrefs } from "@/app/(app)/dashboards/actions";

export function RecordFieldsToggle({
  value,
  onChange,
  locked = false,
  emptyCount,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  /** A organização travou a personalização desta chave. */
  locked?: boolean;
  /** Quantos campos estão vazios — some quando não há nenhum. */
  emptyCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const { save } = useBackgroundSave();

  if (emptyCount === 0) return null;

  return (
    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Checkbox
        checked={value}
        disabled={locked || busy}
        onCheckedChange={(v) => {
          const next = v === true;
          onChange(next);
          setBusy(true);
          save({
            key: "recordPanelAllFields",
            context: "Não foi possível salvar a preferência de exibição",
            action: async () => {
              try {
                await saveUiPrefs({ recordPanelAllFields: next });
              } finally {
                setBusy(false);
              }
            },
            revert: () => onChange(!next),
            // Sem refresh: o recorte é client-side e um router.refresh() aqui
            // recarregaria a tabela inteira por trás do painel aberto.
            reconcile: false,
          });
        }}
      />
      <Label className="cursor-pointer text-xs font-normal">
        Mostrar campos vazios ({emptyCount})
      </Label>
    </label>
  );
}
