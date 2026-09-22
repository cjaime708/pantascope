# Code review request: PantaScope

## What this is
PantaScope is a demo entry for the Panta hackathon bounty (AI agent trading tools on Panta, a Solana prediction-market API). It has two parts:

1. A TypeScript lab (`src/`) that rehearses the Panta write flow: quote -> build -> inspect unsigned instructions. It NEVER signs or broadcasts. The demo stops at unsigned instructions by design, because the bounty has no testnet and market creation costs real USDC.
2. A Next.js 14 terminal UI (`web/`) with screener, market deep-dive, portfolio, and lab pages. Currently on mock data; a live /api proxy is planned for week 2-3.

## API facts (verified)
- Base: https://live-api.panta.market/api/v1. Auth: X-Api-Key header.
- Every path needs its trailing slash or the API rejects it (verified live).
- Endpoints verified live with a pk_test_ key: GET /markets/ (returns {items:[...]}), GET /markets/catalog, GET /account/, POST /primaryorderquote/, POST /primaryorderbuild/. Test keys hit Panta's sandbox fixtures, not mainnet data (documented behavior).
- Quote/build shapes in src/types.ts were written from the official docs, not all verified live.

## What changed most recently (focus here)
- src/live.ts (NEW): VaultPantaClient extends PantaClient and overrides request() to shell out to a Python skill CLI (~/workspace/skills/panta/bin/panta_cli.py), which attaches the API key via an authd surrogate exchange. The raw key never appears in this repo, env vars, or logs. Check: is the override sound? Is the dummy apiKey truly never sent? Is error handling adequate?
- src/lab.ts: added --live mode (lists markets, runs the primary-buy rehearsal against the sandbox).
- src/client.ts: request() changed from private to protected to allow the override.

## Review scope
1. Correctness of the typed client: endpoint paths, trailing-slash handling, request/response shapes vs the documented Panta API. Flag any shape we assert that the docs do not support.
2. Logic bugs in lab.ts, screener.ts, mock.ts, and the web pages.
3. Security: key handling in live.ts and the skill CLI pattern. Anything that could leak the key or let the lab sign/broadcast.
4. Fit for a hackathon demo: does the read-only / unsigned-instruction story hold up? Anything that would embarrass us in front of judges.

## Output format (strict)
- First line: `Verdict: PASS` or `Verdict: PASS WITH FIXES` or `Verdict: FAIL`.
- Then findings ordered by severity: BLOCKER, MAJOR, MINOR. One line each, with file:line references.
- Then a short summary paragraph.
- Total under 1500 words. Review only: do not rewrite code, do not invent file contents you were not given.

## Code


===== FILE: src/client.ts =====
/**
 * Typed REST client for the Panta API.
 *
 * Base URL: https://live-api.panta.market/api/v1 (from the official docs).
 * Auth: X-Api-Key (pk_test_... or pk_live_...) or Authorization: Bearer <access>.
 * Every path needs its trailing slash or the API rejects it.
 *
 * This client never signs or broadcasts anything. It only talks to the Panta
 * API. Quotes and builds return data or unsigned instructions; the wallet
 * owner is always the one who signs and broadcasts.
 */
import {
  ClaimBuild,
  ClaimBuildRequest,
  CreateMarketQuote,
  CreateMarketQuoteRequest,
  ListMarketsParams,
  ListMarketsResponse,
  MarketTradesResponse,
  PantaApiErrorBody,
  PantaMarket,
  PositionsResponse,
  PrimaryBuyBuild,
  PrimaryBuyBuildRequest,
  PrimaryBuyQuote,
  PrimaryBuyQuoteRequest,
} from "./types.js";

export const PANTA_BASE_URL = "https://live-api.panta.market/api/v1";

export class PantaError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly body: PantaApiErrorBody | null;

  constructor(code: string, message: string, httpStatus: number, body: PantaApiErrorBody | null) {
    super(`Panta API error [${code}] (HTTP ${httpStatus}): ${message}`);
    this.name = "PantaError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

export interface PantaClientOptions {
  /** API key (pk_test_... / pk_live_...) or a signup JWT access token. */
  apiKey: string;
  /** Pass false when apiKey is a JWT access token. */
  apiKeyIsBearer?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  /** Optional attribution id sent as X-User-Id on every request. */
  userId?: string;
}

export class PantaClient {
  private readonly apiKey: string;
  private readonly apiKeyIsBearer: boolean;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userId?: string;

  constructor(opts: PantaClientOptions) {
    if (!opts.apiKey) {
      throw new Error("PantaClient needs an API key. Set PANTA_API_KEY (see README).");
    }
    this.apiKey = opts.apiKey;
    this.apiKeyIsBearer = opts.apiKeyIsBearer ?? true;
    this.baseUrl = (opts.baseUrl ?? PANTA_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.userId = opts.userId;
  }

  private headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = this.apiKeyIsBearer
      ? { "X-Api-Key": this.apiKey }
      : { Authorization: `Bearer ${this.apiKey}` };
    if (hasBody) h["Content-Type"] = "application/json";
    if (this.userId) h["X-User-Id"] = this.userId;
    return h;
  }

  protected async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    // Trailing slashes are required by the API.
    const normalized = path.endsWith("/") ? path : `${path}/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${normalized}`, {
        method: init.method ?? "GET",
        headers: this.headers(init.body !== undefined),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const body = (json ?? null) as PantaApiErrorBody | null;
        const code = body && typeof body.code === "string" ? body.code : `HTTP_${res.status}`;
        const message =
          body && typeof body.message === "string" ? body.message : res.statusText || "request failed";
        throw new PantaError(code, message, res.status, body);
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  // ------------------------------------------------------------------
  // Read-only: markets catalog
  // ------------------------------------------------------------------

  /** Paginated USDC market catalog. List rows come from the registry, not a live chain scan. */
  async listMarkets(params: ListMarketsParams = {}): Promise<ListMarketsResponse> {
    const q = new URLSearchParams();
    if (params.category) q.set("category", params.category);
    if (params.status) q.set("status", params.status);
    if (params.createdBy) q.set("createdBy", params.createdBy);
    if (params.cursor) q.set("cursor", params.cursor);
    q.set("limit", String(Math.min(params.limit ?? 20, 50)));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.get<ListMarketsResponse>(`/markets/${suffix}`);
  }

  /** Single market with spot prices when RPC is available. */
  async getMarket(marketId: string): Promise<PantaMarket> {
    return this.get<PantaMarket>(`/markets/${marketId}/`);
  }

  /** Public trade tape for one market (not partner attribution). */
  async getMarketTrades(marketId: string, limit = 50): Promise<MarketTradesResponse> {
    return this.get<MarketTradesResponse>(`/markets/${marketId}/trades/?limit=${Math.min(limit, 200)}`);
  }

  /** Category allowlist for create and list filters. */
  async listCategories(): Promise<string[]> {
    const res = await this.get<{ categories: string[] } | string[]>("/categories/");
    return Array.isArray(res) ? res : res.categories;
  }

  /** USDC market holdings for a wallet: shares, phase, claim eligibility. */
  async listPositions(wallet: string): Promise<PositionsResponse> {
    return this.get<PositionsResponse>(`/positions/?wallet=${encodeURIComponent(wallet)}`);
  }

  // ------------------------------------------------------------------
  // Write-path planning: quote and build are free (no broadcast here).
  // The user signs with their own wallet; this client never touches keys.
  // ------------------------------------------------------------------

  /** Simulate a primary-market YES/NO fill. Opens a short-lived quote (~90s). */
  async quotePrimaryBuy(req: PrimaryBuyQuoteRequest): Promise<PrimaryBuyQuote> {
    return this.post<PrimaryBuyQuote>("/primaryorderquote/", {
      wallet: req.wallet,
      marketId: req.marketId,
      side: req.side.toLowerCase(),
      amountUsdc: req.amountUsdc,
      ...(req.userId ? { userId: req.userId } : {}),
    });
  }

  /** Build unsigned primary_order_usdc instructions from a live quote. */
  async buildPrimaryBuy(req: PrimaryBuyBuildRequest): Promise<PrimaryBuyBuild> {
    return this.post<PrimaryBuyBuild>("/primaryorderbuild/", {
      quoteId: req.quoteId,
      wallet: req.wallet,
      ...(req.userId ? { userId: req.userId } : {}),
      ...(req.maxSlippageBps !== undefined ? { maxSlippageBps: req.maxSlippageBps } : {}),
    });
  }

  /** Validate market params and return the USDC creation fee. Reserves a ~5 min session. */
  async quoteCreateMarket(req: CreateMarketQuoteRequest): Promise<CreateMarketQuote> {
    return this.post<CreateMarketQuote>("/markets/create/quote/", req);
  }

  /** Build the unsigned versioned transaction for a quoted market creation. */
  async buildCreateMarket(createId: string, wallet: string): Promise<unknown> {
    return this.post<unknown>("/markets/create/build/", { createId, wallet });
  }

  /** Build unsigned claim_win_usdc instructions for a resolved market. */
  async buildWinClaim(req: ClaimBuildRequest): Promise<ClaimBuild> {
    return this.post<ClaimBuild>("/claim/build/", req);
  }
}


===== FILE: src/types.ts =====
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
  status?: MarketPhase;
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
  outcome: "YES" | "NO";
  winningShares: string;
  instructions: PantaInstruction[];
  derived: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}


===== FILE: src/mock.ts =====
/**
 * Mock fixtures for offline development and the demo. These rows mirror the
 * real catalog shapes from the docs; values are invented and clearly labeled.
 * Live mode (PANTA_API_KEY set) always uses the real API instead.
 */
import { PantaClient } from "./client.js";
import {
  CreateMarketQuote,
  CreateMarketQuoteRequest,
  ListMarketsResponse,
  MarketTradesResponse,
  PantaInstruction,
  PantaMarket,
  PositionsResponse,
  PrimaryBuyBuild,
  PrimaryBuyBuildRequest,
  PrimaryBuyQuote,
  PrimaryBuyQuoteRequest,
} from "./types.js";

const MOCK_MARKETS: PantaMarket[] = [
  {
    marketId: "EvtMock1111111111111111111111111111111111",
    category: "crypto",
    title: "Will SOL close above $250 on Oct 31, 2026?",
    description: "Resolves YES if the CoinGecko daily close for SOL is above $250 on 2026-10-31.",
    images: ["https://example.com/mock/sol.png"],
    phase: "primary",
    marketType: "standard",
    startTime: 1758931200,
    endTime: 1793481600,
    resolutionTime: 1793485200,
    region: "Global",
    resolved: false,
    status: "open",
    volumeUsdc: "48210.50",
    campaignId: null,
    createdByPartner: false,
    yesPrice: "0.62",
    noPrice: "0.38",
    primaryYesPrice: "0.62",
    primaryNoPrice: "0.38",
    secondaryYesPrice: null,
    secondaryNoPrice: null,
  },
  {
    marketId: "EvtMock2222222222222222222222222222222222",
    category: "sports",
    title: "Will the home team win the championship final?",
    description: "Resolves YES if the home team wins the final on 2026-11-15.",
    images: ["https://example.com/mock/final.png"],
    phase: "primary",
    marketType: "breaking",
    startTime: 1758931200,
    endTime: 1792176000,
    resolutionTime: 1792179600,
    region: "Global",
    resolved: false,
    status: "open",
    volumeUsdc: "12880.00",
    campaignId: null,
    createdByPartner: false,
    yesPrice: "0.44",
    noPrice: "0.56",
    primaryYesPrice: "0.44",
    primaryNoPrice: "0.56",
    secondaryYesPrice: null,
    secondaryNoPrice: null,
  },
  {
    marketId: "EvtMock3333333333333333333333333333333333",
    category: "politics",
    title: "Will the rate decision land above 4%?",
    description: "Resolves from the published policy rate after the December meeting.",
    images: ["https://example.com/mock/rates.png"],
    phase: "secondary",
    marketType: "standard",
    startTime: 1756339200,
    endTime: 1796064000,
    resolutionTime: 1796067600,
    region: "Global",
    resolved: false,
    status: "open",
    volumeUsdc: "9045.25",
    campaignId: null,
    createdByPartner: false,
    yesPrice: "0.71",
    noPrice: "0.29",
    primaryYesPrice: null,
    primaryNoPrice: null,
    secondaryYesPrice: "0.71",
    secondaryNoPrice: "0.29",
  },
];

const MOCK_TRADES: Record<string, MarketTradesResponse> = {
  EvtMock1111111111111111111111111111111111: {
    marketId: "EvtMock1111111111111111111111111111111111",
    items: [
      {
        id: "t1", marketId: "EvtMock1111111111111111111111111111111111",
        wallet: "WhaleMock11111111111111111111111111111111",
        isPrimary: true, yesAmount: "5000.00", noAmount: "0",
        feePaid: "100.00", blockTime: 1759000000,
        signature: "sigMockTrade1111111111111111111111111111111", quoteAsset: "USDC",
      },
      {
        id: "t2", marketId: "EvtMock1111111111111111111111111111111111",
        wallet: "TraderMock2222222222222222222222222222222",
        isPrimary: true, yesAmount: "0", noAmount: "1200.00",
        feePaid: "24.00", blockTime: 1759003600,
        signature: "sigMockTrade2222222222222222222222222222222", quoteAsset: "USDC",
      },
      {
        id: "t3", marketId: "EvtMock1111111111111111111111111111111111",
        wallet: "TraderMock3333333333333333333333333333333",
        isPrimary: true, yesAmount: "350.00", noAmount: "0",
        feePaid: "7.00", blockTime: 1759007200,
        signature: "sigMockTrade3333333333333333333333333333333", quoteAsset: "USDC",
      },
    ],
  },
};

const MOCK_POSITIONS: PositionsResponse = {
  wallet: "DemoWalletMock1111111111111111111111111111",
  positions: [
    {
      marketId: "EvtMock1111111111111111111111111111111111",
      category: "crypto", side: "yes", shares: "8120.40",
      phase: "primary", claimable: false, claimed: false, outcome: null,
    },
    {
      marketId: "EvtMock3333333333333333333333333333333333",
      category: "politics", side: "no", shares: "410.00",
      phase: "resolved", claimable: true, claimed: false, outcome: "no",
    },
  ],
};

/** TTL of a primary-buy quote, in milliseconds (mirrors the live API). */
const PRIMARY_QUOTE_TTL_MS = 90_000;
/** TTL of a market-creation quote session, in milliseconds (mirrors the live API). */
const CREATE_SESSION_TTL_MS = 5 * 60_000;

/** The real SPL Token program id; the token transfer in the fixture is honest about its program. */
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Invented program id for the fixture Panta program. Not a real on-chain address. */
const MOCK_PANTA_PROGRAM_ID = "PantaMockProgram1111111111111111111111111111";

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString("base64");

/**
 * Three realistic unsigned instructions for a primary buy:
 * 1. transfer USDC from the buyer to the Panta vault (SPL Token program),
 * 2. execute the primary order (Panta program),
 * 3. initialize the buyer's order receipt (Panta program).
 * Data bytes are deterministic stand-ins, not real program encodings.
 */
function mockPrimaryBuyInstructions(buyer: string): PantaInstruction[] {
  const vault = "VaultMock11111111111111111111111111111111";
  const eventPda = "EvtPdaMock11111111111111111111111111111111";
  const receipt = "ReceiptMock111111111111111111111111111111";
  return [
    {
      programId: TOKEN_PROGRAM_ID,
      // SPL Token Transfer: discriminator 3, then amount as u64 little-endian.
      data: b64([3, 0, 0, 0, 0, 0x40, 0x4b, 0x4c, 0, 0, 0, 0, 0]),
      accounts: [
        { pubkey: `${buyer}TokenAcct`, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: buyer, isSigner: true, isWritable: false },
      ],
    },
    {
      programId: MOCK_PANTA_PROGRAM_ID,
      data: b64([11, 7, 0, 0, 0, 0, 0, 0, 0x40, 0x4b, 0x4c, 0, 0, 0, 0, 0]),
      accounts: [
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: receipt, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    },
    {
      programId: MOCK_PANTA_PROGRAM_ID,
      data: b64([22, 1, 0, 0, 0, 0, 0, 0]),
      accounts: [
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: receipt, isSigner: false, isWritable: true },
      ],
    },
  ];
}

/**
 * Two realistic unsigned instructions for a market creation:
 * 1. pay the creation fee in USDC to the Panta vault (SPL Token program),
 * 2. create the market event account (Panta program).
 */
function mockCreateMarketInstructions(payer: string, eventPda: string): PantaInstruction[] {
  const vault = "VaultMock11111111111111111111111111111111";
  return [
    {
      programId: TOKEN_PROGRAM_ID,
      data: b64([3, 0, 0, 0, 0, 0x80, 0xf0, 0xfa, 0x02, 0, 0, 0, 0]),
      accounts: [
        { pubkey: `${payer}TokenAcct`, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: false },
      ],
    },
    {
      programId: MOCK_PANTA_PROGRAM_ID,
      data: b64([44, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      accounts: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
      ],
    },
  ];
}

/**
 * A drop-in PantaClient replacement backed by fixtures. Extends the real
 * client with the API key set to a sentinel so the constructor checks pass,
 * then overrides every network method.
 */
export class MockPantaClient extends PantaClient {
  constructor() {
    super({ apiKey: "pk_test_mock_fixture_key" });
  }

  override async listMarkets(): Promise<ListMarketsResponse> {
    return { items: MOCK_MARKETS, nextCursor: null };
  }

  override async getMarket(marketId: string): Promise<PantaMarket> {
    const m = MOCK_MARKETS.find((x) => x.marketId === marketId);
    if (!m) throw new Error(`mock: unknown market ${marketId}`);
    return m;
  }

  override async getMarketTrades(marketId: string): Promise<MarketTradesResponse> {
    return MOCK_TRADES[marketId] ?? { marketId, items: [] };
  }

  override async listCategories(): Promise<string[]> {
    return ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"];
  }

  override async listPositions(wallet: string): Promise<PositionsResponse> {
    return { ...MOCK_POSITIONS, wallet };
  }

  // ------------------------------------------------------------------
  // Write-path planning fixtures: quote -> build, with real expiry rules.
  //
  // The live API issues primary-buy quotes that last about 90 seconds and
  // market-creation sessions that last about 5 minutes. This mock enforces
  // both: build calls made with an unknown or expired quote/session throw,
  // the same way the real API rejects them. All values are invented but the
  // shapes, the TTLs, and the expiry behavior mirror the docs.
  // ------------------------------------------------------------------

  private quoteSeq = 0;
  private createSeq = 0;
  private issuedQuotes = new Map<string, { quote: PrimaryBuyQuote; expiresAtMs: number }>();
  private issuedCreates = new Map<string, { quote: CreateMarketQuote; expiresAtMs: number }>();

  override async quotePrimaryBuy(req: PrimaryBuyQuoteRequest): Promise<PrimaryBuyQuote> {
    this.quoteSeq += 1;
    const quoteId = `qmock${this.quoteSeq}`;
    const expiresAtMs = Date.now() + PRIMARY_QUOTE_TTL_MS;
    const amount = parseFloat(req.amountUsdc);
    // Deterministic demo pricing: matches the top fixture market's spot.
    const price = req.side === "yes" ? 0.62 : 0.38;
    const fee = amount * 0.02;
    const shares = (amount - fee) / price;
    const quote: PrimaryBuyQuote = {
      quoteId,
      marketId: req.marketId,
      side: req.side,
      amountUsdc: req.amountUsdc,
      shares: shares.toFixed(2),
      avgPrice: price.toFixed(4),
      feeUsdc: fee.toFixed(2),
      expiresAt: new Date(expiresAtMs).toISOString(),
      blockhashExpiryHintSec: 90,
    };
    this.issuedQuotes.set(quoteId, { quote, expiresAtMs });
    return quote;
  }

  override async buildPrimaryBuy(req: PrimaryBuyBuildRequest): Promise<PrimaryBuyBuild> {
    const issued = this.issuedQuotes.get(req.quoteId);
    if (!issued) throw new Error(`mock: unknown quote ${req.quoteId}; request a fresh quote first`);
    if (Date.now() > issued.expiresAtMs) {
      this.issuedQuotes.delete(req.quoteId);
      throw new Error(
        `mock: quote ${req.quoteId} expired at ${issued.quote.expiresAt}; request a fresh quote`
      );
    }
    const q = issued.quote;
    return {
      orderId: `omock${this.quoteSeq}`,
      quoteId: q.quoteId,
      wallet: req.wallet,
      marketId: q.marketId,
      side: q.side,
      amountUsdc: q.amountUsdc,
      expectedShares: q.shares,
      feeUsdc: q.feeUsdc,
      status: "built",
      instructions: mockPrimaryBuyInstructions(req.wallet),
      derived: {
        eventPda: "EvtPdaMock11111111111111111111111111111111",
        buyerReceipt: "ReceiptMock111111111111111111111111111111",
        usdcVault: "VaultMock11111111111111111111111111111111",
      },
      recentBlockhash: "MockBlockhash11111111111111111111111111111",
      lastValidBlockHeight: 312458900,
      expiresAt: q.expiresAt,
      blockhashExpiryHintSec: 90,
    };
  }

  override async quoteCreateMarket(req: CreateMarketQuoteRequest): Promise<CreateMarketQuote> {
    this.createSeq += 1;
    const createId = `cmock${this.createSeq}`;
    const expiresAtMs = Date.now() + CREATE_SESSION_TTL_MS;
    const quote: CreateMarketQuote = {
      createId,
      expectedEventPda: "EvtPdaMock22222222222222222222222222222222",
      // USDC base units (6 decimals): "50000000" = 50 USDC, the standard fee.
      paymentUsdc: "50000000",
      liquidityInjectionUsdc: "0",
      platformRevenueUsdc: "50000000",
      marketType: req.marketType ?? "standard",
      expiresAt: new Date(expiresAtMs).toISOString(),
      blockhashExpiryHintSec: 300,
    };
    this.issuedCreates.set(createId, { quote, expiresAtMs });
    return quote;
  }

  override async buildCreateMarket(createId: string, wallet: string): Promise<unknown> {
    const issued = this.issuedCreates.get(createId);
    if (!issued) throw new Error(`mock: unknown create session ${createId}; request a fresh quote first`);
    if (Date.now() > issued.expiresAtMs) {
      this.issuedCreates.delete(createId);
      throw new Error(
        `mock: create session ${createId} expired at ${issued.quote.expiresAt}; request a fresh quote`
      );
    }
    const q = issued.quote;
    return {
      createId,
      wallet,
      expectedEventPda: q.expectedEventPda,
      paymentUsdc: q.paymentUsdc,
      instructions: mockCreateMarketInstructions(wallet, q.expectedEventPda),
      derived: {
        eventPda: q.expectedEventPda,
        usdcVault: "VaultMock11111111111111111111111111111111",
      },
      recentBlockhash: "MockBlockhash11111111111111111111111111111",
      lastValidBlockHeight: 312458900,
      expiresAt: q.expiresAt,
    };
  }
}


===== FILE: src/markets.ts =====
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

/** Sort key for the screener: open primary markets by volume, highest first. */
export function rankMarkets(markets: PantaMarket[]): MarketSnapshot[] {
  return markets
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


===== FILE: src/screener.ts =====
#!/usr/bin/env tsx
/**
 * PantaScope screener: the first working slice.
 *
 * Live mode (needs PANTA_API_KEY): pulls the real catalog, ranks open markets
 * by volume, shows spot prices for the top market, and summarizes its public
 * trade tape. Optionally prices a demo wallet's portfolio.
 *
 * Mock mode (--mock): same pipeline against built-in fixtures, zero network.
 *
 * Usage:
 *   tsx src/screener.ts --mock
 *   PANTA_API_KEY=pk_test_... tsx src/screener.ts [--category crypto] [--limit 10] [--wallet <base58>]
 */
import "dotenv/config";
import { PantaClient } from "./client.js";
import { fetchAllMarkets, formatMarketLine, rankMarkets, summarizeTape } from "./markets.js";
import { MockPantaClient } from "./mock.js";

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
    const key = process.env.PANTA_API_KEY;
    if (!key) {
      console.error(
        "PANTA_API_KEY is not set. Run with --mock for the offline demo, or set\n" +
          "PANTA_API_KEY to a Panta API key (see README: registering is free and\n" +
          "read-only calls cost nothing)."
      );
      process.exit(1);
    }
    console.log("mode: LIVE (real Panta API)\n");
    client = new PantaClient({ apiKey: key });
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
        const m = await client.getMarket(p.marketId);
        const price = p.side === "yes" ? m.yesPrice : m.noPrice;
        if (price !== null) mtm = `$${(parseFloat(p.shares) * parseFloat(price)).toFixed(2)}`;
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


===== FILE: src/lab.ts =====
#!/usr/bin/env tsx
/**
 * PantaScope paper-trade lab: practice the full trade flow with zero risk.
 *
 * The lab walks the real planning pipeline, quote then build, and inspects
 * the unsigned instructions the API returns. It never goes further.
 *
 * NOTHING IN THIS REPO SIGNS OR BROADCASTS TRANSACTIONS. The lab stops at
 * unsigned instructions by design: there is no code path that loads a
 * private key, signs an instruction set, or submits anything to the network.
 * Turning a lab rehearsal into a real trade always happens in the user's own
 * wallet, outside this repo.
 *
 * Usage:
 *   tsx src/lab.ts --demo
 */
import "dotenv/config";
import { PantaClient } from "./client.js";
import { MockPantaClient } from "./mock.js";
import { VaultPantaClient } from "./live.js";
import {
  CreateMarketQuoteRequest,
  PantaInstruction,
  Side,
} from "./types.js";

/** The unsigned build preview for a market creation, as returned by the mock. */
export interface CreateMarketBuildPreview {
  createId: string;
  wallet: string;
  expectedEventPda: string;
  /** USDC base units as an integer string (6 decimals). */
  paymentUsdc: string;
  instructions: PantaInstruction[];
  derived: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  expiresAt: string;
}

export interface PrimaryBuyLabInput {
  wallet: string;
  marketId: string;
  side: Side;
  /** Human-readable USDC, e.g. "20.00". */
  amountUsdc: string;
}

export interface CreateMarketLabInput {
  wallet: string;
  question: string;
}

function baseUnitsToUsdc(baseUnits: string): string {
  return (parseInt(baseUnits, 10) / 1_000_000).toFixed(2);
}

/** One plain-language block describing a single unsigned instruction. */
function inspectInstruction(ix: PantaInstruction, index: number): string[] {
  const dataBytes = Buffer.from(ix.data, "base64").length;
  const signers = ix.accounts.filter((a) => a.isSigner).length;
  const writable = ix.accounts.filter((a) => a.isWritable).length;
  return [
    `  instruction ${index + 1}:`,
    `    program:  ${ix.programId}`,
    `    accounts: ${ix.accounts.length} (${signers} signer, ${writable} writable)`,
    `    data:     ${dataBytes} bytes (base64, unsigned)`,
  ];
}

function printInspection(instructions: PantaInstruction[], recentBlockhash: string, lastValidBlockHeight: number): void {
  console.log(`\nBuild returned ${instructions.length} unsigned instructions:`);
  instructions.forEach((ix, i) => inspectInstruction(ix, i).forEach((line) => console.log(line)));
  console.log(`  recent blockhash:      ${recentBlockhash}`);
  console.log(`  last valid blockheight: ${lastValidBlockHeight}`);
  console.log("\nNothing was signed. Nothing was broadcast. This was a rehearsal only.");
}

/**
 * Paper-trade a primary-market buy: quote the fill, then build and inspect
 * the unsigned instructions. Stops before signing, always.
 */
export async function runPrimaryBuyLab(client: PantaClient, input: PrimaryBuyLabInput): Promise<void> {
  console.log("=".repeat(72));
  console.log("LAB 1: primary buy rehearsal");
  console.log("=".repeat(72));
  console.log(`wallet:    ${input.wallet}`);
  console.log(`market:    ${input.marketId}`);
  console.log(`side:      ${input.side.toUpperCase()}`);
  console.log(`spend:     ${input.amountUsdc} USDC`);

  console.log("\nStep 1: quote the fill (free, expires in about 90 seconds)");
  const quote = await client.quotePrimaryBuy({
    wallet: input.wallet,
    marketId: input.marketId,
    side: input.side,
    amountUsdc: input.amountUsdc,
  });
  console.log(`  quote id:        ${quote.quoteId}`);
  console.log(`  expected shares: ${quote.shares}`);
  console.log(`  average price:   ${quote.avgPrice} USDC per share`);
  console.log(`  protocol fee:    ${quote.feeUsdc} USDC`);
  console.log(`  quote expires:   ${quote.expiresAt}`);

  console.log("\nStep 2: build the unsigned instructions from the live quote");
  const build = await client.buildPrimaryBuy({ quoteId: quote.quoteId, wallet: input.wallet });
  console.log(`  order id:        ${build.orderId}`);
  console.log(`  expected shares: ${build.expectedShares}`);
  printInspection(build.instructions, build.recentBlockhash, build.lastValidBlockHeight);
}

/**
 * Paper-trade a market creation: quote the fee, then build and inspect the
 * unsigned transaction preview. Stops before signing, always.
 */
export async function runCreateMarketLab(client: PantaClient, input: CreateMarketLabInput): Promise<void> {
  console.log("\n" + "=".repeat(72));
  console.log("LAB 2: market creation rehearsal");
  console.log("=".repeat(72));
  console.log(`wallet:   ${input.wallet}`);
  console.log(`question: ${input.question}`);

  const nowSec = Math.floor(Date.now() / 1000);
  const req: CreateMarketQuoteRequest = {
    wallet: input.wallet,
    question: input.question,
    title: input.question,
    description: "Paper-trade lab rehearsal. Not a real market.",
    resolutionRule: "Lab rehearsal only. This market is never created on chain.",
    sourcesOfTruth: ["https://example.com/lab-rehearsal"],
    category: "crypto",
    startTime: nowSec + 3600,
    endTime: nowSec + 30 * 86400,
    resolutionTime: nowSec + 31 * 86400,
    marketType: "standard",
    imageUrl: "https://example.com/lab-rehearsal.png",
    region: "Global",
  };

  console.log("\nStep 1: quote the creation fee (free, session lasts about 5 minutes)");
  const quote = await client.quoteCreateMarket(req);
  console.log(`  session id:       ${quote.createId}`);
  console.log(`  expected event:   ${quote.expectedEventPda}`);
  console.log(`  creation payment: ${baseUnitsToUsdc(quote.paymentUsdc)} USDC`);
  console.log(`  session expires:  ${quote.expiresAt}`);

  console.log("\nStep 2: build the unsigned transaction preview");
  const preview = (await client.buildCreateMarket(quote.createId, input.wallet)) as CreateMarketBuildPreview;
  console.log(`  paying:           ${baseUnitsToUsdc(preview.paymentUsdc)} USDC`);
  printInspection(preview.instructions, preview.recentBlockhash, preview.lastValidBlockHeight);
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  if (!process.argv.includes("--demo") && !live) {
    console.log("PantaScope paper-trade lab.");
    console.log("Run: tsx src/lab.ts --demo        (fixture data, no network)");
    console.log("Run: tsx src/lab.ts --live        (Panta sandbox via vault key)");
    console.log("Both modes stop at unsigned instructions. Nothing is signed.");
    return;
  }

  if (live) {
    console.log("mode: LIVE LAB (Panta sandbox via vault-held key, no signing)\n");
    const client = new VaultPantaClient();
    const wallet = "TestWallet11111111111111111111111111111111";
    const markets = await client.listMarkets();
    const market = markets.items[0];
    if (!market) {
      console.error("live lab: sandbox returned no markets");
      process.exit(1);
    }
    console.log(`sandbox market: ${market.title} (${market.marketId})\n`);
    await runPrimaryBuyLab(client, {
      wallet,
      marketId: market.marketId,
      side: "yes",
      amountUsdc: "20.00",
    });
    console.log("\n" + "=".repeat(72));
    console.log("Live lab complete. Rehearsal stopped at unsigned instructions.");
    console.log("No private keys were loaded, nothing was signed, nothing was sent.");
    return;
  }

  console.log("mode: MOCK LAB (fixture data, no network, no signing)\n");
  const client = new MockPantaClient();
  const wallet = "DemoWalletMock1111111111111111111111111111";

  await runPrimaryBuyLab(client, {
    wallet,
    marketId: "EvtMock1111111111111111111111111111111111",
    side: "yes",
    amountUsdc: "20.00",
  });

  await runCreateMarketLab(client, {
    wallet,
    question: "Will the lab demo market resolve YES?",
  });

  console.log("\n" + "=".repeat(72));
  console.log("Lab complete. Both rehearsals stopped at unsigned instructions.");
  console.log("No private keys were loaded, nothing was signed, nothing was sent.");
}

main().catch((err) => {
  console.error("lab failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});


===== FILE: src/live.ts =====
/**
 * Live Panta client that never touches the raw API key.
 *
 * The pk_test_ key lives in the Secure Vault (connector custom.panta). This
 * client shells out to the panta skill's Python CLI, which attaches the key
 * via an authd surrogate exchange. The key value never appears in this repo,
 * in environment variables, or in logs.
 *
 * Test keys hit Panta's sandbox fixtures (documented behavior), not mainnet
 * data. Nothing here signs or broadcasts; quote -> build returns unsigned
 * instructions only, same contract as the mock lab.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { PantaClient, PantaError } from "./client.js";

const execFileAsync = promisify(execFile);
const PANTA_CLI = join(homedir(), "workspace", "skills", "panta", "bin", "panta_cli.py");

export class VaultPantaClient extends PantaClient {
  constructor() {
    // Dummy value: request() is overridden below, so this key is never sent.
    super({ apiKey: "vault-managed" });
  }

  protected override async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const normalized = path.endsWith("/") ? path : `${path}/`;
    const method = (init.method ?? "GET").toLowerCase();
    const args =
      method === "post"
        ? ["post", normalized, JSON.stringify(init.body ?? {})]
        : ["get", normalized];
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("python3", [PANTA_CLI, ...args], {
        timeout: 60_000,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/HTTP (\d{3})/);
      throw new PantaError(
        m ? `HTTP_${m[1]}` : "LIVE_REQUEST_FAILED",
        `live Panta request failed: ${msg.slice(0, 300)}`,
        m ? parseInt(m[1], 10) : 0,
        null,
      );
    }
    return JSON.parse(stdout) as T;
  }
}


===== FILE: web/app/page.tsx =====
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getDataSource } from "../lib/datasource";
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
  const markets = useMemo(() => getDataSource().listMarkets(), []);
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");

  const categories = useMemo(
    () => Array.from(new Set(markets.map((m) => m.category))).sort(),
    [markets]
  );

  const rows = useMemo(() => {
    const filtered = markets.filter(
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
          </span>
        </div>
        <table className="data">
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
                  <Link href={`/market/${m.marketId}`}>{m.title}</Link>
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
        </table>
      </div>
    </>
  );
}


===== FILE: web/app/market/[id]/page.tsx =====
import Link from "next/link";
import { notFound } from "next/navigation";
import Countdown from "../../../components/Countdown";
import { PhaseBadge, SideBadge } from "../../../components/badges";
import { getDataSource } from "../../../lib/datasource";
import { formatDateTime, formatUsdc, impliedPct, shortWallet } from "../../../lib/format";

export default function MarketPage({ params }: { params: { id: string } }) {
  const ds = getDataSource();
  const market = ds.getMarket(params.id);
  if (!market) notFound();
  const tape = ds.getTrades(params.id);

  const priceRow = (label: string, yes: string | null, no: string | null) => (
    <tr>
      <td>{label}</td>
      <td className="num pos">{impliedPct(yes)}</td>
      <td className="num neg">{impliedPct(no)}</td>
    </tr>
  );

  const yesBuys = tape.filter((t) => parseFloat(String(t.yesAmount)) > 0);
  const noBuys = tape.filter((t) => parseFloat(String(t.noAmount)) > 0);
  const yesVol = yesBuys.reduce((s, t) => s + parseFloat(String(t.yesAmount)), 0);
  const noVol = noBuys.reduce((s, t) => s + parseFloat(String(t.noAmount)), 0);
  const totalTape = yesVol + noVol;
  const imbalance = totalTape > 0 ? ((yesVol - noVol) / totalTape) * 100 : 0;
  const whales = [...tape]
    .map((t) => ({
      t,
      size: Math.max(parseFloat(String(t.yesAmount)), parseFloat(String(t.noAmount))),
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);

  return (
    <>
      <p className="muted">
        <Link href="/">screener</Link> / {market.marketId}
      </p>

      <div className="panel">
        <h2>Market detail</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{market.title}</span>
          <PhaseBadge phase={market.phase} />
          <span className="badge badge-neutral">{market.category}</span>
          <span className="badge badge-neutral">{market.marketType}</span>
        </div>
        <p className="muted">{market.description}</p>
        <dl className="kv">
          <dt>Volume</dt>
          <dd>{formatUsdc(market.volumeUsdc)} USDC</dd>
          <dt>Trading ends</dt>
          <dd>{formatDateTime(market.endTime)}</dd>
          <dt>Resolution</dt>
          <dd>{formatDateTime(market.resolutionTime)}</dd>
          <dt>Region</dt>
          <dd>{market.region}</dd>
          <dt>Status</dt>
          <dd>{market.status}</dd>
        </dl>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Spot prices: primary vs secondary</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Venue</th>
                <th className="num">YES implied</th>
                <th className="num">NO implied</th>
              </tr>
            </thead>
            <tbody>
              {priceRow("Primary (bonding curve)", market.primaryYesPrice, market.primaryNoPrice)}
              {priceRow("Secondary (order book)", market.secondaryYesPrice, market.secondaryNoPrice)}
              {priceRow("Spot", market.yesPrice, market.noPrice)}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
            The catalog leaves prices empty until the detail call fills them from on-chain
            state. A gap between primary and secondary is where edge lives.
          </p>
        </div>

        <div className="panel">
          <h2>Time to resolution</h2>
          <Countdown targetUnix={market.resolutionTime} />
          <p className="muted" style={{ fontSize: 11 }}>
            Countdown runs against the market&apos;s resolution timestamp. Prices tend to
            pin toward 0 or 1 as this approaches zero.
          </p>
          <h2 style={{ marginTop: 16 }}>Tape stats</h2>
          <dl className="kv">
            <dt>Trades on tape</dt>
            <dd>{tape.length}</dd>
            <dt>YES volume</dt>
            <dd className="pos">{formatUsdc(yesVol)} USDC</dd>
            <dt>NO volume</dt>
            <dd className="neg">{formatUsdc(noVol)} USDC</dd>
            <dt>Taker imbalance</dt>
            <dd className={imbalance >= 0 ? "pos" : "neg"}>
              {imbalance >= 0 ? "+" : ""}
              {imbalance.toFixed(1)}% {imbalance >= 0 ? "YES" : "NO"} lean
            </dd>
          </dl>
        </div>
      </div>

      <div className="panel">
        <h2>Price history</h2>
        <div className="chart-placeholder">
          Price chart renders here from the public trade tape once the live API proxy is
          wired. The mock tape above is the exact input the chart will consume: every
          trade carries side, size, and block time.
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Trade tape</h2>
          {tape.length === 0 ? (
            <p className="muted">No trades on the tape for this market yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Side</th>
                  <th>Venue</th>
                  <th className="num">Size (USDC)</th>
                  <th className="num">Fee</th>
                </tr>
              </thead>
              <tbody>
                {tape.map((t) => {
                  const isYes = parseFloat(String(t.yesAmount)) > 0;
                  return (
                    <tr key={String(t.id)}>
                      <td className="muted">{shortWallet(t.wallet)}</td>
                      <td>
                        <SideBadge side={isYes ? "yes" : "no"} />
                      </td>
                      <td>{t.isPrimary ? "primary" : "secondary"}</td>
                      <td className="num">
                        {formatUsdc(isYes ? t.yesAmount : t.noAmount)}
                      </td>
                      <td className="num muted">{formatUsdc(t.feePaid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Whale watch</h2>
          {whales.length === 0 ? (
            <p className="muted">Nothing large enough to flag yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Side</th>
                  <th className="num">Size (USDC)</th>
                </tr>
              </thead>
              <tbody>
                {whales.map(({ t, size }) => (
                  <tr key={String(t.id)}>
                    <td className="muted">{shortWallet(t.wallet)}</td>
                    <td>
                      <SideBadge side={parseFloat(String(t.yesAmount)) > 0 ? "yes" : "no"} />
                    </td>
                    <td className="num">{formatUsdc(size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ fontSize: 11 }}>
            Largest single prints on the tape. Whales moving early often know something;
            whales moving late are usually chasing.
          </p>
        </div>
      </div>
    </>
  );
}


===== FILE: web/app/portfolio/page.tsx =====
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClaimableBadge, PhaseBadge, SideBadge } from "../../components/badges";
import { getDataSource } from "../../lib/datasource";
import { formatUsdc, impliedPct } from "../../lib/format";

export default function PortfolioPage() {
  const ds = useMemo(() => getDataSource(), []);
  const [wallet, setWallet] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const positions = submitted ? ds.getPositions(submitted) : [];

  const rows = positions.map((p) => {
    const m = ds.getMarket(p.marketId);
    const price =
      p.side === "yes"
        ? (m?.yesPrice ?? m?.primaryYesPrice ?? m?.secondaryYesPrice)
        : (m?.noPrice ?? m?.primaryNoPrice ?? m?.secondaryNoPrice);
    const shares = parseFloat(p.shares) || 0;
    const px = price === null || price === undefined ? NaN : parseFloat(price);
    const mtm = Number.isNaN(px) ? null : shares * px;
    return { p, m, priceStr: impliedPct(price ?? null), mtm };
  });

  const totalMtm = rows.reduce((s, r) => s + (r.mtm ?? 0), 0);
  const claimable = rows.filter((r) => r.p.claimable && !r.p.claimed);

  return (
    <>
      <div className="panel">
        <h2>Portfolio tracker</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Paste any Solana wallet to see its Panta positions: shares, side, phase, and
          mark-to-market value (shares x spot price). Winnings on resolved markets show
          up as claimable. Read-only: nothing here signs or moves funds.
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
          {rows.length === 0 ? (
            <p className="muted">No Panta positions found for this wallet.</p>
          ) : (
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
                  {rows.map(({ p, m, priceStr, mtm }) => (
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
                      <td className="num">{formatUsdc(p.shares)}</td>
                      <td>
                        <PhaseBadge phase={p.phase} />
                      </td>
                      <td className="num">{priceStr}</td>
                      <td className="num">
                        {mtm === null ? <span className="muted">--</span> : `${formatUsdc(mtm)} USDC`}
                      </td>
                      <td>
                        {p.claimable && !p.claimed ? (
                          <ClaimableBadge />
                        ) : p.claimed ? (
                          <span className="muted">claimed</span>
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
                marked at spot; resolved winners at full value)
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}


===== FILE: web/app/lab/page.tsx =====
"use client";

import { useMemo, useState } from "react";
import { getDataSource } from "../../lib/datasource";
import { formatUsdc, impliedPct } from "../../lib/format";
import type { PrimaryBuyBuild, PrimaryBuyQuote, Side } from "../../../src/types";

export default function LabPage() {
  const ds = useMemo(() => getDataSource(), []);
  const markets = useMemo(() => ds.listMarkets().filter((m) => m.phase !== "resolved" && m.phase !== "cancelled"), [ds]);

  const [marketId, setMarketId] = useState(markets[0]?.marketId ?? "");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState("20.00");
  const [wallet, setWallet] = useState("");
  const [quote, setQuote] = useState<PrimaryBuyQuote | null>(null);
  const [build, setBuild] = useState<PrimaryBuyBuild | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = markets.find((m) => m.marketId === marketId);

  const runQuote = () => {
    setError(null);
    setBuild(null);
    if (!marketId) {
      setError("Pick a market first.");
      return;
    }
    if (!(parseFloat(amount) > 0)) {
      setError("Amount must be a positive USDC number.");
      return;
    }
    setQuote(ds.primaryQuote(marketId, side, amount, wallet.trim() || "paper-trader"));
  };

  const runBuild = () => {
    if (!quote) return;
    setBuild(ds.primaryBuild(quote, wallet.trim() || "paper-trader"));
  };

  return (
    <>
      <div className="panel">
        <h2>Paper-trade lab</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          This runs the real Panta write pipeline, quote then build, and stops before
          any signature. What you see below is exactly what a wallet would be asked to
          sign: expected shares, fee, slippage inputs, and the unsigned instructions.
          Nothing here broadcasts or moves funds.
        </p>
        <div className="grid-2">
          <div>
            <label className="field">
              <span>Market</span>
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
        {error && <p className="neg">{error}</p>}
        <button className="primary" onClick={runQuote}>
          1. Get quote
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
          <button onClick={runBuild}>2. Build unsigned transaction</button>
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


===== FILE: web/app/layout.tsx =====
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PantaScope: prediction market intelligence terminal",
  description:
    "A terminal for Panta prediction markets: screener, market deep dives, portfolio tracking, and a paper-trade lab.",
};

const NAV = [
  { href: "/", label: "Screener" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/lab", label: "Lab" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand" style={{ color: "var(--green)", textDecoration: "none" }}>
            PANTASCOPE<span className="cursor" />
          </Link>
          <nav className="nav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="env-tag">mock data: live API proxy not yet wired</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
