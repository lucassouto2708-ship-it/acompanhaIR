# AcompanhaIR

Ferramenta de acompanhamento das notificações de IRRF por empresa: cálculo, notificação,
entrega ao município, guia, pagamento, impugnação e auto de infração. Cada usuário vê só as
próprias empresas e o administrador vê todas. Empresa, CNPJ e cálculo são importados do
relatório geral em PDF.

## Fluxo das etapas

```
Notificação elaboração → Entrega município → Remessa notificação c/ guia → Pagamento
                                                                           ├─ Pago      → encerrado
                                                                           └─ Não pago  → Impugnação → Resposta (resultado + teor) → Auto de infração
```

- As três primeiras etapas são lineares: cada uma só libera depois da anterior.
- **Pago** encerra o processo.
- **Não pago** libera a impugnação, que é um checkbox: impugnou ou não.
- Na **resposta da impugnação** são registrados o resultado (deferida, parcialmente deferida
  ou indeferida), a data e o **teor**. Uma impugnação deferida encerra o processo.
- **Auto de infração** fica disponível depois do "não pago". Se houve impugnação, só depois
  da resposta.
- Ao marcar uma etapa (ou registrar pago/não pago), o sistema pede a **data em que ela aconteceu**,
  já preenchida com hoje. A data pode ser corrigida depois clicando nela. Não são aceitas datas
  futuras nem fora da ordem das etapas. Desmarcar uma etapa pede confirmação.
- Dois alertas de atraso (prazo configurável em `diasParado`, `js/config.js`; padrão 15 dias):
  **paradas** são empresas já iniciadas e sem movimentação há 15+ dias (contando da última etapa);
  **não iniciadas atrasadas** são empresas importadas há 15+ dias sem nenhuma etapa marcada.
- **Marcar etapa em lote:** selecione empresas (caixas à esquerda, disponível para todos os perfis)
  e use **Marcar etapa…**: escolha a etapa e a data; o sistema mostra quantas serão marcadas e
  quantas serão puladas (já marcadas, falta a etapa anterior, data fora de ordem).
- A tela se atualiza sozinha quando outra pessoa altera uma empresa (tempo real), e recarrega ao
  voltar para a aba depois de 1 minuto fora.

As regras ficam no banco (`supabase/schema.sql`), e não só na tela. Por isso não dá para
burlá-las pelo navegador.

## Perfis de acesso

| | Administrador | Usuário |
|---|---|---|
| Ver empresas | todas | só as atribuídas a ele |
| Marcar etapas / registrar resposta | sim | sim (nas dele) |
| Importar PDF, atribuir responsável, excluir | sim | não |
| Ver outros usuários e o histórico de alterações | sim | não |

## Como colocar no ar

### 1. Criar o projeto no Supabase (banco + login)

1. Crie uma conta em <https://supabase.com> e clique em **New project**. O plano gratuito atende.
   Escolha a região **South America (São Paulo)**.
2. No projeto, abra **SQL Editor → New query**, cole todo o conteúdo de
   [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Authentication → Sign In / Providers → Email**, **desative "Allow new users to sign up"**.
   Assim só entra quem você cadastrar.

### 2. Criar os usuários

1. Em **Authentication → Users → Add user → Create new user**, informe e-mail e senha e marque
   **Auto Confirm User**. Faça isso para você e para cada pessoa da equipe.
2. Torne a sua conta administradora. No **SQL Editor**, rode:

   ```sql
   update public.perfis set papel = 'admin' where email = 'seu-email@exemplo.com';
   ```

3. (Opcional) Ajuste os nomes exibidos:

   ```sql
   update public.perfis set nome = 'Fulano' where email = 'fulano@exemplo.com';
   ```

### 3. Configurar o site

Em **Project Settings → API Keys**, copie a **Publishable key** (`sb_publishable_...`); a URL é `https://<id-do-projeto>.supabase.co`. Cole as duas
em [`js/config.js`](js/config.js). A chave publicável é feita para ficar no site: quem protege os
dados são as regras de acesso do banco. **Nunca** coloque a **Secret key** (`sb_secret_...`) no site.

### 4. Publicar no GitHub Pages

1. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**,
   branch `main`, pasta `/ (root)` → **Save**.
2. Em alguns minutos o site fica disponível em
   `https://<seu-usuario>.github.io/acompanhaIR/`.
3. No Supabase, em **Authentication → URL Configuration**, coloque esse endereço em **Site URL**.

> Em conta gratuita do GitHub, o Pages só funciona com repositório **público**. O código pode ser
> público sem problema: os dados ficam no Supabase, protegidos por login. Para manter o
> repositório privado, use o GitHub Pro ou publique de graça pelo Cloudflare Pages, Netlify ou
> Vercel, conectando o repositório.

## Uso no dia a dia

1. **Importar PDF** (admin): selecione o relatório geral. O sistema lê município, UF, ano, empresas,
   CNPJ e a coluna **Diferença** (cálculo), e confere a quantidade e a soma com o total do
   relatório. Município, UF e ano ficam em campos editáveis: se o PDF não trouxer o ano (ou
   qualquer um deles), digite. Escolha o responsável e clique em **Importar**. Empresas que já existem no mesmo
   município e ano são ignoradas, então reimportar o mesmo PDF não duplica nada.
   **PDFs gerados por versões antigas do IRnotas** cortavam o texto que não cabia na coluna. O sistema
   recalcula o último dígito do CNPJ pelo dígito verificador (conferindo com o penúltimo),
   completa os nomes cortados pela Receita Federal (BrasilAPI, com alternativas) e, quando o CNPJ
   veio ilegível, pede para digitá-lo na prévia. Nomes e CNPJs dessas linhas podem ser editados
   antes de importar.
   Se o município já estiver cadastrado com outra grafia (com/sem acento, pontuação), a importação
   usa a grafia cadastrada. Grafias diferentes já existentes aparecem num aviso no Acompanhamento,
   com o botão **Unificar** (empresas que seriam duplicadas não são movidas: use **Ver duplicadas**
   e arquive as repetidas).
2. **Distribuir** (admin): na aba Acompanhamento, selecione empresas e use **Atribuir**, ou troque
   o responsável linha a linha.
3. **Acompanhar**: cada usuário marca as etapas das suas empresas. Para o admin, a lista vem
   **agrupada por município/ano e recolhida**: cada município mostra um resumo (empresas, valor,
   em andamento, paradas, pagas, impugnadas, autos) e abre ao clicar. A caixa de seleção do
   município marca todas as empresas dele, para atribuir o município inteiro de uma vez.
   Busca por texto ou filtro de município abrem os grupos automaticamente. O admin filtra por usuário,
   município ou situação, vê o resumo na aba **Usuários** e clica no nome da empresa para ver o
   histórico de quem marcou o quê e quando.
4. **Exportar CSV**: baixa a visão filtrada para abrir no Excel (células que começariam com `=`, `+`,
   `-` ou `@` recebem um apóstrofo na frente, para o Excel não executá-las como fórmula).
5. **Arquivar** (admin): no lugar de excluir, selecione as empresas e use **Arquivar**. Elas saem da
   lista e da visão dos usuários, mas o andamento e o histórico ficam guardados; para ver ou restaurar,
   use o filtro **Situação → Arquivadas**. Ações com mais de 20 empresas pedem que você digite a
   palavra de confirmação.
6. **Backup completo** (admin, aba Usuários): baixa um arquivo `.json` com todas as empresas
   (inclusive arquivadas), o histórico e os usuários. O plano gratuito do Supabase não tem backup
   restaurável: faça esse backup com regularidade (por exemplo, toda semana) e guarde o arquivo.

> **Plano gratuito do Supabase:** o projeto é pausado após 7 dias sem uso, e o site para até alguém
> reativá-lo no painel do Supabase (Project → Restore). Com uso semanal isso não acontece.

## Estrutura

```
index.html            telas (login, acompanhamento, usuários, importação)
css/style.css         estilos (tema claro/escuro automático)
js/config.js          URL e chave pública do Supabase
js/app.js             lógica da interface
js/fluxo.js           regras das etapas e situação do processo
js/pdf-parser.js      leitura do relatório geral em PDF (pdf.js)
supabase/schema.sql   tabelas, validação das etapas, histórico e regras de acesso (RLS)
vendor/               bibliotecas (supabase-js, pdf.js) servidas pelo próprio site — ver vendor/README.md
```

Não há etapa de build: são arquivos estáticos. As bibliotecas (supabase-js e pdf.js) ficam na pasta
`vendor/`, copiadas dos pacotes oficiais do npm: o site não executa código de servidores de terceiros.

## Publicando uma nova versão

O GitHub Pages guarda os arquivos em cache por até 10 minutos. A cada publicação, altere **só** a
linha `window.ACOMPANHAIR_VERSAO = '…'` no topo do `index.html`: o número vai no endereço do CSS e
dos scripts (o navegador busca todos os arquivos novos juntos) e aparece no selo do cabeçalho.

## Atualizando o banco

Quando uma versão mudar o `supabase/schema.sql`, rode o arquivo inteiro de novo no SQL Editor do
Supabase. Ele foi escrito para ser executado sobre um banco existente sem perder dados.
