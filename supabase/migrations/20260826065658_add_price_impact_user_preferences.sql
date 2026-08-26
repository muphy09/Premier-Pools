begin;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  price_impact_enabled boolean not null default true,
  price_impact_display_basis text not null default 'retail',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_price_impact_display_basis_check
    check (price_impact_display_basis in ('retail', 'cogs'))
);

comment on table public.user_preferences is
  'Self-service preferences scoped to one authenticated Submerge user.';
comment on column public.user_preferences.price_impact_enabled is
  'Whether the user wants Price Impact controls visible when their franchise permits the feature.';
comment on column public.user_preferences.price_impact_display_basis is
  'Whether Price Impact amounts are displayed as retail or COGS.';

alter table public.user_preferences enable row level security;

revoke all on public.user_preferences from public, anon;
grant select, insert, update on public.user_preferences to authenticated;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
