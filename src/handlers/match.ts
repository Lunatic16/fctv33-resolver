import { resolveStream } from "./resolve.js";
import { buildProxyUrl } from "../proxy/hls.js";

export async function resolveMatch(
  matchIdRaw: string | null,
  sportTypeRaw: string | null,
  origin: string,
): Promise<Response> {
  if (!matchIdRaw || !sportTypeRaw) {
    return Response.json({ error: "matchId and sportType required" }, { status: 400 });
  }
  const matchId = matchIdRaw.trim();
  const sportType = Number(sportTypeRaw);
  if (!/^\d+$/.test(matchId) || !Number.isFinite(sportType)) {
    return Response.json({ error: "invalid matchId or sportType" }, { status: 400 });
  }
  try {
    const resolved = await resolveStream(matchId, sportType);
    return Response.json({
      name: resolved.name,
      matchId,
      sportType,
      streamUrl: resolved.streamUrl,
      referer: resolved.referer,
      playableUrl: buildProxyUrl(resolved.streamUrl, resolved.context, origin),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "resolve failed" },
      { status: 502 },
    );
  }
}
