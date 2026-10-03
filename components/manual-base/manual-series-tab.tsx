// Versão: 1.0 | Data: 03/10/2026
// v1.0 (03/10/2026): a aba MÉTRICAS da Base manual (tela v2).
//
// Tudo que uma métrica manual tem de configurável, num lugar só e editável:
// nome (antes não havia como renomear pela tela), ordem, "como conta no
// período" por padrão (antes só pelo banco) e por quais divisões ela se
// reparte (antes a grade "Cada dado se reparte por…", solta no meio da
// página). A referência interna (`manual:<chave>`) deixou de ficar à mostra:
// ela vai para a área de transferência pelo menu da linha, para quem escreve
// fórmula à mão.
"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpHint } from "@/components/ui/help-hint";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BUILTIN_MANUAL_FAMILIES } from "@/lib/manual-base/families";
import {
  MANUAL_SPREADS,
  MANUAL_SPREAD_HINTS,
  MANUAL_SPREAD_LABELS,
  manualRef,
  type ManualSeries,
  type ManualSpread,
} from "@/lib/manual-base/types";
import { MANUAL_TERMS, countLabel } from "@/lib/manual-base/vocabulary";

import { isTempId, type ManualBaseStore } from "./use-manual-base-store";

export function ManualSeriesTab({
  store,
  canEdit,
  onManageDivisions,
}: {
  store: ManualBaseStore;
  canEdit: boolean;
  onManageDivisions: () => void;
}) {
  const { series, families, state } = store;
  const [newLabel, setNewLabel] = useState("");
  const [confirm, setConfirm] = useState<ManualSeries | null>(null);

  const divisionChoices = [
    ...families.map((f) => ({ key: f.key, label: f.label, system: false, id: f.id })),
    ...BUILTIN_MANUAL_FAMILIES.map((f) => ({
      key: f.key,
      label: f.label,
      system: true,
      id: f.key,
    })),
  ].filter((d) => !isTempId(d.id));

  const entriesOf = (id: string) => state.entries.filter((e) => e.series_id === id).length;

  const create = () => {
    if (newLabel.trim().length < 2) return;
    store.addSeries(newLabel);
    setNewLabel("");
  };

  const copyRef = async (s: ManualSeries) => {
    try {
      await navigator.clipboard.writeText(manualRef(s.key));
      toast.success("Referência copiada", {
        description: `Cole ${manualRef(s.key)} numa fórmula para usar “${s.label}”.`,
      });
    } catch {
      toast.error("Não consegui copiar", { description: manualRef(s.key) });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Cada métrica é um número que você lança mês a mês. Nos dashboards ela
        aparece no grupo “Base manual” — como métrica de um gráfico ou dentro de
        uma fórmula.{" "}
        <HelpHint ariaLabel="Como usar uma métrica manual">
          Ex.: “Conversão = negócios fechados ÷ Ligações realizadas”. O nome pode
          ser trocado a qualquer momento: as fórmulas guardam uma referência
          interna, que não muda.
        </HelpHint>
      </p>

      {canEdit ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            create();
          }}
        >
          <Input
            aria-label={`Nova ${MANUAL_TERMS.metric.toLowerCase()}`}
            className="h-9 w-72"
            placeholder="Nome da nova métrica (ex.: Ligações realizadas)"
            value={newLabel}
            onChange={(ev) => setNewLabel(ev.target.value)}
          />
          <Button type="submit" size="sm" disabled={newLabel.trim().length < 2}>
            <Plus className="size-4" /> Criar métrica
          </Button>
        </form>
      ) : null}

      {series.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          Nenhuma métrica ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Dividida por
                    <HelpHint ariaLabel="O que é dividir uma métrica">
                      Marque as divisões em que você vai repartir o número
                      (ex.: “Canal”). Ao lançar, você escolhe se a linha é o
                      total ou uma parte. Sem nada marcado, todos os lançamentos
                      da métrica simplesmente somam.
                    </HelpHint>
                  </span>
                </TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Conta no período
                    <HelpHint ariaLabel="Como o número conta no período">
                      Quando o período do dashboard não coincide com o do
                      lançamento, esta escolha decide o que acontece. É o padrão
                      das linhas novas; cada linha pode mudar no menu ⋯ da aba
                      Lançamentos.
                    </HelpHint>
                  </span>
                </TableHead>
                <TableHead className="text-right">{MANUAL_TERMS.entryPlural}</TableHead>
                {canEdit ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map((s, i) => {
                const temp = isTempId(s.id);
                const declared = state.declarations[s.id] ?? [];
                return (
                  <TableRow key={s.id}>
                    <TableCell className="min-w-56">
                      {canEdit && !temp ? (
                        <Input
                          key={`${s.id}:${s.label}`}
                          aria-label={`Nome de ${s.label}`}
                          className="h-8"
                          defaultValue={s.label}
                          onBlur={(ev) => {
                            const v = ev.target.value.trim();
                            if (v.length < 2) {
                              ev.target.value = s.label;
                              return;
                            }
                            if (v !== s.label) store.updateSeries(s, { label: v });
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") ev.currentTarget.blur();
                            if (ev.key === "Escape") {
                              ev.currentTarget.value = s.label;
                              ev.currentTarget.blur();
                            }
                          }}
                        />
                      ) : (
                        <span className={temp ? "text-muted-foreground" : ""}>{s.label}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {divisionChoices.length === 0 ? (
                          <button
                            type="button"
                            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
                            onClick={onManageDivisions}
                          >
                            Criar uma divisão
                          </button>
                        ) : (
                          divisionChoices.map((d) => {
                            const on = declared.includes(d.key);
                            return (
                              <button
                                key={d.key}
                                type="button"
                                disabled={!canEdit || temp}
                                aria-pressed={on}
                                title={
                                  d.system
                                    ? "Divisão do sistema: as opções vêm do cadastro"
                                    : undefined
                                }
                                className={`rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60 ${
                                  on
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "text-muted-foreground hover:bg-accent"
                                }`}
                                onClick={() => store.toggleDeclaration(s.id, d.key)}
                              >
                                {d.label}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canEdit && !temp ? (
                        <Select
                          value={s.default_spread}
                          onValueChange={(v) =>
                            store.updateSeries(s, { defaultSpread: v as ManualSpread })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-56 text-xs"
                            aria-label={`Como ${s.label} conta no período`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MANUAL_SPREADS.map((sp) => (
                              <SelectItem key={sp} value={sp} title={MANUAL_SPREAD_HINTS[sp]}>
                                {MANUAL_SPREAD_LABELS[sp]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {MANUAL_SPREAD_LABELS[s.default_spread]}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs whitespace-nowrap">
                      {countLabel(entriesOf(s.id), "lançamento", "lançamentos")}
                    </TableCell>
                    {canEdit ? (
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Subir ${s.label}`}
                            disabled={temp || i === 0}
                            onClick={() => store.moveSeries(s.id, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Descer ${s.label}`}
                            disabled={temp || i === series.length - 1}
                            onClick={() => store.moveSeries(s.id, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={`Mais ações de ${s.label}`}
                                disabled={temp}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => void copyRef(s)}>
                                Copiar referência para fórmula
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setConfirm(s)}
                              >
                                Excluir métrica
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={confirm != null}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
        title={`Excluir “${confirm?.label ?? ""}”?`}
        description="Os lançamentos desta métrica somem junto, e as fórmulas que a usam passam a exibir “—”. Excluir uma métrica é ação de administrador."
        actionLabel="Excluir"
        destructive
        onConfirm={() => {
          const s = confirm;
          setConfirm(null);
          if (s) store.deleteSeries(s);
        }}
      />
    </div>
  );
}
