// Versão: 1.0 | Data: 21/07/2026
// Intervalo personalizado de período em RASCUNHO (De/Até): digitar NUNCA
// dispara consulta — o commit acontece quando o intervalo está COMPLETO
// (auto, debounced) ou pelo botão "Aplicar"/Enter (intervalo ABERTO
// deliberado — só De ou só Até). Usado pela barra global e pelo widget de
// filtro (PeriodControls) e pelo filtro rápido de período do card
// (PeriodQuickFilter). Corrige o bug de os widgets recomputarem com período
// parcial (só a data inicial) a cada interação enquanto o usuário ainda
// escolhe o intervalo. Commit em blur foi rejeitado de propósito: tabular de
// "De" para "Até" emitiria exatamente o intervalo parcial que este componente
// evita.
"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Data completa E plausível: o <input type="date"> emite change com anos
// intermediários ("0002-07-15" enquanto se digita 2026) — o piso de ano evita
// commit de rascunho no meio da digitação (comparação ISO é lexicográfica).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && s >= "1900-01-01";

export function PeriodRangeDraft({
  de,
  ate,
  onCommit,
  compact = false,
  ariaPrefix,
}: {
  // Valores COMMITADOS (URL / valor persistido) — semeiam o rascunho e o
  // ressincronizam quando mudam por fora (sync da barra / outro usuário).
  de: string;
  ate: string;
  onCommit: (r: { de: string; ate: string }) => void;
  // Estilos do filtro rápido do card (h-8/text-xs).
  compact?: boolean;
  // Sufixo dos aria-labels ("De — <rótulo do filtro>").
  ariaPrefix?: string;
}) {
  // Rascunho local (padrão seedKey do app): digitar só atualiza o rascunho.
  const serverKey = `${de}|${ate}`;
  const [seedKey, setSeedKey] = useState(serverKey);
  const [draft, setDraft] = useState({ de, ate });
  if (seedKey !== serverKey) {
    setSeedKey(serverKey);
    setDraft({ de, ate });
  }

  const dirty = draft.de !== de || draft.ate !== ate;
  const complete = validDate(draft.de) && validDate(draft.ate);
  const empty = !draft.de && !draft.ate;

  // Auto-commit debounced SÓ com o intervalo completo: quem pausa depois de
  // preencher só o "De" (p/ abrir o calendário do "Até") não dispara nada.
  // onCommit fica em ref (padrão useDataChanged) — o timer sempre chama a
  // versão mais recente sem re-armar o debounce.
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    if (!dirty || !complete) return;
    const t = setTimeout(() => {
      commitRef.current({ de: draft.de, ate: draft.ate });
    }, 500);
    return () => clearTimeout(t);
  }, [dirty, complete, draft.de, draft.ate]);

  // Commit deliberado (Aplicar/Enter): aceita intervalo ABERTO — recurso
  // legítimo ("de X em diante"), mas nunca emitido por acidente. Datas
  // incompletas são descartadas; rascunho todo vazio não commita (p/ "sem
  // período" existe o "Todo o período" do dropdown).
  const apply = () => {
    if (!dirty || empty) return;
    const val = (s: string) => (validDate(s) ? s : "");
    commitRef.current({ de: val(draft.de), ate: val(draft.ate) });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    }
  };

  const inputCls = cn("w-auto", compact && "h-8 text-xs");
  return (
    <>
      <Input
        type="date"
        value={draft.de}
        onChange={(e) => setDraft((d) => ({ ...d, de: e.target.value }))}
        onKeyDown={onKeyDown}
        className={inputCls}
        aria-label={ariaPrefix ? `De — ${ariaPrefix}` : "De"}
      />
      <span
        className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}
      >
        até
      </span>
      <Input
        type="date"
        value={draft.ate}
        onChange={(e) => setDraft((d) => ({ ...d, ate: e.target.value }))}
        onKeyDown={onKeyDown}
        className={inputCls}
        aria-label={ariaPrefix ? `Até — ${ariaPrefix}` : "Até"}
      />
      {dirty && !empty ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={cn("h-9 px-3", compact && "h-8 px-2 text-xs")}
          onClick={apply}
        >
          Aplicar
        </Button>
      ) : null}
    </>
  );
}
