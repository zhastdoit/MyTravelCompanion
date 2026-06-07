import { buildProxyHeaders, getBackendUrl, proxyError } from "../../trip/_lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tripId: string }>;
}

export const GET = async (
  _req: Request,
  { params }: RouteContext,
): Promise<Response> => {
  const { tripId } = await params;
  if (!tripId) return proxyError(400, "tripId is required");

  const backendUrl = getBackendUrl();
  let upstream: Response;
  try {
    upstream = await fetch(
      `${backendUrl}/api/trips/${encodeURIComponent(tripId)}`,
      { cache: "no-store", headers: await buildProxyHeaders() },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return proxyError(502, `Backend unreachable: ${detail}`);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
};

/** PATCH /api/trips/:tripId — rename a saved trip. */
export const PATCH = async (
  req: Request,
  { params }: RouteContext,
): Promise<Response> => {
  const { tripId } = await params;
  if (!tripId) return proxyError(400, "tripId is required");

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const backendUrl = getBackendUrl();
  let upstream: Response;
  try {
    upstream = await fetch(
      `${backendUrl}/api/trips/${encodeURIComponent(tripId)}`,
      {
        method: "PATCH",
        headers: await buildProxyHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return proxyError(502, `Backend unreachable: ${detail}`);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
};
