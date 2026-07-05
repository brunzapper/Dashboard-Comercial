<!-- Versão: 1.0 | Data: 05/07/2026 -->

# Dashboard Comercial — Zapper

Construtor de dashboards comerciais (não um dashboard fixo) para gestão de leads e
negócios da equipe de vendas. Núcleo próprio (`records`) é a fonte de verdade da UI;
fontes externas (Bitrix24, planilha "Estudo de Fechamentos") apenas alimentam o núcleo.

## Stack

- **Next.js 16** (App Router, TypeScript) — deploy na Vercel
- **Supabase** (Postgres + Auth + Row Level Security)
- **Tailwind CSS v4 + shadcn/ui** (componentes em `components/ui`)
- **Recharts** (gráficos) e **react-grid-layout** (grid de dashboard) — usados a partir da Fase 6

> Nota: no Next.js 16 o antigo `middleware` chama-se **`proxy`** (`proxy.ts`).

## Configuração

Não há `.env.local`. As variáveis vivem nas **Environment Variables da Vercel**
(Production/Preview/Development) e no painel do Supabase. Use [`.env.example`](./.env.example)
como checklist. Cada variável obrigatória falha com erro claro em runtime se ausente.

## Banco de dados

O código **não conecta ao banco**. As migrations/seeds são SQL para aplicação manual no
SQL Editor do Supabase. Veja [`supabase/README.md`](./supabase/README.md) e o bloco único
[`supabase/apply/fase-1.sql`](./supabase/apply/fase-1.sql).

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # build de produção
npm run typecheck  # tsc --noEmit
npm run lint
```

## Convenção de versionamento

Todo arquivo tem cabeçalho `Versão: X.Y | Data: DD/MM/AAAA`. Alterações incrementam a
versão menor e são comentadas no local (`// vX.Y (data): ...`).

## Fases

1. **Fundação** (esta entrega): auth email/senha, papéis/permissões + RLS, navegação por papel, schema completo.
2. Sync Bitrix24 · 3. Sync Estudo de Fechamentos · 4. Edição de registros · 5. Colunas dinâmicas · 6. Construtor de dashboards.
