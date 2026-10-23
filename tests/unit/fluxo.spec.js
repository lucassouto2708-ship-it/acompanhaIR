// Regras do fluxo das etapas (js/fluxo.js), sem navegador.
const { test, expect } = require('@playwright/test');
const Fluxo = require('../../js/fluxo.js');

const AGORA = new Date('2026-10-23T15:00:00Z');
const dias = (n) => new Date(AGORA - n * 86400000).toISOString();

test.describe('permissões das etapas', () => {
  test('sequência linear: cada etapa só libera após a anterior', () => {
    expect(Fluxo.permissoes({}).notificacao_elaboracao_em).toBe(true);
    expect(Fluxo.permissoes({}).entrega_municipio_em).toBe(false);
    const p = { notificacao_elaboracao_em: dias(3) };
    expect(Fluxo.permissoes(p).entrega_municipio_em).toBe(true);
    expect(Fluxo.permissoes({ ...p, entrega_municipio_em: dias(2) }).notificacao_elaboracao_em).toBe(false); // trava a anterior
  });

  test('pagamento: pago encerra; não pago libera impugnação e auto', () => {
    const base = { notificacao_elaboracao_em: dias(3), entrega_municipio_em: dias(2), remessa_guia_em: dias(1) };
    expect(Fluxo.permissoes(base).pagamento).toBe(true);
    expect(Fluxo.permissoes({ ...base, pagamento: 'pago' }).impugnacao_em).toBe(false);
    const naoPago = { ...base, pagamento: 'nao_pago' };
    expect(Fluxo.permissoes(naoPago).impugnacao_em).toBe(true);
    expect(Fluxo.permissoes(naoPago).auto_infracao_em).toBe(true);
    const impugnado = { ...naoPago, impugnacao_em: dias(1) };
    expect(Fluxo.permissoes(impugnado).auto_infracao_em).toBe(false); // aguarda a resposta
    expect(Fluxo.permissoes({ ...impugnado, resposta_em: dias(0), resposta_resultado: 'deferida' }).auto_infracao_em).toBe(false);
    expect(Fluxo.permissoes({ ...impugnado, resposta_em: dias(0), resposta_resultado: 'indeferida' }).auto_infracao_em).toBe(true);
  });
});

test.describe('situação e alertas', () => {
  test('parada (iniciada sem movimento) x não iniciada atrasada', () => {
    expect(Fluxo.situacao({ criado_em: dias(20) }, AGORA, 15)).toMatchObject({ parado: false, atrasada: true });
    expect(Fluxo.situacao({ criado_em: dias(5) }, AGORA, 15)).toMatchObject({ parado: false, atrasada: false });
    expect(Fluxo.situacao({ criado_em: dias(40), notificacao_elaboracao_em: dias(20) }, AGORA, 15)).toMatchObject({ parado: true, atrasada: false });
    expect(Fluxo.situacao({ criado_em: dias(40), notificacao_elaboracao_em: dias(14) }, AGORA, 15)).toMatchObject({ parado: false });
  });

  test('encerramentos', () => {
    expect(Fluxo.situacao({ pagamento: 'pago' }).chave).toBe('pago');
    expect(Fluxo.situacao({ resposta_resultado: 'deferida' }).chave).toBe('deferida');
    expect(Fluxo.situacao({ auto_infracao_em: dias(1) }).chave).toBe('auto');
  });
});

test.describe('limites de data', () => {
  test('cada data fica entre a etapa anterior e a seguinte (e no máximo hoje)', () => {
    const p = { notificacao_elaboracao_em: '2026-10-01T15:00:00Z', entrega_municipio_em: '2026-10-05T15:00:00Z' };
    expect(Fluxo.limitesData(p, 'remessa_guia_em', AGORA)).toEqual({ min: '2026-10-05', max: '2026-10-23' });
    expect(Fluxo.limitesData(p, 'notificacao_elaboracao_em', AGORA)).toEqual({ min: null, max: '2026-10-05' });
  });
});
