const MESSAGE_CHECK_STALE_MS = 5 * 60 * 1000;
const lastSuccessfulCheckByUser = new Map<string, number>();

export function shouldCheckMessages(userId?: string | null, now = Date.now()) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;
  const checkedAt = lastSuccessfulCheckByUser.get(normalizedUserId) || 0;
  return now - checkedAt >= MESSAGE_CHECK_STALE_MS;
}

export function markMessagesChecked(userId?: string | null, now = Date.now()) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return;
  lastSuccessfulCheckByUser.set(normalizedUserId, now);
}

export function clearMessageCheckState(userId?: string | null) {
  const normalizedUserId = String(userId || '').trim();
  if (normalizedUserId) {
    lastSuccessfulCheckByUser.delete(normalizedUserId);
  } else {
    lastSuccessfulCheckByUser.clear();
  }
}

export { MESSAGE_CHECK_STALE_MS };
