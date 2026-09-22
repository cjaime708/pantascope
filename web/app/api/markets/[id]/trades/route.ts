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
  if (err.status !== undefined) {
    if (err.status === 404) {
      return Response.json({ error: { code: "NOT_FOUND", message: "market not found" } }, { status: 404 });
    }
    return jsonError(err);
  }
  return Response.json(out, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}
