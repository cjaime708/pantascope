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
import { createLiveClient } from "./live.js";
import { isValidWallet } from "./wallet.js";
import {
  CreateMarketBuild,
  CreateMarketQuoteRequest,
  PantaInstruction,
  Side,
} from "./types.js";

/** One audit record per lab run: what was quoted, what was built, and why a step failed. */
export interface LabAuditRecord {
  lab: "primary-buy" | "create-market";
  mode: "mock" | "live";
  quoteId: string | null;
  wallet: string;
  marketId: string | null;
  side: Side | null;
  amountUsdc: string | null;
  expiresAt: string | null;
  result: "quoted" | "built" | "failed";
  failureReason: string | null;
  ts: string;
}

function printAudit(record: LabAuditRecord): void {
  console.log(`AUDIT ${JSON.stringify(record)}`);
}

/** Read --wallet <addr> from argv; null when absent. */
function parseWalletArg(): string | null {
  const i = process.argv.indexOf("--wallet");
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
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
export async function runPrimaryBuyLab(
  client: PantaClient,
  input: PrimaryBuyLabInput,
  mode: "mock" | "live" = "mock",
): Promise<void> {
  const audit: LabAuditRecord = {
    lab: "primary-buy",
    mode,
    quoteId: null,
    wallet: input.wallet,
    marketId: input.marketId,
    side: input.side,
    amountUsdc: input.amountUsdc,
    expiresAt: null,
    result: "failed",
    failureReason: null,
    ts: new Date().toISOString(),
  };
  try {
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
    audit.quoteId = quote.quoteId;
    audit.expiresAt = quote.expiresAt;
    audit.result = "quoted";
    console.log(`  quote id:        ${quote.quoteId}`);
    console.log(`  expected shares: ${quote.shares}`);
    console.log(`  average price:   ${quote.avgPrice} USDC per share`);
    console.log(`  protocol fee:    ${quote.feeUsdc} USDC`);
    console.log(`  quote expires:   ${quote.expiresAt}`);

    console.log("\nStep 2: build the unsigned instructions from the live quote");
    const build = await client.buildPrimaryBuy({ quoteId: quote.quoteId, wallet: input.wallet });
    audit.result = "built";
    console.log(`  order id:        ${build.orderId}`);
    console.log(`  expected shares: ${build.expectedShares}`);
    printInspection(build.instructions, build.recentBlockhash, build.lastValidBlockHeight);
  } catch (err) {
    audit.failureReason = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    printAudit(audit);
  }
}

/**
 * Paper-trade a market creation: quote the fee, then build and inspect the
 * unsigned transaction preview. Stops before signing, always.
 */
export async function runCreateMarketLab(
  client: PantaClient,
  input: CreateMarketLabInput,
  mode: "mock" | "live" = "mock",
): Promise<void> {
  const audit: LabAuditRecord = {
    lab: "create-market",
    mode,
    quoteId: null,
    wallet: input.wallet,
    marketId: null,
    side: null,
    amountUsdc: null,
    expiresAt: null,
    result: "failed",
    failureReason: null,
    ts: new Date().toISOString(),
  };
  try {
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
    audit.quoteId = quote.createId;
    audit.expiresAt = quote.expiresAt;
    audit.result = "quoted";
    console.log(`  session id:       ${quote.createId}`);
    console.log(`  expected event:   ${quote.expectedEventPda}`);
    console.log(`  creation payment: ${baseUnitsToUsdc(quote.paymentUsdc)} USDC`);
    console.log(`  session expires:  ${quote.expiresAt}`);

    console.log("\nStep 2: build the unsigned transaction preview");
    const build: CreateMarketBuild = await client.buildCreateMarket(quote.createId, input.wallet);
    audit.result = "built";
    const txBytes = Buffer.from(build.transaction, "base64");
    console.log(`  expected event:   ${build.expectedEventPda}`);
    console.log(`  transaction:      ${txBytes.length} bytes (base64 unsigned VersionedTransaction)`);
    console.log(`  base64 preview:   ${build.transaction.slice(0, 48)}...`);
    console.log(`  build fingerprint:${build.buildFingerprint ? ` ${build.buildFingerprint}` : ""}`);
    console.log(`  paying:           ${baseUnitsToUsdc(build.paymentUsdc)} USDC`);
    console.log(`  recent blockhash: ${build.recentBlockhash}`);
    console.log(`  blockhash valid:  until height ${build.lastValidBlockHeight} (~${build.blockhashExpiryHintSec}s)`);
    console.log(`  build expires:    ${build.expiresAt}`);
    console.log("\nDecode the base64 in your own wallet to inspect the instructions, sign there, broadcast there.");
    console.log("Nothing was signed. Nothing was broadcast. This was a rehearsal only.");
  } catch (err) {
    audit.failureReason = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    printAudit(audit);
  }
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  if (!process.argv.includes("--demo") && !live) {
    console.log("PantaScope paper-trade lab.");
    console.log("Run: tsx src/lab.ts --demo        (fixture data, no network)");
    console.log("Run: tsx src/lab.ts --live        (Panta sandbox: PANTA_API_KEY or vault key)");
    console.log("Both modes stop at unsigned instructions. Nothing is signed.");
    return;
  }

  if (live) {
    console.log("mode: LIVE LAB (Panta sandbox, no signing)\n");
    // The live lab needs a real wallet to bind quotes to. Take it from
    // --wallet and validate it as a real 32-byte Solana key BEFORE any
    // network call.
    const wallet = parseWalletArg();
    if (!wallet || !isValidWallet(wallet)) {
      console.error(
        "live lab needs a valid Solana wallet: tsx src/lab.ts --live --wallet <base58 address>"
      );
      if (wallet) console.error(`rejected wallet: ${JSON.stringify(wallet)} (not a 32-byte Solana key)`);
      process.exit(1);
    }
    const client = createLiveClient();
    const markets = await client.listMarkets();
    const market = markets.items.find(
      (m) => m.phase === "primary" && (m.status === "open" || m.status === "primary") && !m.resolved,
    );
    if (!market) {
      console.error("live lab: sandbox returned no open primary markets");
      process.exit(1);
    }
    console.log(`sandbox market: ${market.title} (${market.marketId})\n`);
    await runPrimaryBuyLab(client, {
      wallet,
      marketId: market.marketId,
      side: "yes",
      amountUsdc: "20.00",
    }, "live");
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
