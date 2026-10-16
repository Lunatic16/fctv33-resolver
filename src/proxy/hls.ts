import { ApiClient } from "../api/client.js";
import { USER_AGENT } from "../config/site.js";
import { fetchCslSegment, isCslSegmentUrl, type CslConfig, type CslGeo } from "./csl.js";
import { getSlotStream, isSlotKey } from "./slots.js";

const CORS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
} as const;

export type ProxyContext = {
  referer: string;
  country?: string;
  continent?: string;
  salt?: string;
  maxRetryTimes?: string;
  minFetchTimeout?: string;
};

export function buildProxyUrl(streamUrl: string, context: ProxyContext, origin: string): string {
  const params = new URLSearchParams({ url: streamUrl, referer: context.referer });
  if (context.country) params.set("country", context.country);
  if (context.continent) params.set("continent", context.continent);
  if (context.salt) params.set("salt", context.salt);
  if (context.maxRetryTimes) params.set("maxRetryTimes", context.maxRetryTimes);
  if (context.minFetchTimeout) params.set("minFetchTimeout", context.minFetchTimeout);
  return `${origin.replace(/\/$/, "")}/api/hls?${params}`;
}

function optionalParam(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) ?? undefined;
}

function proxyContextFromRequest(url: URL): ProxyContext {
  const context: ProxyContext = { referer: url.searchParams.get("referer") ?? "" };
  const country = optionalParam(url, "country");
  const continent = optionalParam(url, "continent");
  const salt = optionalParam(url, "salt");
  const maxRetryTimes = optionalParam(url, "maxRetryTimes");
  const minFetchTimeout = optionalParam(url, "minFetchTimeout");
  if (country) context.country = country;
  if (continent) context.continent = continent;
  if (salt) context.salt = salt;
  if (maxRetryTimes) context.maxRetryTimes = maxRetryTimes;
  if (minFetchTimeout) context.minFetchTimeout = minFetchTimeout;
  return context;
}

function rewriteManifest(body: string, targetUrl: string, context: ProxyContext, origin: string): string {
  const base = new URL(targetUrl);
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return buildProxyUrl(new URL(trimmed, base).href, context, origin);
    })
    .join("\n");
}

async function resolveCslConfig(context: ProxyContext): Promise<CslConfig> {
  if (context.salt) {
    return {
      salt: context.salt,
      maxRetryTimes: Number(context.maxRetryTimes ?? 2) || 2,
      minFetchTimeout: Number(context.minFetchTimeout ?? 3.2) || 3.2,
    };
  }
  return new ApiClient().resolveCslConfig();
}

function geoFromContext(context: ProxyContext): CslGeo | undefined {
  if (!context.country && !context.continent) return undefined;
  const geo: CslGeo = {};
  if (context.country) geo.country = context.country;
  if (context.continent) geo.continent = context.continent;
  return geo;
}

async function fetchUpstream(targetUrl: string, context: ProxyContext): Promise<Buffer> {
  if (isCslSegmentUrl(targetUrl)) {
    return fetchCslSegment(targetUrl, context.referer, await resolveCslConfig(context), geoFromContext(context));
  }
  const response = await fetch(targetUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: context.referer,
      Origin: context.referer.replace(/\/$/, ""),
    },
    redirect: "follow",
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status < 200 || response.status >= 300 || !body.length) {
    throw new Error(`upstream ${response.status}`);
  }
  return body;
}

export async function proxyHls(request: Request, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const slot = url.searchParams.get("slot");
  try {
    let targetUrl: string;
    let context: ProxyContext;
    if (slot !== null) {
      if (!isSlotKey(slot)) {
        return Response.json({ error: "invalid slot" }, { status: 400 });
      }
      // Slot mode: resolve lazily at tune-in time, never bake CDN tokens.
      ({ streamUrl: targetUrl, context } = await getSlotStream(slot));
    } else {
      const rawUrl = url.searchParams.get("url");
      const rawContext = proxyContextFromRequest(url);
      if (!rawUrl || !rawContext.referer) {
        return Response.json({ error: "url and referer required" }, { status: 400 });
      }
      targetUrl = rawUrl;
      context = rawContext;
    }
    const manifest = targetUrl.includes(".m3u8");
    let body: Buffer;
    try {
      body = await fetchUpstream(targetUrl, context);
    } catch (error) {
      // Expired slot: re-unlock once and retry the manifest fetch. Segments
      // fail with 502 instead — the player re-fetches the playlist, which
      // self-heals through the slot.
      if (!slot || !manifest) throw error;
      ({ streamUrl: targetUrl, context } = await getSlotStream(slot, { refresh: true }));
      body = await fetchUpstream(targetUrl, context);
    }
    const head = body.subarray(0, Math.min(body.length, 256)).toString("utf8");
    if (head.includes("#EXTM3U") || manifest) {
      return new Response(rewriteManifest(body.toString("utf8"), targetUrl, context, origin), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { ...CORS, "Content-Type": "video/mp2t" },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "upstream failed", {
      status: 502,
      headers: CORS,
    });
  }
}
