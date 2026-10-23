# Histórico de versões

Cada versão corresponde a um commit na branch `main` do GitHub. A versão em uso aparece no selo do
cabeçalho do site. Para ver ou voltar a uma versão: GitHub → **Commits** → procurar o código do commit.
Versões marcadas com **Banco** exigiram rodar o `supabase/schema.sql` no Supabase.

Para marcar uma versão no GitHub (opcional, não altera o site): **Releases → Draft a new release →
Choose a tag** (ex.: `v1.17`) → em **Target**, escolher o commit da versão → **Publish release**.

## v1.17 — 23/10/2026
Commit: `0e60f83`

- Bibliotecas no próprio site e grafia única de município

## v1.16 — 23/10/2026
Commit: `f40770e`

- Marcação em lote, tempo real, confirmações próprias e alertas separados
- **Banco:** rodar o `supabase/schema.sql` de novo (tempo real)

## v1.15 — 22/10/2026
Commit: `0abb32a`

- Resumo mostra quantos CNPJs diferentes há entre as notificações

## v1.14 — 22/10/2026
Commit: `9a25901`

- Segurança: sem limite de 1.000 linhas, arquivamento, backup e CSV seguro
- **Banco:** rodar o `supabase/schema.sql` de novo (arquivamento)

## v1.13 — 22/10/2026
Commit: `abd6fca`

- Processo parado a partir de 15 dias sem movimentação

## v1.12 — 22/10/2026
Commit: `7700384`

- Usuário comum vê só quantidades no resumo

## v1.11 — 21/10/2026
Commit: `ed0e7c9`

- Tema claro como padrão

## v1.10 — 21/10/2026
Commit: `6aa3484`

- Mostra o nome do município em todas as linhas de ano

## v1.9 — 21/10/2026
Commit: `63a848a`

- Linha do município alinhada às colunas da tabela

## v1.8 — 21/10/2026
Commit: `f786f8e`

- Lê PDFs antigos com CNPJ e nome cortados

## v1.7 — 21/10/2026
Commit: `8929242`

- Responsável do município direto na linha do grupo

## v1.6 — 21/10/2026
Commits: `9c5e26e`, `ed17a6a`

- Admin: empresas agrupadas por município, recolhidas por padrão
- Versiona CSS e JS para evitar cache misturado

## v1.5 — 21/10/2026
Commit: `ca84cf0`

- Data real das etapas, confirmação de pagamento e coluna fixa

## v1.4 — 21/10/2026
Commit: `d1a1d77`

- Login com "mostrar senha" e caixas de etapa maiores

## v1.3 — 21/10/2026
Commit: `205a9a2`

- Redesign visual: identidade de software de auditoria fiscal

## v1.2 — 21/10/2026
Commit: `1d1de43`

- Importação: município, UF e ano editáveis

## v1.1 — 21/10/2026
Commit: `0075ace`

- Configura o projeto Supabase e usa chave publicável

## v1.0 — 21/10/2026
Commit: `7e07c9f`

- Ferramenta de acompanhamento das notificações de IRRF
- **Banco:** criar o banco com `supabase/schema.sql`
