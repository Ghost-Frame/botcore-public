export interface MemoryConfig {
  url: string;
  token?: string;
  source?: string;
}

interface SearchResult {
  id: number;
  content: string;
  summary?: string;
  category: string;
  source: string;
  score?: number;
  createdAt: string;
  metadata?: Record<string, any>;
}

interface RecallResponse {
  profile: string[];
  recent: { id: number; content: string; category: string; source: string; createdAt: string }[];
  results: SearchResult[];
  crossBot?: SearchResult[];
  count: number;
}

const INFRA_PATTERNS = [
  "ssh -i", "sudo -s", "systemctl", "podman", "docker",
  "passwd", "api_key", "api_secret", "bot_token",
];

function containsInfraContent(text: string): boolean {
  const lower = text.toLowerCase();
  return INFRA_PATTERNS.some(p => lower.includes(p));
}

export function createMemory(config: MemoryConfig) {
  const { url, token, source = "discord-bot" } = config;

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function recallBasic(query: string, limit: number): Promise<string | null> {
    try {
      const res = await fetch(`${url}/memories/search`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ query, limit, source }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: SearchResult[] };
      if (!data.results?.length) return null;
      return data.results.map(m => m.content).join("\n---\n");
    } catch {
      return null;
    }
  }

  async function recall(query: string, limit: number = 5, crossBot: boolean = false): Promise<string | null> {
    try {
      const res = await fetch(`${url}/recall`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ query, limit, source, cross_bot: crossBot }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return recallBasic(query, limit);

      const data = (await res.json()) as RecallResponse;
      const parts: string[] = [];

      if (data.profile?.length) {
        parts.push("Known facts: " + data.profile.join("; "));
      }
      if (data.results?.length) {
        parts.push(data.results.map(m => m.content).join("\n---\n"));
      }
      if (data.crossBot?.length) {
        parts.push("From other bots: " + data.crossBot.map(m => `[${m.source}] ${m.content}`).join("\n"));
      }

      return parts.length ? parts.join("\n\n") : null;
    } catch (err: any) {
      console.error(`memory recall error: ${err.message}`);
      return recallBasic(query, limit);
    }
  }

  async function capture(content: string, metadata?: Record<string, any>): Promise<boolean> {
    if (containsInfraContent(content)) return false;

    try {
      const res = await fetch(`${url}/memories`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          content,
          source,
          category: metadata?.category || undefined,
          userId: metadata?.userId,
          metadata,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch (err: any) {
      console.error(`memory capture error: ${err.message}`);
      return false;
    }
  }

  return { recall, capture };
}

export type MemoryClient = ReturnType<typeof createMemory>;
