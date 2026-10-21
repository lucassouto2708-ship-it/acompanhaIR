-- =====================================================================
-- AcompanhaIR — estrutura do banco (Supabase / Postgres)
--
-- Como usar: Supabase → SQL Editor → New query → colar este arquivo → Run.
-- Pode ser executado de novo sem perder dados (idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis de usuário (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  nome       text,
  papel      text not null default 'usuario' check (papel in ('admin', 'usuario')),
  criado_em  timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é cadastrado no Auth.
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- Perfis de usuários que já existiam antes deste script.
insert into public.perfis (id, email, nome)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin');
$$;

-- ---------------------------------------------------------------------
-- Processos (uma empresa de um relatório = uma linha)
-- ---------------------------------------------------------------------
create table if not exists public.processos (
  id                         bigint generated always as identity primary key,
  municipio                  text not null,
  uf                         text,
  ano                        integer not null,
  empresa                    text not null,
  cnpj                       text not null check (cnpj ~ '^\d{14}$'),
  calculo                    numeric(14, 2) not null,          -- coluna DIFERENÇA do relatório
  responsavel_id             uuid references public.perfis (id) on delete set null,

  -- Etapas lineares
  notificacao_elaboracao_em  timestamptz,
  entrega_municipio_em       timestamptz,
  remessa_guia_em            timestamptz,

  -- Pagamento: 'pago' encerra; 'nao_pago' abre a fase de impugnação
  pagamento                  text check (pagamento in ('pago', 'nao_pago')),
  pagamento_em               timestamptz,

  -- Fase pós "não pago"
  impugnacao_em              timestamptz,
  resposta_resultado         text check (resposta_resultado in ('deferida', 'parcial', 'indeferida')),
  resposta_teor              text,
  resposta_em                timestamptz,
  auto_infracao_em           timestamptz,

  criado_em                  timestamptz not null default now(),
  atualizado_em              timestamptz not null default now(),
  atualizado_por             uuid references public.perfis (id) on delete set null,

  unique (cnpj, municipio, ano)
);

create index if not exists processos_responsavel_idx on public.processos (responsavel_id);
create index if not exists processos_municipio_ano_idx on public.processos (municipio, ano);

-- Valida a sequência das etapas e impede que usuários comuns alterem dados
-- cadastrais (empresa, CNPJ, cálculo, responsável...).
create or replace function public.validar_processo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    if new.municipio      is distinct from old.municipio
    or new.uf             is distinct from old.uf
    or new.ano            is distinct from old.ano
    or new.empresa        is distinct from old.empresa
    or new.cnpj           is distinct from old.cnpj
    or new.calculo        is distinct from old.calculo
    or new.responsavel_id is distinct from old.responsavel_id
    or new.criado_em      is distinct from old.criado_em then
      raise exception 'Somente o administrador pode alterar os dados da empresa.';
    end if;
  end if;

  -- Sequência linear
  if new.entrega_municipio_em is not null and new.notificacao_elaboracao_em is null then
    raise exception 'Marque "Notificação elaboração" antes de "Entrega município".';
  end if;
  if new.remessa_guia_em is not null and new.entrega_municipio_em is null then
    raise exception 'Marque "Entrega município" antes de "Remessa notificação c/ guia".';
  end if;
  if new.pagamento is not null and new.remessa_guia_em is null then
    raise exception 'Registre a remessa da notificação antes do pagamento.';
  end if;
  if (new.pagamento is null) <> (new.pagamento_em is null) then
    raise exception 'Pagamento e data do pagamento devem ser informados juntos.';
  end if;

  -- Fase de impugnação só existe quando não houve pagamento
  if coalesce(new.pagamento, '') <> 'nao_pago'
     and (new.impugnacao_em is not null or new.resposta_em is not null or new.auto_infracao_em is not null) then
    raise exception 'Impugnação, resposta e auto de infração só se aplicam quando não houve pagamento.';
  end if;
  if new.resposta_em is not null then
    if new.impugnacao_em is null then
      raise exception 'Marque a impugnação antes de registrar a resposta.';
    end if;
    if new.resposta_resultado is null or coalesce(btrim(new.resposta_teor), '') = '' then
      raise exception 'Informe o resultado e o teor da resposta da impugnação.';
    end if;
  elsif new.resposta_resultado is not null or new.resposta_teor is not null then
    raise exception 'Resultado/teor da resposta exigem a data da resposta.';
  end if;
  if new.auto_infracao_em is not null then
    if new.impugnacao_em is not null and new.resposta_em is null then
      raise exception 'Aguarde a resposta da impugnação antes do auto de infração.';
    end if;
    if new.resposta_resultado = 'deferida' then
      raise exception 'Impugnação deferida encerra o processo: não há auto de infração.';
    end if;
  end if;

  new.atualizado_em := now();
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  return new;
end;
$$;

drop trigger if exists validar_processo on public.processos;
create trigger validar_processo
  before insert or update on public.processos
  for each row execute function public.validar_processo();

-- ---------------------------------------------------------------------
-- Histórico de alterações (visível só para o administrador)
-- ---------------------------------------------------------------------
create table if not exists public.historico (
  id           bigint generated always as identity primary key,
  processo_id  bigint not null references public.processos (id) on delete cascade,
  usuario_id   uuid references public.perfis (id) on delete set null,
  campo        text not null,
  de           text,
  para         text,
  em           timestamptz not null default now()
);

create index if not exists historico_processo_idx on public.historico (processo_id, em desc);

create or replace function public.registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campo text;
  antes jsonb := to_jsonb(old);
  depois jsonb := to_jsonb(new);
begin
  foreach campo in array array[
    'responsavel_id', 'notificacao_elaboracao_em', 'entrega_municipio_em', 'remessa_guia_em',
    'pagamento', 'impugnacao_em', 'resposta_resultado', 'resposta_teor', 'auto_infracao_em'
  ] loop
    if antes -> campo is distinct from depois -> campo then
      insert into public.historico (processo_id, usuario_id, campo, de, para)
      values (new.id, auth.uid(), campo, antes ->> campo, depois ->> campo);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists registrar_historico on public.processos;
create trigger registrar_historico
  after update on public.processos
  for each row execute function public.registrar_historico();

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
--   - usuário comum: vê e atualiza só os processos dos quais é responsável
--   - administrador: vê e altera tudo; é o único que importa/exclui
-- ---------------------------------------------------------------------
alter table public.perfis    enable row level security;
alter table public.processos enable row level security;
alter table public.historico enable row level security;

drop policy if exists perfis_select on public.perfis;
create policy perfis_select on public.perfis
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists perfis_update_admin on public.perfis;
create policy perfis_update_admin on public.perfis
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists processos_select on public.processos;
create policy processos_select on public.processos
  for select to authenticated
  using (public.is_admin() or responsavel_id = auth.uid());

drop policy if exists processos_insert_admin on public.processos;
create policy processos_insert_admin on public.processos
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists processos_update on public.processos;
create policy processos_update on public.processos
  for update to authenticated
  using (public.is_admin() or responsavel_id = auth.uid())
  with check (public.is_admin() or responsavel_id = auth.uid());

drop policy if exists processos_delete_admin on public.processos;
create policy processos_delete_admin on public.processos
  for delete to authenticated
  using (public.is_admin());

drop policy if exists historico_select_admin on public.historico;
create policy historico_select_admin on public.historico
  for select to authenticated
  using (public.is_admin());

-- Visitantes não logados não têm acesso a nada.
revoke all on public.perfis, public.processos, public.historico from anon;
