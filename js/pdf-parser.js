/*
 * Leitura do "Relatório geral — Notificações de inconsistência de IRRF".
 *
 * O PDF é gerado por sistema (texto selecionável), então trabalhamos com os
 * itens de texto e suas coordenadas: cada linha da tabela é ancorada no número
 * da coluna "#", e os pedaços do nome do credor (que às vezes quebra em 2+
 * linhas) são associados à linha mais próxima na vertical.
 *
 * Versões antigas do gerador cortavam o texto que não cabia na coluna: o CNPJ
 * vinha sem o último dígito (recalculado aqui pelo dígito verificador) e o nome
 * vinha só com a primeira linha (completado depois, na importação, pela Receita).
 */
(function (root) {
  const RE_CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
  const RE_MOEDA = /^R\$\s*-?[\d.]+,\d{2}$/;
  const RE_CNAE = /^\d{4}-\d\/\d{2}$/;
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

  // Dígitos verificadores do CNPJ a partir dos 12 primeiros dígitos.
  function digitosVerificadores(base12) {
    const calc = (nums, pesos) => {
      const soma = nums.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0);
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return `${d1}${d2}`;
  }

  function cnpjValido(c) {
    return /^\d{14}$/.test(c) && !/^(\d)\1{13}$/.test(c) && digitosVerificadores(c.slice(0, 12)) === c.slice(12);
  }

  /**
   * Interpreta o CNPJ lido do PDF.
   * status: 'ok' (completo e válido), 'recuperado' (faltava o último dígito,
   * recalculado e conferido pelo penúltimo), 'invalido' ou 'ilegivel'.
   */
  function interpretarCnpj(lido) {
    const d = somenteDigitos(lido || '');
    if (d.length === 14) return { cnpj: d, status: cnpjValido(d) ? 'ok' : 'invalido' };
    if (d.length === 13) {
      const dv = digitosVerificadores(d.slice(0, 12));
      if (dv[0] === d[12]) return { cnpj: d.slice(0, 12) + dv, status: 'recuperado' };
      return { cnpj: d, status: 'invalido' };
    }
    return { cnpj: d, status: 'ilegivel' };
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

      // Âncoras das linhas: números da coluna "#". Sem o cabeçalho "#", usa os CNPJs completos.
      const cabNumero = itens.find((i) => i.str === '#');
      const ancoras = cabNumero
        ? itens.filter((i) => /^\d+$/.test(i.str) && Math.abs(i.x - cabNumero.x) < 15 && i.y < cabNumero.y)
        : itens.filter((i) => RE_CNPJ.test(i.str));
      const linhas = ancoras.map((a) => ({ y: a.y, numero: cabNumero ? a : null, cnpj: null, nomes: [], diferenca: null }));

      for (const linha of linhas) {
        const naLinha = itens.filter((i) => Math.abs(i.y - linha.y) < 2);
        const valores = naLinha.filter((i) => RE_MOEDA.test(i.str)).sort((a, b) => a.x - b.x);
        if (valores.length) linha.diferenca = valores[valores.length - 1];
        // CNPJ: primeiro trecho numérico depois do nome que não seja CNAE nem valor.
        linha.cnpj = naLinha
          .filter((i) => i !== linha.numero && /^[\d.\/\-]+$/.test(i.str) && /\d/.test(i.str) &&
            !RE_CNAE.test(i.str) && (!linha.numero || i.x > linha.numero.x + 15))
          .sort((a, b) => a.x - b.x)[0] || null;
      }

      // TOTAL: linha com valores que não pertence a nenhuma empresa (o rótulo pode
      // vir na horizontal, "TOTAL", ou na vertical, uma letra por linha).
      const ysEmpresas = linhas.map((l) => l.y);
      const valoresSoltos = itens.filter((i) => RE_MOEDA.test(i.str) &&
        !ysEmpresas.some((y) => Math.abs(y - i.y) < 2));
      if (valoresSoltos.length) {
        const yTotal = Math.min(...valoresSoltos.map((i) => i.y));
        const doTotal = valoresSoltos.filter((i) => Math.abs(i.y - yTotal) < 2).sort((a, b) => a.x - b.x);
        if (doTotal.length >= 2) resultado.totalDiferencaDeclarado = moedaParaNumero(doTotal[doTotal.length - 1].str);
      }
      if (!linhas.length) continue;

      // Pedaços do nome: entre a coluna "#" e a coluna do CNPJ.
      const xsCnpj = linhas.filter((l) => l.cnpj).map((l) => l.cnpj.x);
      const xCnpj = xsCnpj.length ? Math.min(...xsCnpj) : Infinity;
      const xNumeroMax = Math.max(0, ...linhas.filter((l) => l.numero).map((l) => l.numero.x));
      for (const it of itens) {
        if (it.x >= xCnpj - 2 || it.x <= xNumeroMax + 5) continue;
        if (/Munic[ií]pio:/i.test(it.str) || /^(CREDOR|TOTAL|[A-Z])$/.test(it.str)) continue;
        if (RE_MOEDA.test(it.str)) continue;
        let melhor = null;
        for (const l of linhas) {
          const d = Math.abs(l.y - it.y);
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
        const numero = l.numero ? parseInt(l.numero.str, 10) : null;
        const ref = `Linha ${numero ?? '?'}${empresa ? ` (${empresa})` : ''}`;
        const c = interpretarCnpj(l.cnpj ? l.cnpj.str : '');
        if (!empresa) resultado.avisos.push(`${ref}: nome não encontrado.`);
        if (!l.diferenca) resultado.avisos.push(`${ref}: diferença não encontrada.`);
        if (c.status === 'ilegivel' || c.status === 'invalido') {
          resultado.avisos.push(`${ref}: CNPJ ilegível ou inválido no PDF ("${l.cnpj ? l.cnpj.str : ''}"). Digite o CNPJ na tabela abaixo.`);
        }
        resultado.empresas.push({
          numero,
          empresa,
          cnpj: c.cnpj,
          cnpjStatus: c.status,
          cnpjLido: l.cnpj ? l.cnpj.str : '',
          calculo: l.diferenca ? moedaParaNumero(l.diferenca.str) : null,
        });
      }
    }

    const recuperados = resultado.empresas.filter((e) => e.cnpjStatus === 'recuperado').length;
    if (recuperados) {
      resultado.avisos.push(`${recuperados} CNPJ(s) vieram cortados no PDF (sem o último dígito) e foram ` +
        'completados pelo dígito verificador. Os nomes desse PDF também podem estar cortados: ' +
        'o sistema tenta completá-los pela Receita Federal.');
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
    // isEvalSupported: false é a proteção oficial do pdf.js contra a falha CVE-2024-4367
    // (execução de código por um PDF malicioso nas versões anteriores à 4.2.67).
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    const paginas = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      paginas.push(tc.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
    }
    return parseRelatorio(paginas);
  }

  const api = { parseRelatorio, lerPdf, moedaParaNumero, interpretarCnpj, cnpjValido };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
