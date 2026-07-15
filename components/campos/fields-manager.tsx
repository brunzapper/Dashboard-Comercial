// Versão: 2.0 | Data: 10/07/2026
// Gerenciador de campos personalizados: busca + seções por fonte (Leads/Deals/
// Estudo de Fechamentos/Gerais) + tabela com toggle do olho (show_in_builder).
// v2.0 (10/07/2026): divisão por fonte (applies_to) e barra de pesquisa; o
//   toggle de exibir/ocultar (ícone do olho) já era inline e foi preservado.
"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import {
  DATA_TYPE_LABELS,
  NUMERIC_DATA_TYPES,
  type FieldDefinition,
} from "@/lib/records/types";
import {
  SOURCE_KEYS,
  SOURCE_LABELS,
  SOURCE_RECORD_TYPE,
  type SourceKey,
} from "@/lib/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { allDateOperands } from "@/lib/records/date-operands";
import { allCondOperands, COND_DATA_TYPES } from "@/lib/records/cond-operands";
import { aggOperandRefs } from "@/lib/widgets/calc-metrics";
import { deleteField, toggleShowInBuilder } from "@/app/(app)/campos/actions";
import { FieldForm } from "./field-form";
import type { RefOption } from "./formula-builder";

function roleLabels(keys: string[]): string {
  if (keys.length === 0) return "—";
  return keys.map((k) => ROLE_LABELS[k as RoleKey] ?? k).join(", ");
}

function SourceBadge({ field }: { field: FieldDefinition }) {
  if (field.source_system === "bitrix") return <Badge variant="outline">Bitrix</Badge>;
  if (field.is_local) return <Badge variant="secondary">Local</Badge>;
  return <Badge variant="secondary">App</Badge>;
}

// Seções na ordem exibida. "gerais" = campos sem applies_to (valem p/ todas as
// fontes: locais/app); as demais mapeiam para um record_type via applies_to.
type SectionKey = SourceKey | "gerais";

const SECTION_LABELS: Record<SectionKey, string> = {
  leads: SOURCE_LABELS.leads,
  deals: SOURCE_LABELS.deals,
  estudo: SOURCE_LABELS.estudo,
  gerais: "Gerais (todas as fontes)",
};

const SECTION_ORDER: SectionKey[] = [...SOURCE_KEYS, "gerais"];

function FieldRow({
  field,
  onEdit,
}: {
  field: FieldDefinition;
  onEdit: (f: FieldDefinition) => void;
}) {
  const shown = field.show_in_builder ?? true;
  return (
    <TableRow>
      <TableCell className="font-medium">{field.label}</TableCell>
      <TableCell>
        <code className="text-xs">{field.field_key}</code>
      </TableCell>
      <TableCell>{DATA_TYPE_LABELS[field.data_type]}</TableCell>
      <TableCell>
        <SourceBadge field={field} />
      </TableCell>
      <TableCell>
        <form action={toggleShowInBuilder}>
          <input type="hidden" name="id" value={field.id} />
          <input type="hidden" name="show_in_builder" value={String(!shown)} />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label={shown ? "Ocultar dos seletores" : "Exibir nos seletores"}
            title={shown ? "Exibido — clique para ocultar" : "Oculto — clique para exibir"}
          >
            {shown ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="text-muted-foreground size-4" />
            )}
          </Button>
        </form>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {roleLabels(field.visible_to_roles)}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(field)}
            aria-label="Editar"
          >
            <Pencil className="size-4" />
          </Button>
          <form action={deleteField}>
            <input type="hidden" name="id" value={field.id} />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label="Excluir"
            >
              <Trash2 className="size-4" />
            </Button>
          </form>
        </div>
      </TableCell>
    </TableRow>
  );
}

function FieldsSection({
  label,
  fields,
  onEdit,
}: {
  label: string;
  fields: FieldDefinition[];
  onEdit: (f: FieldDefinition) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Badge variant="secondary">{fields.length}</Badge>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rótulo</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Exibir</TableHead>
              <TableHead>Visível</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f) => (
              <FieldRow key={f.id} field={f} onEdit={onEdit} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function FieldsManager({
  fields,
  currencyOptions,
}: {
  fields: FieldDefinition[];
  currencyOptions?: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinition | undefined>(undefined);
  const [query, setQuery] = useState("");

  // Operandos do construtor de fórmula: colunas numéricas (núcleo + custom não
  // calculado) e operandos de DATA (datas do próprio registro, custom `data` e
  // datas do registro casado, match:<fonte>:<data>). Agrupados para o seletor.
  const customDateFields = fields
    .filter((f) => f.data_type === "data")
    .map((f) => ({ field_key: f.field_key, label: f.label }));
  const numericRefs: RefOption[] = [
    ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
      ref: f.field,
      label: f.label,
      group: "Números",
    })),
    ...fields
      .filter(
        (f) => NUMERIC_DATA_TYPES.includes(f.data_type) && f.data_type !== "calculado"
      )
      .map((f) => ({ ref: `custom:${f.field_key}`, label: f.label, group: "Números" })),
    ...allDateOperands(customDateFields),
  ];
  // Catálogo completo p/ o editor de TEXTO (SE/E/OU): números + datas + colunas
  // de texto/seleção/booleano (próprias e do registro casado).
  const customCondFields = fields
    .filter((f) => COND_DATA_TYPES.includes(f.data_type))
    .map((f) => ({ field_key: f.field_key, label: f.label }));
  const allRefs: RefOption[] = [
    ...numericRefs,
    ...allCondOperands(customCondFields),
  ];
  // Operandos de AGREGAÇÃO p/ o tipo "Calculado (totais)": Σ/Média/Contagem das
  // colunas numéricas (núcleo + custom, incluindo 'calculado' por-registro, que
  // é materializado; excluindo 'calculado_agg' — sem aninhamento). Mesmos
  // critérios do servidor (aggOperandCatalog em campos/actions.ts).
  const aggRefs: RefOption[] = aggOperandRefs(
    [
      ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
        field: f.field,
        label: f.label,
      })),
      ...fields
        .filter((f) => NUMERIC_DATA_TYPES.includes(f.data_type))
        .map((f) => ({ field: `custom:${f.field_key}`, label: f.label })),
    ],
    // Contáveis ("registros com o campo preenchido"): datas/numéricos do núcleo
    // (podem ser nulos; os de texto sempre-preenchidos = count(*), viram ruído)
    // + qualquer campo custom, exceto 'calculado_agg' (sem aninhar agregado).
    [
      ...CORE_FIELDS.filter((f) => f.isNumeric || f.isDate).map((f) => ({
        field: f.field,
        label: f.label,
      })),
      ...fields
        .filter((f) => f.data_type !== "calculado_agg")
        .map((f) => ({ field: `custom:${f.field_key}`, label: f.label })),
    ]
  );

  // Filtra por rótulo/chave e agrupa por fonte (applies_to). Um campo pode
  // aparecer em mais de uma seção quando applies_to inclui vários record_types
  // (ex.: utm_* valem para lead e negócio). applies_to vazio = "Gerais".
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? fields.filter(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            f.field_key.toLowerCase().includes(q)
        )
      : fields;

    const bySection: Record<SectionKey, FieldDefinition[]> = {
      leads: [],
      deals: [],
      estudo: [],
      gerais: [],
    };
    for (const f of filtered) {
      const appliesTo = f.applies_to ?? [];
      if (appliesTo.length === 0) {
        bySection.gerais.push(f);
        continue;
      }
      for (const key of SOURCE_KEYS) {
        if (appliesTo.includes(SOURCE_RECORD_TYPE[key])) bySection[key].push(f);
      }
    }
    return bySection;
  }, [fields, query]);

  const total = SECTION_ORDER.reduce((n, key) => n + sections[key].length, 0);

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(f: FieldDefinition) {
    setEditing(f);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campo por rótulo ou chave..."
            className="pl-8"
            aria-label="Buscar campo"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Novo campo
        </Button>
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          {query
            ? "Nenhum campo corresponde à busca."
            : "Nenhum campo personalizado ainda. Crie o primeiro."}
        </p>
      ) : (
        SECTION_ORDER.map((key) => (
          <FieldsSection
            key={key}
            label={SECTION_LABELS[key]}
            fields={sections[key]}
            onEdit={openEdit}
          />
        ))
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar campo" : "Novo campo"}</SheetTitle>
            <SheetDescription>
              Campos aparecem na edição de registros e nos seletores conforme a
              visibilidade por papel e o toggle &quot;Exibir&quot;.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FieldForm
              key={editing?.id ?? "new"}
              field={editing}
              numericRefs={numericRefs}
              allRefs={allRefs}
              aggRefs={aggRefs}
              currencyOptions={currencyOptions}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
