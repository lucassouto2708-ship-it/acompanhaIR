// Marcação das etapas: sequência, diálogo de data, confirmações, pagamento, resposta e lote.
const { test, expect } = require('@playwright/test');
const { abrirApp, semear, entrar, banco, diaAtras, isoAtras } = require('../apoio/app');

const linha = (page, nome) => page.locator('#tabela tbody tr', { hasText: nome }).first();
const caixa = (page, nome, campo) => linha(page, nome).locator(`input[data-campo=${campo}]`);

async function preparar(page, extras = []) {
  await abrirApp(page);
  await semear(page, [{ id: 1, municipio: 'MANTENA', empresa: 'EMPRESA A', cnpj: '10000000000001', responsavel_id: 'b', criado_em: isoAtras(60) }, ...extras]);
  await entrar(page, 'ana@x.com');
}

test('etapa só libera após a anterior; marcar pede a data (hoje por padrão) e cancelar desfaz', async ({ page }) => {
  await preparar(page);
  await expect(caixa(page, 'EMPRESA A', 'entrega_municipio_em')).toBeDisabled();
  await caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em').click();
  await expect(page.locator('#dlg-data')).toBeVisible();
  await expect(page.locator('#data-valor')).toHaveValue(diaAtras(0));
  await page.keyboard.press('Escape');
  await expect(caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em')).not.toBeChecked();
  expect((await banco(page)).processos[0].notificacao_elaboracao_em).toBeUndefined();

  await caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em').click();
  await page.fill('#data-valor', diaAtras(10));
  await page.click('#data-confirmar');
  await expect(caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em')).toBeChecked();
  await expect(caixa(page, 'EMPRESA A', 'entrega_municipio_em')).toBeEnabled();
});

test('data fora da ordem ou futura é recusada com o intervalo permitido', async ({ page }) => {
  await preparar(page);
  await caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em').click();
  await page.fill('#data-valor', diaAtras(10));
  await page.click('#data-confirmar');
  await caixa(page, 'EMPRESA A', 'entrega_municipio_em').click();
  await page.fill('#data-valor', diaAtras(20)); // antes da notificação
  await page.click('#data-confirmar');
  await expect(page.locator('#aviso')).toContainText('A data deve estar entre');
  await expect(page.locator('#dlg-data')).toBeVisible();
  await page.fill('#data-valor', diaAtras(-3)); // futura
  await page.click('#data-confirmar');
  await expect(page.locator('#aviso')).toContainText('A data deve estar entre');
  expect((await banco(page)).processos[0].entrega_municipio_em).toBeUndefined();
});

test('corrigir a data clicando nela não desmarca; desmarcar pede confirmação', async ({ page }) => {
  await preparar(page);
  await caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em').click();
  await page.fill('#data-valor', diaAtras(10));
  await page.click('#data-confirmar');
  await linha(page, 'EMPRESA A').locator('.data-etapa').click();
  await expect(page.locator('#data-titulo')).toContainText('Corrigir data');
  await page.fill('#data-valor', diaAtras(8));
  await page.click('#data-confirmar');
  await expect(caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em')).toBeChecked();

  await caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em').click();
  await expect(page.locator('#dlg-confirmar')).toBeVisible();
  await page.click('#dlg-confirmar .dlg-rodape [data-fechar]');
  await expect(caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em')).toBeChecked();
  await caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em').click();
  await page.click('#conf-ok');
  await expect(caixa(page, 'EMPRESA A', 'notificacao_elaboracao_em')).not.toBeChecked();
});

test('não pago → impugnação → resposta com teor (limite e contador) → auto de infração', async ({ page }) => {
  await abrirApp(page, { confirmarDatas: true });
  await semear(page, [{ id: 1, municipio: 'MANTENA', empresa: 'EMPRESA A', cnpj: '10000000000001', responsavel_id: 'b',
    notificacao_elaboracao_em: isoAtras(9), entrega_municipio_em: isoAtras(8), remessa_guia_em: isoAtras(7) }]);
  await entrar(page, 'ana@x.com');
  await linha(page, 'EMPRESA A').locator('button[data-valor=nao_pago]').click();
  await expect(linha(page, 'EMPRESA A')).toContainText('Não pago');
  await caixa(page, 'EMPRESA A', 'impugnacao_em').click();
  await expect(caixa(page, 'EMPRESA A', 'auto_infracao_em')).toBeDisabled(); // aguarda a resposta
  await linha(page, 'EMPRESA A').locator('button[data-acao=resposta]').click();
  await page.selectOption('[name=resultado]', 'indeferida');
  await page.fill('[name=teor]', 'x'.repeat(10050));
  expect((await page.inputValue('[name=teor]')).length).toBe(10000);
  await expect(page.locator('#resp-contador')).toHaveText('10.000 / 10.000 caracteres');
  await page.fill('[name=teor]', 'Mantida a cobrança.');
  await page.click('#resp-salvar');
  await caixa(page, 'EMPRESA A', 'auto_infracao_em').click();
  await expect(linha(page, 'EMPRESA A').locator('.situacao')).toHaveText('Auto de infração');
  const p = (await banco(page)).processos[0];
  expect([p.pagamento, p.resposta_resultado, p.resposta_teor, !!p.auto_infracao_em]).toEqual(['nao_pago', 'indeferida', 'Mantida a cobrança.', true]);
});

test('marcar etapa em lote: marca as aptas e informa as puladas (usuário comum também pode)', async ({ page }) => {
  await abrirApp(page);
  const lista = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, municipio: 'MANTENA', empresa: `EMPRESA ${i + 1}`, cnpj: String(10000000000000 + i + 1), responsavel_id: 'b',
    ...(i < 3 ? { notificacao_elaboracao_em: isoAtras(10) } : {}) }));
  await semear(page, lista);
  await entrar(page, 'ana@x.com');
  await page.check('#sel-todos');
  await expect(page.locator('#btn-atribuir')).toBeHidden();
  await expect(page.locator('#btn-arquivar')).toBeHidden();
  await page.click('#btn-marcar-lote');
  await page.selectOption('#lote-etapa', 'entrega_municipio_em');
  await page.fill('#lote-data', diaAtras(2));
  await page.dispatchEvent('#lote-data', 'input');
  await expect(page.locator('#lote-resumo')).toContainText('3 empresas serão marcadas');
  await expect(page.locator('#lote-resumo')).toContainText('3 puladas: falta a etapa anterior');
  await page.click('#lote-ok');
  await expect(page.locator('#aviso')).toContainText('3 empresa(s) marcada(s); 3 pulada(s)');
  expect((await banco(page)).processos.filter((p) => p.entrega_municipio_em)).toHaveLength(3);
});
