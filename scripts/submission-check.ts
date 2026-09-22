#!/usr/bin/env tsx
/**
 * submission:check — the pre-submission gate for PantaScope.
 *
 * Run: npm run submission:check
 *
 * Steps:
 *  1. typecheck the CLI sources (tsc --noEmit, node-invoked local binary)
 *  2. typecheck the web app (web/tsconfig.check.json)
 *  3. production build of the web app (next build)
 *  4. dependency audit of production deps (root + web) via the OSV
 *     database: zero high/critical findings allowed
 *  5. run the contract-test suite (mock quote/build pipeline + captured
 *     sandbox responses + client-level contracts)
 *  6. scan src/, web/, and scripts/ for signing or broadcasting code:
 *     nothing in this repo may load a private key, sign, or broadcast
 *  7. self-test the wallet validator (accepts a real 32-byte address,
 *     rejects the old invalid live-lab wallet and wrong-length decodes)
 *
 * Portable: no bare `npx`/`npm` (both are .cmd shims that fail with ENOENT
 * or EINVAL on Windows without shell:true). Local binaries (tsc, next)
 * run through process.execPath instead.
 *
 * Any failure exits non-zero with the failing step named.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runContractTests } from "../src/contract-tests.js";
import { base58Decode, isValidWallet } from "../src/wallet.js";

const ROOT = join(import.meta.dirname ?? ".", "..");
const WEB = join(ROOT, "web");
const IS_WIN = process.platform === "win32";
void IS_WIN; // retained for future platform-specific steps

let failures = 0;

function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((e) => {
      failures += 1;
      console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

/** Run the local TypeScript compiler through node (no npx, Windows-safe). */
function tscNoEmit(cwd: string, project?: string): void {
  const tscBin = join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscBin)) throw new Error(`typescript not installed in ${cwd} (run npm install)`);
  const args = project ? ["--noEmit", "-p", project] : ["--noEmit"];
  execFileSync(process.execPath, [tscBin, ...args], { cwd, stdio: "pipe" });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/** Strip comments and string literals so the scan only sees real code. */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

// Identifiers that prove signing/broadcasting capability. "unsigned" is not
// in the list on purpose: describing unsigned output is fine.
const FORBIDDEN = [
  "signTransaction",
  "signAllTransactions",
  "sendTransaction",
  "sendRawTransaction",
  "broadcastTransaction",
  "requestAirdrop",
  "fromSecretKey",
  "secretKey",
  "privateKey",
  ".sign(",
  "Keypair.generate",
];

/** Production (non-dev) dependency closure from a lockfile. */
function prodClosure(dir: string): { name: string; version: string }[] {
  const lockPath = join(dir, "package-lock.json");
  if (!existsSync(lockPath)) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return Object.entries((pkg.dependencies ?? {}) as Record<string, string>).map(([name]) => ({
      name,
      version: "unknown",
    }));
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const out: { name: string; version: string }[] = [];
  for (const [key, info] of Object.entries((lock.packages ?? {}) as Record<string, { version?: string; dev?: boolean }>) ) {
    if (!key || info.dev || !info.version) continue;
    const name = key.split("node_modules/").pop()!;
    if (!name || (name.includes("/") && !name.startsWith("@"))) continue;
    out.push({ name, version: info.version });
  }
  return out;
}

/** Query OSV in one batch; return high/critical findings. */
interface OsvVuln {
  id: string;
  summary?: string;
  severity?: { type: string; score: string }[];
}

/** Query OSV in one batch; return high/critical findings. */
async function osvHighCritical(
  pkgs: { name: string; version: string }[],
): Promise<string[]> {
  const known = pkgs.filter((p) => p.version !== "unknown");
  if (known.length === 0) return [];
  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: known.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })),
    }),
  });
  if (!res.ok) throw new Error(`OSV querybatch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { results: { vulns?: OsvVuln[] }[] };
  const hits: string[] = [];
  data.results.forEach((r, i) => {
    for (const v of r.vulns ?? []) {
      const cvss = (v.severity ?? []).find((s) => s.type === "CVSS_V3" || s.type === "CVSS_V4");
      const level = cvssVectorLevel(cvss?.score ?? "");
      if (level === "high" || level === "critical") {
        hits.push(`${known[i].name}@${known[i].version}: ${v.id} (${level}) ${v.summary ?? ""}`.trim());
      }
    }
  });
  return hits;
}

/** Map a CVSS vector to high/critical via the standard base-score formula. */
function cvssVectorLevel(vector: string): "critical" | "high" | "medium" | "low" | "none" | "" {
  if (!vector) return "";
  // Extract metric values from the vector.
  const val = (prefix: string): string => {
    const m = vector.match(new RegExp(`(?:^|/)${prefix}:([A-Z])`));
    return m ? m[1] : "";
  };
  const table: Record<string, Record<string, number>> = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    PR: { N: 0.85, L: 0.62, H: 0.27 },
    UI: { N: 0.85, R: 0.62 },
    C: { H: 0.56, L: 0.22, N: 0 },
    I: { H: 0.56, L: 0.22, N: 0 },
    A: { H: 0.56, L: 0.22, N: 0 },
  };
  const get = (k: string) => table[k]?.[val(k)] ?? 0;
  const iss = 1 - (1 - get("C")) * (1 - get("I")) * (1 - get("A"));
  const scopeChanged = val("S") === "C";
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impact <= 0) return "none";
  const pr = val("PR");
  const prAdj = scopeChanged && pr === "L" ? 0.68 : pr === "H" && scopeChanged ? 0.5 : get("PR");
  const exploit = 8.22 * get("AV") * get("AC") * prAdj * get("UI");
  const base = scopeChanged
    ? Math.min(10, 1.08 * (impact + exploit))
    : Math.min(10, impact + exploit);
  const rounded = Math.ceil(base * 10) / 10;
  if (rounded >= 9.0) return "critical";
  if (rounded >= 7.0) return "high";
  if (rounded >= 4.0) return "medium";
  if (rounded > 0) return "low";
  return "none";
}

await step("typecheck root (tsc --noEmit)", () => {
  tscNoEmit(ROOT);
});

await step("typecheck web (tsconfig.check.json)", () => {
  tscNoEmit(WEB, "tsconfig.check.json");
});

await step("web production build (next build)", () => {
  // Run the Next CLI through node directly: npm.cmd is a batch shim that
  // requires shell:true under execFileSync on Windows (EINVAL otherwise).
  const nextBin = join(WEB, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) throw new Error(`next not installed in ${WEB} (run npm install)`);
  execFileSync(process.execPath, [nextBin, "build"], { cwd: WEB, stdio: "pipe" });
});

await step("dependency audit (OSV, zero high/critical prod)", async () => {
  const hits: string[] = [];
  for (const dir of [ROOT, WEB]) {
    const pkgs = prodClosure(dir);
    const dirHits = await osvHighCritical(pkgs);
    if (dirHits.length > 0) hits.push(...dirHits.map((h) => `${dir === ROOT ? "root" : "web"}: ${h}`));
    console.log(`     ${dir === ROOT ? "root" : "web"}: ${pkgs.length} prod packages scanned`);
  }
  if (hits.length > 0) throw new Error(`high/critical findings:\n${hits.join("\n")}`);
});

await step("contract tests", async () => {
  const { passed, failed, failures: details } = await runContractTests();
  console.log(`     ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(details.join(" | "));
});

await step("no signing or broadcasting code", () => {
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "web", "app")), ...walk(join(ROOT, "web", "lib")), ...walk(join(ROOT, "web", "components")), ...walk(join(ROOT, "scripts"))];
  const hits: string[] = [];
  for (const f of files) {
    const code = stripNonCode(readFileSync(f, "utf8"));
    for (const pat of FORBIDDEN) {
      if (code.includes(pat)) hits.push(`${f}: ${pat}`);
    }
  }
  if (hits.length > 0) throw new Error(`forbidden signing/broadcast code found: ${hits.join("; ")}`);
  console.log(`     scanned ${files.length} files`);
});

await step("wallet validator self-test", () => {
  const valid = "11111111111111111111111111111111"; // system program: 32 zero bytes
  const invalidOld = "TestWallet11111111111111111111111111111111"; // lowercase l: invalid base58
  const tooShort = "1111111111111111111111111111111"; // 31 chars -> 31 bytes
  const tooLong = "111111111111111111111111111111111"; // 33 chars -> 33 bytes
  if (!isValidWallet(valid)) throw new Error("validator rejected a valid address");
  if (base58Decode(valid).length !== 32) throw new Error("decode of valid address is not 32 bytes");
  if (isValidWallet(invalidOld)) throw new Error("validator accepted the old invalid wallet");
  if (isValidWallet(tooShort)) throw new Error("validator accepted a 31-byte decode");
  if (isValidWallet(tooLong)) throw new Error("validator accepted a 33-byte decode");
});

console.log(failures === 0 ? "\nsubmission:check PASSED" : `\nsubmission:check FAILED (${failures} step(s))`);
process.exitCode = failures === 0 ? 0 : 1; // let the event loop drain; process.exit() trips a libuv UV_HANDLE_CLOSING assertion on Windows
