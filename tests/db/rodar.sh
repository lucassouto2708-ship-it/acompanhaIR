#!/usr/bin/env bash
# Testes do banco: aplica supabase/schema.sql num Postgres DE TESTE (vazio) e confere as regras.
#
#   DATABASE_URL=postgres://usuario@localhost:5432/acompanhair_teste npm run test:db
#
# ATENÇÃO: o banco indicado é modificado (cria usuários e empresas de teste). Nunca aponte para
# o Supabase de produção — o script se recusa a rodar em endereços *.supabase.co.
set -euo pipefail
cd "$(dirname "$0")"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "Defina DATABASE_URL apontando para um Postgres de teste vazio (veja tests/README.md)." >&2
  exit 1
fi
case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*) echo "Recusado: DATABASE_URL aponta para o Supabase. Use um Postgres de teste." >&2; exit 1 ;;
esac
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f stub-supabase.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql >/dev/null 2>&1 || psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql >/dev/null 2>&1   # 2ª vez: tem de ser idempotente
set +e
saida=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f testes.sql 2>&1); codigo=$?
set -e
echo "$saida" | sed -n 's/^psql:[^ ]* NOTICE:  /  /p; s/^psql:[^ ]* ERROR:  /  ERRO: /p; /passaram/p'
exit $codigo
