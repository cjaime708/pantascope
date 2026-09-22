#!/usr/bin/env tsx
/**
 * Contract tests for the Panta client and the mock quote/build pipeline.
 *
 * Run: npx tsx src/contract-tests.ts   (also wired as `npm run contract-tests`)
 *
 * Covers:
 *  - quote expiry is enforced (mock rejects stale quotes)
 *  - wallet binding: build rejects a wallet that differs from the quote wallet
 *  - phase eligibility: secondary / resolved / unknown markets are rejected
 *  - strict amounts: loose input like "20junk" is rejected
 *  - malformed 2xx responses raise a typed BAD_RESPONSE (not a silent null)
 *  - the categories endpoint hits GET /categories/
 *  - repeated builds on one quote succeed with the same bound context
 *  - captured sandbox responses (src/__fixtures__/captured/*.json) parse into
 *    the documented shapes the client consumes
 *
 * The suite runs against the mock client. The same checks apply to the live
 * client; re-point newClient() at createLiveClient() to run them against the
 * sandbox (needs the vault-held key, so that stays a manual step).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockPantaClient } from "./mock.js";
import { PantaClient, PantaError } from "./client.js";
import { CreateMarketBuild, PrimaryBuyBuild, PrimaryBuyQuote } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "__fixtures__", "captured");

const OPEN_PRIMARY = "EvtMock1111111111111111111111111111111111";
const RESOLVED = "EvtMock3333333333333333333333333333333333";
const WALLET_A = "BuyerA1111111111111111111111111111111111";
const WALLET_B = "BuyerB2222222222222222222222222222222222";

interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void>): void {
  tests.push({ name, fn });
}
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

async function expectReject(p: Promise<unknown>, needle: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes(needle)) return;
    throw new Error(`rejected, but message ${JSON.stringify(m)} lacks ${JSON.stringify(needle)}`);
  }
  throw new Error(`expected rejection containing ${JSON.stringify(needle)}, but it resolved`);
}

// ---------------------------------------------------------------------------
// Mock pipeline contracts
// ---------------------------------------------------------------------------

test("quote requires an open primary market", async () => {
  const c = new MockPantaClient();
  await expectReject(
    c.quotePrimaryBuy({ wallet: WALLET_A, marketId: RESOLVED, side: "yes", amountUsdc: "20.00" }),
    "not an open primary market",
  );
  await expectReject(
    c.quotePrimaryBuy({ wallet: WALLET_A, marketId: "Nope123", side: "yes", amountUsdc: "20.00" }),
    "not an open primary market",
  );
  const q = await c.quotePrimaryBuy({ wallet: WALLET_A, marketId: OPEN_PRIMARY, side: "yes", amountUsdc: "20.00" });
  if (!q.quoteId) throw new Error("expected a quote id for the open primary market");
});

test("quote rejects loose amounts", async () => {
  const c = new MockPantaClient();
  for (const bad of ["20junk", "-5", "0", "", "abc", "20.0000001"]) {
    await expectReject(
      c.quotePrimaryBuy({ wallet: WALLET_A, marketId: OPEN_PRIMARY, side: "yes", amountUsdc: bad }),
      "amountUsdc",
    );
  }
  const q = await c.quotePrimaryBuy({ wallet: WALLET_A, marketId: OPEN_PRIMARY, side: "yes", amountUsdc: "20.00" });
  if (q.amountUsdc !== "20.00") throw new Error("strict amount was not preserved");
});

test("build rejects an expired quote", async () => {
  const c = new MockPantaClient();
  const q = await c.quotePrimaryBuy({ wallet: WALLET_A, marketId: OPEN_PRIMARY, side: "yes", amountUsdc: "20.00" });
  c.expireQuoteForTests(q.quoteId);
  await expectReject(c.buildPrimaryBuy({ quoteId: q.quoteId, wallet: WALLET_A }), "expired");
});

test("build rejects an unknown quote", async () => {
  const c = new MockPantaClient();
  await expectReject(c.buildPrimaryBuy({ quoteId: "qmock-nope", wallet: WALLET_A }), "unknown quote");
});

test("build rejects a different wallet than the quote", async () => {
  const c = new MockPantaClient();
  const q = await c.quotePrimaryBuy({ wallet: WALLET_A, marketId: OPEN_PRIMARY, side: "yes", amountUsdc: "20.00" });
  await expectReject(c.buildPrimaryBuy({ quoteId: q.quoteId, wallet: WALLET_B }), "does not match quote wallet");
});

test("repeated builds on one quote keep the same bound context", async () => {
  const c = new MockPantaClient();
  const q = await c.quotePrimaryBuy({ wallet: WALLET_A, marketId: OPEN_PRIMARY, side: "no", amountUsdc: "20.00" });
  const b1: PrimaryBuyBuild = await c.buildPrimaryBuy({ quoteId: q.quoteId, wallet: WALLET_A });
  const b2: PrimaryBuyBuild = await c.buildPrimaryBuy({ quoteId: q.quoteId, wallet: WALLET_A });
  for (const b of [b1, b2]) {
    if (b.quoteId !== q.quoteId || b.wallet !== WALLET_A || b.marketId !== OPEN_PRIMARY || b.side !== "no" || b.amountUsdc !== "20.00") {
      throw new Error("build context drifted from the quote");
    }
  }
});

test("create-market build returns a base64 transaction and binds the wallet", async () => {
  const c = new MockPantaClient();
  const now = Math.floor(Date.now() / 1000);
  const quote = await c.quoteCreateMarket({
    wallet: WALLET_A,
    question: "Will the contract test pass?",
    resolutionRule: "Test only.",
    sourcesOfTruth: ["https://example.com/test"],
    category: "crypto",
    startTime: now + 3600,
    endTime: now + 86400,
    resolutionTime: now + 90000,
    marketType: "standard",
    imageUrl: "https://example.com/test.png",
  });
  await expectReject(c.buildCreateMarket(quote.createId, WALLET_B), "does not match quote wallet");
  const build: CreateMarketBuild = await c.buildCreateMarket(quote.createId, WALLET_A);
  if (typeof build.transaction !== "string" || build.transaction.length === 0) {
    throw new Error("expected a non-empty base64 transaction");
  }
  // Must decode as base64; the mock carries deterministic stand-in bytes.
  const bytes = Buffer.from(build.transaction, "base64");
  if (bytes.length === 0) throw new Error("transaction is not valid base64");
  if (build.paymentUsdc !== quote.paymentUsdc) throw new Error("payment drifted from the quote");
});

test("create-market build rejects an expired session", async () => {
  const c = new MockPantaClient();
  const now = Math.floor(Date.now() / 1000);
  const quote = await c.quoteCreateMarket({
    wallet: WALLET_A,
    question: "Will the expiry test pass?",
    resolutionRule: "Test only.",
    sourcesOfTruth: ["https://example.com/test"],
    category: "crypto",
    startTime: now + 3600,
    endTime: now + 86400,
    resolutionTime: now + 90000,
    marketType: "standard",
    imageUrl: "https://example.com/test.png",
  });
  c.expireCreateForTests(quote.createId);
  await expectReject(c.buildCreateMarket(quote.createId, WALLET_A), "expired");
});

// ---------------------------------------------------------------------------
// Client-level contracts (stubbed fetch)
// ---------------------------------------------------------------------------

function stubFetch(handler: (url: string, init: unknown) => Response): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) =>
    handler(String(url), init)) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

test("malformed 2xx raises BAD_RESPONSE instead of a silent null", async () => {
  const restore = stubFetch(
    () => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }),
  );
  try {
    const c = new PantaClient({ apiKey: "pk_test_stub" });
    await expectReject(c.listCategories(), "BAD_RESPONSE");
  } finally {
    restore();
  }
});

test("listCategories hits GET /categories/", async () => {
  let seenUrl = "";
  const restore = stubFetch((url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ categories: ["crypto", "sports"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const c = new PantaClient({ apiKey: "pk_test_stub" });
    const cats = await c.listCategories();
    if (!seenUrl.endsWith("/categories/")) throw new Error(`wrong path: ${seenUrl}`);
    if (cats.join(",") !== "crypto,sports") throw new Error(`wrong payload: ${cats}`);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Captured sandbox responses parse into the shapes the client consumes
// ---------------------------------------------------------------------------

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

test("captured sandbox primary quote parses", async () => {
  const q = readFixture("primary-quote.json") as unknown as PrimaryBuyQuote;
  for (const f of ["quoteId", "marketId", "side", "amountUsdc", "shares", "feeUsdc", "expiresAt"] as const) {
    if (typeof q[f] !== "string" || q[f].length === 0) throw new Error(`quote missing ${f}`);
  }
  if (q.side !== "yes" && q.side !== "no") throw new Error(`unexpected side ${q.side}`);
});

test("captured sandbox primary build parses", async () => {
  const b = readFixture("primary-build.json") as unknown as PrimaryBuyBuild;
  for (const f of ["orderId", "quoteId", "wallet", "recentBlockhash"] as const) {
    if (typeof b[f] !== "string" || (b[f] as string).length === 0) throw new Error(`build missing ${f}`);
  }
  if (!Array.isArray(b.instructions)) throw new Error("build instructions is not an array");
});

test("captured sandbox create build carries a base64 transaction field", async () => {
  const b = readFixture("create-build.json") as unknown as CreateMarketBuild;
  if (typeof b.transaction !== "string") throw new Error("create build has no transaction field");
  if (typeof b.expectedEventPda !== "string" || b.expectedEventPda.length === 0) {
    throw new Error("create build missing expectedEventPda");
  }
  if (typeof b.expiresAt !== "string" || b.expiresAt.length === 0) throw new Error("create build missing expiresAt");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runContractTests(): Promise<{ passed: number; failed: number; failures: string[] }> {
  results.length = 0;
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true, detail: "" });
    } catch (e) {
      results.push({ name: t.name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  const failures = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`);
  return { passed: results.filter((r) => r.ok).length, failed: failures.length, failures };
}

async function main(): Promise<void> {
  const { passed, failed, failures } = await runContractTests();
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  -> ${r.detail}`}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  const base = arg.replace(/\\/g, "/").split("/").pop() ?? "";
  return base === "contract-tests.ts";
})();

if (invokedDirectly) {
  main().catch((e) => {
    console.error("contract tests crashed:", e);
    process.exit(1);
  });
}
