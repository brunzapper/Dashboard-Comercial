# Webhooks — receber e enviar dados de/para sistemas externos

**Data:** 17/07/2026 · **Status:** implementado (migração 0074)
**Gestão:** Configurações → Integrações (admin). Fundamentos e decisões de
segurança: `docs/estudo-ingestao-api.md`.

---

## 1. ENTRADA — sistemas externos empurram dados

```
POST https://<app>/api/ingest/<source_key>
Authorization: Bearer dck_...
Content-Type: application/json
```

A chave (`dck_...`) é criada em Configurações → Integrações, por
integração/fonte, e exibida **uma única vez** (o banco guarda só o sha256).
Revogar é um clique — efeito imediato, sem redeploy.

### Payloads

Modo **rows** (upsert de registros — exige mapeamento configurado na chave):

```json
{ "event_id": "opcional-p-idempotencia",
  "rows": [ { "Nome": "Acme", "Valor": "1.234,56", "Data": "17/07/2026" } ] }
```

- ≤ **500 linhas** por request e corpo ≤ **1 MB**; quem tem mais, pagina.
- As linhas passam pelo MESMO motor do import de CSV (`ingestRows`): upsert
  idempotente por chave de dedup, coerção pt-BR, edições manuais preservadas,
  fórmulas recalculadas, auditoria com `origin='api'`.
- Resposta `200`: `{ "ok": true, "result": { inserted, updated, ... } }`.

Modo **event** (armazenar um evento genérico; processamento futuro):

```json
{ "event_id": "evt-123", "event": { "qualquer": "estrutura" } }
```

- Resposta `202`: `{ "ok": true, "stored": true }`.

### Idempotência

Com `event_id`, um reenvio do MESMO evento pela mesma chave responde
`200 { ok: true, duplicate: true }` sem reprocessar. Exceção: se a tentativa
anterior terminou em erro, o reenvio reprocessa. Sem `event_id`, cada request
é processado (o upsert por dedup já torna reenvios de rows seguros).

### Códigos de resposta

| Código | Quando |
| --- | --- |
| 200 / 202 | processado / armazenado |
| 400 | JSON inválido, modo não reconhecido, >500 linhas, chave sem mapeamento |
| 401 | **uniforme**: fonte inexistente, chave malformada/errada/revogada ou de outra fonte |
| 413 | corpo > 1 MB |
| 500 | erro no processamento (registrado no log de entrada; reenvio reprocessa) |

---

## 2. SAÍDA — o dashboard notifica sistemas externos

Endpoints (URLs **https**) são cadastrados em Configurações → Integrações,
com os tipos de evento desejados (nenhum marcado = todos). O segredo
`whsec_...` é exibido uma vez; "Novo segredo" gera outro.

### Catálogo de eventos

`record.created` · `record.updated` · `task.created` · `task.updated` ·
`task.completed` · `task.deleted` · `comment.created` · `comment.updated` ·
`comment.deleted` · `test.ping`

Emitem apenas as ações feitas POR USUÁRIOS no app (registros, tarefas,
comentários). **Sync (Bitrix/Sheets), import de CSV e a própria API de
ingestão NÃO emitem** — evita tempestade de eventos em reconciliações e loop
entrada→saída entre sistemas.

### Envelope e headers

```json
{ "id": "<uuid do evento>", "type": "record.updated",
  "created_at": "2026-07-17T12:00:00Z",
  "data": { "recordId": "...", "changes": [ { "field": "value", "old_value": 1, "new_value": 2 } ] } }
```

| Header | Conteúdo |
| --- | --- |
| `x-webhook-id` | id do evento (igual em todas as tentativas) |
| `x-webhook-delivery` | id da entrega (muda a cada tentativa) |
| `x-webhook-event` | tipo do evento |
| `x-webhook-signature` | `t=<unix>,v1=<hmac hex>` |

### Verificação da assinatura (obrigatória no receptor)

`v1 = HMAC-SHA256(secret, "<t>.<corpo cru>")`. Node.js:

```js
const crypto = require("node:crypto");

function verify(sigHeader, rawBody, secret) {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300; // anti-replay
  return (
    fresh &&
    parts.v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))
  );
}
```

Responda `2xx` em até 10s. Qualquer outra resposta (ou timeout) agenda retry.

### Retry, desativação e retenção

- **Backoff:** 1min, 5min, 15min, 1h, 4h, 12h, 24h — depois de 8 tentativas a
  entrega vira `dead`.
- **Auto-desativação:** 20 falhas CONSECUTIVAS desativam o endpoint (motivo
  visível na UI); religar zera o contador. Entregas pendentes de endpoint
  desativado são encerradas.
- **Retenção (tick):** entregas `delivered` 30 dias, `dead` 90 dias; log de
  entrada 30 dias.
- **Entrega:** o tick roda a cada minuto (`supabase/apply/pg-cron-webhooks.sql`);
  latência típica de segundos a ~1min. O botão "evento de teste" entrega na hora.

---

## 3. Operação

- **Env:** `KEY_ENCRYPTION_KEY` (32 bytes base64) — cifra os segredos
  `whsec_` (AES-256-GCM). Rotacionar exige re-cifrar os endpoints (fora de
  escopo; gere novos segredos pela UI se necessário).
- **Aplicar:** migração `0074_webhooks.sql` (idempotente) e depois
  `supabase/apply/pg-cron-webhooks.sql` (uma vez, no SQL editor).
- **Segurança:** tabelas novas sem policy `anon` e sem policy de escrita
  (service role apenas); URLs de saída só https, com bloqueio de hosts
  locais/IPs privados (guarda SSRF) e `redirect: "error"`.
