// Exportação por município (PDF e CSV): só contagens e valores, sem nome nem CNPJ de empresa.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { abrirApp, semear, entrar } = require('../apoio/app');

const EMPRESAS = [
  { id: 1, municipio: 'LEOPOLDINA', empresa: 'PADARIA ALFA LTDA', cnpj: '11111111000191', calculo: 1000, notificacao_elaboracao_em: '2025-01-10T12:00:00Z' },
  { id: 2, municipio: 'LEOPOLDINA', empresa: 'MERCADO BETA SA', cnpj: '22222222000191', calculo: 500.5 },
  { id: 3, municipio: 'MANTENA', empresa: 'FARMACIA GAMA ME', cnpj: '33333333000191', calculo: 250,
    notificacao_elaboracao_em: '2025-01-10T12:00:00Z', entrega_municipio_em: '2025-01-11T12:00:00Z',
    remessa_guia_em: '2025-01-12T12:00:00Z', pagamento: 'pago', pagamento_em: '2025-01-13T12:00:00Z' },
];
const PROIBIDOS = ['PADARIA', 'MERCADO', 'FARMACIA', '11111111', '11.111.111', '33.333.333'];

async function preparar(page) {
  const { externos } = await abrirApp(page);
  await semear(page, EMPRESAS);
  await entrar(page);
  return externos;
}

async function exportar(page, botao) {
  await page.click('#btn-exportar');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click(botao)]);
  await expect(page.locator('#menu-exportar')).toBeHidden();
  return download;
}

async function textoPdf(arquivo) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(arquivo)) }).promise;
  let texto = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    texto += c.items.map((i) => i.str).join(' ') + '\n';
  }
  return texto;
}

test('PDF por município traz os totais da cidade e nenhuma empresa', async ({ page }) => {
  const externos = await preparar(page);
  const download = await exportar(page, '#btn-pdf-municipios');
  expect(download.suggestedFilename()).toMatch(/^acompanhair_municipios_\d{4}-\d{2}-\d{2}\.pdf$/);
  const texto = await textoPdf(await download.path());
  expect(texto).toContain('Resumo por município');
  expect(texto).toContain('LEOPOLDINA/MG');
  expect(texto).toContain('MANTENA/MG');
  expect(texto).toContain('1.500,50'); // valor de Leopoldina
  expect(texto).toContain('1.750,50'); // total geral
  expect(texto).toContain('TOTAL');
  for (const t of PROIBIDOS) expect(texto).not.toContain(t);
  expect(externos).toEqual([]); // biblioteca de PDF vem do próprio site
});

test('CSV por município: uma linha por cidade/ano, com total e sem empresas', async ({ page }) => {
  await preparar(page);
  const download = await exportar(page, '#btn-csv-municipios');
  const csv = fs.readFileSync(await download.path(), 'utf8');
  const linhas = csv.replace(/^﻿/, '').split('\r\n');
  expect(linhas).toHaveLength(4); // cabeçalho + 2 municípios + total
  expect(linhas[1]).toMatch(/^"LEOPOLDINA";"MG";"2025";"2";"1500,5";"1";"0";"0";"0";"0"/);
  expect(linhas[2]).toMatch(/^"MANTENA";"MG";"2025";"1";"250";"1";"1";"1";"1";"250"/);
  expect(linhas[3]).toMatch(/^"TOTAL";"";"";"3";"1750,5"/);
  for (const t of PROIBIDOS) expect(csv).not.toContain(t);
});

test('exportação por município respeita o filtro aplicado', async ({ page }) => {
  await preparar(page);
  await page.selectOption('#f-lote', { label: 'MANTENA/MG 2025' });
  const csv = fs.readFileSync(await (await exportar(page, '#btn-csv-municipios')).path(), 'utf8');
  expect(csv).toContain('"MANTENA"');
  expect(csv).not.toContain('LEOPOLDINA');
});

test('menu Exportar fecha com Esc e devolve o foco', async ({ page }) => {
  await preparar(page);
  await page.click('#btn-exportar');
  await expect(page.locator('#menu-exportar')).toBeVisible();
  await expect(page.locator('#btn-pdf-municipios')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-exportar')).toBeHidden();
  await expect(page.locator('#btn-exportar')).toBeFocused();
});
