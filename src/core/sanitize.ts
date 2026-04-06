const DEFAULT_NO_REPLY_MARKERS = [
  "NO_REPLY", "no_reply", "[NO_REPLY]", "<NO_REPLY>", "NO\\_REPLY", "[SKIP]", "SKIP",
];

export function isNoReply(text: string, markers?: string[]): boolean {
  const trimmed = text.trim();
  const m = markers ?? DEFAULT_NO_REPLY_MARKERS;
  return m.some(marker => trimmed === marker || trimmed.startsWith(marker + "\n") || trimmed.includes(marker));
}

export function sanitizeOutput(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<memory-context>[\s\S]*?<\/memory-context>/g, "");
  cleaned = cleaned.replace(/<anti-repeat>[\s\S]*?<\/anti-repeat>/g, "");
  cleaned = cleaned.replace(/<conversation-awareness>[\s\S]*?<\/conversation-awareness>/g, "");
  cleaned = cleaned.replace(/^## (Goal|Instructions|Discoveries|Accomplished|Relevant files).*$/gm, "");
  cleaned = cleaned.replace(/\{"message_id"[\s\S]*?\}\n?/g, "");
  cleaned = cleaned.replace(/<tool:[^>]*\/>/g, "");
  cleaned = cleaned.replace(/^REACT:\s*\S+\s*/i, "");
  cleaned = cleaned.replace(/\[ACTION:\w+\s+[^\]]+\]/gi, "");
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, "");
  cleaned = cleaned.replace(/\[SKIP\]/gi, "");
  cleaned = cleaned.replace(/\n{2,}/g, "\n");
  return cleaned.trim();
}

export function splitMessage(text: string, maxLen = 2000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let splitAt = -1;
    const cbe = remaining.lastIndexOf("\n```\n", maxLen);
    if (cbe > maxLen * 0.3) splitAt = cbe + 4;
    if (splitAt === -1) {
      const dn = remaining.lastIndexOf("\n\n", maxLen);
      if (dn > maxLen * 0.3) splitAt = dn + 2;
    }
    if (splitAt === -1) {
      const sn = remaining.lastIndexOf("\n", maxLen);
      if (sn > maxLen * 0.3) splitAt = sn + 1;
    }
    if (splitAt === -1) {
      const sp = remaining.lastIndexOf(". ", maxLen);
      if (sp > maxLen * 0.3) splitAt = sp + 2;
    }
    if (splitAt === -1) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
