/**
 * Panta API types, verified against the official docs at https://docs.panta.market
 * on 2026-09-21. Every endpoint and field below was read from the published
 * reference pages; nothing here is invented. If a field looks wrong, re-check
 * the docs page for that endpoint before "fixing" the type.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Error envelope returned by the API. Switch on `code`, not only HTTP status. */
export interface PantaApiErrorBody {
  code: string;
  message: string;
  field?: string;
  fields?: unknown;
}

export type MarketPhase = "primary" | "secondary" | "resolved" | "cancelled";
export type MarketType = "standard" | "breaking";
export type Side = "yes" | "no";

/** Category allowlist from the docs (POST /markets/create/quote/ reference). */
export const PANTA_CATEGORIES = [
  "sports",
  "crypto",
  "politics",
  "entertainment",
  "finance",
  "science",
  "world",
  "other",
] as const;
export type PantaCategory = (typeof PANTA_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Markets catalog: GET /markets/ and GET /markets/{marketId}/
// ---------------------------------------------------------------------------

/**
 * Catalog row. The list endpoint leaves the price fields null; the detail
 * endpoint fills them from on-chain state when RPC is available.
 */
export interface PantaMarket {
  marketId: string;
  category: string;
  title: string;
  description: string;
  images: string[];
  phase: MarketPhase;
  marketType: MarketType;
  /** Unix seconds. */
  startTime: number;
  /** Unix seconds. */
  endTime: number;
  /** Unix seconds. */
  resolutionTime: number;
  region: string;
  resolved: boolean;
  /** Catalog status label, e.g. "open". */
  status: string;
  /** Human-readable volume, e.g. "1200.00". */
  volumeUsdc: string;
  campaignId: string | null;
  createdByPartner: boolean;
  yesPrice: string | null;
  noPrice: string | null;
  primaryYesPrice: string | null;
  primaryNoPrice: string | null;
  secondaryYesPrice: string | null;
  secondaryNoPrice: string | null;
}

export interface ListMarketsParams {
  category?: string;
  /** Catalog status label as returned by the API, e.g. "open". */
  status?: string;
  /** Only "me" is supported: markets this API account created. */
  createdBy?: "me";
  /** Opaque marketId cursor from a previous page's nextCursor. */
  cursor?: string;
  /** Page size, max 50. Default 20. */
  limit?: number;
}

export interface ListMarketsResponse {
  items: PantaMarket[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Trade tape: GET /markets/{marketId}/trades/
// ---------------------------------------------------------------------------

export interface PantaTrade {
  id: string | number;
  marketId: string;
  wallet: string;
  isPrimary: boolean;
  yesAmount: string | number;
  noAmount: string | number;
  feePaid: string | number;
  /** Unix seconds, null when unavailable. */
  blockTime: number | null;
  signature: string;
  quoteAsset: string;
}

export interface MarketTradesResponse {
  marketId: string;
  items: PantaTrade[];
}

// ---------------------------------------------------------------------------
// Positions: GET /positions/?wallet=
// ---------------------------------------------------------------------------

export interface PantaPosition {
  marketId: string;
  category: string | null;
  side: Side;
  /** Human-readable share quantity. */
  shares: string;
  phase: MarketPhase;
  /** True when a win claim can be built for this side. */
  claimable: boolean;
  /** True when a claim account already exists. */
  claimed: boolean;
  /** "yes" / "no" after resolution, otherwise null. */
  outcome: Side | null;
}

export interface PositionsResponse {
  wallet: string;
  positions: PantaPosition[];
}

// ---------------------------------------------------------------------------
// Primary buy: POST /primaryorderquote/ and POST /primaryorderbuild/
// ---------------------------------------------------------------------------

export interface PrimaryBuyQuoteRequest {
  /** Buyer wallet (base58). */
  wallet: string;
  /** Event / market address. */
  marketId: string;
  side: Side;
  /** Deposit in human-readable USDC, e.g. "20.00". */
  amountUsdc: string;
  /** Attribution id; may also be sent as X-User-Id. */
  userId?: string;
}

export interface PrimaryBuyQuote {
  quoteId: string;
  marketId: string;
  side: Side;
  amountUsdc: string;
  /** Estimated shares received. */
  shares: string;
  /** Estimated average price. */
  avgPrice: string;
  /** Protocol fee, human-readable USDC. */
  feeUsdc: string;
  expiresAt: string;
  blockhashExpiryHintSec: number;
}

export interface PrimaryBuyBuildRequest {
  quoteId: string;
  wallet: string;
  userId?: string;
  maxSlippageBps?: number;
}

export interface PantaInstructionAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface PantaInstruction {
  programId: string;
  /** base64-encoded instruction data. */
  data: string;
  accounts: PantaInstructionAccount[];
}

export interface PrimaryBuyBuild {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: Side;
  amountUsdc: string;
  expectedShares: string;
  feeUsdc: string;
  status: string;
  instructions: PantaInstruction[];
  derived: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  expiresAt: string;
  blockhashExpiryHintSec: number;
}

// ---------------------------------------------------------------------------
// Market creation: POST /markets/create/quote/ and POST /markets/create/build/
// ---------------------------------------------------------------------------

export interface CreateMarketQuoteRequest {
  /** Fee payer and transaction signer (base58). */
  wallet: string;
  /** Market question, max 512 chars. Combined with wallet to derive the event address. */
  question: string;
  /** Resolution criteria, max 2048 chars. */
  resolutionRule: string;
  /** Non-empty list, max 20. */
  sourcesOfTruth: string[];
  category: PantaCategory;
  /** Unix seconds. Must satisfy startTime < endTime <= resolutionTime. */
  startTime: number;
  endTime: number;
  resolutionTime: number;
  marketType?: MarketType;
  /** Breaking markets only: skips the minimum start-delay check. */
  eventInProgress?: boolean;
  /** Defaults to question. */
  title?: string;
  description?: string;
  /** Catalog image URL (http/https, not localhost, max 2048 chars). Required. */
  imageUrl: string;
  /** Defaults to "Global". */
  region?: string;
}

export interface CreateMarketQuote {
  /** Session id for build and register. */
  createId: string;
  expectedEventPda: string;
  /** USDC base units as integer strings (6 decimals), e.g. "50000000" = 50 USDC. */
  paymentUsdc: string;
  liquidityInjectionUsdc: string;
  platformRevenueUsdc: string;
  marketType: MarketType;
  expiresAt: string;
  blockhashExpiryHintSec: number;
}

/**
 * POST /markets/create/build/ response, verified against the docs
 * (https://docs.panta.market/api-reference/markets/build) and a captured
 * sandbox response on 2026-09-22. The API returns a base64-encoded unsigned
 * VersionedTransaction, not a list of instructions: decode `transaction`,
 * sign with `wallet`, then broadcast. All signing happens in the user's own
 * wallet, outside this repo.
 */
export interface CreateMarketBuild {
  createId: string;
  expectedEventPda: string;
  /** Base64-encoded unsigned VersionedTransaction. */
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  blockhashExpiryHintSec: number;
  buildFingerprint: string;
  /** USDC base units as integer strings (6 decimals). */
  paymentUsdc: string;
  liquidityInjectionUsdc: string;
  platformRevenueUsdc: string;
  marketType: MarketType;
  derived: Record<string, string>;
  expiresAt: string;
  /** Present on sandbox fixtures; absent on the documented live shape. */
  disclaimer?: string;
}

// ---------------------------------------------------------------------------
// Win claim: POST /claim/build/
// ---------------------------------------------------------------------------

export interface ClaimBuildRequest {
  /** Claimant and transaction signer (base58). */
  wallet: string;
  marketId: string;
}

export interface ClaimBuild {
  wallet: string;
  marketId: string;
  /** Winning side, lowercase to match Side. */
  outcome: "yes" | "no";
  winningShares: string;
  instructions: PantaInstruction[];
  derived: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}
