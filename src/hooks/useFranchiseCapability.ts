import { useEffect, useState } from 'react';
import { getSessionFranchiseId } from '../services/session';
import {
  getCachedFranchiseConfiguration,
  isFranchiseCapabilityEnabled,
  loadFranchiseConfiguration,
  subscribeToFranchiseConfigurationUpdates,
  type FranchiseCapabilities,
} from '../services/franchiseConfiguration';

export function useFranchiseCapability(
  capability: keyof FranchiseCapabilities | string,
  franchiseId?: string,
  compatibilityDefaultValue = false
) {
  const resolvedId = franchiseId || getSessionFranchiseId();
  const cached = resolvedId ? getCachedFranchiseConfiguration(resolvedId) : null;
  const [enabled, setEnabled] = useState(() =>
    isFranchiseCapabilityEnabled(cached, capability, compatibilityDefaultValue)
  );
  const [isLoading, setIsLoading] = useState(Boolean(resolvedId) && !cached);

  useEffect(() => {
    if (!resolvedId) {
      setEnabled(false);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const cachedNow = getCachedFranchiseConfiguration(resolvedId);
    setEnabled(isFranchiseCapabilityEnabled(cachedNow, capability, compatibilityDefaultValue));
    setIsLoading(!cachedNow);

    void loadFranchiseConfiguration(resolvedId, { force: true })
      .then((record) => {
        if (cancelled) return;
        setEnabled(isFranchiseCapabilityEnabled(record, capability, compatibilityDefaultValue));
        setIsLoading(false);
      })
      .catch((error) => {
        console.warn(`Unable to load franchise capability ${String(capability)}:`, error);
        if (!cancelled) setIsLoading(false);
      });

    const unsubscribe = subscribeToFranchiseConfigurationUpdates(resolvedId, (record) => {
      if (cancelled) return;
      setEnabled(isFranchiseCapabilityEnabled(record, capability, compatibilityDefaultValue));
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [capability, compatibilityDefaultValue, resolvedId]);

  return { enabled, isLoading };
}
