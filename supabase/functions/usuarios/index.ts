// Edge Function "usuarios" — gestão de usuários pelo administrador, a partir da aba Usuários.
//
// Por que existe: criar usuário, trocar senha e bloquear acesso exigem a chave secreta do
// Supabase (service role), que NUNCA pode ir para o site. Esta função roda no servidor do
// Supabase, onde a chave já está disponível, e só atende quem é administrador ativo.
//
// Ações (corpo JSON):
//   { acao: 'criar', email, senha, nome, papel }   papel: 'usuario' | 'admin'
//   { acao: 'redefinir_senha', id, senha }
//   { acao: 'bloquear', id } | { acao: 'desbloquear', id }
//
// Como publicar: veja "Gestão de usuários" no README do repositório.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const erro = (mensagem: string, status = 400) => resposta({ erro: mensagem }, status);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const senhaValida = (s: unknown) => typeof s === 'string' && s.length >= 8 && s.length <= 72;
const UM_SECULO = '876000h'; // "bloqueado" no Auth do Supabase = banido por tempo indeterminado

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro('Método não permitido.', 405);
  try {
    return await atender(req);
  } catch (e) {
    // A biblioteca do Supabase às vezes lança exceção em vez de devolver erro: responde com a mensagem.
    console.error(e);
    return erro(`Erro inesperado: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
});

async function atender(req: Request): Promise<Response> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Quem está chamando? (sessão do site) — e é administrador ativo?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: sessao, error: erroSessao } = await admin.auth.getUser(token);
  if (erroSessao || !sessao?.user) return erro('Sessão inválida. Entre novamente no sistema.', 401);
  const { data: quem } = await admin.from('perfis').select('papel, bloqueado').eq('id', sessao.user.id).single();
  if (!quem || quem.papel !== 'admin' || quem.bloqueado) return erro('Apenas administradores podem gerenciar usuários.', 403);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return erro('Pedido inválido.');
  }
  const { acao } = corpo;

  // 2) Criar usuário
  if (acao === 'criar') {
    const email = String(corpo.email ?? '').trim().toLowerCase();
    const nome = String(corpo.nome ?? '').trim().replace(/\s+/g, ' ');
    const papel = corpo.papel === 'admin' ? 'admin' : 'usuario';
    if (!EMAIL.test(email)) return erro('E-mail inválido.');
    if (!nome) return erro('Informe o nome.');
    if (!senhaValida(corpo.senha)) return erro('A senha precisa ter entre 8 e 72 caracteres.');
    const { data, error } = await admin.auth.admin.createUser({
      email, password: corpo.senha as string, email_confirm: true, user_metadata: { nome },
    });
    if (error) {
      const jaExiste = /already|registered|exists/i.test(error.message);
      return erro(jaExiste ? 'Já existe um usuário com este e-mail.' : `Não foi possível criar: ${error.message}`);
    }
    // O perfil é criado pelo gatilho do banco; aqui só ajusta nome e papel.
    const { error: erroPerfil } = await admin.from('perfis').upsert({ id: data.user.id, email, nome, papel });
    if (erroPerfil) return erro(`Usuário criado, mas o perfil não foi ajustado: ${erroPerfil.message}`, 500);
    return resposta({ ok: true, id: data.user.id });
  }

  // 3) Ações sobre um usuário existente
  const id = String(corpo.id ?? '');
  if (!UUID.test(id)) return erro('Usuário inválido.');
  const { data: alvo } = await admin.from('perfis').select('id, papel, bloqueado').eq('id', id).single();
  if (!alvo) return erro('Usuário não encontrado.', 404);

  if (acao === 'redefinir_senha') {
    if (!senhaValida(corpo.senha)) return erro('A senha precisa ter entre 8 e 72 caracteres.');
    const { error } = await admin.auth.admin.updateUserById(id, { password: corpo.senha as string });
    return error ? erro(`Não foi possível trocar a senha: ${error.message}`) : resposta({ ok: true });
  }

  if (acao === 'bloquear' || acao === 'desbloquear') {
    const bloquear = acao === 'bloquear';
    if (bloquear && id === sessao.user.id) return erro('Você não pode bloquear o próprio acesso.');
    // Primeiro o perfil: o banco recusa bloquear o último administrador ativo.
    const { error: erroPerfil } = await admin.from('perfis').update({ bloqueado: bloquear }).eq('id', id);
    if (erroPerfil) return erro(erroPerfil.message);
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: bloquear ? UM_SECULO : 'none' });
    if (error) {
      await admin.from('perfis').update({ bloqueado: !bloquear }).eq('id', id); // desfaz
      return erro(`Não foi possível ${bloquear ? 'bloquear' : 'desbloquear'}: ${error.message}`);
    }
    return resposta({ ok: true });
  }

  return erro('Ação desconhecida.');
}
