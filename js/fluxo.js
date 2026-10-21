/*
 * Regras do fluxo das etapas (espelham a validação feita no banco).
 *
 *   Notificação elaboração → Entrega município → Remessa notificação c/ guia → Pagamento
 *     Pago      → encerrado
 *     Não pago  → Impugnação (opcional) → Resposta impugnação (teor) → Auto de infração
 *                 (impugnação deferida encerra; sem impugnação, pode ir direto ao auto)
 */
(function (root) {
  const ETAPAS_LINEARES = ['notificacao_elaboracao_em', 'entrega_municipio_em', 'remessa_guia_em'];

  const RESULTADOS = {
    deferida: 'Deferida',
    parcial: 'Parcialmente deferida',
    indeferida: 'Indeferida',
  };

  /** O que pode ser marcado/desmarcado agora em cada etapa. */
  function permissoes(p) {
    const naoPago = p.pagamento === 'nao_pago';
    return {
      notificacao_elaboracao_em: !p.entrega_municipio_em,
      entrega_municipio_em: !!p.notificacao_elaboracao_em && !p.remessa_guia_em,
      remessa_guia_em: !!p.entrega_municipio_em && !p.pagamento,
      pagamento: p.pagamento
        ? !(p.impugnacao_em || p.auto_infracao_em) // só desfaz se nada veio depois
        : !!p.remessa_guia_em,
      impugnacao_em: naoPago && !p.resposta_em && !p.auto_infracao_em,
      resposta: naoPago && !!p.impugnacao_em && !p.auto_infracao_em,
      auto_infracao_em: naoPago &&
        (!p.impugnacao_em || !!p.resposta_em) &&
        p.resposta_resultado !== 'deferida',
    };
  }

  /** Situação do processo: { chave, texto, encerrado }. */
  function situacao(p, agora = new Date(), diasParado = 30) {
    if (p.pagamento === 'pago') return { chave: 'pago', texto: 'Pago — encerrado', encerrado: true };
    if (p.resposta_resultado === 'deferida') {
      return { chave: 'deferida', texto: 'Impugnação deferida — encerrado', encerrado: true };
    }
    if (p.auto_infracao_em) return { chave: 'auto', texto: 'Auto de infração', encerrado: true };

    let texto;
    let chave = 'andamento';
    if (p.resposta_em) texto = 'Resposta recebida';
    else if (p.impugnacao_em) { texto = 'Impugnado — aguardando resposta'; chave = 'impugnado'; }
    else if (p.pagamento === 'nao_pago') texto = 'Não pago';
    else if (p.remessa_guia_em) { texto = 'Aguardando pagamento'; chave = 'aguardando_pagamento'; }
    else if (p.entrega_municipio_em) texto = 'Entregue ao município';
    else if (p.notificacao_elaboracao_em) texto = 'Notificação elaborada';
    else texto = 'Não iniciado';

    const ultima = ultimaMovimentacao(p);
    const parado = ultima && (agora - ultima) / 86400000 >= diasParado;
    return { chave, texto, encerrado: false, parado };
  }

  function ultimaMovimentacao(p) {
    const datas = [...ETAPAS_LINEARES, 'pagamento_em', 'impugnacao_em', 'resposta_em', 'auto_infracao_em']
      .map((c) => p[c])
      .filter(Boolean)
      .map((d) => new Date(d));
    if (!datas.length) return p.criado_em ? new Date(p.criado_em) : null;
    return new Date(Math.max(...datas));
  }

  function correspondeFiltro(p, filtro, agora, diasParado) {
    const s = situacao(p, agora, diasParado);
    switch (filtro) {
      case '': return true;
      case 'andamento': return !s.encerrado;
      case 'parado': return !s.encerrado && s.parado;
      case 'impugnado': return !!p.impugnacao_em;
      default: return s.chave === filtro;
    }
  }

  const api = { permissoes, situacao, correspondeFiltro, RESULTADOS, ETAPAS_LINEARES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fluxo = api;
})(typeof window !== 'undefined' ? window : globalThis);
