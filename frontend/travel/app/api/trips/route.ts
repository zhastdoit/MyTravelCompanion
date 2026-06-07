import { buildProxyHeaders, getBackendUrl, proxyError } from "../trip/_lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (): Promise<Response> => {
  const backendUrl = getBackendUrl();
  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl}/api/trips`, {
      cache: "no-store",
      headers: await buildProxyHeaders(),
    });
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
