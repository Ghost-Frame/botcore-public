import type { ChannelEvent, ConversationFlow } from "../types";

const MAX_EVENTS = 20;
const CONVERSATION_WINDOW_MS = 120_000;

export function createFlowTracker(getSelfId: () => string | null) {
  const channelEvents: Map<string, ChannelEvent[]> = new Map();

  function trackEvent(channelId: string, userId: string, username: string, isBot: boolean): void {
    if (!channelEvents.has(channelId)) channelEvents.set(channelId, []);
    const events = channelEvents.get(channelId)!;
    events.push({ userId, username, isBot, time: Date.now() });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function getConversationFlow(channelId: string): ConversationFlow {
    const events = channelEvents.get(channelId) || [];
    const now = Date.now();
    const recent = events.filter(e => now - e.time < CONVERSATION_WINDOW_MS);

    if (recent.length < 3) {
      return { isActiveDyad: false, involvesSelf: false, participants: [] };
    }

    const counts = new Map<string, { username: string; count: number }>();
    for (const e of recent) {
      const existing = counts.get(e.userId);
      if (existing) existing.count++;
      else counts.set(e.userId, { username: e.username, count: 1 });
    }

    const sorted = [...counts.entries()]
      .map(([userId, data]) => ({ userId, username: data.username, count: data.count }))
      .sort((a, b) => b.count - a.count);

    if (sorted.length >= 2) {
      const top2Count = sorted[0].count + sorted[1].count;
      if (top2Count >= recent.length * 0.75 && sorted[0].count >= 2 && sorted[1].count >= 2) {
        const selfId = getSelfId();
        const involvesSelf = sorted[0].userId === selfId || sorted[1].userId === selfId;
        return { isActiveDyad: true, involvesSelf, participants: sorted };
      }
    }

    return { isActiveDyad: false, involvesSelf: false, participants: sorted };
  }

  function clearChannel(channelId: string): void {
    channelEvents.delete(channelId);
  }

  return { trackEvent, getConversationFlow, clearChannel };
}

export type FlowTracker = ReturnType<typeof createFlowTracker>;
