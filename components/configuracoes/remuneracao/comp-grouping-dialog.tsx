// Versão: 1.1 | Data: 17/08/2026
// v1.1: a escolha virou "quem RECEBE": um rádio marca o bloco PRINCIPAL do
// fator e os checkboxes dizem quem é somado DENTRO dele. A 1ª versão só
// marcava "bloco próprio" e os desmarcados se juntavam entre si — num fator de
// 2 operandos isso nunca fundia nada (um desmarcado sozinho continuava bloco
// próprio), e desmarcar os dois esvaziava a lista, que o save descartava.
// Versão: 1.0 | Data: 17/08/2026
// Engrenagem do card da Visão geral: escolhe qual OPERANDO da fórmula é o
// bloco principal do detalhamento e quais são somados dentro dele.
//
// A configuração é POR PLANO (vale para todos os membros — a fórmula é do
// plano), então o diálogo é aberto do card de um colaborador mas o que ele
// salva não é dele: o aviso na tela diz isso. As chaves dos operandos vêm do
// servidor pelo MESMO `factorOperands` que monta os blocos — a engrenagem nunca
// as adivinha, senão o que se marca não seria o que se vê.
//
// Só apresentação: o recorte consultado de cada operando é intocado.
"use client";

import { useEffect, useState } from "react";

import {
  loadPlanOperands,
  saveDetailGrouping,
  type PlanOperandOption,
} from "@/app/(app)/operacao/remuneracao/detail-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import type { CompFactorGrouping } from "@/lib/comp/model";
import { notifyOnError } from "@/lib/feedback/notify";

export interface CompGroupingTarget {
  planId: string;
  planName: string;
}

export interface CompGroupingDialogProps {
  target: CompGroupingTarget | null;
  year: number;
  month: number;
  onClose: () => void;
}

type State =
  | { kind: "pending" }
  | { kind: "erro"; message: string }
  | { kind: "ok"; operands: PlanOperandOption[] };

function Body(props: {
  target: CompGroupingTarget;
  year: number;
  month: number;
  onDone: () => void;
}) {
  const { target } = props;
  const [state, setState] = useState<State>({ kind: "pending" });
  // factorId → { into, folded }. Fator ausente = padrão (cada um no seu bloco).
  const [byFactor, setByFactor] = useState<Record<string, CompFactorGrouping>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPlanOperands({
      planId: target.planId,
      year: props.year,
      month: props.month,
    })
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setState({ kind: "erro", message: res.message });
          return;
        }
        setState({ kind: "ok", operands: res.operands });
        setByFactor(res.byFactor);
      })
      .catch(() => {
        if (alive)
          setState({ kind: "erro", message: "Não foi possível carregar." });
      });
    return () => {
      alive = false;
    };
  }, [target.planId, props.year, props.month]);

  const operands = state.kind === "ok" ? state.operands : [];
  const byFactorOps = new Map<string, PlanOperandOption[]>();
  for (const op of operands) {
    byFactorOps.set(op.factorId, [...(byFactorOps.get(op.factorId) ?? []), op]);
  }

  // Principal EFETIVO: o gravado, ou o 1º operando (ordem da fórmula).
  const principalOf = (factorId: string, ops: PlanOperandOption[]) =>
    byFactor[factorId]?.into ?? ops[0]?.key ?? "";

  const isFolded = (factorId: string, key: string) =>
    (byFactor[factorId]?.folded ?? []).includes(key);

  const setPrincipal = (factorId: string, key: string) => {
    setByFactor((cur) => {
      const atual = cur[factorId];
      // Trocar o principal nunca dobra o antigo automaticamente: o usuário
      // decide isso no checkbox. O novo principal sai da lista de dobrados.
      const folded = (atual?.folded ?? []).filter((k) => k !== key);
      return { ...cur, [factorId]: { into: key, folded } };
    });
  };

  const toggleFold = (factorId: string, key: string, principal: string) => {
    setByFactor((cur) => {
      const atual = cur[factorId] ?? { into: principal, folded: [] };
      const folded = atual.folded.includes(key)
        ? atual.folded.filter((k) => k !== key)
        : [...atual.folded, key];
      return { ...cur, [factorId]: { into: atual.into, folded } };
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await notifyOnError(
      saveDetailGrouping({ planId: target.planId, byFactor }),
      "Não foi possível salvar o agrupamento"
    );
    setSaving(false);
    if (res?.ok) props.onDone();
  };

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>Blocos do detalhamento</SheetTitle>
        <SheetDescription>
          {target.planName} · vale para todos os membros deste plano
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-6">
        {state.kind === "pending" ? (
          <p className="text-muted-foreground text-sm">Carregando…</p>
        ) : null}
        {state.kind === "erro" ? (
          <p className="text-destructive text-sm">{state.message}</p>
        ) : null}

        {state.kind === "ok" ? (
          <>
            <p className="text-muted-foreground text-sm">
              Escolha o bloco principal de cada fator e marque quais operandos
              entram somados dentro dele. Os não marcados seguem em blocos
              separados, com lista e subtotal próprios.
            </p>
            {[...byFactorOps.entries()].map(([factorId, ops]) => {
              const principal = principalOf(factorId, ops);
              const dobrados = ops.filter((o) => isFolded(factorId, o.key));
              const principalLabel =
                ops.find((o) => o.key === principal)?.label ?? "";
              return (
                <div key={factorId} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{ops[0].factorLabel}</h3>
                  {ops.length < 2 ? (
                    <p className="text-muted-foreground text-xs">
                      Este fator tem um operando só — nada a agrupar.
                    </p>
                  ) : (
                    <>
                      <table className="text-sm">
                        <thead>
                          <tr className="text-muted-foreground text-xs">
                            <th className="w-20 pb-1 text-left font-normal">
                              Principal
                            </th>
                            <th className="w-20 pb-1 text-left font-normal">
                              Somar
                            </th>
                            <th className="pb-1 text-left font-normal">
                              Operando
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ops.map((op) => {
                            const ehPrincipal = op.key === principal;
                            return (
                              <tr key={op.key}>
                                <td className="py-1">
                                  <input
                                    type="radio"
                                    name={`principal-${factorId}`}
                                    aria-label={`Bloco principal: ${op.label}`}
                                    checked={ehPrincipal}
                                    onChange={() =>
                                      setPrincipal(factorId, op.key)
                                    }
                                  />
                                </td>
                                <td className="py-1">
                                  <Checkbox
                                    aria-label={`Somar no principal: ${op.label}`}
                                    // O principal não se soma em si mesmo.
                                    disabled={ehPrincipal}
                                    checked={
                                      !ehPrincipal && isFolded(factorId, op.key)
                                    }
                                    onCheckedChange={() =>
                                      toggleFold(factorId, op.key, principal)
                                    }
                                  />
                                </td>
                                <td className="py-1">{op.label}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {/* Prévia: o efeito precisa ser óbvio ANTES de salvar. */}
                      <p className="text-muted-foreground text-xs">
                        {dobrados.length === 0
                          ? "Cada operando em seu próprio bloco."
                          : `${dobrados
                              .map((o) => o.label)
                              .join(", ")} entra${dobrados.length > 1 ? "m" : ""} em ${principalLabel}.`}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={saving} onClick={save}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

export function CompGroupingDialog(props: CompGroupingDialogProps) {
  const { target } = props;
  return (
    <Sheet
      open={target != null}
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
    >
      <ResizableSheetContent
        storageKey="comp-grouping-dialog"
        defaultWidth={520}
        className="flex flex-col gap-4 overflow-y-auto"
      >
        {target ? (
          <Body
            key={`${target.planId}:${props.year}-${props.month}`}
            target={target}
            year={props.year}
            month={props.month}
            onDone={props.onClose}
          />
        ) : null}
      </ResizableSheetContent>
    </Sheet>
  );
}
