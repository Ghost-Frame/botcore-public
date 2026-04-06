import type { ChatMessage, LLMResponse } from "../types";

export interface LLMConfig {
  url: string;
  unixSocket?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export function createLLM(config: LLMConfig) {
  const {
    url,
    unixSocket,
    model,
    maxTokens = 500,
    temperature = 0.9,
    timeoutMs = 120_000,
  } = config;

  async function chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: any = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        }),
        signal: controller.signal,
      };

      if (unixSocket) {
        fetchOptions.unix = unixSocket;
      }

      const res = await fetch(url, fetchOptions);

      if (!res.ok) {
        const text = await res.text();
        return { content: "", error: `Adapter error ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content?.trim() || "";
      return { content };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { content: "", error: `LLM request timed out (${timeoutMs / 1000}s)` };
      }
      return { content: "", error: `LLM error: ${err.message}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { chat };
}

export type LLMClient = ReturnType<typeof createLLM>;
