import type { PendingMessage } from "../types";
import type { FlowTracker } from "./flow";
import type { Targeting } from "./targeting";

export function createHintBuilder(
  botName: string,
  flow: FlowTracker,
  targeting: Targeting,
  getSelfId: () => string | null,
) {
  function buildConversationHint(channelId: string, batch: PendingMessage[]): string {
    const convFlow = flow.getConversationFlow(channelId);
    const selfId = getSelfId();
    const lines: string[] = [];

    if (convFlow.participants.length > 0) {
      const roster = convFlow.participants
        .filter(p => p.userId !== selfId)
        .slice(0, 8)
        .map(p => `  ${p.userId} = ${p.username}`)
        .join("\n");
      if (roster) {
        lines.push(
          `People in this conversation (use these to identify who is talking by their sender_id):\n${roster}`,
        );
      }
    }

    if (convFlow.isActiveDyad && !convFlow.involvesSelf) {
      lines.push(
        `${convFlow.participants[0]?.username} and ${convFlow.participants[1]?.username} are having a conversation. ` +
          `You're not part of it -- only chime in if you have something genuinely relevant or in-character to add.`,
      );
    }

    const directlyAddr = targeting.isDirectlyAddressed(batch, channelId);
    if (directlyAddr) {
      const addresser = batch.find(m => {
        if (m.content.toLowerCase().includes(botName.toLowerCase())) return true;
        if (selfId && m.mentionedUserIds.includes(selfId)) return true;
        if (m.referencedMessageId) return true;
        return false;
      });
      if (addresser) {
        lines.push(`You are being addressed by ${addresser.username}. Respond to them directly.`);
      }
    } else {
      lines.push(
        `You were NOT directly addressed or mentioned. Only respond if you have something genuinely ` +
          `relevant, funny, or in-character to contribute. Otherwise, respond with NO_REPLY.`,
      );
    }

    if (lines.length === 0) return "";
    return `<conversation-awareness>\n${lines.join("\n")}\n</conversation-awareness>`;
  }

  return { buildConversationHint };
}

export type HintBuilder = ReturnType<typeof createHintBuilder>;
