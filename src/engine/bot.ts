import type { BotConfig, BotHooks, DiscordTransport, PendingMessage, BotAction } from "../types";
import { createDB, type MessageDB } from "../core/db";
import { createLLM } from "../core/llm";
import { createGrowth } from "../core/growth";
import { createPromptManager } from "../core/prompt";
import { createMemory, type MemoryClient } from "../core/memory";
import { createLocalMemory } from "../core/local-memory";
import { createMessageCache } from "./cache";
import { createFlowTracker } from "./flow";
import { createTargeting } from "./targeting";
import { createHintBuilder } from "./hints";
import { createStateManager } from "./state";
import { createReactionPicker } from "./reactions";
import { createSpontaneous } from "./spontaneous";
import { createProcessor } from "./processor";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface CreateBotOptions {
  config: BotConfig;
  transport: DiscordTransport;
  hooks?: BotHooks;
  /** Override action execution (e.g., for discord.js bots that need different REST calls) */
  executeActions?: (actions: BotAction[]) => Promise<void>;
}

export function createBot(options: CreateBotOptions) {
  const { config, transport, hooks = {}, executeActions: customExecuteActions } = options;

  // Core services
  const db = createDB(config.dbPath);
  const llm = createLLM({
    url: config.llmUrl,
    unixSocket: config.llmUnixSocket,
    model: config.llmModel,
    maxTokens: config.llmMaxTokens,
    temperature: config.llmTemperature,
    timeoutMs: config.llmTimeoutMs,
  });
  const growthClient = createGrowth(
    { growthPath: config.growthPath, botName: config.botName },
    llm,
  );
  const promptManager = createPromptManager(
    {
      personaPath: config.personaPath,
      growthPath: config.growthPath,
      botName: config.botName,
      placeholders: { OWNER_USER_ID: config.ownerUserId },
    },
    growthClient,
  );

  let memory: MemoryClient | null = null;
  if (config.memoryUrl) {
    memory = createMemory({
      url: config.memoryUrl,
      token: config.memoryToken,
      source: config.botSource,
    });
  } else {
    memory = createLocalMemory({
      dbPath: config.dbPath,
      source: config.botSource,
    });
    console.log("[botcore] Using local SQLite memory (no memoryUrl configured)");
  }

  // Engine services
  const cache = createMessageCache();
  const flowTracker = createFlowTracker(() => transport.getSelfId());
  const targetingEngine = createTargeting(
    {
      botName: config.botName,
      ownerUserId: config.ownerUserId,
      peerBots: config.peerBots,
      peerIds: config.peerIds,
    },
    cache,
    flowTracker,
    () => transport.getSelfId(),
  );
  const hintBuilder = createHintBuilder(
    config.botName,
    flowTracker,
    targetingEngine,
    () => transport.getSelfId(),
  );
  const stateManager = createStateManager();
  const reactionPicker = createReactionPicker(config.botName, llm);
  const spontaneous = createSpontaneous(
    {
      botName: config.botName,
      minMs: config.spontaneousMinMs,
      maxMs: config.spontaneousMaxMs,
    },
    transport,
    db,
    llm,
    stateManager,
    flowTracker,
  );

  // Default action executor (no-op, consumers wire this up)
  const defaultExecuteActions = async (actions: BotAction[]) => {
    for (const a of actions) {
      console.log(`[action] ${a.type} target=${a.target} (no executor wired)`);
    }
  };

  const processor = createProcessor({
    config,
    hooks,
    transport,
    db,
    llm,
    prompt: promptManager,
    memory,
    growth: growthClient,
    cache,
    flow: flowTracker,
    targeting: targetingEngine,
    hints: hintBuilder,
    state: stateManager,
    reactions: reactionPicker,
    executeActions: customExecuteActions || defaultExecuteActions,
  });

  function start(): void {
    console.log(`[botcore] ${config.botName} engine started`);
    console.log(`[botcore] Channels: ${config.channelIds.join(", ")}`);
    for (const channelId of config.channelIds) {
      const chState = stateManager.getChannelState(channelId);
      chState.lastActivity = Date.now();
      spontaneous.schedule(channelId);
    }
  }

  function stop(): void {
    console.log(`[botcore] ${config.botName} engine stopping`);
    for (const channelId of config.channelIds) {
      stateManager.resetChannel(channelId);
    }
    db.close();
  }

  /** Handle a raw Discord gateway MESSAGE_CREATE payload  */
  function handleRawMessage(data: any): void {
    const channelId = data.channel_id;
    const allowed = config.channelIds.includes(channelId)
      || (hooks.isChannelAllowed ? hooks.isChannelAllowed(channelId) : false);
    if (!allowed) return;

    const authorId: string = data.author?.id || "";
    const isBot = !!(data.author?.bot) || config.peerIds.includes(authorId);
    const username: string = data.member?.nick || data.author?.global_name || data.author?.username || "Unknown";
    const content: string = (data.content || "").trim();
    const messageId: string = data.id || "";
    const attachments: any[] = data.attachments || [];

    if (!content && attachments.length === 0) return;

    const chState = stateManager.getChannelState(channelId);
    chState.lastActivity = Date.now();

    // Cache for reply detection
    cache.cacheMessage(channelId, { id: messageId, author_id: authorId, author_username: username });

    // Track for conversation flow
    flowTracker.trackEvent(channelId, authorId, username, isBot);

    // Skip own messages
    if (authorId === transport.getSelfId()) return;

    if (!isBot) chState.consecutiveBotMessages = 0;

    // Commands
    if (authorId === config.ownerUserId && (content.toLowerCase() === "!clear" || content.toLowerCase() === "!reset")) {
      const count = db.clearHistory(channelId);
      chState.lastResponse = null;
      chState.consecutiveBotMessages = 0;
      flowTracker.clearChannel(channelId);
      cache.clear(channelId);
      transport.sendMessage(channelId, `Memory cleared (${count} messages). Fresh start.`, messageId, false);
      return;
    }

    // Custom command hook
    const referencedMessageId = data.message_reference?.message_id as string | undefined;
    const mentionedUserIds: string[] = (data.mentions || []).map((u: any) => u.id as string);

    // Enrich content
    let enrichedContent: string;
    if (hooks.enrichContent) {
      enrichedContent = hooks.enrichContent({
        userId: authorId, username, content, messageId,
        referencedMessageId, isBot, mentionedUserIds,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
    } else {
      enrichedContent = isBot
        ? `(bot: ${username}) ${content}`
        : `(sender_id: ${authorId}) ${content}`;
    }

    const pending: PendingMessage = {
      userId: authorId,
      username,
      content: enrichedContent,
      messageId,
      referencedMessageId,
      isBot,
      mentionedUserIds,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const MAX_PENDING = 50;
    if (chState.pendingMessages.length >= MAX_PENDING) {
      console.log(`[${channelId}] Pending message cap (${MAX_PENDING}) hit, dropping oldest`);
      chState.pendingMessages.splice(0, chState.pendingMessages.length - MAX_PENDING + 1);
    }
    chState.pendingMessages.push(pending);

    // Debounce
    if (chState.debounceTimer) clearTimeout(chState.debounceTimer);
    const actualDebounce = (config.debounceMs ?? 5000) + randomInt(0, config.debounceJitterMs ?? 4000);
    chState.debounceTimer = setTimeout(() => {
      chState.debounceTimer = null;
      processor.processChannel(channelId);
    }, actualDebounce);
  }

  /** Handle a discord.js Message object */
  function handleDiscordJsMessage(msg: any): void {
    // Convert discord.js Message to raw gateway format for unified handling
    const data: any = {
      id: msg.id,
      channel_id: msg.channelId,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        global_name: msg.author.globalName || msg.author.displayName,
        bot: msg.author.bot,
      },
      member: msg.member ? { nick: msg.member.displayName || msg.member.nickname } : undefined,
      content: msg.content,
      attachments: msg.attachments ? [...msg.attachments.values()].map(a => ({
        filename: a.name,
        content_type: a.contentType,
        url: a.url,
      })) : [],
      mentions: msg.mentions?.users ? [...msg.mentions.users.values()].map(u => ({ id: u.id })) : [],
      message_reference: msg.reference ? { message_id: msg.reference.messageId } : undefined,
    };

    handleRawMessage(data);
  }

  /** Inject a message and trigger processing with minimal delay (for ticket seeding, etc.) */
  function forceProcess(channelId: string, pending: PendingMessage): void {
    const chState = stateManager.getChannelState(channelId);
    chState.pendingMessages.push(pending);
    chState.lastActivity = Date.now();
    if (chState.debounceTimer) {
      clearTimeout(chState.debounceTimer);
      chState.debounceTimer = null;
    }
    setTimeout(() => processor.processChannel(channelId), 500);
  }

  return {
    start,
    stop,
    handleRawMessage,
    handleDiscordJsMessage,
    forceProcess,
    // Expose internals for advanced consumers
    db,
    llm,
    prompt: promptManager,
    state: stateManager,
    cache,
    flow: flowTracker,
    targeting: targetingEngine,
  };
}

export type Bot = ReturnType<typeof createBot>;
