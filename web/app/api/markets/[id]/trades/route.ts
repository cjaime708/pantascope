import { jsonError, pantaCall, type PantaUpstreamError } from "../../../../../lib/panta-server";
import type { MarketTradesResponse } from "../../../../../../src/types";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const out = await pantaCall<MarketTradesResponse>("GET", `/markets/${encodeURIComponent(id)}/trades/`, {
    query: { limit: url.searchParams.get("limit") ?? undefined },
    signal: req.signal,
  });
  const err = out as PantaUpstreamError;
  if (typeof err.status === "number") { // numeric status = upstream error; success payloads never carry one
    if (err.status === 404) {
      return Response.json({ error: { code: "NOT_FOUND", message: "market not found" } }, { status: 404 });
    }
    return jsonError(err);
  }
  // Trade amounts arrive in micro-USDC base units (10^6). Normalize to USDC
  // here so every consumer renders human-scale values.
  const body = out as MarketTradesResponse;
  for (const t of body.items ?? []) {
    t.yesAmount = normAmount(t.yesAmount);
    t.noAmount = normAmount(t.noAmount);
    t.feePaid = normAmount(t.feePaid);
  }
  return Response.json(body, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}

/** "109107348" or 109107348 (micro-USDC) -> "109.107348" (USDC). */
function normAmount(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return String(v);
  return String(n / 1e6);
}
