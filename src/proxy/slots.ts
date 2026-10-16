import { resolveStream } from "../handlers/resolve.js";
import type { ProxyContext } from "./hls.js";

/**
 * Slot cache: stable `sportType:matchId` keys that resolve lazily at tune-in
 * time, so playlist entries never bake short-lived CDN tokens. Live playlist
 * refreshes reuse the cached upstream URL; a failed manifest fetch forces one
 * re-unlock (upstream tokens rotate without notice).
 */

const SLOT_TTL_MS = 10 * 60 * 1000;
const SLOT_LIMIT = 256;

export type SlotStream = { streamUrl: string; context: ProxyContext; resolvedAt: number };

export function isSlotKey(value: string): boolean {
  return /^\d+:\d+$/.test(value);
}

const slots = new Map<string, SlotStream>();
const inflight = new Map<string, Promise<SlotStream>>();

async function resolveSlot(key: string): Promise<SlotStream> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const [sportTypeRaw, matchId] = key.split(":");
    if (!sportTypeRaw || !matchId) throw new Error("invalid slot");
    const resolved = await resolveStream(matchId, Number(sportTypeRaw));
    if (slots.size >= SLOT_LIMIT && !slots.has(key)) {
      const oldest = slots.keys().next();
      if (!oldest.done) slots.delete(oldest.value);
    }
    const entry: SlotStream = {
      streamUrl: resolved.streamUrl,
      context: resolved.context,
      resolvedAt: Date.now(),
    };
    slots.set(key, entry);
    return entry;
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export async function getSlotStream(key: string, options?: { refresh?: boolean }): Promise<SlotStream> {
  const cached = slots.get(key);
  if (!options?.refresh && cached && Date.now() - cached.resolvedAt < SLOT_TTL_MS) return cached;
  return resolveSlot(key);
}
