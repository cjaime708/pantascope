import { jsonError, pantaCall, type PantaUpstreamError } from "../../../lib/panta-server";
import type { PrimaryBuyBuild, PrimaryBuyBuildRequest } from "../../../../src/types";

export async function POST(req: Request) {
  let body: Partial<PrimaryBuyBuildRequest>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "request body must be JSON" } },
      { status: 400 },
    );
  }
  const quoteId = (body.quoteId ?? "").trim();
  const wallet = (body.wallet ?? "").trim();
  if (!quoteId || !wallet) {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "quoteId and wallet are required" } },
      { status: 400 },
    );
  }
  const out = await pantaCall<PrimaryBuyBuild>("POST", "/primaryorderbuild/", {
    body: {
      quoteId,
      wallet,
      ...(body.userId ? { userId: body.userId } : {}),
      ...(body.maxSlippageBps !== undefined ? { maxSlippageBps: body.maxSlippageBps } : {}),
    },
    signal: req.signal,
  });
  if ((out as PantaUpstreamError).status !== undefined) {
    const err = out as PantaUpstreamError;
    if (err.status === 400 || err.status === 404 || err.status === 422) {
      return Response.json(
        { error: { code: "BUILD_REJECTED", message: err.message } },
        { status: err.status },
      );
    }
    return jsonError(err);
  }
  return Response.json(out);
}
