// Login, perfis (admin x usuário comum), saída e tema.
const { test, expect } = require('@playwright/test');
const { abrirApp, semear, entrar, sair } = require('../apoio/app');

const empresas = (n, resp) => Array.from({ length: n }, (_, i) => ({ id: i + 1, municipio: 'MANTENA', empresa: `EMPRESA ${i + 1}`, cnpj: String(10000000000000 + i + 1), responsavel_id: resp(i) }));

test('mostrar/ocultar a senha no login, e ela volta a ficar oculta ao entrar', async ({ page }) => {
  await abrirApp(page);
  await page.fill('[name=senha]', 'MinhaSenha');
  await page.click('#btn-ver-senha');
  await expect(page.locator('#login-senha')).toHaveAttribute('type', 'text');
  await page.click('#btn-ver-senha');
  await expect(page.locator('#login-senha')).toHaveAttribute('type', 'password');
  await page.click('#btn-ver-senha');
  await page.fill('[name=email]', 'admin@x.com');
  await page.click('#form-login button[type=submit]');
  await page.waitForSelector('#tela-app:not([hidden])');
  await expect(page.locator('#login-senha')).toHaveAttribute('type', 'password');
});

test('usuário comum vê só as próprias empresas, sem funções de admin nem valores totais', async ({ page }) => {
  await abrirApp(page);
  await semear(page, empresas(10, (i) => (i < 6 ? 'b' : 'a')));
  await entrar(page, 'ana@x.com');
  await expect(page.locator('#tabela tbody tr')).toHaveCount(6);
  await expect(page.locator('[data-aba=importar]')).toBeHidden();
  await expect(page.locator('[data-aba=usuarios]')).toBeHidden();
  await expect(page.locator('#tabela th', { hasText: 'Responsável' })).toBeHidden();
  const resumo = (await page.textContent('#resumo')) + (await page.textContent('#tabela-rodape'));
  expect(resumo).not.toContain('R$');
  await expect(page.locator('#f-status option[value=arquivadas]')).toHaveCount(0);
});

test('admin vê tudo, com valores totais', async ({ page }) => {
  await abrirApp(page);
  await semear(page, empresas(10, (i) => (i < 6 ? 'b' : null)));
  await entrar(page);
  await expect(page.locator('#tabela-rodape')).toContainText('Exibindo 10 de 10');
  await expect(page.locator('#resumo')).toContainText('Cálculo total R$');
  await expect(page.locator('#resumo')).toContainText('de 10 CNPJs diferentes');
});

test('sair limpa a tela: o próximo usuário não vê os dados do anterior', async ({ page }) => {
  await abrirApp(page);
  await semear(page, empresas(5, () => 'a'));
  await entrar(page);
  await page.click('#btn-expandir');
  await expect(page.locator('#tabela tbody tr:not(.grupo)')).toHaveCount(5);
  await sair(page);
  await expect(page.locator('#tabela tbody tr')).toHaveCount(0);
  await expect(page.locator('#resumo')).toBeEmpty();
});

test('tema claro é o padrão mesmo com o sistema em modo escuro; a escolha fica salva', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await abrirApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
  await entrar(page);
  await page.click('#btn-tema');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'escuro');
  expect(await page.evaluate(() => localStorage.getItem('acompanhair-tema'))).toBe('escuro');
  await ctx.close();
});

test('o site não carrega código de servidores externos e mostra a versão', async ({ page }) => {
  const { externos } = await abrirApp(page);
  await entrar(page);
  expect(externos).toEqual([]);
  const versao = await page.evaluate(() => window.ACOMPANHAIR_VERSAO);
  await expect(page.locator('#versao')).toHaveText(`v${versao}`);
  expect(await page.evaluate(() => pdfjsLib.GlobalWorkerOptions.workerSrc)).toContain('/vendor/pdfjs-');
});

test('indicador "Pagas": admin vê o valor recuperado em destaque e as guias embaixo; usuário vê só a quantidade', async ({ page }) => {
  await abrirApp(page);
  await semear(page, empresas(4, () => 'b').map((e, i) => ({ ...e, calculo: 1000 + i,
    ...(i < 3 ? { notificacao_elaboracao_em: new Date().toISOString(), entrega_municipio_em: new Date().toISOString(),
      remessa_guia_em: new Date().toISOString(), pagamento: 'pago', pagamento_em: new Date().toISOString() } : {}) })));
  await entrar(page);
  const pagas = page.locator('.indicador', { hasText: 'Pagas' });
  await expect(pagas.locator('strong')).toHaveText('R$ 3.003,00');
  await expect(pagas.locator('small')).toHaveText('3 guias pagas');
  await expect(pagas).toHaveClass(/ok/);
  await sair(page);
  await entrar(page, 'ana@x.com');
  await expect(pagas.locator('strong')).toHaveText('3');
  await expect(pagas.locator('small')).toHaveText('75% das empresas');
});
