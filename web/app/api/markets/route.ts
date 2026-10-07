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
  return Response.json(out, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}
