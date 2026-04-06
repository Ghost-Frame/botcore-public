import type { BotAction, GuildRole } from "../types";

export function createModeration(
  discordApi: (path: string, options?: RequestInit) => Promise<Response>,
  guildId: string,
  protectedIds: Set<string> = new Set(),
) {
  let guildRoles: GuildRole[] = [];

  async function fetchGuildRoles(): Promise<void> {
    try {
      const res = await discordApi(`/guilds/${guildId}/roles`);
      if (!res.ok) {
        console.error(`Failed to fetch roles: ${res.status}`);
        return;
      }
      const roles = (await res.json()) as any[];
      guildRoles = roles
        .filter(r => r.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map(r => ({ id: r.id, name: r.name, position: r.position }));
      console.log(`Cached ${guildRoles.length} guild roles`);
    } catch (err: any) {
      console.error(`fetchGuildRoles failed: ${err.message}`);
    }
  }

  function resolveRole(nameOrId: string): GuildRole | null {
    const byId = guildRoles.find(r => r.id === nameOrId);
    if (byId) return byId;
    const lower = nameOrId.toLowerCase();
    const matches = guildRoles.filter(r => r.name.toLowerCase() === lower);
    if (matches.length > 1) {
      console.log(`[moderation] Ambiguous role name "${nameOrId}" matches ${matches.length} roles -- aborting`);
      return null;
    }
    return matches[0] || null;
  }

  function getRoles(): GuildRole[] {
    return guildRoles;
  }

  async function addRole(userId: string, roleNameOrId: string): Promise<string> {
    const role = resolveRole(roleNameOrId);
    if (!role) return `role "${roleNameOrId}" not found`;
    const res = await discordApi(`/guilds/${guildId}/members/${userId}/roles/${role.id}`, {
      method: "PUT",
    });
    if (!res.ok) return `failed to add role: ${res.status}`;
    return `added role "${role.name}" to <@${userId}>`;
  }

  async function removeRole(userId: string, roleNameOrId: string): Promise<string> {
    const role = resolveRole(roleNameOrId);
    if (!role) return `role "${roleNameOrId}" not found`;
    const res = await discordApi(`/guilds/${guildId}/members/${userId}/roles/${role.id}`, {
      method: "DELETE",
    });
    if (!res.ok) return `failed to remove role: ${res.status}`;
    return `removed role "${role.name}" from <@${userId}>`;
  }

  async function kickMember(userId: string, reason?: string): Promise<string> {
    const h: Record<string, string> = {};
    if (reason) h["X-Audit-Log-Reason"] = reason;
    const res = await discordApi(`/guilds/${guildId}/members/${userId}`, {
      method: "DELETE",
      headers: h,
    });
    if (!res.ok) return `failed to kick: ${res.status}`;
    return `kicked <@${userId}>${reason ? ` (${reason})` : ""}`;
  }

  async function banMember(userId: string, reason?: string): Promise<string> {
    const h: Record<string, string> = {};
    if (reason) h["X-Audit-Log-Reason"] = reason;
    const res = await discordApi(`/guilds/${guildId}/bans/${userId}`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify(reason ? { reason } : {}),
    });
    if (!res.ok) return `failed to ban: ${res.status}`;
    return `banned <@${userId}>${reason ? ` (${reason})` : ""}`;
  }

  async function executeActions(actions: BotAction[]): Promise<void> {
    for (const action of actions) {
      if (protectedIds.has(action.target)) {
        console.log(`[moderation] BLOCKED action ${action.type} -- target ${action.target} is protected`);
        continue;
      }
      let result: string;
      switch (action.type) {
        case "add_role":
          result = await addRole(action.target, action.role!);
          break;
        case "remove_role":
          result = await removeRole(action.target, action.role!);
          break;
        case "kick":
          result = await kickMember(action.target, action.reason);
          break;
        case "ban":
          result = await banMember(action.target, action.reason);
          break;
        default:
          result = `unknown action: ${(action as any).type}`;
      }
      console.log(`Action result: ${result}`);
    }
  }

  return {
    fetchGuildRoles,
    resolveRole,
    getRoles,
    addRole,
    removeRole,
    kickMember,
    banMember,
    executeActions,
  };
}

export type Moderation = ReturnType<typeof createModeration>;
