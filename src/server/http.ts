/**
 * Request-scoped HTTP helpers shared by every route.
 *
 * Behind a reverse proxy the listen address (localhost:3000) is not the public
 * address. Generated links must use the forwarded host/proto when present.
 */

function firstForwarded(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

/**
 * Public origin for link generation: honors X-Forwarded-Host /
 * X-Forwarded-Proto (as set by nginx, Traefik, Caddy, …) and falls back to
 * the Host header, then to the URL the server actually saw.
 */
export function publicOrigin(request: Request, url: URL): string {
  const host = firstForwarded(request.headers.get("x-forwarded-host")) ?? request.headers.get("host") ?? url.host;
  const proto = firstForwarded(request.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Max-Age": "86400",
} as const;

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/playlist");
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Content-Length": "0" } });
}
