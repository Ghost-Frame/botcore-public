import type { ChannelState } from "../types";

export function createStateManager() {
  const channelState: Map<string, ChannelState> = new Map();

  function getChannelState(channelId: string): ChannelState {
    if (!channelState.has(channelId)) {
      channelState.set(channelId, {
        pendingMessages: [],
        debounceTimer: null,
        processing: false,
        lastResponse: null,
        lastActivity: Date.now(),
        consecutiveBotMessages: 0,
        spontaneousTimer: null,
      });
    }
    return channelState.get(channelId)!;
  }

  function resetChannel(channelId: string): void {
    const state = getChannelState(channelId);
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    if (state.spontaneousTimer) clearTimeout(state.spontaneousTimer);
    channelState.delete(channelId);
  }

  return { getChannelState, resetChannel };
}

export type StateManager = ReturnType<typeof createStateManager>;
