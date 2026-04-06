import type { StoredMessage, ChatMessage } from "../types";

export interface ContextConfig {
  maxContextChars?: number;
}

export function buildContextMessages(
  systemPrompt: string,
  history: StoredMessage[],
  extraContext?: string,
  config?: ContextConfig,
): ChatMessage[] {
  const maxChars = config?.maxContextChars ?? 400_000;
  const messages: ChatMessage[] = [];

  messages.push({ role: "system", content: systemPrompt });

  if (extraContext) {
    messages.push({ role: "system", content: extraContext });
  }

  const systemChars = systemPrompt.length + (extraContext?.length || 0);
  const budgetChars = maxChars - systemChars;

  let totalChars = 0;
  let cutoffIndex = history.length;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgChars = msg.content.length + (msg.username?.length || 0) + 20;
    if (totalChars + msgChars > budgetChars) {
      cutoffIndex = i + 1;
      break;
    }
    totalChars += msgChars;
    if (i === 0) cutoffIndex = 0;
  }

  for (let i = cutoffIndex; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    } else {
      messages.push({ role: "user", content: `[${msg.username}] ${msg.content}` });
    }
  }

  return messages;
}
