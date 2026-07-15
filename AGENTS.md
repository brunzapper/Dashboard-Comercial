<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras do projeto

- **RPC de widgets duplicado (Snapshots):** `run_widget_query_snapshot` (0056)
  é uma cópia de `run_widget_query` (0054) apontada para `snapshot_records`.
  Toda mudança em `run_widget_query` (nova migração que o recrie) DEVE ser
  espelhada em `run_widget_query_snapshot` na mesma migração — inclusive o
  helper `_widget_match_expr` ↔ `_widget_match_expr_snap`.
- **Snapshots são acesso público:** nunca crie política RLS `to anon` nem
  conceda EXECUTE a `anon`/`authenticated` nas funções de snapshot; o caminho
  público é exclusivamente `app/s/[token]` + service role após validar o token.
