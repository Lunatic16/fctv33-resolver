export const ENTRY_ORIGIN = "https://www.fctv33.com";

export const PATH = {
  live: "/api/match/live",
  matchDetail: "/api/match/detail",
  streamDetail: "/api/stream/detail",
  params: "/api/common/params",
  signatures: "/api/common/bs",
  userInfo: "/api/user/info",
} as const;

export const SIGNATURE = {
  live: 0x64,
  detail: 0x66,
} as const;

export const SIGNATURE_CODES = [0x64, 0x65, 0x66, 0x67, 0x68, 0x69] as const;

export const REQUEST_PARAM_ORDER = [
  "matchId",
  "sportType",
  "language",
  "stream",
] as const;

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * sportType 0 = the site's "Live" tab: one request listing every live match
 * across all sports, each carrying its own per-match sportType.
 */
export const ALL_SPORTS_TYPE = 0;

/** sportType → human label, in the site's nav order. Used for UI tabs and IPTV group titles. */
export const SPORT_LABELS: ReadonlyArray<{ type: number; label: string }> = [
  { type: 1, label: "Football" },
  { type: 2, label: "Basketball" },
  { type: 3, label: "Tennis" },
  { type: 90, label: "Others" },
  { type: 7, label: "Motorsport" },
  { type: 8, label: "Rugby" },
  { type: 9, label: "Am. Football" },
  { type: 10, label: "Aussie Rules" },
  { type: 6, label: "Cricket" },
  { type: 11, label: "Hockey" },
  { type: 12, label: "Badminton" },
  { type: 4, label: "Baseball" },
  { type: 13, label: "Volleyball" },
  { type: 14, label: "Fighting" },
  { type: 15, label: "Cycling" },
  { type: 16, label: "Handball" },
];

const LABEL_BY_TYPE = new Map(SPORT_LABELS.map((sport) => [sport.type, sport.label]));

/** Label for a per-match sportType; unknown ids get a generic label. */
export function sportLabel(type: number): string {
  return LABEL_BY_TYPE.get(type) ?? `Sport ${type}`;
}
