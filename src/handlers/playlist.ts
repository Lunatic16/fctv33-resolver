import { ApiClient } from "../api/client.js";
import { SPORT_LABELS } from "../config/site.js";

/**
 * Dynamic IPTV playlist: every live match as one channel whose URL is the
 * slot relay (`/api/hls?slot=sportType:matchId`), never a resolved CDN URL.
 * Entries unlock fresh at tune-in, and live playlist refreshes reuse the
 * cached slot until it expires. The live-list sweep is cached briefly so IPTV
 * clients polling the playlist do not hammer the upstream catalog.
 */

const LIST_TTL_MS = 15_000;

type PlaylistEntry = { sportType: number; matchId: number; name: string; group: string };

let sharedClient: ApiClient | null = null;

let cache: { key: string; at: number; entries: PlaylistEntry[] } | null = null;

async function collectEntries(sportTypeRaw: string | null): Promise<PlaylistEntry[]> {
  const key = sportTypeRaw ?? "all";
  if (cache && cache.key === key && Date.now() - cache.at < LIST_TTL_MS) return cache.entries;
  const sports = SPORT_LABELS.filter((sport) => !sportTypeRaw || sport.type === Number(sportTypeRaw));
  const settled = await Promise.allSettled(
    sports.map(async (sport) => {
      sharedClient ??= new ApiClient();
      const matches = await sharedClient.fetchLiveMatches(sport.type);
      return matches.map((match) => ({
        sportType: sport.type,
        matchId: match.matchId,
        name: match.name || `Match ${match.matchId}`,
        group: sport.label,
      }));
    }),
  );
  const entries = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (!entries.length) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) {
      throw failure.reason instanceof Error ? failure.reason : new Error("live list failed");
    }
  }
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
