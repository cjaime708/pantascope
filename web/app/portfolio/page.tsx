"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClaimableBadge, PhaseBadge, SideBadge } from "../../components/badges";
import { DataSourceError, getDataSource } from "../../lib/datasource";
import { formatUsdc, impliedPct } from "../../lib/format";
import type { PantaMarket, PantaPosition } from "../../../src/types";

interface PositionRow {
  p: PantaPosition;
  m: PantaMarket | undefined;
  /** Resolved when the market resolved; winners are worth 1.00/share, losers 0. */
  resolved: boolean;
  winner: boolean;
  priceStr: string;
  mtm: number | null;
}

function buildRow(p: PantaPosition, m: PantaMarket | undefined): PositionRow {
  const shares = parseFloat(p.shares) || 0;
  const resolved = !!m?.resolved && p.outcome !== null;
  const winner = resolved && p.side === p.outcome;
  if (resolved) {
    const mtm = winner ? shares * 1 : 0;
    return {
      p,
      m,
      resolved,
      winner,
      priceStr: winner ? "100% (resolved winner)" : "0% (resolved loser)",
      mtm,
    };
  }
  const price =
    p.side === "yes"
      ? (m?.yesPrice ?? m?.primaryYesPrice ?? m?.secondaryYesPrice)
      : (m?.noPrice ?? m?.primaryNoPrice ?? m?.secondaryNoPrice);
  const px = price === null || price === undefined ? NaN : parseFloat(price);
  return {
    p,
    m,
    resolved,
    winner: false,
    priceStr: impliedPct(price ?? null),
    mtm: Number.isNaN(px) ? null : shares * px,
  };
}

export default function PortfolioPage() {
  const [wallet, setWallet] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (submitted === null) return;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const ds = getDataSource();
        const positions = await ds.getPositions(submitted, {
          signal: controller.signal,
          timeoutMs: 15_000,
          retryAttempts: 2,
        });
        const withMarkets = await Promise.all(
          positions.map(async (p) => buildRow(p, await ds.getMarket(p.marketId, { signal: controller.signal })))
        );
        if (!cancelled) {
          setRows(withMarkets);
          setLoading(false);
        }
      } catch (e) {
        if (cancelled || (e instanceof DataSourceError && e.code === "CANCELLED")) return;
        setError(e instanceof Error ? e.message : "Failed to load positions.");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [submitted]);

  // Outstanding value excludes already-claimed payouts: those are realized,
  // not claimable. Claimed rows are shown separately below.
  const outstanding = rows.filter((r) => !r.p.claimed);
  const claimedRows = rows.filter((r) => r.p.claimed);
  const totalMtm = outstanding.reduce((s, r) => s + (r.mtm ?? 0), 0);
  const totalClaimed = claimedRows.reduce((s, r) => s + (r.mtm ?? 0), 0);
  const claimable = outstanding.filter((r) => r.p.claimable && r.winner);

  return (
    <>
      <div className="panel">
        <h2>Portfolio tracker</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Paste any Solana wallet to see its Panta positions: shares, side, phase, and
          mark-to-market value (open positions at spot; resolved winners at full value,
          losers at zero). Already-claimed payouts are shown separately as realized.
          Read-only: nothing here signs or moves funds.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(wallet.trim());
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Solana wallet address (base58)"
            spellCheck={false}
          />
          <button type="submit" className="primary" style={{ whiteSpace: "nowrap" }}>
            Load positions
          </button>
        </form>
      </div>

      {submitted !== null && (
        <div className="panel">
          <h2>
            Positions for <span className="muted">{submitted}</span>
          </h2>
          {loading && <p className="muted">Loading positions...</p>}
          {error && <p className="neg">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="muted">No Panta positions found for this wallet.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              {claimable.length > 0 && (
                <p>
                  <ClaimableBadge />{" "}
                  <span className="muted">
                    {claimable.length} winning position{claimable.length > 1 ? "s" : ""} ready
                    to claim. Claim builds land in the Lab next.
                  </span>
                </p>
              )}
              <table className="data">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Side</th>
                    <th className="num">Shares</th>
                    <th>Phase</th>
                    <th className="num">Spot</th>
                    <th className="num">Mark to market</th>
                    <th>Claim</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map(({ p, m, priceStr, mtm }) => (
                    <tr key={`${p.marketId}-${p.side}`}>
                      <td>
                        {m ? (
                          <Link href={`/market/${p.marketId}`}>{m.title}</Link>
                        ) : (
                          p.marketId
                        )}
                      </td>
                      <td>
                        <SideBadge side={p.side} />
                      </td>
                      <td className="num">{parseFloat(p.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td>
                        <PhaseBadge phase={p.phase} />
                      </td>
                      <td className="num">{priceStr}</td>
                      <td className="num">
                        {mtm === null ? <span className="muted">--</span> : `${formatUsdc(mtm)} USDC`}
                      </td>
                      <td>
                        {p.claimable ? (
                          <ClaimableBadge />
                        ) : (
                          <span className="muted">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ marginBottom: 0 }}>
                Estimated portfolio value:{" "}
                <span className="pos">{formatUsdc(totalMtm)} USDC</span> (open positions
                marked at spot; resolved winners at full value, losers at zero)
              </p>
              {claimedRows.length > 0 && (
                <>
                  <h2 style={{ marginTop: 24 }}>Claimed payouts (realized)</h2>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>Side</th>
                        <th className="num">Shares</th>
                        <th className="num">Realized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claimedRows.map(({ p, m, mtm }) => (
                        <tr key={`claimed-${p.marketId}-${p.side}`}>
                          <td>
                            {m ? (
                              <Link href={`/market/${p.marketId}`}>{m.title}</Link>
                            ) : (
                              p.marketId
                            )}
                          </td>
                          <td>
                            <SideBadge side={p.side} />
                          </td>
                          <td className="num">{parseFloat(p.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                          <td className="num pos">
                            {mtm === null ? <span className="muted">--</span> : `${formatUsdc(mtm)} USDC`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Already claimed: <span className="pos">{formatUsdc(totalClaimed)} USDC</span>{" "}
                    paid out, not counted in the estimated value above.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
