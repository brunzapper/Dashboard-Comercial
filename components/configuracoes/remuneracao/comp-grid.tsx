// Versão: 1.4 | Data: 31/07/2026 (v1.4: plano com config.apuracao =
// "mes_anterior" — tooltip do cabeçalho de fator e legenda do rodapé avisam
// que Alvo/Real. referem-se ao mês APURADO; a célula de alvo grava a meta do
// mês apurado via saveTarget, que desloca no server)
// v1.3: comissão multi-bloco — tooltip lista
// os blocos; alvo com moeda própria do fator: formato na moeda digitada,
// convertido no tooltip via targetRates do server, itálico quando o alvo vem
// do padrão do plano e erro destrutivo quando falta a cotação do trimestre
// v1.2: linhas = lista efetiva manual ∪ operações via helpers do model —
// mesma resolução do servidor.
// Grade mensal da remuneração (0112): linhas = membros canônicos; colunas =
// Base | por fator (Alvo | Real. | Ating.% | Valor) | Comissão (se o plano
// tiver faixas) | Bônus | Total. TODO o detalhamento é derivado no cliente
// pelo MESMO computeEntry do servidor (efetivo = manual ?? calculado; o id do
// membro seleciona a tabela de faixas dele): editar célula atualiza a linha na
// hora (estado otimista) e persiste via saveTarget (alvo → linha de goals) ou
// saveEntryInputs (overrides/bônus/base). Célula derivada com override ganha
// ponto âmbar + "voltar ao calculado" (limpa a chave). "Recalcular" re-consulta
// o realizado (engine); "Publicar" materializa o espelho.
"use client";

import { useMemo, useState, useTransition } from "react";
import { CircleAlert, Play, UploadCloud, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notifyActionError } from "@/lib/feedback/notify";
import {
  computeEntry,
  explicitMemberIds,
  parseCompEntryInputs,
  resolveOperationMembers,
  type CompBonus,
  type CompComputedRaw,
  type CompEntryInputs,
  type CompPlanConfig,
} from "@/lib/comp/model";
import {
  publishMonth,
  recomputeMonth,
  saveEntryInputs,
  saveTarget,
  type EntryPatch,
} from "@/app/(app)/configuracoes/remuneracao/actions";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

const fmtMoney = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number): string =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
// Moeda do ALVO do fator (targetCurrency) — códigos desconhecidos degradam
// p/ prefixo cru (Intl lança em código inválido).
function fmtMoneyIn(currency: string, v: number): string {
  try {
    return v.toLocaleString("pt-BR", { style: "currency", currency });
  } catch {
    return `${currency} ${fmtNum(v)}`;
  }
}

function parseInput(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t.replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(v)) return v;
  const direct = Number(t);
  return Number.isFinite(direct) ? direct : null;
}

export interface CompGridProps {
  plan: CompPlanClientRow;
  config: CompPlanConfig;
  year: number;
  month: number;
  entries: CompEntryClientRow[];
  responsibles: { id: string; label: string }[];
  targets: Record<string, Record<string, number | null>>;
  // Membros por operação (ids CANÔNICOS, resolvidos no server) — mesma fonte
  // da lista efetiva do engine; a grade nunca resolve operação sozinha.
  operationMembersById: Record<string, string[]>;
  // Moeda do alvo → R$/unidade no trimestre do mês (resolveTargetRates no
  // server) — computeEntry é puro e nunca consulta cotação sozinho.
  targetRates: Record<string, number | null>;
}

// Estado local por linha (otimista — o servidor re-deriva e o refresh da page
// reconcilia; conflito é impossível na prática: só admins editam).
interface RowState {
  baseAmount: number | null;
  inputs: CompEntryInputs;
  targets: Record<string, number | null>;
}

export function CompGrid(props: CompGridProps) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"recompute" | "publish" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mesma lista efetiva do servidor: manual ∪ operações (helpers do model —
  // nunca importar engine.ts num client component).
  const members = useMemo(() => {
    const explicit = explicitMemberIds(
      props.config,
      resolveOperationMembers(
        props.config.memberOperationIds,
        props.operationMembersById
      )
    );
    if (explicit === null) return props.responsibles;
    const byId = new Map(props.responsibles.map((r) => [r.id, r]));
    return explicit
      .map((id) => byId.get(id))
      .filter((r): r is { id: string; label: string } => Boolean(r));
  }, [props.config, props.responsibles, props.operationMembersById]);

  const entryByMember = useMemo(
    () => new Map(props.entries.map((e) => [e.responsible_id, e])),
    [props.entries]
  );

  // Estado editável (semente = dados da page; regenera quando o server refaz).
  const [rows, setRows] = useState<Map<string, RowState>>(() => seed());
  const [seedKey, setSeedKey] = useState("");
  function seed(): Map<string, RowState> {
    const m = new Map<string, RowState>();
    for (const member of members) {
      const entry = entryByMember.get(member.id);
      m.set(member.id, {
        baseAmount: entry?.base_amount ?? null,
        inputs: parseCompEntryInputs(entry?.inputs),
        targets: { ...(props.targets[member.id] ?? {}) },
      });
    }
    return m;
  }
  // Reconcilia quando o dataset da page muda (mês/plano/refresh pós-ação).
  const dataKey = `${props.plan.id}:${props.year}-${props.month}:${props.entries
    .map((e) => `${e.id}@${e.updated_at}`)
    .join(",")}:${JSON.stringify(props.targets)}`;
  if (dataKey !== seedKey) {
    setSeedKey(dataKey);
    setRows(seed());
  }

  const patchRow = (memberId: string, patch: Partial<RowState>) =>
    setRows((cur) => {
      const next = new Map(cur);
      const row = next.get(memberId);
      if (row) next.set(memberId, { ...row, ...patch });
      return next;
    });

  const persistPatch = (memberId: string, patch: EntryPatch) =>
    startTransition(async () => {
      const res = await saveEntryInputs({
        planId: props.plan.id,
        responsibleId: memberId,
        year: props.year,
        month: props.month,
        patch,
      });
      if (!res.ok) notifyActionError("Salvar lançamento", res.message);
    });

  const persistTarget = (memberId: string, factorId: string, value: number | null) =>
    startTransition(async () => {
      const res = await saveTarget({
        planId: props.plan.id,
        responsibleId: memberId,
        year: props.year,
        month: props.month,
        factorId,
        value,
      });
      if (!res.ok) notifyActionError("Salvar alvo", res.message);
    });

  const runRecompute = () => {
    setBusy("recompute");
    setNotice(null);
    startTransition(async () => {
      const res = await recomputeMonth(props.plan.id, props.year, props.month);
      setBusy(null);
      if (!res.ok) notifyActionError("Recalcular", res.message);
      else
        setNotice(
          `${res.members} responsável(is) × ${res.factors} fator(es) recalculado(s)` +
            (res.queryErrors ? ` — ${res.queryErrors} consulta(s) com erro.` : ".")
        );
    });
  };
  const runPublish = () => {
    setBusy("publish");
    setNotice(null);
    startTransition(async () => {
      const res = await publishMonth(props.plan.id, props.year, props.month);
      setBusy(null);
      if (!res.ok) notifyActionError("Publicar", res.message);
      else setNotice(res.message ?? "Publicado.");
    });
  };

  // Staleness conservador: sem cômputo, ou cômputo anterior ao save do plano
  // (fórmula/fonte pode ter mudado). Peso/base/override NÃO exigem recompute.
  const stale = members.some((m) => {
    const computed = entryByMember.get(m.id)?.computed as CompComputedRaw | null;
    return !computed || String(computed.at ?? "") < props.plan.updated_at;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={runRecompute} disabled={busy !== null}>
          <Play className="size-4" />
          {busy === "recompute" ? "Recalculando…" : "Recalcular"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runPublish}
          disabled={busy !== null}
        >
          <UploadCloud className="size-4" />
          {busy === "publish" ? "Publicando…" : "Publicar na base"}
        </Button>
        {stale ? (
          <Badge variant="outline" className="text-amber-600">
            Desatualizado — recalcule
          </Badge>
        ) : null}
        {props.config.totalFormula ? (
          <Badge variant="secondary">ƒ total por fórmula</Badge>
        ) : null}
        {notice ? (
          <span className="text-muted-foreground text-xs">{notice}</span>
        ) : null}
        {pending ? (
          <span className="text-muted-foreground ml-auto text-xs">Salvando…</span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="bg-background sticky left-0 z-10 min-w-40">
                Responsável
              </TableHead>
              <TableHead className="text-right">Base (R$)</TableHead>
              {props.config.factors.map((f) => (
                <TableHead
                  key={f.id}
                  colSpan={4}
                  className="border-l text-center"
                  title={
                    props.config.apuracao === "mes_anterior"
                      ? "Alvo e Realizado referem-se ao mês APURADO (anterior ao do lançamento). Alvos são metas — também editáveis em Configurações → Metas, no mês apurado."
                      : "Alvos são metas — também editáveis em Configurações → Metas"
                  }
                >
                  {f.label}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({f.weightPct.toLocaleString("pt-BR")}%)
                  </span>
                </TableHead>
              ))}
              {(props.config.commissions?.length ?? 0) > 0 ? (
                <TableHead
                  className="border-l text-right"
                  title={commissionHeaderTitle(props.config)}
                >
                  Comissão
                </TableHead>
              ) : null}
              <TableHead className="border-l text-right">Bônus</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="bg-background sticky left-0 z-10" />
              <TableHead />
              {props.config.factors.map((f) => (
                <FactorSubHeader key={f.id} />
              ))}
              {(props.config.commissions?.length ?? 0) > 0 ? (
                <TableHead className="border-l" />
              ) : null}
              <TableHead className="border-l" />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <GridRow
                key={member.id}
                member={member}
                config={props.config}
                plan={props.plan}
                targetRates={props.targetRates}
                entry={entryByMember.get(member.id) ?? null}
                row={rows.get(member.id) ?? null}
                onRow={(patch) => patchRow(member.id, patch)}
                onPersist={(patch) => persistPatch(member.id, patch)}
                onTarget={(factorId, value) => {
                  const row = rows.get(member.id);
                  if (row)
                    patchRow(member.id, {
                      targets: { ...row.targets, [factorId]: value },
                    });
                  persistTarget(member.id, factorId, value);
                }}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs">
        Alvo, Base e Bônus são digitados. Real., Ating.%, valores e Comissão
        são calculados — duplo clique sobrescreve à mão (ponto âmbar; ✕ volta
        ao calculado). Alvos são metas (Configurações → Metas).
        {props.config.apuracao === "mes_anterior"
          ? " Este plano apura sobre o mês ANTERIOR ao do lançamento — Alvo/Real. referem-se ao mês apurado."
          : ""}
      </p>
    </div>
  );
}

function FactorSubHeader() {
  return (
    <>
      <TableHead className="border-l text-right text-xs">Alvo</TableHead>
      <TableHead className="text-right text-xs">Real.</TableHead>
      <TableHead className="text-right text-xs">Ating.%</TableHead>
      <TableHead className="text-right text-xs">Valor</TableHead>
    </>
  );
}

// Tooltip do header da coluna Comissão: um resumo por bloco (gatilho, tipo,
// base e nº de faixas); blocos somam no total.
function commissionHeaderTitle(config: CompPlanConfig): string {
  const byId = new Map(config.factors.map((f) => [f.id, f.label]));
  const lines = (config.commissions ?? []).map((c, i) => {
    const trigger = byId.get(c.triggerFactorId) ?? c.triggerFactorId;
    const by =
      (c.tierBy ?? "attainment") === "realized"
        ? `realizado de ${trigger}`
        : `atingimento de ${trigger}`;
    const kind = c.kind ?? "pct";
    const basis =
      kind === "flat"
        ? "prêmio fixo (R$)"
        : c.basisKind === "base"
          ? kind === "pct"
            ? "% da base variável"
            : "R$ × base variável"
          : `${kind === "pct" ? "%" : "R$ × unidade"} de ${byId.get(c.basisFactorId ?? "") ?? "?"}`;
    return `${c.label ?? `Comissão ${i + 1}`}: gatilho ${by} · ${basis} · ${c.tiers.length} faixa(s)`;
  });
  return `${lines.join(" | ")} — maior limiar ≥ vence; blocos somam`;
}

function GridRow(props: {
  member: { id: string; label: string };
  config: CompPlanConfig;
  plan: CompPlanClientRow;
  targetRates: Record<string, number | null>;
  entry: CompEntryClientRow | null;
  row: { baseAmount: number | null; inputs: CompEntryInputs; targets: Record<string, number | null> } | null;
  onRow: (patch: Partial<{ baseAmount: number | null; inputs: CompEntryInputs }>) => void;
  onPersist: (patch: EntryPatch) => void;
  onTarget: (factorId: string, value: number | null) => void;
}) {
  const { config, row } = props;
  const computed = (props.entry?.computed ?? null) as CompComputedRaw | null;
  const inputs = row?.inputs ?? parseCompEntryInputs(null);
  const baseAmount = row?.baseAmount ?? null;
  const breakdown = computeEntry(
    config,
    baseAmount ?? props.plan.base_amount_default,
    inputs,
    computed?.realized ?? {},
    row?.targets ?? {},
    props.member.id,
    props.targetRates
  );

  const setOverride = (
    factorId: string,
    key: "realized" | "attainmentPct" | "payout",
    value: number | null
  ) => {
    const factors = { ...inputs.overrides.factors };
    const cur = { ...(factors[factorId] ?? {}) };
    if (value == null) delete cur[key];
    else cur[key] = value;
    if (Object.keys(cur).length === 0) delete factors[factorId];
    else factors[factorId] = cur;
    props.onRow({
      inputs: { ...inputs, overrides: { ...inputs.overrides, factors } },
    });
    props.onPersist({ overrides: { factors: { [factorId]: { [key]: value } } } });
  };

  return (
    <TableRow>
      <TableCell className="bg-background sticky left-0 z-10 font-medium">
        {props.member.label}
        {inputs.note ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground ml-1 cursor-help">*</span>
            </TooltipTrigger>
            <TooltipContent>{inputs.note}</TooltipContent>
          </Tooltip>
        ) : null}
      </TableCell>
      {/* Base: digitada; vazia herda o default do plano (itálico). */}
      <EditableCell
        display={
          baseAmount != null
            ? fmtMoney(baseAmount)
            : props.plan.base_amount_default != null
              ? fmtMoney(props.plan.base_amount_default)
              : "—"
        }
        muted={baseAmount == null}
        onSave={(v) => {
          props.onRow({ baseAmount: v });
          props.onPersist({ baseAmount: v });
        }}
        current={baseAmount}
      />
      {config.factors.map((f) => {
        const b = breakdown.byFactor[f.id];
        const error = computed?.errors?.[f.id];
        return (
          <FactorCells
            key={f.id}
            money={f.money}
            targetCurrency={f.targetCurrency ?? null}
            target={b.target}
            targetBRL={b.targetBRL}
            targetSource={b.targetSource}
            targetRateMissing={b.targetRateMissing === true}
            realized={b.realized}
            attainmentPct={b.attainmentPct}
            payout={b.payout}
            overridden={b.overridden}
            queryError={error ?? null}
            hasComputed={computed != null}
            onTarget={(v) => props.onTarget(f.id, v)}
            onOverride={(key, v) => setOverride(f.id, key, v)}
          />
        );
      })}
      {/* Comissão: soma dos blocos (tooltip detalha cada um) com override. */}
      {breakdown.commission != null ? (
        <EditableCell
          className="border-l"
          display={
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{fmtMoney(breakdown.commission.value)}</span>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-0.5">
                  {breakdown.commissionBlocks.map((cb) => {
                    const unit = cb.tierBy === "attainment" ? "%" : "";
                    const tierNote = cb.tier
                      ? `faixa ≥ ${fmtNum(cb.tier.fromPct)}${unit}: ` +
                        (cb.kind === "pct"
                          ? `${fmtNum(cb.tier.ratePct ?? 0)}%`
                          : cb.kind === "flat"
                            ? fmtMoney(cb.tier.amount ?? 0)
                            : `${fmtMoney(cb.tier.amount ?? 0)}/un.`)
                      : "nenhuma faixa atingida";
                    const memberCustom = config.commissions?.some(
                      (c) => c.id === cb.blockId && c.memberTiers?.[props.member.id]
                    );
                    return (
                      <span key={cb.blockId}>
                        {cb.label}: {fmtMoney(cb.value)} — {tierNote}
                        {cb.triggerValue != null
                          ? ` (gatilho ${fmtNum(cb.triggerValue)}${unit})`
                          : ""}
                        {memberCustom ? " · faixas do membro" : ""}
                      </span>
                    );
                  })}
                  {breakdown.commissionBlocks.length > 1 ? (
                    <span className="font-medium">
                      Soma: {fmtMoney(
                        breakdown.commissionBlocks.reduce((a, b) => a + b.value, 0)
                      )}
                    </span>
                  ) : null}
                </div>
              </TooltipContent>
            </Tooltip>
          }
          overridden={breakdown.commission.overridden}
          onSave={(v) => {
            const overrides = { ...inputs.overrides };
            if (v == null) delete overrides.commission;
            else overrides.commission = v;
            props.onRow({ inputs: { ...inputs, overrides } });
            props.onPersist({ overrides: { commission: v } });
          }}
          current={inputs.overrides.commission ?? null}
        />
      ) : null}
      {/* Bônus: popover com a lista. */}
      <TableCell className="border-l text-right">
        <BonusCell
          bonuses={inputs.bonuses}
          onChange={(bonuses) => {
            props.onRow({ inputs: { ...inputs, bonuses } });
            props.onPersist({ bonuses });
          }}
        />
      </TableCell>
      {/* Total: derivado (fórmula livre ⇒ ƒ) com override. */}
      <EditableCell
        display={
          breakdown.total == null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-destructive inline-flex items-center gap-1">
                  <CircleAlert className="size-3.5" /> —
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Fórmula do total sem resultado (divisão por zero ou variável
                ausente) — corrija a fórmula ou sobrescreva o total.
              </TooltipContent>
            </Tooltip>
          ) : (
            fmtMoney(breakdown.total)
          )
        }
        bold
        overridden={breakdown.totalOverridden}
        computedHint={
          breakdown.totalOverridden ? "Total manual — ✕ volta ao calculado" : null
        }
        onSave={(v) => {
          // Spread do objeto inteiro — reconstruir só {factors, total}
          // descartaria overrides.commission do estado otimista.
          const overrides = { ...inputs.overrides };
          if (v == null) delete overrides.total;
          else overrides.total = v;
          props.onRow({ inputs: { ...inputs, overrides } });
          props.onPersist({ overrides: { total: v } });
        }}
        current={inputs.overrides.total ?? null}
      />
    </TableRow>
  );
}

// Grupo de 4 células de um fator.
function FactorCells(props: {
  money: boolean;
  targetCurrency: string | null;
  target: number | null;
  targetBRL: number | null;
  targetSource: "goal" | "default" | null;
  targetRateMissing: boolean;
  realized: number | null;
  attainmentPct: number | null;
  payout: number;
  overridden: { realized: boolean; attainmentPct: boolean; payout: boolean };
  queryError: string | null;
  hasComputed: boolean;
  onTarget: (v: number | null) => void;
  onOverride: (key: "realized" | "attainmentPct" | "payout", v: number | null) => void;
}) {
  const fmt = props.money ? fmtMoney : fmtNum;
  // Alvo: exibido na moeda DIGITADA; tooltip traz o convertido em R$ (decisão
  // "mostrar os dois"), a origem (padrão do plano em itálico) e o erro de
  // cotação ausente (fail-closed — nunca converte 1:1).
  const targetText =
    props.target == null
      ? "—"
      : props.targetCurrency
        ? fmtMoneyIn(props.targetCurrency, props.target)
        : fmt(props.target);
  const targetTip: string[] = [];
  if (props.targetRateMissing && props.targetCurrency)
    targetTip.push(
      `Sem cotação ${props.targetCurrency} para o trimestre — cadastre em Configurações → Campos → Moedas. Atingimento fica vazio (nunca converte 1:1).`
    );
  else if (props.targetCurrency && props.targetBRL != null)
    targetTip.push(`≈ ${fmtMoney(props.targetBRL)} na cotação do trimestre`);
  if (props.targetSource === "default")
    targetTip.push(
      "Alvo padrão do plano — digite para fixar a meta do mês; limpar volta ao padrão."
    );
  return (
    <>
      <EditableCell
        className="border-l"
        display={
          targetTip.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={
                    props.targetRateMissing
                      ? "text-destructive inline-flex items-center gap-1"
                      : undefined
                  }
                >
                  {props.targetRateMissing ? (
                    <CircleAlert className="size-3.5" />
                  ) : null}
                  {targetText}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex max-w-64 flex-col gap-0.5">
                  {targetTip.map((t, i) => (
                    <span key={i}>{t}</span>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            targetText
          )
        }
        muted={props.targetSource === "default"}
        onSave={props.onTarget}
        current={props.targetSource === "goal" ? props.target : null}
      />
      <EditableCell
        display={
          props.queryError && props.realized == null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-destructive inline-flex items-center gap-1">
                  <CircleAlert className="size-3.5" /> —
                </span>
              </TooltipTrigger>
              <TooltipContent>{props.queryError}</TooltipContent>
            </Tooltip>
          ) : props.realized != null ? (
            fmt(props.realized)
          ) : props.hasComputed ? (
            "—"
          ) : (
            <span className="text-muted-foreground">…</span>
          )
        }
        overridden={props.overridden.realized}
        onSave={(v) => props.onOverride("realized", v)}
        current={props.realized}
      />
      <EditableCell
        display={
          props.attainmentPct != null ? `${fmtNum(props.attainmentPct)}%` : "—"
        }
        overridden={props.overridden.attainmentPct}
        onSave={(v) => props.onOverride("attainmentPct", v)}
        current={props.attainmentPct}
      />
      <EditableCell
        display={fmtMoney(props.payout)}
        overridden={props.overridden.payout}
        onSave={(v) => props.onOverride("payout", v)}
        current={props.payout}
      />
    </>
  );
}

// Célula numérica com edição inline (duplo clique), marcador de override e
// "voltar ao calculado" (✕ = salvar null).
function EditableCell(props: {
  display: React.ReactNode;
  current: number | null;
  onSave: (v: number | null) => void;
  overridden?: boolean;
  muted?: boolean;
  bold?: boolean;
  className?: string;
  computedHint?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    setEditing(false);
    const v = parseInput(text);
    if (text.trim() === "") props.onSave(null);
    else if (v != null) props.onSave(v);
  };
  return (
    <TableCell
      className={`text-right tabular-nums ${props.className ?? ""} ${
        props.muted ? "text-muted-foreground italic" : ""
      } ${props.bold ? "font-semibold" : ""}`}
      onDoubleClick={() => {
        setText(props.current != null ? String(props.current) : "");
        setEditing(true);
      }}
    >
      {editing ? (
        <Input
          autoFocus
          className="h-7 w-24 text-right"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="inline-flex items-center justify-end gap-1">
          {props.overridden ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block size-1.5 rounded-full bg-amber-500" />
              </TooltipTrigger>
              <TooltipContent>
                {props.computedHint ?? "Valor manual — ✕ volta ao calculado"}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {props.display}
          {props.overridden ? (
            <button
              type="button"
              aria-label="Voltar ao calculado"
              className="text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                props.onSave(null);
              }}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      )}
    </TableCell>
  );
}

// Popover de bônus: lista rótulo + valor, adicionar/remover.
function BonusCell(props: {
  bonuses: CompBonus[];
  onChange: (bonuses: CompBonus[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const total = props.bonuses.reduce((acc, b) => acc + b.amount, 0);
  const add = () => {
    const v = parseInput(amount);
    if (v == null || label.trim() === "") return;
    props.onChange([
      ...props.bonuses,
      { id: `b_${Math.random().toString(36).slice(2, 10)}`, label: label.trim(), amount: v },
    ]);
    setLabel("");
    setAmount("");
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="tabular-nums underline-offset-2 hover:underline">
          {total !== 0 || props.bonuses.length > 0 ? fmtMoney(total) : "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Bonificações</p>
          {props.bonuses.length === 0 ? (
            <p className="text-muted-foreground text-xs">Nenhum bônus no mês.</p>
          ) : (
            props.bonuses.map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{b.label}</span>
                <span className="tabular-nums">{fmtMoney(b.amount)}</span>
                <button
                  type="button"
                  aria-label={`Remover ${b.label}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    props.onChange(props.bonuses.filter((x) => x.id !== b.id))
                  }
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
          <div className="flex items-center gap-2">
            <Input
              className="h-8 flex-1"
              placeholder="Motivo"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              className="h-8 w-24 text-right"
              placeholder="R$"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <Button type="button" size="sm" variant="outline" onClick={add}>
              Ok
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
