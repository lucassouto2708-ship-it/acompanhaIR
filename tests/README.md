# Testes automáticos do AcompanhaIR

Conferem o site e o banco antes de cada publicação. **Não fazem parte do site** e não usam o
Supabase real nem dados reais: o banco do site é simulado e os PDFs são gerados com dados fictícios
(os relatórios reais não entram no repositório, que é público).

## O que é testado

| Pasta | O quê |
|---|---|
| `unit/` | leitura do PDF (formato atual e antigo, CNPJ cortado, nomes em duas linhas, TOTAL vertical) e regras do fluxo (etapas, paradas, limites de data) |
| `e2e/` | o site no navegador: login e perfis, importação, etapas e datas, marcação em lote, municípios (inclusive teclado), mais de 1.000 empresas, arquivamento, CSV, backup, grafias de município, tempo real |
| `db/` | o `supabase/schema.sql` num Postgres de teste: regras de acesso, sequência, datas, teor, arquivamento e histórico |

## Como rodar

Requer [Node.js](https://nodejs.org) 18 ou mais novo. Na pasta `tests/`:

```bash
npm install                      # uma vez
npx playwright install chromium  # uma vez (baixa o navegador de teste)
npm test                         # testes do site (unit + e2e), ~20 s
```

Testes do banco (opcional; precisam de um Postgres **de teste**, vazio — nunca o Supabase real,
o script se recusa a rodar em endereços do Supabase):

```bash
DATABASE_URL=postgres://usuario@localhost:5432/acompanhair_teste npm run test:db
```

Um jeito simples de ter esse Postgres é o Docker:
`docker run --rm -d -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`
e então `DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db`.

## Peças de apoio

- `apoio/fake-supabase.js` — Supabase simulado no navegador (limite de 1.000 linhas por consulta,
  regras de acesso, unicidade CNPJ/município/ano, tempo real).
- `apoio/pdfs.js` — gera relatórios em PDF com o mesmo layout do real, nos formatos atual e antigo.
- `apoio/app.js` — abre o site servindo os arquivos do repositório e bloqueando a internet.
