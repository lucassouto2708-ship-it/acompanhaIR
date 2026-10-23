// Configuração dos testes automáticos (rodar dentro da pasta tests/: `npm test`).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: ['unit/**/*.spec.js', 'e2e/**/*.spec.js'],
  timeout: 60000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: true,
  },
});
