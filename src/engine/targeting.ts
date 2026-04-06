import type { PendingMessage } from "../types";
import type { MessageCache } from "./cache";
import type { FlowTracker } from "./flow";

export interface TargetingConfig {
  botName: string;
  ownerUserId: string;
  peerBots: string[];
  peerIds: string[];
}

export function createTargeting(
  config: TargetingConfig,
  cache: MessageCache,
  flow: FlowTracker,
  getSelfId: () => string | null,
) {
  const { botName, ownerUserId, peerBots, peerIds } = config;
  const botNameLower = botName.toLowerCase();

  function isAddressedToOther(
    batch: PendingMessage[],
    channelId: string,
  ): { addressed: boolean; reason: string } {
    const combinedText = batch.map(m => m.content).join(" ").toLowerCase();
    const selfId = getSelfId();

    // 1. Discord reply -- strongest signal
    for (const msg of batch) {
      if (msg.referencedMessageId) {
        const ref = cache.getCachedMessage(channelId, msg.referencedMessageId);
        if (ref) {
          if (ref.author_id === selfId) {
            return { addressed: false, reason: "" };
          }
          return { addressed: true, reason: `reply to ${ref.author_username}` };
        }
      }
    }

    // 2. Message mentions a peer bot by name but not this bot
    const mentionsThisBot = combinedText.includes(botNameLower);
    if (!mentionsThisBot && peerBots.length > 0) {
      const peerMentioned = peerBots.find(name => {
        const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return regex.test(combinedText);
      });
      if (peerMentioned) return { addressed: true, reason: `mentions ${peerMentioned}` };
    }

    // 3. Active conversation dyad that doesn't include this bot
    const convFlow = flow.getConversationFlow(channelId);
    if (convFlow.isActiveDyad && !convFlow.involvesSelf) {
      return {
        addressed: true,
        reason: `active conversation between ${convFlow.participants[0]?.username} and ${convFlow.participants[1]?.username}`,
      };
    }

    return { addressed: false, reason: "" };
  }

  function isDirectlyAddressed(batch: PendingMessage[], channelId: string): boolean {
    const selfId = getSelfId();
    return batch.some(m => {
      if (m.content.toLowerCase().includes(botNameLower)) return true;
      if (selfId && m.mentionedUserIds.includes(selfId)) return true;
      if (m.referencedMessageId) {
        const ref = cache.getCachedMessage(channelId, m.referencedMessageId);
        if (ref?.author_id === selfId) return true;
      }
      // Owner's messages count UNLESS clearly directed at another bot
      if (m.userId === ownerUserId) {
        if (m.referencedMessageId) {
          const ref = cache.getCachedMessage(channelId, m.referencedMessageId);
          if (ref && ref.author_id !== selfId && peerIds.includes(ref.author_id)) return false;
        }
        const textLower = m.content.toLowerCase();
        const mentionsThis = textLower.includes(botNameLower);
        if (!mentionsThis) {
          const mentionsPeer = peerBots.some(name => {
            const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            return regex.test(textLower);
          });
          if (mentionsPeer) return false;
        }
        return true;
      }
      return false;
    });
  }

  function pickReplyTarget(batch: PendingMessage[], channelId: string): PendingMessage {
    const selfId = getSelfId();

    // Priority 1: Discord reply to this bot
    for (const m of batch) {
      if (m.referencedMessageId) {
        const ref = cache.getCachedMessage(channelId, m.referencedMessageId);
        if (ref?.author_id === selfId) return m;
      }
    }

    // Priority 2: @mention of this bot
    if (selfId) {
      const mention = batch.find(m => m.mentionedUserIds.includes(selfId));
      if (mention) return mention;
    }

    // Priority 3: Mentions this bot by name
    const byName = batch.find(m => m.content.toLowerCase().includes(botNameLower));
    if (byName) return byName;

    // Priority 4: Owner's message
    const ownerMsg = batch.find(m => m.userId === ownerUserId);
    if (ownerMsg) return ownerMsg;

    // Priority 5: Last human message
    const humans = batch.filter(m => !m.isBot);
    if (humans.length > 0) return humans[humans.length - 1];

    return batch[batch.length - 1];
  }

  return { isAddressedToOther, isDirectlyAddressed, pickReplyTarget };
}

export type Targeting = ReturnType<typeof createTargeting>;
