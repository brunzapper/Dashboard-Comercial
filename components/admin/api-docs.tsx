// Versão: 1.0 | Data: 17/07/2026
// Documentação da API dentro da ferramenta (Configurações → Integrações →
// Documentação). Manter sincronizado com docs/webhooks.md — a prosa dos
// contratos é a mesma; os dados dinâmicos (fontes, alvos de mapeamento,
// tipos de evento) chegam por props direto do runtime, sem duplicação.
// A URL base dos exemplos vem de window.location.origin (placeholder
// "https://SEU-DOMINIO" até a hidratação — flash aceitável).
"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ApiDocsTarget {
  value: string; // "responsible" | "core:<col>" | "custom:<field_key>"
  label: string;
  kind: "core" | "custom" | "responsible";
  dataType?: string;
}

export interface ApiDocsSource {
  key: string;
  label: string;
  recordType: string;
  targets: ApiDocsTarget[];
}

// ============ Bloco de código com botão copiar ============

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="relative">
      <pre className="bg-muted/50 overflow-x-auto rounded-lg border p-3 pr-12 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-1.5 right-1.5"
        onClick={copy}
        title="Copiar"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

// ============ Amostras de payload por tipo de evento (saída) ============
// Shapes idênticos aos emitidos pelas actions (lib/records|tasks|comments).

const EVENT_SAMPLES: Record<string, object> = {
  "record.created": { recordId: "9b2f…", source: "negocios" },
  "record.updated": {
    recordId: "9b2f…",
    changes: [{ field: "value", old_value: 1000, new_value: 2500 }],
  },
  "task.created": { taskId: "5c1a…", title: "Ligar para o cliente", recordId: "9b2f…" },
  "task.updated": { taskId: "5c1a…", phase: "em_andamento" },
  "task.completed": { taskId: "5c1a…" },
  "task.deleted": { taskId: "5c1a…", title: "Ligar para o cliente", recordId: null },
  "comment.created": { commentId: "7d3e…", recordId: "9b2f…", taskId: null },
  "comment.updated": { commentId: "7d3e…" },
  "comment.deleted": { commentId: "7d3e…" },
  "test.ping": { message: "Evento de teste do Dashboard Comercial" },
};

const EVENT_DESCRIPTIONS: Record<string, string> = {
  "record.created": "Registro criado manualmente no app.",
  "record.updated": "Campos de um registro editados (com o resumo das mudanças).",
  "task.created": "Tarefa criada.",
  "task.updated": "Tarefa editada, movida de fase ou reaberta.",
  "task.completed": "Tarefa concluída (inclusive ao mover para coluna que conclui).",
  "task.deleted": "Tarefa excluída.",
  "comment.created": "Comentário criado em registro ou tarefa.",
  "comment.updated": "Comentário editado.",
  "comment.deleted": "Comentário excluído.",
  "test.ping": "Evento de teste disparado pelo botão da tela de Integrações.",
};

// Valor de exemplo plausível por tipo de dado (coerção pt-BR do import).
function sampleValue(dataType?: string): string {
  if (dataType === "numero" || dataType === "moeda" || dataType === "percentual")
    return "1.234,56";
  if (dataType === "data") return "17/07/2026";
  return "Acme Ltda";
}

const VERIFY_SNIPPET = `const crypto = require("node:crypto");

function verify(sigHeader, rawBody, secret) {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300; // anti-replay
  return (
    fresh &&
    parts.v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))
  );
}`;

const KIND_LABEL: Record<ApiDocsTarget["kind"], string> = {
  core: "Coluna",
  custom: "Campo",
  responsible: "Relação",
};

export function ApiDocs({
  sources,
  eventTypes,
}: {
  sources: ApiDocsSource[];
  eventTypes: string[];
}) {
  // Origin real do app (só existe no browser) — placeholder no SSR; o
  // useSyncExternalStore troca pelo valor real na hidratação sem mismatch.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "https://SEU-DOMINIO"
  );

  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "");
  const source = sources.find((s) => s.key === sourceKey) ?? sources[0] ?? null;

  // Mapeamento de exemplo da fonte: título + 1 numérico + 1 personalizado
  // (quando existem), com nomes de coluna derivados dos rótulos reais.
  const example = useMemo(() => {
    if (!source) return null;
    const picks: { csvColumn: string; target: ApiDocsTarget }[] = [];
    const title = source.targets.find((t) => t.value === "core:title");
    if (title) picks.push({ csvColumn: "Nome", target: title });
    const numeric = source.targets.find(
      (t) => t.kind === "core" && t.dataType === "numero"
    );
    if (numeric) picks.push({ csvColumn: numeric.label, target: numeric });
    const custom = source.targets.find((t) => t.kind === "custom");
    if (custom) picks.push({ csvColumn: custom.label, target: custom });
    if (picks.length === 0 && source.targets.length > 0) {
      picks.push({ csvColumn: source.targets[0].label, target: source.targets[0] });
    }
    const mapping = picks.map((p) => ({
      csvColumn: p.csvColumn,
      target: p.target.value,
      ...(p.target.kind === "custom" && p.target.dataType
        ? { dataType: p.target.dataType }
        : {}),
    }));
    const row: Record<string, string> = {};
    for (const p of picks) {
      row[p.csvColumn] =
        p.target.value === "core:title" ? "Acme Ltda" : sampleValue(p.target.dataType);
    }
    return { mapping, row };
  }, [source]);

  const ingestUrl = `${origin}/api/ingest/${source?.key ?? "<fonte>"}`;
  const curlRows = example
    ? `curl -X POST '${ingestUrl}' \\
  -H 'Authorization: Bearer dck_SUA_CHAVE' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({ event_id: "evt-001", rows: [example.row] })}'`
    : "";

  return (
    <div className="flex flex-col gap-6">
      {/* ============ 1. Início rápido ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Início rápido</CardTitle>
          <CardDescription>
            Três passos para um sistema externo enviar dados ao dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Em <strong>Configurações → Integrações</strong>, crie uma chave de
              API escolhendo a fonte de destino e o mapeamento de colunas. A
              chave <code className="text-xs">dck_...</code> aparece uma única
              vez — copie na hora.
            </li>
            <li>
              No sistema externo, envie um <code className="text-xs">POST</code>{" "}
              para <code className="text-xs">{ingestUrl}</code> com o header{" "}
              <code className="text-xs">Authorization: Bearer dck_...</code>
            </li>
            <li>
              Confira o resultado em <strong>Registros</strong> (e o log da
              chave na tela de Integrações).
            </li>
          </ol>
          {curlRows ? <CodeBlock code={curlRows} /> : null}
        </CardContent>
      </Card>

      {/* ============ 2. API de entrada ============ */}
      <Card>
        <CardHeader>
          <CardTitle>API de entrada — receber dados</CardTitle>
          <CardDescription>
            <code>POST {origin}/api/ingest/&lt;fonte&gt;</code> · autenticação
            por chave de integração (Bearer).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div>
            <h3 className="mb-1 font-medium">Autenticação</h3>
            <p className="text-muted-foreground">
              Header <code className="text-xs">Authorization: Bearer dck_...</code>.
              Falhas de autenticação respondem <strong>401 uniforme</strong> —
              a API não distingue fonte inexistente, chave errada, revogada ou
              de outra fonte (anti-enumeração). Revogar uma chave na UI tem
              efeito imediato.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-medium">Modo rows — inserir/atualizar registros</h3>
            <p className="text-muted-foreground mb-2">
              Exige mapeamento configurado na chave. Até <strong>500 linhas</strong>{" "}
              e <strong>1 MB</strong> por requisição (quem tem mais, pagina). As
              linhas passam pelo mesmo motor do import de CSV: upsert
              idempotente pela chave de dedup, coerção pt-BR de números/datas,
              edições manuais preservadas e auditoria com origem{" "}
              <code className="text-xs">api</code>.
            </p>
            <CodeBlock
              code={`{ "event_id": "opcional-p-idempotencia",\n  "rows": [ { "Nome": "Acme", "Valor": "1.234,56" } ] }`}
            />
          </div>
          <div>
            <h3 className="mb-1 font-medium">Modo event — armazenar evento genérico</h3>
            <p className="text-muted-foreground mb-2">
              Qualquer estrutura JSON; fica registrada para processamento
              futuro. Responde <code className="text-xs">202</code>.
            </p>
            <CodeBlock code={`{ "event_id": "evt-123", "event": { "qualquer": "estrutura" } }`} />
          </div>
          <div>
            <h3 className="mb-1 font-medium">Idempotência</h3>
            <p className="text-muted-foreground">
              Com <code className="text-xs">event_id</code>, reenviar o mesmo
              evento pela mesma chave responde{" "}
              <code className="text-xs">{`{ "ok": true, "duplicate": true }`}</code>{" "}
              sem reprocessar — exceto se a tentativa anterior falhou, quando o
              reenvio reprocessa. Sem <code className="text-xs">event_id</code>,
              o upsert por dedup já torna reenvios de rows seguros.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-medium">Códigos de resposta</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Código</TableHead>
                  <TableHead>Quando</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>200 / 202</TableCell>
                  <TableCell>rows processadas / evento armazenado</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>400</TableCell>
                  <TableCell>
                    JSON inválido, modo não reconhecido, &gt;500 linhas ou chave
                    sem mapeamento
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>401</TableCell>
                  <TableCell>não autorizado (uniforme — ver Autenticação)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>413</TableCell>
                  <TableCell>corpo maior que 1 MB</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>500</TableCell>
                  <TableCell>
                    erro no processamento (fica no log; reenvio com o mesmo
                    event_id reprocessa)
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ============ 3. Fontes e alvos de mapeamento ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Fontes e alvos de mapeamento</CardTitle>
          <CardDescription>
            O mapeamento (salvo na chave de API) liga as colunas do seu payload
            aos campos do dashboard. Escolha uma fonte para ver os alvos
            disponíveis e um exemplo pronto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="max-w-xs">
            <Select value={source?.key ?? ""} onValueChange={setSourceKey}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a fonte" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {source ? (
            <>
              <div className="max-h-80 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alvo (target)</TableHead>
                      <TableHead>Rótulo</TableHead>
                      <TableHead>Tipo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {source.targets.map((t) => (
                      <TableRow key={t.value}>
                        <TableCell>
                          <code className="text-xs">{t.value}</code>
                        </TableCell>
                        <TableCell>{t.label}</TableCell>
                        <TableCell>
                          <Badge variant={t.kind === "custom" ? "secondary" : "outline"}>
                            {KIND_LABEL[t.kind]}
                            {t.dataType ? ` · ${t.dataType}` : ""}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground">
                O alvo especial <code className="text-xs">ignore</code> descarta
                a coluna. Campos personalizados novos são criados no import de
                CSV ou em Configurações → Fontes — a chave só referencia campos
                existentes.
              </p>
              {example ? (
                <>
                  <div>
                    <h3 className="mb-1 font-medium">
                      Exemplo de mapeamento (ColumnMapping[])
                    </h3>
                    <CodeBlock code={JSON.stringify(example.mapping, null, 2)} />
                  </div>
                  <div>
                    <h3 className="mb-1 font-medium">
                      Exemplo de envio para “{source.label}”
                    </h3>
                    <CodeBlock code={curlRows} />
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">
              Nenhuma fonte cadastrada ainda — crie uma em Configurações →
              Fontes.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ============ 4. Webhooks de saída ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Webhooks de saída — receber notificações</CardTitle>
          <CardDescription>
            O dashboard envia um POST assinado para os endpoints cadastrados
            quando registros, tarefas ou comentários mudam. Sync (Bitrix/
            Sheets), import de CSV e a própria API de entrada não emitem
            eventos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div>
            <h3 className="mb-1 font-medium">Envelope</h3>
            <CodeBlock
              code={JSON.stringify(
                {
                  id: "<uuid do evento>",
                  type: "record.updated",
                  created_at: "2026-07-17T12:00:00Z",
                  data: EVENT_SAMPLES["record.updated"],
                },
                null,
                2
              )}
            />
          </div>
          <div>
            <h3 className="mb-1 font-medium">Headers</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Header</TableHead>
                  <TableHead>Conteúdo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <code className="text-xs">x-webhook-id</code>
                  </TableCell>
                  <TableCell>id do evento (igual em todas as tentativas)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-xs">x-webhook-delivery</code>
                  </TableCell>
                  <TableCell>id da entrega (muda a cada tentativa)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-xs">x-webhook-event</code>
                  </TableCell>
                  <TableCell>tipo do evento</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-xs">x-webhook-signature</code>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">t=&lt;unix&gt;,v1=&lt;hmac hex&gt;</code>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div>
            <h3 className="mb-1 font-medium">
              Verificação da assinatura (obrigatória no receptor)
            </h3>
            <p className="text-muted-foreground mb-2">
              <code className="text-xs">
                v1 = HMAC-SHA256(secret, &quot;&lt;t&gt;.&lt;corpo cru&gt;&quot;)
              </code>{" "}
              — use o segredo <code className="text-xs">whsec_...</code> exibido
              na criação do endpoint. Node.js:
            </p>
            <CodeBlock code={VERIFY_SNIPPET} />
          </div>
          <div>
            <h3 className="mb-1 font-medium">Catálogo de eventos</h3>
            <Accordion type="multiple">
              {eventTypes.map((t) => (
                <AccordionItem key={t} value={t}>
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <code className="text-xs">{t}</code>
                      <span className="text-muted-foreground text-xs font-normal">
                        {EVENT_DESCRIPTIONS[t] ?? ""}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <CodeBlock
                      code={JSON.stringify(
                        { data: EVENT_SAMPLES[t] ?? {} },
                        null,
                        2
                      )}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
          <div>
            <h3 className="mb-1 font-medium">Entrega e confiabilidade</h3>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>
                Responda <strong>2xx em até 10s</strong>; qualquer outra
                resposta (ou timeout) agenda retry.
              </li>
              <li>
                Backoff: 1min, 5min, 15min, 1h, 4h, 12h, 24h — após 8 tentativas
                a entrega é abandonada.
              </li>
              <li>
                20 falhas consecutivas desativam o endpoint automaticamente
                (religue na tela de Integrações; o contador zera).
              </li>
              <li>
                Apenas URLs <strong>https</strong> públicas; o segredo{" "}
                <code className="text-xs">whsec_</code> aparece uma única vez
                (gere outro com &quot;Novo segredo&quot;).
              </li>
              <li>
                Entrega típica em segundos até ~1 minuto (tick por minuto); o
                botão &quot;evento de teste&quot; entrega na hora.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        O mesmo contrato está versionado no repositório em{" "}
        <code>docs/webhooks.md</code>.
      </p>
    </div>
  );
}
