import { ENTRY_ORIGIN, USER_AGENT } from "../config/site.js";

type SiteBootstrap = {
  digit: string;
  dataApiBaseUrl: string;
  entryOrigin: string;
};

let cached: SiteBootstrap | null = null;

export async function loadSiteBootstrap(): Promise<SiteBootstrap> {
  if (cached) return cached;
  const response = await fetch(`${ENTRY_ORIGIN}/`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
      Referer: `${ENTRY_ORIGIN}/`,
      Origin: ENTRY_ORIGIN,
    },
  });
  if (!response.ok) throw new Error(`entry page ${response.status}`);
  const html = await response.text();
  const match = html.match(
    /"([a-z]+)","(?:\\u002F|\/)",true,"production","https:\\u002F\\u002F(apis-data\d+\.[^"]+)"/,
  );
  if (!match?.[1] || !match[2]) throw new Error("entry bootstrap not found");
  cached = {
    digit: match[1],
    dataApiBaseUrl: `https://${match[2].replace(/\\u002F/g, "/")}`,
    entryOrigin: ENTRY_ORIGIN,
  };
  return cached;
}
