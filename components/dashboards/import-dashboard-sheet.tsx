// Versão: 1.0 | Data: 22/07/2026
// Botão "Importar" da Home (ao lado do "Criar"): modo de criação de dashboard
// via JSON gerado por IA. Fluxo no Sheet (padrão do projeto — não há Dialog):
// resumo dos passos → seleção da Base (obrigatória) → copiar o prompt de
// instruções (2 variantes: compacto p/ IAs mais capazes; completo anexa o
// manual de construção inteiro) → colar o JSON devolvido → importar
// (importDashboardJson) e navegar ao dashboard. Erros do validador são
// exibidos na íntegra — o usuário os devolve à IA para corrigir o JSON.
// Cópia: navigator.clipboard.writeText (padrão snapshots-panel) com fallback
// de textarea visível quando o navegador negar a escrita fora do gesto.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { SourceDef } from "@/lib/sources";
import {
  buildImportPrompt,
  type ImportPromptVariant,
} from "@/app/(app)/dashboards/import-prompt-actions";
import {
  importDashboardJson,
  type ImportDashboardState,
} from "@/app/(app)/dashboards/actions";

const STEPS = [
  "Importe/sincronize a Base principal (Registros → Importar CSV), se ainda não existir.",
  "Selecione abaixo a Base que o dashboard vai usar.",
  "Copie o prompt de instruções (o modelo da Base e uma amostra de dados vão junto).",
  "Cole o prompt na IA de sua preferência e descreva o dashboard que você quer.",
  "Cole aqui o JSON que a IA devolver.",
  "Importe: o dashboard é criado com abas, widgets, campos e sub-bases necessárias.",
];

export function ImportDashboardSheet({ sources }: { sources: SourceDef[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState("");
  const [copied, setCopied] = useState<ImportPromptVariant | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [result, setResult] = useState<ImportDashboardState | null>(null);
  const [copyPending, startCopy] = useTransition();
  const [importPending, startImport] = useTransition();

  const rootOptions = sources
    .filter((s) => !s.parentKey)
    .map((s) => ({ value: s.key, label: s.label }));

  function copyPrompt(variant: ImportPromptVariant) {
    if (!base) return;
    setCopyError(null);
    setManualPrompt(null);
    startCopy(async () => {
      const res = await buildImportPrompt(base, variant);
      if (!res.ok || !res.prompt) {
        setCopyError(res.message ?? "Não foi possível montar o prompt.");
        return;
      }
      try {
        await navigator.clipboard.writeText(res.prompt);
        setCopied(variant);
        window.setTimeout(() => setCopied(null), 2000);
        if (res.message) setCopyError(res.message); // aviso não-fatal (anexo)
      } catch {
        // Navegador negou a escrita fora do gesto: oferece cópia manual.
        setManualPrompt(res.prompt);
      }
    });
  }

  function runImport() {
    setResult(null);
    startImport(async () => {
      const res = await importDashboardJson(json);
      setResult(res);
      if (res.ok && res.id) {
        setOpen(false);
        router.push(`/dashboards/${res.id}`);
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" />
        Importar
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Importar dashboard (JSON gerado por IA)</SheetTitle>
            <SheetDescription>
              Uma IA externa gera um JSON a partir do manual copiado; a
              importação cria o dashboard completo — reimportar a mesma chave
              atualiza em vez de duplicar.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-6">
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>

            <div className="flex flex-col gap-2">
              <Label>Base principal</Label>
              <Combobox
                options={rootOptions}
                value={base}
                onValueChange={setBase}
                placeholder="Selecione a Base…"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Prompt de instruções</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!base || copyPending}
                  onClick={() => copyPrompt("compacto")}
                >
                  {copied === "compacto" ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied === "compacto" ? "Copiado!" : "Copiar prompt (compacto)"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!base || copyPending}
                  onClick={() => copyPrompt("completo")}
                >
                  {copied === "completo" ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied === "completo"
                    ? "Copiado!"
                    : "Copiar prompt (completo, com manual)"}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Compacto: especificação do JSON + modelo da Base + amostra —
                para IAs mais capazes. Completo: anexa também o manual de
                construção inteiro — para IAs menos capazes (prompt bem maior).
              </p>
              {copyPending ? (
                <p className="text-muted-foreground text-sm" role="status">
                  Montando o prompt (modelo da Base + amostra de dados)…
                </p>
              ) : null}
              {copyError ? (
                <p className="text-destructive text-sm" role="status">
                  {copyError}
                </p>
              ) : null}
              {manualPrompt ? (
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-xs">
                    Seu navegador bloqueou a cópia automática — selecione e
                    copie manualmente:
                  </p>
                  <Textarea
                    readOnly
                    value={manualPrompt}
                    className="h-32 font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-json">JSON devolvido pela IA</Label>
              <Textarea
                id="import-json"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='{ "formato": "dashboard-import", "versao": 1, ... }'
                className="h-40 font-mono text-xs"
              />
              <Button
                type="button"
                disabled={!json.trim() || importPending}
                onClick={runImport}
              >
                {importPending ? "Importando…" : "Importar dashboard"}
              </Button>
            </div>

            {result && !result.ok ? (
              <div className="flex flex-col gap-2" role="status">
                <p className="text-destructive text-sm">{result.message}</p>
                {result.errors && result.errors.length > 0 ? (
                  <ul className="text-destructive max-h-60 list-disc space-y-1 overflow-y-auto rounded-md border border-destructive/30 p-3 pl-7 text-xs">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {result?.warnings && result.warnings.length > 0 ? (
              <ul className="text-muted-foreground max-h-40 list-disc space-y-1 overflow-y-auto rounded-md border p-3 pl-7 text-xs">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
