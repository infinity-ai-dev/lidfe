alter table public.anamnesechathistorico
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists file_type text;

alter table public.anamnesechathistorico
  drop constraint if exists anamnesechathistorico_type_check;

alter table public.anamnesechathistorico
  add constraint anamnesechathistorico_type_check
    check (type in ('text', 'audio', 'file'));

comment on column public.anamnesechathistorico.message is
  'Mensagem de texto ou base64 (áudio/arquivo). Para mensagens de arquivo, usar file_name/file_size/file_type.';
