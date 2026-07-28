begin;

-- Version 3 was created as an exact copy of the corrected Feenstra Version 2,
-- but a pricing-load race replaced its proposal reconciliation and calculated
-- it against the currently loaded franchise prices. Restore the copy and move
-- the proposal-only guard forward before the fixed client is released.
drop trigger if exists protect_feenstra_may_11_contract_baseline
  on public.franchise_proposals;

do $$
declare
  v_franchise_id constant text := 'b4c27ce1-1485-4211-8336-3e2d2ef18a14';
  v_proposal_number constant text := 'PROP-1775269396758';
  v_profile constant text := 'feenstra-may-11-2026-v2.3.9';
  v_previous_revision constant text := 'feenstra-may-11-contract-v3';
  v_revision constant text := 'feenstra-may-11-contract-v4';
  v_record public.franchise_proposals%rowtype;
  v_active jsonb;
  v_source jsonb;
  v_versions jsonb;
  v_key text;
  v_now text := to_char(
    clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_input_keys constant text[] := array[
    'poolSpecs',
    'excavation',
    'plumbing',
    'electrical',
    'tileCopingDecking',
    'drainage',
    'equipment',
    'waterFeatures',
    'customFeatures',
    'masonry',
    'interiorFinish',
    'pricingModelId',
    'pricingModelFranchiseId',
    'pricingModelRevisionId',
    'pricingTierId',
    'calculationProfile',
    'papDiscounts',
    'retailAdjustments'
  ];
begin
  select proposal.*
    into v_record
  from public.franchise_proposals proposal
  join public.franchises franchise
    on franchise.id = proposal.franchise_id
  where proposal.id = '9ad3b0af-74d5-4fa3-b052-dcb21feb3fe5'
    and proposal.proposal_number = v_proposal_number
    and proposal.franchise_id = v_franchise_id
    and franchise.franchise_code = '5555'
    and lower(coalesce(proposal.designer_name, proposal.proposal_json->>'designerName', '')) =
      'dedra erwin'
    and lower(coalesce(proposal.proposal_json #>> '{customerInfo,customerName}', '')) =
      'nicole feenstra'
  for update of proposal;

  if not found then
    raise exception 'The Feenstra production proposal was not found.';
  end if;

  v_active := v_record.proposal_json;
  if v_active->>'versionId' <> 'version-4a8ph82'
     or v_active->>'versionName' <> 'Version 3'
     or v_active->>'versionSourceId' <> 'version-f51n0dm'
     or v_active->>'calculationProfile' <> v_profile
     or v_active->>'compatibilityRevision' <> v_previous_revision
     or (v_active #>> '{manualAdjustments,negative1}')::numeric <> 0
     or (v_active #>> '{pricing,retailPrice}')::numeric <> 98261.7875
     or (v_active #>> '{pricing,offContractTotal}')::numeric <> 21511.7875 then
    raise exception 'The active Feenstra version no longer matches the identified pricing-load race.';
  end if;

  select version.value
    into v_source
  from jsonb_array_elements(coalesce(v_active->'versions', '[]'::jsonb)) version(value)
  where version.value->>'versionId' = 'version-f51n0dm'
  limit 1;

  if v_source is null
     or v_source->>'calculationProfile' <> v_profile
     or v_source->>'compatibilityRevision' <> v_previous_revision
     or (v_source #>> '{manualAdjustments,negative1}')::numeric <> 730.2375
     or (v_source #>> '{pricing,totalCOGS}')::numeric <> 58744.80975475
     or (v_source #>> '{pricing,offContractTotal}')::numeric <> 20744.2375
     or (v_source #>> '{pricing,retailPrice}')::numeric <> 96544 then
    raise exception 'The corrected Feenstra Version 2 source was not found.';
  end if;

  foreach v_key in array v_input_keys
  loop
    if (v_active->v_key) is distinct from (v_source->v_key) then
      raise exception
        'Version 3 contains an unexpected input change in %, so it was not repaired.',
        v_key;
    end if;
  end loop;

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
    'Feenstra pricing-load race archived before contract cash correction',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'archiveSchemaVersion', 1,
      'archivedAt', v_now,
      'proposalJson', v_record.proposal_json
    )
  );

  select jsonb_agg(
    jsonb_set(
      version.value,
      '{compatibilityRevision}',
      to_jsonb(v_revision),
      true
    )
    order by version.ordinality
  )
    into v_versions
  from jsonb_array_elements(
    coalesce(v_active->'versions', '[]'::jsonb)
  ) with ordinality version(value, ordinality);

  select version.value
    into v_source
  from jsonb_array_elements(v_versions) version(value)
  where version.value->>'versionId' = 'version-f51n0dm'
  limit 1;

  v_active := jsonb_set(v_active, '{compatibilityRevision}', to_jsonb(v_revision), true);
  v_active := jsonb_set(
    v_active,
    '{manualAdjustments}',
    v_source->'manualAdjustments',
    true
  );
  v_active := jsonb_set(v_active, '{pricing}', v_source->'pricing', true);
  v_active := jsonb_set(v_active, '{costBreakdown}', v_source->'costBreakdown', true);
  v_active := jsonb_set(v_active, '{subtotal}', v_source->'subtotal', true);
  v_active := jsonb_set(v_active, '{taxRate}', v_source->'taxRate', true);
  v_active := jsonb_set(v_active, '{taxAmount}', v_source->'taxAmount', true);
  v_active := jsonb_set(v_active, '{totalCost}', v_source->'totalCost', true);
  v_active := jsonb_set(
    v_active,
    '{contractOverrides}',
    coalesce(v_source->'contractOverrides', '{}'::jsonb),
    true
  );
  v_active := jsonb_set(v_active, '{versions}', v_versions, true);
  v_active := jsonb_set(v_active, '{lastModified}', to_jsonb(v_now), true);

  update public.franchise_proposals proposal
  set proposal_json = v_active,
      last_modified = v_now::timestamptz,
      updated_at = clock_timestamp()
  where proposal.id = v_record.id;

  if not found then
    raise exception 'The Feenstra Version 3 repair did not affect a row.';
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
    'Feenstra May contract cash price restored',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'calculationProfile', v_profile,
      'compatibilityRevision', v_revision,
      'activeVersionId', v_active->>'versionId',
      'proposalRetailPrice', 96544,
      'internalOffContractTotal', 20744.2375,
      'contractCashPrice', 75800,
      'contractDeposit', 7580,
      'paymentSchedule30Percent', 20466,
      'paymentSchedule10Percent', 6822,
      'scope', 'Feenstra proposal only'
    )
  );
end;
$$;

create or replace function public.protect_feenstra_may_11_contract_baseline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile constant text := 'feenstra-may-11-2026-v2.3.9';
  v_compatibility_revision constant text := 'feenstra-may-11-contract-v4';
  v_old_baseline jsonb;
  v_new_baseline jsonb;
  v_old_versions jsonb;
  v_new_versions jsonb;
  v_new_version jsonb;
  v_source_version jsonb;
  v_source_id text;
  v_key text;
  v_ignored_keys constant text[] := array[
    'activeVersionId',
    'costBreakdown',
    'lastModified',
    'pricing',
    'status',
    'subtotal',
    'syncMessage',
    'syncStatus',
    'taxAmount',
    'taxRate',
    'totalCost',
    'versionLockedAt',
    'versionSubmittedAt',
    'versionSubmittedBy',
    'versions',
    'workflow'
  ];
  v_copy_keys constant text[] := array[
    'poolSpecs',
    'excavation',
    'plumbing',
    'electrical',
    'tileCopingDecking',
    'drainage',
    'equipment',
    'waterFeatures',
    'customFeatures',
    'masonry',
    'interiorFinish',
    'pricingModelId',
    'pricingModelFranchiseId',
    'pricingModelRevisionId',
    'pricingTierId',
    'calculationProfile',
    'compatibilityRevision',
    'papDiscounts',
    'manualAdjustments',
    'retailAdjustments'
  ];
begin
  if old.proposal_number <> 'PROP-1775269396758'
     or old.franchise_id <> 'b4c27ce1-1485-4211-8336-3e2d2ef18a14' then
    return new;
  end if;

  v_old_versions := jsonb_build_array(old.proposal_json) ||
    coalesce(old.proposal_json->'versions', '[]'::jsonb);
  v_new_versions := jsonb_build_array(new.proposal_json) ||
    coalesce(new.proposal_json->'versions', '[]'::jsonb);

  select version.value
    into v_old_baseline
  from jsonb_array_elements(v_old_versions) version(value)
  where version.value->>'versionId' = 'original'
  limit 1;

  if v_old_baseline is null
     or v_old_baseline->>'calculationProfile' is distinct from v_profile then
    return new;
  end if;

  select version.value
    into v_new_baseline
  from jsonb_array_elements(v_new_versions) version(value)
  where version.value->>'versionId' = 'original'
  limit 1;

  if v_new_baseline is null then
    raise exception 'The May 11 Feenstra contract baseline cannot be removed.';
  end if;
  if coalesce((v_new_baseline->>'versionLocked')::boolean, false) is not true then
    raise exception 'The May 11 Feenstra contract baseline must remain locked.';
  end if;
  if (v_new_baseline - v_ignored_keys) is distinct from
     (v_old_baseline - v_ignored_keys) then
    raise exception
      'The May 11 Feenstra contract baseline is immutable. Create and edit a copied version instead.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_new_versions) version(value)
    where version.value->>'versionId' <> 'original'
      and version.value->>'compatibilityRevision' is distinct from
        v_compatibility_revision
  ) then
    raise exception
      'Update and restart Submerge before editing this Feenstra contract version.';
  end if;

  -- The first negative adjustment is reserved for the May contract
  -- reconciliation. Copies inherit it from their source, and existing copies
  -- cannot silently replace it with pricing-model defaults.
  if exists (
    select 1
    from jsonb_array_elements(v_new_versions) candidate(value)
    join jsonb_array_elements(v_old_versions) prior(value)
      on prior.value->>'versionId' = candidate.value->>'versionId'
    where candidate.value->>'versionId' <> 'original'
      and (candidate.value #> '{manualAdjustments,negative1}') is distinct from
        (prior.value #> '{manualAdjustments,negative1}')
  ) then
    raise exception
      'The Feenstra May contract reconciliation is protected. Reload the version and try again.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_new_versions) version(value)
    where version.value->>'versionId' <> 'original'
      and version.value #>> '{equipment,heater,name}' =
        'Hayward HP31205T Heat/Chill'
      and coalesce((version.value #>> '{equipment,heaterQuantity}')::numeric, 0) = 1
      and coalesce((version.value #>> '{plumbing,runs,gasRun}')::numeric, 0) = 0
      and coalesce(
        (version.value #>> '{electrical,runs,heatPumpElectricalRun}')::numeric,
        0
      ) = 33
      and not exists (
        select 1
        from jsonb_array_elements(
          coalesce(version.value #> '{customFeatures,features}', '[]'::jsonb)
        ) feature(value)
        where lower(trim(coalesce(feature.value->>'name', ''))) = 'hayward heater'
          and coalesce((feature.value->>'isOffContract')::boolean, false) is true
      )
  ) then
    raise exception
      'The stale heat/chill Feenstra state was rejected. Reload the corrected version before editing.';
  end if;

  for v_new_version in
    select candidate.value
    from jsonb_array_elements(v_new_versions) candidate(value)
    where candidate.value->>'versionId' <> 'original'
      and not exists (
        select 1
        from jsonb_array_elements(v_old_versions) prior(value)
        where prior.value->>'versionId' = candidate.value->>'versionId'
      )
  loop
    if v_new_version->>'versionCreationMode' is distinct from 'copy' then
      raise exception 'New Feenstra contract versions must be created as copies.';
    end if;

    v_source_id := v_new_version->>'versionSourceId';
    if coalesce(v_source_id, '') = '' then
      raise exception
        'Update and restart Submerge before creating another Feenstra contract version.';
    end if;

    select current_source.value
      into v_source_version
    from jsonb_array_elements(v_new_versions) current_source(value)
    where current_source.value->>'versionId' = v_source_id
      and exists (
        select 1
        from jsonb_array_elements(v_old_versions) prior(value)
        where prior.value->>'versionId' = v_source_id
      )
    limit 1;

    if v_source_version is null then
      raise exception 'The selected Feenstra source version no longer exists.';
    end if;

    foreach v_key in array v_copy_keys
    loop
      if (v_new_version->v_key) is distinct from (v_source_version->v_key) then
        raise exception
          'The new Feenstra version did not match its selected May-math source (%).',
          v_key;
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists protect_feenstra_may_11_contract_baseline
  on public.franchise_proposals;
create trigger protect_feenstra_may_11_contract_baseline
before update of proposal_json on public.franchise_proposals
for each row
execute function public.protect_feenstra_may_11_contract_baseline();

do $$
declare
  v_current jsonb;
  v_baseline jsonb;
begin
  select proposal_json
    into v_current
  from public.franchise_proposals
  where id = '9ad3b0af-74d5-4fa3-b052-dcb21feb3fe5';

  select version.value
    into v_baseline
  from jsonb_array_elements(coalesce(v_current->'versions', '[]'::jsonb)) version(value)
  where version.value->>'versionId' = 'original'
  limit 1;

  if v_current->>'versionId' <> 'version-4a8ph82'
     or v_current->>'compatibilityRevision' <> 'feenstra-may-11-contract-v4'
     or (v_current #>> '{manualAdjustments,negative1}')::numeric <> 730.2375
     or (v_current #>> '{pricing,totalCOGS}')::numeric <> 58744.80975475
     or (v_current #>> '{pricing,offContractTotal}')::numeric <> 20744.2375
     or (v_current #>> '{pricing,retailPrice}')::numeric <> 96544
     or round(
       (v_current #>> '{pricing,retailPrice}')::numeric -
       (v_current #>> '{pricing,offContractTotal}')::numeric +
       (v_current #>> '{manualAdjustments,negative1}')::numeric -
       730.2375
     ) <> 75800
     or v_baseline is null
     or v_baseline->>'compatibilityRevision' <> 'feenstra-may-11-contract-v4'
     or exists (
       select 1
       from jsonb_array_elements(coalesce(v_current->'versions', '[]'::jsonb)) version(value)
       where version.value->>'compatibilityRevision' <>
         'feenstra-may-11-contract-v4'
     ) then
    raise exception 'The Feenstra contract cash-price post-migration verification failed.';
  end if;
end;
$$;

commit;
