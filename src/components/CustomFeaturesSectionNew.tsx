import { useEffect, useMemo, useState } from 'react';
import {
  CustomFeature,
  CustomFeatures,
  GroupedCustomFeatureOption,
  GroupedCustomFeatureSubcategoryConfig,
} from '../types/proposal-new';
import {
  getCustomFeatureTotal,
  getGroupedCustomFeatureAdditionalOptionCategory,
  getGroupedCustomFeatureAdditionalOptionName,
  getGroupedCustomFeatureAddonLabel,
  getGroupedCustomFeatureAddonOptionId,
  getGroupedCustomFeatureAddonQuantity,
  getGroupedCustomFeatureAddonUnitPrice,
  getGroupedCustomFeaturePricePerSqft,
  getGroupedCustomFeaturePricingMode,
  getGroupedCustomFeatureSqft,
  getGroupedCustomFeatureSubcategory,
  isGroupedCustomFeature,
  normalizeCustomFeature,
  normalizeCustomFeatures,
  normalizeGroupedCustomFeatureOptions,
  normalizeGroupedCustomFeatureSubcategories,
} from '../utils/customFeatures';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import {
  CustomOffContractToggle,
} from './CustomOffContractControls';
import { CustomOptionsIcon } from './CustomOptionsSection';
import ProposalNote from './ProposalNote';
import './SectionStyles.css';

interface Props {
  data: CustomFeatures;
  onChange: (data: CustomFeatures) => void;
  retailPrice?: number;
  additionalOptions?: GroupedCustomFeatureSubcategoryConfig[];
  groupedOptions?: GroupedCustomFeatureOption[];
  noteOverrides?: ProposalNoteOverrides;
}

type GroupedFeatureCard = GroupedCustomFeatureOption & {
  isRetired?: boolean;
};

type GroupedFeatureSection = {
  key: string;
  title: string;
  isFallback: boolean;
  options: GroupedFeatureCard[];
};

const getGroupedFeatureKey = (feature: Partial<CustomFeature>, fallbackIndex: number): string =>
  String(feature.groupedOptionId || '').trim() || `legacy-grouped-${fallbackIndex + 1}`;

function CustomFeaturesSectionNew({
  data,
  onChange,
  retailPrice,
  additionalOptions = [],
  groupedOptions = [],
  noteOverrides,
}: Props) {
  const [activeFeatureIndex, setActiveFeatureIndex] = useState<number | null>(null);
  const maxManualFeatures = 7;

  const toNumber = (value: any) => Number(value) || 0;
  const formatNumber = (value?: number) =>
    toNumber(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const formatCurrency = (value?: number) =>
    `$${toNumber(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const normalizedData = useMemo(() => normalizeCustomFeatures(data), [data]);
  const groupedFeatures = useMemo(
    () => normalizedData.features.filter((feature) => isGroupedCustomFeature(feature)),
    [normalizedData.features]
  );
  const manualFeatures = useMemo(
    () => normalizedData.features.filter((feature) => !isGroupedCustomFeature(feature)),
    [normalizedData.features]
  );
  const normalizedGroupedOptions = useMemo(
    () => normalizeGroupedCustomFeatureOptions(groupedOptions),
    [groupedOptions]
  );
  const normalizedAdditionalOptions = useMemo(
    () => normalizeGroupedCustomFeatureSubcategories(additionalOptions),
    [additionalOptions]
  );
  const additionalOptionLookup = useMemo(
    () =>
      normalizedAdditionalOptions.reduce((map, option) => {
        const groupName = getGroupedCustomFeatureAdditionalOptionCategory(option);
        if (!groupName) return map;
        const current = map.get(groupName) || [];
        current.push(option);
        map.set(groupName, current);
        return map;
      }, new Map<string, GroupedCustomFeatureSubcategoryConfig[]>()),
    [normalizedAdditionalOptions]
  );

  const groupedSelectionMap = useMemo(
    () =>
      new Map(
        groupedFeatures.map((feature, index) => [getGroupedFeatureKey(feature, index), feature] as const)
      ),
    [groupedFeatures]
  );

  const groupedFeatureCards = useMemo<GroupedFeatureCard[]>(() => {
    const cards: GroupedFeatureCard[] = normalizedGroupedOptions.map((option) => ({ ...option }));
    const knownIds = new Set(cards.map((option) => option.id));

    groupedFeatures.forEach((feature, index) => {
      const featureId = getGroupedFeatureKey(feature, index);
      if (knownIds.has(featureId)) return;
      knownIds.add(featureId);
      cards.push({
        id: featureId,
        name: feature.name?.trim() || `Grouped Feature #${index + 1}`,
        subcategory: getGroupedCustomFeatureSubcategory(feature),
        additionalOptionCategory: getGroupedCustomFeatureAdditionalOptionCategory(feature),
        description: feature.description?.trim() || '',
        pricingMode: getGroupedCustomFeaturePricingMode(feature),
        totalPrice: getGroupedCustomFeaturePricingMode(feature) === 'total' ? getCustomFeatureTotal(feature) : 0,
        pricePerSqft: getGroupedCustomFeaturePricePerSqft(feature),
        isRetired: true,
      });
    });

    return cards;
  }, [groupedFeatures, normalizedGroupedOptions]);

  const groupedFeatureSections = useMemo<GroupedFeatureSection[]>(() => {
    const order: Array<{ key: string; title: string; isFallback: boolean }> = [];
    const grouped = new Map<string, GroupedFeatureCard[]>();

    groupedFeatureCards.forEach((option) => {
      const subcategory = getGroupedCustomFeatureSubcategory(option);
      const key = subcategory || '__uncategorized__';
      const title = subcategory || 'Other';
      const isFallback = !subcategory;

      if (!grouped.has(key)) {
        grouped.set(key, []);
        order.push({ key, title, isFallback });
      }

      grouped.get(key)?.push(option);
    });

    return order.map((entry) => ({
      ...entry,
      options: grouped.get(entry.key) || [],
    }));
  }, [groupedFeatureCards]);

  const syncFeatures = (
    nextManualFeatures: CustomFeature[],
    nextGroupedFeatures: CustomFeature[] = groupedFeatures
  ) => {
    onChange(
      normalizeCustomFeatures({
        features: [...nextGroupedFeatures, ...nextManualFeatures],
      })
    );
  };

  const safeRetailPrice = Number.isFinite(retailPrice) ? (retailPrice as number) : 0;
  const negativeAdjustmentTotal = normalizedData.features.reduce((sum, feature) => {
    const total = getCustomFeatureTotal(feature);
    return total < 0 ? sum + Math.abs(total) : sum;
  }, 0);
  const showAdjustmentWarning = safeRetailPrice > 0 && negativeAdjustmentTotal > safeRetailPrice * 0.18;

  useEffect(() => {
    if (activeFeatureIndex !== null && activeFeatureIndex >= manualFeatures.length) {
      setActiveFeatureIndex(null);
    }
  }, [activeFeatureIndex, manualFeatures.length]);

  const addFeature = () => {
    if (manualFeatures.length >= maxManualFeatures) return;
    const nextManualFeatures = [
      ...manualFeatures,
      normalizeCustomFeature({
        name: '',
        description: '',
        laborCost: 0,
        materialCost: 0,
        totalCost: 0,
        isOffContract: false,
        source: 'manual',
      }),
    ];
    syncFeatures(nextManualFeatures);
    setActiveFeatureIndex(nextManualFeatures.length - 1);
  };

  const updateFeature = (index: number, field: keyof CustomFeature, value: any) => {
    const nextManualFeatures = manualFeatures.map((feature, featureIndex) =>
      featureIndex === index ? normalizeCustomFeature({ ...feature, [field]: value, source: 'manual' }) : feature
    );
    syncFeatures(nextManualFeatures);
  };

  const removeFeature = (index: number) => {
    const nextManualFeatures = manualFeatures.filter((_, featureIndex) => featureIndex !== index);
    syncFeatures(nextManualFeatures);
    setActiveFeatureIndex(null);
  };

  const toggleManualFeatures = (checked: boolean) => {
    if (checked) {
      if (manualFeatures.length === 0) addFeature();
      return;
    }
    syncFeatures([]);
    setActiveFeatureIndex(null);
  };

  const toggleGroupedFeature = (option: GroupedFeatureCard) => {
    const selected = groupedSelectionMap.get(option.id);
    if (selected) {
      const nextGroupedFeatures = groupedFeatures.filter(
        (feature, index) => getGroupedFeatureKey(feature, index) !== option.id
      );
      syncFeatures(manualFeatures, nextGroupedFeatures);
      return;
    }

    const additionalOptionCategory = getGroupedCustomFeatureAdditionalOptionCategory(option);
    const additionalOptionConfig = (additionalOptionLookup.get(additionalOptionCategory) || [])[0];
    const groupedAddonOptionId = getGroupedCustomFeatureAddonOptionId(additionalOptionConfig);
    const groupedAddonLabel = getGroupedCustomFeatureAdditionalOptionName(additionalOptionConfig);
    const groupedAddonUnitPrice = getGroupedCustomFeatureAddonUnitPrice(additionalOptionConfig);
    const hasGroupedAddon = Boolean(groupedAddonLabel);

    const nextGroupedFeatures = [
      ...groupedFeatures,
      normalizeCustomFeature({
        source: 'grouped',
        groupedOptionId: option.id,
        groupedSubcategory: getGroupedCustomFeatureSubcategory(option),
        groupedAdditionalOptionCategory: additionalOptionCategory,
        groupedAddonOptionId,
        groupedAddonLabel,
        groupedAddonUnitPrice,
        groupedAddonQuantity: hasGroupedAddon ? 1 : 0,
        name: option.name,
        description: option.description,
        groupedPricingMode: getGroupedCustomFeaturePricingMode(option),
        groupedPricePerSqft: getGroupedCustomFeaturePricePerSqft(option),
        groupedSqft: 0,
        totalCost: getGroupedCustomFeaturePricingMode(option) === 'total' ? option.totalPrice : 0,
        laborCost: 0,
        materialCost: 0,
        isOffContract: false,
      }),
    ];
    syncFeatures(manualFeatures, nextGroupedFeatures);
  };

  const updateGroupedFeatureOffContract = (optionId: string, isOffContract: boolean) => {
    const nextGroupedFeatures = groupedFeatures.map((feature, index) =>
      getGroupedFeatureKey(feature, index) === optionId
        ? normalizeCustomFeature({ ...feature, isOffContract, source: 'grouped' })
        : feature
    );
    syncFeatures(manualFeatures, nextGroupedFeatures);
  };

  const updateGroupedFeatureSqft = (optionId: string, groupedSqft: any) => {
    const nextGroupedFeatures = groupedFeatures.map((feature, index) =>
      getGroupedFeatureKey(feature, index) === optionId
        ? normalizeCustomFeature({ ...feature, groupedSqft, source: 'grouped' })
        : feature
    );
    syncFeatures(manualFeatures, nextGroupedFeatures);
  };

  const updateGroupedFeatureAddonQuantity = (optionId: string, groupedAddonQuantity: any) => {
    const nextGroupedFeatures = groupedFeatures.map((feature, index) =>
      getGroupedFeatureKey(feature, index) === optionId
        ? normalizeCustomFeature({ ...feature, groupedAddonQuantity, source: 'grouped' })
        : feature
    );
    syncFeatures(manualFeatures, nextGroupedFeatures);
  };

  const updateGroupedFeatureAddonSelection = (optionId: string, groupedAddonOptionId: string) => {
    const nextGroupedFeatures = groupedFeatures.map((feature, index) => {
      if (getGroupedFeatureKey(feature, index) !== optionId) {
        return feature;
      }

      const additionalOptionCategory = getGroupedCustomFeatureAdditionalOptionCategory(feature);
      const additionalOptionsForGroup = additionalOptionLookup.get(additionalOptionCategory) || [];
      const selectedAdditionalOption = additionalOptionsForGroup.find(
        (additionalOption) => getGroupedCustomFeatureAddonOptionId(additionalOption) === groupedAddonOptionId
      );
      const hasGroupedAddon = Boolean(selectedAdditionalOption);

      return normalizeCustomFeature({
        ...feature,
        groupedAddonOptionId: selectedAdditionalOption
          ? getGroupedCustomFeatureAddonOptionId(selectedAdditionalOption)
          : undefined,
        groupedAddonLabel: selectedAdditionalOption
          ? getGroupedCustomFeatureAdditionalOptionName(selectedAdditionalOption)
          : '',
        groupedAddonUnitPrice: selectedAdditionalOption
          ? getGroupedCustomFeatureAddonUnitPrice(selectedAdditionalOption)
          : 0,
        groupedAddonQuantity: hasGroupedAddon ? Math.max(1, getGroupedCustomFeatureAddonQuantity(feature)) : 0,
        source: 'grouped',
      });
    });

    syncFeatures(manualFeatures, nextGroupedFeatures);
  };

  return (
    <div className="section-form">
      <div className="form-help" style={{ marginBottom: '1.5rem', fontStyle: 'italic' }}>
        Use grouped feature presets from the active pricing model or add up to 7 manual custom features for one-off
        work.
      </div>

      {showAdjustmentWarning && (
        <div className="custom-features-warning">Warning: over 18% threshold</div>
      )}

      <div className="spec-block">
        <div className="spec-block-header">
          <h2 className="spec-block-title">Grouped Features</h2>
          <ProposalNote categoryKey="customFeatures" subcategoryId="groupedFeatures" overrides={noteOverrides} />
        </div>

        {groupedFeatureCards.length === 0 ? (
          <div className="empty-message">No grouped custom features are configured in the active pricing model.</div>
        ) : (
          <div className="custom-feature-group-sections">
            {groupedFeatureSections.map((section) => (
              <div key={section.key} className="custom-feature-group-section">
                {(!section.isFallback || groupedFeatureSections.length > 1) && (
                  <div className="custom-feature-group-section__header">
                    <h3 className="custom-feature-group-section__title">{section.title}</h3>
                  </div>
                )}
                <div className="custom-feature-group-grid">
                  {section.options.map((option) => {
                    const selectedFeature = groupedSelectionMap.get(option.id);
                    const isSelected = Boolean(selectedFeature);
                    const isOffContract = Boolean(selectedFeature?.isOffContract);
                    const pricingSource = selectedFeature || option;
                    const pricingMode = getGroupedCustomFeaturePricingMode(pricingSource);
                    const groupedSqft = selectedFeature ? getGroupedCustomFeatureSqft(selectedFeature) : 0;
                    const additionalOptionCategory = getGroupedCustomFeatureAdditionalOptionCategory(pricingSource);
                    const groupedAddonLabel = selectedFeature
                      ? getGroupedCustomFeatureAddonLabel(selectedFeature)
                      : '';
                    const groupedAddonOptionId = selectedFeature
                      ? getGroupedCustomFeatureAddonOptionId(selectedFeature)
                      : '';
                    const groupedAddonQuantity = selectedFeature ? getGroupedCustomFeatureAddonQuantity(selectedFeature) : 0;
                    const additionalOptionsForGroup = additionalOptionCategory
                      ? additionalOptionLookup.get(additionalOptionCategory) || []
                      : [];
                    const matchedAdditionalOption =
                      additionalOptionsForGroup.find(
                        (additionalOption) => getGroupedCustomFeatureAddonOptionId(additionalOption) === groupedAddonOptionId
                      ) ||
                      additionalOptionsForGroup.find(
                        (additionalOption) =>
                          getGroupedCustomFeatureAdditionalOptionName(additionalOption) === groupedAddonLabel
                      );
                    const resolvedGroupedAddonOptionId =
                      matchedAdditionalOption?.id ||
                      groupedAddonOptionId ||
                      (groupedAddonLabel ? `legacy-addon-${option.id}` : '');
                    const dropdownAdditionalOptions =
                      groupedAddonLabel && !matchedAdditionalOption
                        ? [
                            {
                              id: resolvedGroupedAddonOptionId,
                              groupName: additionalOptionCategory,
                              name: groupedAddonLabel,
                              addonUnitPrice: selectedFeature
                                ? getGroupedCustomFeatureAddonUnitPrice(selectedFeature)
                                : 0,
                            },
                            ...additionalOptionsForGroup,
                          ]
                        : additionalOptionsForGroup;
                    const hasGroupedAddon = Boolean(selectedFeature && dropdownAdditionalOptions.length > 0);

                    return (
                      <div
                        key={option.id}
                        className={`custom-feature-group-card${isSelected ? ' active' : ''}${
                          isOffContract ? ' off-contract' : ''
                        }${option.isRetired ? ' retired' : ''}`}
                      >
                        <div className="custom-feature-group-card__header">
                          <div>
                            <div className="custom-feature-group-card__title">
                              {option.name || 'Untitled Grouped Feature'}
                            </div>
                            <div className="custom-feature-group-card__status">
                              {isSelected ? (isOffContract ? 'Selected | Off Contract' : 'Selected') : 'Available'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`action-btn ${isSelected ? 'secondary' : ''}`}
                            onClick={() => toggleGroupedFeature(option)}
                          >
                            {isSelected ? 'Remove' : 'Select'}
                          </button>
                        </div>

                        {option.description?.trim() && (
                          <div className="custom-feature-group-card__description">{option.description.trim()}</div>
                        )}

                        {isSelected && pricingMode === 'sqft' && (
                          <div className="custom-feature-group-card__sqft-editor">
                            <label className="spec-label">Square Footage</label>
                            <div className="custom-feature-group-card__sqft-row">
                              <div className="compact-input-wrapper custom-feature-group-card__sqft-input">
                                <input
                                  type="number"
                                  className="compact-input"
                                  value={groupedSqft || ''}
                                  onChange={(e) => updateGroupedFeatureSqft(option.id, e.target.value)}
                                  onBlur={(e) => updateGroupedFeatureSqft(option.id, toNumber(e.target.value))}
                                  step="0.01"
                                  min="0"
                                  placeholder="Enter SF"
                                />
                              </div>
                              <div className="custom-feature-group-card__sqft-summary">
                                {groupedSqft > 0
                                  ? `Area entered: ${formatNumber(groupedSqft)} SF`
                                  : 'Enter the selected area for this feature.'}
                              </div>
                            </div>
                          </div>
                        )}

                        {isSelected && hasGroupedAddon && (
                          <div className="custom-feature-group-card__sqft-editor">
                            <label className="spec-label">{additionalOptionCategory || 'Additional Options'}</label>
                            <div className="compact-input-wrapper" style={{ marginBottom: '0.75rem' }}>
                              <select
                                className="compact-input"
                                value={resolvedGroupedAddonOptionId}
                                onChange={(e) => updateGroupedFeatureAddonSelection(option.id, e.target.value)}
                              >
                                {dropdownAdditionalOptions.map((additionalOption) => (
                                  <option
                                    key={additionalOption.id || `${additionalOption.groupName}-${additionalOption.name}`}
                                    value={additionalOption.id || ''}
                                  >
                                    {getGroupedCustomFeatureAdditionalOptionName(additionalOption)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="custom-feature-group-card__sqft-row">
                              <div className="compact-input-wrapper custom-feature-group-card__sqft-input">
                                <input
                                  type="number"
                                  className="compact-input"
                                  value={groupedAddonQuantity || groupedAddonQuantity === 0 ? groupedAddonQuantity : ''}
                                  onChange={(e) => updateGroupedFeatureAddonQuantity(option.id, e.target.value)}
                                  onBlur={(e) => updateGroupedFeatureAddonQuantity(option.id, toNumber(e.target.value))}
                                  step="1"
                                  min="0"
                                  placeholder="0"
                                />
                              </div>
                              <div className="custom-feature-group-card__sqft-summary">
                                {`${
                                  groupedAddonLabel || 'Selected additional option'
                                } count: ${formatNumber(groupedAddonQuantity)}`}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="custom-feature-group-card__footer">
                          {option.isRetired && <span className="info-pill">No longer in active pricing model</span>}
                          {isSelected && (
                            <CustomOffContractToggle
                              checked={isOffContract}
                              onChange={(checked) => updateGroupedFeatureOffContract(option.id, checked)}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="spec-block custom-options-block custom-options-block--compact">
        <div className="spec-block-header">
          <div className="equipment-category-title-row">
            <CustomOptionsIcon />
            <div className="equipment-category-title-copy">
              <h2 className="spec-block-title">Manual Custom Features</h2>
            </div>
          </div>
          <ProposalNote categoryKey="customFeatures" subcategoryId="manualCustomFeatures" overrides={noteOverrides} />
        </div>

        <div className="equipment-selection-controls">
          {manualFeatures.length > 0 && manualFeatures.length < maxManualFeatures && (
            <>
              <button
                type="button"
                className="action-btn secondary equipment-add-another-btn"
                onClick={addFeature}
              >
                Add Another
              </button>
              <span className="equipment-selection-divider" aria-hidden="true" />
            </>
          )}
          <div className="equipment-selection-toggle-anchor">
            <label className={`equipment-selection-toggle ${manualFeatures.length > 0 ? 'is-on' : 'is-off'}`}>
              <span className="equipment-selection-toggle__status">
                {manualFeatures.length > 0 ? 'Added' : 'Not added'}
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Manual Custom Features selection"
                checked={manualFeatures.length > 0}
                onChange={(event) => toggleManualFeatures(event.target.checked)}
              />
              <span className="equipment-selection-toggle__track" aria-hidden="true">
                <span className="equipment-selection-toggle__thumb" />
              </span>
            </label>
          </div>
        </div>

        {manualFeatures.map((feature, index) => {
          const isEditing = activeFeatureIndex === index;
          const total = getCustomFeatureTotal(feature);
          const isOffContract = Boolean(feature.isOffContract);
          const subtitle = feature.description?.trim() || 'No description provided';
          const clippedSubtitle = subtitle.length > 120 ? `${subtitle.slice(0, 120)}...` : subtitle;
          const featureTitle = feature.name?.trim() || `Custom Feature #${index + 1}`;
          const displayedTitle = index > 0 ? `${featureTitle} - Additional` : featureTitle;

          return (
            <div key={`manual-feature-${index}`} className="spec-subcard" style={{ marginBottom: '1rem' }}>
              <div className="spec-subcard-header">
                <div>
                  <div className="spec-subcard-title">{displayedTitle}</div>
                  {!isEditing && (
                    <>
                      <div className="spec-subcard-subtitle">{clippedSubtitle}</div>
                      <div className="spec-subcard-subtitle">
                        {isOffContract
                          ? `Off Contract | Total: ${formatCurrency(total)}`
                          : `Labor: ${formatCurrency(feature.laborCost)} | Material: ${formatCurrency(
                              feature.materialCost
                            )} | Total: ${formatCurrency(total)}`}
                      </div>
                    </>
                  )}
                </div>
                <div className="spec-subcard-actions stacked-actions">
                  <div className="stacked-primary-actions">
                    {isEditing ? (
                      <CustomOffContractToggle
                        checked={isOffContract}
                        onChange={(checked) => updateFeature(index, 'isOffContract', checked)}
                      />
                    ) : (
                      <>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setActiveFeatureIndex(index)}
                      >
                        Edit
                      </button>
                      <button type="button" className="link-btn danger" onClick={() => removeFeature(index)}>
                        Remove
                      </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="spec-field" style={{ marginTop: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">Feature Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={feature.name}
                      onChange={(e) => updateFeature(index, 'name', e.target.value)}
                      placeholder="e.g., 16x16, turf, etc."
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea
                      className="form-input"
                      value={feature.description}
                      onChange={(e) => updateFeature(index, 'description', e.target.value)}
                      placeholder="Description of the feature..."
                      rows={3}
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  {isOffContract ? (
                    <div className="form-row custom-option-single-cost-row">
                      <div className="form-group">
                        <label className="form-label">Total Cost</label>
                        <input
                          type="number"
                          className="form-input"
                          value={feature.totalCost || ''}
                          onChange={(e) => updateFeature(index, 'totalCost', e.target.value)}
                          onBlur={(e) => updateFeature(index, 'totalCost', toNumber(e.target.value))}
                          step="0.01"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Labor Cost</label>
                        <input
                          type="number"
                          className="form-input"
                          value={feature.laborCost || ''}
                          onChange={(e) => updateFeature(index, 'laborCost', e.target.value)}
                          onBlur={(e) => updateFeature(index, 'laborCost', toNumber(e.target.value))}
                          step="0.01"
                          placeholder="0"
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Material Cost</label>
                        <input
                          type="number"
                          className="form-input"
                          value={feature.materialCost || ''}
                          onChange={(e) => updateFeature(index, 'materialCost', e.target.value)}
                          onBlur={(e) => updateFeature(index, 'materialCost', toNumber(e.target.value))}
                          step="0.01"
                          placeholder="0"
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Total Cost (Auto)</label>
                        <input
                          type="text"
                          className="form-input"
                          value={formatCurrency(total)}
                          readOnly
                          style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
                        />
                      </div>
                    </div>
                  )}

                  <div
                    className="action-row"
                    style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    <button type="button" className="action-btn" onClick={() => setActiveFeatureIndex(null)}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

      </div>

    </div>
  );
}

export default CustomFeaturesSectionNew;
