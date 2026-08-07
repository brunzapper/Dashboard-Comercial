// Versão: 2.0 | Data: 07/08/2026
// v2.0 (07/08/2026): 100% das colunas populadas + redimensionar + ordenar.
//   - Colunas núcleo deixam de ser hardcoded: a page envia `coreColumns`
//     (refs populadas na base — registros_populated_refs 0120), renderizadas
//     via coreRefLabel/coreCellValue (rótulos do /campos, formatação única de
//     record-cells). Chaves órfãs de custom_fields populadas viram colunas
//     read-only (`orphanColumns`).
//   - Larguras por coluna: ResizeHandle em cada header + useColWidths
//     (localStorage por fonte). Caps default (220/180px) valem só sem largura.
//   - Ordenação: headers clicáveis (asc → desc → limpa) via Link RSC — os
//     params `ordenar`/`dir` são validados no server (lib/records/list-sort).
//   - O painel de edição recebe o catálogo COMPLETO do detalhe (detailFields/
//     offBaseDefs/coreDefs/knownFieldKeys) — 100% dos campos consultáveis.
// v1.4 (31/07/2026): o pan da v1.2 estava MORTO na horizontal — o wrapper
//   interno do primitivo Table (overflow-x-auto) absorvia todo o overflow e o
//   div externo (dono do scrollRef) nunca tinha o que rolar. Agora o Table
//   recebe containerClassName="overflow-x-visible" e o scroller real volta a
//   ser o div externo; de quebra o pan ganha auto-scroll de borda
//   (edgeAutoScroll do useDragPan): parar o ponteiro na borda continua rolando.
// v1.3 (18/07/2026): a edição inline deixou de revalidar no servidor
//   (no_revalidate) — onSaved passa um refresh debounced (fallback de reconcile
//   quando o realtime está indisponível; o RealtimeRefresher segue sendo o
//   caminho principal).
// v1.2 (16/07/2026): pan ("mãozinha") no container da tabela via useDragPan.
// Tabela de registros com colunas do núcleo + campos personalizados visíveis;
// cada linha abre o painel de edição (RecordEditSheet).
"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizeHandle } from "@/components/ui/resize-handle";
import type { FieldDefinition, OptionItem, RecordRow } from "@/lib/records/types";
import {
  coreCellValue,
  coreRefLabel,
  isNumericCoreRef,
} from "@/lib/records/detail-fields";
import {
  SORTABLE_CORE_REGISTROS,
  toggleSort,
  type RecordListSort,
} from "@/lib/records/list-sort";
import type { RecordLabels } from "@/lib/export/record-cells";
import type { SourceKey } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";
import { useDragPan } from "@/lib/use-drag-pan";
import { useColWidths } from "./use-col-widths";
import { EditableCell } from "./editable-cell";
import { RecordEditSheet } from "./record-edit-sheet";

// Header com ordenação (Link RSC — mesma navegação da paginação) + alça de
// largura. O ciclo do clique é asc → desc → limpa; trocar de ordenação volta
// à página 1 (o href remove `page`).
function SortHead({
  colKey,
  label,
  sort,
  sortable,
  alignRight,
  style,
  onResize,
}: {
  colKey: string;
  label: string;
  sort: RecordListSort | null;
  sortable: boolean;
  alignRight?: boolean;
  style?: React.CSSProperties;
  onResize: (w: number) => void;
}) {
  const sp = useSearchParams();
  const active = sort && sort.ref === colKey ? sort.dir : null;

  let href = "";
  if (sortable) {
    const params = new URLSearchParams(sp.toString());
    const next = toggleSort(sort, colKey);
    if (next) {
      params.set("ordenar", next.ref);
      params.set("dir", next.dir);
    } else {
      params.delete("ordenar");
      params.delete("dir");
    }
    params.delete("page");
    href = `/registros?${params.toString()}`;
  }

  return (
    <TableHead
      style={style}
      aria-sort={
        active ? (active === "asc" ? "ascending" : "descending") : undefined
      }
      className={cn(
        "group/col relative overflow-hidden",
        alignRight && "text-right"
      )}
    >
      {sortable ? (
        <Link
          href={href}
          className={cn(
            "hover:text-foreground inline-flex max-w-full items-center gap-1",
            alignRight && "justify-end"
          )}
          title="Ordenar"
        >
          <span className="truncate">{label}</span>
          {active === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0" />
          ) : active === "desc" ? (
            <ArrowDown className="size-3.5 shrink-0" />
          ) : (
            <ArrowUpDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/col:opacity-60" />
          )}
        </Link>
      ) : (
        <span className="block max-w-full truncate">{label}</span>
      )}
      <ResizeHandle axis="col" onResize={onResize} />
    </TableHead>
  );
}

export function RecordsTable({
  source,
  records,
  fields,
  coreColumns,
  orphanColumns,
  coreDefs,
  detailFields,
  offBaseDefs,
  knownFieldKeys,
  sort,
  responsibles,
  operations,
  relatedLeadLabels,
  userRoles,
  canEditValues,
  canManageFields,
}: {
  source: SourceKey;
  records: RecordRow[];
  // Colunas custom (com definição) da tabela.
  fields: FieldDefinition[];
  // Refs núcleo populadas na base (sem "title" — 1ª coluna fixa).
  coreColumns: string[];
  // Chaves de custom_fields populadas sem definição — colunas read-only.
  orphanColumns: string[];
  // Linhas core do /campos (0086) — rótulo/ordem.
  coreDefs: FieldDefinition[];
  // Catálogo do painel de detalhe (100% dos campos).
  detailFields: FieldDefinition[];
  offBaseDefs: FieldDefinition[];
  knownFieldKeys: string[];
  // Ordenação ATIVA já validada pelo server (null = ordem padrão).
  sort: RecordListSort | null;
  responsibles: OptionItem[];
  operations: OptionItem[];
  relatedLeadLabels: Record<string, string>;
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}) {
  const labels: RecordLabels = useMemo(
    () => ({
      responsibles: Object.fromEntries(responsibles.map((r) => [r.id, r.label])),
      operations: Object.fromEntries(operations.map((o) => [o.id, o.label])),
      leads: relatedLeadLabels,
    }),
    [responsibles, operations, relatedLeadLabels]
  );
  // A edição inline não revalida mais no servidor (no_revalidate): a página
  // reconcilia via RealtimeRefresher (~2s) e este refresh debounced é o
  // fallback quando o realtime está indisponível. Delay maior que o do
  // dashboard p/ coalescer com o refresh do realtime quando ambos disparam.
  const refresh = useDebouncedRefresh(1500);

  // Larguras por coluna — chrome de UI por usuário/fonte (localStorage).
  const { widths, setWidth, widthStyle } = useColWidths(
    `registros:colWidths:${source}`
  );

  // Pan: segurar e arrastar em qualquer área da tabela rola nos dois eixos.
  // Controles interativos das linhas (EditableCell, botão Editar, links de
  // ordenação) e a alça de largura ([role=separator]) ficam de fora.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { panning, onPointerDown } = useDragPan(scrollRef, {
    ignore: (t) =>
      !!t.closest(
        "button, a, input, select, textarea, [contenteditable], [role=separator]"
      ),
    edgeAutoScroll: true,
  });

  if (records.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        Nenhum registro encontrado com os filtros atuais.
      </div>
    );
  }

  const orphanValue = (r: RecordRow, key: string): string => {
    const v = r.custom_fields?.[key];
    return v == null || String(v) === "" ? "—" : String(v);
  };

  return (
    <div
      ref={scrollRef}
      onPointerDown={onPointerDown}
      className={cn(
        "rounded-lg border overflow-x-auto",
        panning ? "cursor-grabbing" : "cursor-grab"
      )}
    >
      {/* O wrapper interno do Table NÃO pode rolar (overflow-x-visible): o
          scroller é o div acima — é nele que o pan escreve scrollLeft. */}
      <Table containerClassName="overflow-x-visible">
        <TableHeader>
          <TableRow>
            <SortHead
              colKey="title"
              label={coreRefLabel("title", coreDefs)}
              sort={sort}
              sortable
              style={widthStyle("title")}
              onResize={(w) => setWidth("title", w)}
            />
            {coreColumns.map((ref) => (
              <SortHead
                key={ref}
                colKey={ref}
                label={coreRefLabel(ref, coreDefs)}
                sort={sort}
                sortable={SORTABLE_CORE_REGISTROS.has(ref)}
                alignRight={isNumericCoreRef(ref)}
                style={widthStyle(ref)}
                onResize={(w) => setWidth(ref, w)}
              />
            ))}
            {fields.map((f) => (
              <SortHead
                key={f.id}
                colKey={`custom:${f.field_key}`}
                label={f.label}
                sort={sort}
                sortable
                style={widthStyle(`custom:${f.field_key}`)}
                onResize={(w) => setWidth(`custom:${f.field_key}`, w)}
              />
            ))}
            {orphanColumns.map((key) => (
              <SortHead
                key={`orphan:${key}`}
                colKey={`custom:${key}`}
                label={key}
                sort={sort}
                sortable={false}
                style={widthStyle(`custom:${key}`)}
                onResize={(w) => setWidth(`custom:${key}`, w)}
              />
            ))}
            <TableHead className="text-right">Editar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => (
            <TableRow key={r.id}>
              <TableCell
                style={widthStyle("title")}
                className={cn(
                  !widths["title"] && "max-w-[220px]",
                  "truncate font-medium"
                )}
              >
                {r.title ?? "—"}
              </TableCell>
              {coreColumns.map((ref) => (
                <TableCell
                  key={ref}
                  style={widthStyle(ref)}
                  className={cn(
                    "truncate",
                    isNumericCoreRef(ref) && "text-right"
                  )}
                >
                  {coreCellValue(r, ref, labels)}
                </TableCell>
              ))}
              {fields.map((f) => (
                <TableCell
                  key={f.id}
                  style={widthStyle(`custom:${f.field_key}`)}
                  className={cn(
                    !widths[`custom:${f.field_key}`] && "max-w-[180px]",
                    "overflow-hidden"
                  )}
                >
                  <EditableCell
                    record={r}
                    field={f}
                    userRoles={userRoles}
                    canEditValues={canEditValues}
                    forceSyncWriteBack
                    onSaved={refresh}
                  />
                </TableCell>
              ))}
              {orphanColumns.map((key) => (
                <TableCell
                  key={`orphan:${key}`}
                  style={widthStyle(`custom:${key}`)}
                  className={cn(
                    !widths[`custom:${key}`] && "max-w-[180px]",
                    "text-muted-foreground truncate"
                  )}
                >
                  {orphanValue(r, key)}
                </TableCell>
              ))}
              <TableCell className="text-right">
                <RecordEditSheet
                  record={r}
                  fields={fields}
                  detailFields={detailFields}
                  offBaseDefs={offBaseDefs}
                  coreDefs={coreDefs}
                  knownFieldKeys={knownFieldKeys}
                  responsibles={responsibles}
                  operations={operations}
                  relatedLeadLabel={
                    r.related_lead_id
                      ? relatedLeadLabels[r.related_lead_id] ?? null
                      : null
                  }
                  userRoles={userRoles}
                  canEditValues={canEditValues}
                  canManageFields={canManageFields}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
