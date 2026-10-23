// Abre o site nos testes: serve os arquivos do repositório num endereço fictício (http://app/),
// troca o supabase-js pelo Supabase simulado e bloqueia qualquer acesso à internet.
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const FAKE = path.join(__dirname, 'fake-supabase.js');

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} [op]
 * @param {number} [op.diasParado]
 * @param {(cnpj: string) => ({status?: number, razao_social?: string} | null)} [op.receita] simula a BrasilAPI
 * @param {boolean} [op.confirmarDatas] confirma sozinho o diálogo de data (com a data sugerida)
 */
async function abrirApp(page, { diasParado = 15, receita = null, confirmarDatas = false } = {}) {
  const externos = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('/vendor/supabase-js-')) return route.fulfill({ path: FAKE });
    if (url.includes('/js/config.js')) {
      return route.fulfill({
        contentType: 'text/javascript',
        body: `window.ACOMPANHAIR_CONFIG = { supabaseUrl: 'https://teste.supabase.co', supabaseAnonKey: 'k', diasParado: ${diasParado} };`,
      });
    }
    if (url.startsWith('https://brasilapi.com.br/api/cnpj/v1/') && receita) {
      const r = receita(url.split('/').pop()) || { status: 404 };
      return route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    if (url.startsWith('http://app/')) {
      return route.fulfill({ path: path.join(RAIZ, decodeURIComponent(url.slice('http://app/'.length).split('?')[0]) || 'index.html') });
    }
    if (!url.includes('fonts.g')) externos.push(url);
    return route.abort();
  });
  if (confirmarDatas) {
    await page.addInitScript(() => {
      const original = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        original.call(this);
        if (this.id === 'dlg-data') setTimeout(() => this.querySelector('#data-confirmar').click(), 0);
      };
    });
  }
  await page.goto('http://app/index.html');
  await page.waitForSelector('#tela-login:not([hidden])');
  return { externos };
}

/** Coloca empresas no banco simulado (antes do login). */
async function semear(page, processos) {
  await page.evaluate((lista) => {
    const agora = new Date().toISOString();
    for (const p of lista) window.__DB.processos.push({ uf: 'MG', ano: 2025, calculo: 100, criado_em: agora, ...p });
  }, processos);
}

async function entrar(page, email = 'admin@x.com') {
  await page.fill('[name=email]', email);
  await page.fill('[name=senha]', 'senha-de-teste');
  await page.press('[name=senha]', 'Enter');
  await page.waitForSelector('#tela-app:not([hidden])');
  await page.waitForFunction(() => !document.querySelector('#tabela tbody .carregando'));
}

async function sair(page) {
  await page.click('#btn-sair');
  await page.waitForSelector('#tela-login:not([hidden])');
}

/** Dados do banco simulado. */
const banco = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)));

/** Data local (AAAA-MM-DD) de n dias atrás, como o site usa nos campos de data. */
function diaAtras(n) {
  const d = new Date(Date.now() - n * 86400000);
  const z = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
const isoAtras = (n) => new Date(Date.now() - n * 86400000).toISOString();

module.exports = { abrirApp, semear, entrar, sair, banco, diaAtras, isoAtras };
