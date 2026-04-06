// =============================================================================
// botcore/src/types.ts -- All shared interfaces
// =============================================================================

/** Transport abstraction -- lets engine work with both gateway clients and discord.js */
export interface DiscordTransport {
  sendMessage(channelId: string, content: string, replyToId?: string, ping?: boolean): Promise<string | null>;
  sendTyping(channelId: string): Promise<void>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<boolean>;
  getSelfId(): string | null;
}

/** Message stored in SQLite history */
export interface StoredMessage {
  role: "user" | "assistant";
  user_id: string;
  username: string;
  content: string;
  created_at: number;
}

/** LLM chat message */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** LLM response */
export interface LLMResponse {
  content: string;
  error?: string;
}

/** Pending message in the debounce queue */
export interface PendingMessage {
  userId: string;
  username: string;
  content: string;
  messageId: string;
  referencedMessageId?: string;
  isBot: boolean;
  mentionedUserIds: string[];
  attachments?: any[];
}

/** Cached message for reply detection */
export interface CachedMessage {
  id: string;
  author_id: string;
  author_username: string;
}

/** Per-channel state */
export interface ChannelState {
  pendingMessages: PendingMessage[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
  processing: boolean;
  lastResponse: { content: string; time: number } | null;
  lastActivity: number;
  consecutiveBotMessages: number;
  spontaneousTimer: ReturnType<typeof setTimeout> | null;
}

/** Channel event for conversation flow tracking */
export interface ChannelEvent {
  userId: string;
  username: string;
  isBot: boolean;
  time: number;
}

/** Conversation flow analysis result */
export interface ConversationFlow {
  isActiveDyad: boolean;
  involvesSelf: boolean;
  participants: Array<{ userId: string; username: string; count: number }>;
}

/** Moderation action parsed from LLM output */
export interface BotAction {
  type: "add_role" | "remove_role" | "kick" | "ban";
  target: string;
  role?: string;
  reason?: string;
}

/** Guild role info */
export interface GuildRole {
  id: string;
  name: string;
  position: number;
}

/** Bot configuration -- all env vars resolved by the consumer */
export interface BotConfig {
  botName: string;
  token: string;
  ownerUserId: string;
  channelIds: string[];
  guildId: string;

  // LLM
  llmUrl: string;
  llmUnixSocket?: string;
  llmModel: string;
  llmMaxTokens?: number;
  llmTemperature?: number;
  llmTimeoutMs?: number;

  // Database
  dbPath: string;
  contextWindow?: number;

  // Memory
  memoryUrl?: string;
  memoryToken?: string;
  botSource?: string;

  // Persona
  personaPath: string;
  growthPath: string;

  // Behavior tuning
  debounceMs?: number;
  debounceJitterMs?: number;
  responseChance?: number;
  addressedOtherChance?: number;
  cooldownMs?: number;
  cooldownMultiplier?: number;
  reactionChance?: number;
  reactAndReplyChance?: number;
  spontaneousMinMs?: number;
  spontaneousMaxMs?: number;
  maxBotChain?: number;
  botResponseChance?: number;
  nemesisId?: string;

  // Peer awareness
  peerBots: string[];
  peerIds: string[];
}

/** Hook points for consumer customization */
export interface BotHooks {
  /** Gate: return false to skip this batch entirely */
  onBeforeProcess?(channelId: string, batch: PendingMessage[]): boolean;
  /** Modify or suppress response. Return null to suppress. */
  onBeforeSend?(channelId: string, response: string, batch: PendingMessage[]): string | null | Promise<string | null>;
  /** Post-send callback (logging, capture, etc.) */
  onAfterSend?(channelId: string, response: string, batch: PendingMessage[]): void;
  /** Inject extra system prompt content (e.g., moderation context) */
  buildExtraSystemPrompt?(channelId: string, batch: PendingMessage[]): string;
  /** Override context building entirely */
  buildExtraContext?(channelId: string, batch: PendingMessage[], defaultCtx: string): string;
  /** Custom command handler. Return true if handled. */
  onCommand?(channelId: string, msg: PendingMessage): Promise<boolean>;
  /** Enrich message content (e.g., add sender_id prefix) */
  enrichContent?(msg: PendingMessage): string;
  /** Override channel filtering (e.g., accept ticket threads). Return true to allow. */
  isChannelAllowed?(channelId: string): boolean;
}
