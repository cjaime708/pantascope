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
  CreateMarketBuild,
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
  /** Pass true when apiKey is a signup JWT access token (sent as Authorization: Bearer). */
  apiKeyIsJwt?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  /** Optional attribution id sent as X-User-Id on every request. */
  userId?: string;
}

export class PantaClient {
  private readonly apiKey: string;
  private readonly apiKeyIsJwt: boolean;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userId?: string;

  constructor(opts: PantaClientOptions) {
    if (!opts.apiKey) {
      throw new Error("PantaClient needs an API key. Set PANTA_API_KEY (see README).");
    }
    this.apiKey = opts.apiKey;
    this.apiKeyIsJwt = opts.apiKeyIsJwt ?? false;
    this.baseUrl = (opts.baseUrl ?? PANTA_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.userId = opts.userId;
  }

  private headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = this.apiKeyIsJwt
      ? { Authorization: `Bearer ${this.apiKey}` }
      : { "X-Api-Key": this.apiKey };
    if (hasBody) h["Content-Type"] = "application/json";
    if (this.userId) h["X-User-Id"] = this.userId;
    return h;
  }

  protected async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    // Trailing slashes are required by the API, but only on the pathname:
    // appending "/" after a query string corrupts the last parameter.
    const [pathname, query] = path.split("?", 2);
    const normalized = (pathname.endsWith("/") ? pathname : `${pathname}/`) + (query ? `?${query}` : "");
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
      let parsedJson = false;
      if (text) {
        try {
          json = JSON.parse(text);
          parsedJson = true;
        } catch {
          parsedJson = false;
        }
      }
      if (!res.ok) {
        const body = (json ?? null) as PantaApiErrorBody | null;
        const code = body && typeof body.code === "string" ? body.code : `HTTP_${res.status}`;
        const message =
          body && typeof body.message === "string" ? body.message : res.statusText || "request failed";
        throw new PantaError(code, message, res.status, body);
      }
      if (!parsedJson) {
        // A 2xx with an empty or non-JSON body is a malformed response, not a
        // null result. Fail loudly so callers never act on a typed null.
        throw new PantaError(
          "BAD_RESPONSE",
          `Panta API returned HTTP ${res.status} with an empty or non-JSON body`,
          res.status,
          null,
        );
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

  /** Category allowlist for create and list filters (GET /categories/). */
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

  /**
   * Build the unsigned versioned transaction for a quoted market creation.
   * Returns a base64-encoded unsigned VersionedTransaction (see
   * CreateMarketBuild): decode it in your own wallet, sign there, broadcast
   * there. Per the docs, `wallet` must equal the wallet from the quote.
   */
  async buildCreateMarket(createId: string, wallet: string): Promise<CreateMarketBuild> {
    return this.post<CreateMarketBuild>("/markets/create/build/", { createId, wallet });
  }

  /** Build unsigned claim_win_usdc instructions for a resolved market. */
  async buildWinClaim(req: ClaimBuildRequest): Promise<ClaimBuild> {
    return this.post<ClaimBuild>("/claim/build/", req);
  }
}
