"use client";

import { useEffect, useMemo, useState } from "react";
import { DataSourceError, getDataSource, isLiveMode } from "../../lib/datasource";
import { formatUsdc, impliedPct } from "../../lib/format";
import type { PantaMarket, PrimaryBuyBuild, PrimaryBuyQuote, Side } from "../../../src/types";

/** Strict USDC amount: digits with up to 6 decimals, positive. */
const STRICT_AMOUNT = /^\d+(\.\d{1,6})?$/;

export default function LabPage() {
  const [markets, setMarkets] = useState<PantaMarket[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  const [marketId, setMarketId] = useState("");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState("20.00");
  const [wallet, setWallet] = useState("");
  const [quote, setQuote] = useState<PrimaryBuyQuote | null>(null);
  const [build, setBuild] = useState<PrimaryBuyBuild | null>(null);
  const [busy, setBusy] = useState<"quote" | "build" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Primary quotes require an open primary market. The live catalog reports
  // open primary markets with status "open"; the sandbox fixture uses
  // "primary". Secondary, resolved, and cancelled markets are excluded.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    getDataSource()
      .listMarkets({ signal: controller.signal, timeoutMs: 15_000, retryAttempts: 2 })
      .then((rows) => {
        if (cancelled) return;
        const quotable = rows.filter(
          (m) => m.phase === "primary" && (m.status === "open" || m.status === "primary") && !m.resolved
        );
        setMarkets(quotable);
        setMarketId(quotable[0]?.marketId ?? "");
        setMarketsLoading(false);
      })
      .catch((e) => {
        if (cancelled || (e instanceof DataSourceError && e.code === "CANCELLED")) return;
        setMarketsError(e instanceof Error ? e.message : "Failed to load markets.");
        setMarketsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const selected = useMemo(() => markets.find((m) => m.marketId === marketId), [markets, marketId]);

  const runQuote = async () => {
    setError(null);
    setBuild(null);
    if (!marketId) {
      setError("Pick a market first.");
      return;
    }
    if (!STRICT_AMOUNT.test(amount) || !(parseFloat(amount) > 0)) {
      setError("Amount must be a plain positive USDC number, e.g. 20.00.");
      return;
    }
    setBusy("quote");
    try {
      const q = await getDataSource().primaryQuote(
        { marketId, side, amountUsdc: amount, wallet: wallet.trim() || "paper-trader" },
        { timeoutMs: 15_000, retryAttempts: 2 }
      );
      setQuote(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote failed.");
    } finally {
      setBusy(null);
    }
  };

  const runBuild = async () => {
    if (!quote || busy) return;
    // Quotes live ~90 seconds; refuse to build on a stale one.
    if (quote.expiresAt && Date.now() > new Date(quote.expiresAt).getTime()) {
      setError("Quote expired. Get a fresh quote before building.");
      return;
    }
    setError(null);
    setBusy("build");
    try {
      const b = await getDataSource().primaryBuild(
        quote,
        wallet.trim() || "paper-trader",
        { timeoutMs: 15_000, retryAttempts: 2 }
      );
      setBuild(b);
    } catch (e) {
      // Audit: the quote, the wallet, and the exact failure reason stay visible.
      setError(e instanceof Error ? e.message : "Build failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="panel">
        <h2>Paper-trade lab</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          This walks the Panta write pipeline, quote then build, against the{" "}
          {isLiveMode() ? "live" : "mock"} data source, and stops before any
          signature. What you see below is exactly what a wallet would be asked
          to sign: expected shares, fee, slippage inputs, and the unsigned
          instructions. Nothing here broadcasts or moves funds.
        </p>
        {marketsLoading && <p className="muted">Loading quotable markets...</p>}
        {marketsError && <p className="neg">{marketsError}</p>}
        {!marketsLoading && !marketsError && markets.length === 0 && (
          <p className="muted">No open primary markets available for quoting right now.</p>
        )}
        {!marketsLoading && !marketsError && markets.length > 0 && (
          <div className="grid-2">
            <div>
              <label className="field">
                <span>Market (open primary only)</span>
                <select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
                  {markets.map((m) => (
                    <option key={m.marketId} value={m.marketId}>
                      {m.title} ({impliedPct(m.yesPrice ?? m.primaryYesPrice)} YES)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Side</span>
                <div className="side-toggle">
                  <button
                    type="button"
                    className={side === "yes" ? "sel-yes" : ""}
                    onClick={() => setSide("yes")}
                  >
                    YES
                  </button>
                  <button
                    type="button"
                    className={side === "no" ? "sel-no" : ""}
                    onClick={() => setSide("no")}
                  >
                    NO
                  </button>
                </div>
              </label>
            </div>
            <div>
              <label className="field">
                <span>Amount (USDC)</span>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="field">
                <span>Wallet (optional, paper mode)</span>
                <input
                  type="text"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="leave blank for paper mode"
                  spellCheck={false}
                />
              </label>
            </div>
          </div>
        )}
        {error && <p className="neg">{error}</p>}
        <button className="primary" onClick={runQuote} disabled={busy !== null || markets.length === 0}>
          {busy === "quote" ? "Quoting..." : "1. Get quote"}
        </button>
      </div>

      {quote && (
        <div className="panel">
          <h2>Quote result</h2>
          <dl className="kv">
            <dt>Quote ID</dt>
            <dd>{quote.quoteId}</dd>
            <dt>Market</dt>
            <dd>{selected?.title ?? quote.marketId}</dd>
            <dt>Side</dt>
            <dd className={quote.side === "yes" ? "pos" : "neg"}>{quote.side.toUpperCase()}</dd>
            <dt>Deposit</dt>
            <dd>{formatUsdc(quote.amountUsdc)} USDC</dd>
            <dt>Expected shares</dt>
            <dd className="pos">{formatUsdc(quote.shares)}</dd>
            <dt>Average price</dt>
            <dd>{quote.avgPrice}</dd>
            <dt>Protocol fee</dt>
            <dd>{formatUsdc(quote.feeUsdc)} USDC</dd>
            <dt>Quote expires</dt>
            <dd>{quote.expiresAt} (quotes live ~90 seconds)</dd>
          </dl>
          <button onClick={runBuild} disabled={busy !== null}>
            {busy === "build" ? "Building..." : "2. Build unsigned transaction"}
          </button>
        </div>
      )}

      {build && (
        <div className="panel">
          <h2>Build result: unsigned instructions</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            A real wallet would sign these {build.instructions.length} instruction
            {build.instructions.length === 1 ? "" : "s"} next. This terminal stops here
            by design.
          </p>
          <dl className="kv">
            <dt>Order ID</dt>
            <dd>{build.orderId}</dd>
            <dt>Status</dt>
            <dd>{build.status}</dd>
            <dt>Bound quote</dt>
            <dd>{build.quoteId}</dd>
            <dt>Bound wallet</dt>
            <dd>{build.wallet}</dd>
            <dt>Expected shares</dt>
            <dd className="pos">{formatUsdc(build.expectedShares)}</dd>
            <dt>Recent blockhash</dt>
            <dd>{build.recentBlockhash}</dd>
            <dt>Blockhash expiry hint</dt>
            <dd>{build.blockhashExpiryHintSec}s</dd>
          </dl>
          <h2>Instructions</h2>
          <pre className="dump">{JSON.stringify(build.instructions, null, 2)}</pre>
        </div>
      )}
    </>
  );
}
