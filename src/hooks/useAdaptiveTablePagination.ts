import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type AdaptiveTablePaginationOptions = {
  itemCount: number;
  maxPageSize: number;
  estimatedRowHeight: number;
  estimatedHeaderHeight?: number;
  resetKey?: string;
  viewportHeightRatio?: number;
  minViewportHeight?: number;
  maxViewportHeight?: number;
  fitToWindow?: boolean;
  windowBottomOffset?: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function useAdaptiveTablePagination({
  itemCount,
  maxPageSize,
  estimatedRowHeight,
  estimatedHeaderHeight = 44,
  resetKey = '',
  viewportHeightRatio,
  minViewportHeight = 240,
  maxViewportHeight = 680,
  fitToWindow = false,
  windowBottomOffset = 0,
}: AdaptiveTablePaginationOptions) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tallestObservedRowHeightRef = useRef(estimatedRowHeight);
  const tableViewResetPendingRef = useRef(false);
  const [pageSize, setPageSize] = useState(maxPageSize);
  const [currentPage, setCurrentPage] = useState(1);

  const resetObservedRowHeight = useCallback(() => {
    tallestObservedRowHeightRef.current = estimatedRowHeight;
  }, [estimatedRowHeight]);

  const measurePageSize = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const viewportStyles = window.getComputedStyle(viewport);
    const paddingHeight =
      (Number.parseFloat(viewportStyles.paddingTop) || 0) +
      (Number.parseFloat(viewportStyles.paddingBottom) || 0);
    const header = viewport.querySelector('thead') as HTMLElement | null;
    const renderedRows = Array.from(viewport.querySelectorAll('tbody tr')) as HTMLElement[];
    const renderedRowHeight = renderedRows.reduce(
      (largest, row) => Math.max(largest, row.getBoundingClientRect().height),
      estimatedRowHeight
    );
    // A page can contain taller rows than the next page (for example, a wrapped
    // customer name or a sync-status note). Keep the tallest row observed for
    // this table view so moving between pages cannot increase pageSize and
    // remap the requested page back to an earlier one.
    const measuredRowHeight = Math.max(
      tallestObservedRowHeightRef.current,
      renderedRowHeight
    );
    tallestObservedRowHeightRef.current = measuredRowHeight;
    const headerHeight = Math.max(header?.getBoundingClientRect().height || 0, estimatedHeaderHeight);
    const availableHeight = fitToWindow
      ? window.innerHeight - viewport.getBoundingClientRect().top - windowBottomOffset
      : viewportHeightRatio
        ? clamp(window.innerHeight * viewportHeightRatio, minViewportHeight, maxViewportHeight)
        : viewport.clientHeight;

    if (measuredRowHeight <= 0) return;
    if (!fitToWindow && availableHeight <= headerHeight + paddingHeight) return;

    const nextPageSize = clamp(
      Math.floor((availableHeight - headerHeight - paddingHeight) / measuredRowHeight),
      1,
      maxPageSize
    );

    setPageSize((previousPageSize) => {
      if (previousPageSize === nextPageSize) return previousPageSize;
      setCurrentPage((previousPage) => {
        const previousStartIndex = (previousPage - 1) * previousPageSize;
        return Math.floor(previousStartIndex / nextPageSize) + 1;
      });
      return nextPageSize;
    });
  }, [
    estimatedHeaderHeight,
    estimatedRowHeight,
    fitToWindow,
    maxPageSize,
    maxViewportHeight,
    minViewportHeight,
    viewportHeightRatio,
    windowBottomOffset,
  ]);

  useLayoutEffect(() => {
    resetObservedRowHeight();
    tableViewResetPendingRef.current = true;
    setCurrentPage(1);
  }, [resetKey, resetObservedRowHeight]);

  useLayoutEffect(() => {
    // If filters or sorting changed while a later page was active, wait for
    // page 1 to render before measuring the new table view.
    if (tableViewResetPendingRef.current && currentPage !== 1) return;
    tableViewResetPendingRef.current = false;
    measurePageSize();
  }, [currentPage, itemCount, measurePageSize, pageSize, resetKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let animationFrame = 0;
    const scheduleMeasurement = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measurePageSize);
    };
    const handleWindowResize = () => {
      // Real layout changes should be free to establish a new row height. A
      // ResizeObserver notification alone may be caused by changing pages, so
      // it intentionally does not clear the cached height.
      resetObservedRowHeight();
      scheduleMeasurement();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasurement);

    resizeObserver?.observe(viewport);
    window.addEventListener('resize', handleWindowResize);
    scheduleMeasurement();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [itemCount, measurePageSize, resetKey, resetObservedRowHeight]);

  const totalPages = Math.max(1, Math.ceil(itemCount / pageSize));

  useLayoutEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const pagination = useMemo(() => {
    const startIndex = itemCount === 0 ? 0 : (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, itemCount);
    return { startIndex, endIndex };
  }, [currentPage, itemCount, pageSize]);

  const goToPage = useCallback(
    (page: number) => setCurrentPage(clamp(page, 1, totalPages)),
    [totalPages]
  );

  return {
    viewportRef,
    currentPage,
    pageSize,
    totalPages,
    startIndex: pagination.startIndex,
    endIndex: pagination.endIndex,
    goToPage,
  };
}
