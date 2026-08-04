import { useLayoutEffect } from 'react';

const MODAL_SELECTOR = '[aria-modal="true"], [data-scroll-lock="true"]';
const SCROLL_LOCK_CLASS = 'app-modal-scroll-locked';

function isVisibleModal(element: Element) {
  if (!(element instanceof HTMLElement) || element.hidden) return false;
  const styles = window.getComputedStyle(element);
  return styles.display !== 'none' && styles.visibility !== 'hidden';
}

export default function useGlobalModalScrollLock() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    let isLocked = false;

    const setLocked = (shouldLock: boolean) => {
      if (shouldLock === isLocked) return;
      isLocked = shouldLock;

      if (shouldLock) {
        const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
        body.style.setProperty('--app-modal-scrollbar-width', `${scrollbarWidth}px`);
        root.classList.add(SCROLL_LOCK_CLASS);
        body.classList.add(SCROLL_LOCK_CLASS);
        return;
      }

      root.classList.remove(SCROLL_LOCK_CLASS);
      body.classList.remove(SCROLL_LOCK_CLASS);
      body.style.removeProperty('--app-modal-scrollbar-width');
    };

    const syncLockState = () => {
      const hasVisibleModal = Array.from(document.querySelectorAll(MODAL_SELECTOR)).some(isVisibleModal);
      setLocked(hasVisibleModal);
    };

    const observer = new MutationObserver(syncLockState);
    observer.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'data-scroll-lock', 'class', 'hidden', 'style'],
    });
    syncLockState();

    return () => {
      observer.disconnect();
      setLocked(false);
    };
  }, []);
}
