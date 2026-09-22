/**
 * Data source indirection. Every page asks getDataSource() for its data.
 *
 * The contract is asynchronous so a network-backed proxy can replace the mock
 * with no page rewrites: pages already handle loading, timeout, error, retry,
 * and cancellation. When the /api proxy lands, this file swaps the mock
 * implementation for the proxy one; the DataSource interface does not change.
 */
import type {
  PantaMarket,
  PantaPosition,
  PantaTrade,
  PrimaryBuyBuild,
  PrimaryBuyQuote,
  Side,
} from "../../src/types";
import {
  MOCK_MARKETS,
  MOCK_POSITIONS,
  MOCK_TAPE,
  mockPrimaryBuild,
  mockPrimaryQuote,
} from "./mock";

export type DataSourceMode = "mock" | "live";

export interface DataSourceInfo {
  name: string;
  mode: DataSourceMode;
  /** ISO timestamp of the last successful refresh, null when nothing has loaded yet. */
  lastRefreshIso: string | null;
}

export interface DataSourceOptions {
  /** Cancel in-flight work. Both the mock and the future proxy honor it. */
  signal?: AbortSignal;
  /** Per-call timeout in ms. Exceeding it rejects with code TIMEOUT. */
  timeoutMs?: number;
  /** How many times to retry a timed-out call before giving up. Default 1 (no retry). */
  retryAttempts?: number;
  /** Delay between retries in ms. Default 500. */
  retryDelayMs?: number;
}

export type DataSourceErrorCode =
  | "TIMEOUT"
  | "CANCELLED"
  | "NOT_FOUND"
  | "QUOTE_REJECTED"
  | "BUILD_REJECTED"
  | "BAD_RESPONSE";

export class DataSourceError extends Error {
  readonly code: DataSourceErrorCode;

  constructor(code: DataSourceErrorCode, message: string) {
    super(message);
    this.name = "DataSourceError";
    this.code = code;
  }
}

export interface PrimaryQuoteInput {
  marketId: string;
  side: Side;
  amountUsdc: string;
  wallet: string;
  userId?: string;
}

/**
 * Async data contract. Read methods resolve catalog rows; the write pipeline
 * (primaryQuote -> primaryBuild) returns quotes and unsigned builds and never
 * signs or broadcasts. Every method honors signal cancellation and timeoutMs.
 */
export interface DataSource {
  readonly info: DataSourceInfo;
  listMarkets(opts?: DataSourceOptions): Promise<PantaMarket[]>;
  getMarket(marketId: string, opts?: DataSourceOptions): Promise<PantaMarket | undefined>;
  getTrades(marketId: string, opts?: DataSourceOptions): Promise<PantaTrade[]>;
  getPositions(wallet: string, opts?: DataSourceOptions): Promise<PantaPosition[]>;
  primaryQuote(input: PrimaryQuoteInput, opts?: DataSourceOptions): Promise<PrimaryBuyQuote>;
  primaryBuild(
    quote: PrimaryBuyQuote,
    wallet: string,
    opts?: DataSourceOptions,
  ): Promise<PrimaryBuyBuild>;
}

/** Do not retry validation rejections: they will fail the same way again. */
function isRetryable(err: unknown): boolean {
  return err instanceof DataSourceError && err.code === "TIMEOUT";
}

/**
 * Run a synchronous mock read behind the async contract: cancellation is
 * checked before and after, timeouts reject with TIMEOUT, and timed-out calls
 * retry per the options. The future /api proxy will reuse these semantics
 * around real network calls.
 */
async function guarded<T>(fn: () => T, opts: DataSourceOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const attempts = Math.max(1, opts.retryAttempts ?? 1);
  const delayMs = opts.retryDelayMs ?? 500;
  let lastErr: unknown = new DataSourceError("TIMEOUT", "data source call failed");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (opts.signal?.aborted) {
      throw new DataSourceError("CANCELLED", "data source request was cancelled");
    }
    try {
      const result = await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new DataSourceError("TIMEOUT", `data source timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DataSourceError("CANCELLED", "data source request was cancelled"));
        };
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        Promise.resolve()
          .then(fn)
          .then((v) => {
            clearTimeout(timer);
            opts.signal?.removeEventListener("abort", onAbort);
            if (opts.signal?.aborted) {
              reject(new DataSourceError("CANCELLED", "data source request was cancelled"));
            } else {
              resolve(v);
            }
          })
          .catch((e) => {
            clearTimeout(timer);
            opts.signal?.removeEventListener("abort", onAbort);
            reject(e);
          });
      });
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** Map mock-layer validation errors onto typed data-source errors. */
function wrapWriteError(err: unknown, quoteOp: boolean): never {
  const message = err instanceof Error ? err.message : String(err);
  throw new DataSourceError(
    quoteOp ? "QUOTE_REJECTED" : "BUILD_REJECTED",
    message,
  );
}

const mockSource: DataSource = {
  info: { name: "mock", mode: "mock", lastRefreshIso: null },

  async listMarkets(opts) {
    const rows = await guarded(() => [...MOCK_MARKETS], opts);
    mockSource.info.lastRefreshIso = new Date().toISOString();
    return rows;
  },

  async getMarket(marketId, opts) {
    const m = await guarded(() => MOCK_MARKETS.find((x) => x.marketId === marketId), opts);
    mockSource.info.lastRefreshIso = new Date().toISOString();
    return m;
  },

  async getTrades(marketId, opts) {
    const rows = await guarded(() => MOCK_TAPE.filter((t) => t.marketId === marketId), opts);
    mockSource.info.lastRefreshIso = new Date().toISOString();
    return rows;
  },

  async getPositions(wallet, opts) {
    const rows = await guarded(() => (wallet.trim() ? [...MOCK_POSITIONS] : []), opts);
    mockSource.info.lastRefreshIso = new Date().toISOString();
    return rows;
  },

  async primaryQuote(input, opts) {
    try {
      const q = await guarded(
        () => mockPrimaryQuote(input.marketId, input.side, input.amountUsdc, input.wallet),
        opts,
      );
      mockSource.info.lastRefreshIso = new Date().toISOString();
      return q;
    } catch (err) {
      if (err instanceof DataSourceError) throw err;
      wrapWriteError(err, true);
    }
  },

  async primaryBuild(quote, wallet, opts) {
    try {
      const b = await guarded(() => mockPrimaryBuild(quote, wallet), opts);
      mockSource.info.lastRefreshIso = new Date().toISOString();
      return b;
    } catch (err) {
      if (err instanceof DataSourceError) throw err;
      wrapWriteError(err, false);
    }
  },
};

export function getDataSource(): DataSource {
  return mockSource;
}
