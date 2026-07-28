begin;

-- One-off compatibility pin for the Feenstra proposal using May 1, 2026 math.
-- The desktop application also hard-guards this profile with the exact proposal,
-- franchise, pricing model, and immutable pricing revision IDs below.
do $$
declare
  v_franchise_id constant text := 'b4c27ce1-1485-4211-8336-3e2d2ef18a14';
  v_proposal_number constant text := 'PROP-1775269396758';
  v_pricing_model_id constant text := '0abaae9d-3b7a-497c-a228-829ade7e6d4f';
  v_pricing_revision_id constant text := '8e59f0ee-0ef9-4259-a262-bba10d298808';
  v_calculation_profile constant text := 'feenstra-may-2026-v2.3.8';
  v_match_count integer;
  v_updated_count integer;
begin
  select count(*)
    into v_match_count
  from public.franchise_proposals proposal
  join public.franchises franchise
    on franchise.id = proposal.franchise_id
  where proposal.proposal_number = v_proposal_number
    and proposal.franchise_id = v_franchise_id
    and franchise.franchise_code = '5555'
    and lower(coalesce(proposal.designer_name, proposal.proposal_json->>'designerName', '')) =
      'dedra erwin'
    and lower(coalesce(proposal.proposal_json #>> '{customerInfo,customerName}', '')) like
      '%feenstra%'
    and proposal.proposal_json->>'pricingModelId' = v_pricing_model_id
    and proposal.proposal_json->>'pricingModelRevisionId' = v_pricing_revision_id
    and proposal.proposal_json->>'pricingTierId' = 'normal'
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(proposal.proposal_json->'versions', '[]'::jsonb)
      ) as version(value)
      where version.value->>'pricingModelId' is distinct from v_pricing_model_id
        or version.value->>'pricingModelRevisionId' is distinct from v_pricing_revision_id
        or version.value->>'pricingTierId' is distinct from 'normal'
    );

  if v_match_count <> 1 then
    raise exception
      'Expected exactly one Feenstra proposal with the May 1 pricing pin; found %.',
      v_match_count;
  end if;

  update public.franchise_proposals proposal
  set proposal_json = jsonb_set(
    jsonb_set(
      proposal.proposal_json,
      '{calculationProfile}',
      to_jsonb(v_calculation_profile),
      true
    ),
    '{versions}',
    (
      select coalesce(
        jsonb_agg(
          jsonb_set(
            version.value,
            '{calculationProfile}',
            to_jsonb(v_calculation_profile),
            true
          )
          order by version.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(
        coalesce(proposal.proposal_json->'versions', '[]'::jsonb)
      ) with ordinality as version(value, ordinality)
    ),
    true
  )
  where proposal.proposal_number = v_proposal_number
    and proposal.franchise_id = v_franchise_id
    and proposal.proposal_json->>'pricingModelId' = v_pricing_model_id
    and proposal.proposal_json->>'pricingModelRevisionId' = v_pricing_revision_id
    and proposal.proposal_json->>'pricingTierId' = 'normal'
    and lower(coalesce(proposal.designer_name, proposal.proposal_json->>'designerName', '')) =
      'dedra erwin'
    and lower(coalesce(proposal.proposal_json #>> '{customerInfo,customerName}', '')) like
      '%feenstra%'
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(proposal.proposal_json->'versions', '[]'::jsonb)
      ) as version(value)
      where version.value->>'pricingModelId' is distinct from v_pricing_model_id
        or version.value->>'pricingModelRevisionId' is distinct from v_pricing_revision_id
        or version.value->>'pricingTierId' is distinct from 'normal'
    );

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception
      'Feenstra legacy calculation profile updated % rows instead of exactly one.',
      v_updated_count;
  end if;

  insert into public.ledger_events (
    franchise_id,
    franchise_name,
    actor_name,
    actor_role,
    effective_role,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_franchise_id,
    'PPAS West',
    'system-migration',
    'system',
    'system',
    'Legacy May 1 calculation profile pinned',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'calculationProfile', v_calculation_profile,
      'pricingModelId', v_pricing_model_id,
      'pricingModelRevisionId', v_pricing_revision_id,
      'scope', 'Feenstra proposal and its stored versions only'
    )
  );
end;
$$;

commit;
