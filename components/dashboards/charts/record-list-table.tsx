// Versão: 1.1 | Data: 10/07/2026
// Fase 1: render de um widget de Tabela em modo "registros individuais". Uma
// linha por registro; colunas do núcleo ficam read-only e colunas personalizadas
// marcadas como editáveis usam a célula editável de Registros (grava no registro,
// respeitando permissões). Após gravar, router.refresh() recomputa o server.
// v1.1 (Fase 10): aplica AppearanceSettings.table (cores, linhas de grade, ordem
// e ordenação de colunas).
"use client";

import { useRouter } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditableCell } from "@/components/registros/editable-cell";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import { orderedColumns } from "@/lib/widgets/appearance";
import type { AppearanceSettings, RecordListColumn } from "@/lib/widgets/types";

const FK_FIELDS = new Set(["responsible_id", "operation_id", "related_lead_id"]);
const MONEY_FIELDS = new Set(["value", "mrr"]);
const DATE_FIELDS = new Set(["closed_at", "opened_at", "source_created_at"]);

function money(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Valor formatado de uma coluna do núcleo (sempre read-only na Fase 1).
function coreDisplay(
  field: string,
  record: RecordRow,
  fkLabels: Record<string, string>
): string {
  const v = (record as unknown as Record<string, unknown>)[field];
  if (FK_FIELDS.has(field)) {
    return v ? (fkLabels[String(v)] ?? "—") : "—";
  }
  if (MONEY_FIELDS.has(field)) return money(v);
  if (field === "closed") return v ? "Sim" : "Não";
  if (DATE_FIELDS.has(field)) {
    return v ? String(v).slice(0, 10) : "—";
  }
  return v == null || v === "" ? "—" : String(v);
}

// Valor bruto de uma coluna (p/ ordenação): custom vem de custom_fields.
function rawValue(field: string, record: RecordRow): unknown {
  if (field.startsWith("custom:")) {
    return record.custom_fields?.[field.slice(7)];
  }
  return (record as unknown as Record<string, unknown>)[field];
}

export function RecordListTable({
  records,
  columns,
  fields,
  available,
  userRoles,
  canEditValues,
  fkLabels,
  appearance,
}: {
  records: RecordRow[];
  columns: RecordListColumn[];
  fields: FieldDefinition[];
  available: AvailableField[];
  userRoles: string[];
  canEditValues: boolean;
  fkLabels: Record<string, string>;
  appearance?: AppearanceSettings;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const baseCols = columns.filter((c) => c.field);
  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  const t = appearance?.table ?? {};

  // Ordem das colunas (reordenação) sobre os fields configurados.
  const cols = orderedColumns(
    baseCols.map((c) => c.field),
    t.columnOrder
  )
    .map((f) => baseCols.find((c) => c.field === f))
    .filter((c): c is RecordListColumn => Boolean(c));

  // Ordenação por coluna.
  let rows = records;
  if (t.sort?.column) {
    const { column, dir } = t.sort;
    rows = [...records].sort((a, b) => {
      const av = rawValue(column, a);
      const bv = rawValue(column, b);
      if (dir === "alpha" || dir === "color") {
        return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
      }
      const an = Number(av);
      const bn = Number(bv);
      const bothNum = !Number.isNaN(an) && !Number.isNaN(bn);
      const cmp = bothNum
        ? an - bn
        : String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
      return dir === "desc" ? -cmp : cmp;
    });
  }

  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const rowBorder = horizontal ? "" : "border-b-0";
  const cellBorder = (last: boolean) =>
    vertical && !last
      ? { borderRight: `1px solid ${t.borderColor ?? "var(--border)"}` }
      : {};

  if (cols.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhuma coluna configurada. Edite o widget e adicione colunas.
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhum registro para os filtros atuais.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader>
          <TableRow
            className={rowBorder}
            style={{
              background: t.headerBg,
              color: t.headerColor,
              ...(t.borderColor ? { borderColor: t.borderColor } : {}),
            }}
          >
            {cols.map((c, ci) => (
              <TableHead
                key={c.field}
                className="whitespace-nowrap"
                style={{
                  color: t.headerColor ?? t.columnColors?.[c.field],
                  ...cellBorder(ci === cols.length - 1),
                }}
              >
                {fieldLabel(c.field, available)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, ri) => (
            <TableRow
              key={r.id}
              className={rowBorder}
              style={{
                background: t.rowColors?.[ri] ?? t.bodyBg,
                color: t.bodyColor,
                ...(t.borderColor ? { borderColor: t.borderColor } : {}),
              }}
            >
              {cols.map((c, ci) => {
                const isCustom = c.field.startsWith("custom:");
                const field = isCustom
                  ? fieldByKey.get(c.field.slice(7))
                  : undefined;
                const cellColor =
                  t.cellColors?.[`${ri}:${c.field}`] ?? t.columnColors?.[c.field];
                return (
                  <TableCell
                    key={c.field}
                    className="max-w-[200px] align-top"
                    style={{
                      color: cellColor ?? t.bodyColor,
                      ...cellBorder(ci === cols.length - 1),
                    }}
                  >
                    {isCustom && field && c.editable ? (
                      <EditableCell
                        record={r}
                        field={field}
                        userRoles={userRoles}
                        canEditValues={canEditValues}
                        onSaved={refresh}
                      />
                    ) : isCustom ? (
                      <span className="block truncate">
                        {field && r.custom_fields?.[field.field_key] != null
                          ? String(r.custom_fields[field.field_key])
                          : "—"}
                      </span>
                    ) : (
                      <span className="block truncate">
                        {coreDisplay(c.field, r, fkLabels)}
                      </span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
