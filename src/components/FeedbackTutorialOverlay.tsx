import { useEffect, useState } from 'react';
import './FeedbackUi.css';

export type FeedbackTutorialTargetRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type FeedbackTutorialOverlayProps = {
  isOpen: boolean;
  targetRect: FeedbackTutorialTargetRect;
  onDismiss: () => void;
};

const DISMISS_DELAY_MS = 1500;
const SPOTLIGHT_PADDING = 18;
const VIEWPORT_PADDING = 12;

function FeedbackTutorialOverlay({
  isOpen,
  targetRect,
  onDismiss,
}: FeedbackTutorialOverlayProps) {
  const [dismissUnlocked, setDismissUnlocked] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setDismissUnlocked(false);
    const timeoutId = window.setTimeout(() => {
      setDismissUnlocked(true);
    }, DISMISS_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isOpen]);

  if (!isOpen || typeof window === 'undefined') return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const spotlightLeft = Math.max(VIEWPORT_PADDING, targetRect.left - SPOTLIGHT_PADDING);
  const spotlightTop = Math.max(VIEWPORT_PADDING, targetRect.top - SPOTLIGHT_PADDING);
  const spotlightRight = Math.min(viewportWidth - VIEWPORT_PADDING, targetRect.right + SPOTLIGHT_PADDING);
  const spotlightBottom = Math.min(viewportHeight - VIEWPORT_PADDING, targetRect.bottom + SPOTLIGHT_PADDING);
  const spotlightWidth = Math.max(0, spotlightRight - spotlightLeft);
  const spotlightHeight = Math.max(0, spotlightBottom - spotlightTop);

  if (spotlightWidth <= 0 || spotlightHeight <= 0) return null;

  const cardWidth = Math.min(320, Math.max(190, viewportWidth - 32));
  const cardHeight = 136;
  const canPlaceCardAbove = spotlightTop > cardHeight + 40;
  const cardLeft = Math.max(
    16,
    Math.min(spotlightLeft - cardWidth - 28, viewportWidth - cardWidth - 16)
  );
  const cardTop = canPlaceCardAbove
    ? Math.max(16, spotlightTop - cardHeight - 28)
    : Math.min(viewportHeight - cardHeight - 16, spotlightBottom + 24);
  const arrowDirection = canPlaceCardAbove ? 1 : -1;
  const startY = canPlaceCardAbove ? cardTop + cardHeight - 22 : cardTop + 22;

  const arrowPathOne = [
    `M ${cardLeft + cardWidth - 42} ${startY}`,
    `C ${cardLeft + cardWidth + 16} ${startY + 52 * arrowDirection},`,
    `${spotlightLeft + spotlightWidth * 0.15} ${spotlightTop - 44 * arrowDirection},`,
    `${spotlightLeft + spotlightWidth * 0.34} ${spotlightTop + spotlightHeight * 0.28}`,
  ].join(' ');

  const arrowPathTwo = [
    `M ${cardLeft + cardWidth - 76} ${startY + 8 * arrowDirection}`,
    `C ${cardLeft + cardWidth + 4} ${startY + 68 * arrowDirection},`,
    `${spotlightLeft + spotlightWidth * 0.28} ${spotlightTop - 18 * arrowDirection},`,
    `${spotlightLeft + spotlightWidth * 0.56} ${spotlightTop + spotlightHeight * 0.5}`,
  ].join(' ');

  const arrowPathThree = [
    `M ${cardLeft + cardWidth - 114} ${startY + 16 * arrowDirection}`,
    `C ${cardLeft + cardWidth - 12} ${startY + 90 * arrowDirection},`,
    `${spotlightLeft + spotlightWidth * 0.42} ${spotlightTop + 30 * arrowDirection},`,
    `${spotlightLeft + spotlightWidth * 0.76} ${spotlightTop + spotlightHeight * 0.72}`,
  ].join(' ');

  const dismissHint = dismissUnlocked ? 'Click anywhere to continue' : 'Take a quick look...';

  return (
    <div className="feedback-tutorial" aria-live="polite" data-scroll-lock="true">
      <div
        className={`feedback-tutorial-panel${dismissUnlocked ? ' is-unlocked' : ''}`}
        style={{ top: 0, left: 0, width: '100vw', height: spotlightTop }}
        onClick={dismissUnlocked ? onDismiss : undefined}
      />
      <div
        className={`feedback-tutorial-panel${dismissUnlocked ? ' is-unlocked' : ''}`}
        style={{ top: spotlightTop, left: 0, width: spotlightLeft, height: spotlightHeight }}
        onClick={dismissUnlocked ? onDismiss : undefined}
      />
      <div
        className={`feedback-tutorial-panel${dismissUnlocked ? ' is-unlocked' : ''}`}
        style={{
          top: spotlightTop,
          left: spotlightRight,
          width: viewportWidth - spotlightRight,
          height: spotlightHeight,
        }}
        onClick={dismissUnlocked ? onDismiss : undefined}
      />
      <div
        className={`feedback-tutorial-panel${dismissUnlocked ? ' is-unlocked' : ''}`}
        style={{
          top: spotlightBottom,
          left: 0,
          width: '100vw',
          height: viewportHeight - spotlightBottom,
        }}
        onClick={dismissUnlocked ? onDismiss : undefined}
      />

      <div
        className="feedback-tutorial-spotlight"
        style={{
          top: spotlightTop,
          left: spotlightLeft,
          width: spotlightWidth,
          height: spotlightHeight,
        }}
      />

      <svg className="feedback-tutorial-arrows" viewBox={`0 0 ${viewportWidth} ${viewportHeight}`} aria-hidden="true">
        <defs>
          <marker
            id="feedback-tutorial-arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill="#7cc5ff" />
          </marker>
        </defs>
        <path d={arrowPathOne} markerEnd="url(#feedback-tutorial-arrowhead)" />
        <path d={arrowPathTwo} markerEnd="url(#feedback-tutorial-arrowhead)" />
        <path d={arrowPathThree} markerEnd="url(#feedback-tutorial-arrowhead)" />
      </svg>

      <div
        className="feedback-tutorial-card"
        style={{
          top: cardTop,
          left: cardLeft,
          width: cardWidth,
        }}
      >
        <p className="feedback-tutorial-kicker">New Feedback Button</p>
        <p className="feedback-tutorial-copy">
          Have an idea or issue? Easily submit feedback here!
        </p>
        <p className={`feedback-tutorial-hint${dismissUnlocked ? ' is-visible' : ''}`}>
          {dismissHint}
        </p>
      </div>
    </div>
  );
}

export default FeedbackTutorialOverlay;
