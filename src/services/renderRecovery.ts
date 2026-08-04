const CLOUD_ONLY_RECOVERY_KEY = 'submerge.renderRecovery.cloudOnly.v1';

export function enableCloudOnlyRenderRecovery() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(CLOUD_ONLY_RECOVERY_KEY, '1');
  } catch {
    // Reload still remains available when session storage is unavailable.
  }
}

export function isCloudOnlyRenderRecoveryEnabled() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(CLOUD_ONLY_RECOVERY_KEY) === '1';
  } catch {
    return false;
  }
}
