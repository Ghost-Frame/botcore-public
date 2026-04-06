import type { CachedMessage } from "../types";

const MAX_CACHE_SIZE = 50;

export function createMessageCache() {
  const cache: Map<string, CachedMessage[]> = new Map();

  function cacheMessage(channelId: string, msg: CachedMessage): void {
    if (!cache.has(channelId)) cache.set(channelId, []);
    const ch = cache.get(channelId)!;
    ch.push(msg);
    if (ch.length > MAX_CACHE_SIZE) ch.splice(0, ch.length - MAX_CACHE_SIZE);
  }

  function getCachedMessage(channelId: string, messageId: string): CachedMessage | null {
    const ch = cache.get(channelId);
    if (!ch) return null;
    return ch.find(m => m.id === messageId) || null;
  }

  function clear(channelId: string): void {
    cache.delete(channelId);
  }

  return { cacheMessage, getCachedMessage, clear };
}

export type MessageCache = ReturnType<typeof createMessageCache>;
