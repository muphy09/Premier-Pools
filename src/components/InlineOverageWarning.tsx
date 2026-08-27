import { TooltipAnchor } from './AppTooltip';

interface Props {
  overage: number;
  maximum: number;
  message?: string;
}

const formatFeet = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

function InlineOverageWarning({ overage, maximum, message }: Props) {
  if (overage <= 0) return null;

  const tooltip = message || `${formatFeet(overage)} feet over ${formatFeet(maximum)} ft maximum. Additional charges apply.`;

  return (
    <TooltipAnchor className="inline-overage-warning-anchor" tooltip={tooltip}>
      <button
        type="button"
        className="inline-overage-warning"
        aria-label={tooltip}
      >
        i
      </button>
    </TooltipAnchor>
  );
}

export default InlineOverageWarning;
