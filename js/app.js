/* AcompanhaIR — interface (HTML + JS puro, sem build). */
(function () {
  const cfg = window.ACOMPANHAIR_CONFIG || {};
  const DIAS_PARADO = cfg.diasParado || 30;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const estado = {
    perfil: null,      // perfil do usuário logado
    perfis: [],        // todos os perfis (só admin)
    processos: [],
    selecionados: new Set(),
    importacao: null,  // resultado da leitura do PDF
    respostaId: null,  // processo aberto no diálogo de resposta
    ordem: { campo: 'calculo', dir: 'desc' },
  };

  // ------------------------------------------------------------------ util

  const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const moeda = (v) => fmtMoeda.format(Number(v) || 0);
  const data = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
  const cnpjFmt = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ehAdmin = () => estado.perfil?.papel === 'admin';
  const nomePerfil = (id) => {
    const p = estado.perfis.find((x) => x.id === id);
    return p ? (p.nome || p.email) : '';
  };
  const lote = (p) => `${p.municipio}${p.uf ? '/' + p.uf : ''} ${p.ano}`;

  let avisoTimer;
  function avisar(msg, tipo = 'erro') {
    const el = $('#aviso');
    el.textContent = msg;
    el.className = `aviso ${tipo}`;
    el.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function mostrarTela(id) {
    for (const t of ['tela-config', 'tela-login', 'tela-app']) $('#' + t).hidden = t !== id;
  }

  // Alternador de tema (padrão: claro). A escolha fica salva no navegador.
  $('#btn-tema').addEventListener('click', () => {
    const raiz = document.documentElement;
    raiz.dataset.theme = raiz.dataset.theme === 'escuro' ? 'claro' : 'escuro';
    try { localStorage.setItem('acompanhair-tema', raiz.dataset.theme); } catch (e) { /* ignora */ }
  });

  for (const b of $$('[data-fechar]')) b.addEventListener('click', () => b.closest('dialog').close());

  // ------------------------------------------------------------------ início

  if (!cfg.supabaseUrl || cfg.supabaseUrl.includes('SEU-PROJETO') || !window.supabase) {
    mostrarTela('tela-config');
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'SIGNED_OUT' || !sessao) {
      estado.perfil = null;
      mostrarTela('tela-login');
    } else if (!estado.perfil || estado.perfil.id !== sessao.user.id) {
      iniciarSessao(sessao.user);
    }
  });

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const erro = $('#login-erro');
    erro.hidden = true;
    const entrar = f.querySelector('button[type="submit"]');
    entrar.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
    entrar.disabled = false;
    if (!error) mostrarSenha(false);
    if (error) {
      erro.textContent = 'E-mail ou senha inválidos.';
      erro.hidden = false;
    }
  });

  function mostrarSenha(visivel) {
    const b = $('#btn-ver-senha');
    $('#login-senha').type = visivel ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(visivel));
    b.title = visivel ? 'Ocultar senha' : 'Mostrar senha';
    b.setAttribute('aria-label', b.title);
  }
  $('#btn-ver-senha').addEventListener('click', () => {
    mostrarSenha($('#login-senha').type === 'password');
    $('#login-senha').focus();
  });

  $('#btn-sair').addEventListener('click', () => sb.auth.signOut());

  async function iniciarSessao(user) {
    const { data: perfil, error } = await sb.from('perfis').select('*').eq('id', user.id).single();
    if (error || !perfil) {
      avisar('Perfil não encontrado. Peça ao administrador para verificar seu cadastro.');
      await sb.auth.signOut();
      return;
    }
    estado.perfil = perfil;
    estado.perfis = [perfil];
    document.body.classList.toggle('admin', ehAdmin());
    $('#usuario-nome').textContent = perfil.nome || perfil.email;
    $('#usuario-papel').textContent = ehAdmin() ? 'Administrador' : 'Usuário';
    mostrarTela('tela-app');
    trocarAba('acompanhamento');
    await carregar();
  }

  async function carregar() {
    if (!estado.processos.length) {
      $('#tabela tbody').innerHTML =
        '<tr class="carregando"><td colspan="12"><span class="girando"></span>Carregando empresas…</td></tr>';
      $('#vazio').hidden = true;
    }
    const consultas = [sb.from('processos').select('*').order('calculo', { ascending: false })];
    if (ehAdmin()) consultas.push(sb.from('perfis').select('*').order('nome'));
    const [proc, perf] = await Promise.all(consultas);
    if (proc.error) return avisar('Erro ao carregar: ' + proc.error.message);
    estado.processos = proc.data;
    if (perf && !perf.error) estado.perfis = perf.data;
    estado.selecionados.clear();
    preencherFiltros();
    renderizar();
  }

  // ------------------------------------------------------------------ abas

  $('#abas').addEventListener('click', (e) => {
    const aba = e.target.closest('button')?.dataset.aba;
    if (aba) trocarAba(aba);
  });

  function trocarAba(aba) {
    for (const b of $$('#abas button')) b.classList.toggle('ativa', b.dataset.aba === aba);
    for (const s of ['acompanhamento', 'usuarios', 'importar']) $('#aba-' + s).hidden = s !== aba;
    if (aba === 'usuarios') renderizarUsuarios();
    if (aba === 'importar') preencherSelectResponsavel($('#imp-responsavel'), true);
  }

  // ------------------------------------------------------------------ filtros

  function preencherFiltros() {
    const fLote = $('#f-lote');
    const atual = fLote.value;
    const lotes = [...new Set(estado.processos.map(lote))].sort();
    fLote.innerHTML = '<option value="">Todos os municípios</option>' +
      lotes.map((l) => `<option ${l === atual ? 'selected' : ''}>${esc(l)}</option>`).join('');

    if (ehAdmin()) {
      const fResp = $('#f-responsavel');
      const r = fResp.value;
      fResp.innerHTML = '<option value="">Todos os responsáveis</option><option value="-">Sem responsável</option>' +
        estado.perfis.map((p) => `<option value="${p.id}">${esc(p.nome || p.email)}</option>`).join('');
      fResp.value = r;
      preencherSelectResponsavel($('#sel-responsavel'), true);
    }
  }

  function preencherSelectResponsavel(sel, comVazio) {
    sel.innerHTML = (comVazio ? '<option value="">— sem responsável —</option>' : '') +
      estado.perfis.map((p) => `<option value="${p.id}">${esc(p.nome || p.email)}</option>`).join('');
  }

  for (const id of ['#f-busca', '#f-lote', '#f-status', '#f-responsavel']) {
    $(id).addEventListener('input', renderizar);
  }

  function filtrados() {
    const busca = $('#f-busca').value.trim().toLowerCase();
    const buscaDig = busca.replace(/\D/g, '');
    const fLote = $('#f-lote').value;
    const fStatus = $('#f-status').value;
    const fResp = ehAdmin() ? $('#f-responsavel').value : '';
    const agora = new Date();
    return estado.processos.filter((p) =>
      (!busca || p.empresa.toLowerCase().includes(busca) || (buscaDig && p.cnpj.includes(buscaDig))) &&
      (!fLote || lote(p) === fLote) &&
      (!fResp || (fResp === '-' ? !p.responsavel_id : p.responsavel_id === fResp)) &&
      Fluxo.correspondeFiltro(p, fStatus, agora, DIAS_PARADO));
  }

  // ------------------------------------------------------------------ tabela

  // Ordem das situações na ordenação: do início do fluxo até o encerramento.
  const ORDEM_SITUACAO = ['Não iniciado', 'Notificação elaborada', 'Entregue ao município',
    'Aguardando pagamento', 'Não pago', 'Impugnado — aguardando resposta', 'Resposta recebida',
    'Auto de infração', 'Impugnação deferida — encerrado', 'Pago — encerrado'];

  function ordenar(lista) {
    const { campo, dir } = estado.ordem;
    const agora = new Date();
    const chave = {
      empresa: (p) => p.empresa,
      cnpj: (p) => p.cnpj,
      calculo: (p) => Number(p.calculo),
      situacao: (p) => ORDEM_SITUACAO.indexOf(Fluxo.situacao(p, agora, DIAS_PARADO).texto),
    }[campo];
    const fator = dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = chave(a);
      const vb = chave(b);
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
      return c * fator || Number(b.calculo) - Number(a.calculo);
    });
  }

  // ------------------------------------------------------------------ agrupamento por município (admin)

  const CHAVE_ABERTOS = 'acompanhair-municipios-abertos';
  estado.abertos = new Set((() => {
    try { return JSON.parse(localStorage.getItem(CHAVE_ABERTOS)) || []; } catch (e) { return []; }
  })());
  function salvarAbertos() {
    try { localStorage.setItem(CHAVE_ABERTOS, JSON.stringify([...estado.abertos])); } catch (e) { /* ignora */ }
  }

  // Busca por texto ou município escolhido no filtro abrem os grupos automaticamente,
  // para o resultado não ficar escondido dentro de um município fechado.
  const gruposForcados = () => !!$('#f-busca').value.trim() || !!$('#f-lote').value;

  function agrupar(lista) {
    const grupos = new Map();
    for (const p of lista) {
      const k = lote(p);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    return [...grupos.entries()].sort(([, a], [, b]) =>
      a[0].municipio.localeCompare(b[0].municipio, 'pt-BR') || b[0].ano - a[0].ano);
  }

  // Linha do município alinhada às colunas da tabela: cada coluna de etapa mostra
  // quantas empresas do município já passaram por ela.
  function grupoHtml(chave, itens, aberto, mesmoMunicipioAnterior) {
    const agora = new Date();
    const n = itens.length;
    const conta = (f) => itens.filter(f).length;
    let total = 0;
    let encerradas = 0;
    let paradas = 0;
    let autos = 0;
    for (const p of itens) {
      total += Number(p.calculo);
      const s = Fluxo.situacao(p, agora, DIAS_PARADO);
      if (s.encerrado) encerradas++;
      if (!s.encerrado && s.parado) paradas++;
      if (s.chave === 'auto') autos++;
    }
    const pagas = conta((p) => p.pagamento === 'pago');
    const naoPagas = conta((p) => p.pagamento === 'nao_pago');
    const impugnadas = conta((p) => p.impugnacao_em);
    const respostas = conta((p) => p.resposta_em);

    // Etapa linear: "feitas/total" + barrinha de progresso.
    const fracao = (campo) => {
      const k = conta((p) => p[campo]);
      const tom = k === 0 ? 'zero' : k === n ? 'completo' : '';
      return `<td class="etapa"><span class="fracao ${tom}">${k}<small>/${n}</small></span>
        <span class="mini-barra"><i style="width:${Math.round((k / n) * 100)}%"></i></span></td>`;
    };
    const numero = (k, tom = '') => `<td class="etapa">${k ? `<span class="contagem ${tom}">${k}</span>` : '<span class="traco">—</span>'}</td>`;
    const pagamento = pagas || naoPagas
      ? `<span class="contagem ok">${pagas} ${pagas === 1 ? 'paga' : 'pagas'}</span>
         <span class="contagem alerta">${naoPagas} não</span>`
      : '<span class="traco">—</span>';
    const p0 = itens[0];
    const nome = `${esc(p0.municipio)}${p0.uf ? '/' + esc(p0.uf) : ''}`;

    return `<tr class="grupo ${aberto ? 'aberto' : ''} ${mesmoMunicipioAnterior ? 'mesmo-municipio' : ''}" data-lote="${esc(chave)}">
      <td><input type="checkbox" data-acao="selecionar-grupo" data-lote="${esc(chave)}" title="Selecionar todas as empresas deste município/ano"></td>
      <td class="empresa"><div class="grupo-nome">
        <svg class="ic seta"><use href="#i-seta"/></svg>
        <strong title="${nome}">${nome}</strong>
        <span class="grupo-ano">${p0.ano}</span>
      </div><small class="grupo-qtd">${n} ${n === 1 ? 'empresa' : 'empresas'}</small></td>
      <td class="num nowrap valor">${moeda(total)}</td>
      <td>${seletorResponsavelGrupo(chave, itens)}</td>
      ${fracao('notificacao_elaboracao_em')}
      ${fracao('entrega_municipio_em')}
      ${fracao('remessa_guia_em')}
      <td class="etapa grupo-pagamento">${pagamento}</td>
      ${numero(impugnadas)}
      ${numero(respostas)}
      ${numero(autos, 'erro')}
      <td class="grupo-situacao">
        <span class="${encerradas === n ? 'ok' : ''}">${encerradas}/${n} encerradas</span>
        ${paradas ? `<span class="etiqueta alerta">${paradas} ${paradas === 1 ? 'parada' : 'paradas'}</span>` : ''}
      </td>
    </tr>`;
  }

  // Responsável do município: mostra o atual (ou "Vários") e permite trocar todas as empresas do grupo.
  function seletorResponsavelGrupo(chave, itens) {
    const ids = new Set(itens.map((p) => p.responsavel_id || ''));
    const unico = ids.size === 1 ? [...ids][0] : null;
    const opcoes = estado.perfis.map((u) =>
      `<option value="${u.id}" ${u.id === unico ? 'selected' : ''}>${esc(u.nome || u.email)}</option>`).join('');
    return `<select class="grupo-resp" data-acao="responsavel-grupo" data-lote="${esc(chave)}" title="Responsável por todas as empresas deste município/ano">
        ${unico === null ? `<option value="__varios" selected disabled>Vários (${ids.size})</option>` : ''}
        <option value="" ${unico === '' ? 'selected' : ''}>Nenhum</option>
        ${opcoes}
      </select>`;
  }

  async function atribuirGrupo(chave, responsavel) {
    const ids = filtrados().filter((p) => lote(p) === chave).map((p) => p.id);
    const nome = responsavel ? nomePerfil(responsavel) : 'ninguém (sem responsável)';
    if (!confirm(`Atribuir ${ids.length} empresa(s) de ${chave} a ${nome}?`)) return renderizar();
    const { error } = await sb.from('processos').update({ responsavel_id: responsavel }).in('id', ids);
    if (error) { avisar(error.message); return renderizar(); }
    avisar(`${ids.length} empresa(s) de ${chave} atribuída(s) a ${nome}.`, 'ok');
    await carregar();
  }

  function corpoAgrupado(lista) {
    const forcar = gruposForcados();
    let anterior = null;
    return agrupar(lista).map(([chave, itens]) => {
      const aberto = forcar || estado.abertos.has(chave);
      // Mesmo município em outro ano: nome em tom mais claro, para os anos ficarem visualmente juntos.
      const mesmo = anterior === itens[0].municipio + '/' + itens[0].uf;
      anterior = itens[0].municipio + '/' + itens[0].uf;
      return grupoHtml(chave, itens, aberto, mesmo) + (aberto ? itens.map(linhaHtml).join('') : '');
    }).join('');
  }

  function alternarGrupo(chave) {
    if (gruposForcados()) return; // com busca/filtro de município ativo, tudo fica aberto
    if (estado.abertos.has(chave)) estado.abertos.delete(chave); else estado.abertos.add(chave);
    salvarAbertos();
    renderizar();
  }

  $('#btn-expandir').addEventListener('click', () => {
    for (const p of filtrados()) estado.abertos.add(lote(p));
    salvarAbertos();
    renderizar();
  });
  $('#btn-recolher').addEventListener('click', () => {
    estado.abertos.clear();
    salvarAbertos();
    renderizar();
  });

  function renderizar() {
    const lista = ordenar(filtrados());
    renderizarResumo(lista);
    $('#tabela tbody').innerHTML = ehAdmin() ? corpoAgrupado(lista) : lista.map(linhaHtml).join('');
    $('#vazio').hidden = lista.length > 0;
    if (!lista.length) {
      const semDados = !estado.processos.length;
      $('#vazio-titulo').textContent = semDados ? 'Nenhuma empresa cadastrada' : 'Nenhuma empresa encontrada';
      $('#vazio-texto').textContent = semDados
        ? (ehAdmin() ? 'Importe um relatório geral na aba "Importar PDF" para começar.'
          : 'Ainda não há empresas atribuídas a você. Fale com o administrador.')
        : 'Nenhum registro corresponde aos filtros aplicados. Ajuste a busca ou os filtros.';
    }
    for (const b of $$('#tabela .ordenar')) {
      const ativo = b.dataset.ordem === estado.ordem.campo;
      b.classList.toggle('ativo', ativo);
      b.querySelector('use').setAttribute('href',
        ativo ? (estado.ordem.dir === 'asc' ? '#i-asc' : '#i-desc') : '#i-ordenar');
    }
    const total = lista.reduce((s, p) => s + Number(p.calculo), 0);
    const municipios = new Set(lista.map(lote)).size;
    $('#tabela-rodape').innerHTML = estado.processos.length
      ? `<span>Exibindo <strong>${lista.length}</strong> de <strong>${estado.processos.length}</strong> empresas${ehAdmin()
        ? ` em <strong>${municipios}</strong> ${municipios === 1 ? 'município' : 'municípios'}` : ''}</span>
         ${ehAdmin() ? `<span>Total do cálculo exibido: <strong>${moeda(total)}</strong></span>` : ''}`
      : '';
    atualizarSelecao();
  }

  function renderizarResumo(lista) {
    const agora = new Date();
    const cont = { pago: 0, valorPago: 0, impugnado: 0, auto: 0, valorAuto: 0, parado: 0, andamento: 0, valorAndamento: 0 };
    let total = 0;
    for (const p of lista) {
      total += Number(p.calculo);
      const s = Fluxo.situacao(p, agora, DIAS_PARADO);
      if (s.chave === 'pago') { cont.pago++; cont.valorPago += Number(p.calculo); }
      if (p.impugnacao_em) cont.impugnado++;
      if (s.chave === 'auto') { cont.auto++; cont.valorAuto += Number(p.calculo); }
      if (!s.encerrado) { cont.andamento++; cont.valorAndamento += Number(p.calculo); }
      if (!s.encerrado && s.parado) cont.parado++;
    }
    const pct = (n) => (lista.length ? `${Math.round((n / lista.length) * 100)}% das empresas` : '—');
    const indicador = (titulo, valor, sub, tom = '') =>
      `<div class="indicador ${tom}"><span>${titulo}</span><strong>${valor}</strong><small>${sub}</small></div>`;
    // Valores totais (R$) só para o administrador; o usuário comum vê apenas quantidades.
    const admin = ehAdmin();
    $('#resumo').innerHTML =
      indicador('Empresas notificadas', lista.length, admin ? `Cálculo total ${moeda(total)}` : 'Atribuídas a você') +
      indicador('Em andamento', cont.andamento, admin ? `A recuperar ${moeda(cont.valorAndamento)}` : pct(cont.andamento)) +
      indicador('Paradas', cont.parado, `Sem movimento há ${DIAS_PARADO}+ dias`, cont.parado ? 'atencao' : '') +
      indicador('Pagas', cont.pago, admin ? `Recuperado ${moeda(cont.valorPago)}` : pct(cont.pago), cont.pago ? 'ok' : '') +
      indicador('Impugnadas', cont.impugnado, pct(cont.impugnado)) +
      indicador('Autos de infração', cont.auto, admin ? `Valor ${moeda(cont.valorAuto)}` : pct(cont.auto), cont.auto ? 'erro' : '');
  }

  // Data registrada de uma etapa: clicável para corrigir.
  const botaoData = (p, campo) =>
    `<button type="button" class="data-etapa" data-acao="editar-data" data-campo="${campo}" data-id="${p.id}"
      title="Corrigir a data">${data(p[campo])}</button>`;

  function caixa(p, campo, pode) {
    const marcado = !!p[campo];
    return `<td class="etapa"><label class="check">
      <input type="checkbox" data-acao="etapa" data-campo="${campo}" data-id="${p.id}"
        ${marcado ? 'checked' : ''} ${pode ? '' : 'disabled'}>
      ${marcado ? botaoData(p, campo) : ''}</label></td>`;
  }

  function linhaHtml(p) {
    const pode = Fluxo.permissoes(p);
    const s = Fluxo.situacao(p, new Date(), DIAS_PARADO);
    const admin = ehAdmin();

    let pagamento;
    if (p.pagamento) {
      pagamento = `<span class="etiqueta ${p.pagamento === 'pago' ? 'ok' : 'alerta'}">
        ${p.pagamento === 'pago' ? 'Pago' : 'Não pago'}</span>${botaoData(p, 'pagamento_em')}
        ${pode.pagamento ? `<button class="link" data-acao="pagamento" data-valor="" data-id="${p.id}">desfazer</button>` : ''}`;
    } else if (pode.pagamento) {
      pagamento = `<button class="mini ok" data-acao="pagamento" data-valor="pago" data-id="${p.id}">Pago</button>
        <button class="mini alerta" data-acao="pagamento" data-valor="nao_pago" data-id="${p.id}">Não pago</button>`;
    } else {
      pagamento = '<span class="traco">—</span>';
    }

    let resposta;
    if (p.resposta_em) {
      resposta = `<button class="link" data-acao="resposta" data-id="${p.id}" title="${esc(p.resposta_teor)}">
        ${esc(Fluxo.RESULTADOS[p.resposta_resultado] || '')}</button><small>${data(p.resposta_em)}</small>`;
    } else if (pode.resposta) {
      resposta = `<button class="mini" data-acao="resposta" data-id="${p.id}">Registrar</button>`;
    } else {
      resposta = '<span class="traco">—</span>';
    }

    const posPagamento = p.pagamento === 'nao_pago';
    const classeSituacao = s.encerrado ? (s.chave === 'auto' ? 'alerta' : 'ok') : (s.parado ? 'parado' : 'andamento');
    const classeLinha = [
      s.encerrado && s.chave !== 'auto' ? 'encerrado' : '',
      s.chave === 'auto' ? 'linha-auto' : '',
      !s.encerrado && s.parado ? 'linha-parado' : '',
    ].join(' ').trim();

    return `<tr class="${classeLinha}">
      ${admin ? `<td><input type="checkbox" data-acao="selecionar" data-id="${p.id}" ${estado.selecionados.has(p.id) ? 'checked' : ''}></td>` : ''}
      <td class="empresa">${admin ? `<button class="link" data-acao="historico" data-id="${p.id}" title="Ver histórico">${esc(p.empresa)}</button>` : esc(p.empresa)}
        <small class="mono cnpj">${cnpjFmt(p.cnpj)}</small>
        ${admin ? '' : `<small>${esc(lote(p))}</small>`}</td>
      <td class="num nowrap valor">${moeda(p.calculo)}</td>
      ${admin ? `<td><select data-acao="responsavel" data-id="${p.id}">
        <option value="">—</option>
        ${estado.perfis.map((u) => `<option value="${u.id}" ${u.id === p.responsavel_id ? 'selected' : ''}>${esc(u.nome || u.email)}</option>`).join('')}
        </select></td>` : ''}
      ${caixa(p, 'notificacao_elaboracao_em', pode.notificacao_elaboracao_em)}
      ${caixa(p, 'entrega_municipio_em', pode.entrega_municipio_em)}
      ${caixa(p, 'remessa_guia_em', pode.remessa_guia_em)}
      <td class="etapa">${pagamento}</td>
      ${posPagamento ? caixa(p, 'impugnacao_em', pode.impugnacao_em) : '<td class="etapa"><span class="traco">—</span></td>'}
      <td class="etapa">${resposta}</td>
      ${posPagamento ? caixa(p, 'auto_infracao_em', pode.auto_infracao_em) : '<td class="etapa"><span class="traco">—</span></td>'}
      <td><span class="situacao ${classeSituacao}">${esc(s.texto)}${s.parado && !s.encerrado ? ' · parada' : ''}</span></td>
    </tr>`;
  }

  async function atualizar(id, patch) {
    const { data: novo, error } = await sb.from('processos').update(patch).eq('id', id).select().single();
    if (error) {
      avisar(error.message);
      renderizar();
      return false;
    }
    const i = estado.processos.findIndex((p) => p.id === id);
    if (i >= 0) estado.processos[i] = novo;
    renderizar();
    return true;
  }

  $('#tabela').addEventListener('change', (e) => {
    const el = e.target;
    const id = Number(el.dataset.id);
    switch (el.dataset.acao) {
      case 'etapa':
        // Desmarcar apaga a data registrada: pede confirmação para evitar clique acidental.
        if (!el.checked && !confirm(`Desmarcar "${ROTULOS[el.dataset.campo]}"? A data registrada será apagada.`)) {
          el.checked = true;
          return;
        }
        if (el.checked) {
          // Marcar pede a data em que a etapa aconteceu (padrão: hoje).
          abrirData({ id, campo: el.dataset.campo });
          return;
        }
        el.disabled = true;
        atualizar(id, { [el.dataset.campo]: null });
        break;
      case 'responsavel':
        atualizar(id, { responsavel_id: el.value || null });
        break;
      case 'selecionar':
        if (el.checked) estado.selecionados.add(id); else estado.selecionados.delete(id);
        atualizarSelecao();
        break;
      case 'responsavel-grupo':
        atribuirGrupo(el.dataset.lote, el.value || null);
        break;
      case 'selecionar-grupo':
        for (const p of filtrados()) {
          if (lote(p) !== el.dataset.lote) continue;
          if (el.checked) estado.selecionados.add(p.id); else estado.selecionados.delete(p.id);
        }
        renderizar();
        break;
    }
  });

  $('#tabela').addEventListener('click', (e) => {
    // Linha do município: clicar em qualquer ponto (menos na caixa de seleção) abre/fecha.
    const grupo = e.target.closest('tr.grupo');
    if (grupo) {
      if (!e.target.closest('input, select, label')) alternarGrupo(grupo.dataset.lote);
      return;
    }
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.ordem) {
      const campo = el.dataset.ordem;
      const textual = campo === 'empresa' || campo === 'cnpj' || campo === 'situacao';
      estado.ordem = estado.ordem.campo === campo
        ? { campo, dir: estado.ordem.dir === 'asc' ? 'desc' : 'asc' }
        : { campo, dir: textual ? 'asc' : 'desc' };
      renderizar();
      return;
    }
    const id = Number(el.dataset.id);
    if (el.dataset.acao === 'editar-data') {
      e.preventDefault(); // não deixa o clique alternar a caixa da etapa
      abrirData({ id, campo: el.dataset.campo, editar: true });
    } else if (el.dataset.acao === 'pagamento') {
      const valor = el.dataset.valor || null;
      if (valor) abrirData({ id, campo: 'pagamento_em', pagamento: valor });
      else if (confirm('Desfazer o registro de pagamento? A data registrada será apagada.')) {
        atualizar(id, { pagamento: null, pagamento_em: null });
      }
    } else if (el.dataset.acao === 'resposta') {
      abrirResposta(id);
    } else if (el.dataset.acao === 'historico') {
      abrirHistorico(id);
    }
  });

  // ------------------------------------------------------------------ seleção em lote (admin)

  $('#sel-todos').addEventListener('change', (e) => {
    for (const p of filtrados()) {
      if (e.target.checked) estado.selecionados.add(p.id); else estado.selecionados.delete(p.id);
    }
    renderizar();
  });

  function atualizarSelecao() {
    const n = estado.selecionados.size;
    $('#barra-selecao').hidden = !ehAdmin() || n === 0;
    $('#sel-qtd').textContent = `${n} selecionada${n === 1 ? '' : 's'}`;
    const visiveis = filtrados();
    $('#sel-todos').checked = visiveis.length > 0 && visiveis.every((p) => estado.selecionados.has(p.id));
    // Caixa do município: marcada (todas), parcial (algumas) ou vazia.
    for (const cb of $$('#tabela input[data-acao="selecionar-grupo"]')) {
      const doGrupo = visiveis.filter((p) => lote(p) === cb.dataset.lote);
      const marcadas = doGrupo.filter((p) => estado.selecionados.has(p.id)).length;
      cb.checked = marcadas > 0 && marcadas === doGrupo.length;
      cb.indeterminate = marcadas > 0 && marcadas < doGrupo.length;
    }
  }

  $('#btn-atribuir').addEventListener('click', async () => {
    const ids = [...estado.selecionados];
    const resp = $('#sel-responsavel').value || null;
    const { error } = await sb.from('processos').update({ responsavel_id: resp }).in('id', ids);
    if (error) return avisar(error.message);
    avisar(`${ids.length} empresa(s) atribuída(s).`, 'ok');
    await carregar();
  });

  $('#btn-excluir').addEventListener('click', async () => {
    const ids = [...estado.selecionados];
    if (!confirm(`Excluir ${ids.length} empresa(s)? Isso apaga também o andamento e o histórico.`)) return;
    const { error } = await sb.from('processos').delete().in('id', ids);
    if (error) return avisar(error.message);
    avisar(`${ids.length} empresa(s) excluída(s).`, 'ok');
    await carregar();
  });

  // ------------------------------------------------------------------ data das etapas

  const dlgData = $('#dlg-data');
  const formData = $('#form-data');
  const ROTULOS_DATA = {
    notificacao_elaboracao_em: 'Data da elaboração da notificação',
    entrega_municipio_em: 'Data da entrega ao município',
    remessa_guia_em: 'Data da remessa da notificação com guia',
    pagamento_em: 'Data do pagamento',
    impugnacao_em: 'Data da impugnação',
    auto_infracao_em: 'Data do auto de infração',
  };
  // Converte AAAA-MM-DD para data/hora gravada (meio-dia evita troca de dia pelo fuso).
  const paraTimestamp = (dia) => new Date(dia + 'T12:00:00').toISOString();
  const diaBr = (dia) => dia.split('-').reverse().join('/');

  // pendente: { id, campo, editar?, pagamento? ('pago' | 'nao_pago') }
  function abrirData(pendente) {
    const p = estado.processos.find((x) => x.id === pendente.id);
    estado.dataPendente = pendente;
    const { min, max } = Fluxo.limitesData(p, pendente.campo);
    const naoPago = pendente.pagamento === 'nao_pago' || (!pendente.pagamento && p.pagamento === 'nao_pago');

    let titulo = ROTULOS[pendente.campo] || 'Pagamento';
    let rotulo = ROTULOS_DATA[pendente.campo];
    let aviso = '';
    if (pendente.campo === 'pagamento_em') {
      titulo = pendente.pagamento === 'pago' ? 'Registrar pagamento'
        : pendente.pagamento === 'nao_pago' ? 'Registrar não pagamento' : 'Data do pagamento';
      if (naoPago) rotulo = 'Data em que se constatou o não pagamento';
      if (pendente.pagamento === 'pago') aviso = 'O pagamento encerra o processo.';
      if (pendente.pagamento === 'nao_pago') aviso = 'O não pagamento abre a fase de impugnação e auto de infração.';
    }
    if (pendente.editar) titulo = `Corrigir data — ${titulo}`;

    $('#data-titulo').textContent = titulo;
    $('#data-rotulo').textContent = rotulo;
    $('#data-empresa').textContent = `${p.empresa} — ${cnpjFmt(p.cnpj)}`;
    $('#data-aviso').textContent = aviso;
    $('#data-aviso').hidden = !aviso;
    $('#data-aviso').className = `dlg-aviso ${pendente.pagamento === 'nao_pago' ? 'atencao' : ''}`;
    const input = $('#data-valor');
    input.min = min || '';
    input.max = max;
    const atual = p[pendente.campo] ? Fluxo.diaLocal(p[pendente.campo]) : null;
    input.value = atual || max;
    $('#data-limites').textContent = min
      ? `Entre ${diaBr(min)} e ${diaBr(max)}, conforme as datas das demais etapas.`
      : `Até ${diaBr(max)}.`;
    dlgData.showModal();
    input.focus();
  }

  formData.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pend = estado.dataPendente;
    const input = $('#data-valor');
    const dia = input.value;
    if (!dia) return avisar('Informe a data.');
    if ((input.min && dia < input.min) || dia > input.max) {
      return avisar(input.min
        ? `A data deve estar entre ${diaBr(input.min)} e ${diaBr(input.max)}.`
        : `A data não pode ser posterior a ${diaBr(input.max)}.`);
    }
    const patch = { [pend.campo]: paraTimestamp(dia) };
    if (pend.pagamento) patch.pagamento = pend.pagamento;
    $('#data-confirmar').disabled = true;
    const ok = await atualizar(pend.id, patch);
    $('#data-confirmar').disabled = false;
    if (ok) {
      estado.dataPendente = null;
      dlgData.close();
    }
  });

  // Cancelar (botão, X ou Esc) desfaz a marcação visual da caixa.
  dlgData.addEventListener('close', () => {
    if (estado.dataPendente) {
      estado.dataPendente = null;
      renderizar();
    }
  });

  // ------------------------------------------------------------------ resposta da impugnação

  const dlgResposta = $('#dlg-resposta');
  const formResposta = $('#form-resposta');

  function abrirResposta(id) {
    const p = estado.processos.find((x) => x.id === id);
    const pode = Fluxo.permissoes(p).resposta;
    estado.respostaId = id;
    $('#resp-empresa').textContent = `${p.empresa} — ${cnpjFmt(p.cnpj)}`;
    formResposta.resultado.value = p.resposta_resultado || '';
    const { min, max } = Fluxo.limitesData(p, 'resposta_em');
    formResposta.data.min = min || '';
    formResposta.data.max = max;
    formResposta.data.value = p.resposta_em ? Fluxo.diaLocal(p.resposta_em) : max;
    formResposta.teor.value = p.resposta_teor || '';
    for (const el of [formResposta.resultado, formResposta.data, formResposta.teor]) el.disabled = !pode;
    $('#resp-salvar').hidden = !pode;
    $('#resp-remover').hidden = !pode || !p.resposta_em;
    dlgResposta.showModal();
  }

  $('#resp-cancelar').addEventListener('click', () => dlgResposta.close());

  formResposta.addEventListener('submit', async (e) => {
    e.preventDefault();
    const teor = formResposta.teor.value.trim();
    if (!formResposta.resultado.value) return avisar('Selecione o resultado da resposta.');
    if (!formResposta.data.value) return avisar('Informe a data da resposta.');
    if (!teor) return avisar('Informe o teor da resposta.');
    const dia = formResposta.data.value;
    const { min, max } = formResposta.data;
    if ((min && dia < min) || dia > max) {
      return avisar(min ? `A data deve estar entre ${diaBr(min)} e ${diaBr(max)}.`
        : `A data não pode ser posterior a ${diaBr(max)}.`);
    }
    const ok = await atualizar(estado.respostaId, {
      resposta_resultado: formResposta.resultado.value,
      resposta_teor: teor,
      resposta_em: paraTimestamp(dia),
    });
    if (ok) dlgResposta.close();
  });

  $('#resp-remover').addEventListener('click', async () => {
    if (!confirm('Remover a resposta registrada?')) return;
    const ok = await atualizar(estado.respostaId, { resposta_resultado: null, resposta_teor: null, resposta_em: null });
    if (ok) dlgResposta.close();
  });

  // ------------------------------------------------------------------ histórico (admin)

  const ROTULOS = {
    responsavel_id: 'Responsável',
    notificacao_elaboracao_em: 'Notificação elaboração',
    entrega_municipio_em: 'Entrega município',
    remessa_guia_em: 'Remessa notificação c/ guia',
    pagamento: 'Pagamento',
    impugnacao_em: 'Impugnação',
    resposta_resultado: 'Resultado da resposta',
    resposta_teor: 'Teor da resposta',
    auto_infracao_em: 'Auto de infração',
  };

  function descreverValor(campo, v) {
    if (v === null || v === undefined) return 'desmarcado';
    if (campo === 'responsavel_id') return nomePerfil(v) || 'outro usuário';
    if (campo === 'pagamento') return v === 'pago' ? 'Pago' : 'Não pago';
    if (campo === 'resposta_resultado') return Fluxo.RESULTADOS[v] || v;
    if (campo.endsWith('_em')) return 'marcado';
    return v;
  }

  async function abrirHistorico(id) {
    const p = estado.processos.find((x) => x.id === id);
    $('#hist-empresa').textContent = `${p.empresa} — ${cnpjFmt(p.cnpj)}`;
    $('#hist-lista').innerHTML = '<li class="sutil">Carregando…</li>';
    $('#dlg-historico').showModal();
    const { data: itens, error } = await sb.from('historico').select('*').eq('processo_id', id).order('em', { ascending: false });
    if (error) { $('#hist-lista').innerHTML = `<li class="erro">${esc(error.message)}</li>`; return; }
    $('#hist-lista').innerHTML = itens.length ? itens.map((h) => `<li>
        <time>${new Date(h.em).toLocaleString('pt-BR')}</time>
        <strong>${esc(ROTULOS[h.campo] || h.campo)}</strong>: ${esc(descreverValor(h.campo, h.para))}
        <span class="sutil">— ${esc(nomePerfil(h.usuario_id) || 'sistema')}</span></li>`).join('')
      : '<li class="sutil">Sem alterações registradas.</li>';
  }

  // ------------------------------------------------------------------ usuários (admin)

  function renderizarUsuarios() {
    const agora = new Date();
    $('#tabela-usuarios tbody').innerHTML = estado.perfis.map((u) => {
      const seus = estado.processos.filter((p) => p.responsavel_id === u.id);
      let andamento = 0; let parados = 0; let pagos = 0; let autos = 0; let valor = 0;
      for (const p of seus) {
        const s = Fluxo.situacao(p, agora, DIAS_PARADO);
        valor += Number(p.calculo);
        if (!s.encerrado) andamento++;
        if (!s.encerrado && s.parado) parados++;
        if (s.chave === 'pago') pagos++;
        if (s.chave === 'auto') autos++;
      }
      return `<tr>
        <td>${esc(u.nome)}</td><td>${esc(u.email)}</td>
        <td><span class="etiqueta ${u.papel === 'admin' ? 'info' : ''}">${u.papel === 'admin' ? 'Administrador' : 'Usuário'}</span></td>
        <td class="num">${seus.length}</td><td class="num">${moeda(valor)}</td>
        <td class="num">${andamento}</td><td class="num">${parados}</td>
        <td class="num">${pagos}</td><td class="num">${autos}</td>
        <td><button class="link" data-ver="${u.id}">ver empresas</button></td>
      </tr>`;
    }).join('');
  }

  $('#tabela-usuarios').addEventListener('click', (e) => {
    const id = e.target.dataset.ver;
    if (!id) return;
    $('#f-responsavel').value = id;
    trocarAba('acompanhamento');
    renderizar();
  });

  // ------------------------------------------------------------------ importação do PDF (admin)

  const dropzone = $('#dropzone');
  const TEXTO_DROPZONE = $('#dropzone-texto').innerHTML;
  const TEXTO_STATUS = $('#imp-status').innerHTML;

  $('#arquivo-pdf').addEventListener('change', (e) => processarArquivo(e.target.files[0]));

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('arrastando'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('arrastando'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('arrastando');
    const arquivo = e.dataTransfer.files[0];
    if (arquivo && arquivo.type !== 'application/pdf' && !/\.pdf$/i.test(arquivo.name)) {
      return avisar('Envie o relatório em formato PDF.');
    }
    processarArquivo(arquivo);
  });

  async function processarArquivo(arquivo) {
    if (!arquivo) return;
    if (!window.pdfjsLib) return avisar('Leitor de PDF não carregou. Verifique a conexão e recarregue a página.');
    dropzone.classList.add('lendo');
    $('#dropzone-texto').innerHTML = `<span class="girando"></span><strong>Lendo ${esc(arquivo.name)}…</strong>`;
    try {
      const r = await PdfParser.lerPdf(window.pdfjsLib, await arquivo.arrayBuffer());
      if (!r.empresas.length) throw new Error('Nenhuma empresa encontrada no PDF.');
      r.arquivo = arquivo.name;
      r.lidoEm = new Date();
      $('#imp-status').innerHTML = TEXTO_STATUS;
      // Município, UF e ano vêm do PDF quando existem, mas sempre podem ser digitados.
      $('#imp-municipio').value = r.municipio || '';
      $('#imp-uf').value = r.uf || '';
      $('#imp-ano').value = r.ano || '';
      estado.importacao = r;
      await marcarExistentes();
      renderizarPrevia();
      if (!r.municipio) $('#imp-municipio').focus();
      else if (!r.ano) $('#imp-ano').focus();
      // PDFs antigos cortavam o nome do credor: completa pela Receita os que tiveram o CNPJ recuperado.
      completarNomes(r, r.empresas.filter((e) => e.cnpjStatus === 'recuperado'));
    } catch (err) {
      estado.importacao = null;
      $('#previa').hidden = true;
      avisar('Não foi possível ler o PDF: ' + err.message);
    } finally {
      dropzone.classList.remove('lendo');
      $('#dropzone-texto').innerHTML = estado.importacao
        ? `<strong>${esc(estado.importacao.arquivo)}</strong> carregado · <span class="link-falso">trocar arquivo</span>`
        : TEXTO_DROPZONE;
    }
  }

  function loteDigitado() {
    const ano = Number($('#imp-ano').value);
    return {
      municipio: $('#imp-municipio').value.trim().replace(/\s+/g, ' ').toUpperCase(),
      uf: $('#imp-uf').value.trim().toUpperCase() || null,
      ano: Number.isInteger(ano) && ano >= 2000 && ano <= 2100 ? ano : null,
    };
  }

  // Marca as empresas que já existem no município/ano informados.
  async function marcarExistentes() {
    const { municipio, ano } = loteDigitado();
    let jaTem = new Set();
    if (municipio && ano) {
      const { data: existentes, error } = await sb.from('processos').select('cnpj')
        .eq('municipio', municipio).eq('ano', ano);
      if (error) return avisar(error.message);
      jaTem = new Set(existentes.map((x) => x.cnpj));
    }
    estado.importacao.empresas.forEach((emp) => {
      const antes = emp.existente;
      emp.existente = jaTem.has(emp.cnpj);
      if (emp.incluir === undefined || antes !== emp.existente) emp.incluir = !emp.existente && cnpjOk(emp);
    });
  }

  for (const id of ['#imp-municipio', '#imp-uf', '#imp-ano']) {
    $(id).addEventListener('change', async () => {
      if (!estado.importacao) return;
      await marcarExistentes();
      renderizarPrevia();
    });
  }

  function renderizarPrevia() {
    const r = estado.importacao;
    $('#previa').hidden = false;
    const existentes = r.empresas.filter((e) => e.existente).length;
    const ficha = (rotulo, valor, classe = '') =>
      `<div><span>${rotulo}</span><strong class="${classe}" title="${esc(valor)}">${esc(valor)}</strong></div>`;
    $('#previa-cabecalho').innerHTML =
      ficha('Arquivo', r.arquivo || '—') +
      ficha('Registros lidos', `${r.empresas.length} empresas${existentes ? ` (${existentes} já cadastradas)` : ''}`) +
      ficha('Soma das diferenças', moeda(r.somaDiferenca)) +
      ficha('Total do relatório', r.totalDiferencaDeclarado !== null ? moeda(r.totalDiferencaDeclarado) : 'não informado') +
      ficha('Lido em', r.lidoEm ? r.lidoEm.toLocaleString('pt-BR') : '—');
    $('#previa-avisos').innerHTML = r.avisos.map((a) => `<li>${esc(a)}</li>`).join('');
    $('#tabela-previa tbody').innerHTML = r.empresas.map(linhaPreviaHtml).join('');
    atualizarBotaoImportar();
  }

  const cnpjOk = (emp) => PdfParser.cnpjValido(emp.cnpj);
  // PDF antigo (texto cortado): nome e CNPJ podem ser corrigidos na prévia.
  const editavel = (emp) => emp.cnpjStatus && emp.cnpjStatus !== 'ok';

  function linhaPreviaHtml(emp, i) {
    const valido = cnpjOk(emp);
    const cnpj = editavel(emp) && (!valido || emp.cnpjStatus === 'manual')
      ? `<input type="text" class="mono campo-cnpj ${valido ? '' : 'invalido'}" data-cnpj="${i}" inputmode="numeric"
          value="${esc(valido ? cnpjFmt(emp.cnpj) : '')}" placeholder="CNPJ (no PDF: ${esc(emp.cnpjLido || 'vazio')})">`
      : `${cnpjFmt(emp.cnpj)}${emp.cnpjStatus === 'recuperado'
        ? ' <span class="etiqueta info" title="O PDF trazia só 13 dígitos; o último foi recalculado pelo dígito verificador.">dígito recalculado</span>' : ''}`;
    const nome = editavel(emp)
      ? `<input type="text" class="campo-nome" data-nome="${i}" value="${esc(emp.empresa)}">
         ${emp.nomeCompletado ? `<small class="ok">Completado pela Receita (no PDF: ${esc(emp.nomePdf)})</small>` : ''}
         ${emp.nomeReceita ? `<small>Receita: ${esc(emp.nomeReceita)}
           <button type="button" class="link" data-usar-nome="${i}">usar este nome</button></small>` : ''}
         ${emp.buscandoNome ? '<small><span class="girando"></span>consultando a Receita…</small>' : ''}`
      : esc(emp.empresa);
    return `<tr class="${emp.existente ? 'encerrado' : ''} ${editavel(emp) && !valido ? 'linha-pendente' : ''}">
      <td><input type="checkbox" data-i="${i}" ${emp.incluir ? 'checked' : ''} ${emp.existente || !valido ? 'disabled' : ''}></td>
      <td class="num">${emp.numero ?? ''}</td><td>${nome}</td><td class="nowrap mono">${cnpj}</td>
      <td class="num nowrap valor">${moeda(emp.calculo)}</td>
      <td>${emp.existente ? '<span class="etiqueta">já cadastrada</span>'
        : !valido ? '<span class="etiqueta alerta">informe o CNPJ</span>' : ''}</td></tr>`;
  }

  // Atualiza uma linha da prévia; não mexe na linha em que a pessoa está digitando (a não ser forçado).
  function atualizarLinhaPrevia(r, emp, forcar = false) {
    if (estado.importacao !== r) return;
    const i = r.empresas.indexOf(emp);
    const tr = $('#tabela-previa tbody').rows[i];
    if (tr && (forcar || !tr.contains(document.activeElement))) tr.outerHTML = linhaPreviaHtml(emp, i);
  }

  // ---- Consulta do nome (razão social) na Receita, com fallback entre APIs públicas
  const FONTES_CNPJ = [
    (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
    (c) => `https://minhareceita.org/${c}`,
    (c) => `https://publica.cnpj.ws/cnpj/${c}`,
  ];

  async function razaoSocial(cnpj) {
    for (const url of FONTES_CNPJ) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const resp = await fetch(url(cnpj), { signal: ctrl.signal });
        if (resp.status === 404) return null;
        if (!resp.ok) continue;
        const d = await resp.json();
        if (d.razao_social) return String(d.razao_social).trim();
      } catch (e) {
        /* tenta a próxima fonte */
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('indisponível');
  }

  const normalizarNome = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  async function completarNomes(r, alvos) {
    if (!alvos.length) return;
    let feitos = 0;
    let completados = 0;
    let falhasSeguidas = 0;
    let parar = false;
    const status = () => {
      if (estado.importacao !== r) return;
      $('#imp-status').innerHTML = feitos < alvos.length && !parar
        ? `<span class="girando"></span>Completando nomes pela Receita Federal… ${feitos}/${alvos.length}`
        : `Nomes completados pela Receita: ${completados} de ${alvos.length}. Confira e ajuste se necessário.`;
      atualizarBotaoImportar();
    };
    r.buscandoNomes = true;
    alvos.forEach((emp) => { emp.buscandoNome = true; atualizarLinhaPrevia(r, emp); });
    status();
    const fila = [...alvos];
    const trabalhador = async () => {
      while (fila.length && !parar && estado.importacao === r) {
        const emp = fila.shift();
        try {
          const nome = await razaoSocial(emp.cnpj);
          falhasSeguidas = 0;
          if (nome && normalizarNome(nome) !== normalizarNome(emp.empresa)) {
            // Só troca sozinho quando o nome do PDF é o começo do nome da Receita (corte);
            // senão mostra o nome da Receita como sugestão.
            if (emp.cnpjStatus === 'manual' || normalizarNome(nome).startsWith(normalizarNome(emp.empresa))) {
              emp.nomePdf = emp.nomePdf || emp.empresa;
              emp.empresa = nome;
              emp.nomeCompletado = true;
              emp.nomeReceita = null;
              completados++;
            } else {
              emp.nomeReceita = nome;
            }
          }
        } catch (e) {
          if (++falhasSeguidas >= 3) {
            parar = true;
            avisar('Os serviços de consulta de CNPJ não responderam. Confira os nomes cortados manualmente.');
          }
        }
        emp.buscandoNome = false;
        feitos++;
        atualizarLinhaPrevia(r, emp);
        status();
      }
    };
    await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
    alvos.forEach((emp) => { if (emp.buscandoNome) { emp.buscandoNome = false; atualizarLinhaPrevia(r, emp); } });
    r.buscandoNomes = false;
    status();
  }

  function atualizarBotaoImportar() {
    const r = estado.importacao;
    const n = r.empresas.filter((e) => e.incluir).length;
    const pendentes = r.empresas.filter((e) => !e.existente && !cnpjOk(e)).length;
    $('#btn-importar').textContent = r.buscandoNomes ? 'Aguarde: completando nomes…'
      : `Importar ${n} empresa${n === 1 ? '' : 's'}${pendentes ? ` (${pendentes} sem CNPJ)` : ''}`;
    $('#btn-importar').disabled = n === 0 || !!r.buscandoNomes;
    const disponiveis = r.empresas.filter((e) => !e.existente && cnpjOk(e));
    $('#imp-todos').checked = disponiveis.length > 0 && disponiveis.every((e) => e.incluir);
  }

  $('#tabela-previa').addEventListener('change', async (e) => {
    const r = estado.importacao;
    const el = e.target;
    if (el.id === 'imp-todos') {
      r.empresas.forEach((emp) => { if (!emp.existente && cnpjOk(emp)) emp.incluir = el.checked; });
      renderizarPrevia();
    } else if (el.dataset.i) {
      r.empresas[Number(el.dataset.i)].incluir = el.checked;
      atualizarBotaoImportar();
    } else if (el.dataset.nome) {
      const emp = r.empresas[Number(el.dataset.nome)];
      emp.empresa = el.value.trim().replace(/\s+/g, ' ').toUpperCase() || emp.empresa;
      el.value = emp.empresa;
    } else if (el.dataset.cnpj) {
      const emp = r.empresas[Number(el.dataset.cnpj)];
      const d = el.value.replace(/\D/g, '');
      if (!PdfParser.cnpjValido(d)) {
        el.classList.add('invalido');
        return avisar('CNPJ inválido: confira os 14 dígitos.');
      }
      emp.cnpj = d;
      emp.cnpjStatus = 'manual';
      emp.incluir = undefined;
      await marcarExistentes();
      renderizarPrevia();
      completarNomes(r, [emp]);
    }
  });

  $('#tabela-previa').addEventListener('click', (e) => {
    const i = e.target.dataset.usarNome;
    if (i === undefined) return;
    const emp = estado.importacao.empresas[Number(i)];
    emp.nomePdf = emp.nomePdf || emp.empresa;
    emp.empresa = emp.nomeReceita;
    emp.nomeReceita = null;
    emp.nomeCompletado = true;
    atualizarLinhaPrevia(estado.importacao, emp, true);
  });

  $('#btn-importar').addEventListener('click', async () => {
    const r = estado.importacao;
    const { municipio, uf, ano } = loteDigitado();
    if (!municipio) { $('#imp-municipio').focus(); return avisar('Informe o município.'); }
    if (!ano) { $('#imp-ano').focus(); return avisar('Informe o ano (4 dígitos).'); }
    const responsavel = $('#imp-responsavel').value || null;
    const linhas = r.empresas.filter((e) => e.incluir).map((e) => ({
      municipio, uf, ano,
      empresa: e.empresa, cnpj: e.cnpj, calculo: e.calculo, responsavel_id: responsavel,
    }));
    $('#btn-importar').disabled = true;
    const { error } = await sb.from('processos')
      .upsert(linhas, { onConflict: 'cnpj,municipio,ano', ignoreDuplicates: true });
    if (error) {
      $('#btn-importar').disabled = false;
      return avisar('Erro ao importar: ' + error.message);
    }
    avisar(`${linhas.length} empresa(s) importada(s).`, 'ok');
    estado.importacao = null;
    $('#previa').hidden = true;
    $('#arquivo-pdf').value = '';
    $('#dropzone-texto').innerHTML = TEXTO_DROPZONE;
    $('#imp-status').innerHTML = TEXTO_STATUS;
    await carregar();
    trocarAba('acompanhamento');
  });

  // ------------------------------------------------------------------ exportação CSV

  $('#btn-csv').addEventListener('click', () => {
    const agora = new Date();
    const cab = ['Município', 'UF', 'Ano', 'Empresa', 'CNPJ', 'Cálculo', 'Responsável',
      'Notificação elaboração', 'Entrega município', 'Remessa notificação c/ guia', 'Pagamento',
      'Data pagamento', 'Impugnação', 'Resposta impugnação', 'Data resposta', 'Teor da resposta',
      'Auto de infração', 'Situação'];
    const linhas = filtrados().map((p) => [
      p.municipio, p.uf, p.ano, p.empresa, cnpjFmt(p.cnpj), String(p.calculo).replace('.', ','),
      nomePerfil(p.responsavel_id), data(p.notificacao_elaboracao_em), data(p.entrega_municipio_em),
      data(p.remessa_guia_em), p.pagamento === 'pago' ? 'Pago' : p.pagamento === 'nao_pago' ? 'Não pago' : '',
      data(p.pagamento_em), data(p.impugnacao_em), Fluxo.RESULTADOS[p.resposta_resultado] || '',
      data(p.resposta_em), p.resposta_teor, data(p.auto_infracao_em),
      Fluxo.situacao(p, agora, DIAS_PARADO).texto,
    ]);
    const csv = [cab, ...linhas]
      .map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `acompanhair_${agora.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
