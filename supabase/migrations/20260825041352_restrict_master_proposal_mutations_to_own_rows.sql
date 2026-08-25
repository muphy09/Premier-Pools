-- Masters may inspect submitted franchise proposals, but may mutate only rows
-- they created themselves. This preserves creator-owned master proposals in
-- the master/default area while keeping Act as Owner inspection read-only at
-- the database boundary as well as in the client.

begin;

drop policy if exists "proposal_role_update" on public.franchise_proposals;
create policy "proposal_role_update"
  on public.franchise_proposals for update to authenticated
  using (
    public.current_user_owns_proposal(
      franchise_id,
      designer_auth_user_id,
      designer_name,
      proposal_json
    )
    or (
      not public.current_user_is_master()
      and public.current_user_can_review_franchise(franchise_id)
      and lower(coalesce(status, proposal_json ->> 'status', 'draft')) <> 'draft'
    )
  )
  with check (
    public.current_user_owns_proposal(
      franchise_id,
      designer_auth_user_id,
      designer_name,
      proposal_json
    )
    or (
      not public.current_user_is_master()
      and public.current_user_can_review_franchise(franchise_id)
      and lower(coalesce(status, proposal_json ->> 'status', 'draft')) <> 'draft'
    )
  );

drop policy if exists "proposal_role_delete" on public.franchise_proposals;
create policy "proposal_role_delete"
  on public.franchise_proposals for delete to authenticated
  using (
    public.current_user_owns_proposal(
      franchise_id,
      designer_auth_user_id,
      designer_name,
      proposal_json
    )
    or (
      not public.current_user_is_master()
      and public.current_user_can_manage_franchise(franchise_id)
      and lower(coalesce(status, proposal_json ->> 'status', 'draft')) <> 'draft'
    )
  );

commit;
