import type { DiscordTransport } from "../types";
import type { MessageDB } from "../core/db";
import type { LLMClient } from "../core/llm";
import type { FlowTracker } from "./flow";
import type { StateManager } from "./state";
import { buildContextMessages } from "../core/context";
import { isNoReply, sanitizeOutput, splitMessage } from "../core/sanitize";

export interface SpontaneousConfig {
  botName: string;
  minMs?: number;
  maxMs?: number;
  minSilenceMs?: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function createSpontaneous(
  config: SpontaneousConfig,
  transport: DiscordTransport,
  db: MessageDB,
  llm: LLMClient,
  stateManager: StateManager,
  flowTracker: FlowTracker,
) {
  const {
    botName,
    minMs = 1_800_000,
    maxMs = 10_800_000,
    minSilenceMs = 300_000,
  } = config;

  function schedule(channelId: string): void {
    const state = stateManager.getChannelState(channelId);
    if (state.spontaneousTimer) clearTimeout(state.spontaneousTimer);
    const delay = randomInt(minMs, maxMs);
    state.spontaneousTimer = setTimeout(() => trySpontaneous(channelId), delay);
  }

  async function trySpontaneous(channelId: string): Promise<void> {
    const state = stateManager.getChannelState(channelId);
    const silenceMs = Date.now() - state.lastActivity;

    if (silenceMs < minSilenceMs || state.processing) {
      schedule(channelId);
      return;
    }

    try {
      const spontPrompt = `You are ${botName}. The Discord channel has been quiet for a while. You may post a brief, spontaneous message -- something in-character that feels natural, like a thought you just had or a random observation. Keep it short (1-2 sentences max).

If you can't think of anything good or natural, respond with NO_REPLY. Quality over quantity.`;

      const history = db.getHistory(channelId, 10);
      const messages = buildContextMessages(spontPrompt, history);
      const response = await llm.chat(messages);

      if (!response.content || response.error || isNoReply(response.content)) {
        schedule(channelId);
        return;
      }

      const cleaned = sanitizeOutput(response.content);
      if (!cleaned) {
        schedule(channelId);
        return;
      }

      const selfId = transport.getSelfId();
      db.addMessage(channelId, selfId || "self", botName, "assistant", cleaned);
      state.lastResponse = { content: cleaned, time: Date.now() };
      state.lastActivity = Date.now();
      if (selfId) flowTracker.trackEvent(channelId, selfId, botName, true);

      const chunks = splitMessage(cleaned);
      for (const chunk of chunks) {
        await transport.sendMessage(channelId, chunk);
        if (chunks.length > 1) await new Promise(r => setTimeout(r, 800));
      }

      console.log(`[${channelId}] ${botName} posted spontaneously`);
    } catch (err: any) {
      console.error(`Spontaneous message error: ${err.message}`);
    }

    schedule(channelId);
  }

  return { schedule };
}

export type SpontaneousScheduler = ReturnType<typeof createSpontaneous>;
