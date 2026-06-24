-- =============================================================
-- LAPIDARE · Setup do Supabase
-- =============================================================
-- Cole este arquivo INTEIRO em:
--   Supabase → SQL Editor → New query → Run
--
-- Roda em ~5 segundos. Pode ser executado várias vezes sem erro
-- (idempotente). Cria:
--   • 10 tabelas (nutris, pacientes, planos, listas_compras,
--     prescricoes, mensagens, peso_registros, feed_pratos,
--     vendas, parcelas)
--   • Índices para consultas comuns
--   • Row Level Security em TODAS as tabelas
--   • Políticas: nutri só vê próprias pacientes;
--                paciente só vê próprios dados
--   • Trigger handle_new_user(): ao aceitar convite,
--     usuário é inserido em `nutris` ou `pacientes` automaticamente
--     conforme o user_metadata enviado no invite.
--   • 2 buckets de Storage (prescricoes, fotos_pratos) + políticas
-- =============================================================


-- =============================================================
-- 1. EXTENSIONS
-- =============================================================
create extension if not exists pgcrypto;

-- Tenta habilitar pg_cron pra check-ins automáticos.
-- Se não conseguir (sem permissão), o script continua normalmente — só
-- não terá agendamento automático (precisa enviar check-ins manualmente).
do $$
begin
  create extension if not exists pg_cron;
  raise notice 'pg_cron habilitado: check-ins automáticos vão funcionar.';
exception when others then
  raise notice 'pg_cron não pôde ser habilitado automaticamente. Pra ativar check-ins automáticos, habilite manualmente em Database → Extensions → pg_cron e rode esse setup de novo.';
end$$;


-- =============================================================
-- 2. TABELAS
-- =============================================================

-- 2.1 Nutricionistas ------------------------------------------------
create table if not exists public.nutris (
  id            uuid primary key references auth.users(id) on delete cascade,
  nome          text not null,
  crn           text,
  email         text not null,
  meta_mensal         numeric(10,2),
  gastos_fixos        numeric(10,2),
  ticket_medio_alvo   numeric(10,2),
  horas_semanais      integer,
  created_at          timestamptz not null default now()
);
-- Compat: adiciona colunas de previsibilidade se já existia
alter table public.nutris add column if not exists meta_mensal         numeric(10,2);
alter table public.nutris add column if not exists gastos_fixos        numeric(10,2);
alter table public.nutris add column if not exists ticket_medio_alvo   numeric(10,2);
alter table public.nutris add column if not exists horas_semanais      integer;

-- 2.2 Pacientes -----------------------------------------------------
create table if not exists public.pacientes (
  id          uuid primary key references auth.users(id) on delete cascade,
  nutri_id    uuid not null references public.nutris(id) on delete cascade,
  nome        text not null,
  email       text not null,
  objetivo    text,
  tipo_plano  text,
  modalidade  text,
  sexo        text default 'feminino' check (sexo in ('feminino', 'masculino')),
  created_at  timestamptz not null default now()
);
create index if not exists pacientes_nutri_id_idx on public.pacientes(nutri_id);

-- 2.3 Planos alimentares -------------------------------------------
create table if not exists public.planos (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  dados         jsonb not null,
  validade      date,
  publicado_em  timestamptz not null default now()
);
create index if not exists planos_paciente_id_idx on public.planos(paciente_id, publicado_em desc);
create index if not exists planos_nutri_id_idx on public.planos(nutri_id);

-- 2.3-b Substituições (separadas do plano pra evitar JSON gigante + bugs) ----
-- dados: jsonb com formato [{ alimento, medida?, substituicoes: string[] }]
create table if not exists public.substituicoes (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  dados         jsonb not null,
  publicado_em  timestamptz not null default now()
);
create index if not exists substituicoes_paciente_id_idx on public.substituicoes(paciente_id, publicado_em desc);
create index if not exists substituicoes_nutri_id_idx on public.substituicoes(nutri_id);

-- 2.4 Listas de compras --------------------------------------------
create table if not exists public.listas_compras (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  dados         jsonb not null,
  publicado_em  timestamptz not null default now()
);
create index if not exists listas_compras_paciente_id_idx on public.listas_compras(paciente_id, publicado_em desc);

-- v1.10.0: coluna pdf_url nas 3 tabelas (Plano, Substituições, Compras)
-- DEVE ficar APÓS a criação das 3 tabelas (planos, substituicoes, listas_compras)
alter table public.planos          add column if not exists pdf_url text;
alter table public.substituicoes   add column if not exists pdf_url text;
alter table public.listas_compras  add column if not exists pdf_url text;

-- 2.5 Prescrições (documentos PDF) ---------------------------------
create table if not exists public.prescricoes (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  tipo          text not null check (tipo in ('exame', 'laudo', 'receita')),
  titulo        text not null,
  storage_path  text not null,
  nota          text,
  created_at    timestamptz not null default now()
);
create index if not exists prescricoes_paciente_id_idx on public.prescricoes(paciente_id, created_at desc);

-- 2.6 Mensagens (chat) ---------------------------------------------
create table if not exists public.mensagens (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  de            text not null check (de in ('nutri', 'paciente')),
  texto         text not null,
  lida          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists mensagens_conversa_idx on public.mensagens(paciente_id, nutri_id, created_at);

-- 2.7 Avaliações antropométricas (gráfico de evolução) -------------
-- A nutri registra peso e medidas em cada consulta;
-- a paciente apenas visualiza o histórico/gráfico.
create table if not exists public.peso_registros (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid references public.nutris(id) on delete set null,
  kg            numeric(5,2) not null,
  altura_cm     numeric(5,2),
  cintura_cm    numeric(5,2),
  quadril_cm    numeric(5,2),
  braco_cm      numeric(5,2),
  coxa_cm       numeric(5,2),
  pgc           numeric(5,2),   -- % gordura corporal
  mm_kg         numeric(5,2),   -- massa magra em kg
  obs           text,
  data          date not null default current_date,
  created_at    timestamptz not null default now()
);
-- Compat: caso a tabela já existisse, adiciona colunas faltantes (idempotente)
alter table public.peso_registros
  add column if not exists nutri_id    uuid references public.nutris(id) on delete set null,
  add column if not exists altura_cm   numeric(5,2),
  add column if not exists cintura_cm  numeric(5,2),
  add column if not exists quadril_cm  numeric(5,2),
  add column if not exists braco_cm    numeric(5,2),
  add column if not exists coxa_cm     numeric(5,2),
  add column if not exists pgc         numeric(5,2),
  add column if not exists mm_kg       numeric(5,2),
  add column if not exists obs         text,
  add column if not exists created_at  timestamptz not null default now();
create index if not exists peso_registros_paciente_id_idx on public.peso_registros(paciente_id, data);

-- 2.8 Feed de pratos (fotos) ---------------------------------------
create table if not exists public.feed_pratos (
  id                uuid primary key default gen_random_uuid(),
  paciente_id       uuid not null references public.pacientes(id) on delete cascade,
  storage_path      text not null,
  refeicao          text,
  legenda           text,
  comentario_nutri  text,
  created_at        timestamptz not null default now()
);
create index if not exists feed_pratos_paciente_id_idx on public.feed_pratos(paciente_id, created_at desc);

-- 2.8.5 Gastos (financeiro - saídas) -------------------------------
-- Suporta esporádicos (data_gasto preenchida) e recorrentes (dia_recorrencia).
-- Recorrentes ativos contam todo mês automaticamente nos cálculos.
create table if not exists public.gastos (
  id                uuid primary key default gen_random_uuid(),
  nutri_id          uuid not null references public.nutris(id) on delete cascade,
  descricao         text not null,
  categoria         text not null default 'outros',
  valor             numeric(10,2) not null,
  forma_pgto        text not null default 'pix',
  data_gasto        date,
  recorrente        boolean not null default false,
  dia_recorrencia   integer check (dia_recorrencia between 1 and 31),
  ativo             boolean not null default true,
  obs               text,
  created_at        timestamptz not null default now()
);
create index if not exists gastos_nutri_idx on public.gastos(nutri_id, data_gasto desc);
create index if not exists gastos_recorrente_idx on public.gastos(nutri_id, recorrente, ativo);


-- 2.8.6 Serviços (esteira de produtos da nutri) ------------------
-- IMPORTANTE: precisa vir antes de "vendas" porque vendas tem FK pra servicos.
create table if not exists public.servicos (
  id                  uuid primary key default gen_random_uuid(),
  nutri_id            uuid not null references public.nutris(id) on delete cascade,
  nome                text not null,
  nivel               text not null default 'intermediario' check (nivel in ('entrada', 'intermediario', 'premium', 'avulso')),
  ticket              numeric(10,2) not null,
  descricao           text,
  ativo               boolean not null default true,
  vendas_planejadas   integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists servicos_nutri_idx on public.servicos(nutri_id, ativo);

-- 2.9 Vendas (financeiro) ------------------------------------------
create table if not exists public.vendas (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  paciente_id   uuid references public.pacientes(id) on delete set null,
  servico_id    uuid references public.servicos(id) on delete set null,
  servico       text not null,
  valor_total   numeric(10,2) not null,
  forma_pgto    text not null check (forma_pgto in ('pix', 'credito1x', 'parcelado', 'asaas', 'dinheiro')),
  data_venda    date not null default current_date,
  obs           text,
  created_at    timestamptz not null default now()
);
-- Compat: adiciona servico_id se a tabela já existia sem ele
alter table public.vendas add column if not exists servico_id uuid references public.servicos(id) on delete set null;
create index if not exists vendas_nutri_id_idx on public.vendas(nutri_id, data_venda desc);
create index if not exists vendas_servico_id_idx on public.vendas(servico_id, data_venda);

-- 2.10 Parcelas (financeiro) ---------------------------------------
create table if not exists public.parcelas (
  id            uuid primary key default gen_random_uuid(),
  venda_id      uuid not null references public.vendas(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  numero        integer not null,
  valor         numeric(10,2) not null,
  vencimento    date not null,
  status        text not null default 'pendente' check (status in ('pago', 'pendente', 'atrasado')),
  data_pgto     date,
  obs           text
);
create index if not exists parcelas_nutri_id_idx on public.parcelas(nutri_id, vencimento);
create index if not exists parcelas_venda_id_idx on public.parcelas(venda_id);

-- 2.11.8 Fotos de evolução da paciente (antes/depois) ------------
-- Nutri tira foto no consultório OU paciente envia do app dela.
-- Usadas no Dashboard de Evolução (timeline + comparativo).
create table if not exists public.fotos_evolucao (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid references public.nutris(id) on delete set null,  -- null = upload pela paciente
  storage_path  text not null,
  tipo          text not null default 'frente' check (tipo in ('frente', 'perfil_direito', 'perfil_esquerdo', 'costas', 'livre')),
  data_foto     date not null default current_date,
  obs           text,
  created_at    timestamptz not null default now()
);
create index if not exists fotos_evolucao_paciente_idx on public.fotos_evolucao(paciente_id, data_foto desc);

-- 2.11.9 Pacientes pendentes (importação CSV antes de signup) -----
-- Cadastros importados de outras plataformas. Quando paciente
-- faz signup pelo link, dados pré-preenchidos migram para `pacientes`.
create table if not exists public.pacientes_pendentes (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  nome          text not null,
  email         text not null,
  whatsapp      text,
  cpf           text,
  nascimento    date,
  sexo          text default 'feminino' check (sexo in ('feminino', 'masculino')),
  objetivo      text,
  tipo_plano    text,
  modalidade    text,
  obs           text,
  status        text not null default 'pendente' check (status in ('pendente', 'enviado', 'ativado')),
  created_at    timestamptz not null default now(),
  unique (nutri_id, email)
);
create index if not exists pacientes_pendentes_nutri_idx on public.pacientes_pendentes(nutri_id, status);
create index if not exists pacientes_pendentes_email_idx on public.pacientes_pendentes(email);

-- 2.12 Check-ins (templates + envios + agendamentos) --------------
-- Templates: N por nutri. paciente_id opcional (template ligado a uma paciente).
-- is_padrao define qual aparece por default ao enviar.
create table if not exists public.checkin_templates (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  paciente_id   uuid references public.pacientes(id) on delete cascade,
  nome          text not null default 'Check-in semanal',
  perguntas     jsonb not null,
  is_padrao     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Remove constraint antiga que limitava a 1 template por nutri+paciente
alter table public.checkin_templates drop constraint if exists checkin_templates_nutri_id_paciente_id_key;
-- Compat: adiciona is_padrao se a tabela já existia sem ele
alter table public.checkin_templates add column if not exists is_padrao boolean not null default false;
create index if not exists checkin_templates_nutri_idx on public.checkin_templates(nutri_id);
-- Garante que cada nutri tenha no máximo UM template marcado como padrão
create unique index if not exists checkin_templates_padrao_unique
  on public.checkin_templates(nutri_id)
  where is_padrao = true;

-- Agendamentos: dispara envios automaticamente em frequência configurável.
-- O processamento é feito no client (NutriLayout) sem precisar de cron externo.
create table if not exists public.checkin_agendamentos (
  id              uuid primary key default gen_random_uuid(),
  nutri_id        uuid not null references public.nutris(id) on delete cascade,
  paciente_id     uuid references public.pacientes(id) on delete cascade,
  template_id     uuid not null references public.checkin_templates(id) on delete cascade,
  frequencia      text not null check (frequencia in ('semanal', 'quinzenal', 'mensal')),
  proximo_envio   date not null,
  ativo           boolean not null default true,
  ultimo_envio    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists checkin_agendamentos_nutri_idx on public.checkin_agendamentos(nutri_id, ativo, proximo_envio);

-- Envios: cada vez que a nutri envia um check-in à paciente
create table if not exists public.checkin_envios (
  id                      uuid primary key default gen_random_uuid(),
  nutri_id                uuid not null references public.nutris(id) on delete cascade,
  paciente_id             uuid not null references public.pacientes(id) on delete cascade,
  perguntas               jsonb not null,                   -- snapshot do template no momento do envio
  enviado_em              timestamptz not null default now(),
  respondido_em           timestamptz,
  respostas               jsonb,
  lembrete_enviado_em     timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists checkin_envios_paciente_idx on public.checkin_envios(paciente_id, enviado_em desc);
create index if not exists checkin_envios_nutri_idx on public.checkin_envios(nutri_id, enviado_em desc);
create index if not exists checkin_envios_pendentes_idx on public.checkin_envios(paciente_id) where respondido_em is null;

-- 2.11 Consultas (agenda) ------------------------------------------
-- `tipo` aceita: primeira | consulta_2..consulta_12 | avaliacao | retorno
-- (texto livre para permitir numeração explícita por paciente)
create table if not exists public.consultas (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  data_hora     timestamptz not null,
  duracao_min   integer not null default 45,
  tipo          text not null default 'consulta_2',
  status        text not null default 'agendada' check (status in ('agendada', 'realizada', 'cancelada')),
  obs           text,
  meet_link     text,
  links_extras  jsonb,    -- array de { label, url } — Shaped, Trello, Notion, etc.
  created_at    timestamptz not null default now()
);
-- Compat: adiciona links_extras se a tabela já existia sem ele
alter table public.consultas add column if not exists links_extras jsonb;
-- Remove CHECK antigo caso a tabela já tenha sido criada com a versão anterior
alter table public.consultas drop constraint if exists consultas_tipo_check;
-- Compat: adiciona meet_link se a tabela já existia sem ele
alter table public.consultas add column if not exists meet_link text;
create index if not exists consultas_paciente_id_idx on public.consultas(paciente_id, data_hora);
create index if not exists consultas_nutri_id_idx on public.consultas(nutri_id, data_hora);


-- =============================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- =============================================================
alter table public.nutris          enable row level security;
alter table public.pacientes       enable row level security;
alter table public.planos          enable row level security;
alter table public.listas_compras  enable row level security;
alter table public.prescricoes     enable row level security;
alter table public.mensagens       enable row level security;
alter table public.peso_registros  enable row level security;
alter table public.feed_pratos     enable row level security;
alter table public.gastos          enable row level security;
alter table public.vendas          enable row level security;
alter table public.parcelas        enable row level security;
alter table public.consultas             enable row level security;
alter table public.fotos_evolucao        enable row level security;
alter table public.pacientes_pendentes   enable row level security;
alter table public.checkin_templates     enable row level security;
alter table public.checkin_envios        enable row level security;
alter table public.checkin_agendamentos  enable row level security;
alter table public.servicos              enable row level security;


-- =============================================================
-- 4. POLÍTICAS RLS
-- =============================================================
-- Regra geral:
--   • Nutri: enxerga apenas suas próprias pacientes e dados.
--   • Paciente: enxerga apenas os próprios dados.
-- =============================================================

-- 4.1 nutris --------------------------------------------------------
drop policy if exists nutris_select_self on public.nutris;
create policy nutris_select_self on public.nutris
  for select using (id = auth.uid());

drop policy if exists nutris_update_self on public.nutris;
create policy nutris_update_self on public.nutris
  for update using (id = auth.uid());

-- 4.2 pacientes ----------------------------------------------------
drop policy if exists pacientes_select on public.pacientes;
create policy pacientes_select on public.pacientes
  for select using (
    id = auth.uid() or nutri_id = auth.uid()
  );

drop policy if exists pacientes_insert on public.pacientes;
create policy pacientes_insert on public.pacientes
  for insert with check (nutri_id = auth.uid());

drop policy if exists pacientes_update on public.pacientes;
create policy pacientes_update on public.pacientes
  for update using (id = auth.uid() or nutri_id = auth.uid());

drop policy if exists pacientes_delete on public.pacientes;
create policy pacientes_delete on public.pacientes
  for delete using (nutri_id = auth.uid());

-- 4.3 planos -------------------------------------------------------
drop policy if exists planos_select on public.planos;
create policy planos_select on public.planos
  for select using (
    paciente_id = auth.uid() or nutri_id = auth.uid()
  );

drop policy if exists planos_write_nutri on public.planos;
create policy planos_write_nutri on public.planos
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.3-b substituicoes ----------------------------------------------
alter table public.substituicoes enable row level security;

drop policy if exists substituicoes_select on public.substituicoes;
create policy substituicoes_select on public.substituicoes
  for select using (
    paciente_id = auth.uid() or nutri_id = auth.uid()
  );

drop policy if exists substituicoes_write_nutri on public.substituicoes;
create policy substituicoes_write_nutri on public.substituicoes
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.4 listas_compras -----------------------------------------------
drop policy if exists listas_compras_select on public.listas_compras;
create policy listas_compras_select on public.listas_compras
  for select using (
    paciente_id = auth.uid() or nutri_id = auth.uid()
  );

drop policy if exists listas_compras_write_nutri on public.listas_compras;
create policy listas_compras_write_nutri on public.listas_compras
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.5 prescricoes --------------------------------------------------
drop policy if exists prescricoes_select on public.prescricoes;
create policy prescricoes_select on public.prescricoes
  for select using (
    paciente_id = auth.uid() or nutri_id = auth.uid()
  );

drop policy if exists prescricoes_write_nutri on public.prescricoes;
create policy prescricoes_write_nutri on public.prescricoes
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.6 mensagens (chat — leitura e escrita pelos dois lados) --------
drop policy if exists mensagens_select on public.mensagens;
create policy mensagens_select on public.mensagens
  for select using (
    paciente_id = auth.uid() or nutri_id = auth.uid()
  );

drop policy if exists mensagens_insert on public.mensagens;
create policy mensagens_insert on public.mensagens
  for insert with check (
    (de = 'nutri'    and nutri_id    = auth.uid()) or
    (de = 'paciente' and paciente_id = auth.uid())
  );

drop policy if exists mensagens_update_lida on public.mensagens;
create policy mensagens_update_lida on public.mensagens
  for update using (
    paciente_id = auth.uid() or nutri_id = auth.uid()
  );

-- 4.7 peso_registros / avaliações antropométricas -----------------
-- Paciente: apenas lê os próprios registros.
-- Nutri:    insere, atualiza e remove apenas das próprias pacientes.
drop policy if exists peso_select on public.peso_registros;
drop policy if exists peso_insert_paciente on public.peso_registros;
drop policy if exists peso_delete_paciente on public.peso_registros;

drop policy if exists peso_select_paciente on public.peso_registros;
create policy peso_select_paciente on public.peso_registros
  for select using (paciente_id = auth.uid());

drop policy if exists peso_all_nutri on public.peso_registros;
create policy peso_all_nutri on public.peso_registros
  for all
  using (exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid()))
  with check (exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid()));

-- 4.8 feed_pratos (paciente posta, nutri lê e comenta) ------------
drop policy if exists feed_select on public.feed_pratos;
create policy feed_select on public.feed_pratos
  for select using (
    paciente_id = auth.uid()
    or paciente_id in (select id from public.pacientes where nutri_id = auth.uid())
  );

drop policy if exists feed_insert_paciente on public.feed_pratos;
create policy feed_insert_paciente on public.feed_pratos
  for insert with check (paciente_id = auth.uid());

drop policy if exists feed_update on public.feed_pratos;
create policy feed_update on public.feed_pratos
  for update using (
    paciente_id = auth.uid()
    or paciente_id in (select id from public.pacientes where nutri_id = auth.uid())
  );

drop policy if exists feed_delete_paciente on public.feed_pratos;
create policy feed_delete_paciente on public.feed_pratos
  for delete using (paciente_id = auth.uid());

-- 4.9 vendas (só a nutri dona) -------------------------------------
drop policy if exists vendas_all on public.vendas;
create policy vendas_all on public.vendas
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.9b gastos (só a nutri dona) -----------------------------------
drop policy if exists gastos_all on public.gastos;
create policy gastos_all on public.gastos
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.10 parcelas (só a nutri dona) ----------------------------------
drop policy if exists parcelas_all on public.parcelas;
create policy parcelas_all on public.parcelas
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.12 check-ins ---------------------------------------------------
-- Templates: nutri gerencia os próprios; paciente lê apenas os que se aplicam a ela
drop policy if exists checkin_templates_all_nutri on public.checkin_templates;
create policy checkin_templates_all_nutri on public.checkin_templates
  for all
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists checkin_templates_select_paciente on public.checkin_templates;
create policy checkin_templates_select_paciente on public.checkin_templates
  for select using (
    paciente_id = auth.uid()
    or (paciente_id is null and nutri_id in (select nutri_id from public.pacientes where id = auth.uid()))
  );

-- Envios: paciente vê os próprios; nutri gerencia os enviados a suas pacientes;
-- paciente pode atualizar (responder) os próprios.
drop policy if exists checkin_envios_select on public.checkin_envios;
create policy checkin_envios_select on public.checkin_envios
  for select using (paciente_id = auth.uid() or nutri_id = auth.uid());

drop policy if exists checkin_envios_insert_nutri on public.checkin_envios;
create policy checkin_envios_insert_nutri on public.checkin_envios
  for insert with check (nutri_id = auth.uid());

drop policy if exists checkin_envios_update on public.checkin_envios;
create policy checkin_envios_update on public.checkin_envios
  for update using (paciente_id = auth.uid() or nutri_id = auth.uid())
  with check (paciente_id = auth.uid() or nutri_id = auth.uid());

drop policy if exists checkin_envios_delete_nutri on public.checkin_envios;
create policy checkin_envios_delete_nutri on public.checkin_envios
  for delete using (nutri_id = auth.uid());

-- Agendamentos: nutri gerencia os próprios (paciente não vê)
drop policy if exists checkin_agendamentos_all_nutri on public.checkin_agendamentos;
create policy checkin_agendamentos_all_nutri on public.checkin_agendamentos
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- Serviços: nutri gerencia os próprios (paciente não vê)
drop policy if exists servicos_all_nutri on public.servicos;
create policy servicos_all_nutri on public.servicos
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.10b fotos_evolucao (paciente vê próprias; nutri vê das pacientes)
drop policy if exists fotos_evolucao_select on public.fotos_evolucao;
create policy fotos_evolucao_select on public.fotos_evolucao
  for select using (
    paciente_id = auth.uid()
    or exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
  );

drop policy if exists fotos_evolucao_insert_nutri on public.fotos_evolucao;
create policy fotos_evolucao_insert_nutri on public.fotos_evolucao
  for insert with check (
    exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
  );

drop policy if exists fotos_evolucao_insert_paciente on public.fotos_evolucao;
create policy fotos_evolucao_insert_paciente on public.fotos_evolucao
  for insert with check (paciente_id = auth.uid());

drop policy if exists fotos_evolucao_delete on public.fotos_evolucao;
create policy fotos_evolucao_delete on public.fotos_evolucao
  for delete using (
    paciente_id = auth.uid()
    or exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
  );

-- 4.10c pacientes_pendentes (só a nutri dona) ----------------------
drop policy if exists pacientes_pendentes_all_nutri on public.pacientes_pendentes;
create policy pacientes_pendentes_all_nutri on public.pacientes_pendentes
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- 4.11 consultas (nutri gerencia; paciente vê só as próprias) ------
drop policy if exists consultas_select on public.consultas;
create policy consultas_select on public.consultas
  for select using (paciente_id = auth.uid() or nutri_id = auth.uid());

drop policy if exists consultas_write_nutri on public.consultas;
create policy consultas_write_nutri on public.consultas
  for all using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());


-- =============================================================
-- 5. TRIGGER: handle_new_user
-- =============================================================
-- Quando alguém aceita o convite do Supabase (e portanto cria uma
-- linha em auth.users), espelhamos automaticamente em nutris ou
-- pacientes — conforme o `user_metadata.role` enviado no invite.
--
-- Fluxo:
--   • Nutri se cadastra normal via signUp({ data: { role: 'nutri',
--     nome: '...', crn: '...' } }) → cria linha em `nutris`.
--   • Nutri convida paciente via Edge Function que chama
--     auth.admin.inviteUserByEmail(email, { data: {
--       role: 'paciente', nutri_id, nome, objetivo, tipo_plano,
--       modalidade } }) → ao aceitar, cria linha em `pacientes`.
-- =============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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
      v_nutri_id    uuid := (new.raw_user_meta_data ->> 'nutri_id')::uuid;
      v_pendente    public.pacientes_pendentes%rowtype;
    begin
      -- Tenta encontrar paciente pendente importada com o mesmo email
      select * into v_pendente
      from public.pacientes_pendentes
      where nutri_id = v_nutri_id and lower(email) = lower(new.email)
      limit 1;

      if found then
        -- Migra dados da importação, preenchendo com o que veio no signup
        insert into public.pacientes (
          id, nutri_id, nome, email, objetivo, tipo_plano, modalidade
        )
        values (
          new.id,
          v_nutri_id,
          coalesce(new.raw_user_meta_data ->> 'nome',       v_pendente.nome,       new.email),
          new.email,
          coalesce(new.raw_user_meta_data ->> 'objetivo',   v_pendente.objetivo),
          coalesce(new.raw_user_meta_data ->> 'tipo_plano', v_pendente.tipo_plano),
          coalesce(new.raw_user_meta_data ->> 'modalidade', v_pendente.modalidade)
        )
        on conflict (id) do nothing;

        update public.pacientes_pendentes
          set status = 'ativado'
          where id = v_pendente.id;
      else
        insert into public.pacientes (
          id, nutri_id, nome, email, objetivo, tipo_plano, modalidade
        )
        values (
          new.id,
          v_nutri_id,
          coalesce(new.raw_user_meta_data ->> 'nome', new.email),
          new.email,
          new.raw_user_meta_data ->> 'objetivo',
          new.raw_user_meta_data ->> 'tipo_plano',
          new.raw_user_meta_data ->> 'modalidade'
        )
        on conflict (id) do nothing;
      end if;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================
-- 6. STORAGE BUCKETS
-- =============================================================
-- Convenção de caminho: <paciente_id>/<arquivo>
-- Isso permite que as políticas usem split_part(name,'/',1) para
-- identificar a paciente dona da pasta.
-- =============================================================
insert into storage.buckets (id, name, public)
values ('prescricoes', 'prescricoes', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('fotos_pratos', 'fotos_pratos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('fotos_evolucao', 'fotos_evolucao', false)
on conflict (id) do nothing;


-- =============================================================
-- 7. POLÍTICAS DE STORAGE
-- =============================================================

-- 7.1 prescricoes (nutri envia PDFs; paciente lê os próprios) ------

drop policy if exists prescricoes_storage_select on storage.objects;
create policy prescricoes_storage_select on storage.objects
  for select using (
    bucket_id = 'prescricoes'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) in (
        select id::text from public.pacientes where nutri_id = auth.uid()
      )
    )
  );

drop policy if exists prescricoes_storage_insert_nutri on storage.objects;
create policy prescricoes_storage_insert_nutri on storage.objects
  for insert with check (
    bucket_id = 'prescricoes'
    and split_part(name, '/', 1) in (
      select id::text from public.pacientes where nutri_id = auth.uid()
    )
  );

drop policy if exists prescricoes_storage_delete_nutri on storage.objects;
create policy prescricoes_storage_delete_nutri on storage.objects
  for delete using (
    bucket_id = 'prescricoes'
    and split_part(name, '/', 1) in (
      select id::text from public.pacientes where nutri_id = auth.uid()
    )
  );

-- 7.2 fotos_pratos (paciente posta na própria pasta; nutri lê) -----

drop policy if exists fotos_pratos_storage_select on storage.objects;
create policy fotos_pratos_storage_select on storage.objects
  for select using (
    bucket_id = 'fotos_pratos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) in (
        select id::text from public.pacientes where nutri_id = auth.uid()
      )
    )
  );

drop policy if exists fotos_pratos_storage_insert_paciente on storage.objects;
create policy fotos_pratos_storage_insert_paciente on storage.objects
  for insert with check (
    bucket_id = 'fotos_pratos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists fotos_pratos_storage_delete_paciente on storage.objects;
create policy fotos_pratos_storage_delete_paciente on storage.objects
  for delete using (
    bucket_id = 'fotos_pratos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- 7.3 fotos_evolucao (nutri OU paciente sobem; ambos leem) ---------

drop policy if exists fotos_evolucao_storage_select on storage.objects;
create policy fotos_evolucao_storage_select on storage.objects
  for select using (
    bucket_id = 'fotos_evolucao'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) in (
        select id::text from public.pacientes where nutri_id = auth.uid()
      )
    )
  );

drop policy if exists fotos_evolucao_storage_insert_paciente on storage.objects;
create policy fotos_evolucao_storage_insert_paciente on storage.objects
  for insert with check (
    bucket_id = 'fotos_evolucao'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists fotos_evolucao_storage_insert_nutri on storage.objects;
create policy fotos_evolucao_storage_insert_nutri on storage.objects
  for insert with check (
    bucket_id = 'fotos_evolucao'
    and split_part(name, '/', 1) in (
      select id::text from public.pacientes where nutri_id = auth.uid()
    )
  );

drop policy if exists fotos_evolucao_storage_delete on storage.objects;
create policy fotos_evolucao_storage_delete on storage.objects
  for delete using (
    bucket_id = 'fotos_evolucao'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) in (
        select id::text from public.pacientes where nutri_id = auth.uid()
      )
    )
  );


-- =============================================================
-- 7.b REALTIME PUBLICATION (chat em tempo real)
-- =============================================================
-- Adiciona mensagens à publicação supabase_realtime para que
-- INSERTs disparem eventos no cliente via supabase.channel().
-- Idempotente: ignora erro se já estiver adicionado.
-- =============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.mensagens;
  exception when duplicate_object then null;
  end;
end$$;


-- =============================================================
-- 8. GRANTS (privilégios de acesso aos roles do Supabase)
-- =============================================================
-- O Supabase normalmente aplica esses GRANTs automaticamente em
-- projetos novos. Em alguns projetos eles não vêm — sem isso o
-- PostgREST retorna 403 antes de checar a RLS, então login real
-- não funciona. Reaplicar é idempotente e seguro.
-- A segurança real é garantida pela RLS, não pelos GRANTs.
-- =============================================================
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- Garante que tabelas criadas FUTURAMENTE também tenham os GRANTs
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant execute on functions
  to anon, authenticated, service_role;


-- =============================================================
-- 9. AGENDAMENTO AUTOMÁTICO DE CHECK-INS (pg_cron — opcional)
-- =============================================================
-- Sem isto, os agendamentos só disparam quando a nutri abre
-- `/nutri/checkins`. Com pg_cron habilitado, dispara todo dia 8h
-- (horário de Brasília) mesmo que a nutri não abra o app.
--
-- Como habilitar pg_cron no Supabase:
--   1. Dashboard → Database → Extensions → busque "pg_cron"
--   2. Clique em "Enable"
--   3. Rode este bloco no SQL Editor
-- =============================================================

-- Função que processa todos os agendamentos vencidos
create or replace function public.processar_agendamentos_checkin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ag       record;
  pac_id   uuid;
  prox     date;
begin
  for ag in
    select * from public.checkin_agendamentos
    where ativo = true and proximo_envio <= current_date
    for update skip locked
  loop
    -- Para "todas as pacientes", cria 1 envio pra cada
    if ag.paciente_id is null then
      for pac_id in
        select id from public.pacientes where nutri_id = ag.nutri_id
      loop
        insert into public.checkin_envios (nutri_id, paciente_id, perguntas)
        select ag.nutri_id, pac_id, t.perguntas
        from public.checkin_templates t where t.id = ag.template_id;
      end loop;
    else
      insert into public.checkin_envios (nutri_id, paciente_id, perguntas)
      select ag.nutri_id, ag.paciente_id, t.perguntas
      from public.checkin_templates t where t.id = ag.template_id;
    end if;

    -- Avança próximo envio conforme frequência
    prox := case ag.frequencia
      when 'semanal'    then ag.proximo_envio + interval '7 days'
      when 'quinzenal'  then ag.proximo_envio + interval '14 days'
      when 'mensal'     then ag.proximo_envio + interval '1 month'
      else                   ag.proximo_envio + interval '7 days'
    end;

    update public.checkin_agendamentos
      set proximo_envio = prox, ultimo_envio = now()
      where id = ag.id;
  end loop;
end;
$$;

-- Agenda execução diária às 11 UTC (= 8h horário de Brasília)
-- pg_cron é OPCIONAL. Se não estiver habilitado, esse bloco simplesmente pula.
-- Pra habilitar: Database → Extensions → busca "pg_cron" → enable → rode o setup de novo.
do $$
begin
  -- Só tenta agendar SE o schema "cron" existir (pg_cron habilitado)
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.schedule(
        'lapidare-checkins-diario',
        '0 11 * * *',
        $cron$select public.processar_agendamentos_checkin();$cron$
      );
      raise notice 'pg_cron agendado: check-ins automáticos vão rodar diariamente às 11 UTC';
    exception
      when duplicate_object then null;  -- já agendado, tudo bem
      when others then
        raise notice 'pg_cron presente mas não foi possível agendar: %', SQLERRM;
    end;
  else
    raise notice 'pg_cron NÃO habilitado (opcional). Pra ativar check-ins automáticos: Database → Extensions → pg_cron → enable, depois rode o setup de novo.';
  end if;
end$$;


-- =============================================================
-- 10. EXTRAS — recursos adicionados depois (idempotente)
-- =============================================================
-- E-books (biblioteca), Follow-ups (anotações), Suplementação,
-- LGPD (termo + nascimento), Pré-consulta (questionários),
-- Cadastro manual (token único)
-- =============================================================

-- 10.1 Colunas extras em tabelas existentes ---------------------
alter table public.pacientes        add column if not exists nascimento       date;
alter table public.pacientes        add column if not exists termo_aceito_em  timestamptz;
alter table public.pacientes        add column if not exists termo_versao     text;

alter table public.checkin_templates add column if not exists tipo text not null default 'recorrente';
alter table public.checkin_templates drop constraint if exists checkin_templates_tipo_check;
alter table public.checkin_templates
  add constraint checkin_templates_tipo_check check (tipo in ('recorrente', 'pre_consulta'));

alter table public.checkin_envios   add column if not exists nome text;
alter table public.checkin_envios   add column if not exists tipo text not null default 'recorrente';
alter table public.checkin_envios   drop constraint if exists checkin_envios_tipo_check;
alter table public.checkin_envios
  add constraint checkin_envios_tipo_check check (tipo in ('recorrente', 'pre_consulta'));

alter table public.pacientes_pendentes
  add column if not exists token uuid not null default gen_random_uuid();
create unique index if not exists pacientes_pendentes_token_idx on public.pacientes_pendentes(token);

alter table public.prescricoes drop constraint if exists prescricoes_tipo_check;
alter table public.prescricoes
  add constraint prescricoes_tipo_check
  check (tipo in ('exame', 'laudo', 'receita', 'suplementacao'));


-- 10.2 E-books (biblioteca + atribuições) ----------------------
create table if not exists public.ebooks (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  titulo        text not null,
  descricao     text,
  storage_path  text not null,
  tag           text,
  created_at    timestamptz not null default now()
);
create index if not exists ebooks_nutri_idx on public.ebooks(nutri_id, created_at desc);

create table if not exists public.ebooks_pacientes (
  id          uuid primary key default gen_random_uuid(),
  ebook_id    uuid not null references public.ebooks(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (ebook_id, paciente_id)
);
create index if not exists ebooks_pacientes_paciente_idx on public.ebooks_pacientes(paciente_id);
create index if not exists ebooks_pacientes_ebook_idx    on public.ebooks_pacientes(ebook_id);


-- 10.3 Follow-ups (anotações da nutri) -------------------------
create table if not exists public.followup_templates (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null references public.nutris(id) on delete cascade,
  nome        text not null,
  descricao   text,
  conteudo    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists followup_templates_nutri_idx
  on public.followup_templates(nutri_id, created_at desc);

create table if not exists public.followups (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  nutri_id    uuid not null references public.nutris(id) on delete cascade,
  titulo      text not null,
  conteudo    text not null,
  data        date not null default current_date,
  template_id uuid references public.followup_templates(id) on delete set null,
  consulta_id uuid references public.consultas(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists followups_paciente_idx on public.followups(paciente_id, data desc, created_at desc);
create index if not exists followups_nutri_idx    on public.followups(nutri_id);


-- 10.4 Suplementação (lista + habit tracker) -------------------
create table if not exists public.suplementos (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  nutri_id    uuid not null references public.nutris(id) on delete cascade,
  nome        text not null,
  dose        text,
  horario     text,
  obs         text,
  ordem       int not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists suplementos_paciente_idx on public.suplementos(paciente_id, ativo, ordem);

create table if not exists public.suplementos_logs (
  id            uuid primary key default gen_random_uuid(),
  suplemento_id uuid not null references public.suplementos(id) on delete cascade,
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  data          date not null default current_date,
  tomado        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (suplemento_id, data)
);
create index if not exists suplementos_logs_paciente_idx on public.suplementos_logs(paciente_id, data desc);


-- 10.5 RLS + policies das tabelas novas ------------------------
alter table public.ebooks              enable row level security;
alter table public.ebooks_pacientes    enable row level security;
alter table public.followup_templates  enable row level security;
alter table public.followups           enable row level security;
alter table public.suplementos         enable row level security;
alter table public.suplementos_logs    enable row level security;

-- ebooks
drop policy if exists ebooks_select on public.ebooks;
create policy ebooks_select on public.ebooks for select using (
  nutri_id = auth.uid()
  or exists (select 1 from public.ebooks_pacientes ep where ep.ebook_id = id and ep.paciente_id = auth.uid())
);
drop policy if exists ebooks_write_nutri on public.ebooks;
create policy ebooks_write_nutri on public.ebooks for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- ebooks_pacientes
drop policy if exists ebooks_pacientes_select on public.ebooks_pacientes;
create policy ebooks_pacientes_select on public.ebooks_pacientes for select using (
  paciente_id = auth.uid()
  or exists (select 1 from public.ebooks e where e.id = ebook_id and e.nutri_id = auth.uid())
);
drop policy if exists ebooks_pacientes_write_nutri on public.ebooks_pacientes;
create policy ebooks_pacientes_write_nutri on public.ebooks_pacientes for all
  using (exists (select 1 from public.ebooks e where e.id = ebook_id and e.nutri_id = auth.uid()))
  with check (exists (select 1 from public.ebooks e where e.id = ebook_id and e.nutri_id = auth.uid()));

-- followup_templates + followups (só a nutri)
drop policy if exists followup_templates_all_nutri on public.followup_templates;
create policy followup_templates_all_nutri on public.followup_templates for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
drop policy if exists followups_all_nutri on public.followups;
create policy followups_all_nutri on public.followups for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- suplementos (nutri gerencia, paciente vê os próprios)
drop policy if exists suplementos_select on public.suplementos;
create policy suplementos_select on public.suplementos for select
  using (paciente_id = auth.uid() or nutri_id = auth.uid());
drop policy if exists suplementos_write_nutri on public.suplementos;
create policy suplementos_write_nutri on public.suplementos for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- suplementos_logs (paciente marca, nutri lê)
drop policy if exists suplementos_logs_select on public.suplementos_logs;
create policy suplementos_logs_select on public.suplementos_logs for select using (
  paciente_id = auth.uid()
  or exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
);
drop policy if exists suplementos_logs_write_paciente on public.suplementos_logs;
create policy suplementos_logs_write_paciente on public.suplementos_logs for all
  using (paciente_id = auth.uid()) with check (paciente_id = auth.uid());

-- Paciente atualizar próprio registro (pra termo LGPD)
drop policy if exists pacientes_update_self on public.pacientes;
create policy pacientes_update_self on public.pacientes for update
  using (id = auth.uid()) with check (id = auth.uid());


-- 10.5-b Bucket de documentos (PDFs do Plano/Substituições/Compras) — v1.10.0
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', true)
on conflict (id) do nothing;

drop policy if exists documentos_select on storage.objects;
create policy documentos_select on storage.objects
  for select using (bucket_id = 'documentos');

drop policy if exists documentos_insert on storage.objects;
create policy documentos_insert on storage.objects
  for insert with check (
    bucket_id = 'documentos' and auth.uid() is not null
  );

drop policy if exists documentos_update on storage.objects;
create policy documentos_update on storage.objects
  for update using (
    bucket_id = 'documentos' and auth.uid() is not null
  );

drop policy if exists documentos_delete on storage.objects;
create policy documentos_delete on storage.objects
  for delete using (
    bucket_id = 'documentos' and auth.uid() is not null
  );


-- 10.6 Bucket de e-books + policies ----------------------------
insert into storage.buckets (id, name, public)
values ('ebooks', 'ebooks', false)
on conflict (id) do nothing;

drop policy if exists ebooks_storage_select on storage.objects;
create policy ebooks_storage_select on storage.objects for select using (
  bucket_id = 'ebooks'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.ebooks e
      join public.ebooks_pacientes ep on ep.ebook_id = e.id
      where e.storage_path = name and ep.paciente_id = auth.uid()
    )
  )
);
drop policy if exists ebooks_storage_insert on storage.objects;
create policy ebooks_storage_insert on storage.objects for insert with check (
  bucket_id = 'ebooks' and split_part(name, '/', 1) = auth.uid()::text
);
drop policy if exists ebooks_storage_delete on storage.objects;
create policy ebooks_storage_delete on storage.objects for delete using (
  bucket_id = 'ebooks' and split_part(name, '/', 1) = auth.uid()::text
);


-- 10.7 Função pública pra buscar pendente por token ------------
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


-- 10.8 handle_new_user atualizado (nascimento + pré-consulta) --
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
        values (v_nutri_id, new.id,
          coalesce(v_template.nome, 'Check-in pré-consulta'),
          'pre_consulta', v_template.perguntas, now());
      end loop;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();


-- 10.9 processar_agendamentos_checkin atualizado --------------
create or replace function public.processar_agendamentos_checkin()
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_ag record; v_tpl record; v_proximo date;
begin
  for v_ag in select * from public.checkin_agendamentos
    where ativo = true and proximo_envio <= current_date
  loop
    select id, nome, perguntas into v_tpl from public.checkin_templates where id = v_ag.template_id;
    insert into public.checkin_envios (nutri_id, paciente_id, nome, tipo, perguntas, enviado_em)
    values (v_ag.nutri_id, v_ag.paciente_id,
      coalesce(v_tpl.nome, 'Check-in'), 'recorrente', v_tpl.perguntas, now());
    v_proximo := case v_ag.frequencia
      when 'semanal'   then v_ag.proximo_envio + interval '7 days'
      when 'quinzenal' then v_ag.proximo_envio + interval '14 days'
      when 'mensal'    then v_ag.proximo_envio + interval '1 month'
      else v_ag.proximo_envio + interval '7 days'
    end;
    update public.checkin_agendamentos
      set proximo_envio = v_proximo, ultimo_envio = now()
      where id = v_ag.id;
  end loop;
end;
$$;


-- 10.10 GRANTs nas tabelas novas -------------------------------
grant select, insert, update, delete on public.ebooks              to anon, authenticated, service_role;
grant select, insert, update, delete on public.ebooks_pacientes    to anon, authenticated, service_role;
grant select, insert, update, delete on public.followup_templates  to anon, authenticated, service_role;
grant select, insert, update, delete on public.followups           to anon, authenticated, service_role;
grant select, insert, update, delete on public.suplementos         to anon, authenticated, service_role;
grant select, insert, update, delete on public.suplementos_logs    to anon, authenticated, service_role;


-- =============================================================
-- 11. PERSONALIZAÇÃO (logo, cores, tipografia, textos)
-- =============================================================
alter table public.nutris add column if not exists logo_url        text;
alter table public.nutris add column if not exists marca_nome      text default 'Lapidare';
alter table public.nutris add column if not exists marca_subtitulo text;
alter table public.nutris add column if not exists cor_primaria    text default '#a08456';
alter table public.nutris add column if not exists cor_secundaria  text default '#c9a96e';
alter table public.nutris add column if not exists tipografia      text default 'classica';
alter table public.nutris add column if not exists mensagem_login  text;
alter table public.nutris add column if not exists mensagem_termo  text;
-- Override manual da cor do texto na sidebar (auto-calculada por luminância
-- por padrão; aqui a nutri pode forçar uma cor específica se quiser controle total)
alter table public.nutris add column if not exists cor_texto_sidebar text;

-- Foto de perfil da nutri (aparece pras pacientes no chat, feed, banners)
alter table public.nutris add column if not exists foto_url text;

alter table public.nutris drop constraint if exists nutris_tipografia_check;
alter table public.nutris add constraint nutris_tipografia_check
  check (tipografia in ('classica', 'modern', 'minimal', 'romantica'));

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Garante que o bucket é público (idempotente)
update storage.buckets set public = true where id = 'logos';

-- SELECT público (bucket é público, mas a policy explícita garante)
drop policy if exists logos_storage_select on storage.objects;
create policy logos_storage_select on storage.objects for select using (
  bucket_id = 'logos'
);

-- Como cada nutri tem SEU PRÓPRIO Supabase (1 nutri por deploy), permite
-- qualquer usuário autenticado fazer upload/update/delete no bucket logos.
-- Mais permissivo que checar UUID (que dava erro de RLS).
drop policy if exists logos_storage_insert on storage.objects;
create policy logos_storage_insert on storage.objects for insert with check (
  bucket_id = 'logos' and auth.uid() is not null
);
drop policy if exists logos_storage_update on storage.objects;
create policy logos_storage_update on storage.objects for update
  using (bucket_id = 'logos' and auth.uid() is not null)
  with check (bucket_id = 'logos' and auth.uid() is not null);
drop policy if exists logos_storage_delete on storage.objects;
create policy logos_storage_delete on storage.objects for delete using (
  bucket_id = 'logos' and auth.uid() is not null
);

-- DROP antes do CREATE pra permitir mudar o retorno (Postgres bloqueia
-- create-or-replace quando o return type muda)
drop function if exists public.buscar_personalizacao_nutri(uuid);

create or replace function public.buscar_personalizacao_nutri(p_nutri_id uuid)
returns table(
  marca_nome text, marca_subtitulo text, logo_url text,
  cor_primaria text, cor_secundaria text, tipografia text,
  mensagem_login text, mensagem_termo text, cor_texto_sidebar text,
  nutri_nome text, nutri_foto_url text
)
language sql security definer set search_path = public
as $$
  select
    coalesce(marca_nome, 'Lapidare'),
    marca_subtitulo, logo_url,
    coalesce(cor_primaria,   '#a08456'),
    coalesce(cor_secundaria, '#c9a96e'),
    coalesce(tipografia,     'classica'),
    mensagem_login, mensagem_termo, cor_texto_sidebar,
    coalesce(nome, 'Sua nutri') as nutri_nome,
    foto_url as nutri_foto_url
  from public.nutris where id = p_nutri_id limit 1;
$$;
grant execute on function public.buscar_personalizacao_nutri(uuid) to anon, authenticated;


-- 11.X buscar_marca_principal · usada pela tela de Login (anônimo)
-- Cada deploy é de UMA nutri (a "dona"). Essa função retorna a marca dela
-- pra personalizar a tela de Login antes mesmo de qualquer usuário logar.
-- DROP antes pra permitir mudar o retorno (mesmo motivo da função acima)
drop function if exists public.buscar_marca_principal();

create or replace function public.buscar_marca_principal()
returns table(
  marca_nome text, marca_subtitulo text, logo_url text,
  cor_primaria text, cor_secundaria text, tipografia text,
  mensagem_login text, cor_texto_sidebar text
)
language sql security definer set search_path = public
as $$
  select
    coalesce(marca_nome, 'Lapidare'),
    marca_subtitulo, logo_url,
    coalesce(cor_primaria,   '#a08456'),
    coalesce(cor_secundaria, '#c9a96e'),
    coalesce(tipografia,     'classica'),
    mensagem_login, cor_texto_sidebar
  from public.nutris
  order by created_at asc
  limit 1;
$$;
grant execute on function public.buscar_marca_principal() to anon, authenticated;


-- =============================================================
-- 12. HÁBITOS + AVISO E-BOOK + FIX RECURSÃO RLS
-- =============================================================

-- 12.1 ebooks_pacientes.visto_em (controle "novo" pra paciente)
alter table public.ebooks_pacientes add column if not exists visto_em timestamptz;


-- 12.2 SECURITY DEFINER pra quebrar recursão entre ebooks ↔ ebooks_pacientes
create or replace function public.paciente_pode_ver_ebook(p_ebook_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.ebooks_pacientes
    where ebook_id = p_ebook_id and paciente_id = auth.uid()
  );
$$;

create or replace function public.nutri_dona_do_ebook(p_ebook_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.ebooks where id = p_ebook_id and nutri_id = auth.uid()
  );
$$;

grant execute on function public.paciente_pode_ver_ebook(uuid) to anon, authenticated;
grant execute on function public.nutri_dona_do_ebook(uuid)     to anon, authenticated;


-- 12.3 Reescreve policies de ebooks sem recursão
drop policy if exists ebooks_select on public.ebooks;
create policy ebooks_select on public.ebooks for select using (
  nutri_id = auth.uid() or public.paciente_pode_ver_ebook(id)
);

drop policy if exists ebooks_pacientes_select on public.ebooks_pacientes;
create policy ebooks_pacientes_select on public.ebooks_pacientes for select using (
  paciente_id = auth.uid() or public.nutri_dona_do_ebook(ebook_id)
);

drop policy if exists ebooks_pacientes_write_nutri on public.ebooks_pacientes;
create policy ebooks_pacientes_write_nutri on public.ebooks_pacientes for all
  using (public.nutri_dona_do_ebook(ebook_id))
  with check (public.nutri_dona_do_ebook(ebook_id));

drop policy if exists ebooks_pacientes_update_paciente on public.ebooks_pacientes;
create policy ebooks_pacientes_update_paciente on public.ebooks_pacientes for update
  using (paciente_id = auth.uid()) with check (paciente_id = auth.uid());

drop policy if exists ebooks_storage_select on storage.objects;
create policy ebooks_storage_select on storage.objects for select using (
  bucket_id = 'ebooks'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.ebooks e
      where e.storage_path = name and public.paciente_pode_ver_ebook(e.id)
    )
  )
);


-- 12.4 Habit tracker personalizado
create table if not exists public.habitos (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  nutri_id      uuid not null references public.nutris(id) on delete cascade,
  nome          text not null,
  emoji         text,
  tipo          text not null default 'boolean',
  meta          numeric,
  unidade       text,
  ordem         int not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.habitos drop constraint if exists habitos_tipo_check;
alter table public.habitos add constraint habitos_tipo_check
  check (tipo in ('boolean', 'numero', 'escala'));
create index if not exists habitos_paciente_idx on public.habitos(paciente_id, ativo, ordem);

create table if not exists public.habitos_logs (
  id            uuid primary key default gen_random_uuid(),
  habito_id     uuid not null references public.habitos(id) on delete cascade,
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  data          date not null default current_date,
  valor         numeric not null,
  created_at    timestamptz not null default now(),
  unique (habito_id, data)
);
create index if not exists habitos_logs_paciente_idx on public.habitos_logs(paciente_id, data desc);

alter table public.habitos       enable row level security;
alter table public.habitos_logs  enable row level security;

drop policy if exists habitos_select on public.habitos;
create policy habitos_select on public.habitos for select
  using (paciente_id = auth.uid() or nutri_id = auth.uid());

drop policy if exists habitos_write_nutri on public.habitos;
create policy habitos_write_nutri on public.habitos for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

drop policy if exists habitos_logs_select on public.habitos_logs;
create policy habitos_logs_select on public.habitos_logs for select using (
  paciente_id = auth.uid()
  or exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
);

drop policy if exists habitos_logs_write_paciente on public.habitos_logs;
create policy habitos_logs_write_paciente on public.habitos_logs for all
  using (paciente_id = auth.uid()) with check (paciente_id = auth.uid());

grant select, insert, update, delete on public.habitos       to anon, authenticated, service_role;
grant select, insert, update, delete on public.habitos_logs  to anon, authenticated, service_role;


-- =============================================================
-- 13. ANAMNESE CLÍNICA (registro interno da nutri + PDF)
-- =============================================================

create table if not exists public.anamnese_templates (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null references public.nutris(id) on delete cascade,
  nome        text not null,
  descricao   text,
  estrutura   jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists anamnese_templates_nutri_idx
  on public.anamnese_templates(nutri_id, created_at desc);

create table if not exists public.anamneses (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references public.pacientes(id) on delete cascade,
  nutri_id     uuid not null references public.nutris(id) on delete cascade,
  titulo       text not null,
  estrutura    jsonb not null,
  respostas    jsonb not null default '{}'::jsonb,
  data         date not null default current_date,
  template_id  uuid references public.anamnese_templates(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists anamneses_paciente_idx
  on public.anamneses(paciente_id, data desc, created_at desc);

alter table public.anamnese_templates enable row level security;
alter table public.anamneses           enable row level security;

drop policy if exists anamnese_templates_all_nutri on public.anamnese_templates;
create policy anamnese_templates_all_nutri on public.anamnese_templates for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

drop policy if exists anamneses_all_nutri on public.anamneses;
create policy anamneses_all_nutri on public.anamneses for all
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

grant select, insert, update, delete on public.anamnese_templates to anon, authenticated, service_role;
grant select, insert, update, delete on public.anamneses          to anon, authenticated, service_role;


-- =============================================================
-- FIM — Lapidare setup
-- =============================================================
-- Pós-instalação na nutri:
--   1. Em Authentication → Providers, garanta que "Email" está
--      habilitado.
--   2. Em Authentication → URL Configuration, defina a Site URL
--      como a URL final do Netlify (ex: https://app-da-nutri.netlify.app).
--   3. Em Authentication → Templates, edite o template "Invite user"
--      em português se desejar.
--   4. (Opcional) Em Database → Extensions, habilite `pg_cron`
--      para envio automático de check-ins.
-- =============================================================
