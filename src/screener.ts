#!/usr/bin/env tsx
/**
 * PantaScope screener: the first working slice.
 *
 * Live mode (vault-held Panta API key): pulls the real catalog, ranks open
 * markets by volume, shows spot prices for the top market, and summarizes its
 * public trade tape. Optionally prices a demo wallet's portfolio.
 *
 * Mock mode (--mock): same pipeline against built-in fixtures, zero network.
 *
 * Usage:
 *   tsx src/screener.ts --mock
 *   tsx src/screener.ts [--category crypto] [--limit 10] [--wallet <base58>]
 */
import { PantaClient } from "./client.js";
import { fetchAllMarkets, formatMarketLine, rankMarkets, summarizeTape } from "./markets.js";
import { MockPantaClient } from "./mock.js";
import { createLiveClient } from "./live.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const mock = process.argv.includes("--mock");
  const category = arg("--category");
  const limit = Math.min(parseInt(arg("--limit") ?? "10", 10) || 10, 50);
  const wallet = arg("--wallet");

  let client: PantaClient;
  if (mock) {
    console.log("mode: MOCK (fixture data, no network)\n");
    client = new MockPantaClient();
  } else {
    // Live mode: PANTA_API_KEY when set, otherwise the vault-held key.
    console.log("mode: LIVE (real Panta API)\n");
    client = createLiveClient();
  }

  const markets = await fetchAllMarkets(client, { category, maxPages: 3 });
  const ranked = rankMarkets(markets).slice(0, limit);

  console.log(`Top ${ranked.length} markets by volume${category ? ` in ${category}` : ""}:`);
  console.log("-".repeat(72));
  for (const s of ranked) console.log(formatMarketLine(s));

  if (ranked.length === 0) return;

  // Deep dive on the top market: spot prices plus tape stats.
  const top = ranked[0].market;
  const detail = await client.getMarket(top.marketId);
  console.log("\n" + "=".repeat(72));
  console.log(`Deep dive: ${detail.title}`);
  console.log(`phase=${detail.phase} type=${detail.marketType} resolved=${detail.resolved}`);
  console.log(
    `spot YES=${detail.yesPrice ?? "n/a"} NO=${detail.noPrice ?? "n/a"} ` +
      `(primary ${detail.primaryYesPrice ?? "n/a"}/${detail.primaryNoPrice ?? "n/a"}, ` +
      `secondary ${detail.secondaryYesPrice ?? "n/a"}/${detail.secondaryNoPrice ?? "n/a"})`
  );

  const tape = await client.getMarketTrades(detail.marketId, 50);
  const stats = summarizeTape(tape.items);
  console.log(
    `\ntape: ${stats.trades} trades, YES volume $${stats.totalYes.toFixed(2)}, ` +
      `NO volume $${stats.totalNo.toFixed(2)}, imbalance ${stats.imbalance >= 0 ? "+" : ""}${(stats.imbalance * 100).toFixed(1)}%`
  );
  if (stats.largestTrade) {
    const lt = stats.largestTrade;
    console.log(
      `largest: $${lt.amount.toFixed(2)} ${lt.side.toUpperCase()} by ${lt.wallet.slice(0, 12)}... (${lt.signature.slice(0, 16)}...)`
    );
  }

  // Optional portfolio pricing: positions times spot prices.
  if (wallet) {
    const pos = await client.listPositions(wallet);
    console.log("\n" + "=".repeat(72));
    console.log(`Portfolio for ${wallet.slice(0, 12)}... (${pos.positions.length} positions)`);
    for (const p of pos.positions) {
      let mtm = "n/a";
      try {
        if (p.phase === "resolved" && p.outcome) {
          // Resolved markets settle at $1 per winning share, $0 per loser.
          mtm = p.side === p.outcome ? `$${parseFloat(p.shares).toFixed(2)}` : "$0.00";
        } else {
          const m = await client.getMarket(p.marketId);
          const price = p.side === "yes" ? m.yesPrice : m.noPrice;
          if (price !== null) mtm = `$${(parseFloat(p.shares) * parseFloat(price)).toFixed(2)}`;
        }
      } catch {
        mtm = "market lookup failed";
      }
      console.log(
        `  ${p.side.toUpperCase().padEnd(3)} ${p.shares.padStart(12)} shares  mtm=${mtm.padStart(12)}  ` +
          `phase=${p.phase} claimable=${p.claimable} claimed=${p.claimed}`
      );
    }
  }
}

main().catch((err) => {
  console.error("screener failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
