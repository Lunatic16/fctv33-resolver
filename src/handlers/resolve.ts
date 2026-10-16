import { ApiClient } from "../api/client.js";
import { buildSignedStreamUrl } from "../crypto/stream-token.js";
import type { ProxyContext } from "../proxy/hls.js";

export type ResolvedStream = {
  name: string;
  matchId: string;
  sportType: number;
  streamUrl: string;
  referer: string;
  context: ProxyContext;
};

/**
 * Full unlock chain for one match: geo, detail, player referer, CSL config,
 * stream detail, and the signed tokenized CDN playlist URL. Throws with a
 * human-readable message on any upstream failure.
 */
export async function resolveStream(matchId: string, sportType: number): Promise<ResolvedStream> {
  const client = new ApiClient();
  const [geo, match, playerReferer, csl] = await Promise.all([
    client.fetchUserGeo(),
    client.fetchMatchDetail(matchId, sportType),
    client.resolvePlayerReferer(),
    client.resolveCslConfig(),
  ]);
  const stream = match.stream.find((item) => item.streamId);
  if (!stream?.streamId) throw new Error("no stream on match");
  if (stream.siteType == null) throw new Error("stream missing site type");
  const detail = await client.fetchStreamDetail({
    streamId: stream.streamId,
    matchId,
    sportType,
    siteType: stream.siteType,
    ...(geo.country ? { country: geo.country } : {}),
    ...(geo.continent ? { continent: geo.continent } : {}),
  });
  if (!detail.stream.url) throw new Error("stream detail missing url");
  const streamUrl = buildSignedStreamUrl(detail.stream.url, detail.sessionToken);
  const context: ProxyContext = {
    referer: playerReferer,
    ...(geo.country ? { country: geo.country } : {}),
    ...(geo.continent ? { continent: geo.continent } : {}),
    salt: csl.salt,
    maxRetryTimes: String(csl.maxRetryTimes),
    minFetchTimeout: String(csl.minFetchTimeout),
  };
  return {
    name: stream.name ?? "",
    matchId,
    sportType,
    streamUrl,
    referer: playerReferer,
    context,
  };
}
