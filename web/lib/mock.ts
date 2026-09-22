/**
 * Mock data layer for PantaScope. Every shape here mirrors the verified
 * Panta API types in ../../src/types.ts (imported as type-only, so nothing
 * leaks into the runtime bundle). Pages never touch this module directly;
 * they go through lib/datasource.ts, so swapping mock -> live API proxy is a
 * one-import change.
 *
 * No em dashes in user-facing strings (house style).
 */
import type {
  MarketPhase,
  PantaMarket,
  PantaPosition,
  PantaTrade,
  PrimaryBuyBuild,
  PrimaryBuyQuote,
  Side,
} from "../../src/types";

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

function market(
  marketId: string,
  category: string,
  title: string,
  description: string,
  phase: MarketPhase,
  volumeUsdc: string,
  prices: { yes: string | null; primaryYes: string | null; secondaryYes: string | null },
  endInDays: number,
  resolutionInDays: number,
  resolved = false,
  outcome: Side | null = null
): PantaMarket {
  const no = (v: string | null) => (v === null ? null : (1 - parseFloat(v)).toFixed(2));
  return {
    marketId,
    category,
    title,
    description,
    images: [],
    phase,
    marketType: "standard",
    startTime: NOW - 12 * DAY,
    endTime: NOW + endInDays * DAY,
    resolutionTime: NOW + resolutionInDays * DAY,
    region: "Global",
    resolved,
    status: resolved ? "resolved" : "open",
    volumeUsdc,
    campaignId: null,
    createdByPartner: false,
    yesPrice: prices.yes,
    noPrice: no(prices.yes),
    primaryYesPrice: prices.primaryYes,
    primaryNoPrice: no(prices.primaryYes),
    secondaryYesPrice: prices.secondaryYes,
    secondaryNoPrice: no(prices.secondaryYes),
  };
}

export const MOCK_MARKETS: PantaMarket[] = [
  market(
    "panta_mkt_01",
    "crypto",
    "Bitcoin above $150k by Dec 31, 2026?",
    "Resolves YES if the daily close of BTC/USD on a major spot exchange prints above $150,000 at any point before the end of 2026.",
    "secondary",
    "184230.75",
    { yes: "0.34", primaryYes: "0.31", secondaryYes: "0.34" },
    101,
    104
  ),
  market(
    "panta_mkt_02",
    "politics",
    "US Senate flips control in the 2026 midterms?",
    "Resolves YES if the party holding the Senate majority after the November 2026 general election differs from the party holding it today.",
    "primary",
    "96210.00",
    { yes: "0.58", primaryYes: "0.58", secondaryYes: null },
    45,
    52
  ),
  market(
    "panta_mkt_03",
    "sports",
    "Chiefs win Super Bowl LXI?",
    "Resolves YES if the Kansas City Chiefs win the Super Bowl for the 2026 season.",
    "secondary",
    "74115.20",
    { yes: "0.22", primaryYes: "0.25", secondaryYes: "0.22" },
    140,
    143
  ),
  market(
    "panta_mkt_04",
    "science",
    "First crewed Starship lunar landing before 2028?",
    "Resolves YES if a crewed Starship mission lands humans on the Moon before January 1, 2028.",
    "primary",
    "41208.90",
    { yes: "0.41", primaryYes: "0.41", secondaryYes: null },
    466,
    470
  ),
  market(
    "panta_mkt_05",
    "finance",
    "Fed cuts rates at least twice more in 2026?",
    "Resolves YES if the Federal Reserve lowers the target federal funds rate at two or more scheduled meetings during calendar year 2026.",
    "secondary",
    "38900.00",
    { yes: "0.67", primaryYes: "0.63", secondaryYes: "0.67" },
    101,
    108
  ),
  market(
    "panta_mkt_06",
    "entertainment",
    "Next GTA VI trailer before October?",
    "Resolves YES if Rockstar Games publishes a new Grand Theft Auto VI trailer on its official channels before October 1, 2026.",
    "primary",
    "21450.35",
    { yes: "0.73", primaryYes: "0.73", secondaryYes: null },
    10,
    14
  ),
  market(
    "panta_mkt_07",
    "world",
    "Global average temperature record set in 2026?",
    "Resolves YES if 2026 is confirmed as the warmest year on record by the major climate datasets.",
    "secondary",
    "18775.60",
    { yes: "0.52", primaryYes: "0.49", secondaryYes: "0.52" },
    101,
    130
  ),
  market(
    "panta_mkt_08",
    "crypto",
    "Ethereum flips Bitcoin in market cap in 2026?",
    "Resolves YES if ETH market capitalization exceeds BTC market capitalization at any daily close during 2026.",
    "primary",
    "12980.00",
    { yes: "0.12", primaryYes: "0.12", secondaryYes: null },
    101,
    105
  ),
  market(
    "panta_mkt_09",
    "politics",
    "Fed chair renominated for a second term?",
    "Resolves YES if the sitting Federal Reserve chair is renominated by the President for another term.",
    "resolved",
    "312040.10",
    { yes: "1.00", primaryYes: "1.00", secondaryYes: "1.00" },
    -200,
    -190,
    true,
    "yes"
  ),
  market(
    "panta_mkt_10",
    "sports",
    "World Cup final goes to penalties?",
    "Resolves YES if the 2026 FIFA World Cup final is decided by a penalty shootout.",
    "cancelled",
    "5420.00",
    { yes: null, primaryYes: null, secondaryYes: null },
    280,
    290
  ),
];

// ---------------------------------------------------------------------------
// Trade tape
// ---------------------------------------------------------------------------

const WALLETS = [
  "7xKXtg2CW87d97TXJSDpbD5jBkheTqA5a9G3kYpR4e",
  "9WzDXwB4dfm8JF7kQvN3pLm2xYhT6sRbVc1aZqWe",
  "3FjKp9LmN2vX8qWzYtR5uHsD6eGcB4aV7nM1kJ3i",
  "5GhJk2LmN9pQ8rStV4wX6yZ1aB3cD7eF2gH5jK8m",
  "2VbN4mK6jH8gF3dS1aP9oI5uY7tR3eW2qL6kJ4h",
];

let tradeSeq = 0;
function trade(
  marketId: string,
  walletIdx: number,
  isPrimary: boolean,
  side: Side,
  amount: string,
  minutesAgo: number
): PantaTrade {
  tradeSeq += 1;
  const sig = `sig${marketId.slice(-2)}${String(tradeSeq).padStart(4, "0")}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
  return {
    id: `${marketId}-t${tradeSeq}`,
    marketId,
    wallet: WALLETS[walletIdx % WALLETS.length],
    isPrimary,
    yesAmount: side === "yes" ? amount : "0",
    noAmount: side === "no" ? amount : "0",
    feePaid: (parseFloat(amount) * 0.01).toFixed(2),
    blockTime: NOW - minutesAgo * 60,
    signature: sig,
    quoteAsset: "USDC",
  };
}

const tapeSpec: Array<[string, number, boolean, Side, string, number]> = [
  ["panta_mkt_01", 0, false, "yes", "250.00", 4],
  ["panta_mkt_01", 1, false, "no", "120.50", 11],
  ["panta_mkt_01", 2, true, "yes", "500.00", 26],
  ["panta_mkt_01", 3, false, "yes", "75.25", 41],
  ["panta_mkt_01", 4, true, "no", "1000.00", 63],
  ["panta_mkt_01", 0, false, "yes", "310.00", 90],
  ["panta_mkt_01", 1, false, "no", "88.00", 130],
  ["panta_mkt_02", 2, true, "yes", "200.00", 7],
  ["panta_mkt_02", 3, true, "no", "150.00", 19],
  ["panta_mkt_02", 4, true, "yes", "420.75", 55],
  ["panta_mkt_02", 0, true, "yes", "95.00", 102],
  ["panta_mkt_03", 1, false, "no", "600.00", 9],
  ["panta_mkt_03", 2, true, "yes", "180.00", 33],
  ["panta_mkt_03", 3, false, "yes", "220.00", 71],
  ["panta_mkt_05", 4, false, "yes", "750.00", 6],
  ["panta_mkt_05", 0, true, "yes", "300.00", 22],
  ["panta_mkt_05", 1, false, "no", "410.00", 48],
  ["panta_mkt_06", 2, true, "yes", "55.00", 12],
  ["panta_mkt_06", 3, true, "yes", "130.00", 39],
  ["panta_mkt_07", 4, false, "no", "260.00", 16],
  ["panta_mkt_07", 0, true, "yes", "190.00", 58],
];

export const MOCK_TAPE: PantaTrade[] = tapeSpec.map(([m, w, p, s, a, t]) =>
  trade(m, w, p, s as Side, a, t)
);

// ---------------------------------------------------------------------------
// Positions (returned for any non-empty wallet)
// ---------------------------------------------------------------------------

export const MOCK_POSITIONS: PantaPosition[] = [
  { marketId: "panta_mkt_01", category: "crypto", side: "yes", shares: "412.50", phase: "secondary", claimable: false, claimed: false, outcome: null },
  { marketId: "panta_mkt_05", category: "finance", side: "yes", shares: "180.00", phase: "secondary", claimable: false, claimed: false, outcome: null },
  { marketId: "panta_mkt_02", category: "politics", side: "no", shares: "95.75", phase: "primary", claimable: false, claimed: false, outcome: null },
  { marketId: "panta_mkt_09", category: "politics", side: "yes", shares: "500.00", phase: "resolved", claimable: true, claimed: false, outcome: "yes" },
  { marketId: "panta_mkt_09", category: "politics", side: "no", shares: "40.00", phase: "resolved", claimable: false, claimed: false, outcome: "yes" },
  // Already-claimed winner: realized payout, shown separately from outstanding value.
  { marketId: "panta_mkt_09", category: "politics", side: "yes", shares: "250.00", phase: "resolved", claimable: false, claimed: true, outcome: "yes" },
];

// ---------------------------------------------------------------------------
// Paper-trade lab: mock quote -> build pipeline (no signing, no broadcast)
// ---------------------------------------------------------------------------

function fakeBase64(seed: string): string {
  // Browser-safe base64 (this module ships to client components, so no Node Buffer).
  const bytes = `pantascope-mock-instruction:${seed}`;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes.charCodeAt(i) & 0xff);
  return btoa(binary);
}

export function mockPrimaryQuote(
  marketId: string,
  side: Side,
  amountUsdc: string,
  wallet: string
): PrimaryBuyQuote {
  // Primary quotes require an open primary market (mirrors the live API's
  // MARKET_NOT_IN_PRIMARY rejection). The live catalog reports open primary
  // markets with status "open"; the sandbox fixture uses "primary".
  const m = MOCK_MARKETS.find((x) => x.marketId === marketId);
  if (
    !m ||
    m.phase !== "primary" ||
    (m.status !== "open" && m.status !== "primary") ||
    m.resolved
  ) {
    const got = m ? `phase=${m.phase} status=${m.status} resolved=${m.resolved}` : "unknown market";
    throw new Error(`Market ${marketId} is not an open primary market (${got}). Primary quotes are only available on open primary markets.`);
  }
  // Strict amount: reject loose input like "20junk" instead of letting
  // parseFloat silently accept it.
  if (!/^\d+(\.\d{1,6})?$/.test(amountUsdc)) {
    throw new Error(`Amount must be a plain positive USDC number, got ${JSON.stringify(amountUsdc)}.`);
  }
  const price = parseFloat(m.primaryYesPrice ?? m.yesPrice ?? "0.50");
  const effPrice = side === "yes" ? price : 1 - price;
  const amount = parseFloat(amountUsdc);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new Error(`Amount must be a positive USDC number, got ${JSON.stringify(amountUsdc)}.`);
  }
  const fee = amount * 0.01;
  const shares = effPrice > 0 ? (amount - fee) / effPrice : 0;
  const quoteId = `mockq_${Date.now().toString(36)}`;
  const expiresAtMs = Date.now() + 90_000;
  const quote: PrimaryBuyQuote = {
    quoteId,
    marketId,
    side,
    amountUsdc,
    shares: shares.toFixed(2),
    avgPrice: effPrice.toFixed(4),
    feeUsdc: fee.toFixed(2),
    expiresAt: new Date(expiresAtMs).toISOString(),
    blockhashExpiryHintSec: 90,
  };
  // Bind the full quote context so the build can reject drift.
  boundWebQuotes.set(quoteId, { quote, wallet, marketId, side, amountUsdc, expiresAtMs });
  return quote;
}

/** Bound web-quote context, keyed by quote id. */
interface BoundWebQuote {
  quote: PrimaryBuyQuote;
  wallet: string;
  marketId: string;
  side: Side;
  amountUsdc: string;
  expiresAtMs: number;
}

const boundWebQuotes = new Map<string, BoundWebQuote>();

/** Test hook: force a web quote to expire so expiry handling can be exercised. */
export function __expireWebQuoteForTests(quoteId: string): void {
  const b = boundWebQuotes.get(quoteId);
  if (b) boundWebQuotes.set(quoteId, { ...b, expiresAtMs: Date.now() - 1 });
}

export function mockPrimaryBuild(
  quote: PrimaryBuyQuote,
  wallet: string
): PrimaryBuyBuild {
  const bound = boundWebQuotes.get(quote.quoteId);
  if (!bound) {
    throw new Error(`Unknown quote ${quote.quoteId}. Get a fresh quote first.`);
  }
  if (Date.now() > bound.expiresAtMs) {
    boundWebQuotes.delete(quote.quoteId);
    throw new Error(`Quote ${quote.quoteId} expired at ${bound.quote.expiresAt}. Get a fresh quote before building.`);
  }
  // Reject drift: the build wallet, market, side, and amount must match the
  // quote they were issued for, same as the live API.
  if (wallet !== bound.wallet) {
    throw new Error(`Build wallet does not match the quote wallet. Get a fresh quote for this wallet.`);
  }
  if (
    quote.marketId !== bound.marketId ||
    quote.side !== bound.side ||
    quote.amountUsdc !== bound.amountUsdc
  ) {
    throw new Error(`Quote context changed since issuance (market, side, or amount). Get a fresh quote.`);
  }
  const prog = "DbcPr0gr4m111111111111111111111111111111111";
  return {
    orderId: `mockord_${Date.now().toString(36)}`,
    quoteId: quote.quoteId,
    wallet,
    marketId: quote.marketId,
    side: quote.side,
    amountUsdc: quote.amountUsdc,
    expectedShares: quote.shares,
    feeUsdc: quote.feeUsdc,
    status: "built_unsigned",
    instructions: [
      {
        programId: prog,
        data: fakeBase64(`${quote.quoteId}:primary-buy`),
        accounts: [
          { pubkey: wallet, isSigner: true, isWritable: true },
          { pubkey: quote.marketId, isSigner: false, isWritable: true },
        ],
      },
      {
        programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        data: fakeBase64(`${quote.quoteId}:transfer-usdc`),
        accounts: [
          { pubkey: wallet, isSigner: true, isWritable: true },
          { pubkey: "USDCv4u1111111111111111111111111111111111", isSigner: false, isWritable: true },
        ],
      },
    ],
    derived: {
      market: quote.marketId,
      side: quote.side,
      note: "Mock build. Real builds come from POST /primaryorderbuild/ via the API proxy.",
    },
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 300000000,
    expiresAt: quote.expiresAt,
    blockhashExpiryHintSec: 90,
  };
}
