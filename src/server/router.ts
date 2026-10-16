import { proxyHls } from "../proxy/hls.js";
import { listLiveMatches } from "../handlers/live.js";
import { resolveMatch } from "../handlers/match.js";
import { playlistResponse } from "../handlers/playlist.js";
import { publicOrigin } from "./http.js";
import { serveClient } from "./static.js";

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = publicOrigin(request, url);
  if (url.pathname === "/api/hls") return proxyHls(request, origin);
  if (url.pathname === "/playlist.m3u" || url.pathname === "/playlist") {
    return playlistResponse(request, origin);
  }
  if (url.pathname === "/api/live") return listLiveMatches(url.searchParams.get("sportType"));
  if (url.pathname === "/api/resolve") {
    return resolveMatch(url.searchParams.get("matchId"), url.searchParams.get("sportType"), origin);
  }
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "not found" }, { status: 404 });
  return serveClient(url.pathname);
}
