import { jsonError, listMarketsQuery, pantaCall, type PantaUpstreamError } from "../../../lib/panta-server";
import type { ListMarketsResponse } from "../../../../src/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const out = await pantaCall<ListMarketsResponse>("GET", "/markets/", {
    query: listMarketsQuery(url.searchParams),
    signal: req.signal,
  });
  if ((out as PantaUpstreamError).status !== undefined) {
    return jsonError(out as PantaUpstreamError);
  }
  return Response.json(out, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}
