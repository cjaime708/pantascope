import { jsonError, pantaCall, type PantaUpstreamError } from "../../../lib/panta-server";
import type { PositionsResponse } from "../../../../src/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = (url.searchParams.get("wallet") ?? "").trim();
  if (!wallet) {
    return Response.json(
      { error: { code: "WALLET_REQUIRED", message: "wallet query parameter is required" } },
      { status: 400 },
    );
  }
  const out = await pantaCall<PositionsResponse>("GET", "/positions/", {
    query: { wallet },
    signal: req.signal,
  });
  if (typeof (out as PantaUpstreamError).status === "number") { // numeric status = upstream error; success payloads never carry one
    return jsonError(out as PantaUpstreamError);
  }
  return Response.json(out, { headers: { "Cache-Control": "s-maxage=20, stale-while-revalidate=60" } });
}
