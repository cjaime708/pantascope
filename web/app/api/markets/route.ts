import { jsonError, listMarketsQuery, pantaCall, type PantaUpstreamError } from "../../../lib/panta-server";
import type { ListMarketsResponse } from "../../../../src/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const out = await pantaCall<ListMarketsResponse>("GET", "/markets/", {
    query: listMarketsQuery(url.searchParams),
    signal: req.signal,
  });
  if (typeof (out as PantaUpstreamError).status === "number") { // numeric status = upstream error; success payloads never carry one
    return jsonError(out as PantaUpstreamError);
  }
  // Defensive: secondary prices arrive 10^9-scaled when present ("516847710"
  // = 0.51684771). Normalize so formatters render real percentages.
  const body = out as ListMarketsResponse;
  for (const m of body.items ?? []) {
    m.secondaryYesPrice = normPrice(m.secondaryYesPrice);
    m.secondaryNoPrice = normPrice(m.secondaryNoPrice);
  }
  return Response.json(body, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}

/** "516847710" (10^9-scaled) -> "0.51684771". Passes through null and already-scaled values. */
function normPrice(v: string | null): string | null {
  if (v === null || v === "") return v;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  if (n <= 1) return v; // already a 0-1 probability
  return String(n / 1e9);
}
