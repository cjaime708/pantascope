import { jsonError, pantaCall, type PantaUpstreamError } from "../../../../lib/panta-server";
import type { PantaMarket } from "../../../../../src/types";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const out = await pantaCall<PantaMarket>("GET", `/markets/${encodeURIComponent(id)}/`, {
    signal: req.signal,
  });
  // PantaUpstreamError carries a NUMERIC status; a real market also has a
  // `status` field but it is a string label (e.g. "open"). Discriminate on the
  // type, otherwise every successful detail fetch is misread as an error and
  // Response.json throws on the string status -> empty 500.
  const err = out as PantaUpstreamError;
  if (typeof err.status === "number") {
    if (err.status === 404) {
      return Response.json({ error: { code: "NOT_FOUND", message: "market not found" } }, { status: 404 });
    }
    return jsonError(err);
  }
  return Response.json(out, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}
