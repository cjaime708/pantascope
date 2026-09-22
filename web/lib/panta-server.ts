/**
 * Server-only Panta API proxy helper. This module must never be imported by
 * client components: PANTA_API_KEY is read from server env only and never
 * reaches the browser. Route handlers in app/api/* use these helpers.
 */

const PANTA_BASE = "https://live-api.panta.market/api/v1";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Shape of the Panta error envelope, passed through as-is. */
export interface PantaUpstreamError {
  status: number;
  code: string;
  message: string;
}

function apiKey(): string | null {
  const k = process.env.PANTA_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

/**
 * Call the Panta API server-side. Pathnames keep their trailing slash, per
 * the API docs. Non-2xx responses resolve to a PantaUpstreamError instead of
 * throwing, so route handlers can map status codes cleanly.
 */
export async function pantaCall<T>(
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T | PantaUpstreamError> {
  const key = apiKey();
  if (!key) {
    return { status: 503, code: "NO_API_KEY", message: "PANTA_API_KEY is not configured on the server." };
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const url = `${PANTA_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "X-Api-Key": key,
        "User-Agent": UA,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: opts.signal,
    });
  } catch (err) {
    return {
      status: 502,
      code: "UPSTREAM_UNREACHABLE",
      message: err instanceof Error ? err.message : "Panta API request failed",
    };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const body = payload as { code?: string; message?: string } | null;
    return {
      status: res.status,
      code: body?.code ?? "UPSTREAM_ERROR",
      message: body?.message ?? `Panta API returned HTTP ${res.status}`,
    };
  }
  return payload as T;
}

/** Whitelisted passthrough of listMarkets query params (category, status, createdBy, cursor, limit). */
export function listMarketsQuery(search: URLSearchParams): Record<string, string | undefined> {
  return {
    category: search.get("category") ?? undefined,
    status: search.get("status") ?? undefined,
    createdBy: search.get("createdBy") ?? undefined,
    cursor: search.get("cursor") ?? undefined,
    limit: search.get("limit") ?? undefined,
  };
}

export function jsonError(err: PantaUpstreamError): Response {
  return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
}
