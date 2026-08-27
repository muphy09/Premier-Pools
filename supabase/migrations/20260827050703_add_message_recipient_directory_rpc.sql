begin;

create or replace function public.list_franchise_message_recipient_options(
  p_franchise_id text
)
returns table (
  recipient_profile_id text,
  recipient_display_name text,
  recipient_email text,
  recipient_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.franchise_users%rowtype;
  v_actor_role text;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if nullif(trim(coalesce(p_franchise_id, '')), '') is null then
    raise exception 'A franchise is required.';
  end if;

  select profile.*
  into v_actor
  from public.franchise_users profile
  where profile.auth_user_id = v_auth_user_id
    and coalesce(profile.is_active, true) = true
  limit 1;

  if not found then
    raise exception 'An active franchise profile is required.';
  end if;

  v_actor_role := lower(trim(coalesce(v_actor.role, '')));

  if v_actor_role = 'master' then
    if not exists (
      select 1
      from public.franchises franchise
      where franchise.id = p_franchise_id
        and coalesce(franchise.is_active, true) = true
        and franchise.deleted_at is null
    ) then
      raise exception 'The selected franchise is not active.';
    end if;
  elsif v_actor_role in ('owner', 'admin') then
    if v_actor.franchise_id is distinct from p_franchise_id then
      raise exception 'Message recipients can only be listed within your franchise.';
    end if;
  else
    raise exception 'Only owners, admins, and master accounts can list message recipients.';
  end if;

  return query
  select
    recipient.id::text,
    coalesce(
      nullif(trim(coalesce(recipient.name, '')), ''),
      nullif(trim(coalesce(recipient.email::text, '')), ''),
      'User'
    ),
    nullif(trim(coalesce(recipient.email::text, '')), ''),
    lower(coalesce(recipient.role, 'designer'))
  from public.franchise_users recipient
  where recipient.franchise_id = p_franchise_id
    and recipient.auth_user_id is not null
    and coalesce(recipient.is_active, true) = true
    and lower(coalesce(recipient.role, '')) in ('owner', 'admin', 'bookkeeper', 'designer')
  order by
    coalesce(nullif(trim(coalesce(recipient.name, '')), ''), recipient.email::text),
    recipient.email::text;
end;
$$;

revoke all on function public.list_franchise_message_recipient_options(text)
  from public, anon, authenticated;
grant execute on function public.list_franchise_message_recipient_options(text)
  to authenticated;

commit;
