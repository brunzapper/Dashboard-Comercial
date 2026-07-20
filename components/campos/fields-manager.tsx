// Versão: 2.3 | Data: 20/07/2026
// v2.3 (20/07/2026): catálogo agregado via builder ÚNICO (lib/widgets/
//   agg-catalog.defsAggCatalogInput) — montagem idêntica, sem cópia local.
// Gerenciador de campos personalizados: busca + ABAS por fonte (Leads/Deals/
// Estudo de Fechamentos/Gerais) + tabela com toggle do olho (show_in_builder).
// v2.2 (19/07/2026): aninhamento de campos calculados — numericRefs inclui os
//   'calculado' e aggRefs inclui os 'calculado_agg' (aggNestedOperandRefs);
//   excludeKeys (o campo em edição + dependentes transitivos) sai daqui para o
//   FieldForm filtrar os operandos que criariam ciclo. Excluir campo passa a
//   exibir a mensagem da guarda de referência (useActionState).
// v2.1 (16/07/2026): seções empilhadas viraram abas (mesma receita visual das
//   abas de Registros, estado client — os dados já estão todos aqui). Cada aba
//   mostra o contador da fonte, que reage à busca; aba vazia ganha mensagem
//   (antes a seção vazia sumia).
// v2.0 (10/07/2026): divisão por fonte (applies_to) e barra de pesquisa; o
//   toggle de exibir/ocultar (ícone do olho) já era inline e foi preservado.
"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
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
import { cn } from "@/lib/utils";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { DATA_TYPE_LABELS, type FieldDefinition } from "@/lib/records/types";
import { toRecordType } from "@/lib/sources";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { decorateRefOptions, sourceChips } from "@/lib/widgets/filter-ops";
import { useSourceLabels } from "@/components/source-labels-context";
import { useSources } from "@/components/sources-context";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import {
  buildAggOperandCatalog,
  defsAggCatalogInput,
} from "@/lib/widgets/agg-catalog";
import { deleteField, toggleShowInBuilder } from "@/app/(app)/campos/actions";
import { FieldForm } from "./field-form";
import type { RefOption } from "@/lib/records/date-operands";

function roleLabels(keys: string[]): string {
  if (keys.length === 0) return "—";
  return keys.map((k) => ROLE_LABELS[k as RoleKey] ?? k).join(", ");
}

function SourceBadge({ field }: { field: FieldDefinition }) {
  if (field.source_system === "bitrix") return <Badge variant="outline">Bitrix</Badge>;
  if (field.is_local) return <Badge variant="secondary">Local</Badge>;
  return <Badge variant="secondary">App</Badge>;
}

// Seções na ordem exibida (catálogo dinâmico + "gerais" ao final). "gerais" =
// campos sem applies_to (valem p/ todas as fontes: locais/app); as demais
// mapeiam para um record_type via applies_to.
const GERAIS_SECTION = "gerais";
const GERAIS_LABEL = "Gerais (todas as fontes)";

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
          {/* Confirmação (20/07/2026) + guarda de referência do servidor (campo
              usado em fórmula não pode ser excluído — a mensagem aparece na
              própria linha, via ConfirmDeleteButton). */}
          <ConfirmDeleteButton
            action={deleteField}
            values={{ id: field.id }}
            title={`Excluir o campo "${field.label}"?`}
            description="O campo some de todos os widgets e os valores já gravados nos registros deixam de ser exibidos. Esta ação não pode ser desfeita."
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function FieldsSection({
  fields,
  onEdit,
  emptyMessage,
}: {
  fields: FieldDefinition[];
  onEdit: (f: FieldDefinition) => void;
  emptyMessage: string;
}) {
  // A aba identifica a fonte (rótulo + contador), então a seção é só a tabela;
  // vazia, mostra mensagem (a aba selecionada não pode ficar em branco).
  if (fields.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
        {emptyMessage}
      </p>
    );
  }
  return (
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
  // Aba (fonte) ativa. A busca NÃO troca a aba: os contadores nas abas mostram
  // onde estão os resultados e o usuário navega sem perder o contexto.
  const [tab, setTab] = useState<string>("leads");

  // Catálogo de campos + rótulos de fonte SÓ p/ decorar os operandos de fórmula
  // (fonte curta/chips/tooltip nos seletores — decorateRefOptions não toca nos
  // labels, que fazem o round-trip texto⇄tokens e a validação do servidor).
  const sourceLabels = useSourceLabels();
  const fieldSourceChips = sourceChips(sourceLabels);
  const catalog = useSources();
  // Memoizado: a digitação na busca re-renderiza o manager inteiro.
  const availableForHints = useMemo(
    () => buildAvailableFields(fields, [], catalog),
    [fields, catalog]
  );
  const decorate = (refs: RefOption[]): RefOption[] =>
    decorateRefOptions(refs, availableForHints, sourceLabels);

  // Operandos por-registro: catálogo ÚNICO compartilhado com o FieldForm inline
  // do widget-builder e com a validação do servidor (perRecordCalcOperands em
  // lib/records/calc-operands.ts) — números (núcleo + custom + CASADOS), datas
  // (próprias + casadas + hoje) e, no texto, condicionais. A decoração
  // (fonte/chips/tooltip) é local e não toca nos labels.
  const perRecordOps = useMemo(
    () => perRecordCalcOperands(fields, catalog, editing?.field_key),
    [fields, catalog, editing]
  );
  const numericRefs: RefOption[] = decorate(perRecordOps.numericRefs);
  const allRefs: RefOption[] = decorate(perRecordOps.allRefs);
  // Operandos de AGREGAÇÃO p/ o tipo "Calculado (totais do recorte)": builder
  // ÚNICO (lib/widgets/agg-catalog.ts) — mesma montagem do servidor e dos
  // demais editores por construção. Sem forbidden aqui: o FieldForm filtra
  // pelo excludeKeys (o servidor filtra no save). A decoração (fonte/chips/
  // tooltip) é local e não toca nos labels (load-bearing).
  const aggRefs: RefOption[] = decorate(
    buildAggOperandCatalog(defsAggCatalogInput(fields, catalog))
  );
  // Operandos PROIBIDOS na fórmula do campo em edição: ele próprio + quem já
  // depende dele (referenciar criaria ciclo — mesma regra do servidor). Sai do
  // catálogo compartilhado (perRecordCalcOperands).
  const excludeKeys = perRecordOps.excludeKeys;

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

    const bySection: Record<string, FieldDefinition[]> = {
      [GERAIS_SECTION]: [],
    };
    for (const s of catalog) bySection[s.key] = [];
    for (const f of filtered) {
      const appliesTo = f.applies_to ?? [];
      if (appliesTo.length === 0) {
        bySection[GERAIS_SECTION].push(f);
        continue;
      }
      for (const s of catalog) {
        if (appliesTo.includes(toRecordType(s.key))) bySection[s.key].push(f);
      }
    }
    return bySection;
  }, [fields, query, catalog]);

  const sectionOrder: { key: string; label: string }[] = [
    ...catalog.map((s) => ({ key: s.key, label: s.label })),
    { key: GERAIS_SECTION, label: GERAIS_LABEL },
  ];
  // Aba efetiva: se a fonte da aba salva sumiu do catálogo, cai na primeira.
  const activeTab = sectionOrder.some((s) => s.key === tab)
    ? tab
    : (sectionOrder[0]?.key ?? GERAIS_SECTION);
  const total = sectionOrder.reduce(
    (n, s) => n + (sections[s.key]?.length ?? 0),
    0
  );

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
        <>
          {/* Abas por fonte (mesma receita visual das abas de Registros),
              dirigidas pelo CATÁLOGO dinâmico (data_sources) + "Gerais". */}
          <div className="flex flex-wrap gap-1 border-b">
            {sectionOrder.map((s) => {
              const active = s.key === activeTab;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setTab(s.key)}
                  className={cn(
                    "-mb-px flex items-center gap-2 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "text-muted-foreground border-transparent hover:text-foreground"
                  )}
                >
                  {s.label}
                  <Badge variant="secondary">
                    {sections[s.key]?.length ?? 0}
                  </Badge>
                </button>
              );
            })}
          </div>
          <FieldsSection
            fields={sections[activeTab] ?? []}
            onEdit={openEdit}
            emptyMessage={
              query
                ? "Nenhum campo corresponde à busca nesta fonte."
                : "Nenhum campo nesta fonte."
            }
          />
        </>
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
              excludeKeys={excludeKeys}
              fieldChips={fieldSourceChips}
              sources={catalog}
              currencyOptions={currencyOptions}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
