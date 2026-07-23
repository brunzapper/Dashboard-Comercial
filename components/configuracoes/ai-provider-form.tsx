// Versão: 1.0 | Data: 23/07/2026
// Configurações → Integrações (admin): provedor + modelo + chave de API da
// geração DIRETA de dashboards por IA. Provedor num Select; o modelo é um Input
// com sugestões por provedor (datalist) mas aceita valor livre — não trava o
// usuário numa versão. A chave é WRITE-ONLY: nunca chega preenchida (o servidor
// só guarda o ciphertext); em branco = mantém a atual. Comece pelo Gemini
// (plano gratuito) e migre para Claude/OpenAI trocando aqui.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_MODELS_BY_PROVIDER,
  AI_PROVIDER_LABELS,
  DEFAULT_AI_PROVIDER,
  defaultModelFor,
  isAiProvider,
} from "@/lib/ai/models";
import type { AiProvider } from "@/lib/ai/types";
import {
  clearAiProviderConfig,
  saveAiProviderConfig,
} from "@/app/(app)/configuracoes/integracoes/ai-actions";

export interface AiProviderFormProps {
  config: { provider: AiProvider; model: string; hasKey: boolean } | null;
}

const PROVIDERS: AiProvider[] = ["gemini", "claude", "openai"];

export function AiProviderForm({ config }: AiProviderFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<boolean>(false);

  const [provider, setProvider] = useState<AiProvider>(
    config?.provider ?? DEFAULT_AI_PROVIDER
  );
  const [model, setModel] = useState<string>(
    config?.model ?? defaultModelFor(config?.provider ?? DEFAULT_AI_PROVIDER)
  );
  const [apiKey, setApiKey] = useState("");
  const hasKey = config?.hasKey ?? false;

  function onProviderChange(value: string) {
    if (!isAiProvider(value)) return;
    setProvider(value);
    // Ao trocar de provedor, sugere o modelo padrão dele (editável).
    setModel(defaultModelFor(value));
  }

  function save() {
    setMessage(null);
    setError(false);
    startTransition(async () => {
      const res = await saveAiProviderConfig({
        provider,
        model,
        apiKey: apiKey.trim() || undefined,
      });
      setError(!res.ok);
      setMessage(res.message ?? (res.ok ? "Salvo." : "Falha ao salvar."));
      if (res.ok) {
        setApiKey("");
        router.refresh();
      }
    });
  }

  function clear() {
    setMessage(null);
    setError(false);
    startTransition(async () => {
      const res = await clearAiProviderConfig();
      setError(!res.ok);
      setMessage(res.message ?? (res.ok ? "Removido." : "Falha ao remover."));
      if (res.ok) {
        setApiKey("");
        router.refresh();
      }
    });
  }

  const modelSuggestions = AI_MODELS_BY_PROVIDER[provider];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5" /> Geração de dashboards por IA
        </CardTitle>
        <CardDescription>
          Conecte um provedor de IA para gerar dashboards direto pela descrição
          (botão “Gerar com IA” na Home), sem copiar/colar. A chave é guardada
          cifrada e nunca sai do servidor. Você pode começar pelo Gemini (plano
          gratuito) e trocar para Claude ou OpenAI depois.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-provider">Provedor</Label>
            <Select value={provider} onValueChange={onProviderChange}>
              <SelectTrigger id="ai-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {AI_PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-model">Modelo</Label>
            <Input
              id="ai-model"
              list="ai-model-suggestions"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Ex.: gemini-2.5-flash"
            />
            <datalist id="ai-model-suggestions">
              {modelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ai-key">Chave de API</Label>
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              hasKey
                ? "Chave configurada — deixe em branco para manter"
                : "Cole a chave de API do provedor"
            }
          />
          <p className="text-muted-foreground text-xs">
            A chave é cifrada (AES-256-GCM) no banco e só é decifrada no servidor
            no momento da geração. Ela nunca é exibida de volta.
          </p>
        </div>

        {message ? (
          <p
            className={error ? "text-destructive text-sm" : "text-sm text-green-600"}
            role="status"
          >
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Salvando…" : "Salvar configuração"}
          </Button>
          {hasKey ? (
            <Button
              type="button"
              variant="outline"
              onClick={clear}
              disabled={pending}
            >
              <Trash2 className="size-4" /> Remover
            </Button>
          ) : null}
          {hasKey ? (
            <span className="text-muted-foreground text-xs">
              Ativo: {AI_PROVIDER_LABELS[provider]} · {model}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
