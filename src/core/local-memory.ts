import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

const INFRA_PATTERNS = [
  "ssh -i", "sudo -s", "systemctl", "podman", "docker",
  "passwd", "api_key", "api_secret", "bot_token",
];

function containsInfraContent(text: string): boolean {
  const lower = text.toLowerCase();
  return INFRA_PATTERNS.some(p => lower.includes(p));
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "this", "that",
  "and", "or", "but", "if", "then", "so", "of", "in", "on", "at",
  "to", "for", "with", "from", "by", "about", "into", "not", "no",
  "just", "like", "what", "when", "how", "who", "where", "which",
  "bot", "sender_id",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

const MAX_CONTENT_LENGTH = 2000;
const RECENCY_HALF_LIFE = 7 * 24 * 60 * 60; // 7 days in seconds

export interface LocalMemoryConfig {
  dbPath: string;
  source?: string;
}

export function createLocalMemory(config: LocalMemoryConfig) {
  const { dbPath, source = "discord-bot" } = config;

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_created
    ON memories(created_at DESC)
  `);

  const stmtInsert = db.prepare(
    "INSERT INTO memories (content, source) VALUES (?, ?)"
  );
  const stmtRecent = db.prepare(
    "SELECT id, content, created_at FROM memories ORDER BY created_at DESC LIMIT ?"
  );
  const stmtSearch = db.prepare(
    "SELECT id, content, created_at FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT 50"
  );

  function scoreMemory(content: string, keywords: string[], createdAt: number, now: number): number {
    const lower = content.toLowerCase();
    let keywordScore = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) keywordScore++;
    }
    if (keywordScore === 0) return 0;

    // Recency decay: score halves every RECENCY_HALF_LIFE seconds
    const ageSec = now - createdAt;
    const recencyWeight = Math.pow(0.5, ageSec / RECENCY_HALF_LIFE);

    return keywordScore * (0.3 + 0.7 * recencyWeight);
  }

  async function recall(query: string, limit: number = 5): Promise<string | null> {
    try {
      const keywords = extractKeywords(query);
      const now = Math.floor(Date.now() / 1000);

      if (keywords.length === 0) {
        // No keywords -- return most recent memories
        const rows = stmtRecent.all(limit) as { id: number; content: string; created_at: number }[];
        if (rows.length === 0) return null;
        return rows.map(r => r.content).join("\n---\n");
      }

      // Search for each keyword and collect unique results
      const seen = new Set<number>();
      const candidates: { content: string; created_at: number; score: number }[] = [];

      for (const kw of keywords.slice(0, 8)) {
        const rows = stmtSearch.all(`%${kw}%`) as { id: number; content: string; created_at: number }[];
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const score = scoreMemory(row.content, keywords, row.created_at, now);
          if (score > 0) candidates.push({ content: row.content, created_at: row.created_at, score });
        }
      }

      if (candidates.length === 0) {
        // No keyword matches -- fall back to recent
        const rows = stmtRecent.all(limit) as { id: number; content: string; created_at: number }[];
        if (rows.length === 0) return null;
        return rows.map(r => r.content).join("\n---\n");
      }

      // Sort by score descending, take top N
      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, limit);
      return top.map(r => r.content).join("\n---\n");
    } catch (err: any) {
      console.error(`[local-memory] recall error: ${err.message}`);
      return null;
    }
  }

  async function capture(content: string, metadata?: Record<string, any>): Promise<boolean> {
    if (containsInfraContent(content)) return false;

    try {
      const truncated = content.length > MAX_CONTENT_LENGTH
        ? content.slice(0, MAX_CONTENT_LENGTH)
        : content;
      stmtInsert.run(truncated, source);
      return true;
    } catch (err: any) {
      console.error(`[local-memory] capture error: ${err.message}`);
      return false;
    }
  }

  return { recall, capture };
}

export type LocalMemoryClient = ReturnType<typeof createLocalMemory>;
