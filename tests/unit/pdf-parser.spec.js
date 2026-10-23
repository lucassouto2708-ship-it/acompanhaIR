// Leitura do relatório em PDF (sem navegador), com PDFs sintéticos nos dois formatos.
const { test, expect } = require('@playwright/test');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { lerPdf, parseRelatorio, interpretarCnpj, cnpjValido } = require('../../js/pdf-parser.js');
const { gerarRelatorio, empresasFicticias, cnpjFicticio } = require('../apoio/pdfs.js');

const ler = (buf) => lerPdf(pdfjs, new Uint8Array(buf));

test.describe('leitura do PDF', () => {
  test('formato atual: todas as empresas, nomes em duas linhas, soma confere com o TOTAL', async () => {
    const empresas = empresasFicticias(20); // 2 páginas
    const r = await ler(gerarRelatorio({ cabecalhoMunicipio: 'CIDADE TESTE 2024/MG', empresas }));
    expect(r.municipio).toBe('CIDADE TESTE');
    expect(r.uf).toBe('MG');
    expect(r.ano).toBe(2024);
    expect(r.empresas).toHaveLength(20);
    expect(r.totalEmpresasDeclarado).toBe(20);
    expect(r.somaDiferenca).toBeCloseTo(r.totalDiferencaDeclarado, 2);
    expect(r.avisos).toEqual([]);
    r.empresas.forEach((e, i) => {
      expect(e.numero).toBe(i + 1);
      expect(e.empresa).toBe(empresas[i].nome); // inclui os nomes quebrados em duas linhas
      expect(e.cnpj).toBe(empresas[i].cnpj);
      expect(e.cnpjStatus).toBe('ok');
      expect(e.calculo).toBeCloseTo(empresas[i].diferenca, 2);
    });
  });

  test('formato antigo: CNPJ sem o último dígito é recuperado; ilegível é sinalizado; TOTAL vertical', async () => {
    const empresas = empresasFicticias(12);
    const r = await ler(gerarRelatorio({ cabecalhoMunicipio: 'CIDADE ANTIGA/MG', empresas, formato: 'antigo', cnpjIlegivel: { 3: '5' } }));
    expect(r.empresas).toHaveLength(12);
    expect(r.ano).toBeNull();
    expect(r.avisos.some((a) => a.includes('Ano não encontrado'))).toBe(true);
    expect(r.totalDiferencaDeclarado).not.toBeNull(); // TOTAL escrito na vertical foi reconhecido
    expect(r.somaDiferenca).toBeCloseTo(r.totalDiferencaDeclarado, 2);
    r.empresas.forEach((e, i) => {
      if (i === 3) {
        expect(e.cnpjStatus).toBe('ilegivel');
        expect(e.cnpjLido).toBe('5');
      } else {
        expect(e.cnpjStatus).toBe('recuperado');
        expect(e.cnpj).toBe(empresas[i].cnpj);
      }
    });
  });

  test('cabeçalhos de município em vários formatos', () => {
    const casos = [
      ['Município: SÃO JOÃO 2024/MG', ['SÃO JOÃO', 'MG', 2024]],
      ['Município: SÃO JOÃO/MG', ['SÃO JOÃO', 'MG', null]],
      ['Município: SÃO JOÃO - MG', ['SÃO JOÃO', 'MG', null]],
      ['Município: SÃO JOÃO', ['SÃO JOÃO', null, null]],
    ];
    for (const [cabecalho, [municipio, uf, ano]] of casos) {
      const r = parseRelatorio([[{ str: cabecalho, x: 40, y: 535 }]]);
      expect([r.municipio, r.uf, r.ano]).toEqual([municipio, uf, ano]);
    }
  });

  test('CNPJ: completo, recuperável, inválido e ilegível', () => {
    const c = cnpjFicticio(7);
    expect(cnpjValido(c)).toBe(true);
    expect(interpretarCnpj(c)).toEqual({ cnpj: c, status: 'ok' });
    expect(interpretarCnpj(c.slice(0, 13))).toEqual({ cnpj: c, status: 'recuperado' });
    const errado = c.slice(0, 12) + String((Number(c[12]) + 1) % 10); // penúltimo dígito errado
    expect(interpretarCnpj(errado).status).toBe('invalido');
    expect(interpretarCnpj('5').status).toBe('ilegivel');
    expect(cnpjValido('11111111111111')).toBe(false);
  });
});
