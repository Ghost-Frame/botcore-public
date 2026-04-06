import { readFileSync, existsSync, watchFile } from "fs";
import type { GrowthClient } from "./growth";

export interface PromptConfig {
  personaPath: string;
  growthPath: string;
  botName: string;
  /** Placeholder replacements applied to persona content, e.g. { OWNER_USER_ID: "123" } */
  placeholders?: Record<string, string>;
  pollInterval?: number;
}

export function createPromptManager(config: PromptConfig, growth: GrowthClient) {
  const {
    personaPath,
    growthPath,
    botName,
    placeholders = {},
    pollInterval = 5000,
  } = config;

  const fallbackPrompt = `You are ${botName}. Be yourself.`;

  let personaContent = "";
  let cachedPrompt = "";

  function loadPersona(): string {
    try {
      return readFileSync(personaPath, "utf-8");
    } catch {
      console.error("[prompt] Persona file not found, using fallback");
      return fallbackPrompt;
    }
  }

  function rebuildPrompt(): void {
    const oldLen = cachedPrompt.length;
    const growthContent = growth.readGrowth();

    let resolved = personaContent;
    for (const [key, value] of Object.entries(placeholders)) {
      resolved = resolved.replace(new RegExp(`\{${key}\}`, "g"), value);
    }

    if (growthContent) {
      cachedPrompt =
        resolved +
        "\n\n## Growth & Learnings\n\nThese are things you've learned from past conversations. They inform your personality but are not rigid rules -- they're lived experience.\n\n" +
        growthContent;
    } else {
      cachedPrompt = resolved;
    }

    console.log(`[prompt] Rebuilt system prompt (${cachedPrompt.length} chars, was ${oldLen})`);
  }

  function getSystemPrompt(): string {
    return cachedPrompt;
  }

  // Initial load
  personaContent = loadPersona();
  rebuildPrompt();

  // Watch persona file
  watchFile(personaPath, { interval: pollInterval }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      console.log("[prompt] Persona file changed, reloading...");
      personaContent = loadPersona();
      rebuildPrompt();
    }
  });

  // Watch growth file
  function watchGrowthFile() {
    watchFile(growthPath, { interval: pollInterval }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        console.log("[prompt] GROWTH.md changed, reloading...");
        rebuildPrompt();
      }
    });
  }

  if (existsSync(growthPath)) {
    watchGrowthFile();
  } else {
    const checkInterval = setInterval(() => {
      if (existsSync(growthPath)) {
        console.log("[prompt] GROWTH.md appeared, starting watcher");
        rebuildPrompt();
        watchGrowthFile();
        clearInterval(checkInterval);
      }
    }, 30_000);
  }

  return { getSystemPrompt, rebuildPrompt };
}

export type PromptManager = ReturnType<typeof createPromptManager>;
