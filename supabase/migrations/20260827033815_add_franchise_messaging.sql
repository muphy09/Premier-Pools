begin;

create table if not exists public.franchise_messages (
  id uuid primary key default gen_random_uuid(),
  franchise_id text not null,
  subject text not null,
  body_document jsonb not null,
  body_plain_text text not null,
  audience_type text not null,
  sender_type text not null,
  sender_display_name text not null,
  author_auth_user_id uuid not null,
  author_profile_id text,
  author_display_name text not null,
  author_email text,
  author_role text not null,
  total_recipient_count integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint franchise_messages_subject_length
    check (char_length(trim(subject)) between 1 and 120),
  constraint franchise_messages_body_length
    check (char_length(trim(body_plain_text)) between 1 and 5000),
  constraint franchise_messages_body_document_shape
    check (jsonb_typeof(body_document) = 'object'),
  constraint franchise_messages_audience_type
    check (audience_type in ('broadcast', 'selected')),
  constraint franchise_messages_sender_type
    check (sender_type in ('franchise', 'person')),
  constraint franchise_messages_recipient_count
    check (total_recipient_count > 0)
);

create table if not exists public.franchise_message_recipients (
  message_id uuid not null references public.franchise_messages(id) on delete restrict,
  franchise_id text not null,
  recipient_auth_user_id uuid not null,
  recipient_profile_id text not null,
  recipient_display_name text not null,
  recipient_email text,
  recipient_role text not null,
  message_created_at timestamptz not null,
  confirmed_at timestamptz,
  primary key (message_id, recipient_auth_user_id)
);

create index if not exists idx_franchise_messages_franchise_created
  on public.franchise_messages (franchise_id, created_at desc);

create index if not exists idx_franchise_messages_author_created
  on public.franchise_messages (author_auth_user_id, created_at desc);

create index if not exists idx_franchise_message_recipients_user_unread
  on public.franchise_message_recipients (
    recipient_auth_user_id,
    confirmed_at,
    message_created_at
  );

create index if not exists idx_franchise_message_recipients_message_status
  on public.franchise_message_recipients (message_id, confirmed_at);

alter table public.franchise_messages enable row level security;
alter table public.franchise_message_recipients enable row level security;

revoke all on table public.franchise_messages from public, anon, authenticated;
revoke all on table public.franchise_message_recipients from public, anon, authenticated;
grant select on table public.franchise_messages to authenticated;
grant select on table public.franchise_message_recipients to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_user_is_franchise_message_recipient(
  target_message_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.franchise_message_recipients recipient
    where recipient.message_id = target_message_id
      and recipient.recipient_auth_user_id = (select auth.uid())
  );
$$;

create or replace function private.current_user_can_review_franchise_message(
  target_message_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.franchise_messages message
    where message.id = target_message_id
      and (
        message.author_auth_user_id = (select auth.uid())
        or exists (
          select 1
          from public.franchise_users profile
          where profile.auth_user_id = (select auth.uid())
            and coalesce(profile.is_active, true) = true
            and profile.franchise_id = message.franchise_id
            and lower(coalesce(profile.role, '')) in ('owner', 'admin')
            and (
              message.audience_type = 'broadcast'
              or message.author_role in ('owner', 'admin')
            )
        )
      )
  );
$$;

revoke all on function private.current_user_is_franchise_message_recipient(uuid) from public, anon;
revoke all on function private.current_user_can_review_franchise_message(uuid) from public, anon;
grant execute on function private.current_user_is_franchise_message_recipient(uuid) to authenticated;
grant execute on function private.current_user_can_review_franchise_message(uuid) to authenticated;

drop policy if exists "message recipients read assigned messages" on public.franchise_messages;
create policy "message recipients read assigned messages"
  on public.franchise_messages
  for select
  to authenticated
  using (
    (select private.current_user_is_franchise_message_recipient(id))
    or (select private.current_user_can_review_franchise_message(id))
  );

drop policy if exists "message participants read recipient status" on public.franchise_message_recipients;
create policy "message participants read recipient status"
  on public.franchise_message_recipients
  for select
  to authenticated
  using (
    recipient_auth_user_id = (select auth.uid())
    or (select private.current_user_can_review_franchise_message(message_id))
  );

create or replace function public.send_franchise_message(
  p_franchise_id text,
  p_subject text,
  p_body_document jsonb,
  p_body_plain_text text,
  p_audience_type text,
  p_recipient_profile_ids text[] default null,
  p_send_as_franchise boolean default false,
  p_acting_as_owner boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.franchise_users%rowtype;
  v_actor_role text;
  v_franchise_name text;
  v_message_id uuid := gen_random_uuid();
  v_message_created_at timestamptz := timezone('utc', now());
  v_recipient_count integer := 0;
  v_requested_count integer := 0;
  v_sender_type text;
  v_sender_display_name text;
  v_effective_role text;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required.';
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
  if v_actor_role not in ('master', 'owner', 'admin') then
    raise exception 'Only owners, admins, and master accounts can send messages.';
  end if;

  if nullif(trim(coalesce(p_franchise_id, '')), '') is null then
    raise exception 'A franchise is required.';
  end if;

  select coalesce(
    nullif(trim(coalesce(franchise.name, '')), ''),
    nullif(trim(coalesce(franchise.franchise_code, '')), ''),
    p_franchise_id
  )
  into v_franchise_name
  from public.franchises franchise
  where franchise.id = p_franchise_id
    and coalesce(franchise.is_active, true) = true
    and franchise.deleted_at is null
  limit 1;

  if not found then
    raise exception 'The selected franchise is not active.';
  end if;

  if char_length(trim(coalesce(p_subject, ''))) not between 1 and 120 then
    raise exception 'The subject must be between 1 and 120 characters.';
  end if;

  if char_length(trim(coalesce(p_body_plain_text, ''))) not between 1 and 5000 then
    raise exception 'The message must be between 1 and 5000 characters.';
  end if;

  if p_body_document is null
    or jsonb_typeof(p_body_document) <> 'object'
    or octet_length(p_body_document::text) > 100000 then
    raise exception 'The formatted message is invalid or too large.';
  end if;

  if p_audience_type not in ('broadcast', 'selected') then
    raise exception 'The message audience is invalid.';
  end if;

  if v_actor_role = 'master' then
    if p_audience_type = 'broadcast' then
      if p_send_as_franchise is not true or p_acting_as_owner is not true then
        raise exception 'Master broadcasts require an active owner session.';
      end if;
      v_effective_role := 'owner';
    else
      if p_send_as_franchise is true then
        raise exception 'Direct master messages must be sent under the master name.';
      end if;
      v_effective_role := 'master';
    end if;
  else
    if v_actor.franchise_id is distinct from p_franchise_id then
      raise exception 'Messages can only be sent within your franchise.';
    end if;
    if p_audience_type = 'broadcast' and p_send_as_franchise is not true then
      raise exception 'Franchise broadcasts must be sent under the franchise name.';
    end if;
    if p_audience_type = 'selected' and p_send_as_franchise is true then
      raise exception 'Selected-recipient messages must show the sender name.';
    end if;
    v_effective_role := v_actor_role;
  end if;

  if p_audience_type = 'broadcast' then
    select count(*)
    into v_recipient_count
    from public.franchise_users recipient
    where recipient.franchise_id = p_franchise_id
      and recipient.auth_user_id is not null
      and coalesce(recipient.is_active, true) = true
      and lower(coalesce(recipient.role, '')) in ('owner', 'admin', 'bookkeeper', 'designer');
  else
    select count(distinct requested.profile_id)
    into v_requested_count
    from unnest(coalesce(p_recipient_profile_ids, array[]::text[])) requested(profile_id)
    where nullif(trim(requested.profile_id), '') is not null;

    if v_requested_count = 0 then
      raise exception 'Select at least one recipient.';
    end if;

    select count(*)
    into v_recipient_count
    from public.franchise_users recipient
    where recipient.franchise_id = p_franchise_id
      and recipient.id::text = any(coalesce(p_recipient_profile_ids, array[]::text[]))
      and recipient.auth_user_id is not null
      and coalesce(recipient.is_active, true) = true
      and lower(coalesce(recipient.role, '')) in ('owner', 'admin', 'bookkeeper', 'designer');

    if v_recipient_count <> v_requested_count then
      raise exception 'One or more selected recipients are unavailable.';
    end if;

    if v_actor_role = 'master' and v_recipient_count <> 1 then
      raise exception 'Master direct messages must be sent to one user at a time.';
    end if;
  end if;

  if v_recipient_count <= 0 then
    raise exception 'No active recipients are available.';
  end if;

  v_sender_type := case when p_send_as_franchise then 'franchise' else 'person' end;
  v_sender_display_name := case
    when p_send_as_franchise then v_franchise_name
    else coalesce(
      nullif(trim(coalesce(v_actor.name, '')), ''),
      nullif(trim(coalesce(v_actor.email, '')), ''),
      'Master'
    )
  end;

  insert into public.franchise_messages (
    id,
    franchise_id,
    subject,
    body_document,
    body_plain_text,
    audience_type,
    sender_type,
    sender_display_name,
    author_auth_user_id,
    author_profile_id,
    author_display_name,
    author_email,
    author_role,
    total_recipient_count,
    created_at
  ) values (
    v_message_id,
    p_franchise_id,
    trim(p_subject),
    p_body_document,
    trim(p_body_plain_text),
    p_audience_type,
    v_sender_type,
    v_sender_display_name,
    v_auth_user_id,
    v_actor.id::text,
    coalesce(
      nullif(trim(coalesce(v_actor.name, '')), ''),
      nullif(trim(coalesce(v_actor.email, '')), ''),
      'Master'
    ),
    nullif(trim(coalesce(v_actor.email, '')), ''),
    v_actor_role,
    v_recipient_count,
    v_message_created_at
  );

  insert into public.franchise_message_recipients (
    message_id,
    franchise_id,
    recipient_auth_user_id,
    recipient_profile_id,
    recipient_display_name,
    recipient_email,
    recipient_role,
    message_created_at
  )
  select
    v_message_id,
    p_franchise_id,
    recipient.auth_user_id,
    recipient.id::text,
    coalesce(
      nullif(trim(coalesce(recipient.name, '')), ''),
      nullif(trim(coalesce(recipient.email, '')), ''),
      'User'
    ),
    nullif(trim(coalesce(recipient.email, '')), ''),
    lower(coalesce(recipient.role, 'designer')),
    v_message_created_at
  from public.franchise_users recipient
  where recipient.franchise_id = p_franchise_id
    and recipient.auth_user_id is not null
    and coalesce(recipient.is_active, true) = true
    and lower(coalesce(recipient.role, '')) in ('owner', 'admin', 'bookkeeper', 'designer')
    and (
      p_audience_type = 'broadcast'
      or recipient.id::text = any(coalesce(p_recipient_profile_ids, array[]::text[]))
    );

  insert into public.ledger_events (
    franchise_id,
    franchise_name,
    actor_auth_user_id,
    actor_profile_id,
    actor_name,
    actor_email,
    actor_role,
    effective_role,
    action,
    target_type,
    target_id,
    details
  ) values (
    p_franchise_id,
    v_franchise_name,
    v_auth_user_id::text,
    v_actor.id::text,
    coalesce(
      nullif(trim(coalesce(v_actor.name, '')), ''),
      nullif(trim(coalesce(v_actor.email, '')), ''),
      'Master'
    ),
    nullif(trim(coalesce(v_actor.email, '')), ''),
    v_actor_role,
    v_effective_role,
    'Franchise message sent',
    'message',
    v_message_id::text,
    jsonb_build_object(
      'subject', trim(p_subject),
      'audienceType', p_audience_type,
      'recipientCount', v_recipient_count,
      'senderType', v_sender_type,
      'senderDisplayName', v_sender_display_name,
      'masterActingAsOwner', v_actor_role = 'master' and p_acting_as_owner
    )
  );

  return v_message_id;
end;
$$;

create or replace function public.confirm_franchise_message(
  p_message_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_confirmed_at timestamptz;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  update public.franchise_message_recipients recipient
  set confirmed_at = coalesce(recipient.confirmed_at, timezone('utc', now()))
  where recipient.message_id = p_message_id
    and recipient.recipient_auth_user_id = v_auth_user_id
  returning recipient.confirmed_at into v_confirmed_at;

  if v_confirmed_at is null then
    raise exception 'This message is not assigned to the current user.';
  end if;

  return v_confirmed_at;
end;
$$;

revoke all on function public.send_franchise_message(text, text, jsonb, text, text, text[], boolean, boolean)
  from public, anon;
revoke all on function public.confirm_franchise_message(uuid) from public, anon;
grant execute on function public.send_franchise_message(text, text, jsonb, text, text, text[], boolean, boolean)
  to authenticated;
grant execute on function public.confirm_franchise_message(uuid) to authenticated;

commit;
