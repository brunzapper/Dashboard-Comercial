<!-- Versão: 1.0 | Data: 05/07/2026 -->

# Banco de dados (Supabase) — aplicação manual

Este projeto **não conecta ao banco** a partir do código de build/deploy do agente.
Todas as migrations e seeds são geradas como SQL para você aplicar manualmente no
**SQL Editor do Supabase**. As credenciais vivem só no painel do Supabase e nas
Environment Variables da Vercel.

## Como aplicar a Fase 1

1. Abra o **SQL Editor** do seu projeto Supabase.
2. Cole o conteúdo de [`apply/fase-1.sql`](./apply/fase-1.sql) (bloco único, já na
   ordem correta) e execute.
3. O script é **idempotente**: se algo falhar no meio, corrija e rode de novo.
4. Confirme que as tabelas, funções e políticas foram criadas sem erro.

As migrations individuais ficam em [`migrations/`](./migrations) (0001…0011), caso
prefira aplicar/versionar uma a uma.

## Como aplicar a Fase 2 (Sync Bitrix)

Depois da Fase 1, cole o [`apply/fase-2.sql`](./apply/fase-2.sql) (migração `0012`:
Responsáveis, Operações e Lead relacionado) e execute. Também idempotente.

Para o sync do Bitrix funcionar, configure na Vercel as env `BITRIX_WEBHOOK_URL`
(webhook de ENTRADA / API REST) e `SYNC_SECRET`. Depois, na página **Registros** (logado
como admin), use **Backfill inicial** (importa leads + deals do ano) e **Reconciliar**
(últimos N dias). Os responsáveis são criados automaticamente a partir do Bitrix; o admin
depois cura a lista (ativa/desativa) e monta as Operações. Não há webhook de saída por ora.

## Como aplicar a Fase 3 (Sync Estudo de Fechamentos)

Depois da Fase 2, cole o [`apply/fase-3.sql`](./apply/fase-3.sql) (migração `0013`:
índice funcional para localizar o lead relacionado por e-mail) e execute.

Esta fase é **receptora** (push): o Apps Script da planilha "Estudo de Fechamentos"
(`integrations/apps-script/push_estudo_fechamentos.gs`) envia as linhas da aba "Site" a
cada hora para `POST /api/sync/sheets`, protegido pela mesma `SYNC_SECRET`. Não há botão
manual — a listagem em **Registros** vai mostrar essas vendas assim que o Apps Script
rodar pela primeira vez (`installHourlyTrigger()`).

**Recomendado:** depois de aplicar esta fase, rode **Reconciliar** de novo no Bitrix — o
mapper de leads passou a capturar e-mail (necessário para casar vendas do site com o lead
de origem), então um novo sync garante que os leads já importados fiquem com e-mail
preenchido.

## Criar o primeiro usuário admin (bootstrap)

Os seeds criam papéis e permissões, mas **não criam usuários**. Para ter o primeiro
admin (e poder usar a tela de Usuários depois):

1. No painel Supabase: **Authentication → Users → Add user** (defina email e senha;
   não há signup público no app).
2. Copie o `User UID` do usuário criado.
3. No SQL Editor, atribua o papel `admin`:

   ```sql
   insert into public.user_roles (user_id, role_key)
   values ('COLE-O-USER-UID-AQUI', 'admin')
   on conflict do nothing;
   ```

4. Faça login no app com esse email/senha. O menu de admin (Campos, Usuários) aparece
   conforme as permissões do papel.

## Papéis e permissões (resumo)

| Papel     | Permissões                                                                 |
| --------- | -------------------------------------------------------------------------- |
| admin     | todas                                                                      |
| gestor    | editar valores, criar dashboards, ver todos os registros, ver forecast     |
| vendedor  | editar os próprios valores, criar dashboards pessoais                       |

As duas camadas independentes da especificação são as permissões
`edit_record_values` (editar valor) e `manage_field_definitions` (criar/alterar
coluna), reforçadas por políticas RLS distintas.
