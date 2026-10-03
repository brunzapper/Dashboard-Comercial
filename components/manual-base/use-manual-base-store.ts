// Versão: 1.0 | Data: 03/10/2026
// v1.0 (03/10/2026): o ESTADO e as MUTAÇÕES da tela da Base manual (v2).
//
// Antes só os lançamentos eram otimistas; métricas, divisões, opções e a
// declaração liam direto das props. Na página isso "funcionava" com atraso (o
// router.refresh trazia a lista nova), mas no ⋮ do dashboard e no widget — que
// guardam o estado de `getManualBaseState` — criar uma opção gravava e NÃO
// aparecia. Era isso que fazia parecer impossível acrescentar opções a
// "Componente do investimento". Agora toda peça é otimista, com o mesmo padrão
// seedKey + `hasPending` (o eco do servidor com save em voo é stale e nunca
// clobbera o otimista), e o host recebe `onChanged` para recarregar.
//
// A escrita segue SÓ pelas actions de app/(app)/registros/base-manual
// (invariante 25) — este hook não fala com o banco.
"use client";

import { useState } from "react";

import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import type {
  ManualFamily,
  ManualFamilyMember,
} from "@/lib/manual-base/families";
import {
  DEFAULT_MANUAL_SPREAD,
  type ManualEntry,
  type ManualSeries,
  type ManualSpread,
} from "@/lib/manual-base/types";
import {
  deleteManualEntry,
  deleteManualFamily,
  deleteManualFamilyMember,
  deleteManualSeries,
  reorderManualItems,
  saveManualEntry,
  saveManualFamily,
  saveManualFamilyMember,
  saveManualSeries,
  setManualSeriesFamilies,
  type ManualActionState,
} from "@/app/(app)/registros/base-manual/actions";

import type { ManualGridRow } from "./rows";

export interface ManualBaseSnapshot {
  series: ManualSeries[];
  entries: ManualEntry[];
  families: ManualFamily[];
  members: ManualFamilyMember[];
  declarations: Record<string, string[]>;
}

/** Item ainda não confirmado pelo servidor — sem id real, não aceita edição. */
export const isTempId = (id: string): boolean => id.startsWith("tmp:");

const byOrder = <T extends { sort_order: number; label: string }>(a: T, b: T) =>
  a.sort_order - b.sort_order || a.label.localeCompare(b.label, "pt-BR");

/** Move o item `id` uma posição (`-1` sobe, `+1` desce) e renumera. */
function moved<T extends { id: string; sort_order: number }>(
  list: readonly T[],
  id: string,
  delta: -1 | 1
): T[] | null {
  const idx = list.findIndex((x) => x.id === id);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= list.length) return null;
  const next = list.slice();
  [next[idx], next[to]] = [next[to], next[idx]];
  return next.map((x, i) => ({ ...x, sort_order: i }));
}

export function useManualBaseStore(
  initial: ManualBaseSnapshot,
  onChanged?: () => void
) {
  const { save, pendingKeys, hasPending } = useBackgroundSave();
  const [state, setState] = useState<ManualBaseSnapshot>(initial);
  const [seedKey, setSeedKey] = useState(() => JSON.stringify(initial));
  const nextSeed = JSON.stringify(initial);
  if (nextSeed !== seedKey && !hasPending) {
    setSeedKey(nextSeed);
    setState(initial);
  }

  /** Save estrutural: otimista, revert na falha, `onChanged` no sucesso. */
  const run = (
    key: string,
    context: string,
    optimistic: (s: ManualBaseSnapshot) => ManualBaseSnapshot,
    action: () => Promise<ManualActionState>,
    notifyHost = true
  ) => {
    const before = state;
    setState(optimistic);
    save({
      key,
      context,
      action: async () => {
        const res = await action();
        if (res.ok && notifyHost) onChanged?.();
        return res;
      },
      revert: () => setState(before),
    });
  };

  const sortedSeries = state.series.slice().sort(byOrder);
  const sortedFamilies = state.families.slice().sort(byOrder);

  // ===================== MÉTRICAS =====================

  const addSeries = (label: string) => {
    const clean = label.trim();
    if (clean.length < 2) return;
    const sortOrder = sortedSeries.length;
    run(
      `series:new:${clean}`,
      "Não foi possível criar a métrica",
      (s) => ({
        ...s,
        series: [
          ...s.series,
          {
            id: `tmp:series:${clean}`,
            key: "",
            label: clean,
            default_spread: DEFAULT_MANUAL_SPREAD,
            sort_order: sortOrder,
          },
        ],
      }),
      () => saveManualSeries({ label: clean, sortOrder }, { revalidate: false })
    );
  };

  const updateSeries = (
    target: ManualSeries,
    patch: { label?: string; defaultSpread?: ManualSpread }
  ) => {
    if (isTempId(target.id)) return;
    const label = (patch.label ?? target.label).trim();
    if (label.length < 2) return;
    run(
      `series:${target.id}`,
      "Não foi possível salvar a métrica",
      (s) => ({
        ...s,
        series: s.series.map((x) =>
          x.id === target.id
            ? { ...x, label, default_spread: patch.defaultSpread ?? x.default_spread }
            : x
        ),
      }),
      () =>
        saveManualSeries(
          { id: target.id, label, defaultSpread: patch.defaultSpread },
          { revalidate: false }
        )
    );
  };

  const moveSeries = (id: string, delta: -1 | 1) => {
    const next = moved(sortedSeries, id, delta);
    if (!next || next.some((x) => isTempId(x.id))) return;
    run(
      "series:order",
      "Não foi possível reordenar as métricas",
      (s) => ({ ...s, series: next }),
      () =>
        reorderManualItems(
          "series",
          next.map((x) => x.id),
          { revalidate: false }
        )
    );
  };

  const deleteSeries = (target: ManualSeries) => {
    if (isTempId(target.id)) return;
    run(
      `series:del:${target.id}`,
      "Não foi possível excluir a métrica",
      (s) => ({
        ...s,
        series: s.series.filter((x) => x.id !== target.id),
        entries: s.entries.filter((e) => e.series_id !== target.id),
      }),
      () => deleteManualSeries(target.id, { revalidate: false })
    );
  };

  // A declaração chega COMPLETA à action (não é delta): é a lista que a tela
  // edita, e reconciliar por diferença deixaria uma retirada sobreviver ao F5.
  const toggleDeclaration = (seriesId: string, familyKey: string) => {
    if (isTempId(seriesId)) return;
    const current = state.declarations[seriesId] ?? [];
    const next = current.includes(familyKey)
      ? current.filter((k) => k !== familyKey)
      : [...current, familyKey];
    run(
      `decl:${seriesId}`,
      "Não foi possível mudar as divisões da métrica",
      (s) => ({ ...s, declarations: { ...s.declarations, [seriesId]: next } }),
      () => setManualSeriesFamilies(seriesId, next, { revalidate: false })
    );
  };

  // ===================== DIVISÕES =====================

  const addFamily = (label: string) => {
    const clean = label.trim();
    if (clean.length < 2) return;
    const sortOrder = sortedFamilies.length;
    run(
      `family:new:${clean}`,
      "Não foi possível criar a divisão",
      (s) => ({
        ...s,
        families: [
          ...s.families,
          { id: `tmp:family:${clean}`, key: "", label: clean, sort_order: sortOrder },
        ],
      }),
      () => saveManualFamily({ label: clean, sortOrder }, { revalidate: false })
    );
  };

  const renameFamily = (target: ManualFamily, label: string) => {
    const clean = label.trim();
    if (isTempId(target.id) || clean.length < 2 || clean === target.label) return;
    run(
      `family:${target.id}`,
      "Não foi possível renomear a divisão",
      (s) => ({
        ...s,
        families: s.families.map((f) => (f.id === target.id ? { ...f, label: clean } : f)),
      }),
      () => saveManualFamily({ id: target.id, label: clean }, { revalidate: false })
    );
  };

  const moveFamily = (id: string, delta: -1 | 1) => {
    const next = moved(sortedFamilies, id, delta);
    if (!next || next.some((x) => isTempId(x.id))) return;
    run(
      "family:order",
      "Não foi possível reordenar as divisões",
      (s) => ({ ...s, families: next }),
      () =>
        reorderManualItems(
          "families",
          next.map((x) => x.id),
          { revalidate: false }
        )
    );
  };

  const deleteFamily = (target: ManualFamily) => {
    if (isTempId(target.id)) return;
    run(
      `family:del:${target.id}`,
      "Não foi possível excluir a divisão",
      (s) => ({
        ...s,
        families: s.families.filter((f) => f.id !== target.id),
        members: s.members.filter((m) => m.family_id !== target.id),
      }),
      () => deleteManualFamily(target.id, { revalidate: false })
    );
  };

  const membersOf = (familyId: string): ManualFamilyMember[] =>
    state.members.filter((m) => m.family_id === familyId).sort(byOrder);

  const addMember = (family: ManualFamily, label: string) => {
    const clean = label.trim();
    if (isTempId(family.id) || clean.length < 1) return;
    const sortOrder = membersOf(family.id).length;
    run(
      `member:new:${family.id}:${clean}`,
      "Não foi possível criar a opção",
      (s) => ({
        ...s,
        members: [
          ...s.members,
          {
            id: `tmp:member:${family.id}:${clean}`,
            family_id: family.id,
            key: "",
            label: clean,
            sort_order: sortOrder,
          },
        ],
      }),
      () =>
        saveManualFamilyMember(
          { familyId: family.id, label: clean, sortOrder },
          { revalidate: false }
        )
    );
  };

  const renameMember = (target: ManualFamilyMember, label: string) => {
    const clean = label.trim();
    if (isTempId(target.id) || clean.length < 1 || clean === target.label) return;
    run(
      `member:${target.id}`,
      "Não foi possível renomear a opção",
      (s) => ({
        ...s,
        members: s.members.map((m) => (m.id === target.id ? { ...m, label: clean } : m)),
      }),
      () =>
        saveManualFamilyMember(
          { id: target.id, familyId: target.family_id, label: clean },
          { revalidate: false }
        )
    );
  };

  const moveMember = (target: ManualFamilyMember, delta: -1 | 1) => {
    const next = moved(membersOf(target.family_id), target.id, delta);
    if (!next || next.some((x) => isTempId(x.id))) return;
    const ids = new Map(next.map((m) => [m.id, m.sort_order]));
    run(
      `member:order:${target.family_id}`,
      "Não foi possível reordenar as opções",
      (s) => ({
        ...s,
        members: s.members.map((m) =>
          ids.has(m.id) ? { ...m, sort_order: ids.get(m.id)! } : m
        ),
      }),
      () =>
        reorderManualItems(
          "members",
          next.map((x) => x.id),
          { revalidate: false }
        )
    );
  };

  const deleteMember = (target: ManualFamilyMember) => {
    if (isTempId(target.id)) return;
    run(
      `member:del:${target.id}`,
      "Não foi possível excluir a opção",
      (s) => ({ ...s, members: s.members.filter((m) => m.id !== target.id) }),
      () => deleteManualFamilyMember(target.id, { revalidate: false })
    );
  };

  // ===================== LANÇAMENTOS =====================
  // Lançamento não chama `onChanged`: a grade já é otimista, e o refresh do
  // save reconcilia a página e (pelo carimbo) os widgets do dashboard.

  /** Grava uma célula. Sem `id` é UPSERT pela chave natural — é o que faz
   *  reenviar o mês atualizar em vez de duplicar. */
  const setCell = (row: ManualGridRow, seriesId: string, raw: string) => {
    if (isTempId(seriesId)) return;
    const existing = row.bySeries.get(seriesId);
    const trimmed = raw.trim();
    const key = `${row.key}:${seriesId}`;

    if (trimmed === "") {
      if (!existing) return;
      run(
        key,
        "Não foi possível apagar o valor",
        (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== existing.id) }),
        () =>
          isTempId(existing.id)
            ? Promise.resolve({ ok: true })
            : deleteManualEntry(existing.id, { revalidate: false }),
        false
      );
      return;
    }

    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) return;

    const optimisticId = existing?.id ?? `tmp:${key}`;
    run(
      key,
      "Não foi possível salvar o valor",
      (s) => ({
        ...s,
        entries: [
          ...s.entries.filter((e) => e.id !== optimisticId),
          {
            id: optimisticId,
            series_id: seriesId,
            // 0143: a linha da grade É a coordenada — o otimista carrega as
            // MESMAS coords, senão cai no nível ∅ e a reconciliação o troca.
            coords: row.coords,
            period_start: row.periodStart,
            period_end: row.periodEnd,
            value: parsed,
            responsible_id: row.responsibleId,
            operation_id: row.operationId,
            spread: row.spread,
            note: existing?.note ?? null,
          },
        ],
      }),
      () =>
        saveManualEntry(
          {
            id: existing && !isTempId(existing.id) ? existing.id : undefined,
            seriesId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            value: parsed,
            responsibleId: row.responsibleId,
            operationId: row.operationId,
            coords: row.coords,
            spread: row.spread,
          },
          { revalidate: false }
        ),
      false
    );
  };

  /** O modo é da LINHA: mudar reescreve todos os lançamentos dela. */
  const setRowSpread = (row: ManualGridRow, spread: ManualSpread) => {
    const cells = [...row.bySeries.values()].filter((c) => !isTempId(c.id));
    if (cells.length === 0) return;
    const ids = new Set(cells.map((c) => c.id));
    run(
      `${row.key}:spread`,
      "Não foi possível mudar como o período conta",
      (s) => ({
        ...s,
        entries: s.entries.map((e) => (ids.has(e.id) ? { ...e, spread } : e)),
      }),
      async () => {
        for (const cell of cells) {
          const res = await saveManualEntry(
            {
              id: cell.id,
              seriesId: cell.series_id,
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
              value: cell.value,
              responsibleId: row.responsibleId,
              operationId: row.operationId,
              coords: row.coords,
              spread,
            },
            { revalidate: false }
          );
          if (!res.ok) return res;
        }
        return { ok: true };
      },
      false
    );
  };

  const removeRow = (row: ManualGridRow) => {
    const cells = [...row.bySeries.values()];
    if (cells.length === 0) return;
    const ids = new Set(cells.map((c) => c.id));
    run(
      `${row.key}:del`,
      "Não foi possível excluir a linha",
      (s) => ({ ...s, entries: s.entries.filter((e) => !ids.has(e.id)) }),
      async () => {
        for (const cell of cells) {
          if (isTempId(cell.id)) continue;
          const res = await deleteManualEntry(cell.id, { revalidate: false });
          if (!res.ok) return res;
        }
        return { ok: true };
      },
      false
    );
  };

  return {
    state,
    series: sortedSeries,
    families: sortedFamilies,
    pendingKeys,
    membersOf,
    addSeries,
    updateSeries,
    moveSeries,
    deleteSeries,
    toggleDeclaration,
    addFamily,
    renameFamily,
    moveFamily,
    deleteFamily,
    addMember,
    renameMember,
    moveMember,
    deleteMember,
    setCell,
    setRowSpread,
    removeRow,
  };
}

export type ManualBaseStore = ReturnType<typeof useManualBaseStore>;
