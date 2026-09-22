import { jsonError, pantaCall, type PantaUpstreamError } from "../../../lib/panta-server";
import type { PrimaryBuyQuote, PrimaryBuyQuoteRequest } from "../../../../src/types";

const STRICT_AMOUNT = /^\d+(\.\d{1,6})?$/;

export async function POST(req: Request) {
  let body: Partial<PrimaryBuyQuoteRequest> & { userId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "request body must be JSON" } },
      { status: 400 },
    );
  }
  const marketId = (body.marketId ?? "").trim();
  const side = (body.side ?? "").trim().toLowerCase();
  const amountUsdc = (body.amountUsdc ?? "").trim();
  const wallet = (body.wallet ?? "").trim();
  if (!marketId || (side !== "yes" && side !== "no") || !STRICT_AMOUNT.test(amountUsdc) || !wallet) {
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "marketId, side (yes|no), amountUsdc (positive, up to 6 decimals), and wallet are required",
        },
      },
      { status: 400 },
    );
  }
  const out = await pantaCall<PrimaryBuyQuote>("POST", "/primaryorderquote/", {
    body: {
      wallet,
      marketId,
      side,
      amountUsdc,
      ...(body.userId ? { userId: body.userId } : {}),
    },
    signal: req.signal,
  });
  if ((out as PantaUpstreamError).status !== undefined) {
    const err = out as PantaUpstreamError;
    if (err.status === 400 || err.status === 404 || err.status === 422) {
      return Response.json(
        { error: { code: "QUOTE_REJECTED", message: err.message } },
        { status: err.status },
      );
    }
    return jsonError(err);
  }
  return Response.json(out);
}
