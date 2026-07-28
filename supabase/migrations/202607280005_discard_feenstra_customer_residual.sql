begin;

-- The editable Feenstra version was saved again from the known pre-restore
-- heat/chill state. Restore its May inputs, retain the signed baseline at
-- $96,258, set the editable version's intended retail to $96,544, and advance
-- the proposal-only compatibility guard.
drop trigger if exists protect_feenstra_may_11_contract_baseline
  on public.franchise_proposals;

do $$
declare
  v_franchise_id constant text := 'b4c27ce1-1485-4211-8336-3e2d2ef18a14';
  v_proposal_number constant text := 'PROP-1775269396758';
  v_calculation_profile constant text := 'feenstra-may-11-2026-v2.3.9';
  v_previous_compatibility_revision constant text := 'feenstra-may-11-contract-v2';
  v_compatibility_revision constant text := 'feenstra-may-11-contract-v3';
  v_active_retail constant numeric := 96544;
  v_active_reconciliation_adjustment constant numeric := 730.2375;
  v_record public.franchise_proposals%rowtype;
  v_baseline jsonb;
  v_repaired_copy jsonb;
  v_active_version_id text;
  v_active_version_name text;
  v_active_created_date text;
  v_now text := to_char(
    clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
begin
  select proposal.*
    into v_record
  from public.franchise_proposals proposal
  join public.franchises franchise
    on franchise.id = proposal.franchise_id
  where proposal.proposal_number = v_proposal_number
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

  v_active_version_id := v_record.proposal_json->>'versionId';
  v_active_version_name := coalesce(v_record.proposal_json->>'versionName', 'Version 2');
  v_active_created_date := coalesce(v_record.proposal_json->>'createdDate', v_now);

  if v_active_version_id is null
     or v_active_version_id = 'original'
     or v_record.proposal_json->>'calculationProfile' is distinct from
       v_calculation_profile
     or v_record.proposal_json->>'compatibilityRevision' is distinct from
       v_previous_compatibility_revision
     or v_record.proposal_json #>> '{equipment,heater,name}' is distinct from
       'Hayward HP31205T Heat/Chill'
     or (v_record.proposal_json #>> '{equipment,heaterQuantity}')::numeric <> 1
     or (v_record.proposal_json #>> '{plumbing,runs,gasRun}')::numeric <> 0
     or (v_record.proposal_json #>> '{electrical,runs,heatPumpElectricalRun}')::numeric <> 33
     or (v_record.proposal_json #>> '{manualAdjustments,negative1}')::numeric <> 0 then
    raise exception 'The active Feenstra version no longer matches the identified stale state.';
  end if;

  if jsonb_array_length(coalesce(v_record.proposal_json->'versions', '[]'::jsonb)) <> 1 then
    raise exception 'Expected the protected baseline and one editable Feenstra version.';
  end if;

  select version.value
    into v_baseline
  from jsonb_array_elements(
    coalesce(v_record.proposal_json->'versions', '[]'::jsonb)
  ) version(value)
  where version.value->>'versionId' = 'original'
  limit 1;

  if v_baseline is null
     or coalesce((v_baseline->>'versionLocked')::boolean, false) is not true
     or v_baseline->>'calculationProfile' is distinct from v_calculation_profile
     or v_baseline->>'compatibilityRevision' is distinct from
       v_previous_compatibility_revision
     or v_baseline #>> '{equipment,heater,name}' is distinct from 'No Heater'
     or (v_baseline #>> '{equipment,heaterQuantity}')::numeric <> 0
     or (v_baseline #>> '{pricing,totalCOGS}')::numeric <> 58744.80975475
     or (v_baseline #>> '{pricing,offContractTotal}')::numeric <> 20744.2375
     or (v_baseline #>> '{pricing,retailPrice}')::numeric <> 96258 then
    raise exception 'The protected Feenstra baseline no longer matches the verified May state.';
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
    'Feenstra repeated stale editable state archived',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'archiveSchemaVersion', 1,
      'archivedAt', v_now,
      'proposalJson', v_record.proposal_json
    )
  );

  v_baseline := jsonb_set(
    v_baseline,
    '{compatibilityRevision}',
    to_jsonb(v_compatibility_revision),
    true
  );

  v_repaired_copy := v_baseline;
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{versionId}',
    to_jsonb(v_active_version_id),
    true
  );
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{versionName}',
    to_jsonb(v_active_version_name),
    true
  );
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{versionCreationMode}',
    to_jsonb('copy'::text),
    true
  );
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{versionSourceId}',
    to_jsonb('original'::text),
    true
  );
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{activeVersionId}',
    to_jsonb(v_active_version_id),
    true
  );
  v_repaired_copy := jsonb_set(v_repaired_copy, '{isOriginalVersion}', 'false'::jsonb, true);
  v_repaired_copy := jsonb_set(v_repaired_copy, '{versions}', jsonb_build_array(v_baseline), true);
  v_repaired_copy := jsonb_set(v_repaired_copy, '{versionLocked}', 'false'::jsonb, true);
  v_repaired_copy := jsonb_set(v_repaired_copy, '{versionLockedAt}', 'null'::jsonb, true);
  v_repaired_copy := jsonb_set(v_repaired_copy, '{versionSubmittedAt}', 'null'::jsonb, true);
  v_repaired_copy := jsonb_set(v_repaired_copy, '{versionSubmittedBy}', 'null'::jsonb, true);
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{createdDate}',
    to_jsonb(v_active_created_date),
    true
  );
  v_repaired_copy := jsonb_set(v_repaired_copy, '{lastModified}', to_jsonb(v_now), true);
  v_repaired_copy := jsonb_set(v_repaired_copy, '{status}', to_jsonb('draft'::text), true);
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{workflow}',
    coalesce(v_record.proposal_json->'workflow', '{}'::jsonb),
    true
  );
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{manualAdjustments,negative1}',
    to_jsonb(v_active_reconciliation_adjustment),
    true
  );
  v_repaired_copy := jsonb_set(v_repaired_copy, '{totalCost}', to_jsonb(v_active_retail), true);
  v_repaired_copy := jsonb_set(
    v_repaired_copy,
    '{pricing}',
    jsonb_build_object(
      'totalCostsBeforeOverhead', 58163.177975,
      'overheadMultiplier', 1.01,
      'totalCOGS', 58744.80975475,
      'offContractTotal', 20744.2375,
      'targetMargin', 0.7,
      'baseRetailPrice', 83930,
      'g3UpgradeCost', 0,
      'discountAmount', 0,
      'retailPrice', v_active_retail,
      'digCommissionRate', 0.0275,
      'digCommission', 2084.49346875,
      'adminFeeRate', 0.029,
      'adminFee', 2198.1931125,
      'closeoutCommissionRate', 0.0275,
      'closeoutCommission', 2084.49346875,
      'grossProfit', 10687.77269525,
      'grossProfitMargin', 14.100008156687824,
      'manualAdjustmentsTotal', 12614,
      'retailAdjustmentsTotal', -6000
    ),
    true
  );

  update public.franchise_proposals proposal
  set proposal_json = v_repaired_copy,
      last_modified = v_now::timestamptz,
      status = 'draft',
      updated_at = clock_timestamp()
  where proposal.id = v_record.id;

  if not found then
    raise exception 'The Feenstra residual correction did not affect a row.';
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
    'Feenstra editable version restored with discarded customer residual',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'calculationProfile', v_calculation_profile,
      'compatibilityRevision', v_compatibility_revision,
      'activeVersionId', v_active_version_id,
      'pricingCOGS', 58744.80975475,
      'internalOffContractTotal', 20744.2375,
      'customerEquipmentOrdered', 6776.97,
      'customerStartupOrientation', 2018.57,
      'customerResidualDiscarded', 286,
      'activeRetailPrice', v_active_retail,
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
  v_compatibility_revision constant text := 'feenstra-may-11-contract-v3';
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

  -- Block the exact stale July state that has twice been reintroduced by an
  -- already-open client. This does not prevent ordinary May-math edits.
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
      and coalesce(
        (version.value #>> '{manualAdjustments,negative1}')::numeric,
        0
      ) = 0
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
  where proposal_number = 'PROP-1775269396758'
    and franchise_id = 'b4c27ce1-1485-4211-8336-3e2d2ef18a14';

  select version.value
    into v_baseline
  from jsonb_array_elements(coalesce(v_current->'versions', '[]'::jsonb)) version(value)
  where version.value->>'versionId' = 'original'
  limit 1;

  if v_current->>'versionId' = 'original'
     or v_current->>'compatibilityRevision' is distinct from
       'feenstra-may-11-contract-v3'
     or v_current #>> '{equipment,heater,name}' is distinct from 'No Heater'
     or (v_current #>> '{equipment,heaterQuantity}')::numeric <> 0
     or (v_current #>> '{plumbing,runs,gasRun}')::numeric <> 25
     or (v_current #>> '{electrical,runs,heatPumpElectricalRun}')::numeric <> 0
     or (v_current #>> '{pricing,totalCOGS}')::numeric <> 58744.80975475
     or (v_current #>> '{pricing,offContractTotal}')::numeric <> 20744.2375
     or (v_current #>> '{pricing,retailPrice}')::numeric <> 96544
     or (v_current #>> '{manualAdjustments,negative1}')::numeric <> 730.2375
     or v_baseline is null
     or v_baseline->>'compatibilityRevision' is distinct from
       'feenstra-may-11-contract-v3'
     or (v_baseline #>> '{pricing,retailPrice}')::numeric <> 96258 then
    raise exception 'The Feenstra discarded-residual post-migration verification failed.';
  end if;
end;
$$;

commit;
