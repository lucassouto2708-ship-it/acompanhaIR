// Gestão de usuários pelo admin (aba Usuários), com a Edge Function "usuarios" simulada.
const { test, expect } = require('@playwright/test');
const { abrirApp, semear, entrar, sair, banco } = require('../apoio/app');

const linhaUsuario = (page, texto) => page.locator('#tabela-usuarios tbody tr', { hasText: texto });

async function abaUsuarios(page) {
  await entrar(page);
  await page.click('[data-aba=usuarios]');
}

test('cadastrar usuário: senha gerada, dados para enviar e a pessoa já entra', async ({ page }) => {
  await abrirApp(page);
  await abaUsuarios(page);
  await page.click('#btn-novo-usuario');
  const senha = await page.inputValue('#usr-senha');
  expect(senha).toMatch(/^[A-Za-z2-9]{12}$/);
  await page.fill('#usr-nome', '  Bruno   Lima ');
  await page.fill('#usr-email', 'Bruno@Empresa.com');
  await page.click('#usr-salvar');
  await expect(page.locator('#dlg-credenciais')).toBeVisible();
  await expect(page.locator('#cred-texto')).toContainText('E-mail: bruno@empresa.com');
  await expect(page.locator('#cred-texto')).toContainText(`Senha: ${senha}`);
  await page.click('#dlg-credenciais .dlg-rodape [data-fechar]');
  await expect(linhaUsuario(page, 'bruno@empresa.com')).toContainText('Bruno Lima');
  expect(await page.evaluate(() => window.__SENHAS['bruno@empresa.com'])).toBe(senha);
  // já aparece para receber empresas
  await page.click('[data-aba=acompanhamento]');
  await expect(page.locator('#f-responsavel option', { hasText: 'Bruno Lima' })).toHaveCount(1);
  await sair(page);
  await entrar(page, 'bruno@empresa.com');
  await expect(page.locator('#usuario-papel')).toHaveText('Usuário');
});

test('validações: e-mail inválido, senha curta e e-mail já cadastrado', async ({ page }) => {
  await abrirApp(page);
  await abaUsuarios(page);
  await page.click('#btn-novo-usuario');
  await page.fill('#usr-nome', 'X');
  await page.fill('#usr-email', 'nao-e-email');
  await page.click('#usr-salvar');
  await expect(page.locator('#aviso')).toContainText('E-mail inválido');
  await page.fill('#usr-email', 'x@x.com');
  await page.fill('#usr-senha', '123');
  await page.click('#usr-salvar');
  await expect(page.locator('#aviso')).toContainText('pelo menos 8');
  await page.fill('#usr-email', 'ana@x.com');
  await page.click('#usr-gerar');
  await page.click('#usr-salvar');
  await expect(page.locator('#aviso')).toContainText('Já existe um usuário com este e-mail');
  await expect(page.locator('#dlg-usuario')).toBeVisible();
});

test('editar nome e papel; o admin não pode rebaixar a si mesmo', async ({ page }) => {
  await abrirApp(page);
  await abaUsuarios(page);
  await linhaUsuario(page, 'ana@x.com').locator('[data-editar]').click();
  await expect(page.locator('#usr-email')).toBeDisabled();
  await expect(page.locator('#usr-bloco-senha')).toBeHidden();
  await page.fill('#usr-nome', 'Ana Souza');
  await page.selectOption('#usr-papel', 'admin');
  await page.click('#usr-salvar');
  await expect(page.locator('#aviso')).toContainText('Usuário atualizado');
  await expect(linhaUsuario(page, 'ana@x.com')).toContainText('Ana Souza');
  await expect(linhaUsuario(page, 'ana@x.com')).toContainText('Administrador');
  await linhaUsuario(page, 'admin@x.com').locator('[data-editar]').click();
  await expect(page.locator('#usr-papel')).toBeDisabled();
});

test('nova senha: gera, confirma e mostra para enviar', async ({ page }) => {
  await abrirApp(page);
  await abaUsuarios(page);
  await linhaUsuario(page, 'ana@x.com').locator('[data-senha]').click();
  await page.click('#conf-ok');
  await expect(page.locator('#cred-titulo')).toHaveText('Senha redefinida');
  const texto = await page.textContent('#cred-texto');
  const senha = texto.match(/Senha: (\S+)/)[1];
  expect(await page.evaluate(() => window.__SENHAS['ana@x.com'])).toBe(senha);
});

test('bloquear: a pessoa não entra, some das opções de responsável e pode ser desbloqueada', async ({ page }) => {
  await abrirApp(page);
  await semear(page, [{ id: 1, municipio: 'MANTENA', empresa: 'EMPRESA DA ANA', cnpj: '10000000000001', responsavel_id: 'b' }]);
  await abaUsuarios(page);
  await expect(linhaUsuario(page, 'admin@x.com').locator('[data-bloquear]')).toHaveCount(0); // não bloqueia a si mesmo
  await linhaUsuario(page, 'ana@x.com').locator('[data-bloquear]').click();
  await expect(page.locator('#conf-mensagem')).toContainText('responsável por 1 empresa');
  await page.click('#conf-ok');
  await expect(page.locator('#aviso')).toContainText('Acesso bloqueado');
  await expect(linhaUsuario(page, 'ana@x.com')).toContainText('Bloqueado');
  await page.click('[data-aba=acompanhamento]');
  await expect(page.locator('#sel-responsavel option', { hasText: 'Ana' })).toHaveCount(0);
  await page.click('#btn-expandir');
  await expect(page.locator('#tabela select[data-acao=responsavel] option:checked')).toHaveText('Ana (bloqueado)');
  await sair(page);
  await page.fill('[name=email]', 'ana@x.com');
  await page.fill('[name=senha]', 'qualquer');
  await page.press('[name=senha]', 'Enter');
  await expect(page.locator('#login-erro')).toHaveText('Seu acesso está bloqueado. Fale com o administrador.');
  await entrar(page);
  await page.click('[data-aba=usuarios]');
  await linhaUsuario(page, 'ana@x.com').locator('[data-bloquear]').click();
  await page.click('#conf-ok');
  await expect(page.locator('#aviso')).toContainText('Acesso liberado');
  expect((await banco(page)).perfis.find((p) => p.id === 'b').bloqueado).toBe(false);
});

test('função não publicada no Supabase: mensagem explica o que fazer', async ({ page }) => {
  await abrirApp(page);
  await abaUsuarios(page);
  await page.evaluate(() => { window.__FUNCAO_AUSENTE = true; });
  await page.click('#btn-novo-usuario');
  await page.fill('#usr-nome', 'Bruno');
  await page.fill('#usr-email', 'bruno@x.com');
  await page.click('#usr-salvar');
  await expect(page.locator('#aviso')).toContainText('ainda não foi publicada no Supabase');
});
