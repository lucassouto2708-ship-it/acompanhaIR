-- Testes das regras do banco (supabase/schema.sql). Cada verificação que falha interrompe com erro.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists teste;
grant usage on schema teste to authenticated, anon;
-- Executa um comando e exige que ele falhe com uma mensagem que contenha `trecho`.
create or replace function teste.espera_erro(comando text, trecho text, descricao text) returns void language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if position(trecho in sqlerrm) = 0 then
      raise exception 'FALHOU: % (erro inesperado: %)', descricao, sqlerrm;
    end if;
    raise notice 'ok  %', descricao;
    return;
  end;
  raise exception 'FALHOU: % (o comando deveria ter sido recusado)', descricao;
end $$;
create or replace function teste.verifica(condicao boolean, descricao text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', descricao; end if;
  raise notice 'ok  %', descricao;
end $$;
grant execute on all functions in schema teste to authenticated, anon;

-- Dados: admin (…a), Ana (…b), Bruno (…c)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste'),
  ('00000000-0000-0000-0000-00000000000b', 'ana@teste'),
  ('00000000-0000-0000-0000-00000000000c', 'bruno@teste');
update perfis set papel = 'admin' where email = 'admin@teste';
select teste.verifica((select count(*) = 3 from perfis), 'perfis criados automaticamente para novos usuários');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into processos (municipio, uf, ano, empresa, cnpj, calculo, responsavel_id) values
  ('MANTENA', 'MG', 2025, 'ANA 1', '10000000000001', 100, '00000000-0000-0000-0000-00000000000b'),
  ('MANTENA', 'MG', 2025, 'ANA 2', '10000000000002', 100, '00000000-0000-0000-0000-00000000000b'),
  ('MANTENA', 'MG', 2025, 'BRUNO', '10000000000003', 100, '00000000-0000-0000-0000-00000000000c');
select teste.verifica((select count(*) = 3 from processos), 'admin vê todas as empresas');

-- ===== Acesso (usuária comum)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select teste.verifica((select count(*) = 2 from processos), 'usuária vê só as próprias empresas');
select teste.verifica((select count(*) = 1 from perfis), 'usuária vê só o próprio perfil');
update processos set notificacao_elaboracao_em = now() where empresa = 'BRUNO';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select teste.verifica((select notificacao_elaboracao_em is null from processos where empresa = 'BRUNO'), 'usuária não altera empresa de outro');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select teste.espera_erro($$update processos set calculo = 1 where empresa = 'ANA 1'$$, 'Somente o administrador', 'usuária não altera o cálculo');
select teste.espera_erro($$update processos set responsavel_id = null where empresa = 'ANA 1'$$, 'Somente o administrador', 'usuária não troca o responsável');
select teste.espera_erro($$update processos set arquivado_em = now() where empresa = 'ANA 1'$$, 'Somente o administrador', 'usuária não arquiva');
select teste.espera_erro($$insert into processos (municipio, ano, empresa, cnpj, calculo) values ('X', 2025, 'Y', '10000000000009', 1)$$, 'row-level security', 'usuária não importa empresas');
update perfis set papel = 'admin' where email = 'ana@teste';
select teste.verifica((select papel = 'usuario' from perfis where email = 'ana@teste'), 'usuária não se promove a admin');

-- ===== Sequência das etapas
select teste.espera_erro($$update processos set entrega_municipio_em = now() where empresa = 'ANA 1'$$, 'antes de "Entrega município"', 'não pula etapa');
update processos set notificacao_elaboracao_em = now() - interval '5 days', entrega_municipio_em = now() - interval '4 days',
  remessa_guia_em = now() - interval '3 days' where empresa = 'ANA 1';
select teste.espera_erro($$update processos set pagamento = 'pago', pagamento_em = now() where empresa = 'ANA 2'$$, 'remessa', 'pagamento exige a remessa');

-- ===== Datas
select teste.espera_erro($$update processos set pagamento = 'nao_pago', pagamento_em = now() + interval '3 days' where empresa = 'ANA 1'$$, 'não pode ser futura', 'data futura recusada');
select teste.espera_erro($$update processos set pagamento = 'nao_pago', pagamento_em = now() - interval '30 days' where empresa = 'ANA 1'$$, 'fora da ordem', 'data fora da ordem recusada');
update processos set pagamento = 'nao_pago', pagamento_em = now() - interval '2 days' where empresa = 'ANA 1';
select teste.verifica((select pagamento = 'nao_pago' from processos where empresa = 'ANA 1'), 'data na ordem aceita');

-- ===== Impugnação, resposta, teor e auto
update processos set impugnacao_em = now() - interval '1 day' where empresa = 'ANA 1';
select teste.espera_erro($$update processos set auto_infracao_em = now() where empresa = 'ANA 1'$$, 'Aguarde a resposta', 'auto aguarda a resposta da impugnação');
select teste.espera_erro($$update processos set resposta_em = now(), resposta_resultado = 'indeferida' where empresa = 'ANA 1'$$, 'teor', 'resposta exige o teor');
select teste.espera_erro($$update processos set resposta_em = now(), resposta_resultado = 'indeferida', resposta_teor = repeat('x', 10001) where empresa = 'ANA 1'$$, '10.000', 'teor acima de 10.000 caracteres recusado');
update processos set resposta_em = now(), resposta_resultado = 'indeferida', resposta_teor = 'Mantida.' where empresa = 'ANA 1';
update processos set auto_infracao_em = now() where empresa = 'ANA 1';
select teste.verifica((select auto_infracao_em is not null from processos where empresa = 'ANA 1'), 'fluxo completo até o auto de infração');

-- ===== Arquivamento e histórico
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update processos set arquivado_em = now() where empresa = 'ANA 2';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select teste.verifica((select count(*) = 1 from processos), 'usuária não vê empresa arquivada');
reset role;
select teste.verifica((select count(*) >= 8 from historico where processo_id = (select id from processos where empresa = 'ANA 1')), 'histórico registra as etapas');
select teste.verifica(exists (select 1 from historico where campo = 'pagamento_em'), 'histórico registra a data do pagamento');
select teste.verifica(exists (select 1 from historico where campo = 'arquivado_em'), 'histórico registra o arquivamento');
delete from processos where empresa = 'ANA 1';
select teste.verifica(exists (select 1 from historico where campo = 'excluido' and de like 'ANA 1 (CNPJ 10000000000001)%'), 'exclusão definitiva fica registrada');
select teste.verifica((select count(*) >= 8 from historico where processo_id is null), 'exclusão não apaga o histórico');

-- ===== Bloqueio de acesso e proteção do último administrador
select teste.espera_erro($$update perfis set bloqueado = true where email = 'admin@teste'$$, 'ao menos um administrador ativo', 'não bloqueia o último admin');
select teste.espera_erro($$update perfis set papel = 'usuario' where email = 'admin@teste'$$, 'ao menos um administrador ativo', 'não rebaixa o último admin');
update perfis set bloqueado = true where email = 'bruno@teste';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select teste.verifica((select count(*) = 0 from processos), 'usuário bloqueado não vê mais as empresas (mesmo com sessão aberta)');
update processos set notificacao_elaboracao_em = now() where empresa = 'BRUNO';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select teste.verifica((select notificacao_elaboracao_em is null from processos where empresa = 'BRUNO'), 'usuário bloqueado não altera empresas');
update perfis set bloqueado = true where email = 'ana@teste';
select teste.verifica((select bloqueado from perfis where email = 'ana@teste'), 'admin bloqueia usuária');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
update perfis set bloqueado = false where email = 'ana@teste';
reset role;
select teste.verifica((select bloqueado from perfis where email = 'ana@teste'), 'usuária bloqueada não se desbloqueia');
update perfis set bloqueado = false, papel = 'admin' where email = 'ana@teste';
update perfis set bloqueado = true where email = 'admin@teste';
select teste.verifica((select bloqueado from perfis where email = 'admin@teste'), 'com outro admin ativo, um admin pode ser bloqueado');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select teste.verifica((select count(*) = 0 from processos), 'admin bloqueado perde o acesso de administrador');
reset role;
update perfis set bloqueado = false where email in ('admin@teste', 'bruno@teste');
update perfis set papel = 'usuario' where email = 'ana@teste';

-- ===== Visitante sem login
set role anon;
select teste.espera_erro($$select * from processos$$, 'permission denied', 'visitante sem login não acessa nada');
reset role;

drop schema teste cascade;
\echo
\echo 'Todos os testes do banco passaram.'
