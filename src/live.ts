/**
 * Live Panta client with a portable authentication path.
 *
 * Preferred (any machine): set PANTA_API_KEY to a pk_test_/pk_live_ API key
 * or a signup JWT access token. The regular PantaClient talks to the API
 * directly; nothing here is VM-specific.
 *
 * Fallback (Muse's VM only): when PANTA_API_KEY is absent and the panta
 * skill's Python CLI exists at ~/workspace/skills/panta/bin/panta_cli.py,
 * VaultPantaClient shells out to it. The key lives in the Secure Vault and
 * reaches the CLI through an authd surrogate exchange; the key value never
 * appears in this repo, in environment variables, or in logs.
 *
 * Test keys hit Panta's sandbox fixtures (documented behavior), not mainnet
 * data. Nothing here signs or broadcasts; quote -> build returns unsigned
 * instructions only, same contract as the mock lab.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PantaClient, PantaError } from "./client.js";

const execFileAsync = promisify(execFile);
const PANTA_CLI = join(homedir(), "workspace", "skills", "panta", "bin", "panta_cli.py");

/** Redact anything that looks like a Panta API key before it can reach a log. */
function scrubSecrets(text: string): string {
  return text.replace(/pk_(test|live)_[A-Za-z0-9_-]+/g, "pk_$1_[redacted]");
}

export class VaultPantaClient extends PantaClient {
  constructor() {
    // Dummy value: request() is overridden below, so this key is never sent.
    super({ apiKey: "vault-managed" });
  }

  protected override async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    // Trailing slash on the pathname only; never after a query string.
    const [pathname, query] = path.split("?", 2);
    const normalized = (pathname.endsWith("/") ? pathname : `${pathname}/`) + (query ? `?${query}` : "");
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
      const msg = scrubSecrets(err instanceof Error ? err.message : String(err));
      const m = msg.match(/HTTP (\d{3})/);
      throw new PantaError(
        m ? `HTTP_${m[1]}` : "LIVE_REQUEST_FAILED",
        `live Panta request failed: ${msg.slice(0, 300)}`,
        m ? parseInt(m[1], 10) : 0,
        null,
      );
    }
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new PantaError(
        "LIVE_BAD_RESPONSE",
        `live Panta request returned non-JSON: ${scrubSecrets(stdout).slice(0, 200)}`,
        0,
        null,
      );
    }
  }
}

/**
 * A signup JWT has three base64url segments; API keys start with pk_.
 * Anything else is sent as X-Api-Key (the server rejects it if wrong).
 */
function looksLikeJwt(value: string): boolean {
  if (value.startsWith("pk_")) return false;
  return value.split(".").length === 3;
}

/**
 * Portable live-client factory.
 *
 * 1. PANTA_API_KEY set -> direct PantaClient (works on any machine).
 * 2. Vault CLI present -> VaultPantaClient (Muse's VM only).
 * 3. Neither -> throw a helpful error instead of failing deep in a call.
 */
export function createLiveClient(): PantaClient {
  const apiKey = (process.env["PANTA_API_KEY"] ?? "").trim();
  if (apiKey) {
    return new PantaClient({ apiKey, apiKeyIsJwt: looksLikeJwt(apiKey) });
  }
  if (existsSync(PANTA_CLI)) {
    return new VaultPantaClient();
  }
  throw new Error(
    "No Panta credentials. Set PANTA_API_KEY to a pk_test_/pk_live_ API key or a " +
      "signup JWT access token, or run on a machine with the panta skill CLI installed.",
  );
}
