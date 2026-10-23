// Gera PDFs sintéticos com o mesmo layout do "Relatório geral — Notificações de
// inconsistência de IRRF" (gerado pelo IRnotas com jsPDF), com dados FICTÍCIOS.
// Os relatórios reais não entram no repositório: ele é público e eles trazem dados fiscais.
//
// Formatos:
//  - 'atual':  CNPJ completo, nomes longos quebrados em duas linhas, "TOTAL" na horizontal;
//  - 'antigo': como as versões antigas do IRnotas — CNPJ sem o último dígito (ou ilegível),
//              nome só com a primeira linha e "TOTAL" escrito na vertical.
const { jsPDF } = require('jspdf');

const ALTURA = 595.28; // A4 paisagem, em pontos
const COLUNAS = { numero: 50.2, credor: 73.7, cnpj: 283.5, cnae: 379.8, bruto: 455.2, devido: 556.9, retido: 667.5, diferenca: 738.4 };
const PRIMEIRA_LINHA = 480.1; // y (de baixo para cima, como no PDF) da 1ª empresa
const PASSO = 26.2;
const POR_PAGINA = 16;

function digitosVerificadores(base12) {
  const calc = (nums, pesos) => {
    const r = nums.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${d2}`;
}

/** CNPJ fictício e válido a partir de um número de ordem. */
function cnpjFicticio(n) {
  const base = String(90000000 + n).padStart(8, '0') + '0001';
  return base + digitosVerificadores(base);
}

const formatarCnpj = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const moeda = (v) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Empresas fictícias: [{ nome, cnpj, diferenca }]. Algumas com nome longo (duas linhas).
 */
function empresasFicticias(qtd) {
  const nomes = ['ALFA SERVICOS LTDA', 'BETA CONSULTORIA E PLANEJAMENTO EMPRESARIAL LTDA', 'GAMA ENGENHARIA LTDA',
    'DELTA COMERCIO DE MATERIAIS HOSPITALARES E EQUIPAMENTOS LTDA', 'EPSILON EVENTOS LTDA', 'ZETA TRANSPORTES LTDA'];
  return Array.from({ length: qtd }, (_, i) => ({
    nome: `${nomes[i % nomes.length]} ${i + 1}`,
    cnpj: cnpjFicticio(i + 1),
    diferenca: Math.round((5000 - i * 37.13) * 100) / 100,
  }));
}

/** Quebra o nome em linhas de até ~34 caracteres (largura da coluna CREDOR). */
function quebrarNome(nome) {
  const linhas = [''];
  for (const palavra of nome.split(' ')) {
    const atual = linhas[linhas.length - 1];
    if ((atual + ' ' + palavra).trim().length > 34) linhas.push(palavra);
    else linhas[linhas.length - 1] = (atual + ' ' + palavra).trim();
  }
  return linhas;
}

/**
 * @param {object} op
 * @param {string} op.cabecalhoMunicipio  ex.: 'CIDADE TESTE 2024/MG' ou 'CIDADE TESTE/MG'
 * @param {Array}  op.empresas            [{ nome, cnpj, diferenca }]
 * @param {'atual'|'antigo'} [op.formato]
 * @param {Object<number,string>} [op.cnpjIlegivel] índice → texto que aparece no lugar do CNPJ (formato antigo)
 * @returns {Buffer}
 */
function gerarRelatorio({ cabecalhoMunicipio, empresas, formato = 'atual', cnpjIlegivel = {} }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const escrever = (texto, x, yPdf, tamanho = 8.5, negrito = false) => {
    doc.setFont('helvetica', negrito ? 'bold' : 'normal');
    doc.setFontSize(tamanho);
    doc.text(String(texto), x, ALTURA - yPdf);
  };
  const cabecalhoTabela = () => {
    const y = 506.3;
    escrever('#', COLUNAS.numero, y, 8, true);
    escrever('CREDOR', 152.8, y, 8, true);
    escrever('CNPJ', 312.5, y, 8, true);
    escrever('CNAE', 391.2, y, 8, true);
    escrever('VALOR BRUTO', 450.1, y, 8, true);
    escrever('IRRF DEVIDO', 544.0, y, 8, true);
    escrever('IRRF RETIDO', 635.0, y, 8, true);
    escrever('DIFERENÇA', 727.9, y, 8, true);
  };

  escrever('RELATÓRIO GERAL — NOTIFICAÇÕES DE INCONSISTÊNCIA DE IRRF', 39.7, 552.8, 12, true);
  escrever(`Município: ${cabecalhoMunicipio}`, 39.7, 535.8, 9);
  escrever(`— ${empresas.length} empresas com divergência`, 260, 535.8, 9);
  cabecalhoTabela();

  let total = 0;
  empresas.forEach((e, i) => {
    if (i > 0 && i % POR_PAGINA === 0) {
      doc.addPage();
      cabecalhoTabela();
    }
    const y = PRIMEIRA_LINHA - (i % POR_PAGINA) * PASSO;
    total += e.diferenca;
    escrever(i + 1, COLUNAS.numero, y);
    const linhasNome = quebrarNome(e.nome);
    if (formato === 'antigo' || linhasNome.length === 1) {
      escrever(linhasNome[0], COLUNAS.credor, y); // o gerador antigo só imprimia a 1ª linha
    } else {
      escrever(linhasNome[0], COLUNAS.credor, y + 5);
      escrever(linhasNome.slice(1).join(' '), COLUNAS.credor, y - 5);
    }
    const cnpjTexto = formato === 'antigo'
      ? (cnpjIlegivel[i] ?? formatarCnpj(e.cnpj).slice(0, -1)) // sem o último dígito
      : formatarCnpj(e.cnpj);
    escrever(cnpjTexto, COLUNAS.cnpj, y);
    escrever('6209-1/00', COLUNAS.cnae, y);
    escrever(moeda(e.diferenca * 20), COLUNAS.bruto, y);
    escrever(moeda(e.diferenca), COLUNAS.devido, y);
    escrever(moeda(0), COLUNAS.retido, y);
    escrever(moeda(e.diferenca), COLUNAS.diferenca, y);
  });

  const yTotal = PRIMEIRA_LINHA - (empresas.length % POR_PAGINA || POR_PAGINA) * PASSO - 10;
  if (formato === 'antigo') {
    'TOTAL'.split('').forEach((letra, k) => escrever(letra, COLUNAS.numero, yTotal + 20 - k * 10, 8, true));
  } else {
    escrever('TOTAL', COLUNAS.numero, yTotal, 8, true);
  }
  escrever(moeda(total * 20), COLUNAS.bruto, yTotal);
  escrever(moeda(total), COLUNAS.devido, yTotal);
  escrever(moeda(0), COLUNAS.retido, yTotal);
  escrever(moeda(total), COLUNAS.diferenca, yTotal);

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { gerarRelatorio, empresasFicticias, cnpjFicticio, digitosVerificadores, formatarCnpj };
