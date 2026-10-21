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
- Processos em andamento sem movimentação há 30 dias ou mais (pela data da última etapa)
  aparecem como **parados** (o prazo é configurável em `js/config.js`).

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
2. **Distribuir** (admin): na aba Acompanhamento, selecione empresas e use **Atribuir**, ou troque
   o responsável linha a linha.
3. **Acompanhar**: cada usuário marca as etapas das suas empresas. Para o admin, a lista vem
   **agrupada por município/ano e recolhida**: cada município mostra um resumo (empresas, valor,
   em andamento, paradas, pagas, impugnadas, autos) e abre ao clicar. A caixa de seleção do
   município marca todas as empresas dele, para atribuir o município inteiro de uma vez.
   Busca por texto ou filtro de município abrem os grupos automaticamente. O admin filtra por usuário,
   município ou situação, vê o resumo na aba **Usuários** e clica no nome da empresa para ver o
   histórico de quem marcou o quê e quando.
4. **Exportar CSV**: baixa a visão filtrada para abrir no Excel.

## Estrutura

```
index.html            telas (login, acompanhamento, usuários, importação)
css/style.css         estilos (tema claro/escuro automático)
js/config.js          URL e chave pública do Supabase
js/app.js             lógica da interface
js/fluxo.js           regras das etapas e situação do processo
js/pdf-parser.js      leitura do relatório geral em PDF (pdf.js)
supabase/schema.sql   tabelas, validação das etapas, histórico e regras de acesso (RLS)
```

Não há etapa de build: são arquivos estáticos. As bibliotecas (supabase-js e pdf.js) são
carregadas de CDN com versão fixa.
