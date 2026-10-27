// Supabase simulado em memória, carregado no navegador no lugar de vendor/supabase-js.
// Imita o que o site usa do supabase-js e as regras que importam para os testes:
//  - no máximo 1.000 linhas por consulta (como o Supabase real);
//  - usuário comum só vê as próprias empresas não arquivadas (como o RLS);
//  - CNPJ + município + ano não se repetem (como a restrição UNIQUE do banco);
//  - canal de tempo real cujo callback o teste pode disparar (window.__RT_CB).
// Usuários: admin@x.com (id 'a', administrador) e ana@x.com (id 'b', usuária comum).
(function () {
  const db = (window.__DB = {
    perfis: [
      { id: 'a', email: 'admin@x.com', nome: 'Admin', papel: 'admin', bloqueado: false },
      { id: 'b', email: 'ana@x.com', nome: 'Ana', papel: 'usuario', bloqueado: false },
    ],
    processos: [],
    historico: [],
  });
  window.__CONTAGEM = { consultas: 0, updates: 0 };
  window.__SENHAS = {};            // senhas definidas pela função "usuarios"
  window.__FUNCAO_AUSENTE = false; // true simula a função não publicada no Supabase
  const ultimoAdminAtivo = (id) => !db.perfis.some((x) => x.id !== id && x.papel === 'admin' && !x.bloqueado);
  let seq = 100000;
  let sessao = null;
  const ouvintes = [];
  const usuarioAtual = () => db.perfis.find((p) => p.id === sessao?.user.id);

  function visivel(tabela, r) {
    const u = usuarioAtual();
    if (!u) return false;
    if (tabela === 'processos' && u.papel !== 'admin') return r.responsavel_id === u.id && !r.arquivado_em;
    if (tabela === 'perfis' && u.papel !== 'admin') return r.id === u.id;
    return true;
  }

  class Consulta {
    constructor(tabela) { this.t = tabela; this.f = []; this.op = 'select'; }
    select() { return this; }
    eq(c, v) { this.f.push((r) => r[c] === v); return this; }
    in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this; }
    order() { return this; }
    range(de, ate) { this.de = de; this.ate = ate; return this; }
    single() { this.uma = true; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(linhas) { this.op = 'upsert'; this.linhas = linhas; return this; }
    then(ok, erro) { return Promise.resolve(this.executar()).then(ok, erro); }

    executar() {
      const tab = db[this.t];
      const filtradas = () => tab.filter((r) => visivel(this.t, r) && this.f.every((f) => f(r)));
      let data = null;
      if (this.op === 'select') {
        window.__CONTAGEM.consultas++;
        const de = this.de || 0;
        const ate = Math.min(this.ate ?? Infinity, de + 999); // limite de 1.000 linhas
        data = filtradas().slice(de, ate + 1).map((r) => ({ ...r }));
      }
      if (this.op === 'update') {
        window.__CONTAGEM.updates++;
        const alvo = filtradas();
        if (this.patch.municipio !== undefined) {
          for (const r of alvo) {
            if (tab.some((x) => x !== r && x.cnpj === r.cnpj && x.ano === r.ano && x.municipio === this.patch.municipio)) {
              return { data: null, error: { message: 'duplicate key value violates unique constraint "processos_cnpj_municipio_ano_key"' } };
            }
          }
        }
        if (this.t === 'perfis') { // imita o gatilho proteger_ultimo_admin
          for (const r of alvo) {
            const perde = this.patch.bloqueado === true || (this.patch.papel && this.patch.papel !== 'admin');
            if (r.papel === 'admin' && !r.bloqueado && perde && ultimoAdminAtivo(r.id)) {
              return { data: null, error: { message: 'É preciso haver ao menos um administrador ativo.' } };
            }
          }
        }
        alvo.forEach((r) => Object.assign(r, this.patch, { atualizado_em: new Date().toISOString() }));
        data = alvo.map((r) => ({ ...r }));
      }
      if (this.op === 'delete') {
        const apagar = filtradas();
        db[this.t] = tab.filter((r) => !apagar.includes(r));
      }
      if (this.op === 'upsert') {
        for (const r of this.linhas) {
          if (!tab.some((x) => x.cnpj === r.cnpj && x.municipio === r.municipio && x.ano === r.ano)) {
            tab.push({ id: seq++, criado_em: new Date().toISOString(), ...r });
          }
        }
      }
      if (this.uma) return data && data.length ? { data: data[0], error: null } : { data: null, error: { message: 'nenhuma linha' } };
      return { data, error: null };
    }
  }

  window.supabase = {
    createClient: () => ({
      from: (tabela) => new Consulta(tabela),
      channel: () => {
        const canal = { on(_evento, _filtro, cb) { window.__RT_CB = cb; return canal; }, subscribe() { return canal; } };
        return canal;
      },
      removeChannel: () => { window.__RT_CB = null; },
      // Edge Function "usuarios" simulada (mesmas regras de supabase/functions/usuarios/index.ts).
      functions: {
        async invoke(nome, { body }) {
          const falha = (status, erro) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code',
            context: new Response(JSON.stringify({ erro }), { status, headers: { 'content-type': 'application/json' } }) } });
          if (window.__FUNCAO_AUSENTE || nome !== 'usuarios') return falha(404, 'Requested function was not found');
          const u = usuarioAtual();
          if (!u || u.papel !== 'admin' || u.bloqueado) return falha(403, 'Apenas administradores podem gerenciar usuários.');
          if (body.acao === 'criar') {
            if (db.perfis.some((p) => p.email === body.email)) return falha(400, 'Já existe um usuário com este e-mail.');
            const id = 'u' + seq++;
            db.perfis.push({ id, email: body.email, nome: body.nome, papel: body.papel === 'admin' ? 'admin' : 'usuario', bloqueado: false });
            window.__SENHAS[body.email] = body.senha;
            return { data: { ok: true, id }, error: null };
          }
          const alvo = db.perfis.find((p) => p.id === body.id);
          if (!alvo) return falha(404, 'Usuário não encontrado.');
          if (body.acao === 'redefinir_senha') { window.__SENHAS[alvo.email] = body.senha; return { data: { ok: true }, error: null }; }
          if (body.acao === 'bloquear' || body.acao === 'desbloquear') {
            const bloquear = body.acao === 'bloquear';
            if (bloquear && alvo.id === u.id) return falha(400, 'Você não pode bloquear o próprio acesso.');
            if (bloquear && alvo.papel === 'admin' && ultimoAdminAtivo(alvo.id)) return falha(400, 'É preciso haver ao menos um administrador ativo.');
            alvo.bloqueado = bloquear;
            return { data: { ok: true }, error: null };
          }
          return falha(400, 'Ação desconhecida.');
        },
      },
      auth: {
        onAuthStateChange(cb) { ouvintes.push(cb); setTimeout(() => cb(sessao ? 'SIGNED_IN' : 'INITIAL_SESSION', sessao)); },
        async signInWithPassword({ email }) {
          const p = db.perfis.find((x) => x.email === email);
          if (!p) return { error: { message: 'Invalid login credentials' } };
          if (p.bloqueado) return { error: { message: 'User is banned' } };
          sessao = { user: { id: p.id } };
          ouvintes.forEach((cb) => cb('SIGNED_IN', sessao));
          return { error: null };
        },
        async signOut() { sessao = null; ouvintes.forEach((cb) => cb('SIGNED_OUT', null)); },
      },
    }),
  };
})();
