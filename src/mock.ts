/**
 * Mock fixtures for offline development and the demo. These rows mirror the
 * real catalog shapes from the docs; values are invented and clearly labeled.
 * Live mode (PANTA_API_KEY set) always uses the real API instead.
 */
import { PantaClient } from "./client.js";
import {
  ClaimBuild,
  ClaimBuildRequest,
  CreateMarketBuild,
  CreateMarketQuote,
  CreateMarketQuoteRequest,
  ListMarketsParams,
  ListMarketsResponse,
  MarketTradesResponse,
  PantaInstruction,
  PantaMarket,
  PositionsResponse,
  PrimaryBuyBuild,
  PrimaryBuyBuildRequest,
  PrimaryBuyQuote,
  PrimaryBuyQuoteRequest,
  Side,
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
    phase: "resolved",
    marketType: "standard",
    startTime: 1756339200,
    endTime: 1796064000,
    resolutionTime: 1796067600,
    region: "Global",
    resolved: true,
    status: "resolved",
    volumeUsdc: "9045.25",
    campaignId: null,
    createdByPartner: false,
    yesPrice: "0.00",
    noPrice: "1.00",
    primaryYesPrice: null,
    primaryNoPrice: null,
    secondaryYesPrice: "0.00",
    secondaryNoPrice: "1.00",
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
 * A drop-in PantaClient replacement backed by fixtures. Extends the real
 * client with the API key set to a sentinel so the constructor checks pass,
 * then overrides every network method.
 */
export class MockPantaClient extends PantaClient {
  constructor() {
    super({ apiKey: "pk_test_mock_fixture_key" });
  }

  override async listMarkets(params: ListMarketsParams = {}): Promise<ListMarketsResponse> {
    let items = MOCK_MARKETS;
    if (params.category) items = items.filter((m) => m.category === params.category);
    if (params.status) items = items.filter((m) => m.status === params.status);
    // Fixtures are tiny; cursor pagination is simulated, not fully modeled.
    const limit = Math.min(params.limit ?? 20, 50);
    return { items: items.slice(0, limit), nextCursor: null };
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

  override async buildWinClaim(req: ClaimBuildRequest): Promise<ClaimBuild> {
    // Fixture: only the resolved NO position on EvtMock333 is claimable.
    const pos = MOCK_POSITIONS.positions.find(
      (p) => p.marketId === req.marketId && p.claimable && !p.claimed,
    );
    if (!pos || pos.outcome === null) {
      throw new Error(`mock: no claimable position for ${req.marketId}`);
    }
    return {
      wallet: req.wallet,
      marketId: req.marketId,
      outcome: pos.outcome as "yes" | "no",
      winningShares: pos.shares,
      instructions: [],
      derived: {},
      recentBlockhash: "MockBlockhash1111111111111111111111111111111",
      lastValidBlockHeight: 1,
    };
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
  /** Bound quote context: market, wallet, side, amount, userId, expiry. */
  private issuedQuotes = new Map<
    string,
    { quote: PrimaryBuyQuote; wallet: string; userId?: string; expiresAtMs: number }
  >();
  /** Bound create-session context: the quote wallet, per the docs' "must equal the wallet from quote". */
  private issuedCreates = new Map<
    string,
    { quote: CreateMarketQuote; wallet: string; expiresAtMs: number }
  >();

  /**
   * A market is primary-quotable only when it is an open primary market.
   * Mirrors the live API's MARKET_NOT_IN_PRIMARY rejection. The sandbox
   * fixture reports status "primary"; the documented catalog label is "open",
   * so both are accepted.
   */
  private requireQuotableMarket(marketId: string): PantaMarket {
    const m = MOCK_MARKETS.find((x) => x.marketId === marketId);
    if (
      !m ||
      m.phase !== "primary" ||
      (m.status !== "open" && m.status !== "primary") ||
      m.resolved
    ) {
      const got = m ? `phase=${m.phase} status=${m.status} resolved=${m.resolved}` : "unknown market";
      throw new Error(`mock: market ${marketId} is not an open primary market (${got})`);
    }
    return m;
  }

  /**
   * Strict USDC amount: digits with up to 6 decimals, positive. Rejects loose
   * input like "20junk" that parseFloat would silently accept.
   */
  private requireStrictAmount(amountUsdc: string): number {
    if (!/^\d+(\.\d{1,6})?$/.test(amountUsdc)) {
      throw new Error(`mock: amountUsdc must be a plain positive USDC number, got ${JSON.stringify(amountUsdc)}`);
    }
    const amount = parseFloat(amountUsdc);
    if (!(amount > 0) || !Number.isFinite(amount)) {
      throw new Error(`mock: amountUsdc must be positive, got ${JSON.stringify(amountUsdc)}`);
    }
    return amount;
  }

  /** Test hook: force a quote to expire so expiry handling can be exercised. */
  expireQuoteForTests(quoteId: string): void {
    const issued = this.issuedQuotes.get(quoteId);
    if (issued) this.issuedQuotes.set(quoteId, { ...issued, expiresAtMs: Date.now() - 1 });
  }

  /** Test hook: force a create session to expire so expiry handling can be exercised. */
  expireCreateForTests(createId: string): void {
    const issued = this.issuedCreates.get(createId);
    if (issued) this.issuedCreates.set(createId, { ...issued, expiresAtMs: Date.now() - 1 });
  }

  override async quotePrimaryBuy(req: PrimaryBuyQuoteRequest): Promise<PrimaryBuyQuote> {
    this.requireQuotableMarket(req.marketId);
    const amount = this.requireStrictAmount(req.amountUsdc);
    this.quoteSeq += 1;
    const quoteId = `qmock${this.quoteSeq}`;
    const expiresAtMs = Date.now() + PRIMARY_QUOTE_TTL_MS;
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
    this.issuedQuotes.set(quoteId, { quote, wallet: req.wallet, userId: req.userId, expiresAtMs });
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
    // The build wallet must equal the quote wallet, same as the live API.
    if (req.wallet !== issued.wallet) {
      throw new Error(
        `mock: build wallet ${req.wallet} does not match quote wallet ${issued.wallet}; request a fresh quote for this wallet`
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
    this.issuedCreates.set(createId, { quote, wallet: req.wallet, expiresAtMs });
    return quote;
  }

  override async buildCreateMarket(createId: string, wallet: string): Promise<CreateMarketBuild> {
    const issued = this.issuedCreates.get(createId);
    if (!issued) throw new Error(`mock: unknown create session ${createId}; request a fresh quote first`);
    if (Date.now() > issued.expiresAtMs) {
      this.issuedCreates.delete(createId);
      throw new Error(
        `mock: create session ${createId} expired at ${issued.quote.expiresAt}; request a fresh quote`
      );
    }
    // Per the docs: "If set, must equal the wallet from quote."
    if (wallet !== issued.wallet) {
      throw new Error(
        `mock: build wallet ${wallet} does not match quote wallet ${issued.wallet}; request a fresh quote for this wallet`
      );
    }
    const q = issued.quote;
    // The real API returns a base64-encoded unsigned VersionedTransaction.
    // This fixture carries deterministic stand-in bytes in the same shape;
    // decode it in a real wallet to see real instructions.
    const transaction = Buffer.from(`pantascope-mock-create-tx:${createId}`).toString("base64");
    return {
      createId,
      expectedEventPda: q.expectedEventPda,
      transaction,
      recentBlockhash: "MockBlockhash11111111111111111111111111111",
      lastValidBlockHeight: 312458900,
      blockhashExpiryHintSec: 60,
      buildFingerprint: "mockfp1",
      paymentUsdc: q.paymentUsdc,
      liquidityInjectionUsdc: q.liquidityInjectionUsdc,
      platformRevenueUsdc: q.platformRevenueUsdc,
      marketType: q.marketType,
      derived: {
        event: q.expectedEventPda,
        vaultAuthority: "VaultMock11111111111111111111111111111111",
        marketConfig: "CfgMock1111111111111111111111111111111111",
      },
      expiresAt: q.expiresAt,
    };
  }
}
