// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): TIPOGRAFIA dos cartões da Tree no cliente.
//   * `TreeTextProvider` resolve, por cartão, o padrão do widget + o do cartão
//     (lib/tree/typography.ts — o cartão vence por propriedade) e as peças do
//     cartão (título, corpo do indicador/plano/ritual, data, progresso) leem
//     o papel delas com `useTreeText`. Fora do provider (ou sem nada
//     configurado) o hook devolve undefined e a classe de sempre decide.
//   * `TreeTypographyEditor` é o editor ÚNICO — usado na Aparência do widget
//     (padrão) e na "Exibição do cartão" (individual).
"use client";

import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DASHBOARD_FONTS, isDashboardFontKey } from "@/lib/dashboards/style";
import {
  normalizeTreeTextSize,
  resolveTreeTypography,
  TREE_TEXT_MAX_PX,
  TREE_TEXT_MIN_PX,
  TREE_TEXT_ROLE_LABELS,
  TREE_TEXT_ROLES,
  treeTextStyle,
  type TreeTextRole,
  type TreeTextStyle,
  type TreeTypography,
} from "@/lib/tree/typography";

const TreeTextContext = createContext<TreeTypography | null>(null);

export function TreeTextProvider({
  widget,
  node,
  children,
}: {
  widget: TreeTypography | null | undefined;
  node: TreeTypography | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => resolveTreeTypography(widget, node), [widget, node]);
  return <TreeTextContext.Provider value={value}>{children}</TreeTextContext.Provider>;
}

/** `style` do papel no cartão corrente (undefined = classe de sempre). */
export function useTreeText(role: TreeTextRole): CSSProperties | undefined {
  return treeTextStyle(useContext(TreeTextContext), role);
}

/**
 * Selos (`Badge`) têm altura fixa (h-4) para a escala pequena; com tamanho
 * próprio a altura acompanha o texto.
 */
export function useTreeBadgeText(role: TreeTextRole): CSSProperties | undefined {
  const s = useTreeText(role);
  return s?.fontSize ? { ...s, height: "auto" } : s;
}

/** Editor: fonte + tamanho por tipo de texto. Vazio = herda. */
export function TreeTypographyEditor({
  value,
  onChange,
  inheritLabel,
}: {
  value: TreeTypography | null | undefined;
  onChange: (next: TreeTypography | undefined) => void;
  /** O que "vazio" significa aqui ("Padrão do widget" / "Padrão"). */
  inheritLabel: string;
}) {
  const typo = value ?? {};
  // Rascunho do tamanho por papel: "1" a caminho de "14" não pode ser
  // descartado no meio da digitação.
  const [drafts, setDrafts] = useState<Partial<Record<TreeTextRole, string>>>({});

  const setRole = (role: TreeTextRole, patch: Partial<TreeTextStyle>) => {
    const cur: TreeTextStyle = { ...(typo[role] ?? {}), ...patch };
    if (cur.font === undefined) delete cur.font;
    if (cur.size === undefined) delete cur.size;
    const next: TreeTypography = { ...typo };
    if (Object.keys(cur).length > 0) next[role] = cur;
    else delete next[role];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const hasAny = Object.keys(typo).length > 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_7.5rem_4.5rem] items-center gap-x-2 text-xs">
        <span>Texto</span>
        <span>Fonte</span>
        <span>Tamanho (px)</span>
      </div>
      {TREE_TEXT_ROLES.map((role) => {
        const s = typo[role];
        const draft = drafts[role];
        return (
          <div
            key={role}
            className="grid grid-cols-[minmax(0,1fr)_7.5rem_4.5rem] items-center gap-x-2"
          >
            <span className="min-w-0 text-xs leading-tight">{TREE_TEXT_ROLE_LABELS[role]}</span>
            <select
              aria-label={`Fonte — ${TREE_TEXT_ROLE_LABELS[role]}`}
              className="border-input h-8 min-w-0 rounded-md border bg-transparent px-1 text-xs"
              value={s?.font ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setRole(role, { font: isDashboardFontKey(v) ? v : undefined });
              }}
            >
              <option value="">{inheritLabel}</option>
              {Object.entries(DASHBOARD_FONTS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              aria-label={`Tamanho — ${TREE_TEXT_ROLE_LABELS[role]}`}
              type="number"
              inputMode="decimal"
              min={TREE_TEXT_MIN_PX}
              max={TREE_TEXT_MAX_PX}
              step={0.5}
              placeholder="—"
              className="border-input h-8 min-w-0 rounded-md border bg-transparent px-1.5 text-xs"
              value={draft ?? (s?.size != null ? String(s.size) : "")}
              onChange={(e) => {
                const raw = e.target.value;
                setDrafts((d) => ({ ...d, [role]: raw }));
                if (raw.trim() === "") return setRole(role, { size: undefined });
                const size = normalizeTreeTextSize(raw);
                if (size != null) setRole(role, { size });
              }}
              onBlur={() =>
                setDrafts((d) => {
                  const next = { ...d };
                  delete next[role];
                  return next;
                })
              }
            />
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Tamanho entre {TREE_TEXT_MIN_PX} e {TREE_TEXT_MAX_PX} px (na Root, o zoom multiplica). Vazio ={" "}
          {inheritLabel.toLowerCase()}.
        </p>
        {hasAny ? (
          <button
            type="button"
            className="text-primary shrink-0 text-xs underline"
            onClick={() => {
              setDrafts({});
              onChange(undefined);
            }}
          >
            Limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}
