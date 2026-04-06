import type { LLMClient } from "../core/llm";

export function createReactionPicker(botName: string, llm: LLMClient) {
  async function pickReaction(messageContent: string, authorName: string): Promise<string | null> {
    const reactionPrompt = `You are ${botName}. Someone in Discord said something. You may react with a SINGLE emoji, or say NONE if no reaction fits.

Rules:
- Reply with ONLY one emoji character, or the word NONE
- Pick an emoji that fits the message naturally
- No text, no explanation, just the emoji or NONE`;

    try {
      const res = await llm.chat([
        { role: "system", content: reactionPrompt },
        { role: "user", content: `[${authorName}] ${messageContent}` },
      ]);

      if (!res.content || res.error) return null;
      const trimmed = res.content.trim();
      if (trimmed === "NONE" || trimmed === "none" || trimmed.length > 10) return null;
      if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(trimmed)) {
        const match = trimmed.match(
          /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]+/u,
        );
        return match ? match[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  return { pickReaction };
}

export type ReactionPicker = ReturnType<typeof createReactionPicker>;
