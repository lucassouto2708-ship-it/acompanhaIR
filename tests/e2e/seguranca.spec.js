// Volume (>1.000), arquivamento, confirmações, CSV seguro, backup, grafias e tempo real.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { abrirApp, semear, entrar, banco } = require('../apoio/app');

const muitas = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => ({ id: i + 1, municipio: `CIDADE ${i % 10}`, empresa: `EMPRESA ${i + 1}`, cnpj: String(10000000000000 + i + 1), ...extra(i) }));

test('mais de 1.000 empresas: todas aparecem (leitura paginada)', async ({ page }) => {
  await abrirApp(page);
  await semear(page, muitas(1150));
  await entrar(page);
  await expect(page.locator('#tabela-rodape')).toContainText('Exibindo 1150 de 1150');
  expect(await page.evaluate(() => window.__CONTAGEM.consultas)).toBeGreaterThanOrEqual(2);
});

test('arquivar em massa exige digitar a palavra; arquivadas somem e podem ser restauradas', async ({ page }) => {
  await abrirApp(page);
  await semear(page, muitas(30, () => ({ municipio: 'MANTENA', responsavel_id: 'b' })));
  await entrar(page);
  await page.check('#sel-todos');
  await page.click('#btn-arquivar');
  await expect(page.locator('#conf-palavra')).toHaveText('ARQUIVAR');
  await expect(page.locator('#conf-ok')).toBeDisabled();
  await page.fill('#conf-input', 'arquiv');
  await expect(page.locator('#conf-ok')).toBeDisabled();
  await page.fill('#conf-input', 'arquivar');
  await page.press('#conf-input', 'Enter');
  await expect(page.locator('#aviso')).toContainText('30 empresa(s) arquivada(s)');
  const db = await banco(page);
  expect(db.processos).toHaveLength(30); // nada foi apagado
  expect(db.processos.every((p) => p.arquivado_em)).toBe(true);
  expect(await page.evaluate(() => window.__CONTAGEM.updates)).toBe(1); // 30 ids → 1 lote

  await page.selectOption('#f-status', 'arquivadas');
  await expect(page.locator('#btn-arquivar-texto')).toHaveText('Restaurar');
  await page.locator('#tabela tbody tr:not(.grupo) input[data-acao=selecionar]').first().check();
  await page.click('#btn-arquivar');
  await page.click('#conf-ok');
  await expect(page.locator('#aviso')).toContainText('1 empresa(s) restaurada(s)');
});

test('atribuir muitas empresas vai em lotes de 200', async ({ page }) => {
  await abrirApp(page);
  await semear(page, muitas(450));
  await entrar(page);
  await page.check('#sel-todos');
  await page.selectOption('#sel-responsavel', 'b');
  await page.click('#btn-atribuir');
  await page.fill('#conf-input', 'ATRIBUIR');
  await page.click('#conf-ok');
  await expect(page.locator('#aviso')).toContainText('450 empresa(s) atribuída(s)');
  expect(await page.evaluate(() => window.__CONTAGEM.updates)).toBe(3);
  expect((await banco(page)).processos.every((p) => p.responsavel_id === 'b')).toBe(true);
});

test('exportação CSV não deixa o Excel executar fórmulas', async ({ page }) => {
  await abrirApp(page);
  await semear(page, [{ id: 1, municipio: 'MANTENA', empresa: '+CMD|calc', cnpj: '10000000000001', resposta_teor: '=HYPERLINK("http://x.com";"clique")' }]);
  await entrar(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  expect(csv).toContain(`"'+CMD|calc"`);
  expect(csv).toContain(`"'=HYPERLINK(`);
  expect(csv).not.toMatch(/;"[=+@-]/);
});

test('backup completo inclui arquivadas, histórico e usuários', async ({ page }) => {
  await abrirApp(page);
  await semear(page, muitas(5, (i) => (i === 0 ? { arquivado_em: new Date().toISOString() } : {})));
  await entrar(page);
  await page.click('[data-aba=usuarios]');
  await expect(page.locator('#backup-info')).toHaveText('Nenhum backup feito neste computador.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-backup')]);
  const dados = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(dados.processos).toHaveLength(5);
  expect(dados.processos.filter((p) => p.arquivado_em)).toHaveLength(1);
  expect(dados.perfis).toHaveLength(2);
  await expect(page.locator('#backup-info')).toContainText('Último backup neste computador');
});

test('grafias diferentes do mesmo município: unifica sem mover duplicadas', async ({ page }) => {
  await abrirApp(page);
  await semear(page, [
    { id: 1, municipio: 'SÃO JOÃO', ano: 2024, empresa: 'A', cnpj: '10000000000001' },
    { id: 2, municipio: 'SÃO JOÃO', ano: 2024, empresa: 'B', cnpj: '10000000000002', arquivado_em: new Date().toISOString() },
    { id: 3, municipio: 'SAO JOAO', ano: 2024, empresa: 'A dup', cnpj: '10000000000001' },
    { id: 4, municipio: 'SAO JOAO', ano: 2024, empresa: 'B dup (da arquivada)', cnpj: '10000000000002' },
    { id: 5, municipio: 'Sao Joao', ano: 2024, empresa: 'C', cnpj: '10000000000003' },
    { id: 6, municipio: 'SÃO JOÃO', ano: 2024, empresa: 'D', cnpj: '10000000000006' },
  ]);
  await entrar(page);
  await expect(page.locator('#aviso-grafia')).toContainText('Possível município duplicado');
  await page.click('[data-unificar="0"]');
  await page.click('#conf-ok');
  await expect(page.locator('#aviso')).toContainText('1 empresa(s) unificada(s) em SÃO JOÃO. 2 duplicada(s)');
  const nomes = Object.fromEntries((await banco(page)).processos.map((p) => [p.id, p.municipio]));
  // empate em 2 ativas (SÃO JOÃO x SAO JOAO): fica a grafia com acento
  expect(nomes).toEqual({ 1: 'SÃO JOÃO', 2: 'SÃO JOÃO', 3: 'SAO JOAO', 4: 'SAO JOAO', 5: 'SÃO JOÃO', 6: 'SÃO JOÃO' });
  await expect(page.locator('[data-ver-duplicadas="0"]')).toBeVisible();
});

test('tempo real: mudança de outra pessoa aparece; empresa reatribuída some para o usuário', async ({ page }) => {
  await abrirApp(page);
  await semear(page, muitas(3, () => ({ municipio: 'MANTENA', responsavel_id: 'b' })));
  await entrar(page, 'ana@x.com');
  await page.evaluate(() => {
    const p = window.__DB.processos[0];
    p.notificacao_elaboracao_em = new Date().toISOString();
    window.__RT_CB({ eventType: 'UPDATE', new: { ...p }, old: { id: p.id } });
  });
  await expect(page.locator('#tabela tbody tr', { hasText: 'EMPRESA 1' }).locator('input[data-campo=notificacao_elaboracao_em]')).toBeChecked();
  await page.evaluate(() => {
    const p = window.__DB.processos[1];
    p.responsavel_id = 'a';
    window.__RT_CB({ eventType: 'UPDATE', new: { ...p }, old: { id: p.id } });
  });
  await expect(page.locator('#tabela tbody tr', { hasText: 'EMPRESA 2' })).toHaveCount(0);
});
