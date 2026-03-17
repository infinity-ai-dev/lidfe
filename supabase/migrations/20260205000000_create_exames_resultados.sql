create table if not exists public.exames_resultados (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.usuarios(user_id) on delete cascade,
  task_exame_id integer null references public.tasks_listaexames(id) on delete set null,
  id_threadconversa text null,
  titulo text null,
  file_url text not null,
  file_name text null,
  mime_type text null,
  file_type text null,
  source text null,
  storage_bucket text null,
  storage_path text null
);

create index if not exists exames_resultados_user_id_created_at_idx
  on public.exames_resultados (user_id, created_at desc);

create index if not exists exames_resultados_task_exame_id_idx
  on public.exames_resultados (task_exame_id);

alter table public.exames_resultados enable row level security;

create policy "exames_resultados_select_own"
  on public.exames_resultados
  for select
  using (auth.uid() = user_id);

create policy "exames_resultados_insert_own"
  on public.exames_resultados
  for insert
  with check (auth.uid() = user_id);

create policy "exames_resultados_update_own"
  on public.exames_resultados
  for update
  using (auth.uid() = user_id);

create policy "exames_resultados_delete_own"
  on public.exames_resultados
  for delete
  using (auth.uid() = user_id);
