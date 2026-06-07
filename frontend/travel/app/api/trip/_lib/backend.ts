export const DEFAULT_BACKEND_URL = "http://localhost:8000";

export const getBackendUrl = (): string => {
  const url = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

interface JsonError {
  error: string;
}

export const proxyError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message } satisfies JsonError), {
    status,
    headers: { "content-type": "application/json" },
  });
