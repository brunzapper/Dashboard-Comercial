// Versão: 1.1 | Data: 16/07/2026
// v1.1 (16/07/2026): fontes criadas inline nascem com manual_entry (0061).
// Wizard de import de CSV (Registros → Importar CSV, admin):
//   1 Upload (papaparse no browser — evita multipart/limite de body; os dados
//     sobem em chunks JSON de ~300 linhas para Server Actions)
//   2 Fonte alvo (existente ou criada inline via createSource)
//   3 Mapeamento de colunas (core whitelisted / campo existente / campo novo /
//     responsável por nome / ignorar; tipo inferido das amostras)
//   4 Chave de deduplicação (colunas que identificam a linha; vazio = hash da
//     linha inteira — re-importar o mesmo arquivo atualiza, linha editada na
//     origem vira registro novo)
//   5 Revisão → importa em chunks (idempotente; re-executar cura aborto) →
//     relatório (inseridos/atualizados/ignorados/erros).
// Edições manuais feitas no app são preservadas em re-imports (conflito por
// campo, lib/import/ingest.ts).
"use client";

import { useState } from "react";
import Papa from "papaparse";
import { ArrowLeft, ArrowRight, FileUp, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { slugify } from "@/lib/records/slug";
import { type SourceDef } from "@/lib/sources";
import {
  CORE_IMPORT_TARGETS,
  inferDataType,
  suggestTarget,
  type ColumnMapping,
} from "@/lib/import/csv";
import type { SyncResult } from "@/lib/sync/shared";
import { createSource } from "@/app/(app)/configuracoes/fontes/actions";
import {
  finalizeCsvImport,
  importCsvChunk,
  prepareImportFields,
  type PrepareFieldSpec,
} from "@/app/(app)/registros/importar/actions";

const CHUNK_SIZE = 300;

export interface ImportFieldOption {
  key: string;
  label: string;
  dataType: string;
  appliesTo: string[];
}

interface ColumnPlan {
  csvColumn: string;
  slug: string;
  inferred: "texto" | "numero" | "data";
  samples: string[];
  target: string; // "ignore" | "responsible" | "core:*" | "custom:*" | "new"
  newLabel: string;
  newType: string;
}

interface Report {
  result: SyncResult;
  finalized: boolean;
}

type Step = "upload" | "fonte" | "mapeamento" | "dedup" | "revisao";

const STEP_LABELS: Record<Step, string> = {
  upload: "1. Arquivo",
  fonte: "2. Fonte",
  mapeamento: "3. Mapeamento",
  dedup: "4. Deduplicação",
  revisao: "5. Revisão",
};

const NEW_FIELD_TYPES: ComboboxOption[] = [
  { value: "texto", label: "Texto" },
  { value: "numero", label: "Número" },
  { value: "data", label: "Data" },
];

const PERIOD_FIELD_OPTIONS: ComboboxOption[] = [
  { value: "source_created_at", label: "Data de criação (origem)" },
  { value: "closed_at", label: "Data de fechamento" },
  { value: "opened_at", label: "Data de abertura" },
];

export function ImportWizard({
  sources: initialSources,
  fields,
}: {
  sources: SourceDef[];
  fields: ImportFieldOption[];
}) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [plans, setPlans] = useState<ColumnPlan[]>([]);
  const [parseError, setParseError] = useState("");

  const [sources, setSources] = useState<SourceDef[]>(initialSources);
  const [sourceKey, setSourceKey] = useState("");
  const [creatingSource, setCreatingSource] = useState(false);
  const [newSourceLabel, setNewSourceLabel] = useState("");
  const [newSourcePeriod, setNewSourcePeriod] = useState("source_created_at");
  const [sourceMessage, setSourceMessage] = useState("");

  const [dedupColumns, setDedupColumns] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runError, setRunError] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  const source = sources.find((s) => s.key === sourceKey) ?? null;

  // ============ Passo 1: upload ============

  function handleFile(file: File | undefined) {
    if (!file) return;
    setParseError("");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const cols = (res.meta.fields ?? []).filter((h) => h.trim() !== "");
        const data = res.data;
        if (cols.length === 0 || data.length === 0) {
          setParseError("CSV vazio ou sem linha de cabeçalho.");
          return;
        }
        setFileName(file.name);
        setHeaders(cols);
        setRows(data);
        setPlans(
          cols.map((h) => {
            const slug = slugify(h);
            const samples = data
              .slice(0, 100)
              .map((r) => r[h] ?? "")
              .filter((v) => v.trim() !== "");
            const inferred = inferDataType(samples);
            const existing = fields.find((f) => f.key === slug);
            const target =
              suggestTarget(slug) ?? (existing ? `custom:${slug}` : "new");
            return {
              csvColumn: h,
              slug,
              inferred,
              samples: samples.slice(0, 3),
              target,
              newLabel: h.trim(),
              newType: inferred,
            };
          })
        );
        setStep("fonte");
      },
      error: (err: Error) => setParseError(`Falha ao ler o CSV: ${err.message}`),
    });
  }

  // ============ Passo 2: fonte ============

  async function handleCreateSource() {
    setSourceMessage("");
    const fd = new FormData();
    fd.set("label", newSourceLabel);
    fd.set("short_label", "");
    fd.set("default_period_field", newSourcePeriod);
    // Fontes novas nascem aceitando criação manual (0061) — mesmo default da
    // tela de Fontes; o admin desliga lá se a fonte for só de import/API.
    fd.set("manual_entry", "1");
    const state = await createSource({}, fd);
    if (!state.ok || !state.key) {
      setSourceMessage(state.message ?? "Falha ao criar a fonte.");
      return;
    }
    const created: SourceDef = {
      key: state.key,
      recordType: state.key,
      label: newSourceLabel.trim(),
      shortLabel: newSourceLabel.trim(),
      defaultPeriodField: newSourcePeriod,
      builtin: false,
      manualEntry: true,
    };
    setSources((prev) => [...prev, created]);
    setSourceKey(state.key);
    setCreatingSource(false);
    setSourceMessage(state.message ?? "");
  }

  // ============ Passo 3: mapeamento ============

  function targetOptions(plan: ColumnPlan): ComboboxOption[] {
    const rt = source?.recordType ?? "";
    const applicable = fields.filter(
      (f) => f.appliesTo.length === 0 || f.appliesTo.includes(rt)
    );
    return [
      { value: "new", label: "Criar campo novo", group: "Ações" },
      { value: "ignore", label: "Ignorar coluna", group: "Ações" },
      { value: "responsible", label: "Responsável (por nome)", group: "Ações" },
      ...CORE_IMPORT_TARGETS.map((t) => ({
        value: t.value,
        label: t.label,
        group: "Colunas do sistema",
      })),
      ...applicable.map((f) => ({
        value: `custom:${f.key}`,
        label: f.label,
        group: "Campos existentes",
      })),
      // A sugestão automática pode apontar p/ um campo de outra fonte; mantém a
      // opção visível para não quebrar o valor selecionado.
      ...(plan.target.startsWith("custom:") &&
      !applicable.some((f) => `custom:${f.key}` === plan.target)
        ? fields
            .filter((f) => `custom:${f.key}` === plan.target)
            .map((f) => ({
              value: `custom:${f.key}`,
              label: f.label,
              group: "Campos de outras fontes",
            }))
        : []),
    ];
  }

  function updatePlan(csvColumn: string, patch: Partial<ColumnPlan>) {
    setPlans((prev) =>
      prev.map((p) => (p.csvColumn === csvColumn ? { ...p, ...patch } : p))
    );
  }

  const mappedPlans = plans.filter((p) => p.target !== "ignore");
  const duplicateTargets = (() => {
    const seen = new Map<string, number>();
    for (const p of mappedPlans) {
      const key =
        p.target === "new" ? `new:${slugify(p.newLabel)}` : p.target;
      if (key === "responsible") continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  })();

  const mappingValid =
    mappedPlans.length > 0 &&
    duplicateTargets.length === 0 &&
    mappedPlans.every(
      (p) => p.target !== "new" || slugify(p.newLabel).length > 0
    );

  // ============ Passo 5: revisão + execução ============

  const periodField = source?.defaultPeriodField ?? "source_created_at";
  const hasPeriodDate = plans.some((p) => p.target === `core:${periodField}`);

  async function runImport() {
    if (!source) return;
    setBusy(true);
    setRunError("");
    setReport(null);
    try {
      // 1) Campos: cria os novos / garante applies_to nos existentes.
      const specs: PrepareFieldSpec[] = [];
      for (const p of mappedPlans) {
        if (p.target === "new") {
          specs.push({
            csvColumn: p.csvColumn,
            create: { label: p.newLabel, dataType: p.newType },
          });
        } else if (p.target.startsWith("custom:")) {
          specs.push({
            csvColumn: p.csvColumn,
            fieldKey: p.target.slice("custom:".length),
          });
        }
      }
      const prep = await prepareImportFields(source.key, specs);
      if (!prep.ok || !prep.fieldKeys) {
        setRunError(prep.message ?? "Falha ao preparar os campos.");
        return;
      }

      // 2) Mapeamento final (tipo do campo destino p/ coerção).
      const mapping: ColumnMapping[] = mappedPlans.map((p) => {
        if (p.target === "new") {
          return {
            csvColumn: p.csvColumn,
            target: `custom:${prep.fieldKeys![p.csvColumn]}`,
            dataType: p.newType,
          };
        }
        if (p.target.startsWith("custom:")) {
          const key = p.target.slice("custom:".length);
          return {
            csvColumn: p.csvColumn,
            target: p.target,
            dataType: fields.find((f) => f.key === key)?.dataType ?? "texto",
          };
        }
        return { csvColumn: p.csvColumn, target: p.target };
      });

      // 3) Chunks sequenciais (idempotente — re-rodar cura falha no meio).
      const total = rows.length;
      setProgress({ done: 0, total });
      const acc: SyncResult = {
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        byEntity: {},
        errorSamples: [],
      };
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const res = await importCsvChunk({
          sourceKey: source.key,
          mapping,
          dedupColumns,
          rows: chunk,
        });
        if (!res.ok || !res.result) {
          setRunError(
            `${res.message ?? "Falha no import."} As linhas já importadas foram mantidas — importar de novo continua de onde parou.`
          );
          return;
        }
        acc.inserted += res.result.inserted;
        acc.updated += res.result.updated;
        acc.skipped += res.result.skipped;
        acc.errors += res.result.errors;
        for (const s of res.result.errorSamples) {
          if (acc.errorSamples.length < 10) acc.errorSamples.push(s);
        }
        setProgress({ done: Math.min(i + CHUNK_SIZE, total), total });
      }

      // 4) Auto-match + recálculo, uma vez só.
      const fin = await finalizeCsvImport();
      setReport({ result: acc, finalized: fin.ok });
    } finally {
      setBusy(false);
    }
  }

  // ============ Render ============

  const stepOrder: Step[] = ["upload", "fonte", "mapeamento", "dedup", "revisao"];

  return (
    <div className="flex flex-col gap-6">
      <ol className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {stepOrder.map((s) => (
          <li key={s} className={s === step ? "text-foreground font-medium" : ""}>
            {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <div className="flex max-w-xl flex-col gap-4">
          <Label htmlFor="csv-file" className="sr-only">
            Arquivo CSV
          </Label>
          <label
            htmlFor="csv-file"
            className="hover:bg-muted/50 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center"
          >
            <FileUp className="text-muted-foreground size-8" />
            <span className="text-sm font-medium">
              Escolha um arquivo .csv com linha de cabeçalho
            </span>
            <span className="text-muted-foreground text-xs">
              Números e datas em pt-BR são aceitos (1.234,56 · dd/mm/aaaa).
            </span>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          {parseError ? (
            <p className="text-destructive text-sm" role="status">
              {parseError}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "fonte" ? (
        <div className="flex max-w-xl flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            {fileName}: {rows.length} linha(s), {headers.length} coluna(s).
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Importar para a fonte</Label>
            <Combobox
              options={sources.map((s) => ({ value: s.key, label: s.label }))}
              value={sourceKey}
              onValueChange={(v) => {
                setSourceKey(v);
                setCreatingSource(false);
              }}
              placeholder="Escolha a fonte"
              aria-label="Fonte alvo do import"
            />
          </div>
          {!creatingSource ? (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => setCreatingSource(true)}
            >
              Criar fonte nova
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-source-label">Nome da fonte nova</Label>
                <Input
                  id="new-source-label"
                  value={newSourceLabel}
                  onChange={(e) => setNewSourceLabel(e.target.value)}
                  placeholder="Ex.: Propostas"
                  maxLength={60}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Campo de data do filtro de período</Label>
                <Combobox
                  options={PERIOD_FIELD_OPTIONS}
                  value={newSourcePeriod}
                  onValueChange={setNewSourcePeriod}
                  searchable={false}
                  aria-label="Campo de data do filtro de período"
                />
              </div>
              <Button
                type="button"
                className="w-fit"
                disabled={newSourceLabel.trim().length < 2}
                onClick={handleCreateSource}
              >
                Criar fonte
              </Button>
            </div>
          )}
          {sourceMessage ? (
            <p className="text-muted-foreground text-sm" role="status">
              {sourceMessage}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
            <Button disabled={!source} onClick={() => setStep("mapeamento")}>
              Continuar
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {step === "mapeamento" && source ? (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Diga para onde vai cada coluna do CSV em{" "}
            <span className="font-medium">{source.label}</span>. Campos novos
            são criados na fonte; campos existentes têm a fonte adicionada.
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Coluna do CSV</TableHead>
                  <TableHead>Amostra</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Campo novo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.csvColumn}>
                    <TableCell className="font-medium">{p.csvColumn}</TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate text-xs">
                      {p.samples.join(" · ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Combobox
                        options={targetOptions(p)}
                        value={p.target}
                        onValueChange={(v) => updatePlan(p.csvColumn, { target: v })}
                        aria-label={`Destino de ${p.csvColumn}`}
                        className="w-56"
                      />
                    </TableCell>
                    <TableCell>
                      {p.target === "new" ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={p.newLabel}
                            onChange={(e) =>
                              updatePlan(p.csvColumn, { newLabel: e.target.value })
                            }
                            maxLength={60}
                            aria-label={`Nome do campo novo de ${p.csvColumn}`}
                            className="w-44"
                          />
                          <Combobox
                            options={NEW_FIELD_TYPES}
                            value={p.newType}
                            onValueChange={(v) =>
                              updatePlan(p.csvColumn, { newType: v })
                            }
                            searchable={false}
                            aria-label={`Tipo do campo novo de ${p.csvColumn}`}
                            className="w-28"
                          />
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {duplicateTargets.length > 0 ? (
            <p className="text-destructive text-sm" role="status">
              Duas colunas apontam para o mesmo destino: revise o mapeamento.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("fonte")}>
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
            <Button disabled={!mappingValid} onClick={() => setStep("dedup")}>
              Continuar
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {step === "dedup" ? (
        <div className="flex max-w-xl flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Escolha a(s) coluna(s) que identificam cada linha (ex.: e-mail, ID
            do negócio). Re-importar o arquivo atualiza as linhas com a mesma
            chave em vez de duplicá-las — e edições feitas no app são
            preservadas.
          </p>
          <div className="flex flex-col gap-2">
            {mappedPlans.map((p) => (
              <label key={p.csvColumn} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={dedupColumns.includes(p.csvColumn)}
                  onCheckedChange={(checked) =>
                    setDedupColumns((prev) =>
                      checked === true
                        ? [...prev, p.csvColumn]
                        : prev.filter((c) => c !== p.csvColumn)
                    )
                  }
                  aria-label={`Usar ${p.csvColumn} na chave`}
                />
                {p.csvColumn}
              </label>
            ))}
          </div>
          {dedupColumns.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Sem colunas marcadas, a chave é a linha inteira: re-importar o
              mesmo arquivo não duplica, mas uma linha alterada na planilha
              entra como registro novo.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("mapeamento")}>
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
            <Button onClick={() => setStep("revisao")}>
              Continuar
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {step === "revisao" && source ? (
        <div className="flex max-w-xl flex-col gap-4">
          <div className="rounded-lg border p-4 text-sm">
            <p>
              <span className="font-medium">{rows.length}</span> linha(s) de{" "}
              <span className="font-medium">{fileName}</span> →{" "}
              <span className="font-medium">{source.label}</span>
            </p>
            <p className="text-muted-foreground mt-1">
              {mappedPlans.length} coluna(s) mapeada(s) ·{" "}
              {plans.length - mappedPlans.length} ignorada(s) · chave:{" "}
              {dedupColumns.length > 0 ? dedupColumns.join(" + ") : "linha inteira"}
            </p>
          </div>
          {!hasPeriodDate ? (
            <p className="text-sm text-amber-600" role="status">
              Nenhuma coluna mapeia para “{periodField}”, o campo de data que o
              filtro de período desta fonte usa — com um período ativo no
              dashboard, estes registros ficariam de fora. Mapeie uma coluna de
              data para ele (ou ajuste o campo de período da fonte em
              Configurações → Fontes).
            </p>
          ) : null}
          {busy || report || runError ? (
            <div className="flex flex-col gap-2">
              {progress.total > 0 ? (
                <>
                  <div className="bg-muted h-2 w-full overflow-hidden rounded">
                    <div
                      className="bg-primary h-full transition-all"
                      style={{
                        width: `${Math.round((progress.done / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {progress.done}/{progress.total} linha(s) enviada(s)
                  </p>
                </>
              ) : null}
              {runError ? (
                <p className="text-destructive text-sm" role="status">
                  {runError}
                </p>
              ) : null}
              {report ? (
                <div className="rounded-lg border p-4 text-sm" role="status">
                  <p className="font-medium">Import concluído</p>
                  <p className="text-muted-foreground mt-1">
                    {report.result.inserted} inserido(s) ·{" "}
                    {report.result.updated} atualizado(s) ·{" "}
                    {report.result.skipped} ignorado(s) ·{" "}
                    {report.result.errors} erro(s)
                  </p>
                  {report.result.errorSamples.length > 0 ? (
                    <ul className="text-destructive mt-2 list-disc pl-5 text-xs">
                      {report.result.errorSamples.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!report.finalized ? (
                    <p className="text-muted-foreground mt-2 text-xs">
                      Auto-match/recálculo não rodaram — rode “auto-match” em
                      Campos → Conexões se precisar.
                    </p>
                  ) : null}
                  <Button asChild className="mt-3">
                    <a href={`/registros?fonte=${source.key}`}>Ver registros</a>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStep("dedup")}
            >
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
            <Button disabled={busy || Boolean(report)} onClick={runImport}>
              <Upload className="size-4" />
              {busy
                ? "Importando…"
                : runError
                  ? "Importar novamente"
                  : `Importar ${rows.length} linha(s)`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
