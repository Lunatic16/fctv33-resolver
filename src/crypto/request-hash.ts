import { createHash } from "node:crypto";

import { REQUEST_PARAM_ORDER } from "../config/site.js";

const NUMERIC_KEYS = new Set(["sportType", "language"]);

export type RequestParams = Record<string, string | number | boolean>;

export function sortRequestParams(params: RequestParams): RequestParams {
  const normalized: RequestParams = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key] =
      typeof value === "string" && NUMERIC_KEYS.has(key) && /^\d+$/.test(value) ? Number(value) : value;
  }
  const order = new Map(REQUEST_PARAM_ORDER.map((key, index) => [key, index]));
  return Object.fromEntries(
    Object.keys(normalized)
      .sort((a, b) => (order.get(a as (typeof REQUEST_PARAM_ORDER)[number]) ?? 999) - (order.get(b as (typeof REQUEST_PARAM_ORDER)[number]) ?? 999))
      .map((key) => [key, normalized[key]!]),
  );
}

export function requestHashPrefix(params: RequestParams): string {
  return createHash("md5")
    .update(JSON.stringify(sortRequestParams(params)), "utf8")
    .digest("hex")
    .slice(0, 6);
}
