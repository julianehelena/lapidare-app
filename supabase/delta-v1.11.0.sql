-- ════════════════════════════════════════════════════════════════════
-- LAPIDARE · UPDATE v1.11.0 · SEXO NO CADASTRO DA PACIENTE
-- ════════════════════════════════════════════════════════════════════
-- O que faz:
--   - Adiciona coluna "sexo" em pacientes e pacientes_pendentes
--   - Atualiza a função buscar_pendente_por_token pra retornar o sexo
--   - Atualiza o trigger handle_new_user pra copiar o sexo do pendente
--
-- Pra que serve: agora a nutri escolhe o sexo da paciente no cadastro,
-- e o app usa concordância correta (ex: "Bem-vinda/Bem-vindo").
--
-- Como rodar (1 minuto):
--   1. Supabase → SQL Editor → + New query
--   2. Cola TUDO desse arquivo → Run (Cmd+Enter)
--   3. Esperado: "Success. No rows returned"
--
-- 100% seguro: idempotente. Pacientes já existentes ficam como 'feminino'
-- por padrão (ajuste manual quando quiser).
-- ════════════════════════════════════════════════════════════════════

-- 1. Adiciona coluna nas 2 tabelas
alter table public.pacientes
  add column if not exists sexo text default 'feminino'
  check (sexo in ('feminino', 'masculino'));

alter table public.pacientes_pendentes
  add column if not exists sexo text default 'feminino'
  check (sexo in ('feminino', 'masculino'));

-- 2. Atualiza a RPC pra retornar sexo (precisa DROP antes pq mudou o return type)
drop function if exists public.buscar_pendente_por_token(uuid);
create or replace function public.buscar_pendente_por_token(p_token uuid)
returns table(
  nome text, email text, nascimento date, sexo text,
  objetivo text, tipo_plano text, modalidade text,
  nutri_id uuid, nutri_nome text, status text
)
language sql security definer set search_path = public
as $$
  select pp.nome, pp.email, pp.nascimento, coalesce(pp.sexo, 'feminino') as sexo,
    pp.objetivo, pp.tipo_plano, pp.modalidade, pp.nutri_id,
    n.nome as nutri_nome, pp.status
  from public.pacientes_pendentes pp
  join public.nutris n on n.id = pp.nutri_id
  where pp.token = p_token
  limit 1;
$$;
grant execute on function public.buscar_pendente_por_token(uuid) to anon, authenticated;

-- 3. Atualiza o trigger handle_new_user pra copiar o sexo
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', '');
begin
  if v_role = 'nutri' then
    insert into public.nutris (id, nome, crn, email)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'nome', new.email),
      new.raw_user_meta_data ->> 'crn',
      new.email
    )
    on conflict (id) do nothing;
  elsif v_role = 'paciente' then
    declare
      v_nutri_id uuid := (new.raw_user_meta_data ->> 'nutri_id')::uuid;
      v_pendente public.pacientes_pendentes%rowtype;
      v_template record;
    begin
      select * into v_pendente from public.pacientes_pendentes
      where nutri_id = v_nutri_id and lower(email) = lower(new.email) limit 1;

      if found then
        insert into public.pacientes (id, nutri_id, nome, email, objetivo, tipo_plano, modalidade, nascimento, sexo)
        values (
          new.id, v_nutri_id,
          coalesce(new.raw_user_meta_data ->> 'nome',       v_pendente.nome,       new.email),
          new.email,
          coalesce(new.raw_user_meta_data ->> 'objetivo',   v_pendente.objetivo),
          coalesce(new.raw_user_meta_data ->> 'tipo_plano', v_pendente.tipo_plano),
          coalesce(new.raw_user_meta_data ->> 'modalidade', v_pendente.modalidade),
          coalesce((new.raw_user_meta_data ->> 'nascimento')::date, v_pendente.nascimento),
          coalesce(new.raw_user_meta_data ->> 'sexo',       v_pendente.sexo,       'feminino')
        ) on conflict (id) do nothing;
        update public.pacientes_pendentes set status = 'ativado' where id = v_pendente.id;
      else
        insert into public.pacientes (id, nutri_id, nome, email, objetivo, tipo_plano, modalidade, nascimento, sexo)
        values (
          new.id, v_nutri_id,
          coalesce(new.raw_user_meta_data ->> 'nome', new.email),
          new.email,
          new.raw_user_meta_data ->> 'objetivo',
          new.raw_user_meta_data ->> 'tipo_plano',
          new.raw_user_meta_data ->> 'modalidade',
          (new.raw_user_meta_data ->> 'nascimento')::date,
          coalesce(new.raw_user_meta_data ->> 'sexo', 'feminino')
        ) on conflict (id) do nothing;
      end if;

      for v_template in
        select id, nome, perguntas from public.checkin_templates
        where nutri_id = v_nutri_id and tipo = 'pre_consulta'
      loop
        insert into public.checkin_envios (nutri_id, paciente_id, nome, tipo, perguntas, enviado_em)
        values (v_nutri_id, new.id, v_template.nome, 'pre_consulta', v_template.perguntas, now());
      end loop;
    end;
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- ✅ Pronto! Agora no cadastro de paciente vai aparecer o seletor
-- "Sexo" (Feminino/Masculino) — e o app vai falar com a paciente/o
-- paciente na concordância correta.
-- ════════════════════════════════════════════════════════════════════
