import { buildProxyHeaders, getBackendUrl, proxyError } from "../../_lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export const POST = async (
  req: Request,
  { params }: RouteContext,
): Promise<Response> => {
  const { sessionId } = await params;
  if (!sessionId) return proxyError(400, "sessionId is required");

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
      `${backendUrl}/api/save/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: await buildProxyHeaders({
          "content-type": "application/json",
        }),
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
