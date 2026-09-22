/**
 * Read-only analytics over the Panta catalog. These are the building blocks of
 * the PantaScope terminal: everything here costs nothing to call and needs no
 * wallet, only an API key.
 */
import { PantaClient } from "./client.js";
import { PantaMarket, PantaTrade } from "./types.js";

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Fetch up to `maxPages` of the catalog and return every row. */
export async function fetchAllMarkets(
  client: PantaClient,
  params: { category?: string; status?: "primary" | "secondary" | "resolved" | "cancelled"; maxPages?: number } = {}
): Promise<PantaMarket[]> {
  const out: PantaMarket[] = [];
  let cursor: string | undefined;
  const maxPages = params.maxPages ?? 5;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.listMarkets({
      category: params.category,
      status: params.status,
      cursor,
      limit: 50,
    });
    out.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}

export interface MarketSnapshot {
  market: PantaMarket;
  /** Mid implied probability from spot prices, 0..1, null when unavailable. */
  impliedYes: number | null;
  volume: number;
}

/** Sort key for the screener: open primary markets by volume, highest first.
 * Only markets in primary phase with an "open" catalog status are ranked;
 * secondary, resolved, and cancelled rows are excluded. */
export function rankMarkets(markets: PantaMarket[]): MarketSnapshot[] {
  return markets
    .filter((m) => m.phase === "primary" && m.status === "open")
    .map((market) => {
      const y = market.yesPrice !== null ? num(market.yesPrice) : null;
      const n = market.noPrice !== null ? num(market.noPrice) : null;
      const impliedYes = y !== null && n !== null && y + n > 0 ? y / (y + n) : y;
      return { market, impliedYes, volume: num(market.volumeUsdc) };
    })
    .sort((a, b) => b.volume - a.volume);
}

export interface TapeStats {
  trades: number;
  totalYes: number;
  totalNo: number;
  /** Taker imbalance: +1 = all YES buying, -1 = all NO buying. */
  imbalance: number;
  largestTrade: { wallet: string; amount: number; side: "yes" | "no"; signature: string } | null;
  firstBlockTime: number | null;
  lastBlockTime: number | null;
}

/** Summarize a market's public trade tape into terminal-ready stats. */
export function summarizeTape(trades: PantaTrade[]): TapeStats {
  let totalYes = 0;
  let totalNo = 0;
  let largest: TapeStats["largestTrade"] = null;
  let first: number | null = null;
  let last: number | null = null;
  for (const t of trades) {
    const y = num(t.yesAmount);
    const n = num(t.noAmount);
    totalYes += y;
    totalNo += n;
    const amount = Math.max(y, n);
    const side = y >= n ? "yes" : "no";
    if (!largest || amount > largest.amount) {
      largest = { wallet: t.wallet, amount, side, signature: t.signature };
    }
    if (t.blockTime !== null) {
      first = first === null ? t.blockTime : Math.min(first, t.blockTime);
      last = last === null ? t.blockTime : Math.max(last, t.blockTime);
    }
  }
  const denom = totalYes + totalNo;
  return {
    trades: trades.length,
    totalYes,
    totalNo,
    imbalance: denom > 0 ? (totalYes - totalNo) / denom : 0,
    largestTrade: largest,
    firstBlockTime: first,
    lastBlockTime: last,
  };
}

/** One-line terminal rendering of a market row. */
export function formatMarketLine(s: MarketSnapshot): string {
  const m = s.market;
  const pct = s.impliedYes === null ? "n/a" : `${(s.impliedYes * 100).toFixed(1)}%`;
  const vol = `$${s.volume.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `[${m.phase.padEnd(9)}] ${pct.padStart(6)} YES  ${vol.padStart(12)}  ${m.title} (${m.category})`;
}
