<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras do projeto

> Documentação para humanos: [`docs/arquitetura.md`](./docs/arquitetura.md)
> (fluxos + todas as invariantes, incl. as abaixo),
> [`docs/banco-de-dados.md`](./docs/banco-de-dados.md) (schema consolidado) e
> [`docs/manual-de-manutencao.md`](./docs/manual-de-manutencao.md) (runbook).
> Ao alterar schema ou invariantes, atualize esses docs na mesma entrega.

- **RPC de widgets duplicado (Snapshots):** `run_widget_query_snapshot`
  (versão vigente na 0072; introduzido na 0056) é uma cópia de
  `run_widget_query` (vigente na 0072; base 0054) apontada para
  `snapshot_records`, acrescida das
  restrições do snapshot aplicadas internamente (mock-aware). Toda mudança em
  `run_widget_query` (nova migração que o recrie) DEVE ser espelhada em
  `run_widget_query_snapshot` na mesma migração — inclusive o helper
  `_widget_match_expr` ↔ `_widget_match_expr_snap`.
- **Mocks de Data Reunião em snapshots:** mocks (`records.is_mock`) entram
  SEMPRE no dataset congelado, ignorando as restrições do snapshot (0057); a
  regra 0052 (mock só conta em consulta que referencia Data Reunião) segue
  valendo. Não reintroduza filtros de restrição injetados pelo viewer — eles
  derrubariam os mocks (AND puro).
- **Período congelado do snapshot (0059):** `snapshots.default_period` guarda
  o filtro de período do dashboard capturado na criação (SnapshotsPanel →
  `capturePeriod`) e o viewer o aplica via resolver padrão (periodBar sintético
  + `prefSettings.lastPeriod`). É filtro de CONSULTA (mesma semântica da barra
  do dashboard) — não é restrição; não o confunda com os filtros de restrição
  proibidos acima. Sem ele, consultas em "todo período" deixam de referenciar
  Data Reunião e a regra 0052 derruba os mocks.
- **Snapshots são acesso público:** nunca crie política RLS `to anon` nem
  conceda EXECUTE a `anon`/`authenticated` nas funções de snapshot; o caminho
  público é exclusivamente `app/s/[token]` + service role após validar o token.
