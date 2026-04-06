import type { DiscordTransport, GuildRole } from "../types";

const API_BASE = "https://discord.com/api/v10";

export function createRestTransport(opts: { token: string }): DiscordTransport & {
  discordApi: (path: string, options?: RequestInit) => Promise<Response>;
  setSelfId: (id: string | null) => void;
} {
  const { token } = opts;

  async function discordApi(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  }

  let selfId: string | null = null;

  async function sendMessage(
    channelId: string,
    content: string,
    replyToId?: string,
    ping: boolean = false,
  ): Promise<string | null> {
    const body: any = { content };
    if (replyToId) {
      body.message_reference = { message_id: replyToId };
      body.allowed_mentions = { replied_user: ping };
    }
    try {
      const res = await discordApi(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Failed to send message: ${res.status} ${text.slice(0, 200)}`);
        // Retry without reply if permission fails
        if (replyToId && (text.includes("160002") || res.status === 403)) {
          console.log("Retrying without reply reference...");
          return sendMessage(channelId, content, undefined, false);
        }
        return null;
      }
      const data = (await res.json()) as any;
      return data.id || null;
    } catch (err: any) {
      console.error(`sendMessage failed: ${err.message}`);
      return null;
    }
  }

  async function sendTyping(channelId: string): Promise<void> {
    try {
      await discordApi(`/channels/${channelId}/typing`, { method: "POST" });
    } catch {}
  }

  async function addReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
    try {
      const encoded = encodeURIComponent(emoji);
      const res = await discordApi(
        `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
        { method: "PUT" },
      );
      return res.ok || res.status === 204;
    } catch {
      return false;
    }
  }

  function getSelfId(): string | null {
    return selfId;
  }

  return {
    sendMessage,
    sendTyping,
    addReaction,
    getSelfId,
    discordApi,
    setSelfId(id: string | null) {
      selfId = id;
    },
  };
}

/** Thin wrapper to create a DiscordTransport from a discord.js Client */
export function createDiscordJsTransport(client: any): DiscordTransport {
  return {
    async sendMessage(channelId, content, replyToId, ping = false) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !("send" in channel)) return null;
        let sent;
        if (replyToId) {
          try {
            const refMsg = channel.messages?.cache?.get(replyToId);
            if (refMsg) {
              sent = ping
                ? await refMsg.reply(content)
                : await refMsg.reply({ content, allowedMentions: { repliedUser: false } });
            } else {
              sent = await channel.send(content);
            }
          } catch {
            sent = await channel.send(content);
          }
        } else {
          sent = await channel.send(content);
        }
        return sent?.id || null;
      } catch (err: any) {
        console.error(`sendMessage failed: ${err.message}`);
        return null;
      }
    },
    async sendTyping(channelId) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && "sendTyping" in channel) await channel.sendTyping();
      } catch {}
    },
    async addReaction(channelId, messageId, emoji) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !("messages" in channel)) return false;
        const msg = await channel.messages.fetch(messageId);
        if (msg) {
          await msg.react(emoji);
          return true;
        }
      } catch {}
      return false;
    },
    getSelfId() {
      return client.user?.id || null;
    },
  };
}

export type RestTransport = ReturnType<typeof createRestTransport>;
