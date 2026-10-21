/*
 * Leitura do "Relatório geral — Notificações de inconsistência de IRRF".
 *
 * O PDF é gerado por sistema (texto selecionável), então trabalhamos com os
 * itens de texto e suas coordenadas: cada linha da tabela é ancorada no CNPJ,
 * e os pedaços do nome do credor (que às vezes quebra em 2+ linhas) são
 * associados ao CNPJ mais próximo na vertical.
 */
(function (root) {
  const RE_CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
  const RE_MOEDA = /^R\$\s*-?[\d.]+,\d{2}$/;
  // "Município: NOME 2024/MG", "Município: NOME/MG" ou só "Município: NOME".
  const RE_MUNICIPIO = /Munic[ií]pio:\s*(.+?)(?:\s+(\d{4}))?\s*\/\s*([A-Z]{2})\b/i;
  const RE_MUNICIPIO_SIMPLES = /Munic[ií]pio:\s*(.+?)(?:\s+(\d{4}))?\s*(?:[—–-]\s*([A-Z]{2})\b|[—–-]\s|$)/i;
  const RE_ANO = /\b(?:exerc[ií]cio|ano|compet[eê]ncia)\s*:?\s*(\d{4})\b/i;
  const RE_TOTAL_EMPRESAS = /(\d+)\s+empresas?/i;
  // Distância vertical máxima (pt) entre um pedaço do nome e a linha do CNPJ.
  const TOLERANCIA_Y = 12;

  function moedaParaNumero(txt) {
    const limpo = txt.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.');
    return Math.round(parseFloat(limpo) * 100) / 100;
  }

  function somenteDigitos(txt) {
    return txt.replace(/\D/g, '');
  }

  /**
   * @param {Array<Array<{str: string, x: number, y: number}>>} paginas
   *   itens de texto de cada página (y cresce para cima, como no PDF).
   */
  function parseRelatorio(paginas) {
    const resultado = {
      municipio: null,
      uf: null,
      ano: null,
      totalEmpresasDeclarado: null,
      totalDiferencaDeclarado: null,
      empresas: [],
      avisos: [],
    };

    for (const itensBrutos of paginas) {
      const itens = itensBrutos
        .map((i) => ({ str: i.str.trim(), x: i.x, y: i.y }))
        .filter((i) => i.str);

      for (const it of itens) {
        const m = it.str.match(RE_MUNICIPIO) || it.str.match(RE_MUNICIPIO_SIMPLES);
        if (m && !resultado.municipio) {
          resultado.municipio = m[1].trim();
          if (m[2]) resultado.ano = parseInt(m[2], 10);
          if (m[3]) resultado.uf = m[3].toUpperCase();
        }
        const a = it.str.match(RE_ANO);
        if (a && resultado.ano === null) resultado.ano = parseInt(a[1], 10);
        const t = it.str.match(RE_TOTAL_EMPRESAS);
        if (t && resultado.totalEmpresasDeclarado === null && /diverg/i.test(it.str)) {
          resultado.totalEmpresasDeclarado = parseInt(t[1], 10);
        }
      }

      // Linha de TOTAL: última coluna monetária na mesma altura de "TOTAL".
      const total = itens.find((i) => /^TOTAL$/i.test(i.str));
      if (total) {
        const valores = itens
          .filter((i) => Math.abs(i.y - total.y) < 2 && RE_MOEDA.test(i.str))
          .sort((a, b) => a.x - b.x);
        if (valores.length) {
          resultado.totalDiferencaDeclarado = moedaParaNumero(valores[valores.length - 1].str);
        }
      }

      const linhas = itens
        .filter((i) => RE_CNPJ.test(i.str))
        .map((c) => ({ cnpj: c, nomes: [], numero: null, diferenca: null }));
      if (!linhas.length) continue;

      for (const linha of linhas) {
        const naLinha = itens.filter((i) => Math.abs(i.y - linha.cnpj.y) < 2);
        const valores = naLinha.filter((i) => RE_MOEDA.test(i.str)).sort((a, b) => a.x - b.x);
        if (valores.length) linha.diferenca = valores[valores.length - 1];
        const numero = naLinha.filter((i) => /^\d+$/.test(i.str) && i.x < linha.cnpj.x)
          .sort((a, b) => a.x - b.x)[0];
        if (numero) linha.numero = numero;
      }

      // Pedaços do nome: à esquerda do CNPJ, depois da coluna "#".
      const xCnpj = Math.min(...linhas.map((l) => l.cnpj.x));
      const xNumeroMax = Math.max(0, ...linhas.filter((l) => l.numero).map((l) => l.numero.x));
      for (const it of itens) {
        if (it.x >= xCnpj - 2 || it.x <= xNumeroMax + 5) continue;
        if (/Munic[ií]pio:/i.test(it.str)) continue;
        let melhor = null;
        for (const l of linhas) {
          const d = Math.abs(l.cnpj.y - it.y);
          if (d <= TOLERANCIA_Y && (!melhor || d < melhor.d)) melhor = { l, d };
        }
        if (melhor) melhor.l.nomes.push(it);
      }

      for (const l of linhas) {
        const empresa = l.nomes
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((n) => n.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!empresa) resultado.avisos.push(`Nome não encontrado para o CNPJ ${l.cnpj.str}`);
        if (!l.diferenca) resultado.avisos.push(`Diferença não encontrada para o CNPJ ${l.cnpj.str}`);
        resultado.empresas.push({
          numero: l.numero ? parseInt(l.numero.str, 10) : null,
          empresa,
          cnpj: somenteDigitos(l.cnpj.str),
          calculo: l.diferenca ? moedaParaNumero(l.diferenca.str) : null,
        });
      }
    }

    const soma = resultado.empresas.reduce((s, e) => s + (e.calculo || 0), 0);
    resultado.somaDiferenca = Math.round(soma * 100) / 100;

    if (!resultado.municipio) resultado.avisos.push('Município não encontrado no PDF: preencha o campo Município.');
    if (resultado.ano === null) resultado.avisos.push('Ano não encontrado no PDF: preencha o campo Ano.');
    if (resultado.totalEmpresasDeclarado !== null &&
        resultado.totalEmpresasDeclarado !== resultado.empresas.length) {
      resultado.avisos.push(
        `O relatório informa ${resultado.totalEmpresasDeclarado} empresas, mas foram lidas ${resultado.empresas.length}.`);
    }
    if (resultado.totalDiferencaDeclarado !== null) {
      // O TOTAL do relatório é somado antes do arredondamento de cada linha,
      // então até meio centavo por empresa de diferença é esperado.
      const desvio = Math.abs(resultado.totalDiferencaDeclarado - resultado.somaDiferenca);
      const tolerancia = 0.005 * resultado.empresas.length + 0.01;
      if (desvio > tolerancia) {
        resultado.avisos.push('A soma das diferenças lidas não confere com o TOTAL do relatório.');
      }
    }
    return resultado;
  }

  /** Extrai os itens de texto de um arquivo PDF usando pdf.js (navegador). */
  async function lerPdf(pdfjsLib, arrayBuffer) {
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const paginas = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      paginas.push(tc.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
    }
    return parseRelatorio(paginas);
  }

  const api = { parseRelatorio, lerPdf, moedaParaNumero };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
