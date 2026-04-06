import type { BotAction, GuildRole } from "../types";

export function parseActions(text: string): { cleanText: string; actions: BotAction[] } {
  const actions: BotAction[] = [];
  const actionPattern = /\[ACTION:(\w+)\s+([^\]]+)\]/gi;
  let match;
  while ((match = actionPattern.exec(text)) !== null) {
    const type = match[1].toLowerCase();
    const params = match[2];
    const paramMap: Record<string, string> = {};
    const paramPattern = /(\w+)=(?:"([^"]*)"|(\S+))/g;
    let pm;
    while ((pm = paramPattern.exec(params)) !== null) {
      paramMap[pm[1]] = pm[2] !== undefined ? pm[2] : pm[3];
    }
    if (type === "add_role" && paramMap.target && paramMap.role) {
      actions.push({ type: "add_role", target: paramMap.target, role: paramMap.role });
    } else if (type === "remove_role" && paramMap.target && paramMap.role) {
      actions.push({ type: "remove_role", target: paramMap.target, role: paramMap.role });
    } else if (type === "kick" && paramMap.target) {
      actions.push({ type: "kick", target: paramMap.target, reason: paramMap.reason });
    } else if (type === "ban" && paramMap.target) {
      actions.push({ type: "ban", target: paramMap.target, reason: paramMap.reason });
    }
  }
  const cleanText = text.replace(/\[ACTION:\w+\s+[^\]]+\]/gi, "").trim();
  return { cleanText, actions };
}
