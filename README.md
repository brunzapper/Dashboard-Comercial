<!-- Versão: 1.2 | Data: 22/07/2026 -->
<!-- v1.2 (22/07/2026): link para o novo docs/manual-de-construcao-de-dashboards.md. -->
<!-- v1.1 (17/07/2026): escopo real (Fases 1–14+), seção Documentação com os novos
     docs de arquitetura/banco/manutenção, aviso das invariantes críticas. -->

# Dashboard Comercial — Zapper

Construtor de dashboards comerciais (não um dashboard fixo) para gestão de leads e
negócios da equipe de vendas. Núcleo próprio (`records`) é a fonte de verdade da UI;
fontes externas (Bitrix24, planilha "Estudo de Fechamentos", CSV, API de ingestão)
apenas alimentam o núcleo.

## Documentação

Comece por aqui — especialmente para **manutenção manual, sem IA**:

| Documento | Conteúdo |
|---|---|
| [`docs/arquitetura.md`](./docs/arquitetura.md) | Visão geral, mapa de pastas, fluxos principais e as **invariantes críticas** que não podem ser quebradas |
| [`docs/banco-de-dados.md`](./docs/banco-de-dados.md) | Schema consolidado (tabelas, funções, triggers, RLS) + histórico das migrações |
| [`docs/manual-de-manutencao.md`](./docs/manual-de-manutencao.md) | Setup do zero, checklists de mudança segura e troubleshooting |
| [`docs/manual-de-construcao-de-dashboards.md`](./docs/manual-de-construcao-de-dashboards.md) | Manual exaustivo de construção de dashboards pela UI (para usuários e IAs assistentes) |
| [`supabase/README.md`](./supabase/README.md) | Runbook de aplicação manual das migrações + queries de conferência |
| [`docs/webhooks.md`](./docs/webhooks.md) | Referência da API de webhooks (entrada e saída) |

> ⚠️ Antes de mexer no motor de widgets, em snapshots ou nos mocks de "Data
> Reunião", leia as **invariantes críticas** em `docs/arquitetura.md` §5 (também em
> [`AGENTS.md`](./AGENTS.md)). Quebrá-las causa divergência silenciosa de números.

## Stack

- **Next.js 16** (App Router, TypeScript, React 19) — deploy na Vercel
- **Supabase** (Postgres + Auth + Row Level Security); agendamentos via `pg_cron` + `pg_net`
- **Tailwind CSS v4 + shadcn/ui** (componentes em `components/ui`)
- **Recharts** (gráficos) e **react-grid-layout** (grid de dashboard)

> Nota: no Next.js 16 o antigo `middleware` chama-se **`proxy`** (`proxy.ts`).

## Configuração

Não há `.env.local`. As variáveis vivem nas **Environment Variables da Vercel**
(Production/Preview/Development) e no painel do Supabase. Use [`.env.example`](./.env.example)
como checklist. Cada variável obrigatória falha com erro claro em runtime se ausente.

## Banco de dados

O código **não conecta ao banco**. As migrations/seeds são SQL para aplicação manual no
SQL Editor do Supabase. Veja [`supabase/README.md`](./supabase/README.md) (ordem de
aplicação) e [`docs/banco-de-dados.md`](./docs/banco-de-dados.md) (schema consolidado).

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # build de produção
npm run typecheck  # tsc --noEmit
npm run lint
```

Não há testes automatizados nem CI — `typecheck` + `lint` são a rede de segurança
(lacunas e recomendações em `docs/manual-de-manutencao.md` §6).

## Convenção de versionamento

Todo arquivo tem cabeçalho `Versão: X.Y | Data: DD/MM/AAAA`. Alterações incrementam a
versão menor e são comentadas no local (`// vX.Y (data): ...`). É o único changelog do
projeto — mantenha-o.

## Escopo entregue (Fases)

1. **Fundação** — auth email/senha, papéis/permissões + RLS, schema.
2. **Sync Bitrix24** — backfill/reconcile resumíveis, write-back.
3. **Sync Estudo de Fechamentos** — push horário via Apps Script.
4. **Edição de registros** · 5. **Colunas dinâmicas e fórmulas** · 6. **Construtor de
   dashboards** (+ metas, operações aninhadas, presets).
7. **Filtro de período interativo** · 8. **Separação de fontes + correspondências
   (campos unificados)** · 9. **Sync incremental/retomável** · 10. **Customização
   de layout/aparência**.
12–13. **Mocks de "Data Reunião"** (jan–mai/2026, congelamento e operações).
14. **Criação manual de registros, kanbans, tarefas, agenda e feed**.

Entregas fora da numeração de fases (entre a 9 e hoje): tabela editável, moedas e
conversão cambial, matching entre fontes, write-back para o Bitrix, **snapshots
públicos congelados** (`/s/<token>`), **fontes dinâmicas**, **realtime** e
**webhooks de entrada/saída** (Configurações → Integrações). O histórico completo,
migração a migração, está em [`docs/banco-de-dados.md`](./docs/banco-de-dados.md) §7.
