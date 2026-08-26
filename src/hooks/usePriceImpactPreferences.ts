import { useEffect, useState } from 'react';
import {
  getCachedPriceImpactPreferences,
  getSessionUserId,
  loadPriceImpactPreferences,
  subscribeToPriceImpactPreferences,
} from '../services/userPreferences';

export function usePriceImpactPreferences(userId = getSessionUserId()) {
  const [preferences, setPreferences] = useState(() =>
    getCachedPriceImpactPreferences(userId)
  );
  const [isLoading, setIsLoading] = useState(Boolean(userId));

  useEffect(() => {
    let cancelled = false;
    setPreferences(getCachedPriceImpactPreferences(userId));
    setIsLoading(Boolean(userId));

    void loadPriceImpactPreferences(userId).then((loaded) => {
      if (cancelled) return;
      setPreferences(loaded);
      setIsLoading(false);
    });

    const unsubscribe = subscribeToPriceImpactPreferences(userId, (next) => {
      if (cancelled) return;
      setPreferences(next);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  return { ...preferences, isLoading };
}
