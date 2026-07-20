"use client";
// Versão: 1.1 | Data: 20/07/2026
// Seção "Dia útil e meta" do builder: (a) settings.periodWindow — janela de
// períodos equivalentes com dropdown no card ("3 meses", "Este trimestre"…)
// e toggle dia útil × dia cheio; (b) settings.businessDayAlign — alinhar os
// meses do gráfico pelo mesmo dia útil (pernas por mês no engine); (c)
// settings.goalLine — linha de meta/ritmo sobre buckets mensais (resolveGoal).
// UI mínima: escopo operação/responsável da goalLine fica acessível via
// preset/JSON (o builder não carrega as listas de entidades aqui). A métrica
// da meta é a chave do registry (Configurações → Metas); os builtins entram
// como sugestão de datalist. Arquivo próprio p/ não inflar o widget-builder.
// v1.1: campo "Janela própria (meses)" (windowMonths, alias legado) trocado
// pela configuração da janela de períodos (periodWindow).
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUILTIN_GOAL_METRICS } from "@/lib/metas/metrics";
import {
  PERIOD_WINDOW_LABELS,
  type BusinessDayAlignSettings,
  type GoalLineSettings,
  type PeriodWindowKey,
  type PeriodWindowSettings,
} from "@/lib/widgets/types";
import { BuilderSection } from "./widget-builder-rows";

// Ordem canônica de exibição das chaves da janela (mesma dos rótulos).
const PW_ORDER = Object.keys(PERIOD_WINDOW_LABELS) as PeriodWindowKey[];

export function GoalsSection({
  bdAlign,
  onBdAlignChange,
  periodWindow,
  onPeriodWindowChange,
  goalLine,
  onGoalLineChange,
  supportsGoalLine,
  hasMonthlyDim,
}: {
  bdAlign: BusinessDayAlignSettings;
  onBdAlignChange: (v: BusinessDayAlignSettings) => void;
  periodWindow?: PeriodWindowSettings;
  onPeriodWindowChange: (v: PeriodWindowSettings | undefined) => void;
  goalLine: GoalLineSettings;
  onGoalLineChange: (v: GoalLineSettings) => void;
  supportsGoalLine: boolean;
  hasMonthlyDim: boolean;
}) {
  const patchAlign = (p: Partial<BusinessDayAlignSettings>) =>
    onBdAlignChange({ ...bdAlign, ...p });
  const patchGoal = (p: Partial<GoalLineSettings>) =>
    onGoalLineChange({ ...goalLine, ...p });
  const pwEnabled = periodWindow != null;
  const pwOptions = periodWindow?.options ?? [];
  const patchPw = (p: Partial<PeriodWindowSettings>) =>
    onPeriodWindowChange({ ...(periodWindow ?? {}), ...p });
  const badgeParts = [
    pwEnabled ? "Janela" : null,
    bdAlign.enabled ? "Dia útil" : null,
    goalLine.enabled ? "Meta" : null,
  ].filter(Boolean);
  const badge = badgeParts.length > 0 ? badgeParts.join(" + ") : null;
  return (
    <BuilderSection value="dia-util-meta" title="Dia útil e meta" badge={badge}>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={pwEnabled}
          onCheckedChange={(v) =>
            onPeriodWindowChange(
              v === true
                ? { options: [...PW_ORDER], default: "6m", showAlignToggle: true }
                : undefined
            )
          }
        />
        Janela de meses no card (períodos equivalentes)
      </label>
      <p className="text-muted-foreground text-xs">
        Dropdown no próprio card (&quot;3 meses&quot;, &quot;Este
        trimestre&quot;…): cada mês da janela recebe o recorte EQUIVALENTE ao
        período da barra — por dia útil (mesmo estágio) ou por dia cheio.
        Requer dimensão de data mensal. A seleção do dropdown é compartilhada
        entre os usuários do dashboard.
      </p>
      {pwEnabled ? (
        <>
          {!hasMonthlyDim ? (
            <p className="text-destructive text-xs">
              Este widget não tem dimensão de data mensal (Mês/ano, Nome do
              mês) — a janela ficará sem efeito.
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Opções do dropdown</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {PW_ORDER.map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={pwOptions.includes(k)}
                    onCheckedChange={(v) => {
                      const next =
                        v === true
                          ? PW_ORDER.filter(
                              (o) => pwOptions.includes(o) || o === k
                            )
                          : pwOptions.filter((o) => o !== k);
                      patchPw({ options: next });
                    }}
                  />
                  {PERIOD_WINDOW_LABELS[k]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Janela padrão</Label>
            <Select
              value={periodWindow?.default ?? "__none__"}
              onValueChange={(v) =>
                patchPw({
                  default:
                    v === "__none__" ? undefined : (v as PeriodWindowKey),
                })
              }
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem janela —</SelectItem>
                {PW_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {PERIOD_WINDOW_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={periodWindow?.showAlignToggle ?? false}
              onCheckedChange={(v) =>
                patchPw({ showAlignToggle: v === true })
              }
            />
            Expor no card o seletor &quot;dia útil × dia cheio&quot;
          </label>
        </>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={bdAlign.enabled ?? false}
          onCheckedChange={(v) => patchAlign({ enabled: v === true })}
        />
        Alinhar meses pelo mesmo dia útil
      </label>
      <p className="text-muted-foreground text-xs">
        Cada mês do período conta só até o N-ésimo dia útil (N = dia útil
        corrente) — compara meses no mesmo estágio de progresso. Requer
        dimensão de data mensal e período ativo; feriados vêm de Configurações
        → Metas. Com o alinhamento ativo, a Comparação é ignorada.
      </p>
      {bdAlign.enabled ? (
        <>
          {!hasMonthlyDim ? (
            <p className="text-destructive text-xs">
              Este widget não tem dimensão de data mensal (Mês/ano, Nome do
              mês) — o alinhamento ficará sem efeito.
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label>Dia útil de referência</Label>
            <Select
              value={bdAlign.reference ?? "today"}
              onValueChange={(v) =>
                patchAlign({
                  reference: v as BusinessDayAlignSettings["reference"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">
                  Hoje (limitado ao fim do período)
                </SelectItem>
                <SelectItem value="period_end">
                  Fim do período selecionado
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}

      {supportsGoalLine ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={goalLine.enabled ?? false}
              onCheckedChange={(v) => patchGoal({ enabled: v === true })}
            />
            Linha de meta no gráfico
          </label>
          {goalLine.enabled ? (
            <>
              <p className="text-muted-foreground text-xs">
                Meta mensal (Configurações → Metas) desenhada como linha
                tracejada sobre os buckets mensais. Modo &quot;ritmo&quot; =
                meta ideal acumulada até o dia útil corrente (meta ÷ dias
                úteis × N); meses passados usam a meta cheia, futuros ficam
                sem linha.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Métrica da meta</Label>
                  <Input
                    value={goalLine.metric ?? ""}
                    placeholder="mrr"
                    list="goal-metric-keys"
                    onChange={(e) =>
                      patchGoal({ metric: e.target.value.trim() || undefined })
                    }
                  />
                  <datalist id="goal-metric-keys">
                    {BUILTIN_GOAL_METRICS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Modo</Label>
                  <Select
                    value={goalLine.mode ?? "monthly"}
                    onValueChange={(v) =>
                      patchGoal({ mode: v as GoalLineSettings["mode"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Meta mensal cheia</SelectItem>
                      <SelectItem value="pace">
                        Ritmo (ideal por dia útil)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Rótulo</Label>
                  <Input
                    value={goalLine.label ?? ""}
                    placeholder="Meta"
                    onChange={(e) =>
                      patchGoal({ label: e.target.value || undefined })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Cor (opcional)</Label>
                  <Input
                    value={goalLine.color ?? ""}
                    placeholder="#94a3b8"
                    onChange={(e) =>
                      patchGoal({ color: e.target.value.trim() || undefined })
                    }
                  />
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </BuilderSection>
  );
}
