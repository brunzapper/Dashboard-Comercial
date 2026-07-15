// Versão: 1.0 | Data: 15/07/2026
// Formulário de criação/edição de um snapshot (compartilhado entre o painel do
// dashboard e a aba admin de Configurações). Colhe nome, aba (só na criação),
// restrições (fontes/responsáveis/operações — vazio = todos), interatividade
// (filtros rápidos/de widget) e agenda (presets). O submit fica com o chamador.
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import type { RefreshMode, SnapshotListItem } from "@/lib/snapshots/types";
import type {
  SnapshotFormOptions,
  SnapshotInput,
} from "@/app/(app)/dashboards/snapshot-actions";
import { REFRESH_MODE_LABELS, WEEKDAY_OPTIONS } from "./labels";

// Lista de checkboxes com rolagem (restrições). Vazio = todos (sem restrição).
function CheckList({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border p-2">
        {options.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nenhuma opção.</p>
        ) : (
          options.map((o) => (
            <label
              key={o.value}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm"
            >
              <Checkbox
                checked={selected.has(o.value)}
                onCheckedChange={() => onToggle(o.value)}
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Nada marcado = sem restrição (todos).
      </p>
    </div>
  );
}

export function SnapshotForm({
  options,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  options: SnapshotFormOptions;
  // Presente = edição (aba fixa); ausente = criação.
  initial?: SnapshotListItem;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: SnapshotInput) => void;
  onCancel?: () => void;
}) {
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [tabId, setTabId] = useState(
    initial?.tab_id ?? (options.tabs[0]?.id ?? "")
  );
  const [sources, setSources] = useState<Set<string>>(
    new Set(initial?.allowed_sources ?? [])
  );
  const [resp, setResp] = useState<Set<string>>(
    new Set(initial?.allowed_responsible_ids ?? [])
  );
  const [ops, setOps] = useState<Set<string>>(
    new Set(initial?.allowed_operation_ids ?? [])
  );
  const [allowQuick, setAllowQuick] = useState(
    initial?.allow_quick_filters ?? true
  );
  const [allowWidget, setAllowWidget] = useState(
    initial?.allow_widget_filters ?? true
  );
  const [mode, setMode] = useState<RefreshMode>(initial?.refresh_mode ?? "manual");
  const [time, setTime] = useState(initial?.refresh_time ?? "06:00");
  const [weekday, setWeekday] = useState<number>(initial?.refresh_weekday ?? 1);

  const toggle =
    (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
      const next = new Set(set);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      setter(next);
    };

  function submit() {
    onSubmit({
      name,
      tabId,
      allowedSources: sources.size > 0 ? [...sources] : null,
      allowedResponsibleIds: resp.size > 0 ? [...resp] : null,
      allowedOperationIds: ops.size > 0 ? [...ops] : null,
      allowQuickFilters: allowQuick,
      allowWidgetFilters: allowWidget,
      refreshMode: mode,
      refreshTime: mode === "daily" || mode === "weekly" ? time : null,
      refreshWeekday: mode === "weekly" ? weekday : null,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="snap-name" className="text-xs">
          Nome
        </Label>
        <Input
          id="snap-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Resultados — Cliente X"
          className="h-8"
        />
      </div>

      {!editing && options.tabs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Aba</Label>
          <Select value={tabId} onValueChange={setTabId}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Escolha a aba" />
            </SelectTrigger>
            <SelectContent>
              {options.tabs.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <CheckList
        label="Fontes visíveis"
        options={options.sources}
        selected={sources}
        onToggle={toggle(sources, setSources)}
      />
      <CheckList
        label="Responsáveis visíveis"
        options={options.responsibles}
        selected={resp}
        onToggle={toggle(resp, setResp)}
      />
      <CheckList
        label="Operações visíveis"
        options={options.operations}
        selected={ops}
        onToggle={toggle(ops, setOps)}
      />

      <div className="flex flex-col gap-2">
        <Label className="text-xs">Interatividade do visitante</Label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={allowQuick}
            onCheckedChange={(v) => setAllowQuick(v === true)}
          />
          Permitir filtros rápidos
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={allowWidget}
            onCheckedChange={(v) => setAllowWidget(v === true)}
          />
          Permitir filtros de widget (busca, filtro por campo, período do widget)
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Atualização dos dados</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as RefreshMode)}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(REFRESH_MODE_LABELS) as RefreshMode[]).map((m) => (
              <SelectItem key={m} value={m}>
                {REFRESH_MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "weekly" ? (
          <Select
            value={String(weekday)}
            onValueChange={(v) => setWeekday(Number(v))}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_OPTIONS.map((w) => (
                <SelectItem key={w.value} value={String(w.value)}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {mode === "daily" || mode === "weekly" ? (
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-8 w-32"
            aria-label="Horário da atualização"
          />
        ) : null}
        <p className="text-muted-foreground text-xs">
          Manual: os dados só mudam quando você clicar em &quot;Atualizar
          agora&quot;. Horários no fuso de Brasília.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
