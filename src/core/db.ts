import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { StoredMessage } from "../types";

export interface MessageDB {
  addMessage(channelId: string, userId: string, username: string, role: "user" | "assistant", content: string): void;
  getHistory(channelId: string, limit?: number): StoredMessage[];
  getLastAssistantMessage(channelId: string): { content: string; created_at: number } | null;
  clearHistory(channelId: string): number;
  close(): void;
}

export function createDB(dbPath: string): MessageDB {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel
    ON messages(channel_id, created_at DESC)
  `);

  const stmtInsert = db.prepare(
    "INSERT INTO messages (channel_id, user_id, username, role, content) VALUES (?, ?, ?, ?, ?)"
  );
  const stmtHistory = db.prepare(
    `SELECT role, user_id, username, content, created_at FROM messages
     WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?`
  );
  const stmtLastAssistant = db.prepare(
    `SELECT content, created_at FROM messages
     WHERE channel_id = ? AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`
  );
  const stmtClear = db.prepare("DELETE FROM messages WHERE channel_id = ?");

  return {
    addMessage(channelId, userId, username, role, content) {
      stmtInsert.run(channelId, userId, username, role, content);
    },
    getHistory(channelId, limit = 60) {
      const rows = stmtHistory.all(channelId, limit) as StoredMessage[];
      return rows.reverse();
    },
    getLastAssistantMessage(channelId) {
      return (stmtLastAssistant.get(channelId) as any) || null;
    },
    clearHistory(channelId) {
      return stmtClear.run(channelId).changes;
    },
    close() {
      db.close();
    },
  };
}
