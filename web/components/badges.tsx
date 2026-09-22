import type { MarketPhase, Side } from "../../src/types";

export function PhaseBadge({ phase }: { phase: MarketPhase }) {
  return <span className={`badge badge-${phase}`}>{phase}</span>;
}

export function SideBadge({ side }: { side: Side }) {
  return <span className={`badge badge-${side}`}>{side.toUpperCase()}</span>;
}

export function ClaimableBadge() {
  return <span className="badge badge-claim">claimable</span>;
}
