begin;

-- Reconstruct the one Feenstra contract baseline represented by the May 11 COGS
-- report. The full pre-migration proposal is retained in the master-only ledger
-- before the visible version history is collapsed.
do $$
declare
  v_franchise_id constant text := 'b4c27ce1-1485-4211-8336-3e2d2ef18a14';
  v_proposal_number constant text := 'PROP-1775269396758';
  v_pricing_model_id constant text := '0abaae9d-3b7a-497c-a228-829ade7e6d4f';
  v_pricing_revision_id constant text := '8e59f0ee-0ef9-4259-a262-bba10d298808';
  v_previous_profile constant text := 'feenstra-may-2026-v2.3.8';
  v_calculation_profile constant text := 'feenstra-may-11-2026-v2.3.9';
  v_signed_retail_price constant numeric := 96258;
  v_may_11_subtotal constant numeric := 56763.177975;
  v_reconciliation_adjustment constant numeric := 1616.2375;
  v_record public.franchise_proposals%rowtype;
  v_original jsonb;
  v_version_two jsonb;
  v_baseline jsonb;
  v_features jsonb;
  v_custom_total numeric;
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

  if v_record.proposal_json->>'calculationProfile' is distinct from v_previous_profile then
    raise exception
      'Expected the prior Feenstra profile %, found %.',
      v_previous_profile,
      v_record.proposal_json->>'calculationProfile';
  end if;

  if v_record.proposal_json->>'pricingModelId' is distinct from v_pricing_model_id
     or v_record.proposal_json->>'pricingModelRevisionId' is distinct from v_pricing_revision_id
     or v_record.proposal_json->>'pricingTierId' is distinct from 'normal' then
    raise exception 'The Feenstra pricing pin changed before the May 11 rebuild.';
  end if;

  if jsonb_array_length(coalesce(v_record.proposal_json->'versions', '[]'::jsonb)) <> 2 then
    raise exception 'Expected two stored Feenstra versions before the rebuild.';
  end if;

  select version.value
    into v_original
  from jsonb_array_elements(v_record.proposal_json->'versions') version(value)
  where version.value->>'versionId' = 'original';

  select version.value
    into v_version_two
  from jsonb_array_elements(v_record.proposal_json->'versions') version(value)
  where version.value->>'versionId' = 'version-7efhqtl';

  if v_original is null or v_version_two is null then
    raise exception 'The expected Original and Version 2 Feenstra snapshots were not found.';
  end if;

  if (v_original #>> '{poolSpecs,surfaceArea}')::numeric <> 434
     or (v_original #>> '{poolSpecs,perimeter}')::numeric <> 88
     or (v_original #>> '{poolSpecs,totalStepsAndBench}')::numeric <> 44
     or coalesce((v_original #>> '{poolSpecs,hasTanningShelf}')::boolean, false) is not true
     or (v_version_two #>> '{plumbing,runs,gasRun}')::numeric <> 25 then
    raise exception 'Feenstra source inputs no longer match the verified May 11 reconstruction.';
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
    'Feenstra versions archived before May 11 contract rebuild',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'archiveSchemaVersion', 1,
      'archivedAt', v_now,
      'visibleVersionCount', 3,
      'proposalJson', v_record.proposal_json
    )
  );

  -- Original retains the May 11 construction geometry. Version 2 retains the
  -- customer-contracted gas, electrical, equipment, and customer-breakdown note
  -- selections. Preserve all unique off-contract inputs from both snapshots.
  select coalesce(jsonb_agg(combined.feature order by combined.source_rank, combined.ordinality), '[]'::jsonb)
    into v_features
  from (
    select feature.value as feature, 0 as source_rank, feature.ordinality
    from jsonb_array_elements(
      coalesce(v_original #> '{customFeatures,features}', '[]'::jsonb)
    ) with ordinality feature(value, ordinality)

    union all

    select feature.value as feature, 1 as source_rank, feature.ordinality
    from jsonb_array_elements(
      coalesce(v_version_two #> '{customFeatures,features}', '[]'::jsonb)
    ) with ordinality feature(value, ordinality)
    where not exists (
      select 1
      from jsonb_array_elements(
        coalesce(v_original #> '{customFeatures,features}', '[]'::jsonb)
      ) original_feature(value)
      where lower(trim(coalesce(original_feature.value->>'name', ''))) =
        lower(trim(coalesce(feature.value->>'name', '')))
    )
  ) combined;

  select coalesce(sum(coalesce((feature.value->>'totalCost')::numeric, 0)), 0)
    into v_custom_total
  from jsonb_array_elements(v_features) feature(value);

  v_baseline := v_original;
  v_baseline := jsonb_set(v_baseline, '{versionId}', to_jsonb('original'::text), true);
  v_baseline := jsonb_set(
    v_baseline,
    '{versionName}',
    to_jsonb('May 11 Contract Baseline'::text),
    true
  );
  v_baseline := jsonb_set(v_baseline, '{activeVersionId}', to_jsonb('original'::text), true);
  v_baseline := jsonb_set(v_baseline, '{isOriginalVersion}', 'true'::jsonb, true);
  v_baseline := jsonb_set(v_baseline, '{versions}', '[]'::jsonb, true);
  v_baseline := jsonb_set(
    v_baseline,
    '{calculationProfile}',
    to_jsonb(v_calculation_profile),
    true
  );
  v_baseline := jsonb_set(v_baseline, '{pricingModelId}', to_jsonb(v_pricing_model_id), true);
  v_baseline := jsonb_set(
    v_baseline,
    '{pricingModelRevisionId}',
    to_jsonb(v_pricing_revision_id),
    true
  );
  v_baseline := jsonb_set(v_baseline, '{pricingTierId}', to_jsonb('normal'::text), true);
  v_baseline := jsonb_set(v_baseline, '{pricingTierName}', to_jsonb('Normal'::text), true);
  v_baseline := jsonb_set(v_baseline, '{electrical}', v_version_two->'electrical', true);
  v_baseline := jsonb_set(v_baseline, '{equipment}', v_version_two->'equipment', true);
  v_baseline := jsonb_set(
    v_baseline,
    '{plumbing,runs,gasRun}',
    v_version_two #> '{plumbing,runs,gasRun}',
    true
  );
  v_baseline := jsonb_set(
    v_baseline,
    '{retailAdjustments}',
    v_version_two->'retailAdjustments',
    true
  );
  v_baseline := jsonb_set(v_baseline, '{customFeatures,features}', v_features, true);
  v_baseline := jsonb_set(
    v_baseline,
    '{customFeatures,totalCost}',
    to_jsonb(v_custom_total),
    true
  );
  v_baseline := jsonb_set(
    v_baseline,
    '{manualAdjustments,negative1}',
    to_jsonb(v_reconciliation_adjustment),
    true
  );

  -- Preserve proposal-level workflow and contract state from the live container.
  if v_record.proposal_json ? 'workflow' then
    v_baseline := jsonb_set(v_baseline, '{workflow}', v_record.proposal_json->'workflow', true);
  end if;
  if v_record.proposal_json ? 'contractOverrides' then
    v_baseline := jsonb_set(
      v_baseline,
      '{contractOverrides}',
      v_record.proposal_json->'contractOverrides',
      true
    );
  end if;

  v_baseline := jsonb_set(
    v_baseline,
    '{status}',
    to_jsonb(coalesce(v_record.proposal_json->>'status', v_record.status, 'draft')),
    true
  );
  v_baseline := jsonb_set(v_baseline, '{lastModified}', to_jsonb(v_now), true);
  v_baseline := jsonb_set(v_baseline, '{syncStatus}', to_jsonb('synced'::text), true);
  v_baseline := jsonb_set(v_baseline, '{syncMessage}', 'null'::jsonb, true);
  v_baseline := v_baseline - 'costBreakdown';
  v_baseline := jsonb_set(v_baseline, '{subtotal}', to_jsonb(v_may_11_subtotal), true);
  v_baseline := jsonb_set(v_baseline, '{taxRate}', '0'::jsonb, true);
  v_baseline := jsonb_set(v_baseline, '{taxAmount}', '0'::jsonb, true);
  v_baseline := jsonb_set(v_baseline, '{totalCost}', to_jsonb(v_signed_retail_price), true);
  v_baseline := jsonb_set(
    v_baseline,
    '{pricing}',
    jsonb_build_object(
      'totalCostsBeforeOverhead', 58163.177975,
      'overheadMultiplier', 1.01,
      'totalCOGS', 58744.80975475,
      'offContractTotal', 21344.2375,
      'targetMargin', 0.7,
      'baseRetailPrice', 83930,
      'g3UpgradeCost', 0,
      'discountAmount', 0,
      'retailPrice', v_signed_retail_price,
      'digCommissionRate', 0.0275,
      'digCommission', 2060.12846875,
      'adminFeeRate', 0.029,
      'adminFee', 2172.4991125,
      'closeoutCommissionRate', 0.0275,
      'closeoutCommission', 2060.12846875,
      'grossProfit', 9876.19669525,
      'grossProfitMargin', 13.183420997243317,
      'manualAdjustmentsTotal', 12328,
      'retailAdjustmentsTotal', -6000
    ),
    true
  );

  update public.franchise_proposals proposal
  set proposal_json = v_baseline,
      created_date = coalesce(
        nullif(v_baseline->>'createdDate', '')::timestamptz,
        proposal.created_date
      ),
      last_modified = v_now::timestamptz,
      pricing_model_id = v_pricing_model_id::uuid,
      pricing_model_name = coalesce(v_baseline->>'pricingModelName', proposal.pricing_model_name),
      status = coalesce(v_baseline->>'status', proposal.status),
      updated_at = clock_timestamp()
  where proposal.id = v_record.id;

  if not found then
    raise exception 'The Feenstra May 11 baseline update did not affect a row.';
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
    'Feenstra May 11 contract baseline restored',
    'proposal',
    v_proposal_number,
    jsonb_build_object(
      'calculationProfile', v_calculation_profile,
      'pricingModelId', v_pricing_model_id,
      'pricingModelRevisionId', v_pricing_revision_id,
      'visibleVersionCount', 1,
      'cogsSubtotal', v_may_11_subtotal,
      'signedRetailPrice', v_signed_retail_price,
      'futureVersionMode', 'copy-only',
      'scope', 'Feenstra proposal only'
    )
  );
end;
$$;

commit;
