// Versão: 1.0 | Data: 09/09/2026
// A TELA DE CONSTRUÇÃO de um fluxo — o mesmo construtor que ficava dentro do
// card da lista, agora com a página inteira para ele.
//
// O construtor em si NÃO foi reescrito: é o `SchemaCard`, que já era o
// construtor completo (campos + passos + conexões). O que muda é onde ele fica.
// Montar um fluxo é trabalho longo, e fazê-lo espremido entre as linhas
// vizinhas da lista era o que dava a impressão de que não havia construtor.
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SchemaCard,
  type ConnectionStatus,
  type ManagedSchema,
} from "@/components/operacao/workflow-schema-card";
import type { StepSourceOption } from "@/components/operacao/workflow-step-editor";

export function WorkflowSchemaScreen({
  schema,
  connections,
  sources,
}: {
  schema: ManagedSchema;
  connections: ConnectionStatus[];
  sources: StepSourceOption[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link href="/operacao/workflow">
            <ArrowLeft className="size-4" /> Esquemas
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{schema.label}</h1>
          <p className="text-muted-foreground text-xs">
            {schema.triggerKind === "form"
              ? "Formulário · alguém preenche"
              : "Automação · roda sozinha, sem tela"}
          </p>
        </div>
      </div>

      <SchemaCard schema={schema} connections={connections} sources={sources} />
    </div>
  );
}
