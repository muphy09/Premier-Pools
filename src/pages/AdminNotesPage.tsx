import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PROPOSAL_NOTE_CATEGORIES,
  buildProposalNoteKey,
  buildProposalNoteValues,
  normalizeProposalNoteOverrides,
  sanitizeProposalNoteText,
  serializeProposalNoteOverrides,
  type ProposalNoteCategory,
  type ProposalNoteCategoryKey,
  type ProposalNoteOverrides,
  type ProposalNoteSubcategory,
} from '../utils/proposalNotes';
import {
  loadFranchiseProposalNotes,
  saveFranchiseProposalNotes,
} from '../services/proposalNotesAdapter';
import { getSessionFranchiseId, getSessionUserName } from '../services/session';
import '../components/PricingDataModal.css';
import './AdminNotesPage.css';

interface AdminNotesPageProps {
  franchiseId?: string | null;
  franchiseName?: string | null;
  franchiseCode?: string | null;
}

const firstCategoryKey = PROPOSAL_NOTE_CATEGORIES[0]?.key || 'poolSpecs';

const getCategoryByKey = (key: ProposalNoteCategoryKey): ProposalNoteCategory =>
  PROPOSAL_NOTE_CATEGORIES.find((category) => category.key === key) || PROPOSAL_NOTE_CATEGORIES[0];

function renderCategoryIcon(category: ProposalNoteCategory) {
  return (
    <span className="pricing-section__icon" aria-hidden="true">
      <span className="pricing-section__glyph-letter">{category.shortTitle.charAt(0).toUpperCase()}</span>
    </span>
  );
}

function getTextareaId(categoryKey: ProposalNoteCategoryKey, subcategory: ProposalNoteSubcategory) {
  return `proposal-note-${categoryKey}-${subcategory.id}`;
}

function AdminNotesPage({ franchiseId, franchiseName, franchiseCode }: AdminNotesPageProps) {
  const navigate = useNavigate();
  const targetFranchiseId = franchiseId || getSessionFranchiseId();
  const targetFranchiseLabel =
    String(franchiseName || franchiseCode || targetFranchiseId || 'Unknown Franchise').trim() || 'Unknown Franchise';
  const [activeCategoryKey, setActiveCategoryKey] = useState<ProposalNoteCategoryKey>(firstCategoryKey);
  const [draftValues, setDraftValues] = useState<ProposalNoteOverrides>(() => buildProposalNoteValues({}));
  const [baselineOverrides, setBaselineOverrides] = useState<ProposalNoteOverrides>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);
  const pendingLeaveActionRef = useRef<(() => void) | null>(null);
  const hasChangesRef = useRef(false);
  const backGuardActiveRef = useRef(false);
  const suppressNextPopRef = useRef(false);
  const allowNextPopLeaveRef = useRef(false);

  const activeCategory = useMemo(() => getCategoryByKey(activeCategoryKey), [activeCategoryKey]);
  const hasChanges = useMemo(
    () => serializeProposalNoteOverrides(draftValues) !== serializeProposalNoteOverrides(baselineOverrides),
    [baselineOverrides, draftValues]
  );

  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setSaveError(null);
    setSaveStatus(null);

    loadFranchiseProposalNotes(targetFranchiseId, { force: true })
      .then((record) => {
        if (cancelled) return;
        const nextOverrides = normalizeProposalNoteOverrides(record?.notes);
        setBaselineOverrides(nextOverrides);
        setDraftValues(buildProposalNoteValues(nextOverrides));
      })
      .catch((error) => {
        console.warn('Unable to load proposal notes:', error);
        if (cancelled) return;
        setBaselineOverrides({});
        setDraftValues(buildProposalNoteValues({}));
        setSaveError('Unable to load saved notes. Defaults are shown.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [targetFranchiseId]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const pushBackGuardEntry = useCallback(() => {
    if (typeof window === 'undefined') return;

    const currentState =
      window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const nextState = {
      ...currentState,
      proposalNotesBackGuard: true,
    };
    if (typeof currentState.idx === 'number') {
      nextState.idx = currentState.idx + 1;
    }

    window.history.pushState(nextState, '', window.location.href);
    backGuardActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (hasChanges) {
      if (!backGuardActiveRef.current) {
        pushBackGuardEntry();
      }
      return;
    }

    if (!backGuardActiveRef.current) return;

    const currentState = window.history.state as { proposalNotesBackGuard?: boolean } | null;
    backGuardActiveRef.current = false;
    if (currentState?.proposalNotesBackGuard) {
      suppressNextPopRef.current = true;
      window.history.back();
    }
  }, [hasChanges, pushBackGuardEntry]);

  useEffect(() => {
    const handlePopState = () => {
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false;
        return;
      }
      if (allowNextPopLeaveRef.current) {
        allowNextPopLeaveRef.current = false;
        backGuardActiveRef.current = false;
        return;
      }
      if (!hasChangesRef.current || showLeavePrompt) return;

      pushBackGuardEntry();
      pendingLeaveActionRef.current = () => {
        allowNextPopLeaveRef.current = true;
        backGuardActiveRef.current = false;
        window.history.go(-2);
      };
      setShowLeavePrompt(true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [pushBackGuardEntry, showLeavePrompt]);

  const requestLeave = useCallback(
    (action: () => void) => {
      if (!hasChanges) {
        action();
        return;
      }
      pendingLeaveActionRef.current = action;
      setShowLeavePrompt(true);
    },
    [hasChanges]
  );

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!hasChanges || showLeavePrompt) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.href === window.location.href) return;

      event.preventDefault();
      event.stopPropagation();
      requestLeave(() => {
        window.location.href = nextUrl.href;
      });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [hasChanges, requestLeave, showLeavePrompt]);

  const handleNoteChange = (
    categoryKey: ProposalNoteCategoryKey,
    subcategory: ProposalNoteSubcategory,
    value: string
  ) => {
    const key = buildProposalNoteKey(categoryKey, subcategory.id);
    setDraftValues((current) => ({
      ...current,
      [key]: value,
    }));
    setSaveError(null);
    setSaveStatus(null);
  };

  const handleResetNote = (categoryKey: ProposalNoteCategoryKey, subcategory: ProposalNoteSubcategory) => {
    const key = buildProposalNoteKey(categoryKey, subcategory.id);
    setDraftValues((current) => ({
      ...current,
      [key]: sanitizeProposalNoteText(subcategory.defaultNote),
    }));
    setSaveError(null);
    setSaveStatus(null);
  };

  const handleResetChanges = () => {
    setDraftValues(buildProposalNoteValues(baselineOverrides));
    setSaveError(null);
    setSaveStatus(null);
  };

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      setSaveError(null);
      setSaveStatus(null);
      const nextOverrides = normalizeProposalNoteOverrides(draftValues);
      const record = await saveFranchiseProposalNotes({
        franchiseId: targetFranchiseId,
        notes: nextOverrides,
        updatedBy: getSessionUserName(),
      });
      const savedOverrides = normalizeProposalNoteOverrides(record.notes);
      setBaselineOverrides(savedOverrides);
      setDraftValues(buildProposalNoteValues(savedOverrides));
      setSaveStatus('Notes saved.');
      return true;
    } catch (error: any) {
      console.error('Failed to save proposal notes:', error);
      setSaveError(error?.message || 'Unable to save proposal notes.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [draftValues, targetFranchiseId]);

  const handleBackToAdmin = () => {
    requestLeave(() => navigate('/admin'));
  };

  const handleSaveAndLeave = async () => {
    const saved = await handleSave();
    if (!saved) return;
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    setShowLeavePrompt(false);
    allowNextPopLeaveRef.current = true;
    action?.();
  };

  const handleLeaveWithoutSaving = () => {
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    setShowLeavePrompt(false);
    allowNextPopLeaveRef.current = true;
    action?.();
  };

  return (
    <div className="pricing-page-shell admin-notes-page-shell">
      <div className="pricing-page">
        <aside className="pricing-page__sidebar">
          <div className="pricing-page__sidebar-top">
            <div className="pricing-page__nav-block">
              <p className="pricing-page__nav-title">Navigation Categories</p>
              <div className="pricing-page__nav">
                {PROPOSAL_NOTE_CATEGORIES.map((category) => {
                  const isActive = category.key === activeCategoryKey;
                  return (
                    <button
                      key={category.key}
                      type="button"
                      className={`pricing-page__nav-item${isActive ? ' is-active' : ''}`}
                      onClick={() => setActiveCategoryKey(category.key)}
                    >
                      <span className="pricing-page__nav-icon">{renderCategoryIcon(category)}</span>
                      <span>{category.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pricing-page__sidebar-bottom">
            <button className="pricing-close pricing-close--page" type="button" onClick={handleBackToAdmin}>
              Back to Admin
            </button>
          </div>
        </aside>

        <div className="pricing-page__main">
          <div className="pricing-hero pricing-hero--page admin-notes-hero">
            <div className="pricing-hero__content">
              <h2>Edit Notes</h2>
              <p className="admin-notes-hero__lede">
                Edit the descriptions shown inside proposal-builder subcategory blocks for this franchise.
              </p>
            </div>
          </div>

          <div className="pricing-card pricing-model-summary-card">
            <div className="pricing-model-summary-card__content">
              <span className="pricing-label muted">Franchise:</span>
              <span className="pricing-model-panel__name">{targetFranchiseLabel}</span>
              {hasChanges && <span className="pricing-pill">Unsaved changes</span>}
            </div>
          </div>

          {saveError && <div className="pricing-model-error">{saveError}</div>}
          {saveStatus && <div className="admin-notes-status">{saveStatus}</div>}

          <div className="pricing-workspace">
            <div className="pricing-workspace__center">
              <section className="pricing-section pricing-section--page">
                <div className="pricing-section__header pricing-section__header--static">
                  <div className="pricing-section__header-left">
                    {renderCategoryIcon(activeCategory)}
                    <span className="pricing-section__title">{activeCategory.title}</span>
                  </div>
                </div>
                <div className="pricing-section__body pricing-section__body--open">
                  <div className="pricing-section__body-content admin-notes-section-body">
                    {isLoading ? (
                      <div className="pricing-empty">Loading proposal notes...</div>
                    ) : (
                      activeCategory.subcategories.map((subcategory) => {
                        const noteKey = buildProposalNoteKey(activeCategory.key, subcategory.id);
                        const currentValue = draftValues[noteKey] ?? '';
                        const defaultValue = sanitizeProposalNoteText(subcategory.defaultNote);
                        const isDefaultValue = sanitizeProposalNoteText(currentValue) === defaultValue;
                        const textareaId = getTextareaId(activeCategory.key, subcategory);

                        return (
                          <div key={noteKey} className="pricing-group admin-note-block">
                            <div className="pricing-group__header">
                              <div className="pricing-group__heading">
                                <p className="pricing-group__eyebrow">Proposal Subcategory</p>
                                <h4>
                                  {subcategory.title}
                                  {subcategory.conditionalNote && <span className="admin-notes-conditional-mark"> *</span>}
                                </h4>
                                {subcategory.conditionalNote && (
                                  <p className="admin-notes-conditional-note">* Conditional: {subcategory.conditionalNote}</p>
                                )}
                              </div>
                              <button
                                type="button"
                                className="pricing-chip-button ghost"
                                onClick={() => handleResetNote(activeCategory.key, subcategory)}
                                disabled={isDefaultValue}
                              >
                                Reset to Default
                              </button>
                            </div>
                            <label className="pricing-input-block" htmlFor={textareaId}>
                              <span className="pricing-input-block__label">Description shown to users</span>
                              <textarea
                                id={textareaId}
                                className="pricing-input admin-note-textarea"
                                value={currentValue}
                                onChange={(event) => handleNoteChange(activeCategory.key, subcategory, event.target.value)}
                                rows={4}
                                placeholder="No default note configured."
                              />
                            </label>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>
            </div>

            <aside className="pricing-workspace__rail">
              <div className="pricing-rail-card pricing-rail-card--help">
                <div className="pricing-rail-card__header">
                  <h3>Notes</h3>
                </div>
                <div className="pricing-help">
                  <p>
                    Blocks marked with * are conditional and only appear for certain proposal selections.
                  </p>
                  <p>
                    Empty descriptions are allowed. Use Reset to Default to clear a custom description and restore the app default.
                  </p>
                </div>
              </div>
              <div className="pricing-rail-card pricing-rail-card--actions">
                <div className="pricing-rail-card__header">
                  <h3>Actions</h3>
                </div>
                <div className="pricing-rail-actions">
                  <button
                    className={`pricing-chip-button ${!hasChanges || isLoading ? 'disabled' : ''}`}
                    type="button"
                    disabled={!hasChanges || isLoading}
                    onClick={handleResetChanges}
                  >
                    Reset Changes
                  </button>
                  <button
                    className={`pricing-chip-button primary ${!hasChanges || isLoading ? 'disabled' : ''}`}
                    type="button"
                    disabled={!hasChanges || saving || isLoading}
                    onClick={() => void handleSave()}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {showLeavePrompt && (
        <div className="pricing-confirm-backdrop" data-scroll-lock="true">
          <div className="pricing-confirm-card admin-notes-leave-card">
            <div className="pricing-confirm-message">
              You have unsaved note changes. Changes will not be saved unless you save before leaving.
            </div>
            <div className="pricing-confirm-actions admin-notes-leave-actions">
              <button
                className="pricing-chip-button primary"
                type="button"
                onClick={() => void handleSaveAndLeave()}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save & Leave'}
              </button>
              <button
                className="pricing-chip-button danger"
                type="button"
                onClick={handleLeaveWithoutSaving}
                disabled={saving}
              >
                Leave Without Saving
              </button>
              <button
                className="pricing-chip-button ghost"
                type="button"
                onClick={() => {
                  pendingLeaveActionRef.current = null;
                  setShowLeavePrompt(false);
                }}
                disabled={saving}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminNotesPage;
