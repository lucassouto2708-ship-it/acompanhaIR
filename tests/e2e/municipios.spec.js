// Visão do admin agrupada por município: recolhida, resumo alinhado, teclado, responsável, filtros.
const { test, expect } = require('@playwright/test');
const { abrirApp, semear, entrar, banco, isoAtras } = require('../apoio/app');

const grupo = (page, lote) => page.locator(`tr.grupo[data-lote="${lote}"]`);
const empresasVisiveis = (page) => page.locator('#tabela tbody tr:not(.grupo)');

async function preparar(page) {
  await abrirApp(page);
  const lista = [];
  let id = 1;
  for (const [mun, ano, n] of [['LEOPOLDINA', 2025, 5], ['LEOPOLDINA', 2024, 4], ['MANTENA', 2025, 6]]) {
    for (let i = 0; i < n; i++) {
      lista.push({ id, municipio: mun, ano, empresa: `${mun} EMPRESA ${i + 1}`, cnpj: String(10000000000000 + id), criado_em: isoAtras(40),
        ...(mun === 'MANTENA' && i < 2 ? { notificacao_elaboracao_em: isoAtras(20) } : {}) });
      id++;
    }
  }
  await semear(page, lista);
  await entrar(page);
}

test('começa recolhido, com resumo por município alinhado às colunas', async ({ page }) => {
  await preparar(page);
  await expect(page.locator('#tabela tbody tr.grupo')).toHaveCount(3);
  await expect(empresasVisiveis(page)).toHaveCount(0);
  await expect(grupo(page, 'MANTENA/MG 2025')).toContainText('6 empresas');
  await expect(grupo(page, 'MANTENA/MG 2025').locator('.fracao').first()).toHaveText('2/6');
  await expect(grupo(page, 'MANTENA/MG 2025')).toContainText('2 paradas');
  await expect(grupo(page, 'MANTENA/MG 2025')).toContainText('4 não iniciadas');
  // o nome aparece em todos os anos; o ano fica sempre na mesma posição
  await expect(grupo(page, 'LEOPOLDINA/MG 2024').locator('.grupo-nome strong')).toHaveText('LEOPOLDINA/MG');
  const xs = await page.locator('.grupo-ano').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
});

test('abre e fecha pelo mouse e pelo teclado (Enter/Espaço), mantendo o foco', async ({ page }) => {
  await preparar(page);
  await grupo(page, 'MANTENA/MG 2025').locator('.grupo-qtd').click();
  await expect(empresasVisiveis(page)).toHaveCount(6);
  await grupo(page, 'MANTENA/MG 2025').locator('.grupo-nome').click();
  await expect(empresasVisiveis(page)).toHaveCount(0);

  await grupo(page, 'LEOPOLDINA/MG 2025').locator('.grupo-nome').focus();
  await page.keyboard.press('Enter');
  await expect(empresasVisiveis(page)).toHaveCount(5);
  await expect(grupo(page, 'LEOPOLDINA/MG 2025').locator('.grupo-nome')).toBeFocused();
  await expect(grupo(page, 'LEOPOLDINA/MG 2025').locator('.grupo-nome')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press(' ');
  await expect(empresasVisiveis(page)).toHaveCount(0);
});

test('responsável do município: atribui todas as empresas de uma vez', async ({ page }) => {
  await preparar(page);
  await grupo(page, 'MANTENA/MG 2025').locator('select[data-acao=responsavel-grupo]').selectOption('b');
  await expect(page.locator('#dlg-confirmar')).toBeVisible();
  await page.click('#conf-ok');
  await expect(page.locator('#aviso')).toContainText('6 empresa(s) de MANTENA/MG 2025 atribuída(s) a Ana');
  expect((await banco(page)).processos.filter((p) => p.responsavel_id === 'b')).toHaveLength(6);
  await expect(grupo(page, 'MANTENA/MG 2025').locator('select[data-acao=responsavel-grupo] option:checked')).toHaveText('Ana');
});

test('busca e filtros abrem os municípios automaticamente', async ({ page }) => {
  await preparar(page);
  await page.fill('#f-busca', 'EMPRESA 1');
  await expect(empresasVisiveis(page)).toHaveCount(3);
  await page.fill('#f-busca', '10000000000007'); // busca por CNPJ continua funcionando
  await expect(empresasVisiveis(page)).toHaveCount(1);
  await page.fill('#f-busca', '');
  await page.selectOption('#f-status', 'parado');
  await expect(empresasVisiveis(page)).toHaveCount(2);
  await page.selectOption('#f-status', 'nao_iniciada');
  await expect(empresasVisiveis(page)).toHaveCount(13);
});
