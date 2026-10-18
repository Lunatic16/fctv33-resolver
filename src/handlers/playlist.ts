import { ApiClient } from "../api/client.js";
import { ALL_SPORTS_TYPE, SPORT_LABELS, sportLabel } from "../config/site.js";

/**
 * Dynamic IPTV playlist: every live match as one channel whose URL is the
 * slot relay (`/api/hls?slot=sportType:matchId`), never a resolved CDN URL.
 * Entries unlock fresh at tune-in, and live playlist refreshes reuse the
 * cached slot until it expires. The all-sports list is one upstream request
 * (sportType 0, the site's "Live" tab) and is cached briefly so IPTV clients
 * polling the playlist do not hammer the upstream catalog.
 */

const LIST_TTL_MS = 15_000;

type PlaylistEntry = { sportType: number; matchId: number; name: string; group: string };

let sharedClient: ApiClient | null = null;

let cache: { key: string; at: number; entries: PlaylistEntry[] } | null = null;

function toEntries(sportType: number, matches: Awaited<ReturnType<ApiClient["fetchLiveMatches"]>>): PlaylistEntry[] {
  const group = sportType === ALL_SPORTS_TYPE ? "" : sportLabel(sportType);
  return matches.map((match) => ({
    sportType: match.sportType,
    matchId: match.matchId,
    name: match.name || `Match ${match.matchId}`,
    // The all-sports list carries a per-match sportType; group by that.
    group: group || sportLabel(match.sportType),
  }));
}

async function fetchEntries(sportType: number): Promise<PlaylistEntry[]> {
  sharedClient ??= new ApiClient();
  return toEntries(sportType, await sharedClient.fetchLiveMatches(sportType));
}

async function sweepAllSports(): Promise<PlaylistEntry[]> {
  // One request returns every live match (verified equal to the union of the
  // per-sport lists). If it fails, fall back to sweeping each sport so a
  // single-listing upstream change still yields a playlist.
  try {
    return await fetchEntries(ALL_SPORTS_TYPE);
  } catch {
    const settled = await Promise.allSettled(SPORT_LABELS.map((sport) => fetchEntries(sport.type)));
    const entries = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (!entries.length) {
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) {
        throw failure.reason instanceof Error ? failure.reason : new Error("live list failed");
      }
    }
    return entries;
  }
}

async function collectEntries(sportTypeRaw: string | null): Promise<PlaylistEntry[]> {
  const key = sportTypeRaw ?? "all";
  if (cache && cache.key === key && Date.now() - cache.at < LIST_TTL_MS) return cache.entries;
  const entries = sportTypeRaw ? await fetchEntries(Number(sportTypeRaw)) : await sweepAllSports();
  cache = { key, at: Date.now(), entries };
  return entries;
}

function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function attr(text: string): string {
  return sanitize(text).replace(/"/g, "'");
}

export function renderM3u(entries: PlaylistEntry[], origin: string): string {
  const lines = ["#EXTM3U"];
  for (const entry of entries) {
    const slot = `${entry.sportType}:${entry.matchId}`;
    const tuneUrl = `${origin}/api/hls?slot=${encodeURIComponent(slot)}`;
    lines.push(
      `#EXTINF:-1 tvg-id="fctv33-${entry.sportType}-${entry.matchId}" tvg-name="${attr(entry.name)}" group-title="${attr(entry.group)}",${sanitize(entry.name)}`,
      tuneUrl,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function playlistResponse(request: Request, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const sportTypeRaw = url.searchParams.get("sportType");
  if (sportTypeRaw != null && !/^\d+$/.test(sportTypeRaw)) {
    return Response.json({ error: "invalid sportType" }, { status: 400 });
  }
  try {
    const entries = await collectEntries(sportTypeRaw);
    const headers: Record<string, string> = {
      "Content-Type": "audio/x-mpegurl; charset=utf-8",
      "Cache-Control": "no-store",
    };
    if (url.searchParams.has("download")) {
      headers["Content-Disposition"] = 'attachment; filename="fctv33-live.m3u"';
    }
    return new Response(renderM3u(entries, origin), { status: 200, headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "playlist failed" },
      { status: 502 },
    );
  }
}
