// Importação do relatório em PDF (PDFs sintéticos; a Receita é simulada).
const { test, expect } = require('@playwright/test');
const { abrirApp, semear, entrar, banco } = require('../apoio/app');
const { gerarRelatorio, empresasFicticias, cnpjFicticio } = require('../apoio/pdfs');

const arquivo = (nome, buffer) => ({ name: nome, mimeType: 'application/pdf', buffer });

async function carregarPdf(page, buffer) {
  await page.click('[data-aba=importar]');
  await page.setInputFiles('#arquivo-pdf', arquivo('relatorio.pdf', buffer));
  await page.waitForSelector('#previa:not([hidden])');
}

test('importa o relatório atual, atribui responsável e não duplica ao reimportar', async ({ page }) => {
  const empresas = empresasFicticias(20);
  const pdf = gerarRelatorio({ cabecalhoMunicipio: 'CIDADE TESTE 2024/MG', empresas });
  await abrirApp(page);
  await entrar(page);
  await carregarPdf(page, pdf);
  await expect(page.locator('#imp-municipio')).toHaveValue('CIDADE TESTE');
  await expect(page.locator('#imp-ano')).toHaveValue('2024');
  await expect(page.locator('#btn-importar')).toHaveText('Importar 20 empresas');
  await page.selectOption('#imp-responsavel', 'b');
  await page.click('#btn-importar');
  await page.waitForSelector('#aba-acompanhamento:not([hidden])');
  const db = await banco(page);
  expect(db.processos).toHaveLength(20);
  expect(db.processos.every((p) => p.responsavel_id === 'b' && p.municipio === 'CIDADE TESTE' && p.ano === 2024)).toBe(true);

  await carregarPdf(page, pdf);
  await expect(page.locator('#btn-importar')).toHaveText('Importar 0 empresas');
  await expect(page.locator('#tabela-previa .etiqueta', { hasText: 'já cadastrada' })).toHaveCount(20);
});

test('PDF sem ano: pede o ano antes de importar', async ({ page }) => {
  await abrirApp(page);
  await entrar(page);
  await carregarPdf(page, gerarRelatorio({ cabecalhoMunicipio: 'CIDADE SEM ANO/MG', empresas: empresasFicticias(3) }));
  await expect(page.locator('#imp-ano')).toHaveValue('');
  await page.click('#btn-importar');
  await expect(page.locator('#aviso')).toContainText('Informe o ano');
  expect((await banco(page)).processos).toHaveLength(0);
  await page.fill('#imp-ano', '2025');
  await page.dispatchEvent('#imp-ano', 'change');
  await page.click('#btn-importar');
  await page.waitForSelector('#aba-acompanhamento:not([hidden])');
  expect((await banco(page)).processos.every((p) => p.ano === 2025)).toBe(true);
});

test('município já cadastrado com outra grafia: usa a grafia cadastrada', async ({ page }) => {
  const empresas = empresasFicticias(3);
  await abrirApp(page);
  await semear(page, [{ id: 1, municipio: 'SÃO JOÃO DO PARAISO', ano: 2024, empresa: 'X', cnpj: empresas[0].cnpj }]);
  await entrar(page);
  await carregarPdf(page, gerarRelatorio({ cabecalhoMunicipio: 'SAO JOAO DO PARAISO 2024/MG', empresas }));
  await expect(page.locator('#imp-municipio')).toHaveValue('SÃO JOÃO DO PARAISO');
  await expect(page.locator('#imp-grafia')).toContainText('usando a grafia cadastrada');
  await expect(page.locator('#tabela-previa .etiqueta', { hasText: 'já cadastrada' })).toHaveCount(1);
});

test('PDF antigo: recupera CNPJs, completa nomes pela Receita e pede o CNPJ ilegível', async ({ page }) => {
  const empresas = empresasFicticias(6);
  const manual = cnpjFicticio(500);
  await abrirApp(page, {
    receita: (cnpj) => {
      if (cnpj === manual) return { razao_social: 'EMPRESA DIGITADA A MAO LTDA' };
      const e = empresas.find((x) => x.cnpj === cnpj);
      return e ? { razao_social: e.nome + ' COMPLETO' } : null;
    },
  });
  await entrar(page);
  await carregarPdf(page, gerarRelatorio({ cabecalhoMunicipio: 'CIDADE ANTIGA 2023/MG', empresas, formato: 'antigo', cnpjIlegivel: { 2: '7' } }));
  await expect(page.locator('#imp-status')).toContainText('Nomes completados pela Receita: 5 de 5', { timeout: 20000 });
  const linhas = page.locator('#tabela-previa tbody tr');
  await expect(linhas.nth(0).locator('.campo-nome')).toHaveValue(/COMPLETO$/);
  await expect(linhas.nth(0)).toContainText('dígito recalculado');
  await expect(linhas.nth(2).locator('input[type=checkbox]')).toBeDisabled(); // sem CNPJ não entra
  await expect(page.locator('#btn-importar')).toHaveText('Importar 5 empresas (1 sem CNPJ)');

  await linhas.nth(2).locator('.campo-cnpj').fill('11.111.111/1111-11');
  await linhas.nth(2).locator('.campo-cnpj').press('Tab');
  await expect(page.locator('#aviso')).toContainText('CNPJ inválido');
  await linhas.nth(2).locator('.campo-cnpj').fill(manual);
  await linhas.nth(2).locator('.campo-cnpj').press('Tab');
  await expect(linhas.nth(2).locator('.campo-nome')).toHaveValue('EMPRESA DIGITADA A MAO LTDA');
  await expect(page.locator('#btn-importar')).toHaveText('Importar 6 empresas');
  await page.click('#btn-importar');
  await page.waitForSelector('#aba-acompanhamento:not([hidden])');
  const db = await banco(page);
  expect(db.processos).toHaveLength(6);
  expect(db.processos.every((p) => /^\d{14}$/.test(p.cnpj))).toBe(true);
});
