// Versão: 1.0 | Data: 17/08/2026
// Engrenagem do card da Visão geral: escolhe quais OPERANDOS da fórmula ganham
// bloco próprio no detalhamento e quais aparecem somados num bloco único.
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
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
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
  // Operandos com bloco PRÓPRIO, por fator. Ausência de fator = padrão.
  const [separate, setSeparate] = useState<Record<string, string[]>>({});
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
        setSeparate(res.separateByFactor);
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
  const byFactor = new Map<string, PlanOperandOption[]>();
  for (const op of operands) {
    byFactor.set(op.factorId, [...(byFactor.get(op.factorId) ?? []), op]);
  }

  // Sem config para o fator, o padrão é "todos separados" — o checkbox precisa
  // refletir isso para que desmarcar UM já signifique "some com os demais".
  const isSeparate = (factorId: string, key: string) => {
    const list = separate[factorId];
    return list ? list.includes(key) : true;
  };

  const toggle = (factorId: string, key: string, all: string[]) => {
    setSeparate((cur) => {
      const list = cur[factorId] ?? all;
      const next = list.includes(key)
        ? list.filter((k) => k !== key)
        : [...list, key];
      return { ...cur, [factorId]: next };
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await notifyOnError(
      saveDetailGrouping({ planId: target.planId, separateByFactor: separate }),
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
              Operando marcado ganha um bloco próprio, com sua lista e seu
              subtotal. Os desmarcados de um mesmo fator aparecem juntos num
              bloco somado.
            </p>
            {[...byFactor.entries()].map(([factorId, ops]) => (
              <div key={factorId} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{ops[0].factorLabel}</h3>
                {ops.length < 2 ? (
                  <p className="text-muted-foreground text-xs">
                    Este fator tem um operando só — nada a agrupar.
                  </p>
                ) : (
                  ops.map((op) => (
                    <Label
                      key={op.key}
                      className="flex items-center gap-2 text-sm font-normal"
                    >
                      <Checkbox
                        checked={isSeparate(factorId, op.key)}
                        onCheckedChange={() =>
                          toggle(
                            factorId,
                            op.key,
                            ops.map((o) => o.key)
                          )
                        }
                      />
                      {op.label}
                    </Label>
                  ))
                )}
              </div>
            ))}
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
