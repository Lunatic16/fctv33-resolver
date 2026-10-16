import { createHash } from "node:crypto";

import { USER_AGENT } from "../config/site.js";
import { rot13 } from "../crypto/rot13.js";

export type CslGeo = { country?: string; continent?: string };

export type CslConfig = {
  salt: string;
  maxRetryTimes: number;
  minFetchTimeout: number;
};

type CtuItem = { ccode: string; url: string; timeoutSec: number };

export function isCslSegmentUrl(url: string): boolean {
  try {
    return new URL(url).searchParams.has("_ctump");
  } catch {
    return false;
  }
}

function decodeCslParam(value: string | null): string {
  if (!value) return "";
  return Buffer.from(rot13(decodeURIComponent(value.slice(8))), "base64").toString("utf8");
}

function signCtuUrl(rawUrl: string, salt: string): string {
  const parsed = new URL(rawUrl);
  const file = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  const ver = parsed.searchParams.get("_ver") ?? "";
  parsed.searchParams.set(
    "_s2",
    createHash("md5").update(`${file},${ver},${salt}`, "utf8").digest("hex"),
  );
  return parsed.toString();
}

function parseCtuItems(segmentUrl: string, salt: string): CtuItem[] {
  const parsed = new URL(segmentUrl);
  const ctump = decodeCslParam(parsed.searchParams.get("_ctump"));
  const ctuph = decodeCslParam(parsed.searchParams.get("_ctuph"));
  const ctutt = Number(decodeCslParam(parsed.searchParams.get("_ctutt")));
  const timeoutSec = Number.isFinite(ctutt) && ctutt > 0 ? ctutt : 3.2;
  const items: CtuItem[] = [];
  for (const part of ctump.split(",")) {
    const [ccode, rest = ""] = part.split(":");
    const host = rest.split("@")[1];
    if (!ccode || !host) continue;
    items.push({ ccode, url: signCtuUrl(`https://${host}${ctuph}`, salt), timeoutSec });
  }
  return items;
}

function orderCtuItems(items: CtuItem[], geo?: CslGeo): CtuItem[] {
  const ordered: CtuItem[] = [];
  const seen = new Set<string>();
  const push = (item: CtuItem | undefined) => {
    if (!item || seen.has(item.url)) return;
    seen.add(item.url);
    ordered.push(item);
  };
  if (geo?.continent && geo.country) {
    push(items.find((item) => item.ccode === `${geo.continent}-${geo.country}`));
  }
  if (geo?.continent) push(items.find((item) => item.ccode === geo.continent));
  push(items.find((item) => item.ccode === "WW"));
  for (const item of items) push(item);
  return ordered;
}

export function resolveCtuUrl(segmentUrl: string, salt: string, geo?: CslGeo): string | null {
  return orderCtuItems(parseCtuItems(segmentUrl, salt), geo)[0]?.url ?? null;
}

export async function fetchCslSegment(
  segmentUrl: string,
  referer: string,
  config: CslConfig,
  geo?: CslGeo,
): Promise<Buffer> {
  const items = orderCtuItems(parseCtuItems(segmentUrl, config.salt), geo);
  if (!items.length) throw new Error("csl ctu list empty");
  const origin = referer.replace(/\/$/, "");
  const attempts = Math.min(items.length, Math.max(1, config.maxRetryTimes + 1));
  let lastError: Error | null = null;
  for (let index = 0; index < attempts; index++) {
    const item = items[index]!;
    const timeoutMs = Math.max(config.minFetchTimeout, item.timeoutSec) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(item.url, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: referer,
          Origin: origin,
          Accept: "*/*",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (response.status >= 200 && response.status < 300 && body.length) return body;
      lastError = new Error(`ctu ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("ctu failed");
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("csl failed");
}
