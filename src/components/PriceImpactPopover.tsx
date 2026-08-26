import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { PriceImpactLine, PriceImpactResult } from '../services/priceImpact';
import { TooltipAnchor } from './AppTooltip';
import './PriceImpactPopover.css';

interface PriceImpactPopoverProps {
  controlLabel: string;
  requestKey: string;
  loadImpact: () => PriceImpactResult | Promise<PriceImpactResult>;
}

type PopoverPosition = {
  top: number;
  left: number;
  arrowLeft: number;
  placement: 'above' | 'below';
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatLineAmount = (line: PriceImpactLine): string => {
  const formatted = currencyFormatter.format(line.amount);
  return line.approximate ? `~${formatted}` : formatted;
};

const formatCustomerChange = (amount: number): string => {
  const absolute = Math.abs(amount);
  const formatter = Math.abs(absolute - Math.round(absolute)) < 0.005
    ? wholeCurrencyFormatter
    : currencyFormatter;
  const formatted = formatter.format(absolute);
  if (amount > 0) return `+~${formatted}`;
  if (amount < 0) return `-~${formatted}`;
  return `~${formatted}`;
};

const PriceImpactLines = ({ lines }: { lines: PriceImpactLine[] }) => (
  <div className="price-impact-lines">
    {lines.map((line) => (
      <div className="price-impact-line" key={line.key}>
        <span className="price-impact-line-copy">
          <span>{line.label}</span>
          {line.note && <small>{line.note}</small>}
        </span>
        <span className={line.amount < 0 ? 'is-negative' : undefined}>
          {formatLineAmount(line)}
        </span>
      </div>
    ))}
  </div>
);

function PriceImpactPopover({
  controlLabel,
  requestKey,
  loadImpact,
}: PriceImpactPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PriceImpactResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const panelId = `price-impact-${controlLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const close = useCallback(() => {
    requestIdRef.current += 1;
    setIsOpen(false);
    setIsLoading(false);
    setPosition(null);
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const viewportPadding = 12;
    const gap = 10;
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || Math.min(372, window.innerWidth - viewportPadding * 2);
    const panelHeight = panelRect.height || 360;
    const left = Math.min(
      Math.max(triggerRect.right - panelWidth, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
    );
    const fitsBelow = triggerRect.bottom + gap + panelHeight <= window.innerHeight - viewportPadding;
    const fitsAbove = triggerRect.top - gap - panelHeight >= viewportPadding;
    const placement: PopoverPosition['placement'] = !fitsBelow && fitsAbove ? 'above' : 'below';
    const top = placement === 'above'
      ? Math.max(viewportPadding, triggerRect.top - panelHeight - gap)
      : Math.min(
          triggerRect.bottom + gap,
          Math.max(viewportPadding, window.innerHeight - panelHeight - viewportPadding)
        );
    const arrowLeft = Math.min(
      Math.max(triggerRect.left + triggerRect.width / 2 - left, 22),
      panelWidth - 22
    );

    setPosition({ top, left, arrowLeft, placement });
  }, []);

  const open = () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsOpen(true);
    setIsLoading(true);
    setResult(null);
    setError(null);
    setPosition(null);

    window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      Promise.resolve()
        .then(loadImpact)
        .then((nextResult) => {
          if (requestIdRef.current !== requestId) return;
          setResult(nextResult);
          setIsLoading(false);
        })
        .catch((loadError: unknown) => {
          if (requestIdRef.current !== requestId) return;
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Price Impact is unavailable for this selection.'
          );
          setIsLoading(false);
        });
    }, 0);
  };

  useEffect(() => {
    setResult(null);
    setError(null);
    if (isOpen) close();
    // requestKey deliberately represents the proposal/control calculation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      triggerRef.current?.focus();
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [close, isOpen, updatePosition]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    const panel = panelRef.current;
    const observer = panel && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updatePosition)
      : null;
    if (panel && observer) observer.observe(panel);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [isLoading, isOpen, result, error, updatePosition]);

  const automaticLines = result?.automaticEffects || [];
  const panelStyle = {
    top: `${position?.top ?? 0}px`,
    left: `${position?.left ?? 0}px`,
    visibility: position ? 'visible' : 'hidden',
    pointerEvents: position ? 'auto' : 'none',
    '--price-impact-arrow-left': `${position?.arrowLeft ?? 32}px`,
  } as CSSProperties;

  return (
    <span className="price-impact-trigger-wrap">
      <TooltipAnchor tooltip={isOpen ? undefined : 'Price Impact'}>
        <button
          ref={triggerRef}
          type="button"
          className={`price-impact-trigger${isOpen ? ' is-open' : ''}`}
          aria-label={`Show Price Impact for ${controlLabel}`}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={isOpen ? panelId : undefined}
          onClick={() => (isOpen ? close() : open())}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M14.7 8.7c-.6-.7-1.5-1.1-2.7-1.1-1.5 0-2.7.8-2.7 2 0 1.3 1.2 1.8 2.7 2.1 1.5.3 2.7.8 2.7 2.1 0 1.2-1.2 2.1-2.8 2.1-1.2 0-2.2-.4-2.9-1.2M12 5.7v12.6" />
          </svg>
        </button>
      </TooltipAnchor>

      {isOpen && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          className="price-impact-popover"
          data-placement={position?.placement ?? 'below'}
          role="dialog"
          aria-label={`Price Impact for ${controlLabel}`}
          style={panelStyle}
        >
          <div className="price-impact-title-row">
            <h3>Price Impact</h3>
            <button type="button" className="price-impact-close" onClick={close} aria-label="Close Price Impact">
              ×
            </button>
          </div>

          {isLoading && (
            <div className="price-impact-status" role="status">
              <span className="price-impact-spinner" aria-hidden="true" />
              Calculating the complete proposal impact…
            </div>
          )}

          {!isLoading && error && (
            <div className="price-impact-unavailable" role="alert">{error}</div>
          )}

          {!isLoading && result?.status === 'unavailable' && (
            <div className="price-impact-unavailable" role="status">
              {result.message || 'Price Impact is unavailable for this selection.'}
            </div>
          )}

          {!isLoading && result?.status === 'available' && (
            <>
              {result.directCharges.length > 0 && (
                <section className="price-impact-section">
                  <h4>Direct Charges</h4>
                  <PriceImpactLines lines={result.directCharges} />
                </section>
              )}

              {automaticLines.length > 0 && (
                <section className="price-impact-section price-impact-automatic">
                  <h4>Indirect Charges</h4>
                  <PriceImpactLines lines={automaticLines} />
                </section>
              )}

              <section className="price-impact-total">
                <h4>Estimated customer price change</h4>
                <strong className={result.customerPriceChange < 0 ? 'is-negative' : undefined}>
                  {formatCustomerChange(result.customerPriceChange)}
                </strong>
              </section>

              <p className="price-impact-comparison">{result.comparisonLabel}.</p>
              <p className="price-impact-footnote">
                {result.displayBasis === 'retail' ? 'Retail Amounts Shown. ' : 'COGS Amounts Shown. '}
                Calculated using this proposal version and pricing model.
              </p>
            </>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

export default PriceImpactPopover;
