// Versão: 1.8 | Data: 16/08/2026 (v1.8: CONFERÊNCIA por registro — ícone
// próprio na célula Realizado (aparece no hover) abre o CompDetailPanel com os
// registros por trás do número; o duplo-clique da célula segue sendo o
// override manual, nunca sequestrado)
// Versão: 1.7 | Data: 07/08/2026 (v1.7: célula persiste OTIMISTA em background
// — useBackgroundSave com revalidate:false: o await volta após a gravação (sem
// re-render RSC dentro da transition), erro → toast + REVERT da linha ao
// estado pré-edição, e o reseed por dataKey é GUARDADO por hasPending —
// digitação durante um save em voo não é mais descartada pelo eco stale;
// o refresh debounced do hook reconcilia ao drenar)
// Versão: 1.6 | Data: 01/08/2026 (v1.6: linha de DETALHE sempre visível sob
// cada membro — a memória da linha inteira (fatores base × peso × ating.,
// blocos de comissão, soma/override, bônus, composição do total) em texto
// compacto via entryMemoryLines/factorPayoutFormula do commission-label
// (dono único dos textos); colSpan da célula = colCount computado junto do
// header e pinado em teste)
// Versão: 1.5 | Data: 01/08/2026 (v1.5: MEMÓRIA DE CÁLCULO da comissão —
// popover clicável na célula (ícone dedicado; o valor segue EditableCell com
// override por duplo-clique) com a multiplicação por bloco via
// commissionMemory (lib/comp/commission-label — helper único, nunca texto
// duplicado); Valor de fator com peso 0 sem override exibe "—" com title
// (display-only — a coluna nunca some: segue alvo de override e de
// comp:f:<id>:valor); title com a conta base × peso × ating. no Valor de
// fator com peso > 0)
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
import { CircleAlert, ListTree, Play, UploadCloud, X } from "lucide-react";

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
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  commissionMemory,
  entryMemoryLines,
  factorPayoutFormula,
  fmtMoneyBRL as fmtMoney,
  fmtNumBR as fmtNum,
} from "@/lib/comp/commission-label";
import {
  computeEntry,
  explicitMemberIds,
  parseCompEntryInputs,
  resolveOperationMembers,
  type CompBonus,
  type CompCommissionBlockBreakdown,
  type CompCommissionBreakdown,
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
} from "@/app/(app)/operacao/remuneracao/actions";
import {
  CompDetailPanel,
  type CompDetailTarget,
} from "./comp-detail-panel";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

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
  // Transition SÓ para Recalcular/Publicar (operações longas, bloqueio
  // deliberado por busy); os saves de célula rodam em background pelo hook.
  const [pending, startTransition] = useTransition();
  const { save: backgroundSave, hasPending } = useBackgroundSave();
  const [busy, setBusy] = useState<"recompute" | "publish" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Instância ÚNICA içada do painel de conferência (os registros por trás do
  // Realizado); as células só apontam o alvo.
  const [detailTarget, setDetailTarget] = useState<CompDetailTarget | null>(
    null
  );

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
  // Guard hasPending (espelho do skipNextData do kanban): com save em voo, um
  // eco de CONTEÚDO (mesmas plano/mês) é stale — o reseed descartaria a
  // digitação feita durante a espera. ADOTA a key sem aplicar (consome o eco;
  // aplicá-lo no drain clobberaria o otimista); o refresh do hook traz o dado
  // gravado numa key nova (updated_at das entries muda) e o reseed normal
  // aplica. Mudança de ESCOPO (plano/mês) re-semeia SEMPRE — otimista de
  // outro mês em tela gravaria/exibiria no mês errado.
  const scopeKey = `${props.plan.id}:${props.year}-${props.month}`;
  const dataKey = `${scopeKey}:${props.entries
    .map((e) => `${e.id}@${e.updated_at}`)
    .join(",")}:${JSON.stringify(props.targets)}`;
  if (dataKey !== seedKey) {
    const sameScope = seedKey.startsWith(`${scopeKey}:`);
    setSeedKey(dataKey);
    if (!hasPending || !sameScope) setRows(seed());
  }

  const patchRow = (memberId: string, patch: Partial<RowState>) =>
    setRows((cur) => {
      const next = new Map(cur);
      const row = next.get(memberId);
      if (row) next.set(memberId, { ...row, ...patch });
      return next;
    });

  // Saves de célula em background: o closure vê `rows` ANTES do patchRow do
  // mesmo evento — baseline do revert (erro restaura a linha pré-edição).
  const persistPatch = (memberId: string, patch: EntryPatch) => {
    const prev = rows.get(memberId);
    backgroundSave({
      key: memberId,
      context: "Salvar lançamento",
      action: () =>
        saveEntryInputs(
          {
            planId: props.plan.id,
            responsibleId: memberId,
            year: props.year,
            month: props.month,
            patch,
          },
          { revalidate: false }
        ),
      revert: () => {
        if (prev) setRows((cur) => new Map(cur).set(memberId, prev));
      },
    });
  };

  const persistTarget = (memberId: string, factorId: string, value: number | null) => {
    const prev = rows.get(memberId);
    backgroundSave({
      key: memberId,
      context: "Salvar alvo",
      action: () =>
        saveTarget(
          {
            planId: props.plan.id,
            responsibleId: memberId,
            year: props.year,
            month: props.month,
            factorId,
            value,
          },
          { revalidate: false }
        ),
      revert: () => {
        if (prev) setRows((cur) => new Map(cur).set(memberId, prev));
      },
    });
  };

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

  // Nº de colunas físicas da tabela (fonte: header abaixo) — a linha de
  // detalhe da memória usa este valor como colSpan.
  const colCount =
    4 +
    4 * props.config.factors.length +
    ((props.config.commissions?.length ?? 0) > 0 ? 1 : 0);

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
        {pending || hasPending ? (
          <span className="text-muted-foreground ml-auto text-xs">Salvando…</span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border">
        {/* Colunas físicas do header acima: Responsável + Base + 4 por fator
            + Comissão (se houver) + Bônus + Total — a linha de detalhe usa a
            MESMA contagem no colSpan (pinado em comp-grid.test). */}
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
                colCount={colCount}
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
                onOpenDetail={(factorId) =>
                  setDetailTarget({
                    planId: props.plan.id,
                    memberId: member.id,
                    memberLabel: member.label,
                    factorId,
                  })
                }
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
      <CompDetailPanel
        target={detailTarget}
        year={props.year}
        month={props.month}
        onClose={() => setDetailTarget(null)}
      />
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
  colCount: number;
  targetRates: Record<string, number | null>;
  entry: CompEntryClientRow | null;
  row: { baseAmount: number | null; inputs: CompEntryInputs; targets: Record<string, number | null> } | null;
  onRow: (patch: Partial<{ baseAmount: number | null; inputs: CompEntryInputs }>) => void;
  onPersist: (patch: EntryPatch) => void;
  onTarget: (factorId: string, value: number | null) => void;
  onOpenDetail: (factorId: string) => void;
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
    <>
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
        // Memória do Valor por atingimento (helper único) — só quando o
        // fator pontua e nada foi sobrescrito à mão (senão o title mentiria).
        const payoutTitle =
          f.weightPct > 0 && !b.overridden.payout && b.attainmentPct != null
            ? factorPayoutFormula(breakdown.base, f.weightPct, b.attainmentPct, b.payout)
            : null;
        return (
          <FactorCells
            key={f.id}
            money={f.money}
            weightPct={f.weightPct}
            targetCurrency={f.targetCurrency ?? null}
            target={b.target}
            targetBRL={b.targetBRL}
            targetSource={b.targetSource}
            targetRateMissing={b.targetRateMissing === true}
            realized={b.realized}
            attainmentPct={b.attainmentPct}
            payout={b.payout}
            payoutTitle={payoutTitle}
            overridden={b.overridden}
            queryError={error ?? null}
            hasComputed={computed != null}
            onTarget={(v) => props.onTarget(f.id, v)}
            onOverride={(key, v) => setOverride(f.id, key, v)}
            onOpenDetail={() => props.onOpenDetail(f.id)}
          />
        );
      })}
      {/* Comissão: soma dos blocos com override; o ícone abre a memória de
          cálculo (popover clicável — o dblclick de edição fica no resto da
          célula). */}
      {breakdown.commission != null ? (
        <EditableCell
          className="border-l"
          display={
            <span className="inline-flex items-center gap-1">
              <CommissionMemoryPopover
                blocks={breakdown.commissionBlocks}
                commission={breakdown.commission}
              />
              {fmtMoney(breakdown.commission.value)}
            </span>
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
    {/* Memória de cálculo SEMPRE visível (pedido do RH): a conta da linha em
        texto compacto — itens de entryMemoryLines (helper único). A célula
        única não participa do sticky da 1ª coluna (rola com a tabela). */}
    <TableRow className="hover:bg-muted/30">
      <TableCell colSpan={props.colCount} className="bg-muted/30 py-1">
        <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          {entryMemoryLines(config, breakdown).map((line, i) => (
            <span key={i} className="inline-flex items-baseline gap-x-2">
              {i > 0 ? <span aria-hidden>·</span> : null}
              <span>{line}</span>
            </span>
          ))}
        </div>
      </TableCell>
    </TableRow>
    </>
  );
}

// Grupo de 4 células de um fator.
function FactorCells(props: {
  money: boolean;
  weightPct: number;
  targetCurrency: string | null;
  target: number | null;
  targetBRL: number | null;
  targetSource: "goal" | "default" | null;
  targetRateMissing: boolean;
  realized: number | null;
  attainmentPct: number | null;
  payout: number;
  // Conta base × peso × ating. (title do Valor) — null sem atingimento.
  payoutTitle: string | null;
  overridden: { realized: boolean; attainmentPct: boolean; payout: boolean };
  queryError: string | null;
  hasComputed: boolean;
  onTarget: (v: number | null) => void;
  onOverride: (key: "realized" | "attainmentPct" | "payout", v: number | null) => void;
  onOpenDetail: () => void;
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
        className="group"
        display={
          <span className="inline-flex items-center gap-1">
            {/* Conferência dos registros: BOTÃO próprio (o duplo-clique da
                célula continua sendo o override manual — não sequestrar). */}
            <button
              type="button"
              aria-label="Ver os registros que compõem este realizado"
              title="Ver os registros que compõem este realizado"
              className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={() => props.onOpenDetail()}
            >
              <ListTree className="size-3.5" />
            </button>
            {props.queryError && props.realized == null ? (
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
            )}
          </span>
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
      {/* Valor: com peso 0 sem override, "—" (o fator não compõe a parcela
          por atingimento) — display-only, o override por dblclick segue. */}
      <EditableCell
        display={
          props.weightPct === 0 && !props.overridden.payout ? (
            <span
              className="text-muted-foreground"
              title="Peso 0% — este fator não compõe a parcela por atingimento; serve de gatilho/base de comissão."
            >
              —
            </span>
          ) : (
            <span title={props.payoutTitle ?? undefined}>
              {fmtMoney(props.payout)}
            </span>
          )
        }
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

// Memória de cálculo da comissão: um bloco por linha (label + multiplicação +
// faixa/gatilho via commissionMemory — helper único com a my-comp-view), soma
// quando há mais de um bloco e nota explícita quando a soma foi sobrescrita
// (sem ela, "soma dos blocos ≠ célula" pareceria bug). O trigger é um ícone
// próprio DENTRO do display do EditableCell: dblclick nele não pode vazar
// para a edição da célula (stopPropagation).
function CommissionMemoryPopover(props: {
  blocks: CompCommissionBlockBreakdown[];
  commission: CompCommissionBreakdown;
}) {
  const blocksSum = props.blocks.reduce((a, b) => a + b.value, 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Memória de cálculo da comissão"
          title="Memória de cálculo"
          className="text-muted-foreground hover:text-foreground"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ListTree className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-2 text-left">
          <p className="text-sm font-medium">Memória de cálculo</p>
          {props.blocks.map((cb) => {
            const mem = commissionMemory(cb);
            return (
              <div key={cb.blockId} className="flex flex-col gap-0.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{cb.label}</span>
                  <span className="tabular-nums">{fmtMoney(cb.value)}</span>
                </div>
                {mem.formula != null ? (
                  <span className="tabular-nums text-xs">{mem.formula}</span>
                ) : null}
                <span className="text-muted-foreground text-xs">
                  {mem.tierNote}
                  {mem.memberTiers ? " · faixas do membro" : ""}
                </span>
              </div>
            );
          })}
          {props.blocks.length > 1 ? (
            <div className="flex items-baseline justify-between gap-2 border-t pt-1.5 text-sm font-medium">
              <span>Soma</span>
              <span className="tabular-nums">{fmtMoney(blocksSum)}</span>
            </div>
          ) : null}
          {props.commission.overridden ? (
            <p className="text-muted-foreground text-xs">
              Soma sobrescrita à mão: {fmtMoney(props.commission.value)}{" "}
              (calculado: {fmtMoney(blocksSum)}) — ✕ na célula volta ao
              calculado.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
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
