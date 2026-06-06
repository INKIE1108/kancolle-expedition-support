-- 艦これ遠征サポート v2.0 用 Supabase SQL
-- Supabase Dashboard > SQL Editor で実行してください。

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
  on public.user_settings for select
  using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fleet_no integer not null,
  expedition_id text not null,
  expedition_name text not null,
  end_at timestamptz not null,
  content text not null,
  status text not null default 'pending',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_notifications_due_idx
  on public.scheduled_notifications (status, end_at);

alter table public.scheduled_notifications enable row level security;

drop policy if exists "scheduled_notifications_select_own" on public.scheduled_notifications;
create policy "scheduled_notifications_select_own"
  on public.scheduled_notifications for select
  using (auth.uid() = user_id);

drop policy if exists "scheduled_notifications_insert_own" on public.scheduled_notifications;
create policy "scheduled_notifications_insert_own"
  on public.scheduled_notifications for insert
  with check (auth.uid() = user_id);

drop policy if exists "scheduled_notifications_delete_own" on public.scheduled_notifications;
create policy "scheduled_notifications_delete_own"
  on public.scheduled_notifications for delete
  using (auth.uid() = user_id);
