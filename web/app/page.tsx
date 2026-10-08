"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataSourceError, getDataSource } from "../lib/datasource";
import { formatUsdc, impliedPct } from "../lib/format";
import { PhaseBadge } from "../components/badges";
import type { PantaMarket } from "../../src/types";

type SortKey = "volume" | "title" | "yesProb";
type SortDir = "asc" | "desc";

function volOf(m: PantaMarket): number {
  const n = parseFloat(m.volumeUsdc);
  return Number.isNaN(n) ? 0 : n;
}

function yesOf(m: PantaMarket): number {
  const p = m.yesPrice ?? m.primaryYesPrice ?? m.secondaryYesPrice;
  const n = p === null ? NaN : parseFloat(p);
  return Number.isNaN(n) ? -1 : n;
}

export default function ScreenerPage() {
  const [markets, setMarkets] = useState<PantaMarket[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDataSource()
      .listMarketsPage({ signal: controller.signal, timeoutMs: 15_000, retryAttempts: 2, limit: 50 })
      .then((page) => {
        if (!cancelled) {
          setMarkets(page.items);
          setNextCursor(page.nextCursor);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled || (e instanceof DataSourceError && e.code === "CANCELLED")) return;
        setError(e instanceof Error ? e.message : "Failed to load markets.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    getDataSource()
      .listMarketsPage({ timeoutMs: 15_000, retryAttempts: 2, limit: 50, cursor: nextCursor })
      .then((page) => {
        setMarkets((prev) => {
          const seen = new Set((prev ?? []).map((m) => m.marketId));
          const fresh = page.items.filter((m) => !seen.has(m.marketId));
          return [...(prev ?? []), ...fresh];
        });
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load more markets.");
        setLoadingMore(false);
      });
  };

  // The Panta list endpoint returns blank titles and zeroed stats for most
  // markets, while the detail endpoint has the real values. Backfill missing
  // titles and stats in the background (4 at a time) so the table reads
  // properly and volume sort works; rows keep the list values as fallback if
  // a detail fetch fails. Tracks processed IDs so later pages get backfilled
  // too when "load more" appends them.
  const backfilledIds = useRef(new Set<string>());
  const [titlesLoading, setTitlesLoading] = useState(false);
  useEffect(() => {
    if (!markets) return;
    const missing = markets.filter(
      (m) =>
        !backfilledIds.current.has(m.marketId) &&
        (!m.title.trim() || parseFloat(m.volumeUsdc) === 0 || m.yesPrice == null)
    );
    if (missing.length === 0) return;
    for (const m of missing) backfilledIds.current.add(m.marketId);
    setTitlesLoading(true);
    let cancelled = false;
    const ds = getDataSource();
    const queue = [...missing];
    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const m = queue.shift()!;
        try {
          const full = await ds.getMarket(m.marketId, { timeoutMs: 15_000 });
          if (!cancelled && full) {
            setMarkets((prev) =>
              prev
                ? prev.map((x) =>
                    x.marketId === m.marketId
                      ? {
                          ...x,
                          title: full.title?.trim() ? full.title : x.title,
                          volumeUsdc: full.volumeUsdc && parseFloat(full.volumeUsdc) > 0 ? full.volumeUsdc : x.volumeUsdc,
                          yesPrice: full.yesPrice ?? x.yesPrice,
                          noPrice: full.noPrice ?? x.noPrice,
                          primaryYesPrice: full.primaryYesPrice ?? x.primaryYesPrice,
                          primaryNoPrice: full.primaryNoPrice ?? x.primaryNoPrice,
                          secondaryYesPrice: full.secondaryYesPrice ?? x.secondaryYesPrice,
                          secondaryNoPrice: full.secondaryNoPrice ?? x.secondaryNoPrice,
                        }
                      : x
                  )
                : prev
            );
          }
        } catch {
          // keep the list values as fallback for this row
        }
      }
    };
    Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      if (!cancelled) setTitlesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [markets]);

  const categories = useMemo(
    () => Array.from(new Set((markets ?? []).map((m) => m.category))).sort(),
    [markets]
  );

  const rows = useMemo(() => {
    const list = markets ?? [];
    const filtered = list.filter(
      (m) =>
        (phaseFilter === "all" || m.phase === phaseFilter) &&
        (catFilter === "all" || m.category === catFilter)
    );
    const keyFn =
      sortKey === "volume" ? volOf : sortKey === "title" ? (m: PantaMarket) => m.title : yesOf;
    return [...filtered].sort((a, b) => {
      const va = keyFn(a);
      const vb = keyFn(b);
      const cmp =
        typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [markets, sortKey, sortDir, phaseFilter, catFilter]);

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ^" : " v") : "");

  return (
    <>
      <div className="panel">
        <h2>Market screener</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Every Panta market in one table, ranked by volume. Click a column header to sort.
          Implied probability comes from the YES spot price.
        </p>
        {loading && <p className="muted">Loading markets...</p>}
        {error && (
          <p className="neg">
            {error}{" "}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setLoading(true);
                const c = new AbortController();
                getDataSource()
                  .listMarkets({ signal: c.signal, timeoutMs: 15_000, retryAttempts: 2 })
                  .then((r) => {
                    setMarkets(r);
                    setLoading(false);
                  })
                  .catch((e) => {
                    setError(e instanceof Error ? e.message : "Failed to load markets.");
                    setLoading(false);
                  });
              }}
            >
              Retry
            </button>
          </p>
        )}
        {!loading && !error && (
          <>
            <div className="toolbar">
              <label className="field">
                <span>Phase</span>
                <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
                  <option value="all">all phases</option>
                  <option value="primary">primary</option>
                  <option value="secondary">secondary</option>
                  <option value="resolved">resolved</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </label>
              <label className="field">
                <span>Category</span>
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                  <option value="all">all categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {rows.length} markets
                {titlesLoading ? " · filling in details…" : ""}
              </span>
            </div>
            <div className="table-wrap"><table className="data">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggle("title")}>
                    Title{arrow("title")}
                  </th>
                  <th>Category</th>
                  <th>Phase</th>
                  <th className="sortable num" onClick={() => toggle("volume")}>
                    Volume (USDC){arrow("volume")}
                  </th>
                  <th className="sortable num" onClick={() => toggle("yesProb")}>
                    YES implied{arrow("yesProb")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.marketId}>
                    <td>
                      {m.title.trim() ? (
                        <Link href={`/market/${m.marketId}`}>{m.title}</Link>
                      ) : (
                        <Link
                          href={`/market/${m.marketId}`}
                          className="muted"
                          style={{ fontStyle: "italic" }}
                        >
                          Untitled market
                        </Link>
                      )}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {m.marketId}
                      </div>
                    </td>
                    <td>{m.category}</td>
                    <td>
                      <PhaseBadge phase={m.phase} />
                    </td>
                    <td className="num">{formatUsdc(m.volumeUsdc)}</td>
                    <td className="num">{impliedPct(m.yesPrice ?? m.primaryYesPrice ?? m.secondaryYesPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
              {nextCursor ? (
                <button type="button" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more markets"}
                </button>
              ) : (
                markets !== null && !loading && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Showing all {markets.length} markets
                  </span>
                )
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
