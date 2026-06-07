import { getBackendUrl, proxyError } from "../../_lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export const POST = async (
  _req: Request,
  { params }: RouteContext,
): Promise<Response> => {
  const { sessionId } = await params;
  if (!sessionId) return proxyError(400, "sessionId is required");

  const backendUrl = getBackendUrl();
  let upstream: Response;
  try {
    upstream = await fetch(
      `${backendUrl}/api/reset/${encodeURIComponent(sessionId)}`,
      { method: "POST" },
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
