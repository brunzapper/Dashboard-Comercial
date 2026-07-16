# Estudo de viabilidade — Recepção de fontes via API configurada no sistema

**Data:** 16/07/2026 · **Status:** estudo (nada aqui está implementado)
**Contexto:** Supabase no plano gratuito, Vercel Hobby, uso interno, volume de
milhares (não milhões) de linhas. Objetivo futuro: conectar outras planilhas e
CRMs empurrando dados para o dashboard, com as credenciais gerenciadas dentro
do próprio sistema — sem reconfigurar o banco a cada integração. Este estudo
responde, em especial, se isso exige "recursos avançados de segurança".

**Conclusão executiva:** é viável no plano gratuito, sem infraestrutura extra.
Para API de *push* (sistemas externos enviam dados), a segurança necessária já
existe no projeto como padrão comprovado (tokens com hash + service role,
o mesmo caminho dos snapshots públicos). Para conectores de *pull* (o app
consulta o CRM), basta criptografia AES-GCM no servidor com uma chave-mestra
em variável de ambiente. Nenhum dos dois exige Vault dedicado, KMS, ou mudança
de plano. O ponto inegociável é um só: **chave de API nunca vive no browser**
— criação, exibição única e uso acontecem exclusivamente no servidor.

---

## 1. O que o import de CSV já deixou pronto

A API de ingestão não é um sistema novo — é um segundo "front" para o motor
que o import de CSV já usa:

| Peça | Onde está | O que a API reutiliza |
| --- | --- | --- |
| Fontes dinâmicas | `data_sources` (migração 0060) + `lib/config/sources.ts` | criar/endereçar fontes sem migração |
| Motor de ingestão | `lib/import/ingest.ts` (`ingestRows`) | upsert idempotente em lote, dedup por hash, conflito por campo (edições manuais preservadas), responsável por nome, fórmulas, auditoria |
| Mapeamento de colunas | `ColumnMapping` (`lib/import/csv.ts`) | o payload da API usa o mesmo shape; coerção pt-BR incluída |
| Registro de campos | `prepareImportFields` (`app/(app)/registros/importar/actions.ts`) | criar/reusar `field_definitions` por fonte |
| Endpoint de referência | `app/api/sync/sheets/route.ts` | POST + secret + service role + `runAutoMatch`/`recalcAllFormulaFields` |

O wizard de CSV é o front interativo; a API é o front *headless* do mesmo
engine. A única peça nova de verdade é a **gestão de chaves por integração**.

## 2. API de push (recomendada como fase 1)

Sistemas externos (Apps Script de outra planilha, Zapier/Make, webhook de CRM)
fazem `POST` para o dashboard. É o modelo mais barato e o que o projeto já
pratica (`/api/sync/sheets`), com uma limitação atual: o `SYNC_SECRET` é
**um segredo global em env var** — criar uma nova integração hoje significa
compartilhar o mesmo segredo de todas, e revogar significa trocar a env na
Vercel (redeploy). A evolução é chave **por integração/fonte, criada na UI**:

### 2.1 Modelo de dados (uma migração, uma vez só)

```sql
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,      -- sha256 da chave; NUNCA o plaintext
  source_key text not null references public.data_sources (key),
  label text not null,                -- "Planilha de propostas", "Pipedrive"
  mapping jsonb,                      -- ColumnMapping[] salvo (payload cru -> colunas)
  dedup_columns jsonb,                -- colunas da chave de dedup
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;
-- ZERO políticas: tabela acessível só via service role (bypassa RLS).
-- Mesmo padrão de snapshots.token_hash / sync_jobs (0023, 0056).
```

### 2.2 Fluxo da chave (por que NÃO precisa de recurso avançado)

1. **Criação (UI, admin):** uma Server Action gera 32 bytes aleatórios
   (`crypto.randomBytes`), grava **apenas o sha256** em `api_keys.key_hash`
   via service role e devolve o plaintext **uma única vez** para o admin
   copiar. É exatamente o ciclo de vida do token de snapshot já em produção
   (SnapshotsPanel → `generateToken`/`hashToken` em `snapshot-actions.ts`).
2. **Uso:** o sistema externo envia `Authorization: Bearer <chave>` para
   `POST /api/ingest/<source_key>`. A rota calcula o sha256 do header e busca
   `api_keys` por `key_hash` (comparação por digest; sem plaintext em lugar
   nenhum), valida `revoked_at is null` e `source_key`, carimba
   `last_used_at`, e chama `ingestRows` com o `mapping` salvo.
3. **Revogação:** `update api_keys set revoked_at = now()` — um clique na UI,
   efeito imediato, sem redeploy, sem tocar em env vars.

Propriedades de segurança desse desenho:

- **Vazamento do banco não vaza chaves** — só hashes irreversíveis.
- **Client-side nunca vê segredo** — o browser do admin recebe o plaintext
  uma única vez, na resposta da action, para copiar; nada vai a
  `localStorage`, estado global ou tabela legível por `authenticated`.
- **Escopo por fonte** — uma chave comprometida só escreve na fonte dela
  (e o dano é limitado a *inserir/atualizar registros daquela fonte*, nunca
  ler dados: o endpoint é só de escrita).
- **Zero reconfiguração por integração** — criar a 2ª, 3ª, décima conexão é
  um INSERT feito pela UI. Nenhuma migração, política RLS ou env var nova.
  (A migração da tabela `api_keys` acontece uma vez, junto da feature.)

**Resposta direta à pergunta do estudo:** não é preciso "recurso avançado de
segurança" (Vault, KMS, secret manager) para chaves de *entrada*. Hash + RLS
sem políticas + service role — tudo já disponível no plano gratuito e já
validado no projeto pelos snapshots públicos — é o suficiente e é o padrão da
indústria para API keys (o mesmo modelo do GitHub/Stripe: mostra uma vez,
guarda hash).

### 2.3 Contrato do endpoint (esboço)

```
POST /api/ingest/<source_key>
Authorization: Bearer <chave>
Content-Type: application/json

{ "rows": [ { "Nome": "...", "Valor": "1.234,56", "Data": "16/07/2026" }, ... ] }
```

- ≤ 500 linhas por request (mesmo teto do `importCsvChunk`); quem tem mais,
  pagina — o upsert idempotente torna reenvio seguro.
- Resposta: o `SyncResult` (inseridos/atualizados/ignorados/erros + amostras).
- `export const maxDuration = 60` e cauda `runAutoMatch`/`recalc` best-effort,
  como na rota de sheets.
- Rate limiting: desnecessário para uso interno; ver §6 para o caminho SaaS.

## 3. Conectores de pull (o app consulta o CRM) — fase 2

Aqui o dashboard guarda credenciais **de terceiros** (API key do Pipedrive,
token do RD Station...) e precisa delas **reversíveis** (decriptar para chamar
o CRM). Hash não serve. Duas opções viáveis no plano gratuito:

| | AES-256-GCM no app (recomendado) | Supabase Vault |
| --- | --- | --- |
| Como funciona | Server Action cifra com `KEY_ENCRYPTION_KEY` (env da Vercel, 32 bytes) e grava o ciphertext numa tabela service-role-only; decripta só no servidor, na hora de chamar o CRM | extensão `supabase_vault`: segredos cifrados no Postgres, decriptados via view `vault.decrypted_secrets` |
| Disponível no free | sim (zero dependência) | sim (extensão inclusa) |
| Acoplamento | nenhum — é `node:crypto` | migrações/consultas passam a depender da extensão; o segredo decriptado trafega numa consulta SQL |
| Rotação | trocar env + re-cifrar (script pontual) | gerenciada pelo Vault |
| Veredito p/ esta escala | **suficiente e mais simples** | alternativa aceitável; ganha relevância multi-tenant |

O restante do conector de pull reusa o modelo do Bitrix: `sync_jobs` (0023)
para paginação resumível, adapter por CRM, e o mesmo `ingestRows` na ponta.
Custo real de um conector novo é o adapter (mapear a API do CRM), não a
segurança.

## 4. Limites do plano gratuito (e como o desenho já os respeita)

- **Vercel Hobby, ~60s por request** — já é a convenção do repo
  (`maxDuration = 60`); ingestão em chunks ≤500 linhas fica em poucos
  segundos. Milhares de linhas = poucos requests.
- **Cron da Vercel no Hobby é diário** — para agendamento horário de pulls:
  Apps Script time-driven trigger (já em produção empurrando o Estudo),
  pinger externo (cron-job.org, GitHub Actions) chamando uma rota com secret,
  ou `pg_cron` + `pg_net` do próprio Supabase (ambos no free) chamando o
  endpoint. Push (fase 1) não precisa de agendador nosso — o remetente agenda.
- **Supabase free: 500 MB de banco, pausa após 7 dias sem uso** — milhares de
  linhas com `custom_fields` jsonb ≈ poucos MB; folga de ordens de grandeza.
  A pausa por inatividade não é problema com uso interno diário.
- **Sem worker/fila always-on no free** — por isso o desenho é 100%
  request-driven (push) ou resumível por cursor (`sync_jobs`), nunca um
  processo residente.

## 5. Regras de manuseio de chaves (checklist de implementação)

1. Plaintext existe em exatamente dois lugares: na resposta de criação (uma
   vez) e no sistema externo que a usa.
2. Em repouso: só `key_hash` (entrada) ou ciphertext AES-GCM (saída).
3. Tabelas de credenciais: RLS ligado, **zero políticas** (service-role-only);
   jamais política `anon` (regra do projeto) e jamais leitura `authenticated`.
4. Toda validação/uso no servidor (route handler/server action); o client só
   dispara ações e recebe metadados (label, últimos 4 chars, `last_used_at`).
5. Revogação por `revoked_at` (imediata, sem redeploy); auditoria por
   `last_used_at` + `audit_log` (origin próprio, ex.: `'api'` — estender o
   CHECK como a 0060 fez com `'import_csv'`).
6. A UI pode exibir prefixo identificador (`zpk_a1b2…`) — guardar os 4 últimos
   caracteres em coluna própria na criação, nunca derivar do plaintext depois.

## 6. Caminho para virar produto (fora de escopo agora)

Nada no desenho acima precisa ser refeito para multi-tenant; o que se
ACRESCENTA quando chegar a hora:

- `tenant_id` em `records`, `data_sources`, `field_definitions`, `api_keys`
  (e RLS por tenant em tudo que hoje é single-tenant por pressuposto);
- chaves escopadas por tenant + quotas/rate limiting (ex.: Upstash Redis,
  free tier) no endpoint de ingestão;
- rotação de chaves e logs de acesso como feature de produto;
- avaliar Supabase Vault/plano pago quando o volume de credenciais de
  terceiros e requisitos de compliance crescerem;
- fila real (QStash/Inngest) se os pulls passarem a mover milhões de linhas.

## 7. Ordem sugerida quando for implementar

1. Migração `api_keys` (+ origin `'api'` no `audit_log`) — 1 migração.
2. UI de chaves em Configurações → Fontes (criar/listar/revogar; padrão
   SnapshotsPanel).
3. Rota `POST /api/ingest/<source_key>` chamando `ingestRows` com o mapping
   salvo (o wizard de CSV já sabe construir/salvar mapeamentos).
4. (Depois) primeiro conector de pull com AES-GCM + `sync_jobs`.

Esforço estimado da fase 1 (push): pequeno — a maior parte é UI; o motor, a
segurança-padrão e as fontes dinâmicas já existem.
