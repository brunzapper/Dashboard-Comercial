// Versão: 1.0 | Data: 10/07/2026
// Fase 1: render de um widget de Tabela em modo "registros individuais". Uma
// linha por registro; colunas do núcleo ficam read-only e colunas personalizadas
// marcadas como editáveis usam a célula editável de Registros (grava no registro,
// respeitando permissões). Após gravar, router.refresh() recomputa o server.
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
import type { RecordListColumn } from "@/lib/widgets/types";

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

export function RecordListTable({
  records,
  columns,
  fields,
  available,
  userRoles,
  canEditValues,
  fkLabels,
}: {
  records: RecordRow[];
  columns: RecordListColumn[];
  fields: FieldDefinition[];
  available: AvailableField[];
  userRoles: string[];
  canEditValues: boolean;
  fkLabels: Record<string, string>;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const cols = columns.filter((c) => c.field);
  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));

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
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.field} className="whitespace-nowrap">
                {fieldLabel(c.field, available)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => (
            <TableRow key={r.id}>
              {cols.map((c) => {
                const isCustom = c.field.startsWith("custom:");
                const field = isCustom
                  ? fieldByKey.get(c.field.slice(7))
                  : undefined;
                return (
                  <TableCell key={c.field} className="max-w-[200px] align-top">
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
