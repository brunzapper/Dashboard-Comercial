#!/usr/bin/env bash
# Versão: 1.0 | Data: 24/07/2026
# Sobe o stack Supabase LOCAL para testes SEM deixar o CLI aplicar as
# migrações: o CLI as registra por VERSÃO numérica e o repo tem prefixos
# duplicados (0017_*, 0049_*) — legado válido do fluxo manual de produção
# (SQL Editor, ordem por NOME de arquivo). Então o start roda com
# supabase/migrations vazio e este script aplica os arquivos via psql, em
# ordem lexical de nome — espelho exato do fluxo de produção.
# Requisitos: supabase CLI + docker + psql no PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

HOLD="supabase/migrations.hold"
restore() {
  if [ -d "$HOLD" ]; then
    # O diretório migrations corrente é o placeholder vazio do start.
    rm -rf supabase/migrations
    mv "$HOLD" supabase/migrations
  fi
}
trap restore EXIT

mv supabase/migrations "$HOLD"
mkdir supabase/migrations
supabase start
restore

eval "$(supabase status -o env)"
DB="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
for f in supabase/migrations/*.sql; do
  echo "== $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Stack local pronto (migrações aplicadas em ordem de nome via psql)."
