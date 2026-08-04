import { useEffect, type RefObject } from 'react';

export function useHorizontalWheelScroll(
  containerRef: RefObject<HTMLElement>,
  enabled = true
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const handleWheel = (event: WheelEvent) => {
      const maximumScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maximumScrollLeft <= 1) return;

      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!rawDelta) return;

      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 32
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.max(container.clientWidth * 0.8, 1)
          : 1;

      event.preventDefault();
      event.stopPropagation();
      container.scrollLeft = Math.round(Math.min(
        maximumScrollLeft,
        Math.max(0, container.scrollLeft + rawDelta * deltaScale)
      ));
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, enabled]);
}
