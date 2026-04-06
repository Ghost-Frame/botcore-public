import type { BotConfig, BotHooks, DiscordTransport, PendingMessage } from "../types";
import type { MessageDB } from "../core/db";
import type { LLMClient } from "../core/llm";
import type { PromptManager } from "../core/prompt";
import type { MemoryClient } from "../core/memory";
import type { GrowthClient } from "../core/growth";
import type { MessageCache } from "./cache";
import type { FlowTracker } from "./flow";
import type { Targeting } from "./targeting";
import type { HintBuilder } from "./hints";
import type { StateManager } from "./state";
import type { ReactionPicker } from "./reactions";
import { buildContextMessages } from "../core/context";
import { isNoReply, sanitizeOutput, splitMessage } from "../core/sanitize";
import { processAttachments } from "../core/attachments";
import { parseActions } from "../core/actions";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface ProcessorDeps {
  config: BotConfig;
  hooks: BotHooks;
  transport: DiscordTransport;
  db: MessageDB;
  llm: LLMClient;
  prompt: PromptManager;
  memory: MemoryClient | null;
  growth: GrowthClient;
  cache: MessageCache;
  flow: FlowTracker;
  targeting: Targeting;
  hints: HintBuilder;
  state: StateManager;
  reactions: ReactionPicker;
  executeActions: (actions: import("../types").BotAction[]) => Promise<void>;
}

export function createProcessor(deps: ProcessorDeps) {
  const {
    config, hooks, transport, db, llm, prompt, memory, growth,
    cache, flow, targeting, hints, state, reactions, executeActions,
  } = deps;

  const {
    botName,
    ownerUserId,
    responseChance = 0.4,
    addressedOtherChance = 0.08,
    cooldownMs = 60_000,
    cooldownMultiplier = 0.4,
    reactionChance = 0.15,
    reactAndReplyChance = 0.25,
    maxBotChain = 3,
    contextWindow = 60,
    botResponseChance = 0.6,
    nemesisId,
  } = config;

  async function processChannel(channelId: string): Promise<void> {
    const chState = state.getChannelState(channelId);
    if (chState.processing) return;
    const batch = chState.pendingMessages.splice(0);
    if (batch.length === 0) return;

    chState.processing = true;

    try {
      // Hook: before process gate
      if (hooks.onBeforeProcess && !hooks.onBeforeProcess(channelId, batch)) {
        for (const msg of batch) db.addMessage(channelId, msg.userId, msg.username, "user", msg.content);
        return;
      }

      const allBots = batch.every(m => m.isBot);

      // Bot chain limiter
      if (allBots) {
        if (chState.consecutiveBotMessages >= maxBotChain) {
          console.log(`[${channelId}] Bot chain limit (${chState.consecutiveBotMessages}), staying quiet`);
          for (const msg of batch) db.addMessage(channelId, msg.userId, msg.username, "user", msg.content);
          return;
        }
        if (Math.random() > botResponseChance) {
          console.log(`[${channelId}] Random skip on bot message`);
          for (const msg of batch) db.addMessage(channelId, msg.userId, msg.username, "user", msg.content);
          return;
        }
      }

      // Response chance gate
      const directlyAddr = targeting.isDirectlyAddressed(batch, channelId);

      // Nemesis always gets a response
      const isNemesis = nemesisId && batch.some(m => m.userId === nemesisId);

      if (!directlyAddr && !allBots && !isNemesis) {
        let effectiveChance = responseChance;
        const tgt = targeting.isAddressedToOther(batch, channelId);

        if (tgt.addressed) effectiveChance = addressedOtherChance;

        const timeSinceLast = chState.lastResponse ? Date.now() - chState.lastResponse.time : Infinity;
        if (timeSinceLast < cooldownMs) {
          effectiveChance *= cooldownMultiplier;
          console.log(`[${channelId}] Cooldown active (${Math.round(timeSinceLast / 1000)}s ago), chance -> ${(effectiveChance * 100).toFixed(1)}%`);
        }

        if (Math.random() > effectiveChance) {
          const reason = tgt.reason || "random chance";
          console.log(`[${channelId}] Sitting this one out (${reason}, ${(effectiveChance * 100).toFixed(1)}% chance)`);
          for (const msg of batch) db.addMessage(channelId, msg.userId, msg.username, "user", msg.content);
          return;
        } else if (tgt.reason) {
          console.log(`[${channelId}] Jumping in despite targeting (${tgt.reason})`);
        }
      }

      // Store messages in DB
      for (const msg of batch) {
        db.addMessage(channelId, msg.userId, msg.username, "user", msg.content);
      }

      // Process attachments
      for (const msg of batch) {
        if (msg.attachments && msg.attachments.length > 0) {
          const attachmentContext = await processAttachments(msg.attachments);
          if (attachmentContext) {
            msg.content += attachmentContext;
            db.addMessage(channelId, msg.userId, msg.username, "user", attachmentContext.trim());
          }
        }
      }

      const replyTarget = targeting.pickReplyTarget(batch, channelId);

      // Security: owner auth must be per-message, not per-batch.
      // If ANY non-owner human is in this batch, do not treat as owner-authorized.
      // This prevents confused-deputy attacks where an attacker's prompt injection
      // rides in the same debounce window as an owner message.
      const humanMessages = batch.filter(m => !m.isBot);
      const isOwnerCommand = directlyAddr
        && humanMessages.length > 0
        && humanMessages.every(m => m.userId === ownerUserId);

      // Reaction-only path
      if (Math.random() < reactionChance && !allBots) {
        const emoji = await reactions.pickReaction(replyTarget.content, replyTarget.username);
        if (emoji) {
          await transport.addReaction(channelId, replyTarget.messageId, emoji);
          console.log(`[${channelId}] Reacted with ${emoji} (reaction-only)`);
          return;
        }
      }

      // React-and-reply (fire and forget)
      if (Math.random() < reactAndReplyChance) {
        reactions.pickReaction(replyTarget.content, replyTarget.username).then(emoji => {
          if (emoji) transport.addReaction(channelId, replyTarget.messageId, emoji).catch(() => {});
        }).catch(() => {});
      }

      // Build extra context
      const combinedInput = batch.map(m => m.content).join(" ");
      let extraContext = "";

      // Memory recall
      if (memory) {
        const memories = await memory.recall(combinedInput, 5);
        if (memories) extraContext += `<memory-context>\n${memories}\n</memory-context>\n\n`;
      }

      // Conversation awareness hint
      const convHint = hints.buildConversationHint(channelId, batch);
      if (convHint) extraContext = convHint + "\n\n" + extraContext;

      // Anti-repeat
      const now = Date.now();
      if (chState.lastResponse && now - chState.lastResponse.time < 120_000) {
        const truncated = chState.lastResponse.content.length > 300
          ? chState.lastResponse.content.slice(0, 300) + "..."
          : chState.lastResponse.content;
        extraContext += `<anti-repeat>\nYour most recent response (${Math.round((now - chState.lastResponse.time) / 1000)}s ago):\n"${truncated}"\n\nDo NOT repeat, paraphrase, or echo the above. Say something completely different or stay silent (NO_REPLY).\n</anti-repeat>`;
      }

      // Hook: extra system prompt
      let systemPrompt = prompt.getSystemPrompt();
      if (hooks.buildExtraSystemPrompt) {
        const extra = hooks.buildExtraSystemPrompt(channelId, batch);
        if (extra) systemPrompt += "\n\n" + extra;
      }

      // Hook: extra context override
      if (hooks.buildExtraContext) {
        extraContext = hooks.buildExtraContext(channelId, batch, extraContext);
      }

      const history = db.getHistory(channelId, contextWindow);
      const messages = buildContextMessages(systemPrompt, history, extraContext || undefined);

      // Typing indicator
      await transport.sendTyping(channelId);
      const typingInterval = setInterval(() => transport.sendTyping(channelId), 8000);

      try {
        const response = await llm.chat(messages);
        clearInterval(typingInterval);

        if (!response.content || response.error || isNoReply(response.content)) {
          if (response.error) console.error(`LLM error: ${response.error}`);
          else console.log(`[${channelId}] ${botName} chose NO_REPLY`);
          return;
        }

        // Parse moderation actions
        const { cleanText: actionStripped, actions } = parseActions(response.content);
        if (actions.length > 0) {
          if (isOwnerCommand) {
            console.log(`Executing ${actions.length} moderation action(s) from owner`);
            await executeActions(actions);
          } else {
            console.log(`Ignoring ${actions.length} action(s) -- not an owner command`);
          }
        }

        let cleaned = sanitizeOutput(actionStripped);
        if (!cleaned) return;

        // Hook: before send
        if (hooks.onBeforeSend) {
          const modified = await hooks.onBeforeSend(channelId, cleaned, batch);
          if (modified === null) return;
          cleaned = modified;
        }

        const selfId = transport.getSelfId();
        db.addMessage(channelId, selfId || "self", botName, "assistant", cleaned);
        chState.lastResponse = { content: cleaned, time: Date.now() };
        chState.consecutiveBotMessages++;
        if (selfId) flow.trackEvent(channelId, selfId, botName, true);

        // Memory capture
        if (memory) {
          const captureContent = batch.map(m => `${m.username}: ${m.content}`).join("\n") + `\n${botName}: ${cleaned}`;
          memory.capture(captureContent).catch(() => {});
        }

        // Growth reflection
        const historyForReflection = db.getHistory(channelId, 20);
        if (growth.shouldReflect(historyForReflection.length)) {
          const reflInput = historyForReflection.map(m =>
            m.role === "assistant" ? `${botName}: ${m.content}` : `[${m.username}] ${m.content}`,
          );
          growth.reflect(reflInput).catch(err => console.error("[growth] reflection failed:", err.message));
        }

        // Send message chunks
        const chunks = splitMessage(cleaned);
        let sentId: string | null = null;
        for (let i = 0; i < chunks.length; i++) {
          if (i === 0) {
            sentId = await transport.sendMessage(channelId, chunks[i], replyTarget.messageId, directlyAddr);
          } else {
            await transport.sendMessage(channelId, chunks[i]);
          }
          if (chunks.length > 1) await new Promise(r => setTimeout(r, 800));
        }

        // Cache own sent message
        if (sentId && selfId) {
          cache.cacheMessage(channelId, { id: sentId, author_id: selfId, author_username: botName });
        }

        // Hook: after send
        if (hooks.onAfterSend) {
          hooks.onAfterSend(channelId, cleaned, batch);
        }

      } catch (err: any) {
        clearInterval(typingInterval);
        console.error(`LLM error in processChannel: ${err.message}`);
      }

    } catch (err: any) {
      console.error(`processChannel error [${channelId}]: ${err.message}`);
    } finally {
      chState.processing = false;
      if (chState.pendingMessages.length > 0) {
        setTimeout(() => processChannel(channelId), 1000);
      }
    }
  }

  return { processChannel };
}

export type Processor = ReturnType<typeof createProcessor>;
