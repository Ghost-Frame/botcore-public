import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import type { LLMClient } from "./llm";

export interface GrowthConfig {
  growthPath: string;
  botName: string;
  maxGrowthBytes?: number;
  reflectionChance?: number;
  minConversationLength?: number;
}

export function createGrowth(config: GrowthConfig, llm: LLMClient) {
  const {
    growthPath,
    botName,
    maxGrowthBytes = 16_000,
    reflectionChance = 0.15,
    minConversationLength = 4,
  } = config;

  function shouldReflect(conversationLength: number): boolean {
    if (conversationLength < minConversationLength) return false;
    return Math.random() < reflectionChance;
  }

  function readGrowth(): string {
    try {
      if (existsSync(growthPath)) return readFileSync(growthPath, "utf-8");
    } catch {}
    return "";
  }

  function appendGrowth(entry: string): void {
    try {
      if (!existsSync(growthPath)) {
        writeFileSync(
          growthPath,
          `# Growth Log\n\nPersonality evolution and learnings accumulated over time.\n${entry}\n`,
          "utf-8",
        );
      } else {
        const current = readFileSync(growthPath, "utf-8");
        writeFileSync(growthPath, current + entry + "\n", "utf-8");
      }
    } catch (err: any) {
      console.error(`[growth] Failed to write GROWTH.md: ${err.message}`);
    }
  }

  async function reflect(recentMessages: string[]): Promise<string | null> {
    if (existsSync(growthPath)) {
      try {
        const stat = statSync(growthPath);
        if (stat.size >= maxGrowthBytes) {
          console.log("[growth] GROWTH.md at size limit, skipping reflection");
          return null;
        }
      } catch {}
    }

    const conversation = recentMessages.slice(-20).join("\n");

    const reflectionPrompt = `You are the internal self-reflection process for ${botName}, a Discord personality. You just participated in a conversation. Your job is to examine what happened and extract ONE useful personality growth note.

This is NOT about summarizing the conversation. This is about evolving as a character. Ask yourself:
- Did I learn something new about someone I talk to regularly?
- Did a joke land particularly well or badly?
- Did I discover a new interest, opinion, or verbal habit I want to keep?
- Did I have a memorable interaction worth remembering?
- Should I adjust how I talk to a specific person?
- Did something happen that changes how I see myself or my role?

Rules:
- Output ONE concise growth note (1-3 sentences max)
- Write in first person as ${botName}
- Be specific -- not generic advice
- If nothing interesting happened, output exactly: NOTHING
- Do NOT output meta-commentary, explanations, or multiple options
- Do NOT repeat things you already know -- only genuinely NEW observations`;

    try {
      const response = await llm.chat([
        { role: "system", content: reflectionPrompt },
        {
          role: "user",
          content: `Here's the recent conversation:\n\n${conversation}\n\nWhat did you learn or notice? One growth note, or NOTHING.`,
        },
      ]);

      if (!response.content || response.error) return null;

      const trimmed = response.content.trim();
      if (trimmed === "NOTHING" || trimmed === "nothing" || trimmed.length < 10 || trimmed.length > 500) {
        return null;
      }

      const timestamp = new Date().toISOString().split("T")[0];
      const entry = `\n- [${timestamp}] ${trimmed}`;
      appendGrowth(entry);
      console.log(`[growth] New entry: ${trimmed.slice(0, 80)}...`);
      return trimmed;
    } catch (err: any) {
      console.error(`[growth] Reflection error: ${err.message}`);
      return null;
    }
  }

  return { shouldReflect, readGrowth, reflect };
}

export type GrowthClient = ReturnType<typeof createGrowth>;
